import { unzipSync } from 'fflate';

export async function convertPPTX(file) {
  const arrayBuffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  let files;
  try {
    files = unzipSync(uint8);
  } catch (e) {
    throw new Error(`Invalid PPTX file: ${e.message}`);
  }

  const title = file.name.replace(/\.[^.]+$/, '');
  const parts = [`# ${title}\n\n`];

  // Find and sort slide XML files
  const slideEntries = Object.entries(files)
    .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(([a], [b]) => {
      return parseInt(a.match(/slide(\d+)/)[1]) - parseInt(b.match(/slide(\d+)/)[1]);
    });

  if (slideEntries.length === 0) {
    return `# ${title}\n\n*No slides found or unsupported PPTX format.*\n`;
  }

  for (let i = 0; i < slideEntries.length; i++) {
    const [, data] = slideEntries[i];
    const xml = new TextDecoder().decode(data);
    const text = extractSlideText(xml);
    if (text.trim()) {
      parts.push(`## Slide ${i + 1}\n\n${text}\n\n`);
    }
  }

  return parts.join('');
}

function extractSlideText(xml) {
  // Extract all text runs, preserving paragraph breaks
  const paragraphs = [];
  const paraRegex = /<a:p[\s>][\s\S]*?<\/a:p>/g;
  let paraMatch;

  while ((paraMatch = paraRegex.exec(xml)) !== null) {
    const paraXml = paraMatch[0];
    const texts = [];
    const runRegex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let runMatch;

    while ((runMatch = runRegex.exec(paraXml)) !== null) {
      const text = decodeXMLEntities(runMatch[1]).trim();
      if (text) texts.push(text);
    }

    if (texts.length > 0) {
      paragraphs.push(texts.join(''));
    }
  }

  return paragraphs.join('\n');
}

function decodeXMLEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d)));
}
