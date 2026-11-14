// Generador QR Code (ISO/IEC 18004, Byte Mode, EC Level L, Versiones 1..10) en JS puro sin dependencias.

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const res = new Uint8Array(data.length + ecLen);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

// [version, totalDataCodewords, ecPerBlock, numBlocksGroup1, dataPerBlockGroup1, numBlocksGroup2, dataPerBlockGroup2, alignCoords]
const QR_VERSIONS = [
  null,
  [1, 19, 7, 1, 19, 0, 0, []],
  [2, 34, 10, 1, 34, 0, 0, [6, 18]],
  [3, 55, 15, 1, 55, 0, 0, [6, 22]],
  [4, 80, 20, 1, 80, 0, 0, [6, 26]],
  [5, 108, 26, 1, 108, 0, 0, [6, 30]],
  [6, 136, 18, 2, 68, 0, 0, [6, 34]],
  [7, 156, 20, 2, 78, 0, 0, [6, 22, 38]],
  [8, 194, 24, 2, 97, 0, 0, [6, 24, 42]],
  [9, 232, 30, 2, 116, 0, 0, [6, 26, 46]],
  [10, 274, 18, 2, 68, 2, 69, [6, 28, 50]],
];

function chooseVersion(byteLen) {
  for (let v = 1; v < QR_VERSIONS.length; v++) {
    const capBits = QR_VERSIONS[v][1] * 8;
    const headerBits = 4 + (v >= 10 ? 16 : 8);
    if (headerBits + byteLen * 8 <= capBits) return QR_VERSIONS[v];
  }
  return null;
}

function encodeDataCodewords(bytes, spec) {
  const [ver, totalData] = spec;
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, ver >= 10 ? 16 : 8);
  for (const b of bytes) pushBits(b, 8);
  const maxBits = totalData * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const padBytes = [0xec, 0x11];
  let p = 0;
  while (bits.length < maxBits) {
    pushBits(padBytes[p % 2], 8);
    p++;
  }
  const out = new Uint8Array(totalData);
  for (let i = 0; i < totalData; i++) {
    let val = 0;
    for (let b = 0; b < 8; b++) val = (val << 1) | bits[i * 8 + b];
    out[i] = val;
  }
  return out;
}

function interleaveBlocks(data, spec) {
  const [, , ecPerBlock, b1, d1, b2, d2] = spec;
  const blocks = [];
  const ecs = [];
  let offset = 0;
  for (let i = 0; i < b1; i++) {
    const slice = data.slice(offset, offset + d1);
    blocks.push(slice);
    ecs.push(rsEncode(slice, ecPerBlock));
    offset += d1;
  }
  for (let i = 0; i < b2; i++) {
    const slice = data.slice(offset, offset + d2);
    blocks.push(slice);
    ecs.push(rsEncode(slice, ecPerBlock));
    offset += d2;
  }
  const out = [];
  const maxD = Math.max(d1, d2);
  for (let i = 0; i < maxD; i++) {
    for (const blk of blocks) if (i < blk.length) out.push(blk[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const ec of ecs) out.push(ec[i]);
  }
  return out;
}

function drawFinder(grid, reserved, r0, c0) {
  const n = grid.length;
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const r = r0 + dr;
      const c = c0 + dc;
      if (r < 0 || r >= n || c < 0 || c >= n) continue;
      reserved[r][c] = true;
      const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
      const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      grid[r][c] = inOuter && (onBorder || inInner) ? 1 : 0;
    }
  }
}

function drawAlignment(grid, reserved, r0, c0) {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const r = r0 + dr;
      const c = c0 + dc;
      reserved[r][c] = true;
      const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
      grid[r][c] = dark ? 1 : 0;
    }
  }
}

function getFormatBits(mask) {
  // EC Level L = 01
  const data = (0b01 << 3) | mask;
  let d = data << 10;
  const gen = 0b10100110111;
  for (let i = 14; i >= 10; i--) {
    if ((d >> i) & 1) d ^= gen << (i - 10);
  }
  return ((data << 10) | d) ^ 0b101010000010010;
}

function applyFormatAndVersion(grid, reserved, ver, mask) {
  const n = grid.length;
  const fmt = getFormatBits(mask);
  for (let i = 0; i < 15; i++) {
    const bit = (fmt >> i) & 1;
    // Top-left & bottom-left
    if (i < 6) grid[8][i] = bit;
    else if (i < 8) grid[8][i + 1] = bit;
    else grid[n - 15 + i][8] = bit;
    // Top-right & top-left vertical
    if (i < 8) grid[8][n - 1 - i] = bit;
    else if (i < 9) grid[7][8] = bit;
    else grid[14 - i][8] = bit;
  }
  grid[n - 8][8] = 1; // Dark module
  if (ver >= 7) {
    // Version info (18 bits: 6 version + 12 BCH)
    let v = ver << 12;
    const gen = 0b1111100100101;
    for (let i = 17; i >= 12; i--) {
      if ((v >> i) & 1) v ^= gen << (i - 12);
    }
    const bits = (ver << 12) | v;
    for (let i = 0; i < 18; i++) {
      const bit = (bits >> i) & 1;
      const r = Math.floor(i / 3);
      const c = n - 11 + (i % 3);
      grid[r][c] = bit;
      grid[c][r] = bit;
      reserved[r][c] = true;
      reserved[c][r] = true;
    }
  }
}

export function encodeQrMatrix(text) {
  const bytes = Buffer.from(String(text || ''), 'utf8');
  const spec = chooseVersion(bytes.length);
  if (!spec) return null;
  const ver = spec[0];
  const n = ver * 4 + 17;

  const dataCw = encodeDataCodewords(bytes, spec);
  const allCw = interleaveBlocks(dataCw, spec);
  const allBits = [];
  for (const cw of allCw) {
    for (let b = 7; b >= 0; b--) allBits.push((cw >> b) & 1);
  }

  const grid = Array.from({ length: n }, () => new Uint8Array(n));
  const reserved = Array.from({ length: n }, () => new Array(n).fill(false));

  drawFinder(grid, reserved, 0, 0);
  drawFinder(grid, reserved, 0, n - 7);
  drawFinder(grid, reserved, n - 7, 0);

  // Timing patterns
  for (let i = 8; i < n - 8; i++) {
    reserved[6][i] = true;
    reserved[i][6] = true;
    grid[6][i] = i % 2 === 0 ? 1 : 0;
    grid[i][6] = i % 2 === 0 ? 1 : 0;
  }

  // Alignment patterns
  const coords = spec[7];
  for (const r of coords) {
    for (const c of coords) {
      if (reserved[r][c]) continue;
      drawAlignment(grid, reserved, r, c);
    }
  }

  // Reserve format info areas
  for (let i = 0; i < 9; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][n - 1 - i] = true;
    reserved[n - 1 - i][8] = true;
  }
  reserved[n - 8][8] = true;
  if (ver >= 7) {
    for (let r = 0; r < 6; r++) {
      for (let c = n - 11; c < n - 8; c++) {
        reserved[r][c] = true;
        reserved[c][r] = true;
      }
    }
  }

  // Place data bits (mask 0: (r + c) % 2 === 0)
  const mask = 0;
  let bitIdx = 0;
  let up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < n; step++) {
      const row = up ? n - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (reserved[row][c]) continue;
        let bit = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
        if ((row + c) % 2 === 0) bit ^= 1;
        grid[row][c] = bit;
      }
    }
    up = !up;
  }

  applyFormatAndVersion(grid, reserved, ver, mask);
  return grid;
}
