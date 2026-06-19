import * as pdfjsLib from 'pdfjs-dist/build/pdf.js';

let workerConfigured = false;

function configurePdfWorker() {
  if (workerConfigured) return;

  // Reference the bundled worker file as an extension resource.
  // In Firefox content scripts, loading this as a Worker usually fails
  // due to security policies, which causes PDF.js to automatically
  // fall back to the 'fake worker' (main thread). We must set this
  // to avoid the "No workerSrc specified" error.
  pdfjsLib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL('pdf.worker.js');

  workerConfigured = true;
}

export async function convertPDF(file) {
  configurePdfWorker();

  const arrayBuffer = await file.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    disableFontFace: true,
    useSystemFonts: false,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
  });

  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  const title = file.name.replace(/\.pdf$/i, '');
  const parts = [`# ${title}\n\n`];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    let pageText = '';
    let lastY = null;
    let lastX = null;

    for (const item of textContent.items) {
      if (!('str' in item)) continue;
      const x = item.transform[4];
      const y = item.transform[5];

      if (lastY !== null && Math.abs(y - lastY) > 5) {
        // New line
        pageText += lastX !== null && x < lastX + 200 ? '\n\n' : '\n';
      } else if (lastX !== null && x > lastX + 10) {
        pageText += ' ';
      }

      pageText += item.str;
      lastY = y;
      lastX = x + (item.width || 0);
    }

    const trimmed = pageText.trim();
    if (trimmed) {
      parts.push(numPages > 1 ? `## Page ${pageNum}\n\n${trimmed}\n\n` : `${trimmed}\n\n`);
    }
  }

  return parts.join('');
}
