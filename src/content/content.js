import '../polyfill.js';
import { convertFile, isSupported, formatBytes } from '../converters/index.js';
import './content.css';

// Chat input selectors per site
const SITE_INPUT_SELECTORS = {
  'chatgpt.com': '#prompt-textarea, [contenteditable="true"][data-id]',
  'chat.openai.com': '#prompt-textarea, [contenteditable="true"][data-id]',
  'claude.ai': '[contenteditable="true"].ProseMirror',
  'gemini.google.com': '.ql-editor[contenteditable="true"]',
  'copilot.microsoft.com': '#userInput, [contenteditable="true"]',
  'www.bing.com': '#searchbox, [contenteditable="true"]',
  'chat.mistral.ai': 'textarea, [contenteditable="true"]',
  'mistral.ai': 'textarea, [contenteditable="true"]',
  'poe.com': 'textarea[placeholder], [contenteditable="true"]',
  'chat.deepseek.com': 'textarea, [contenteditable="true"]',
  'aistudio.google.com': 'textarea, [contenteditable="true"]',
  'grok.com': 'textarea, [contenteditable="true"]',
  'x.com': 'textarea, [contenteditable="true"]',
  'huggingface.co': 'textarea, [contenteditable="true"]',
  'perplexity.ai': 'div[contenteditable="true"], textarea',
};

const attachedInputs = new WeakSet();
let convertedContent = null;
let currentSiteEnabled = true;
let autoConvertEnabled = false;
let mutationObserver = null;
let dragListenerAdded = false;

// Paste interception — store file+target so we can re-dispatch on skip
let pendingPasteFile = null;
let pendingPasteTarget = null;
let isRedispatchingPaste = false; // guard to prevent intercepting our own synthetic event

async function init() {
  console.log('[LLM Friendly] Initializing on', window.location.hostname);

  // Establish a persistent port to the service worker so it does not go
  // idle while the content script is active. The port auto-reconnects
  // if the SW restarts.
  keepSwAlive();

  const settings = await getSettings();
  console.log('[LLM Friendly] Settings:', settings);

  // Check if current site is enabled
  currentSiteEnabled = await isSiteEnabled(settings);
  autoConvertEnabled = settings.autoConvert === true;
  console.log('[LLM Friendly] Site enabled:', currentSiteEnabled, 'Auto-convert:', autoConvertEnabled);
  if (!currentSiteEnabled) {
    console.log('[LLM Friendly] Extension disabled for this site');
    return;
  }

  watchFileInputs();
  setupDragDetection();
  setupPasteDetection();

  // Listen for settings updates from background
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'SETTINGS_UPDATED') {
      console.log('[LLM Friendly] Settings updated:', message.settings);
      handleSettingsUpdate(message.settings);
    }
  });

  console.log('[LLM Friendly] Initialization complete');
}

async function handleSettingsUpdate(settings) {
  const siteEnabled = await isSiteEnabled(settings);
  autoConvertEnabled = settings.autoConvert === true;

  if (!siteEnabled) {
    // Disable extension on this tab
    currentSiteEnabled = false;
    cleanup();
  } else if (!currentSiteEnabled && siteEnabled) {
    // Re-enable extension on this tab
    currentSiteEnabled = true;
    watchFileInputs();
    setupDragDetection();
  }
}

function cleanup() {
  // Remove overlay if present
  removeOverlay();

  // Stop mutation observer
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }

  // Clear attached inputs tracking (listeners remain but will be blocked by checks)
  // We can't remove listeners from WeakSet items, but the checks will prevent action
}

