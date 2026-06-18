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
  'poe.com': 'textarea[placeholder], [contenteditable="true"]',
  'chat.deepseek.com': 'textarea, [contenteditable="true"]',
  'aistudio.google.com': 'textarea, [contenteditable="true"]',
  'grok.com': 'textarea, [contenteditable="true"]',
  'x.com': 'textarea, [contenteditable="true"]',
  'huggingface.co': 'textarea, [contenteditable="true"]',
  'perplexity.ai': 'textarea, [contenteditable="true"]',
};

const attachedInputs = new WeakSet();
let convertedContent = null;
let isEnabled = true;
let currentSiteEnabled = true;
let mutationObserver = null;
let dragListenerAdded = false;

// Paste interception — store file+target so we can re-dispatch on skip
let pendingPasteFile = null;
let pendingPasteTarget = null;
let isRedispatchingPaste = false; // guard to prevent intercepting our own synthetic event

async function init() {
  console.log('[LLM Friendly] Initializing on', window.location.hostname);
  const settings = await getSettings();
  console.log('[LLM Friendly] Settings:', settings);

  isEnabled = settings.enabled !== false;
  if (!isEnabled) {
    console.log('[LLM Friendly] Extension globally disabled');
    return;
  }

  // Check if current site is enabled
  currentSiteEnabled = await isSiteEnabled(settings);
  console.log('[LLM Friendly] Site enabled:', currentSiteEnabled);
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
  isEnabled = settings.enabled !== false;
  const siteEnabled = await isSiteEnabled(settings);

  if (!isEnabled || !siteEnabled) {
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
  // Initial scan for existing file inputs
  const initialInputs = document.querySelectorAll('input[type="file"]');
  console.log(`[LLM Friendly] Found ${initialInputs.length} file inputs on page load`);
  initialInputs.forEach(attachListener);

  // Watch for new file inputs being added to DOM
  mutationObserver = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.('input[type="file"]')) {
          console.log('[LLM Friendly] Detected new file input:', node);
          attachListener(node);
        }
        const inputs = node.querySelectorAll?.('input[type="file"]');
        if (inputs && inputs.length > 0) {
          console.log(`[LLM Friendly] Detected ${inputs.length} file inputs in added node`);
          inputs.forEach(attachListener);
        }
      }
    }
  });
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  console.log('[LLM Friendly] MutationObserver started');
}

function attachListener(input) {
  if (attachedInputs.has(input)) return;
  attachedInputs.add(input);
  input.addEventListener('change', onFileInputChange);
  console.log('[LLM Friendly] Attached change listener to file input');
}

