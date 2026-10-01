import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readBinary } from '#src/documents/readers/binary';

const config = {
  image: 'royal-lab-parser:1.0.0',
  imageId: execFileSync(
    'docker',
    ['image', 'inspect', 'royal-lab-parser:1.0.0', '--format', '{{.Id}}'],
    { encoding: 'utf8' },
  ).trim(),
};
function zip(files: Record<string, string>) {
  // Stored ZIP members, generated entirely from original fictional test strings.
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const filename = Buffer.from(name);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const entry = Buffer.concat([header, filename, data]);
    local.push(entry);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([directory, filename]));
    offset += entry.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(local.length, 8);
  end.writeUInt16LE(local.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function pdf() {
  const stream = 'BT /F1 12 Tf 10 50 Td (Fictional claim AUD 42.00) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(output);
  output += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(output);
}
test('isolated PDF worker preserves page/line evidence', async () => {
  const result = await readBinary(pdf(), 'application/pdf', config);
  assert.ok(
    result.units.some(
      (unit) => unit.locator === 'page:1:line:1' && unit.text.includes('AUD 42.00'),
    ),
  );
});
test('isolated DOCX worker preserves paragraphs, tables and header parts', async () => {
  const bytes = zip({
    'word/document.xml':
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Fictional owner</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Claim 42</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
    'word/header1.xml':
      '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Builder footer is not the owner</w:t></w:r></w:p></w:hdr>',
  });
  const result = await readBinary(
    bytes,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    config,
  );
  assert.ok(
    result.units.some((unit) => unit.locator === 'paragraph:1' && unit.text.includes('owner')),
  );
  assert.ok(result.units.some((unit) => unit.locator === 'table:2:row:1'));
  assert.ok(result.units.some((unit) => unit.locator === 'part:word/header1.xml'));
});
test('isolated XLSX worker preserves formulas and cached-value absence', async () => {
  const bytes = zip({
    'xl/workbook.xml':
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Quote" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>42</v></c><c r="B1"><f>A1*2</f><v>84</v></c><c r="C1"><f>A1*3</f></c></row></sheetData></worksheet>',
  });
  const result = await readBinary(
    bytes,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    config,
  );
  assert.deepEqual(
    result.units.find((unit) => unit.locator === 'sheet:Quote:cell:B1')?.cachedValue,
    '84',
  );
  assert.equal(result.units.find((unit) => unit.locator.endsWith('C1'))?.formula, 'A1*3');
  assert.ok(result.gaps.some((gap) => gap.includes('no cached value')));
});
test('corrupt binaries, entity declarations and oversized raw bytes fail explicitly', async () => {
  await assert.rejects(
    readBinary(Buffer.from('not a PDF'), 'application/pdf', config),
    /PARSER_ERROR/,
  );
  await assert.rejects(
    readBinary(
      zip({
        'word/document.xml':
          '<!DOCTYPE test [<!ENTITY x SYSTEM "file:///etc/passwd">]><test>&x;</test>',
      }),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      config,
    ),
    /ENTITY_DECLARATION/,
  );
  await assert.rejects(
    readBinary(Buffer.alloc(8_000_001), 'application/pdf', config),
    /READER_LIMIT/,
  );
});
