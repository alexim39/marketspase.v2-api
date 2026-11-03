import ExcelJS from 'exceljs';

/**
 * XLSX rendering over the same column defs as CSV (header + key/format).
 * Values stay printable strings — identical content to the CSV twin.
 */

const printable = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
};

/**
 * @param {string} sheetName
 * @param {Array<{key: string, header: string, format?: (row: any) => unknown}>} columns
 * @param {Array<any>} rows
 * @returns {Promise<Buffer>} .xlsx bytes
 */
export async function buildXlsx(sheetName, columns, rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Diamond Project';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(String(sheetName).slice(0, 31));
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.header, width: 24 }));
  for (const row of rows) {
    const values = columns.map((c) => {
      const raw = typeof c.format === 'function' ? c.format(row) : row[c.key];
      return printable(raw);
    });
    sheet.addRow(values);
  }
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