async function isSiteEnabled(settings) {
  const hostname = window.location.hostname;

  // Map hostname to site key
  const siteMap = {
    'chatgpt.com': 'chatgpt',
    'chat.openai.com': 'chatgpt',
    'claude.ai': 'claude',
    'gemini.google.com': 'gemini',
    'copilot.microsoft.com': 'copilot',
    'www.bing.com': 'copilot',
    'chat.mistral.ai': 'mistral',
    'mistral.ai': 'mistral',
    'poe.com': 'poe',
    'chat.deepseek.com': 'deepseek',
    'aistudio.google.com': 'gemini',
    'grok.com': 'grok',
    'x.com': 'grok',
    'huggingface.co': 'huggingface',
    'perplexity.ai': 'perplexity',
    'www.perplexity.ai': 'perplexity',
  };

  const siteKey = siteMap[hostname];

  // If this is a custom site (not in our preset list), it's enabled
  if (!siteKey) return true;

  // Check if the site is enabled in settings
  return settings.enabledSites?.[siteKey] !== false;
}

// ── File input detection ─────────────────────────────────────────────

function watchFileInputs() {
  // Use event delegation with capture — catches change events from ANY
  // file input, including ones added dynamically after page load,
  // recycled across navigations, or hidden in tooltip/modal containers
  // that our MutationObserver may miss.
  document.addEventListener('change', (e) => {
    // Fast-path: only respond to native file inputs
    const target = e.target;
    if (target.tagName !== 'INPUT' || target.type !== 'file') return;

    // Ignore if we've already handled this particular input and dismissed
    if (attachedInputs.has(target)) {
      // Still fire — the user may have selected a different file
    } else {
      attachedInputs.add(target);
    }

    onFileInputChange(e);
  }, { capture: true });

  // Also watch via MutationObserver for early logging and input registration
  // (not strictly needed for functionality, but helps debug)
  if (mutationObserver) mutationObserver.disconnect();
  mutationObserver = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.('input[type="file"]')) {
          console.log('[LLM Friendly] Detected file input via observer:', node);
        }
        const inputs = node.querySelectorAll?.('input[type="file"]');
        if (inputs?.length) {
          console.log(`[LLM Friendly] Detected ${inputs.length} file input(s)`);
        }
      }
    }
  });
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  console.log('[LLM Friendly] File input detection active (delegation + observer)');
}

async function onFileInputChange(e) {
  console.log('[LLM Friendly] File input change event:', e.target.files?.[0]?.name);
  if (!currentSiteEnabled) {
    console.log('[LLM Friendly] Extension disabled for this site');
    return;
  }
  const file = e.target.files?.[0];
  if (!file) {
    console.log('[LLM Friendly] No file selected');
    return;
  }
  if (!isSupported(file.name)) {
    console.log('[LLM Friendly] File type not supported:', file.name);
    return;
  }

  if (autoConvertEnabled) {
    console.log('[LLM Friendly] Auto-converting file:', file.name);
    startConversion(file);
  } else {
    console.log('[LLM Friendly] Showing prompt for file:', file.name);
    showPrompt(file, e.target);
  }
}

function setupDragDetection() {
  if (dragListenerAdded) return;
  document.addEventListener('drop', e => {
    if (!currentSiteEnabled) return;
    const file = e.dataTransfer?.files?.[0];
    if (!file || !isSupported(file.name)) return;
    console.log('[LLM Friendly] File dropped:', file.name);
    // Give the page its drop event first
    setTimeout(() => {
      if (autoConvertEnabled) {
        startConversion(file);
      } else {
        showPromptFixed(file);
      }
    }, 250);
  }, { capture: true, passive: true });
  dragListenerAdded = true;
  console.log('[LLM Friendly] Drag-drop detection enabled');
}

// ── Paste interception ─────────────────────────────────────────────

