import '../polyfill.js';
import './options.css';

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

const SITES = [
  { key: 'chatgpt',     label: 'ChatGPT' },
  { key: 'claude',      label: 'Claude' },
  { key: 'copilot',     label: 'Copilot' },
  { key: 'poe',         label: 'Poe' },
  { key: 'deepseek',    label: 'DeepSeek' },
  { key: 'grok',        label: 'Grok' },
  { key: 'perplexity',  label: 'Perplexity' },
];

let settings = {};

document.addEventListener('DOMContentLoaded', async () => {
  settings = await sendMessageWithRetry({ type: 'GET_SETTINGS' });

  renderSiteGrid();
  renderCustomSites();
  loadUI();
  loadHistoryCount();

  document.getElementById('saveBtn').onclick = save;
  document.getElementById('clearHistoryBtn').onclick = clearHistory;
  document.getElementById('addSiteBtn').onclick = addCustomSite;
  document.getElementById('browseBtn').onclick = browseFolder;

  // Allow Enter key in custom URL input to add site
  document.getElementById('customUrlInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addCustomSite();
  });

  // History limit slider interaction
  const historyLimitSlider = document.getElementById('historyLimit');
  const historyLimitValue = document.getElementById('historyLimitValue');
  historyLimitSlider.addEventListener('input', () => {
    historyLimitValue.textContent = historyLimitSlider.value;
  });
});

function renderSiteGrid() {
  const grid = document.getElementById('siteGrid');
  grid.innerHTML = SITES.map(site => `
    <label class="site-card" id="site-${site.key}">
      <span class="site-name">${site.label}</span>
      <input type="checkbox" data-site="${site.key}">
    </label>
  `).join('');

  grid.querySelectorAll('input[data-site]').forEach(chk => {
    chk.checked = settings.enabledSites?.[chk.dataset.site] !== false;
    chk.addEventListener('change', () => {
      const card = chk.closest('.site-card');
      card.classList.toggle('inactive', !chk.checked);
    });
    if (!chk.checked) chk.closest('.site-card').classList.add('inactive');
  });
}

function loadUI() {
  document.getElementById('subfolderInput').value = settings.outputSubfolder || 'LLM Friendly';
  document.getElementById('chkAutoConvert').checked = !!settings.autoConvert;
  // History limit slider
  const historyLimit = settings.historyLimit ?? 50;
  document.getElementById('historyLimit').value = historyLimit;
  document.getElementById('historyLimitValue').textContent = historyLimit;
}

async function loadHistoryCount() {
  const history = await sendMessageWithRetry({ type: 'GET_HISTORY' }) || [];
  document.getElementById('historyCount').textContent =
    `${history.length} conversion${history.length !== 1 ? 's' : ''} stored locally`;
}

async function save() {
  const subfolder = document.getElementById('subfolderInput').value.trim() || 'LLM Friendly';
  const autoConvert = document.getElementById('chkAutoConvert').checked;
  const historyLimit = parseInt(document.getElementById('historyLimit').value, 10);

  const enabledSites = {};
  document.querySelectorAll('input[data-site]').forEach(chk => {
    enabledSites[chk.dataset.site] = chk.checked;
  });

  const newSettings = {
    ...settings,
    outputSubfolder: subfolder,
    autoConvert,
    enabledSites,
    customSites: settings.customSites || [],
    historyLimit
  };

  await sendMessageWithRetry({ type: 'SAVE_SETTINGS', settings: newSettings });
  settings = newSettings;

  const status = document.getElementById('saveStatus');
  status.textContent = '✅ Saved!';
  status.style.color = '#059669';
  status.classList.add('visible');
  setTimeout(() => status.classList.remove('visible'), 2500);

  // Show reload reminder if custom sites changed
  if (settings.customSites && settings.customSites.length > 0) {
    setTimeout(() => {
      status.textContent = '🔄 Reload extension to apply custom sites';
      status.style.color = '#f59e0b';
      status.classList.add('visible');
      setTimeout(() => status.classList.remove('visible'), 4000);
    }, 2600);
  }
}

async function clearHistory() {
  if (!confirm('Clear all conversion history? This cannot be undone.')) return;
  await sendMessageWithRetry({ type: 'CLEAR_HISTORY' });
  loadHistoryCount();
  const status = document.getElementById('saveStatus');
  status.textContent = '🗑️ History cleared';
  status.classList.add('visible');
  setTimeout(() => status.classList.remove('visible'), 2500);
}

function renderCustomSites() {
  const list = document.getElementById('customSiteList');
  const customSites = settings.customSites || [];

  if (customSites.length === 0) {
    list.innerHTML = '<p class="desc-small" style="margin: 8px 0; font-style: italic;">No custom sites added yet.</p>';
    return;
  }

  list.innerHTML = customSites.map((url, idx) => `
    <div class="custom-site-item">
      <span class="custom-site-url" title="${url}">${url}</span>
      <button class="btn-remove" data-idx="${idx}" title="Remove">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.btn-remove').forEach(btn => {
    btn.onclick = () => removeCustomSite(parseInt(btn.dataset.idx));
  });
}

function addCustomSite() {
  const input = document.getElementById('customUrlInput');
  let url = input.value.trim();

  if (!url) return;

  // Basic validation
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    alert('URL must start with http:// or https://');
    return;
  }

  // Add wildcard if not present
  if (!url.includes('*') && !url.endsWith('/')) {
    url += '/*';
  } else if (!url.includes('*')) {
    url += '*';
  }

  if (!settings.customSites) settings.customSites = [];

  if (settings.customSites.includes(url)) {
    alert('This site is already in your list.');
    return;
  }

  settings.customSites.push(url);
  input.value = '';
  renderCustomSites();

  // Show save reminder
  const status = document.getElementById('saveStatus');
  status.textContent = '⚠️ Don\'t forget to save!';
  status.style.color = '#f59e0b';
  status.classList.add('visible');
  setTimeout(() => status.classList.remove('visible'), 3000);
}

function removeCustomSite(idx) {
  if (!settings.customSites) return;
  settings.customSites.splice(idx, 1);
  renderCustomSites();

  const status = document.getElementById('saveStatus');
  status.textContent = '⚠️ Don\'t forget to save!';
  status.style.color = '#f59e0b';
  status.classList.add('visible');
  setTimeout(() => status.classList.remove('visible'), 3000);
}

async function browseFolder() {
  try {
    // Use the File System Access API to pick a directory
    const dirHandle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'downloads'
    });

    // Show the selected folder name
    document.getElementById('subfolderInput').value = dirHandle.name;

    const status = document.getElementById('saveStatus');
    status.textContent = `📂 Selected: ${dirHandle.name}`;
    status.style.color = '#059669';
    status.classList.add('visible');
    setTimeout(() => status.classList.remove('visible'), 2500);
  } catch (err) {
    // User cancelled or browser doesn't support the API
    if (err.name !== 'AbortError') {
      alert('Folder picker is not supported in this browser. Please type the folder name manually.');
    }
  }
}
