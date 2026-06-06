export async function convertText(file) {
  const ext = file.name.toLowerCase().split('.').pop();
  const title = file.name.replace(/\.[^.]+$/, '');
  const text = await file.text();

  // Already markdown — pass through
  if (ext === 'md' || ext === 'markdown') return text;

  if (ext === 'csv') return csvToMarkdown(text, title);

  return `# ${title}\n\n${text}\n`;
}

function csvToMarkdown(text, title) {
  const lines = text.trim().split('\n');
  if (lines.length === 0) return `# ${title}\n\n*Empty file*\n`;

  const rows = lines.map(parseCSVLine);
  const colCount = Math.max(...rows.map(r => r.length));
  const padded = rows.map(r => {
    const cells = [...r];
    while (cells.length < colCount) cells.push('');
    return cells.map(c => c.replace(/\|/g, '\\|'));
  });

  const header = `| ${padded[0].join(' | ')} |`;
  const divider = `| ${padded[0].map(() => '---').join(' | ')} |`;
  const body = padded.slice(1).map(row => `| ${row.join(' | ')} |`).join('\n');

  return `# ${title}\n\n${[header, divider, body].filter(Boolean).join('\n')}\n`;
}

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}
