// Tiny dependency-free QR code encoder for printing a link in the terminal.
// Byte mode, error-correction level L, versions 1-5 (up to 106 bytes) - plenty for a URL.

// [data codewords, error-correction codewords] per version at level L (single block each).
const VERSIONS = [null, [19, 7], [34, 10], [55, 15], [80, 20], [108, 26]];

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 2);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

/**
 * Encode text as a QR code.
 * @returns {boolean[][] | null} square matrix (true = dark), or null if the text is too long.
 */
export function qrMatrix(text) {
  const bytes = [...Buffer.from(text, 'utf8')];
  const version = VERSIONS.findIndex((v) => v && bytes.length + 2 <= v[0]);
  if (version < 1) return null;
  const [dataLen, ecLen] = VERSIONS[version];

  // Bit stream: mode (byte) + length + data + terminator, padded to dataLen codewords.
  const bits = [];
  const push = (value, len) => { for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, dataLen * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < dataLen; pad ^= 0xec ^ 0x11) data.push(pad);
  const codewords = data.concat(rsRemainder(data, rsDivisor(ecLen)));

  const size = version * 4 + 17;
  const dark = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, on) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    dark[y][x] = on;
    fixed[y][x] = true;
  };

  // Timing patterns, finder patterns (with separators), alignment pattern.
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
  }
  if (version >= 2) {
    const c = size - 7;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  // Format information: level L (01) + mask 0, BCH(15,5) protected.
  const MASK = 0;
  const formatData = (0b01 << 3) | MASK;
  let rem = formatData;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const format = ((formatData << 10) | rem) ^ 0x5412;
  const bit = (i) => ((format >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);

  // Data modules in the standard zigzag, with mask 0 ((x + y) even -> invert).
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fixed[y][x]) continue;
        let on = false;
        if (i < codewords.length * 8) on = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
        i++;
        dark[y][x] = on !== ((x + y) % 2 === 0);
      }
    }
  }
  return dark;
}

/** Render a QR code with half-block characters; explicit colours so it scans on any terminal theme. */
export function qrToTerminal(text, quiet = 2) {
  const m = qrMatrix(text);
  if (!m) return null;
  const size = m.length;
  const at = (x, y) => x >= 0 && y >= 0 && x < size && y < size && m[y][x];
  const lines = [];
  for (let y = -quiet; y < size + quiet; y += 2) {
    let line = '';
    for (let x = -quiet; x < size + quiet; x++) {
      const top = at(x, y);
      const bottom = at(x, y + 1);
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    // Black "ink" on a white background.
    lines.push(`\x1b[30;47m${line}\x1b[0m`);
  }
  return lines.join('\n');
}
