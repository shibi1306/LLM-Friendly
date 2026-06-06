import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});

export async function convertHTML(file) {
  const text = await file.text();
  const title = file.name.replace(/\.[^.]+$/, '');

  // Strip <script> and <style> blocks before converting
  const cleaned = text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  const markdown = turndown.turndown(cleaned);
  return `# ${title}\n\n${markdown}\n`;
}