async function onFileInputChange(e) {
  console.log('[LLM Friendly] File input change event:', e.target.files?.[0]?.name);
  if (!isEnabled || !currentSiteEnabled) {
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
  console.log('[LLM Friendly] Showing prompt for file:', file.name);
  showPrompt(file, e.target);
}

function setupDragDetection() {
  if (dragListenerAdded) return;
  document.addEventListener('drop', e => {
    if (!isEnabled || !currentSiteEnabled) return;
    const file = e.dataTransfer?.files?.[0];
    if (!file || !isSupported(file.name)) return;
    console.log('[LLM Friendly] File dropped:', file.name);
    // Give the page its drop event first
    setTimeout(() => showPromptFixed(file), 250);
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
    if (!isEnabled || !currentSiteEnabled) return;

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

          // Show conversion prompt immediately
          showPromptFixed(file);
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

  // Get actual dimensions from the element since CSS may affect size
  // Force layout calculation
  el.style.visibility = 'hidden';
  const cardWidth = el.offsetWidth;
  const cardHeight = el.offsetHeight;
  el.style.visibility = 'visible';

  const rect = anchor?.getBoundingClientRect();
  let top, right;

  if (rect) {
    // Prefer placing below the anchor
    top = rect.bottom + 8;
    right = window.innerWidth - rect.right;

    // Check if it would go below viewport
    if (top + cardHeight > window.innerHeight - margin) {
      // Try placing above the anchor instead
      top = rect.top - cardHeight - 8;
      // If still doesn't fit, constrain to viewport
      if (top < margin) {
        top = margin;
        // If still too tall, allow overflow but cap at bottom
        if (top + cardHeight > window.innerHeight - margin) {
          // Let it overflow at the top rather than bottom (better UX)
          top = window.innerHeight - cardHeight - margin;
          if (top < margin) top = margin;
        }
      }
    }

    // Constrain horizontally
    // Minimum right (don't go off right edge)
    right = Math.max(margin, right);
    // Maximum right (don't go off left edge)
    right = Math.min(right, window.innerWidth - cardWidth - margin);
  } else {
    // Default to bottom-right if no anchor
    top = window.innerHeight - cardHeight - margin;
    right = margin;

    // Ensure within viewport
    top = Math.max(margin, top);
    top = Math.min(top, window.innerHeight - cardHeight - margin);
    right = Math.max(margin, right);
    right = Math.min(right, window.innerWidth - cardWidth - margin);
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

  // Get actual dimensions from the element since CSS may affect size
  // Force layout calculation
  const margin = 16;
  el.style.visibility = 'hidden';
  const cardWidth = el.offsetWidth;
  const cardHeight = el.offsetHeight;
  el.style.visibility = 'visible';

  // Default to bottom-right
  let top = window.innerHeight - cardHeight - margin;
  let right = margin;

  // Ensure within viewport
  top = Math.max(margin, top);
  top = Math.min(top, window.innerHeight - cardHeight - margin);
  right = Math.max(margin, right);
  right = Math.min(right, window.innerWidth - cardWidth - margin);

  el.style.top = `${top}px`;
  el.style.right = `${right}px`;
}

function buildOverlay(file) {
  const el = document.createElement('div');
  el.id = 'mditdown-root';

  el.innerHTML = `
    <div class="mdit-card">
      <div class="mdit-header">
        <span class="mdit-logo">M↓</span>
        <div class="mdit-title">
          <strong>LLM Friendly</strong>
          <span class="mdit-fname" title="${esc(file.name)}">${esc(file.name)}</span>
        </div>
        <button class="mdit-close" aria-label="Close">✕</button>
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

  // Close button — allow the original paste through, then remove overlay
  el.querySelector('.mdit-close').onclick = () => {
    allowOriginalPaste();
    removeOverlay();
  };

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
      await browser.runtime.sendMessage({
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
  const input = document.querySelector(selector);

  if (!input) {
    navigator.clipboard.writeText(convertedContent);
    flashBtn(card.querySelector('.mdit-insert'), '📋 Copied!', '✏️ Insert');
    return;
  }

  if (input.tagName === 'TEXTAREA') {
    const s = input.selectionStart;
    input.value = input.value.slice(0, s) + convertedContent + input.value.slice(input.selectionEnd);
    input.selectionStart = input.selectionEnd = s + convertedContent.length;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    input.focus();
    const sel = window.getSelection();
    if (sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(convertedContent);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      document.execCommand('insertText', false, convertedContent);
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  flashBtn(card.querySelector('.mdit-insert'), '✅ Inserted!', '✏️ Insert');
}

async function doSave(file, card) {
  if (!convertedContent) return;
  const mdName = file.name.replace(/\.[^.]+$/, '') + '.md';

  try {
    const res = await browser.runtime.sendMessage({
      type: 'DOWNLOAD_FILE',
      content: convertedContent,
      fileName: mdName,
    });
    if (res?.success) {
      flashBtn(card.querySelector('.mdit-save'), '✅ Saved!', '💾 Save .md');
    }
  } catch (err) {
    if (err.message?.includes('Extension context invalidated')) {
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
  document.getElementById('mditdown-root')?.remove();
  convertedContent = null;
}

// ── Helpers ────────────────────────────────────────────────────────

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
  return new Promise(resolve => {
    browser.runtime.sendMessage({ type: 'GET_SETTINGS' }, res => resolve(res || {}));
  });
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