import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

// For Firefox: disable worker globally before any usage
if (typeof InstallTrigger !== 'undefined' || navigator.userAgent.includes('Firefox')) {
  // Setting to false disables worker in Firefox
  pdfjsLib.GlobalWorkerOptions.workerSrc = false;
}

let workerConfigured = false;

function configurePdfWorker() {
  if (workerConfigured) return;
  
  // Detect Firefox
  const isFirefox = typeof InstallTrigger !== 'undefined' || 
                    navigator.userAgent.includes('Firefox');
  
  if (!isFirefox) {
    // Chrome/Safari: use the bundled worker for better performance
    pdfjsLib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL('pdf.worker.js');
  }
  // Firefox: already set to false above (no worker)
  
  workerConfigured = true;
}

export async function convertPDF(file) {
  configurePdfWorker();

  const arrayBuffer = await file.arrayBuffer();
  
  // Detect Firefox
  const isFirefox = typeof InstallTrigger !== 'undefined' || 
                    navigator.userAgent.includes('Firefox');
  
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    disableFontFace: true,
    useSystemFonts: false,
    // Explicitly disable worker for Firefox
    ...(isFirefox && { useWorkerFetch: false, isEvalSupported: false }),
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
