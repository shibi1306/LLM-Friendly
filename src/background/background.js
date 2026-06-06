// Lightweight background service worker — storage, downloads, settings
const HISTORY_KEY = 'conversion_history';
const SETTINGS_KEY = 'settings';
const MAX_HISTORY = 100;

const DEFAULT_SETTINGS = {
  outputSubfolder: 'MarkItDown',
  enabledSites: {
    chatgpt: true, claude: true, gemini: true, copilot: true,
    mistral: true, poe: true, deepseek: true, grok: true,
    huggingface: true, perplexity: true,
  },
  autoConvert: false,
  enabled: true,
  customSites: [],
};

// Load custom sites on extension startup
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  if (settings.customSites && settings.customSites.length > 0) {
    await registerCustomSites(settings.customSites);
  }
});

// Also load on startup (when browser starts)
chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  if (settings.customSites && settings.customSites.length > 0) {
    await registerCustomSites(settings.customSites);
  }
});

async function registerCustomSites(customSites) {
  try {
    // Unregister old custom scripts
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const customScriptIds = registered.filter(s => s.id.startsWith('custom-site-')).map(s => s.id);
    if (customScriptIds.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: customScriptIds });
    }
    
    // Register new custom scripts
    const scripts = customSites.map((url, idx) => ({
      id: `custom-site-${idx}`,
      matches: [url],
      js: ['content.js'],
      css: ['content.css'],
      runAt: 'document_idle',
    }));
    
    await chrome.scripting.registerContentScripts(scripts);
  } catch (err) {
    console.error('Failed to register custom site scripts:', err);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
  }
});

async function handleSaveConverted({ fileName, markdown, sourceUrl, sourceFileName }) {
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
  if (history.length > MAX_HISTORY) history.splice(MAX_HISTORY);
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
  return { success: true, id: item.id };
}

async function getHistory() {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  return data[HISTORY_KEY] || [];
}

async function clearHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
  return { success: true };
}

async function deleteHistoryItem(id) {
  const history = await getHistory();
  await chrome.storage.local.set({
    [HISTORY_KEY]: history.filter(item => item.id !== id),
  });
  return { success: true };
}

async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  
  // Register/unregister content scripts for custom sites
  if (settings.customSites && settings.customSites.length > 0) {
    await registerCustomSites(settings.customSites);
  } else {
    // Clear all custom site scripts if none defined
    try {
      const registered = await chrome.scripting.getRegisteredContentScripts();
      const customScriptIds = registered.filter(s => s.id.startsWith('custom-site-')).map(s => s.id);
      if (customScriptIds.length > 0) {
        await chrome.scripting.unregisterContentScripts({ ids: customScriptIds });
      }
    } catch (err) {
      console.error('Failed to unregister custom site scripts:', err);
    }
  }
  
  // Notify all tabs about settings update
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'SETTINGS_UPDATED',
        settings: settings
      }).catch(() => {
        // Ignore errors for tabs without content script
      });
    }
  } catch (err) {
    console.error('Failed to notify tabs:', err);
  }
  
  return { success: true };
}

async function downloadFile({ content, fileName, subfolder }) {
  const settings = await getSettings();
  const folder = subfolder || settings.outputSubfolder || 'MarkItDown';
  const safeName = fileName.replace(/[<>:"/\\|?*]/g, '_');

  // Use data URL since Blob/URL.createObjectURL not available in service worker
  const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(content);

  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename: `${folder}/${safeName}`,
    saveAs: false,
    conflictAction: 'uniquify',
  });

  return { success: true, downloadId };
}
