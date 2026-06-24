import '../polyfill.js';
import Tesseract from 'tesseract.js';

/**
 * Offscreen document — handles OCR via Tesseract.js Web Worker.
 *
 * Production considerations:
 * - This document is ephemeral; it's created on demand and may be closed at any time
 * - All errors are caught and returned as structured responses
 * - Tesseract worker is created fresh per request (no leak across calls)
 */

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_OCR') {
    handleOCR(message)
      .then(result => sendResponse(result))
      .catch(err => {
        console.error('[LLM Friendly Offscreen] OCR error:', err);
        sendResponse({ error: err.message || 'Unknown OCR error' });
      });
    return true; // Keep channel open for async response
  }
  return false;
});

async function handleOCR({ dataUrl, fileName }) {
  const worker = await Tesseract.createWorker('eng', 1, {
    workerPath: browser.runtime.getURL('tesseract-worker.min.js'),
    corePath: browser.runtime.getURL('tesseract-core.wasm.js'),
    langPath: browser.runtime.getURL('traineddata/'),
    gzip: false,
    workerBlobURL: false,
    logger: m => {
      if (m.status === 'recognizing text') {
        console.debug(`[LLM Friendly Offscreen] OCR progress: ${Math.round(m.progress * 100)}%`);
      }
    },
  });

  try {
    const result = await worker.recognize(dataUrl);
    const title = fileName.replace(/\.[^.]+$/, '');
    return { markdown: `# ${title}\n\n${result.data.text}\n` };
  } finally {
    // Always terminate the worker, even on error
    try {
      await worker.terminate();
    } catch {
      // Worker may already be in a bad state; ignore
    }
  }
}