function setupPasteDetection() {
  // Listen on window with capture to beat any site-level window capture handlers.
  // window capture fires BEFORE document capture — most chat sites use
  // window-level paste handlers, so we must be first in line.
  window.addEventListener('paste', (e) => {
    // Don't intercept our own re-dispatched paste events
    if (isRedispatchingPaste) return;
    if (!currentSiteEnabled) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && isSupported(file.name)) {
          console.log('[LLM Friendly] File pasted, intercepting:', file.name);

          // Store the file and the paste target so we can re-dispatch later
          pendingPasteFile = file;
          // Try to get the active element as target; fall back to document.body
          pendingPasteTarget = e.target || document.activeElement || document.body;

          // Block the page from receiving this paste event
          e.preventDefault();
          e.stopImmediatePropagation();

          if (autoConvertEnabled) {
            // Auto-convert: no prompt, don't need to re-dispatch
            pendingPasteFile = null;
            pendingPasteTarget = null;
            startConversion(file);
          } else {
            // Show conversion prompt immediately
            showPromptFixed(file);
          }
          break;
        }
      }
    }
  }, { capture: true });
  console.log('[LLM Friendly] Paste detection enabled (window capture, with re-dispatch on skip)');
}

/**
 * Re-dispatch the stored file as a synthetic paste event so the page
 * can handle it normally (upload the file). Called when the user
 * clicks Skip or Close on the conversion prompt.
 */
function allowOriginalPaste() {
  if (!pendingPasteFile) return;

  const file = pendingPasteFile;
  const target = pendingPasteTarget || document.activeElement || document.body;

  // Clear stored state before re-dispatching
  pendingPasteFile = null;
  pendingPasteTarget = null;

  console.log('[LLM Friendly] Re-dispatching paste for original upload:', file.name);
  isRedispatchingPaste = true;
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    });
    target.dispatchEvent(pasteEvent);
  } finally {
    isRedispatchingPaste = false;
  }
}

// ── Overlay ──────────────────────────────────────────────────────────

function showPrompt(file, anchor) {
  removeOverlay();
  const el = buildOverlay(file);
  document.body.appendChild(el);

  // Use fixed positioning so no overflow:hidden ancestor can clip us
  el.style.cssText = 'position:fixed!important;display:block!important;';
  const margin = 16;
  const vpHeight = window.innerHeight;
  const vpWidth = window.innerWidth;

  // Constrain card size to fit within viewport (with margins)
  const maxCardHeight = vpHeight - margin * 2;
  const maxCardWidth = vpWidth - margin * 2;
  const card = el.querySelector('.mdit-card');
  if (card) {
    card.style.maxHeight = `${maxCardHeight}px`;
    card.style.overflowY = 'auto';
    card.style.maxWidth = `${maxCardWidth}px`;
    card.style.width = 'auto';
    card.style.overflowX = 'hidden';
    card.style.wordBreak = 'break-word';
  }

  const rect = anchor?.getBoundingClientRect();
  let top, right;

  if (rect && rect.width > 0 && rect.height > 0 && rect.top < vpHeight && rect.left < vpWidth) {
    // Prefer placing below the anchor
    top = rect.bottom + 8;
    right = vpWidth - rect.right;

    // Check if it would go below viewport
    if (top + maxCardHeight > vpHeight - margin) {
      // Try placing above the anchor instead
      top = Math.max(margin, rect.top - maxCardHeight - 8);
      // If still doesn't fit above either, constrain to bottom of viewport
      if (top + maxCardHeight > vpHeight - margin) {
        top = vpHeight - maxCardHeight - margin;
      }
    }

    // Constrain horizontally — keep card fully within viewport
    right = Math.max(margin, right);
    right = Math.min(right, vpWidth - maxCardWidth - margin);
  } else {
    // Default to bottom-right if no anchor
    top = vpHeight - maxCardHeight - margin;
    right = margin;

    // Ensure within viewport
    top = Math.max(margin, top);
    right = Math.max(margin, right);
    right = Math.min(right, vpWidth - maxCardWidth - margin);
  }

  el.style.top = `${top}px`;
  el.style.right = `${right}px`;
}

