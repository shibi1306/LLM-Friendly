import '../polyfill.js';

/**
 * LLM Friendly — Production service worker
 *
 * Design principles:
 * 1. Never crash from unhandled rejections
 * 2. Gracefully handle Chrome's idle-termination cycle
 * 3. All message handlers wrapped in error boundaries
 * 4. Offscreen document lifecycle managed with retry
 * 5. Storage operations retried on transient failure
 */

// ── Constants ───────────────────────────────────────────────────────────

const HISTORY_KEY = 'conversion_history';
const SETTINGS_KEY = 'settings';

const DEFAULT_SETTINGS = {
  outputSubfolder: 'LLM Friendly',
  enabledSites: {
    chatgpt: true, claude: true, copilot: true,
    poe: true, deepseek: true, grok: true,
    perplexity: true,
  },
  autoConvert: false,
  customSites: [],
  historyLimit: 50,
};

// ── Keepalive — prevent premature idle termination ─────────────────────
// Chrome terminates service workers after ~30s of inactivity.
// Brave is more aggressive — some versions terminate after ~15-20s.
// A combination of alarms and port-based wake-up keeps the worker alive.

function startKeepalive() {
  try {
    if (chrome.alarms) {
      chrome.alarms.create('keepalive', { periodInMinutes: 0.2 }); // ~12s
    }
  } catch (e) {
    console.warn('[LLM Friendly] Could not create keepalive alarm:', e.message);
  }
}

// Ensure keepalive starts as soon as the worker boots
startKeepalive();

// Secondary keepalive: self-pinging loop that keeps the SW alive even in
// Brave, which terminates service workers more aggressively than Chrome.
// This catches Brave's aggressive idle detection when alarms alone struggle.
function startKeepaliveLoop() {
  let timer = null;
  let running = true;

  async function ping() {
    if (!running) return;
    try {
      // Lightweight storage read — keeps the SW alive
      await browser.storage.local.get('keepalive_ping');
    } catch {
      // SW might be shutting down; that's fine
    }
    if (running) {
      timer = setTimeout(ping, 10000);
    }
  }

  ping();

  return {
    stop: () => {
      running = false;
      if (timer) clearTimeout(timer);
    }
  };
}

const keepaliveLoop = startKeepaliveLoop();

// ── Error-safe storage helpers ──────────────────────────────────────────

async function storageGet(key, fallback = null) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const data = await browser.storage.local.get(key);
      return data[key] ?? fallback;
    } catch (err) {
      console.warn(`[LLM Friendly] storage.get attempt ${attempt}/3 failed:`, err.message);
      if (attempt < 3) await sleep(100 * attempt);
    }
  }
  return fallback;
}

