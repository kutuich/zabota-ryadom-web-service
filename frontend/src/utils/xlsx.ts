type CellValue = string | number | boolean | null | undefined;

type Sheet = {
  name: string;
  rows: CellValue[][];
};

const textEncoder = new TextEncoder();

export function downloadXlsx(filename: string, sheets: Sheet[]) {
  const normalizedSheets = sheets.length ? sheets : [{ name: "Лист 1", rows: [] }];
  const files: Array<{ path: string; data: Uint8Array }> = [
    { path: "[Content_Types].xml", data: encodeXml(contentTypesXml(normalizedSheets.length)) },
    { path: "_rels/.rels", data: encodeXml(rootRelsXml()) },
    { path: "xl/workbook.xml", data: encodeXml(workbookXml(normalizedSheets)) },
    { path: "xl/_rels/workbook.xml.rels", data: encodeXml(workbookRelsXml(normalizedSheets.length)) },
    ...normalizedSheets.map((sheet, index) => ({
      path: `xl/worksheets/sheet${index + 1}.xml`,
      data: encodeXml(worksheetXml(sheet.rows))
    }))
  ];

  const blob = new Blob([zipStore(files)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadZip(filename: string, files: Array<{ path: string; data: string }>) {
  const blob = new Blob([
    zipStore(files.map((file) => ({ path: file.path, data: textEncoder.encode(file.data) })))
  ], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function encodeXml(value: string) {
  return textEncoder.encode(value);
}

function contentTypesXml(sheetCount: number) {
  const sheetOverrides = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheetOverrides}
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml(sheets: Sheet[]) {
  const items = sheets.map((sheet, index) =>
    `<sheet name="${escapeXml(safeSheetName(sheet.name))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${items}</sheets>
</workbook>`;
}

function workbookRelsXml(sheetCount: number) {
  const items = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`;
}

function worksheetXml(rows: CellValue[][]) {
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((cell, cellIndex) => {
      const ref = `${columnName(cellIndex + 1)}${rowIndex + 1}`;
      if (typeof cell === "number" && Number.isFinite(cell)) {
        return `<c r="${ref}"><v>${cell}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(formatCell(cell))}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
}

function zipStore(files: Array<{ path: string; data: Uint8Array }>) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = textEncoder.encode(file.path);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length + file.data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, file.data.length, true);
    localView.setUint32(22, file.data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(file.data, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);

    offset += local.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);

  return new Blob([...localParts, ...centralParts, end].map(toBlobPart));
}

function toBlobPart(part: Uint8Array) {
  const copy = new ArrayBuffer(part.byteLength);
  new Uint8Array(copy).set(part);
  return copy;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function columnName(index: number) {
  let name = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - remainder) / 26);
  }
  return name;
}

function safeSheetName(name: string) {
  return (name || "Лист").replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
}

function formatCell(value: CellValue) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "да" : "нет";
  return String(value);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