function showPromptFixed(file) {
  removeOverlay();
  const el = buildOverlay(file);
  document.body.appendChild(el);

  // Use fixed positioning so no overflow:hidden ancestor can clip us
  el.style.cssText = 'position:fixed!important;display:block!important;';

  const margin = 16;
  const vpHeight = window.innerHeight;
  const vpWidth = window.innerWidth;

  // Constrain card size to fit within viewport (with margins)
  const maxCardHeight = vpHeight - margin * 2;
  const maxCardWidth = vpWidth - margin * 2;
  const card = el.querySelector('.mdit-card');
  if (card) {
    card.style.maxHeight = `${maxCardHeight}px`;
    card.style.overflowY = 'auto';
    card.style.maxWidth = `${maxCardWidth}px`;
    card.style.width = 'auto';
    card.style.overflowX = 'hidden';
    card.style.wordBreak = 'break-word';
  }

  // Bottom-right positioning
  let top = vpHeight - maxCardHeight - margin;
  let right = margin;

  // Ensure within viewport
  top = Math.max(margin, top);
  right = Math.max(margin, right);
  right = Math.min(right, vpWidth - maxCardWidth - margin);

  el.style.top = `${top}px`;
  el.style.right = `${right}px`;
}

function buildOverlay(file) {
  const el = document.createElement('div');
  el.id = 'mditdown-root';

  el.innerHTML = `
    <div class="mdit-card">
      <div class="mdit-header">

        <div class="mdit-title">
          <strong>LLM Friendly</strong>
          <span class="mdit-fname" title="${esc(file.name)}">${esc(file.name)}</span>
        </div>
      </div>

      <div class="mdit-body mdit-prompt">
        <div class="mdit-prompt-row">
          <div class="mdit-prompt-text">
            <p>Convert <strong>${esc(fileLabel(file.name))}</strong> to Markdown?</p>
            <div class="mdit-meta">
              <span>📦 ${formatBytes(file.size)}</span>
              <span>🕐 ${new Date().toLocaleTimeString()}</span>
            </div>
          </div>
          <div class="mdit-actions mdit-prompt-actions">
            <button class="mdit-btn mdit-primary mdit-convert" title="Convert to Markdown">✓</button>
            <button class="mdit-btn mdit-secondary mdit-skip" title="Skip">✕</button>
          </div>
        </div>
      </div>

      <div class="mdit-body mdit-loading mdit-hidden">
        <div class="mdit-spinner"></div>
        <span>Converting ${esc(file.name)}…</span>
      </div>

      <div class="mdit-body mdit-result mdit-hidden">
        <div class="mdit-success-row">
          <span>✅ Converted!</span>
          <span class="mdit-stats" id="mdit-stats"></span>
        </div>
        <pre class="mdit-preview" id="mdit-preview"></pre>
        <div class="mdit-actions mdit-result-actions">
          <button class="mdit-btn mdit-primary mdit-copy">📋 Copy</button>
          <button class="mdit-btn mdit-secondary mdit-insert">✏️ Insert</button>
          <button class="mdit-btn mdit-secondary mdit-save">💾 Save .md</button>
        </div>
      </div>

      <div class="mdit-body mdit-error mdit-hidden">
        <span class="mdit-err-msg"></span>
        <button class="mdit-btn mdit-secondary mdit-retry" style="margin-top:8px">↩ Retry</button>
      </div>
    </div>
  `;

  const card = el.querySelector('.mdit-card');


  // Skip button — allow the original paste through, then remove overlay
  el.querySelector('.mdit-skip').onclick = () => {
    allowOriginalPaste();
    removeOverlay();
  };

  // Convert button — discard pending paste (don't re-dispatch), run conversion
  el.querySelector('.mdit-convert').onclick = () => {
    pendingPasteFile = null;
    pendingPasteTarget = null;
    runConversion(file, card);
  };

  el.querySelector('.mdit-copy').onclick = () => doCopy(card);
  el.querySelector('.mdit-insert').onclick = () => doInsert(card);
  el.querySelector('.mdit-save').onclick = () => doSave(file, card);
  el.querySelector('.mdit-retry').onclick = () => {
    hide(card.querySelector('.mdit-error'));
    show(card.querySelector('.mdit-prompt'), 'block');
  };

  // Stop clicks inside card from propagating to page
  el.addEventListener('mousedown', e => e.stopPropagation());
  return el;
}

