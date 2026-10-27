// On-device board reading: flatten the photo, classify each space by
// color, and read tile numbers with a small digit model.

import { emptyBoard } from "./scoring.js";
import { classifyMany } from "./digits.js";

export const CELL = 48;   // pixels per space in the flattened board
export const CROP = 24;   // digit crop size fed to the model

/* ---------- geometry ---------- */

/** Homography mapping the unit square (u,v) onto quad [TL, TR, BR, BL]. */
export function squareToQuad(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
  }
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
  };
}

/** Flatten the quad in `src` (ImageData) into an S x S ImageData,
 *  2x2 supersampled so a large photo doesn't alias. */
export function warp(src, quad, S) {
  const map = squareToQuad(quad);
  const out = new ImageData(S, S);
  const { width: W, height: H, data } = src;
  const o = out.data;
  const sample = (x, y, acc) => {
    x = Math.min(W - 1.001, Math.max(0, x)); y = Math.min(H - 1.001, Math.max(0, y));
    const xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi;
    const i00 = (yi * W + xi) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
    for (let k = 0; k < 3; k++) {
      acc[k] += (data[i00 + k] * (1 - fx) + data[i10 + k] * fx) * (1 - fy)
              + (data[i01 + k] * (1 - fx) + data[i11 + k] * fx) * fy;
    }
  };
  const acc = [0, 0, 0];
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    acc[0] = acc[1] = acc[2] = 0;
    for (const dy of [0.25, 0.75]) for (const dx of [0.25, 0.75]) {
      const [x, y] = map((i + dx) / S, (j + dy) / S);
      sample(x, y, acc);
    }
    const p = (j * S + i) * 4;
    o[p] = acc[0] / 4; o[p + 1] = acc[1] / 4; o[p + 2] = acc[2] / 4; o[p + 3] = 255;
  }
  return out;
}

/* ---------- color ---------- */

export function hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx === 0 ? 0 : d / mx, mx];
}

// Shell colors as hue windows. Sand sits near hue 40, so green starts above it.
const SHELL_HUES = {
  pink:   (h, s, v) => (h >= 320 || h < 12) && s > 0.32 && v > 0.45,
  green:  (h, s, v) => h >= 55 && h < 120 && s > 0.38 && v > 0.35,
  blue:   (h, s, v) => h >= 150 && h < 215 && s > 0.25 && v > 0.25,
  purple: (h, s, v) => h >= 235 && h < 320 && s > 0.2 && v > 0.25,
};
const isWhite = (h, s, v) => s < 0.3 && v > 0.62;
const isNest = (h, s, v) => h >= 8 && h < 38 && s > 0.22 && v > 0.12 && v < 0.55;

/** Best-guess grid corners: the four corner spaces are always brown nest
 *  squares, so take the extreme brown pixels along each diagonal. */
export function guessCorners(img) {
  const { width: W, height: H, data } = img;
  const step = Math.max(1, Math.round(Math.max(W, H) / 400));
  let tl = null, tr = null, br = null, bl = null, n = 0;
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
    const p = (y * W + x) * 4;
    const [h, s, v] = hsv(data[p], data[p + 1], data[p + 2]);
    if (!isNest(h, s, v)) continue;
    n++;
    if (!tl || x + y < tl[0] + tl[1]) tl = [x, y];
    if (!br || x + y > br[0] + br[1]) br = [x, y];
    if (!tr || x - y > tr[0] - tr[1]) tr = [x, y];
    if (!bl || y - x > bl[1] - bl[0]) bl = [x, y];
  }
  const fallback = [[W * 0.12, H * 0.12], [W * 0.88, H * 0.12], [W * 0.88, H * 0.88], [W * 0.12, H * 0.88]];
  if (n < 40) return fallback;
  const q = [tl, tr, br, bl];
  // Reject degenerate guesses (tiny or badly skewed).
  const side = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const sides = [side(tl, tr), side(tr, br), side(br, bl), side(bl, tl)];
  if (Math.min(...sides) < Math.min(W, H) * 0.3 || Math.max(...sides) / Math.min(...sides) > 2) return fallback;
  return q;
}

/* ---------- per-space analysis ---------- */

function cellStats(img, r, c) {
  const S = img.width, d = img.data;
  const cx = (c + 0.5) * CELL, cy = (r + 0.5) * CELL, R = CELL * 0.42;
  const counts = { white: 0, pink: 0, green: 0, blue: 0, purple: 0 };
  const sum = { white: [0, 0], pink: [0, 0], green: [0, 0], blue: [0, 0], purple: [0, 0] };
  let total = 0;
  for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
    if (x < 0 || y < 0 || x >= S || y >= S || (x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
    total++;
    const p = (y * S + x) * 4;
    const [h, s, v] = hsv(d[p], d[p + 1], d[p + 2]);
    let k = null;
    if (isWhite(h, s, v)) k = "white";
    else for (const col in SHELL_HUES) if (SHELL_HUES[col](h, s, v)) { k = col; break; }
    if (k) { counts[k]++; sum[k][0] += x; sum[k][1] += y; }
  }
  const frac = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / total]));
  const center = (k) => counts[k] ? [sum[k][0] / counts[k], sum[k][1] / counts[k]] : [cx, cy];
  return { frac, center };
}

