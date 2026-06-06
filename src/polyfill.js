// Cross-browser compatibility
// Makes browser.* API available as browser.* for Firefox/Safari
if (typeof browser === 'undefined' && typeof chrome !== 'undefined') {
  globalThis.browser = chrome;
}
