/**
 * CSV rendering — pure, dependency-free, unit-tested.
 * RFC 4180 quoting; the BOM is added at the HTTP layer for Excel.
 */

const cell = (value) => {
  if (value === null || value === undefined) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const iso = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};

/**
 * @param {Array<{key: string, header: string, format?: (row: any) => unknown}>} columns
 * @param {Array<any>} rows
 */
export const toCsv = (columns, rows) => {
  const head = columns.map((c) => cell(c.header)).join(',');
  const lines = rows.map((row) => columns.map((c) => {
    const raw = typeof c.format === 'function' ? c.format(row) : row[c.key];
    return cell(raw);
  }).join(','));
  return [head, ...lines].join('\r\n') + '\r\n';
};

export const exportBasename = (base, now = new Date()) =>
  `${base}-${now.toISOString().slice(0, 10)}`;

export const csvFilename = (base, now = new Date()) => `${exportBasename(base, now)}.csv`;

export const isoDate = iso;