// Helper — show/hide panels using mdit-hidden class so page CSS can't interfere
function show(el, displayValue = 'flex') {
  el.classList.remove('mdit-hidden');
  // Set the display type explicitly via inline style as a second layer of defence
  el.style.display = displayValue;
}
function hide(el) {
  el.classList.add('mdit-hidden');
  el.style.removeProperty('display');
}

/**
 * Build the overlay and start conversion immediately (no prompt).
 * Used when auto-convert is enabled.
 */
function startConversion(file) {
  removeOverlay();
  const el = buildOverlay(file);
  document.body.appendChild(el);
  el.style.cssText = 'position:fixed!important;display:block!important;';

  const margin = 16;
  const vpHeight = window.innerHeight;
  const vpWidth = window.innerWidth;
  const card = el.querySelector('.mdit-card');
  if (card) {
    card.style.maxHeight = `${vpHeight - margin * 2}px`;
    card.style.overflowY = 'auto';
    card.style.maxWidth = `${vpWidth - margin * 2}px`;
  }

  // Position top-right
  el.style.top = `${margin}px`;
  el.style.right = `${margin}px`;

  // Start conversion directly (skips the prompt panel)
  runConversion(file, card);
}

async function runConversion(file, card) {
  hide(card.querySelector('.mdit-prompt'));
  show(card.querySelector('.mdit-loading'), 'flex');

  try {
    const md = await convertFile(file);
    convertedContent = md;

    hide(card.querySelector('.mdit-loading'));
    show(card.querySelector('.mdit-result'), 'block');

    const words = md.trim().split(/\s+/).length;
    card.querySelector('#mdit-stats').textContent =
      `${words.toLocaleString()} words · ${md.length.toLocaleString()} chars`;

    const preview = md.substring(0, 400) + (md.length > 400 ? '…' : '');
    card.querySelector('#mdit-preview').textContent = preview;

    try {
      await sendMessageWithRetry({
        type: 'SAVE_CONVERTED',
        fileName: file.name.replace(/\.[^.]+$/, '') + '.md',
        sourceFileName: file.name,
        markdown: md,
        sourceUrl: location.href,
      });
    } catch (err) {
      console.error('[LLM Friendly] Failed to save to history:', err);
      // Non-critical - don't show error to user
    }

    // Auto-hide overlay after 10 seconds
    const root = card.closest('#mditdown-root');
    if (root) {
      root.dataset.hideTimer = setTimeout(() => removeOverlay(), 10000);
    }
  } catch (err) {
    hide(card.querySelector('.mdit-loading'));
    const errEl = card.querySelector('.mdit-error');
    show(errEl, 'flex');
    errEl.querySelector('.mdit-err-msg').textContent = `❌ ${err.message || 'Conversion failed'}`;
  }
}

function doCopy(card) {
  if (!convertedContent) return;
  navigator.clipboard.writeText(convertedContent).then(() => {
    flashBtn(card.querySelector('.mdit-copy'), '✅ Copied!', '📋 Copy');
  });
}

