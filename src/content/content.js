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

async function init() {
  const settings = await getSettings();
  isEnabled = settings.enabled !== false;
  if (!isEnabled) return;

  watchFileInputs();
  setupDragDetection();
}

// ── File input detection ────────────────────────────────────────────

function watchFileInputs() {
  document.querySelectorAll('input[type="file"]').forEach(attachListener);

  new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.('input[type="file"]')) attachListener(node);
        node.querySelectorAll?.('input[type="file"]').forEach(attachListener);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

function attachListener(input) {
  if (attachedInputs.has(input)) return;
  attachedInputs.add(input);
  input.addEventListener('change', onFileInputChange);
}

async function onFileInputChange(e) {
  const file = e.target.files?.[0];
  if (!file || !isSupported(file.name)) return;
  showPrompt(file, e.target);
}

function setupDragDetection() {
  document.addEventListener('drop', e => {
    const file = e.dataTransfer?.files?.[0];
    if (!file || !isSupported(file.name)) return;
    // Give the page its drop event first
    setTimeout(() => showPromptFixed(file), 250);
  }, { capture: true, passive: true });
}

// ── Overlay ──────────────────────────────────────────────────────────

function showPrompt(file, anchor) {
  removeOverlay();
  const el = buildOverlay(file);
  document.body.appendChild(el);

  // Use fixed positioning so no overflow:hidden ancestor can clip us
  el.style.cssText = 'position:fixed!important;display:block!important;';
  const cardWidth = 280;
  const cardHeight = 120;
  const margin = 16;
  const rect = anchor?.getBoundingClientRect();
  let top, right;
  if (rect) {
    top = rect.bottom + 8;
    right = window.innerWidth - rect.right;
    // keep card within viewport
    if (top + cardHeight > window.innerHeight - margin) top = rect.top - cardHeight - 8;
    top = Math.max(margin, top);
    // ensure card left edge doesn't go off-screen: right <= innerWidth - cardWidth - margin
    right = Math.min(right, window.innerWidth - cardWidth - margin);
    right = Math.max(margin, right);
  } else {
    top = window.innerHeight - cardHeight - margin;
    right = margin;
  }
  el.style.top = `${top}px`;
  el.style.right = `${right}px`;
}

function showPromptFixed(file) {
  removeOverlay();
  const el = buildOverlay(file);
  el.style.cssText = 'position:fixed!important;display:block!important;bottom:16px;right:16px;';
  document.body.appendChild(el);
}

function buildOverlay(file) {
  const el = document.createElement('div');
  el.id = 'mditdown-root';

  el.innerHTML = `
    <div class="mdit-card">
      <div class="mdit-header">
        <span class="mdit-logo">M↓</span>
        <div class="mdit-title">
          <strong>MarkItDown Converter</strong>
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
  el.querySelector('.mdit-close').onclick = removeOverlay;
  el.querySelector('.mdit-skip').onclick = removeOverlay;
  el.querySelector('.mdit-convert').onclick = () => runConversion(file, card);
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

    await chrome.runtime.sendMessage({
      type: 'SAVE_CONVERTED',
      fileName: file.name.replace(/\.[^.]+$/, '') + '.md',
      sourceFileName: file.name,
      markdown: md,
      sourceUrl: location.href,
    });
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
  const res = await chrome.runtime.sendMessage({
    type: 'DOWNLOAD_FILE',
    content: convertedContent,
    fileName: mdName,
  });
  if (res?.success) {
    flashBtn(card.querySelector('.mdit-save'), '✅ Saved!', '💾 Save .md');
  }
}

function flashBtn(btn, tempText, origText) {
  if (!btn) return;
  btn.textContent = tempText;
  setTimeout(() => { btn.textContent = origText; }, 2000);
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
  txt: 'Text File', md: 'Markdown File', json: 'JSON File',
  png: 'PNG Image', jpg: 'JPEG Image', jpeg: 'JPEG Image',
  gif: 'GIF Image', webp: 'WebP Image', bmp: 'BMP Image',
};

function fileLabel(name) {
  const ext = name.toLowerCase().split('.').pop();
  return FILE_LABELS[ext] || ext.toUpperCase() + ' File';
}

async function getSettings() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, res => resolve(res || {}));
  });
}

// Handle INSERT_TEXT messages from the popup
chrome.runtime.onMessage.addListener((message) => {
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
