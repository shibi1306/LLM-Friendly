import '../polyfill.js';
import Tesseract from 'tesseract.js';

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_OCR') {
    handleOCR(message).then(sendResponse);
    return true;
  }
});

async function handleOCR({ dataUrl, fileName }) {
  try {
    const worker = await Tesseract.createWorker('eng', 1, {
      workerPath: browser.runtime.getURL('tesseract-worker.min.js'),
      corePath: browser.runtime.getURL('tesseract-core.wasm.js'),
      workerBlobURL: false,
      logger: m => console.log('[LLM Friendly Offscreen] OCR:', m),
    });

    const result = await worker.recognize(dataUrl);
    await worker.terminate();
    
    const title = fileName.replace(/\.[^.]+$/, '');
    return { markdown: `# ${title}\n\n${result.data.text}\n` };
  } catch (err) {
    console.error('[LLM Friendly Offscreen] OCR error:', err);
    return { error: err.message };
  }
}