async function storageSet(obj) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await browser.storage.local.set(obj);
      return;
    } catch (err) {
      console.warn(`[LLM Friendly] storage.set attempt ${attempt}/3 failed:`, err.message);
      if (attempt < 3) await sleep(100 * attempt);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Settings ────────────────────────────────────────────────────────────

async function getSettings() {
  const saved = await storageGet(SETTINGS_KEY, {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

async function saveSettings(settings) {
  await storageSet({ [SETTINGS_KEY]: settings });

  // Register/unregister content scripts for custom sites
  await registerCustomSites(settings.customSites || []);

  // Notify all tabs about settings update (best-effort)
  notifyAllTabs({ type: 'SETTINGS_UPDATED', settings }).catch(() => {});

  // Enforce history limit
  const items = await storageGet(HISTORY_KEY, []);
  if (items.length > settings.historyLimit) {
    await storageSet({ [HISTORY_KEY]: items.slice(0, settings.historyLimit) });
  }

  return { success: true };
}

// ── Custom site content scripts ─────────────────────────────────────────

async function registerCustomSites(customSites) {
  try {
    // Unregister old custom scripts
    const registered = await browser.scripting.getRegisteredContentScripts();
    const customScriptIds = registered
      .filter(s => s.id.startsWith('custom-site-'))
      .map(s => s.id);
    if (customScriptIds.length > 0) {
      await browser.scripting.unregisterContentScripts({ ids: customScriptIds });
    }

    // Register new custom scripts
    if (customSites.length > 0) {
      const scripts = customSites.map((url, idx) => ({
        id: `custom-site-${idx}`,
        matches: [url],
        js: ['content.js'],
        css: ['content.css'],
        runAt: 'document_idle',
      }));
      await browser.scripting.registerContentScripts(scripts);
    }
  } catch (err) {
    console.error('[LLM Friendly] Failed to register custom site scripts:', err);
  }
}

// ── Tab notification (best-effort) ──────────────────────────────────────

async function notifyAllTabs(message) {
  let tabs;
  try {
    tabs = await browser.tabs.query({});
  } catch {
    return; // Tab API unavailable
  }
  const results = await Promise.allSettled(
    tabs.map(tab =>
      browser.tabs.sendMessage(tab.id, message).catch(() => {})
    )
  );
  const failed = results.filter(r => r.status === 'rejected').length;
  if (failed > 0) {
    console.debug(`[LLM Friendly] ${failed} tabs not reachable for notification`);
  }
}

// ── Offscreen document (for Tesseract.js OCR) ───────────────────────────

let creatingOffscreen = null;

async function setupOffscreenDocument(path) {
  // Fast path: document already exists
  try {
    if (await chrome.offscreen.hasDocument()) return;
  } catch {
    // hasDocument may throw if context was just invalidated
  }

  // Dedup concurrent creation requests
  if (creatingOffscreen) {
    try {
      await creatingOffscreen;
    } catch {
      // Previous creation failed; continue to retry
    }
    // Check if a concurrent call succeeded
    try {
      if (await chrome.offscreen.hasDocument()) return;
    } catch {
      // Ignore
    }
  }

  creatingOffscreen = createOffscreenWithRetry(path);
  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

async function createOffscreenWithRetry(path, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Close any stale document first to avoid "only one offscreen document" errors
      try {
        await chrome.offscreen.closeDocument();
      } catch {
        // No document to close; that's fine
      }

      await chrome.offscreen.createDocument({
        url: path,
        reasons: ['WORKERS'],
        justification: 'Run Tesseract.js Web Worker for OCR',
      });
      return;
    } catch (err) {
      lastError = err;
      console.warn(`[LLM Friendly] Offscreen document creation attempt ${attempt}/${maxAttempts} failed:`, err.message);
      if (attempt < maxAttempts) await sleep(300 * attempt);
    }
  }
  throw lastError || new Error('Failed to create offscreen document');
}

// ── Message router ──────────────────────────────────────────────────────

const messageHandlers = {
  SAVE_CONVERTED: handleSaveConverted,
  GET_HISTORY: () => storageGet(HISTORY_KEY, []),
  CLEAR_HISTORY: async () => {
    await storageSet({ [HISTORY_KEY]: [] });
    return { success: true };
  },
  DELETE_HISTORY_ITEM: async (message) => {
    const history = await storageGet(HISTORY_KEY, []);
    await storageSet({ [HISTORY_KEY]: history.filter(item => item.id !== message.id) });
    return { success: true };
  },
  GET_SETTINGS: () => getSettings(),
  SAVE_SETTINGS: (message) => saveSettings(message.settings),
  DOWNLOAD_FILE: (message) => downloadFile(message),
  CONVERT_IMAGE_BACKGROUND: (message) => handleImageOCR(message),
};

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = messageHandlers[message.type];
  if (!handler) return false; // Not our message

  // Wrap every handler in an error boundary so a single failure never
  // crashes the service worker or breaks other listeners.
  Promise.resolve()
    .then(() => handler(message, sender))
    .then(result => sendResponse(result ?? { success: true }))
    .catch(err => {
      console.error(`[LLM Friendly] Handler '${message.type}' failed:`, err);
      sendResponse({ error: err.message || 'Unknown error' });
    });

  return true; // Keep channel open for async response
});

// ── OCR handler with full lifecycle management ──────────────────────────

async function handleImageOCR(message) {
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await setupOffscreenDocument('offscreen.html');

      // Forward to the offscreen document
      const response = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_OCR',
        dataUrl: message.dataUrl,
        fileName: message.fileName,
      });

      if (response?.markdown) return response;
      if (response?.error) throw new Error(response.error);
      throw new Error('Empty response from OCR');
    } catch (err) {
      lastError = err;
      console.warn(`[LLM Friendly] OCR attempt ${attempt}/2 failed:`, err.message);
      if (attempt === 1) {
        // Wait a moment, then try again (offscreen doc may need cleanup)
        await sleep(500);
        // Force close the offscreen doc so it gets recreated fresh
        try { await chrome.offscreen.closeDocument(); } catch {}
      }
    }
  }

  return { error: lastError?.message || 'OCR failed after 2 attempts' };
}

