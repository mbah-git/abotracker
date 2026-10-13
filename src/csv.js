// CSV fuer Excel (Schweiz): Strichpunkt als Trennzeichen, UTF-8 mit BOM, CRLF-Zeilenenden

const SEPARATOR = ';';

// Texte, die Excel als Formel ausfuehren wuerde, mit einem Apostroph entschaerfen
function sanitize(value) {
  const s = String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function cell(value) {
  if (value == null) return '';
  const s = typeof value === 'number' ? String(value) : sanitize(value);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// columns: [{ header, value: (row) => string|number|null }]
function toCsv(rows, columns) {
  const lines = [columns.map((c) => cell(c.header)).join(SEPARATOR)];
  for (const row of rows) {
    lines.push(columns.map((c) => cell(c.value(row))).join(SEPARATOR));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { toCsv };
