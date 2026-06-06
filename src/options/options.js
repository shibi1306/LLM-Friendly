import './options.css';

const SITES = [
  { key: 'chatgpt',     label: 'ChatGPT',      icon: '🤖' },
  { key: 'claude',      label: 'Claude',        icon: '🧠' },
  { key: 'gemini',      label: 'Gemini',        icon: '💎' },
  { key: 'copilot',     label: 'Copilot',       icon: '🪟' },
  { key: 'mistral',     label: 'Mistral',       icon: '🌊' },
  { key: 'poe',         label: 'Poe',           icon: '📖' },
  { key: 'deepseek',    label: 'DeepSeek',      icon: '🔍' },
  { key: 'grok',        label: 'Grok',          icon: '⚡' },
  { key: 'huggingface', label: 'HuggingFace',   icon: '🤗' },
  { key: 'perplexity',  label: 'Perplexity',    icon: '🔮' },
];

let settings = {};

document.addEventListener('DOMContentLoaded', async () => {
  settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });

  renderSiteGrid();
  loadUI();
  loadHistoryCount();

  document.getElementById('saveBtn').onclick = save;
  document.getElementById('clearHistoryBtn').onclick = clearHistory;
});

function renderSiteGrid() {
  const grid = document.getElementById('siteGrid');
  grid.innerHTML = SITES.map(site => `
    <label class="site-card" id="site-${site.key}">
      <span class="site-icon">${site.icon}</span>
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
  document.getElementById('subfolderInput').value = settings.outputSubfolder || 'MarkItDown';
  document.getElementById('chkEnabled').checked = settings.enabled !== false;
  document.getElementById('chkAutoConvert').checked = !!settings.autoConvert;
}

async function loadHistoryCount() {
  const history = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' }) || [];
  document.getElementById('historyCount').textContent =
    `${history.length} conversion${history.length !== 1 ? 's' : ''} stored locally`;
}

async function save() {
  const subfolder = document.getElementById('subfolderInput').value.trim() || 'MarkItDown';
  const enabled = document.getElementById('chkEnabled').checked;
  const autoConvert = document.getElementById('chkAutoConvert').checked;

  const enabledSites = {};
  document.querySelectorAll('input[data-site]').forEach(chk => {
    enabledSites[chk.dataset.site] = chk.checked;
  });

  const newSettings = { ...settings, outputSubfolder: subfolder, enabled, autoConvert, enabledSites };

  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: newSettings });
  settings = newSettings;

  const status = document.getElementById('saveStatus');
  status.textContent = '✅ Saved!';
  status.classList.add('visible');
  setTimeout(() => status.classList.remove('visible'), 2500);
}

async function clearHistory() {
  if (!confirm('Clear all conversion history? This cannot be undone.')) return;
  await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
  loadHistoryCount();
  const status = document.getElementById('saveStatus');
  status.textContent = '🗑️ History cleared';
  status.classList.add('visible');
  setTimeout(() => status.classList.remove('visible'), 2500);
}