/** Classify one space by color: empty, neutral tile, or a player's shell. */
export function classifyColor(img, r, c) {
  const { frac, center } = cellStats(img, r, c);
  const shells = ["pink", "green", "blue", "purple"].sort((a, b) => frac[b] - frac[a]);
  const best = shells[0], fb = frac[best], f2 = frac[shells[1]];
  if (fb > 0.2) {
    const sure = fb > 0.3 && fb > 2 * f2;
    return { kind: "owned", owner: best, center: center(best), sure };
  }
  if (frac.white + fb > 0.22) {
    const tile = [center("white"), center(best)];
    const sure = frac.white > 0.3 && fb < 0.1;
    return { kind: "neutral", center: tile[0], sure };
  }
  return { kind: "empty", sure: frac.white < 0.12 && fb < 0.1 };
}

/** 24x24 contrast-normalized digit crop (digit strokes near 1, background near 0). */
export function digitCrop(img, cx, cy) {
  const S = img.width, d = img.data, half = CELL * 0.24;
  const g = new Float32Array(CROP * CROP);
  for (let j = 0; j < CROP; j++) for (let i = 0; i < CROP; i++) {
    const x = Math.min(S - 1, Math.max(0, Math.round(cx - half + ((i + 0.5) / CROP) * 2 * half)));
    const y = Math.min(S - 1, Math.max(0, Math.round(cy - half + ((j + 0.5) / CROP) * 2 * half)));
    const p = (y * S + x) * 4;
    g[j * CROP + i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  }
  return normalizeCrop(g);
}

export function normalizeCrop(g) {
  const sorted = Array.from(g).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.02)];
  const hi = sorted[Math.floor(sorted.length * 0.9)];
  const span = Math.max(hi - lo, 60);
  const out = new Float32Array(g.length);
  for (let i = 0; i < g.length; i++) out[i] = Math.min(1, Math.max(0, (hi - g[i]) / span));
  return out;
}

export function rotateCropCW(a) {
  const out = new Float32Array(a.length);
  for (let y = 0; y < CROP; y++) for (let x = 0; x < CROP; x++)
    out[x * CROP + (CROP - 1 - y)] = a[y * CROP + x];
  return out;
}

function rotateGridCW(g) {
  const n = g.length;
  return g.map((row, i) => row.map((_, j) => g[n - 1 - j][i]));
}

/** Read the whole flattened board. Returns {cells, unsure, crops, rotation}. */
export async function readBoard(img, n) {
  const m = (n - 1) / 2;
  const found = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (r === m && c === m) continue;
    const col = classifyColor(img, r, c);
    if (col.kind === "empty") { if (!col.sure) found.push({ r, c, col, crop: null }); continue; }
    found.push({ r, c, col, crop: digitCrop(img, ...col.center) });
  }

  // Players may shoot from any side; try all four turns and keep the one
  // where the digit model is most confident.
  const tiles = found.filter((f) => f.crop);
  let best = { k: 0, score: -Infinity, preds: [] };
  let crops = tiles.map((t) => t.crop);
  for (let k = 0; k < 4; k++) {
    if (k > 0) crops = crops.map(rotateCropCW);
    const preds = await classifyMany(crops);
    const score = preds.reduce((s, p) => s + Math.log(p.prob + 1e-6), 0);
    if (score > best.score) best = { k, score, preds, crops };
  }

  let cells = emptyBoard(n);
  let unsure = Array.from({ length: n }, () => Array(n).fill(false));
  found.forEach((f) => { if (!f.crop) unsure[f.r][f.c] = true; });
  tiles.forEach((t, i) => {
    const p = best.preds[i];
    const v = p.label === "blank" ? (t.col.kind === "owned" ? "W" : null) : p.label;
    if (v == null) { unsure[t.r][t.c] = true; cells[t.r][t.c] = { owner: null, v: 1 }; return; }
    cells[t.r][t.c] = { owner: t.col.kind === "owned" ? t.col.owner : null, v };
    if (!t.col.sure || p.prob < 0.75) unsure[t.r][t.c] = true;
  });

  // Turn the grid the same way the digits were turned, so the board shows upright.
  for (let k = 0; k < best.k; k++) { cells = rotateGridCW(cells); unsure = rotateGridCW(unsure); }

  const keys = new Set();
  unsure.forEach((row, r) => row.forEach((u, c) => u && keys.add(r + "," + c)));
  return { cells, unsure: keys, rotation: best.k };
}

/** Training export: every non-empty space's crop (upright) with its final label. */
export function trainingCrops(img, n, rotation, cells) {
  const out = [];
  const m = (n - 1) / 2;
  // cells are upright; map back to photo orientation (undo k clockwise turns).
  const back = (r, c) => {
    for (let k = 0; k < rotation; k++) [r, c] = [n - 1 - c, r];
    return [r, c];
  };
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (r === m && c === m) continue;
    const t = cells[r][c];
    const [pr, pc] = back(r, c);
    const col = classifyColor(img, pr, pc);
    const center = col.center || [(pc + 0.5) * CELL, (pr + 0.5) * CELL];
    let crop = digitCrop(img, ...center);
    for (let k = 0; k < rotation; k++) crop = rotateCropCW(crop);
    const label = !t || t.rock ? "empty" : t.v === "W" ? "blank" : String(t.v);
    out.push({ r, c, owner: t?.owner || null, label, colorGuess: col.kind === "owned" ? col.owner : col.kind,
      crop: Array.from(crop, (x) => Math.round(x * 255)) });
  }
  return out;
}
