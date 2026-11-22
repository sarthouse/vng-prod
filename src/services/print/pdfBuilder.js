// Generador PDF 1.4 puro en Node.js (cero dependencias externas) con WinAnsiEncoding para español.
import zlib from 'node:zlib';

const MM_TO_PT = 72 / 25.4;

export const PAGE_SIZES_MM = {
  A4: { w: 210, h: 297, margin: 10 },
  A5: { w: 148, h: 210, margin: 7 },
  ticket80: { w: 80, h: 210, margin: 3 },
  ticket58: { w: 58, h: 210, margin: 2.5 },
};

export function fmtDateAr(val) {
  const s = String(val || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

export function fmtNumAr(n, dec = 3) {
  const v = Number(n || 0);
  if (Number.isInteger(v)) return v.toLocaleString('es-AR');
  return v.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: dec });
}

// Mapeo básico Unicode -> WinAnsi (CP1252) para caracteres fuera de Latin-1
const WIN_ANSI_EXTRA = {
  0x20ac: 0x80, // €
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85, // …
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

function encodePdfLiteral(str) {
  const s = String(str ?? '');
  let out = '(';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    let byte = 0x3f; // '?'
    if (code >= 0x20 && code <= 0xff) {
      byte = code;
    } else if (WIN_ANSI_EXTRA[code] !== undefined) {
      byte = WIN_ANSI_EXTRA[code];
    } else if (code === 0x09 || code === 0x0a || code === 0x0d) {
      byte = 0x20;
    }
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      out += '\\' + String.fromCharCode(byte);
    } else if (byte < 0x20 || byte > 0x7e) {
      out += '\\' + byte.toString(8).padStart(3, '0');
    } else {
      out += String.fromCharCode(byte);
    }
  }
  out += ')';
  return out;
}

// Estimación precisa de ancho de texto en Helvetica (en pt)
function estimateTextWidthPt(str, sizePt, bold = false) {
  const s = String(str ?? '');
  const factor = bold ? 1.06 : 1.0;
  let units = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if ('ilIj.,:;\'!| '.includes(ch)) units += 0.28;
    else if ('frt()-[]/\\'.includes(ch)) units += 0.35;
    else if ('mwMW@%'.includes(ch)) units += 0.86;
    else if (ch >= 'A' && ch <= 'Z') units += 0.68;
    else if (ch >= '0' && ch <= '9') units += 0.56;
    else units += 0.53;
  }
  return units * sizePt * factor;
}

export function wrapTextMm(str, maxWidthMm, sizePt, bold = false) {
  const maxPt = maxWidthMm * MM_TO_PT;
  const paragraphs = String(str ?? '').split(/\r?\n/);
  const lines = [];
  for (const p of paragraphs) {
    const words = p.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let cur = words[0];
    for (let i = 1; i < words.length; i++) {
      const cand = cur + ' ' + words[i];
      if (estimateTextWidthPt(cand, sizePt, bold) <= maxPt) {
        cur = cand;
      } else {
        lines.push(cur);
        cur = words[i];
      }
    }
    lines.push(cur);
  }
  return lines;
}

function parseJpegInfo(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    while (i < buf.length && buf[i] === 0xFF) i++;
    if (i >= buf.length) break;
    const marker = buf[i++];
    if (marker === 0xD8 || marker === 0xD9 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
    if (i + 1 >= buf.length) break;
    const segLen = buf.readUInt16BE(i);
    if (marker >= 0xC0 && marker <= 0xC3 && i + 7 < buf.length) {
      const height = buf.readUInt16BE(i + 3);
      const width = buf.readUInt16BE(i + 5);
      const components = buf[i + 7];
      return {
        width,
        height,
        colorSpace: components === 1 ? '/DeviceGray' : components === 4 ? '/DeviceCMYK' : '/DeviceRGB',
        filter: '/DCTDecode',
        data: buf,
      };
    }
    i += segLen;
  }
  return null;
}

