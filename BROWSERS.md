# Cross-Browser Compatibility

This extension works identically on **Chrome**, **Firefox**, and **Safari** using a unified codebase.

## Architecture

### Polyfill Layer
- Uses `browser.*` API namespace (WebExtensions standard)
- Chrome compatibility via lightweight polyfill in `src/polyfill.js`
- Firefox and Safari support `browser.*` natively

### Build System
- **Webpack** builds separate distributions for each browser
- Chrome: `dist/` (manifest without Firefox-specific fields)
- Firefox: `dist-firefox/` (manifest with `browser_specific_settings`)
- Safari: Convert `dist/` using Xcode tools

### Manifest Differences
- **Chrome/Edge/Brave:** Standard Manifest V3, no additional fields
- **Firefox:** Includes `browser_specific_settings.gecko` with extension ID and min version
- **Safari:** Converted automatically by Xcode, uses same source as Chrome

## Browser-Specific Features

### File System Access API (Folder Picker)
The "Browse" button in settings uses the File System Access API:
- ✅ **Chrome/Edge/Brave:** Fully supported
- ❌ **Firefox:** Not supported (manual path entry only)
- ⚠️ **Safari:** Limited support (requires user gesture)

Fallback: Manual folder path input works on all browsers.

### Content Script Injection
Dynamic content script registration for custom websites:
- ✅ **Chrome/Edge/Brave:** `chrome.scripting.registerContentScripts()` (MV3)
- ✅ **Firefox:** `browser.scripting.registerContentScripts()` (Firefox 109+)
- ✅ **Safari:** Same API with polyfill

### Background Service Worker
- **Chrome/Edge/Brave:** Service worker (MV3 standard)
- **Firefox:** Service worker (Firefox 109+ with MV3 support)
- **Safari:** Service worker with app wrapper

## Build Process

### Chrome/Chromium Browsers
```bash
npm run build:chrome
# Output: dist/
# Package: npm run package:chrome → markitdown-chrome.zip
```

### Firefox
```bash
npm run build:firefox
# Output: dist-firefox/
# Package: npm run package:firefox → markitdown-firefox.xpi
```

### Safari (macOS only)
```bash
npm run build:chrome  # Use Chrome build as base
xcrun safari-web-extension-converter dist \
  --app-name "MarkItDown Converter" \
  --bundle-identifier com.markitdown.converter \
  --macos-only
```

Then open the generated Xcode project and build.

## Testing

### Chrome/Edge/Brave
1. Build: `npm run build:chrome`
2. Open `chrome://extensions` (or `edge://extensions`)
3. Enable Developer mode
4. Load unpacked → select `dist/`

### Firefox
1. Build: `npm run build:firefox`
2. Open `about:debugging#/runtime/this-firefox`
3. Load Temporary Add-on → select `dist-firefox/manifest.json`

**Note:** Temporary add-ons in Firefox are removed on browser restart.

### Safari
1. Convert using `xcrun safari-web-extension-converter`
2. Open generated `.xcodeproj`
3. Build and run in Xcode
4. Enable in Safari → Preferences → Extensions

## Distribution

### Chrome Web Store
- Package: `markitdown-chrome.zip`
- Submit to: https://chrome.google.com/webstore/devconsole
- Works for Chrome, Edge, Brave, and other Chromium browsers

### Firefox Add-ons
- Package: `markitdown-firefox.xpi`
- Submit to: https://addons.mozilla.org/developers/
- Mozilla review required (typically 1-3 days)

### Safari App Store
- Requires Apple Developer account ($99/year)
- Must sign with Developer certificate
- Submit via App Store Connect
- Apple review required (typically 2-5 days)

## Known Limitations

### Firefox
- **File System Access API not supported:** Folder picker button hidden, manual path input only
- **Temporary add-ons removed on restart:** Users must reload or install signed .xpi

### Safari
- **Requires Xcode for development:** Can't test without macOS and Xcode 13+
- **App wrapper overhead:** Extension bundled in native macOS app (~1MB larger)
- **Signing required for distribution:** Must be enrolled in Apple Developer Program

### All Browsers
- **Download folder restrictions:** Can only save to Downloads folder + subfolder (browser security)
- **Content Security Policy:** Some chat sites may block extension scripts (rare)

## Permissions

All three browsers require the same permissions:

| Permission | Purpose | Privacy Impact |
|------------|---------|----------------|
| `storage` | Save settings and conversion history | Local only, never synced |
| `downloads` | Save converted .md files | No data leaves browser |
| `activeTab` | Get current tab URL for site detection | Only when user clicks extension |
| `tabs` | Send settings updates to open tabs | No browsing history access |
| `scripting` | Register content scripts on custom sites | Only on user-configured sites |

**No host permissions:** Extension only runs on preset chat sites + user-configured custom sites.

## Development Tips

### Watch Mode
```bash
npm run dev          # Chrome (default)
npm run dev:firefox  # Firefox
```

Rebuilds on file changes. Reload extension in browser after rebuild.

### Debugging
- **Chrome/Edge/Brave:** Right-click extension icon → Inspect popup / Inspect views: background page
- **Firefox:** about:debugging → This Firefox → Inspect → Console
- **Safari:** Safari → Develop → Web Extension Background Pages / Content → Show Console

### Testing Across Browsers
1. Build all versions: `npm run build`
2. Load `dist/` in Chrome
3. Load `dist-firefox/` in Firefox
4. Convert and load in Safari (if Xcode available)
5. Test same file conversion on all three to verify identical output

## Source Code Notes

### Using browser.* API
All source files use `browser.*` instead of `chrome.*`:

```javascript
// ✅ Correct (works everywhere)
browser.runtime.sendMessage(...)
browser.storage.local.get(...)

// ❌ Wrong (Chrome-only)
chrome.runtime.sendMessage(...)
chrome.storage.local.get(...)
```

The polyfill in `src/polyfill.js` maps `browser` to `chrome` on Chromium browsers automatically.

### Import Order
Every entry point (`background.js`, `content.js`, `popup.js`, `options.js`) imports the polyfill first:

```javascript
import '../polyfill.js';  // MUST be first
import { convertFile } from '../converters/index.js';
```

### Webpack Configuration
The webpack config (`webpack.config.js`) accepts a `--env browser=<name>` flag to control output:

```javascript
const browser = env.browser || 'chrome';
const outputDir = browser === 'chrome' ? 'dist' : `dist-${browser}`;
```

It also transforms `manifest.json` to remove Firefox-specific fields for Chrome builds.

## Future Enhancements

### Potential Improvements
- **Safari App Store submission:** Package ready for submission once Developer account is set up
- **Firefox AMO submission:** .xpi package ready for Mozilla review
- **Chrome Web Store submission:** .zip package ready for Google review
- **Automated testing:** Cross-browser tests using WebDriver
- **CI/CD pipeline:** Auto-build and package on git push

### API Upgrades
- **Declarative Net Request:** Replace `chrome.downloads` with more granular control
- **Service Worker improvements:** Better memory usage and lifecycle management
- **File System Access polyfill:** Add Firefox support via alternative APIs

## License & Attribution

This extension uses:
- **PDF.js** (Apache 2.0) - Mozilla
- **Mammoth.js** (BSD-2-Clause)
- **SheetJS** (Apache 2.0)
- **Turndown** (MIT)
- **pdfjs-dist** (Apache 2.0)

All libraries are compatible with Chrome Web Store, Firefox AMO, and Safari App Store policies.