// ── History ─────────────────────────────────────────────────────────────

async function handleSaveConverted({ fileName, markdown, sourceUrl, sourceFileName }) {
  const settings = await getSettings();
  const limit = settings.historyLimit ?? 50;
  const history = await storageGet(HISTORY_KEY, []);

  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    fileName,
    markdown,
    sourceUrl,
    sourceFileName,
    timestamp: new Date().toISOString(),
    wordCount: markdown.trim().split(/\s+/).length,
    charCount: markdown.length,
  };

  history.unshift(item);
  if (history.length > limit) history.splice(limit);
  await storageSet({ [HISTORY_KEY]: history });
  return { success: true, id: item.id };
}

// ── Download ────────────────────────────────────────────────────────────

async function downloadFile({ content, fileName, subfolder }) {
  const settings = await getSettings();
  const folder = subfolder || settings.outputSubfolder || 'LLM Friendly';
  const safeName = fileName.replace(/[<>:"/\\|?*]/g, '_');

  // Use data URL since Blob/URL.createObjectURL is not available in service workers
  const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(content);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const downloadId = await browser.downloads.download({
        url: dataUrl,
        filename: `${folder}/${safeName}`,
        saveAs: false,
        conflictAction: 'uniquify',
      });
      return { success: true, downloadId };
    } catch (err) {
      if (attempt < 3 && err.message?.includes('context invalidated')) {
        await sleep(200);
        continue;
      }
      throw err;
    }
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────

// On install: register custom sites
browser.runtime.onInstalled.addListener(async () => {
  console.log('[LLM Friendly] Service worker installed');
  const settings = await getSettings();
  if (settings.customSites?.length > 0) {
    await registerCustomSites(settings.customSites);
  }
  startKeepalive();
});

// On browser start: re-register custom sites, start keepalive
browser.runtime.onStartup.addListener(async () => {
  console.log('[LLM Friendly] Service worker started');
  const settings = await getSettings();
  if (settings.customSites?.length > 0) {
    await registerCustomSites(settings.customSites);
  }
  startKeepalive();
});

// On suspend: save any in-flight state (best-effort before idle termination)
browser.runtime.onSuspend?.addListener(() => {
  console.log('[LLM Friendly] Service worker suspending');
});

// Keepalive alarm handler — lightweight ping to prevent idle termination
if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepalive') {
      // Perform a lightweight operation so the SW has active work
      browser.storage.local.get('keepalive_ping').catch(() => {});
    }
  });
}

// ── Port connections (keepalive from content scripts) ──────────────────
// Content scripts open persistent ports so the SW stays alive as long as
// any tab with the content script is open. We don't need to do anything
// special here — just accept the connection and let it stay open.
browser.runtime.onConnect.addListener((port) => {
  if (port.name === 'cs-keepalive') {
    // Port stays open, preventing SW idle termination.
    // When the tab closes, the port disconnects automatically.
    port.onDisconnect.addListener(() => {
      // Nothing to clean up — the port just served as a keepalive.
    });
  }
});