function parsePngInfo(buf) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buf || buf.length < 24 || !buf.subarray(0, 8).equals(sig)) return null;
  let pos = 8;
  let width = 0; let height = 0; let bitDepth = 8; let colorType = 2;
  const idatChunks = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString('ascii');
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR' && len >= 13) {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (!width || !height || bitDepth !== 8 || ![0, 2, 6].includes(colorType) || !idatChunks.length) return null;

  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * bpp;
  const rgb = Buffer.alloc(width * height * (colorType === 0 ? 1 : 3));
  const prevRow = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const row = Buffer.from(raw.subarray(rowStart + 1, rowStart + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prevRow[x];
      const c = x >= bpp ? prevRow[x - bpp] : 0;
      if (filter === 1) row[x] = (row[x] + a) & 0xFF;
      else if (filter === 2) row[x] = (row[x] + b) & 0xFF;
      else if (filter === 3) row[x] = (row[x] + ((a + b) >> 1)) & 0xFF;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        row[x] = (row[x] + pr) & 0xFF;
      }
    }
    row.copy(prevRow);
    if (colorType === 6) {
      for (let px = 0; px < width; px++) {
        const alpha = row[px * 4 + 3] / 255;
        const dst = (y * width + px) * 3;
        rgb[dst] = Math.round(row[px * 4] * alpha + 255 * (1 - alpha));
        rgb[dst + 1] = Math.round(row[px * 4 + 1] * alpha + 255 * (1 - alpha));
        rgb[dst + 2] = Math.round(row[px * 4 + 2] * alpha + 255 * (1 - alpha));
      }
    } else if (colorType === 2) {
      row.copy(rgb, y * width * 3);
    } else {
      row.copy(rgb, y * width);
    }
  }

  return {
    width,
    height,
    colorSpace: colorType === 0 ? '/DeviceGray' : '/DeviceRGB',
    filter: '/FlateDecode',
    data: zlib.deflateSync(rgb),
  };
}

function decodeDataUrlImage(dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) return null;
  const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  return m[1].toLowerCase() === 'png' ? parsePngInfo(buf) : parseJpegInfo(buf);
}

export class PdfDocument {
  constructor() {
    this.pages = [];
    this.current = null;
    this.images = [];
    this.imageByKey = new Map();
  }

  addPage(widthMm = 210, heightMm = 297) {
    const page = {
      wMm: widthMm,
      hMm: heightMm,
      wPt: widthMm * MM_TO_PT,
      hPt: heightMm * MM_TO_PT,
      ops: [],
    };
    this.pages.push(page);
    this.current = page;
    return page;
  }

  _yPt(yMm) {
    return this.current.hPt - yMm * MM_TO_PT;
  }

  _rgb(hex = '#0F1F2A') {
    const h = hex.replace('#', '');
    if (h.length !== 6) return '0 0 0';
    const r = (parseInt(h.slice(0, 2), 16) / 255).toFixed(3);
    const g = (parseInt(h.slice(2, 4), 16) / 255).toFixed(3);
    const b = (parseInt(h.slice(4, 6), 16) / 255).toFixed(3);
    return `${r} ${g} ${b}`;
  }

  rect(xMm, yMm, wMm, hMm, { stroke = null, fill = null, lineWidth = 0.6 } = {}) {
    const x = (xMm * MM_TO_PT).toFixed(2);
    const hPt = hMm * MM_TO_PT;
    const y = (this._yPt(yMm) - hPt).toFixed(2);
    const w = (wMm * MM_TO_PT).toFixed(2);
    const h = hPt.toFixed(2);
    const ops = this.current.ops;
    ops.push('q');
    if (fill) ops.push(`${this._rgb(fill)} rg`);
    if (stroke) {
      ops.push(`${lineWidth.toFixed(2)} w`);
      ops.push(`${this._rgb(stroke)} RG`);
    }
    ops.push(`${x} ${y} ${w} ${h} re`);
    if (fill && stroke) ops.push('B');
    else if (fill) ops.push('f');
    else ops.push('S');
    ops.push('Q');
  }

  line(x1Mm, y1Mm, x2Mm, y2Mm, { color = '#0F1F2A', lineWidth = 0.6, dashed = false } = {}) {
    const ops = this.current.ops;
    ops.push('q');
    ops.push(`${lineWidth.toFixed(2)} w`);
    ops.push(`${this._rgb(color)} RG`);
    if (dashed) ops.push('[3 2] 0 d');
    ops.push(`${(x1Mm * MM_TO_PT).toFixed(2)} ${this._yPt(y1Mm).toFixed(2)} m`);
    ops.push(`${(x2Mm * MM_TO_PT).toFixed(2)} ${this._yPt(y2Mm).toFixed(2)} l S`);
    ops.push('Q');
  }

  text(str, xMm, yMm, { size = 9, bold = false, color = '#0F1F2A', align = 'left' } = {}) {
    const s = String(str ?? '');
    if (!s) return;
    const font = bold ? '/F2' : '/F1';
    let xPt = xMm * MM_TO_PT;
    if (align === 'right' || align === 'center') {
      const wPt = estimateTextWidthPt(s, size, bold);
      if (align === 'right') xPt -= wPt;
      else xPt -= wPt / 2;
    }
    const yPt = this._yPt(yMm) - size * 0.82;
    const ops = this.current.ops;
    ops.push('q');
    ops.push(`${this._rgb(color)} rg`);
    ops.push(`BT ${font} ${size.toFixed(1)} Tf ${xPt.toFixed(2)} ${yPt.toFixed(2)} Td ${encodePdfLiteral(s)} Tj ET`);
    ops.push('Q');
  }

