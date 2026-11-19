type CsvCell = string | number | bigint | null | undefined;

export function csvDocument(rows: readonly (readonly CsvCell[])[]) {
  const escape = (cell: CsvCell) => {
    let value = String(cell ?? '');
    // Protect text exported from user fields when the document opens in a spreadsheet.
    if (typeof cell === 'string' && !/^-?\d+(?:[.,]\d+)?$/.test(value) && /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(value)) value = "'" + value;
    return '"' + value.replace(/"/g, '""') + '"';
  };
  return '\uFEFF' + rows.map(row => row.map(escape).join(';')).join('\r\n');
}

export function downloadCsv(filename: string, rows: readonly (readonly CsvCell[])[]) {
  const url = URL.createObjectURL(new Blob([csvDocument(rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/[\\/<>:"|?*\u0000-\u001f]/g, '-');
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
