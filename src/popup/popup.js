import '../polyfill.js';
import { convertFile, isSupported, formatBytes } from '../converters/index.js';
import './popup.css';

let currentMd = null;
let currentFileName = null;

// ── Retry helper ────────────────────────────────────────────────────────

async function sendMessageWithRetry(message, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await browser.runtime.sendMessage(message);
    } catch (err) {
      lastError = err;
      const msg = err.message || '';
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
      throw err;
    }
  }
  throw lastError;
}

// ── Init ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  setupDropZone();
  setupFileInput();
  renderHistory();

  document.getElementById('optionsBtn').onclick = () => {
    browser.runtime.openOptionsPage();
  };

  document.getElementById('clearAllBtn').onclick = async () => {
    if (confirm('Clear all conversion history?')) {
      await sendMessageWithRetry({ type: 'CLEAR_HISTORY' });
      renderHistory();
    }
  };

  document.getElementById('qCopyBtn').onclick = () => copyMd();
  document.getElementById('qSaveBtn').onclick = () => saveMd();
  document.getElementById('qInsertBtn').onclick = () => insertMd();
});

// ── Drop zone ────────────────────────────────────────────────────────

function setupDropZone() {
  const zone = document.getElementById('dropZone');

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));

  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });
}

function setupFileInput() {
  document.getElementById('fileInput').addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  });
}

// ── File conversion ──────────────────────────────────────────────────

async function handleFile(file) {
  if (!isSupported(file.name)) {
    alert(`Unsupported file type: .${file.name.split('.').pop()}`);
    return;
  }

  currentMd = null;
  currentFileName = file.name.replace(/\.[^.]+$/, '') + '.md';

  document.getElementById('dropZone').style.display = 'none';
  document.getElementById('convResult').style.display = 'none';
  document.getElementById('convProgress').style.display = 'flex';
  document.getElementById('convFileName').textContent = `Converting ${file.name}…`;

  try {
    const md = await convertFile(file);
    currentMd = md;

    document.getElementById('convProgress').style.display = 'none';
    document.getElementById('convResult').style.display = 'block';
    document.getElementById('resultFile').textContent = currentFileName;

    // Save to history (best-effort)
    sendMessageWithRetry({
      type: 'SAVE_CONVERTED',
      fileName: currentFileName,
      sourceFileName: file.name,
      markdown: md,
      sourceUrl: 'popup',
    }).then(() => renderHistory()).catch(() => {});

    renderHistory();
  } catch (err) {
    document.getElementById('convProgress').style.display = 'none';
    document.getElementById('dropZone').style.display = 'block';
    alert(`Conversion failed: ${err.message}`);
  }
}

// ── Quick action buttons ──────────────────────────────────────────────

function copyMd() {
  if (!currentMd) return;
  navigator.clipboard.writeText(currentMd).then(() => {
    flash('qCopyBtn', '✅ Copied!', '📋 Copy');
  });
}

async function saveMd() {
  if (!currentMd || !currentFileName) return;
  try {
    await sendMessageWithRetry({
      type: 'DOWNLOAD_FILE',
      content: currentMd,
      fileName: currentFileName,
    });
    flash('qSaveBtn', '✅ Saved!', '💾 Save .md');
  } catch (err) {
    console.error('[LLM Friendly] Save failed:', err);
    flash('qSaveBtn', '❌ Failed', '💾 Save .md');
  }
}

async function insertMd() {
  if (!currentMd) return;
  // Get the active tab and send a message to insert
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await browser.tabs.sendMessage(tab.id, { type: 'INSERT_TEXT', text: currentMd });
    }
    flash('qInsertBtn', '✅ Sent!', '✏️ Insert');
  } catch (err) {
    // Content script may not be loaded on the current tab
    // Fall back to clipboard
    try {
      await navigator.clipboard.writeText(currentMd);
      flash('qInsertBtn', '📋 Copied!', '✏️ Insert');
    } catch {
      flash('qInsertBtn', '❌ Failed', '✏️ Insert');
    }
  }
}

// ── History rendering ──────────────────────────────────────────────────

async function renderHistory() {
  let history;
  try {
    history = await sendMessageWithRetry({ type: 'GET_HISTORY' }) || [];
  } catch {
    history = [];
  }

  const list = document.getElementById('historyList');
  const empty = document.getElementById('emptyState');

  // Remove old items (keep empty state)
  list.querySelectorAll('.hist-item').forEach(el => el.remove());

  if (history.length === 0) {
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';

  for (const item of history) {
    const el = buildHistItem(item);
    list.appendChild(el);
  }
}

function buildHistItem(item) {
  const el = document.createElement('div');
  el.className = 'hist-item';

  const date = new Date(item.timestamp);
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const domain = tryDomain(item.sourceUrl);

  el.innerHTML = `
    <div class="hist-top">
      <span class="hist-name" title="${esc(item.fileName)}">${esc(item.fileName)}</span>
      <button class="del-btn" title="Delete">✕</button>
    </div>
    <div class="hist-meta">
      <span>🌐 ${esc(domain)}</span>
      <span>📅 ${dateStr} ${timeStr}</span>
      <span>📝 ${item.wordCount?.toLocaleString() ?? '?'} words</span>
    </div>
    <div class="hist-actions">
      <button class="btn btn-xs btn-primary hist-copy">📋 Copy</button>
      <button class="btn btn-xs btn-secondary hist-save">💾 Save</button>
      <button class="btn btn-xs btn-secondary hist-insert">✏️ Insert</button>
    </div>
  `;

  el.querySelector('.del-btn').onclick = async () => {
    try {
      await sendMessageWithRetry({ type: 'DELETE_HISTORY_ITEM', id: item.id });
    } catch {
      // Silently fail — item will reappear on next renderHistory
    }
    el.remove();
    const remaining = document.querySelectorAll('.hist-item').length;
    if (remaining === 0) {
      document.getElementById('emptyState').style.display = 'block';
    }
  };

  el.querySelector('.hist-copy').onclick = async () => {
    await navigator.clipboard.writeText(item.markdown);
    flash2(el.querySelector('.hist-copy'), '✅ Copied!', '📋 Copy');
  };

  el.querySelector('.hist-save').onclick = async () => {
    try {
      await sendMessageWithRetry({
        type: 'DOWNLOAD_FILE',
        content: item.markdown,
        fileName: item.fileName,
      });
      flash2(el.querySelector('.hist-save'), '✅ Saved!', '💾 Save');
    } catch {
      flash2(el.querySelector('.hist-save'), '❌ Failed', '💾 Save');
    }
  };

  el.querySelector('.hist-insert').onclick = async () => {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await browser.tabs.sendMessage(tab.id, { type: 'INSERT_TEXT', text: item.markdown });
        flash2(el.querySelector('.hist-insert'), '✅ Sent!', '✏️ Insert');
      }
    } catch {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(item.markdown);
        flash2(el.querySelector('.hist-insert'), '📋 Copied!', '✏️ Insert');
      } catch {
        flash2(el.querySelector('.hist-insert'), '❌ Failed', '✏️ Insert');
      }
    }
  };

  return el;
}

// ── Helpers ───────────────────────────────────────────────────────────

function flash(id, temp, orig) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.textContent = temp;
  setTimeout(() => { btn.textContent = orig; }, 2000);
}

function flash2(btn, temp, orig) {
  btn.textContent = temp;
  setTimeout(() => { btn.textContent = orig; }, 2000);
}

function tryDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url || 'popup'; }
}

function esc(str = '') {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
