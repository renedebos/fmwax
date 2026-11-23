// A QR CODE, DRAWN HERE (2026-11-22): the TV shows one for an article on
// another site, and a phone's camera opens it (the TV app opens the house's
// own pages only). Byte mode, error correction L, versions 1 to 10 (up to 271
// bytes, enough for an article's address), mask 0. No library: this is the
// whole of it, and test/qr.test.js checks its bits against the standard's
// own numbers.

// Per version: all codewords, error-correction codewords a block, blocks.
const V = [null, [26, 7, 1], [44, 10, 1], [70, 15, 1], [100, 20, 1], [134, 26, 1], [172, 18, 2], [196, 20, 2], [242, 24, 2], [292, 30, 2], [346, 18, 4]];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// GF(256), the field the error correction is worked in.
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function ecc(data, n) {
  let gen = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) { next[j] ^= gen[j]; next[j + 1] ^= mul(gen[j], EXP[i]); }
    gen = next;
  }
  const rem = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ rem.shift(); rem.push(0);
    for (let j = 0; j < n; j++) rem[j] ^= mul(gen[j + 1], f);
  }
  return rem;
}

// The remainder of `value` shifted up, divided by `poly`: the format's and
// the version's own check bits.
function bch(value, poly, bits) {
  const top = 31 - Math.clz32(poly);
  let v = value << top;
  for (let i = bits - 1; i >= top; i--) if (v & (1 << i)) v ^= poly << (i - top);
  return (value << top) | v;
}

export const QR_MAX_BYTES = 271;

// The code as rows of 0 and 1, or null for words too long to fit.
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(String(text ?? ""))];
  let ver = 0;
  for (let v = 1; v <= 10; v++) {
    const room = V[v][0] - V[v][1] * V[v][2];
    // Four bits of mode, the length (8 bits to version 9, 16 from 10), the bytes.
    if (bytes.length + (v >= 10 ? 3 : 2) <= room) { ver = v; break; }
  }
  if (!ver || !bytes.length) return null;
  const [total, ecN, blocks] = V[ver], dataN = total - ecN * blocks;

  // The data: mode, length, bytes, the end mark, then padding.
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  put(4, 4); put(bytes.length, ver >= 10 ? 16 : 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, dataN * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < dataN; pad ^= 0xec ^ 0x11) data.push(pad);

  // In blocks (the shorter ones first), each with its own check words, then
  // woven together a word at a time.
  const short = Math.floor(dataN / blocks), longs = dataN % blocks;
  const dBlocks = [], eBlocks = [];
  for (let b = 0, at = 0; b < blocks; b++) {
    const len = short + (b >= blocks - longs ? 1 : 0);
    dBlocks.push(data.slice(at, at + len)); at += len;
    eBlocks.push(ecc(dBlocks[b], ecN));
  }
  const words = [];
  for (let i = 0; i <= short; i++) for (const d of dBlocks) if (i < d.length) words.push(d[i]);
  for (let i = 0; i < ecN; i++) for (const e of eBlocks) words.push(e[i]);

  const n = 17 + 4 * ver;
  const m = Array.from({ length: n }, () => new Array(n).fill(0));
  const fixed = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (r, c, v) => { if (r >= 0 && r < n && c >= 0 && c < n) { m[r][c] = v ? 1 : 0; fixed[r][c] = true; } };

  // The three corner squares with their quiet edge, the timing lines, the
  // small alignment squares.
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const edge = r === -1 || r === 7 || c === -1 || c === 7;
      const ring = r === 0 || r === 6 || c === 0 || c === 6, core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      set(r0 + r, c0 + c, !edge && (ring || core));
    }
  }
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = ALIGN[ver];
  for (const r of al) for (const c of al) {
    if ((r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  set(n - 8, 8, 1);

  // The format (level L, mask 0), twice; the version, twice, from 7 up.
  const fmt = bch((1 << 3) | 0, 0x537, 15) ^ 0x5412;
  for (let i = 0; i < 15; i++) {
    const bit = (fmt >> i) & 1;
    // Beside the top-left square…
    if (i < 6) set(i, 8, bit); else if (i < 8) set(i + 1, 8, bit); else set(8, 14 - i < 6 ? 14 - i : 15 - i, bit);
    // …and split between the other two.
    if (i < 8) set(8, n - 1 - i, bit); else set(n - 15 + i, 8, bit);
  }
  if (ver >= 7) {
    const vi = bch(ver, 0x1f25, 18);
    for (let i = 0; i < 18; i++) {
      const bit = (vi >> i) & 1, a = Math.floor(i / 3), b = n - 11 + (i % 3);
      set(a, b, bit); set(b, a, bit);
    }
  }

  // The words, snaking up and down in pairs of columns from the right, the
  // timing column skipped; mask 0 turns a cell where row + column is even.
  let k = 0;
  const all = words.length * 8;
  for (let right = n - 1, up = true; right >= 1; right -= 2, up = !up) {
    if (right === 6) right = 5;
    for (let i = 0; i < n; i++) {
      const r = up ? n - 1 - i : i;
      for (const c of [right, right - 1]) {
        if (fixed[r][c]) continue;
        const bit = k < all ? (words[k >> 3] >> (7 - (k & 7))) & 1 : 0;
        k++;
        m[r][c] = bit ^ ((r + c) % 2 === 0 ? 1 : 0);
      }
    }
  }
  return m;
}

// As an SVG, dark on light with the four cells of quiet the standard asks
// around it. Empty for words too long.
export function qrSvg(text, { label = "QR code" } = {}) {
  const m = qrMatrix(text);
  if (!m) return "";
  const n = m.length, q = 4, size = n + q * 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) d += `M${c + q} ${r + q}h1v1h-1z`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