  textBlock(str, xMm, yMm, maxWidthMm, { size = 8.5, bold = false, color = '#0F1F2A', lineHeight = 1.32, align = 'left' } = {}) {
    const lines = wrapTextMm(str, maxWidthMm, size, bold);
    const stepMm = (size * lineHeight) / MM_TO_PT;
    let curY = yMm;
    for (const ln of lines) {
      if (ln) {
        const xPos = align === 'center' ? xMm + maxWidthMm / 2 : align === 'right' ? xMm + maxWidthMm : xMm;
        this.text(ln, xPos, curY, { size, bold, color, align });
      }
      curY += stepMm;
    }
    return curY;
  }

  drawImage(dataUrl, xMm, yMm, maxWMm, maxHMm) {
    if (!dataUrl) return null;
    let img = this.imageByKey.get(dataUrl);
    if (!img) {
      const parsed = decodeDataUrlImage(dataUrl);
      if (!parsed || !parsed.width || !parsed.height) return null;
      img = { ...parsed, name: `Im${this.images.length + 1}` };
      this.images.push(img);
      this.imageByKey.set(dataUrl, img);
    }
    const scale = Math.min(maxWMm / img.width, maxHMm / img.height);
    const drawWMm = img.width * scale;
    const drawHMm = img.height * scale;
    const xPt = xMm * MM_TO_PT;
    const wPt = drawWMm * MM_TO_PT;
    const hPt = drawHMm * MM_TO_PT;
    const yPt = this._yPt(yMm) - hPt;
    this.current.ops.push('q', `${wPt.toFixed(2)} 0 0 ${hPt.toFixed(2)} ${xPt.toFixed(2)} ${yPt.toFixed(2)} cm`, `/${img.name} Do`, 'Q');
    return { wMm: drawWMm, hMm: drawHMm };
  }

  stampAllPages(fn) {
    const prev = this.current;
    const total = this.pages.length;
    try {
      this.pages.forEach((p, idx) => {
        this.current = p;
        fn(idx + 1, total, p);
      });
    } finally {
      this.current = prev;
    }
  }

  toBuffer() {
    // Objetos:
    // 1: Catalog, 2: Pages, 3: Font F1 (Helvetica), 4: Font F2 (Helvetica-Bold)
    // Luego imágenes XObject (si hay), y por cada página: PageObj, ContentObj
    const objects = [];
    const pageIds = [];
    let nextId = 5;

    const imageIds = [];
    for (const img of this.images) {
      const imgId = nextId++;
      imageIds.push({ imgId, img });
    }
    const xObjectDict = imageIds.length
      ? `/XObject << ${imageIds.map(x => `/${x.img.name} ${x.imgId} 0 R`).join(' ')} >>`
      : '';

    for (const p of this.pages) {
      const pageId = nextId++;
      const contentId = nextId++;
      pageIds.push({ pageId, contentId, page: p });
    }

    objects.push({ id: 1, buf: Buffer.from(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`, 'latin1') });
    objects.push({ id: 2, buf: Buffer.from(`2 0 obj\n<< /Type /Pages /Kids [${pageIds.map(x => `${x.pageId} 0 R`).join(' ')}] /Count ${pageIds.length} >>\nendobj\n`, 'latin1') });
    objects.push({ id: 3, buf: Buffer.from(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`, 'latin1') });
    objects.push({ id: 4, buf: Buffer.from(`4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`, 'latin1') });

    for (const { imgId, img } of imageIds) {
      const head = `${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace ${img.colorSpace} /BitsPerComponent 8 /Filter ${img.filter} /Length ${img.data.length} >>\nstream\n`;
      objects.push({
        id: imgId,
        buf: Buffer.concat([Buffer.from(head, 'latin1'), img.data, Buffer.from('\nendstream\nendobj\n', 'latin1')]),
      });
    }

    for (const item of pageIds) {
      const stream = item.page.ops.join('\n');
      const streamBuf = Buffer.from(stream, 'latin1');
      objects.push({
        id: item.pageId,
        buf: Buffer.from(`${item.pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${item.page.wPt.toFixed(2)} ${item.page.hPt.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> ${xObjectDict} >> /Contents ${item.contentId} 0 R >>\nendobj\n`, 'latin1'),
      });
      objects.push({
        id: item.contentId,
        buf: Buffer.from(`${item.contentId} 0 obj\n<< /Length ${streamBuf.length} >>\nstream\n${stream}\nendstream\nendobj\n`, 'latin1'),
      });
    }

    objects.sort((a, b) => a.id - b.id);
    const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    const offsets = [0];
    let pos = chunks[0].length;

    for (const obj of objects) {
      offsets[obj.id] = pos;
      chunks.push(obj.buf);
      pos += obj.buf.length;
    }

    const xrefOffset = pos;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    chunks.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(chunks);
  }
}
