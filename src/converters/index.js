import { convertPDF } from './pdf.js';
import { convertDOCX } from './docx.js';
import { convertXLSX } from './xlsx.js';
import { convertHTML } from './html.js';
import { convertPPTX } from './pptx.js';
import { convertText } from './text.js';
import { convertImage } from './image.js';

const SUPPORTED_EXTENSIONS = [
  'pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv',
  'pptx', 'ppt', 'html', 'htm', 'txt', 'md',
  'markdown', 'json', 'png', 'jpg', 'jpeg', 'gif',
  'webp', 'bmp',
];

export function isSupported(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

export function getSupportedExtensions() {
  return SUPPORTED_EXTENSIONS;
}

export async function convertFile(file) {
  const ext = file.name.toLowerCase().split('.').pop();
  switch (ext) {
    case 'pdf':
      return convertPDF(file);
    case 'docx':
    case 'doc':
      return convertDOCX(file);
    case 'xlsx':
    case 'xls':
    case 'csv':
      return convertXLSX(file);
    case 'pptx':
    case 'ppt':
      return convertPPTX(file);
    case 'html':
    case 'htm':
      return convertHTML(file);
    case 'json':
      return convertJSON(file);
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'bmp':
      return convertImage(file);
    default:
      return convertText(file);
  }
}

async function convertJSON(file) {
  const text = await file.text();
  const title = file.name.replace(/\.[^.]+$/, '');
  try {
    const formatted = JSON.stringify(JSON.parse(text), null, 2);
    return `# ${title}\n\n\`\`\`json\n${formatted}\n\`\`\`\n`;
  } catch {
    return `# ${title}\n\n\`\`\`\n${text}\n\`\`\`\n`;
  }
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
