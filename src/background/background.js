import '../polyfill.js';

// Lightweight background service worker — storage, downloads, settings
const HISTORY_KEY = 'conversion_history';
const SETTINGS_KEY = 'settings';

const DEFAULT_SETTINGS = {
  outputSubfolder: 'LLM Friendly',
  enabledSites: {
    chatgpt: true, claude: true, gemini: true, copilot: true,
    mistral: true, poe: true, deepseek: true, grok: true,
    huggingface: true, perplexity: true,
  },
  autoConvert: false,
  enabled: true,
  customSites: [],
  historyLimit: 50,
};

// Load custom sites on extension startup
browser.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  if (settings.customSites && settings.customSites.length > 0) {
    await registerCustomSites(settings.customSites);
  }
});

// Also load on startup (when browser starts)
browser.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  if (settings.customSites && settings.customSites.length > 0) {
    await registerCustomSites(settings.customSites);
  }
});

async function registerCustomSites(customSites) {
  try {
    // Unregister old custom scripts
    const registered = await browser.scripting.getRegisteredContentScripts();
    const customScriptIds = registered.filter(s => s.id.startsWith('custom-site-')).map(s => s.id);
    if (customScriptIds.length > 0) {
      await browser.scripting.unregisterContentScripts({ ids: customScriptIds });
    }

    // Register new custom scripts
    const scripts = customSites.map((url, idx) => ({
      id: `custom-site-${idx}`,
      matches: [url],
      js: ['content.js'],
      css: ['content.css'],
      runAt: 'document_idle',
    }));

    await browser.scripting.registerContentScripts(scripts);
  } catch (err) {
    console.error('Failed to register custom site scripts:', err);
  }
}

let creatingOffscreen;

async function setupOffscreenDocument(path) {
  if (await chrome.offscreen.hasDocument()) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: path,
      reasons: ['WORKERS'],
      justification: 'Run Tesseract.js Web Worker for OCR',
    });
    try {
      await creatingOffscreen;
    } finally {
      creatingOffscreen = null;
    }
  }
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'SAVE_CONVERTED':
      handleSaveConverted(message).then(sendResponse);
      return true;
    case 'GET_HISTORY':
      getHistory().then(sendResponse);
      return true;
    case 'CLEAR_HISTORY':
      clearHistory().then(sendResponse);
      return true;
    case 'DELETE_HISTORY_ITEM':
      deleteHistoryItem(message.id).then(sendResponse);
      return true;
    case 'GET_SETTINGS':
      getSettings().then(sendResponse);
      return true;
    case 'SAVE_SETTINGS':
      saveSettings(message.settings).then(sendResponse);
      return true;
    case 'DOWNLOAD_FILE':
      downloadFile(message).then(sendResponse);
      return true;
    case 'CONVERT_IMAGE_BACKGROUND':
      handleImageOCR(message).then(sendResponse);
      return true;
  }
});

async function handleImageOCR(message) {
  let lastError = null;
  // Try up to 2 times
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await setupOffscreenDocument('offscreen.html');

      // Forward the message to the offscreen document
      const response = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_OCR',
        dataUrl: message.dataUrl,
        fileName: message.fileName,
      });

      return response;
    } catch (err) {
      console.error(`[LLM Friendly] Offscreen OCR attempt ${attempt} failed:`, err);
      lastError = err;
      // If this was the last attempt, break and return error
      if (attempt === 2) break;
      // Small delay before retry
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return { error: lastError?.message || 'Unknown error' };
}

async function handleSaveConverted({ fileName, markdown, sourceUrl, sourceFileName }) {
  const settings = await getSettings();
  const limit = settings.historyLimit ?? 50;
  const history = await getHistory();
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
  await browser.storage.local.set({ [HISTORY_KEY]: history });
  return { success: true, id: item.id };
}

async function getHistory() {
  const data = await browser.storage.local.get(HISTORY_KEY);
  return data[HISTORY_KEY] || [];
}

async function clearHistory() {
  await browser.storage.local.set({ [HISTORY_KEY]: [] });
  return { success: true };
}

async function deleteHistoryItem(id) {
  const history = await getHistory();
  await browser.storage.local.set({
    [HISTORY_KEY]: history.filter(item => item.id !== id),
  });
  return { success: true };
}

async function getSettings() {
  const data = await browser.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
}

async function saveSettings(settings) {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });

  // Register/unregister content scripts for custom sites
  if (settings.customSites && settings.customSites.length > 0) {
    await registerCustomSites(settings.customSites);
  } else {
    // Clear all custom site scripts if none defined
    try {
      const registered = await browser.scripting.getRegisteredContentScripts();
      const customScriptIds = registered.filter(s => s.id.startsWith('custom-site-')).map(s => s.id);
      if (customScriptIds.length > 0) {
        await browser.scripting.unregisterContentScripts({ ids: customScriptIds });
      }
    } catch (err) {
      console.error('Failed to unregister custom site scripts:', err);
    }
  }

  // Notify all tabs about settings update
  try {
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      browser.tabs.sendMessage(tab.id, {
        type: 'SETTINGS_UPDATED',
        settings: settings
      }).catch(() => {
        // Ignore errors for tabs without content script
      });
    }
  } catch (err) {
    console.error('Failed to notify tabs:', err);
  }

  // Enforce history limit
  const { historyLimit } = settings;
  const historyData = await browser.storage.local.get(HISTORY_KEY);
  const items = historyData[HISTORY_KEY] || [];
  if (items.length > historyLimit) {
    await browser.storage.local.set({ [HISTORY_KEY]: items.slice(0, historyLimit) });
  }

  return { success: true };
}

async function downloadFile({ content, fileName, subfolder }) {
  const settings = await getSettings();
  const folder = subfolder || settings.outputSubfolder || 'LLM Friendly';
  const safeName = fileName.replace(/[<>:"/\\|?*]/g, '_');

  // Use data URL since Blob/URL.createObjectURL not available in service worker
  const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(content);

  const downloadId = await browser.downloads.download({
    url: dataUrl,
    filename: `${folder}/${safeName}`,
    saveAs: false,
    conflictAction: 'uniquify',
  });

  return { success: true, downloadId };
}