function doInsert(card) {
  if (!convertedContent) return;

  const hostname = location.hostname;
  const selector = SITE_INPUT_SELECTORS[hostname] || '[contenteditable="true"], textarea';

  // Prefer the currently focused element — the user was likely just typing
  // in the chat input before clicking Insert.
  let input = document.activeElement;
  if (
    !input ||
    input === document.body ||
    (!input.matches('textarea, input, [contenteditable]') && !input.closest('[contenteditable]'))
  ) {
    input = document.querySelector(selector);
  }

  if (!input) {
    // No known input found — copy to clipboard as fallback
    fallbackToClipboard(card);
    return;
  }

  // If the matched element is inside a contenteditable (e.g. a <p> or <div>),
  // use the top-level contenteditable ancestor as the target.
  if (!input.hasAttribute('contenteditable') && input.closest('[contenteditable]')) {
    input = input.closest('[contenteditable]');
  }

  input.focus();
  // Small delay so the editor framework registers the focus
  setTimeout(() => {
    if (input.tagName === 'TEXTAREA') {
      const s = input.selectionStart;
      input.value = input.value.slice(0, s) + convertedContent + input.value.slice(input.selectionEnd);
      input.selectionStart = input.selectionEnd = s + convertedContent.length;
      fireInputEvent(input);
      flashBtn(card.querySelector('.mdit-insert'), '✅ Inserted!', '✏️ Insert');
      return;
    }

    // ── Contenteditable ──────────────────────────────────────────
    // 1) Copy to clipboard first so both execCommand and the paste
    //    fallback have access to the data.
    navigator.clipboard.writeText(convertedContent).then(() => {
      // 2) Try execCommand('insertText') — generates a 'beforeinput'
      //    event with inputType='insertText' that ProseMirror and
      //    other editors listen to natively.
      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, convertedContent);
      } catch {
        // execCommand threw — fall through to paste
      }

      if (inserted) {
        fireInputEvent(input);
        flashBtn(card.querySelector('.mdit-insert'), '✅ Inserted!', '✏️ Insert');
        return;
      }

      // 3) execCommand didn't take — dispatch a synthetic paste event.
      //    Most editors (Slate, Draft.js, plain contenteditable) handle
      //    paste events when the clipboard has the data.
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', convertedContent);
        const ev = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        });
        input.dispatchEvent(ev);
        fireInputEvent(input);
        flashBtn(card.querySelector('.mdit-insert'), '✅ Inserted!', '✏️ Insert');
      } catch {
        // Everything failed — user can paste manually
        flashBtn(card.querySelector('.mdit-insert'), '📋 Copied!', '✏️ Insert');
      }
    }).catch(() => {
      // Clipboard write denied — try execCommand anyway (data-less)
      try {
        document.execCommand('insertText', false, convertedContent);
        fireInputEvent(input);
        flashBtn(card.querySelector('.mdit-insert'), '✅ Inserted!', '✏️ Insert');
      } catch {
        flashBtn(card.querySelector('.mdit-insert'), '📋 Copied!', '✏️ Insert');
      }
    });
  }, 50);
}

