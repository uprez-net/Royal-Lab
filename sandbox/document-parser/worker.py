"""Original bounded extractors; no OCR, formula evaluation or external fetches."""
import base64
import io
import json
import posixpath
import sys
import zipfile
import xml.etree.ElementTree as ET

MAX_RAW = 8_000_000
MAX_XML = 16_000_000
MAX_UNITS = 20_000
MAX_TEXT = 2_000_000
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
S = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
P = '{http://schemas.openxmlformats.org/package/2006/relationships}'

def xml(archive, name):
    raw = archive.read(name)
    if len(raw) > MAX_XML or b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
        raise ValueError('XML_LIMIT_OR_ENTITY_DECLARATION')
    return ET.fromstring(raw)

def checked_archive(raw):
    archive = zipfile.ZipFile(io.BytesIO(raw))
    entries = archive.infolist()
    if len(entries) > 2000 or sum(item.file_size for item in entries) > MAX_XML:
        raise ValueError('ZIP_EXPANSION_LIMIT')
    names = [item.filename for item in entries]
    if len(set(names)) != len(names):
        raise ValueError('DUPLICATE_ZIP_MEMBER')
    for item in entries:
        if item.flag_bits & 1 or item.filename.startswith('/') or '..' in item.filename.split('/'):
            raise ValueError('UNSAFE_ZIP_MEMBER')
    return archive

def extract_pdf(raw):
    from pypdf import PdfReader
    document = PdfReader(io.BytesIO(raw), strict=True)
    if document.is_encrypted or len(document.pages) > 200:
        raise ValueError('PDF_ENCRYPTED_OR_PAGE_LIMIT')
    units, gaps = [], []
    for number, page in enumerate(document.pages, 1):
        text = page.extract_text() or ''
        if not text.strip():
            gaps.append(f'Page {number}: no extractable text; OCR/vision is not enabled.')
            text = '[UNREADABLE_NO_TEXT]'
        for line, value in enumerate(text.replace('\r', '').split('\n'), 1):
            units.append({'locator': f'page:{number}:line:{line}', 'text': value})
    return units, gaps

def extract_docx(raw):
    archive = checked_archive(raw)
    document = xml(archive, 'word/document.xml')
    units, gaps = [], []
    body = document.find(f'{W}body')
    if body is None:
        raise ValueError('DOCX_MISSING_BODY')
    for number, child in enumerate(body, 1):
        if child.tag == f'{W}p':
            units.append({'locator': f'paragraph:{number}', 'text': ''.join(child.itertext())})
        elif child.tag == f'{W}tbl':
            for row, item in enumerate(child.findall(f'{W}tr'), 1):
                values = [''.join(cell.itertext()) for cell in item.findall(f'{W}tc')]
                units.append({'locator': f'table:{number}:row:{row}', 'text': json.dumps(values, ensure_ascii=False)})
    if any(name.startswith('word/media/') for name in archive.namelist()):
        gaps.append('Embedded images are not interpreted; OCR/vision is not enabled.')
    for name in archive.namelist():
        if name.startswith('word/') and name.endswith('.xml') and any(part in name for part in ['header', 'footer', 'footnotes', 'endnotes']):
            units.append({'locator': f'part:{name}', 'text': ''.join(xml(archive, name).itertext())})
    return units, gaps

def extract_xlsx(raw):
    archive = checked_archive(raw)
    if any(name.endswith('vbaProject.bin') for name in archive.namelist()):
        raise ValueError('MACROS_UNSUPPORTED')
    workbook = xml(archive, 'xl/workbook.xml')
    relationships = xml(archive, 'xl/_rels/workbook.xml.rels')
    targets = {}
    for relationship in relationships.findall(f'{P}Relationship'):
        if relationship.get('TargetMode') == 'External':
            continue
        target = relationship.get('Target', '')
        normalized = posixpath.normpath('xl/' + target) if not target.startswith('/') else target[1:]
        if not normalized.startswith('xl/') or '..' in normalized.split('/'):
            raise ValueError('XLSX_UNSAFE_RELATIONSHIP')
        targets[relationship.get('Id')] = normalized
    shared = []
    if 'xl/sharedStrings.xml' in archive.namelist():
        shared = [''.join(item.itertext()) for item in xml(archive, 'xl/sharedStrings.xml').findall(f'{S}si')]
    units, gaps = [], ['Excel formulas are preserved and never recalculated. Numeric date serials retain their raw value and style index.']
    if any(name.startswith('xl/externalLinks/') for name in archive.namelist()):
        gaps.append('External workbook links are not fetched or resolved.')
    sheets = workbook.find(f'{S}sheets')
    if sheets is None:
        raise ValueError('XLSX_MISSING_SHEETS')
    for sheet in sheets:
        name = sheet.get('name', '')
        target = targets.get(sheet.get(f'{R}id'))
        if not target:
            raise ValueError('XLSX_MISSING_SHEET_RELATIONSHIP')
        for cell in xml(archive, target).iter(f'{S}c'):
            reference = cell.get('r', '')
            value = cell.findtext(f'{S}v')
            kind = cell.get('t', 'n')
            if kind == 's' and value is not None:
                value = shared[int(value)]
            elif kind == 'inlineStr':
                value = ''.join(cell.find(f'{S}is').itertext()) if cell.find(f'{S}is') is not None else ''
            formula = cell.findtext(f'{S}f')
            if formula is not None and value is None:
                gaps.append(f'{name}!{reference}: formula has no cached value.')
            units.append({'locator': f'sheet:{name}:cell:{reference}',
                          'text': f'value={value!r}; type={kind}; style={cell.get("s", "0")}',
                          'formula': formula, 'cachedValue': value})
    return units, gaps

def main():
    request = sys.stdin.buffer.read(12_000_001)
    if len(request) > 12_000_000:
        raise ValueError('REQUEST_LIMIT')
    request = json.loads(request)
    raw = base64.b64decode(request['content'], validate=True)
    if len(raw) > MAX_RAW:
        raise ValueError('RAW_LIMIT')
    media = request['mediaType']
    if media == 'application/pdf':
        units, gaps = extract_pdf(raw)
    elif media == 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        units, gaps = extract_docx(raw)
    elif media == 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        units, gaps = extract_xlsx(raw)
    else:
        raise ValueError('UNSUPPORTED_MEDIA')
    result = json.dumps({'parser': 'royal-binary-1.0.0/pypdf-6.19.0', 'units': units, 'gaps': gaps}, ensure_ascii=False)
    if len(units) > MAX_UNITS or len(result.encode('utf-8')) > MAX_TEXT:
        raise ValueError('EXTRACT_LIMIT')
    print(result)

try:
    main()
except Exception as error:
    print(f'{type(error).__name__}: {str(error)[:200]}', file=sys.stderr)
    sys.exit(2)
