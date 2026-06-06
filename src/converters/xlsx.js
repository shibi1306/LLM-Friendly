import * as XLSX from 'xlsx';

export async function convertXLSX(file) {
  const ext = file.name.toLowerCase().split('.').pop();
  const arrayBuffer = await file.arrayBuffer();

  let workbook;
  if (ext === 'csv') {
    const text = new TextDecoder().decode(arrayBuffer);
    workbook = XLSX.read(text, { type: 'string' });
  } else {
    workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
  }

  const title = file.name.replace(/\.[^.]+$/, '');
  const parts = [`# ${title}\n\n`];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    const nonEmpty = rows.filter(row => row.some(cell => String(cell).trim() !== ''));
    if (nonEmpty.length === 0) continue;

    if (workbook.SheetNames.length > 1) {
      parts.push(`## ${sheetName}\n\n`);
    }

    parts.push(rowsToMarkdownTable(nonEmpty));
    parts.push('\n');
  }

  return parts.join('');
}

function rowsToMarkdownTable(rows) {
  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map(r => r.length));
  const padded = rows.map(r => {
    const cells = [...r];
    while (cells.length < colCount) cells.push('');
    return cells.map(c => String(c).replace(/\|/g, '\\|').replace(/\n/g, ' '));
  });

  const header = `| ${padded[0].join(' | ')} |`;
  const divider = `| ${padded[0].map(() => '---').join(' | ')} |`;
  const body = padded.slice(1).map(row => `| ${row.join(' | ')} |`).join('\n');

  return [header, divider, body].filter(Boolean).join('\n') + '\n';
}
