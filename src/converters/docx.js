import mammoth from 'mammoth';
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
});

// Preserve table formatting
turndown.keep(['table', 'thead', 'tbody', 'tr', 'td', 'th']);

export async function convertDOCX(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });

  const markdown = turndown.turndown(result.value);
  const title = file.name.replace(/\.[^.]+$/, '');

  const warnings = result.messages
    .filter(m => m.type === 'warning')
    .map(m => `> ⚠️ ${m.message}`)
    .join('\n');

  return `# ${title}\n\n${markdown}\n${warnings ? '\n---\n\n' + warnings + '\n' : ''}`;
}
