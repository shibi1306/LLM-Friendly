# MarkItDown Browser Extension

A **Chrome and Firefox** extension that converts PDF, DOCX, XLSX, PPTX, images and more to Markdown — entirely in your browser, no server required.

Works on ChatGPT, Claude, Gemini, Copilot, Mistral, Poe, DeepSeek, Grok, Perplexity, HuggingFace Chat, and more.

---

## Features

- **Automatic detection** — watches for file attachment inputs on supported chat sites
- **Conversion prompt** — shows a non-intrusive overlay asking if you want to convert
- **Insert into chat** — injects the converted Markdown directly into the chat input
- **Save to folder** — downloads `.md` files to a configurable subfolder in your Downloads directory
- **Conversion history** — quickly re-copy or re-insert any previously converted file from the popup
- **Quick Convert in popup** — convert any file without visiting a chat site via drag-and-drop
- **Works offline** — all conversion happens locally, no data leaves your browser

## Supported Formats

| Format | How it's converted |
|---|---|
| PDF | Text extraction via PDF.js |
| DOCX / DOC | HTML extraction via Mammoth.js → Markdown |
| XLSX / XLS | Tables via SheetJS → Markdown tables |
| CSV | Parsed to Markdown table |
| PPTX / PPT | Slide text extraction |
| HTML / HTM | Cleaned HTML → Markdown via Turndown |
| TXT / MD | Pass-through |
| JSON | Pretty-printed fenced code block |
| PNG, JPG, JPEG, GIF, WebP, BMP | Base64 embedded image reference |

---

## Installation

### Prerequisites

- Node.js 18+ and npm

### Build

```bash
cd extension
npm install
npm run build
```

The built extension will be in the `dist/` folder.

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/dist/` folder

### Load in Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select any file inside `extension/dist/` (e.g. `manifest.json`)

### Development (watch mode)

```bash
npm run dev
```

Changes rebuild automatically. Reload the extension in the browser after each rebuild.

---

## Usage

### On a chat site (ChatGPT, Claude, etc.)

1. Click the paperclip / file attachment button as usual
2. Select a supported file — the **MarkItDown banner** appears
3. Click **⚡ Convert** — conversion runs locally in your browser
4. Choose an action:
   - **📋 Copy** — copy the Markdown to clipboard
   - **✏️ Insert** — inject Markdown directly into the chat input
   - **💾 Save .md** — download the file to your configured folder

### From the popup (any page)

1. Click the **M↓** icon in your browser toolbar
2. Drag-and-drop a file or click **browse**
3. Use **Copy**, **Save**, or **Insert** buttons
4. Past conversions appear in the **History** section

### Settings

Click **⚙️** in the popup (or right-click the extension icon → Options):

- **Save Location** — set the subfolder name within your Downloads folder (default: `MarkItDown`)
- **Enabled Sites** — toggle which chat sites show the conversion prompt
- **Auto-convert** — skip the prompt and convert automatically
- **Clear History** — remove all stored conversions

---

## Project Structure

```
extension/
├── manifest.json          # Extension manifest (MV3, Chrome + Firefox)
├── package.json
├── webpack.config.js
├── scripts/
│   └── generate-icons.js  # Icon generator
├── icons/                 # Extension icons (16, 48, 128 px)
├── src/
│   ├── background/
│   │   └── background.js  # Service worker: storage, downloads, settings
│   ├── content/
│   │   ├── content.js     # File detection + conversion overlay
│   │   └── content.css    # Overlay styles
│   ├── converters/
│   │   ├── index.js       # Dispatcher + image/JSON converters
│   │   ├── pdf.js         # PDF via pdf.js
│   │   ├── docx.js        # DOCX via mammoth + turndown
│   │   ├── xlsx.js        # XLSX/CSV via SheetJS
│   │   ├── html.js        # HTML via turndown
│   │   ├── pptx.js        # PPTX via fflate + XML parsing
│   │   └── text.js        # TXT/CSV/MD pass-through
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   └── options/
│       ├── options.html
│       ├── options.js
│       └── options.css
└── dist/                  # Built output (load this folder as extension)
```

---

## Chrome Web Store Publishing

1. Run `npm run build`
2. Zip the `dist/` folder: `cd dist && zip -r ../markitdown-converter.zip .`
3. Upload to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)

> **Note**: Replace the SVG placeholder icons with proper PNGs before publishing.  
> Install `npm install canvas` and re-run `npm run icons` to generate real PNGs.

## Firefox Add-ons (AMO)

Same zip, upload to [addons.mozilla.org](https://addons.mozilla.org/developers/).

---

## Privacy

- All file conversion happens **100% locally** in your browser
- Converted Markdown is stored only in `chrome.storage.local` (your device only)
- No analytics, no telemetry, no network requests
- Files you convert are never sent anywhere