function fireInputEvent(el) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  // Also dispatch 'change' for textareas that may listen on it
  if (el.tagName === 'TEXTAREA') {
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function fallbackToClipboard(card) {
  navigator.clipboard.writeText(convertedContent).then(() => {
    flashBtn(card.querySelector('.mdit-insert'), '📋 Copied!', '✏️ Insert');
  });
}

async function doSave(file, card) {
  if (!convertedContent) return;
  const mdName = file.name.replace(/\.[^.]+$/, '') + '.md';

  try {
    const res = await sendMessageWithRetry({
      type: 'DOWNLOAD_FILE',
      content: convertedContent,
      fileName: mdName,
    });
    if (res?.success) {
      flashBtn(card.querySelector('.mdit-save'), '✅ Saved!', '💾 Save .md');
    }
  } catch (err) {
    if (err.message?.includes('Extension context invalidated') || err.message?.includes('context invalidated')) {
      showContextError(card);
    } else {
      console.error('[LLM Friendly] Save failed:', err);
      flashBtn(card.querySelector('.mdit-save'), '❌ Failed', '💾 Save .md');
    }
  }
}

function flashBtn(btn, tempText, origText) {
  if (!btn) return;
  btn.textContent = tempText;
  setTimeout(() => { btn.textContent = origText; }, 2000);
}

function showContextError(card) {
  const errEl = card.querySelector('.mdit-error');
  if (!errEl) return;

  hide(card.querySelector('.mdit-result'));
  show(errEl, 'flex');

  const msg = errEl.querySelector('.mdit-err-msg');
  msg.innerHTML = `
    ⚠️ Extension was reloaded.<br>
    <small style="font-size:11px;opacity:0.8;">Please refresh this page or copy the markdown above.</small>
  `;
}

function removeOverlay() {
  const root = document.getElementById('mditdown-root');
  if (root) {
    if (root.dataset.hideTimer) {
      clearTimeout(Number(root.dataset.hideTimer));
      delete root.dataset.hideTimer;
    }
    root.remove();
  }
  convertedContent = null;
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Send a message to the background service worker with automatic retry
 * on service worker restart / context invalidation.
 */
async function sendMessageWithRetry(message, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await browser.runtime.sendMessage(message);
    } catch (err) {
      lastError = err;
      const msg = err.message || '';
      // Only retry on transient service-worker-related failures
      if (
        msg.includes('Extension context invalidated') ||
        msg.includes('context invalidated') ||
        msg.includes('Could not establish connection') ||
        msg.includes('Receiving end does not exist')
      ) {
        console.warn(`[LLM Friendly] sendMessage attempt ${attempt}/${maxAttempts} failed (SW restart):`, msg);
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, 500 * attempt));
          continue;
        }
      }
      // Non-retryable or last attempt — throw
      throw err;
    }
  }
  throw lastError;
}

/**
 * Keep a persistent port open to the service worker so Chrome won't
 * terminate it during idle periods. Automatically reconnects when
 * the SW restarts.
 */
function keepSwAlive() {
  let reconnectTimer = null;

  function connect() {
    try {
      const port = browser.runtime.connect({ name: 'cs-keepalive' });
      port.onDisconnect.addListener(() => {
        // SW terminated or restarted — reconnect after a short delay
        reconnectTimer = setTimeout(connect, 500);
      });
    } catch {
      // Extension context not ready yet — retry shortly
      reconnectTimer = setTimeout(connect, 1000);
    }
  }

  connect();
}

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const FILE_LABELS = {
  pdf: 'PDF Document', docx: 'Word Document', doc: 'Word Document',
  xlsx: 'Excel Spreadsheet', xls: 'Excel Spreadsheet', csv: 'CSV File',
  pptx: 'PowerPoint', ppt: 'PowerPoint', html: 'HTML File', htm: 'HTML File',
  txt: 'Text File', json: 'JSON File',
};

function fileLabel(name) {
  const ext = name.toLowerCase().split('.').pop();
  return FILE_LABELS[ext] || ext.toUpperCase() + ' File';
}

async function getSettings() {
  // Use sendMessageWithRetry instead of callback pattern — the callback form
  // silently hangs in MV3 if the service worker needs to start up.
  try {
    return await sendMessageWithRetry({ type: 'GET_SETTINGS' });
  } catch {
    console.warn('[LLM Friendly] Failed to get settings from SW, using defaults');
    return {};
  }
}

// Handle INSERT_TEXT messages from the popup
browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'INSERT_TEXT' && message.text) {
    const hostname = location.hostname;
    const selector = SITE_INPUT_SELECTORS[hostname] || '[contenteditable="true"], textarea';
    const input = document.querySelector(selector);
    if (!input) {
      navigator.clipboard.writeText(message.text);
      return;
    }
    if (input.tagName === 'TEXTAREA') {
      const s = input.selectionStart || input.value.length;
      input.value = input.value.slice(0, s) + message.text + input.value.slice(input.selectionEnd || s);
      input.selectionStart = input.selectionEnd = s + message.text.length;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      input.focus();
      document.execCommand('insertText', false, message.text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
});

init();