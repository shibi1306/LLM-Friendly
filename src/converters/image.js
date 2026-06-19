/**
 * Image OCR conversion — delegates to the background service worker
 * which runs Tesseract.js in an offscreen document.
 *
 * Production considerations:
 * - Retries on "context invalidated" (service worker restart)
 * - Handles timeouts gracefully
 * - Provides clear error messages
 */

export async function convertImage(file) {
  // Convert file to a base64 Data URL to safely cross extension message boundaries
  const dataUrl = await readFileAsDataURL(file);

  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await withTimeout(
        browser.runtime.sendMessage({
          type: 'CONVERT_IMAGE_BACKGROUND',
          dataUrl,
          fileName: file.name,
        }),
        120000 // 2-minute timeout for OCR
      );

      if (response?.markdown) {
        return response.markdown;
      }

      if (response?.error) {
        throw new Error(response.error);
      }

      throw new Error('Empty response from background OCR');
    } catch (err) {
      lastError = err;
      const msg = err.message || '';

      if (msg.includes('Extension context invalidated') || msg.includes('context invalidated')) {
        console.warn(`[LLM Friendly] OCR attempt ${attempt}/3: service worker restarted, retrying...`);
        // Wait for the service worker to be fully ready
        await sleep(1000 * attempt);
        continue;
      }

      if (msg.includes('Could not establish connection') || msg.includes('Receiving end does not exist')) {
        console.warn(`[LLM Friendly] OCR attempt ${attempt}/3: connection issue, retrying...`);
        await sleep(500 * attempt);
        continue;
      }

      // Non-retryable error — bail immediately
      throw err;
    }
  }

  // All retries exhausted
  const message = lastError?.message || 'Unknown error';
  if (message.includes('Extension context invalidated')) {
    throw new Error(
      'OCR failed because the extension was reloaded. Please refresh the page and try again.'
    );
  }
  throw new Error(`OCR failed: ${message}`);
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
