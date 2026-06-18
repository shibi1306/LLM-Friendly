export async function convertImage(file) {
  // Convert file to a base64 Data URL to safely send across the extension message boundary
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });

  // In Chrome MV3, we cannot use Paddle.js locally because it requires 'unsafe-eval'
  // (via new Function for tensor math/loops), which is strictly forbidden.
  // Instead, we delegate all OCR to the background service worker using Tesseract.js.
  try {
    const response = await browser.runtime.sendMessage({
      type: 'CONVERT_IMAGE_BACKGROUND',
      dataUrl: dataUrl,
      fileName: file.name
    });

    if (response && response.markdown) {
      return response.markdown;
    }

    if (response && response.error) {
      throw new Error(response.error);
    }

    throw new Error('Empty response from background OCR');
  } catch (err) {
    console.error('[LLM Friendly] Background OCR failed:', err);
    let message = `OCR failed: ${err.message}`;
    if (err.message.includes('Extension context invalidated')) {
      message = 'OCR failed: Extension context was invalidated. Please try again or reload the page if the problem persists.';
    }
    throw new Error(message);
  }
}
