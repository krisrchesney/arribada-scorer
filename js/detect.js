// Automatic grid finding. The board has strong fixed landmarks: brown nest
// squares on every other row and column (including all four grid corners),
// sand everywhere else, and the rock in the center. We score how well a
// candidate grid lines up with those landmarks, then refine the four
// corners by local search from a few starting guesses. Also picks 9x9 vs 11x11.

import { hsv, squareToQuad } from "./vision.js";

const WORK = 360; // detection runs on a small copy of the photo

/** Map of +1 (nest brown) ... -1 (sand) per pixel, blurred, on a small copy. */
export function landmarkMap(img) {
  const k = WORK / Math.max(img.width, img.height);
  const W = Math.max(1, Math.round(img.width * k)), H = Math.max(1, Math.round(img.height * k));
  const src = img.data, sw = img.width;
  const hs = new Float32Array(W * H), ss = new Float32Array(W * H), vs = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (Math.min(img.height - 1, Math.floor(y / k)) * sw + Math.min(sw - 1, Math.floor(x / k))) * 4;
    const [h, s, v] = hsv(src[p], src[p + 1], src[p + 2]);
    hs[y * W + x] = h; ss[y * W + x] = s; vs[y * W + x] = v;
  }
  // Sand is the most common bright, warm color in the photo.
  const bins = new Float32Array(36);
  for (let i = 0; i < W * H; i++) if (ss[i] > 0.3 && vs[i] > 0.55 && (hs[i] < 70 || hs[i] > 340)) bins[Math.floor(hs[i] / 10) % 36]++;
  let best = 0; for (let b = 1; b < 36; b++) if (bins[b] > bins[best]) best = b;
  const sandH = best * 10 + 5;
  let vsum = 0, n = 0;
  for (let i = 0; i < W * H; i++) if (Math.abs(hs[i] - sandH) < 8 && ss[i] > 0.3 && vs[i] > 0.55) { vsum += vs[i]; n++; }
  const sandV = n ? vsum / n : 0.9;

  const m = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const h = hs[i], s = ss[i], v = vs[i];
    const dh = Math.min(Math.abs(h - sandH), 360 - Math.abs(h - sandH));
    const redder = ((sandH - h + 360) % 360) < 40; // same family, toward red
    if (dh < 10 && s > 0.28 && v > sandV * 0.78) m[i] = -1;                 // sand
    else if ((dh < 10 || redder) && s > 0.25 && v < sandV * 0.68 && v > 0.12) m[i] = 1; // nest brown
  }
  // A heavily blurred copy gives the search a wide, smooth basin; the light one makes it precise.
  return { m: boxBlur(m, W, H, 2), coarse: boxBlur(m, W, H, 6), raw: m, W, H, k };
}

function boxBlur(a, W, H, r) {
  const t = new Float32Array(W * H), o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += a[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      t[y * W + x] = s / (2 * r + 1);
      s += a[y * W + Math.min(W - 1, x + r + 1)] - a[y * W + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += t[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      o[y * W + x] = s / (2 * r + 1);
      s += t[Math.min(H - 1, y + r + 1) * W + x] - t[Math.max(0, y - r) * W + x];
    }
  }
  return o;
}

/** Sample points (grid units) and the sign each should have on the map. */
function pattern(n) {
  const pts = [];
  const mid = (n - 1) / 2;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (r === mid && c === mid) continue;
    const nest = r % 2 === 0 && c % 2 === 0;
    // Cell corners: tiles cover cell centers, but corners usually stay visible.
    for (const [fx, fy] of [[0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]])
      pts.push([(c + fx) / n, (r + fy) / n, nest ? 1 : -0.6]);
  }
  // Just outside the grid there is no brown, only sand and the score track.
  // Two rings: right next to the grid, and 1.5 spaces out. A grid shifted by
  // two rows keeps the nest pattern lined up, but then real nest squares fall
  // in the outer ring, so brown there is penalized hard.
  for (let i = 0; i < n; i++) for (const f of [0.3, 0.7]) {
    const t = (i + f) / n;
    for (const [off, w] of [[0.35, -0.8], [1.5, -1.2]]) {
      const o = off / n;
      pts.push([t, -o, w, 1], [t, 1 + o, w, 1], [-o, t, w, 1], [1 + o, t, w, 1]);
    }
  }
  return pts;
}

function scoreQuad(L, quad, pts, field = L.m) {
  const map = squareToQuad(quad);
  let s = 0;
  for (const [u, v, w, outside] of pts) {
    const [x, y] = map(u, v);
    const xi = Math.round(x), yi = Math.round(y);
    // Off the photo: a grid point there is a bad fit; an outside-ring point just tells us nothing.
    if (xi < 0 || yi < 0 || xi >= L.W || yi >= L.H) { if (!outside) s -= Math.abs(w); continue; }
    s += w * field[yi * L.W + xi];
  }
  return s / pts.length;
}

function refine(L, quad, pts, field, minStep = 0.4) {
  const q = quad.map((p) => p.slice());
  let best = scoreQuad(L, q, pts, field);
  const tryMove = (apply, undo) => {
    apply();
    const s = scoreQuad(L, q, pts, field);
    if (s > best + 1e-6) { best = s; return true; }
    undo(); return false;
  };
  for (let step = L.W / 20; step >= minStep; step /= 2) {
    let improved = true, guard = 0;
    while (improved && guard++ < 60) {
      improved = false;
      for (let i = 0; i < 4; i++) for (let a = 0; a < 2; a++) for (const d of [step, -step])
        improved = tryMove(() => (q[i][a] += d), () => (q[i][a] -= d)) || improved;
      // Whole-grid moves (shift and scale) escape traps where no single corner can improve alone.
      for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]])
        improved = tryMove(() => q.forEach((p) => { p[0] += dx; p[1] += dy; }),
                           () => q.forEach((p) => { p[0] -= dx; p[1] -= dy; })) || improved;
      const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
      for (const f of [1 + step / L.W, 1 - step / L.W]) {
        const sc = (g) => q.forEach((p) => { p[0] = cx + (p[0] - cx) * g; p[1] = cy + (p[1] - cy) * g; });
        improved = tryMove(() => sc(f), () => sc(1 / f)) || improved;
      }
    }
  }
  return { q, score: best };
}

/** Find the grid. `hints` are extra starting quads in photo pixels (e.g. last game's).
 *  Returns {corners (photo px), size, score}; score above ~0.35 is a confident fit. */
export function findGrid(img, { sizes = [9, 11], hints = [] } = {}) {
  const L = landmarkMap(img);
  const { W, H, k } = L;
  const starts = [];
  // Extreme brown points along each diagonal.
  let tl, tr, br, bl;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (L.m[y * W + x] < 0.5) continue;
    if (!tl || x + y < tl[0] + tl[1]) tl = [x, y];
    if (!br || x + y > br[0] + br[1]) br = [x, y];
    if (!tr || x - y > tr[0] - tr[1]) tr = [x, y];
    if (!bl || y - x > bl[1] - bl[0]) bl = [x, y];
  }
  if (tl) starts.push([tl, tr, br, bl]);
  for (const f of [0.1, 0.2, 0.3]) starts.push([[W * f, H * f], [W * (1 - f), H * f], [W * (1 - f), H * (1 - f)], [W * f, H * (1 - f)]]);
  const side = Math.min(W, H) * 0.7, cx = W / 2, cy = H / 2;
  starts.push([[cx - side / 2, cy - side / 2], [cx + side / 2, cy - side / 2], [cx + side / 2, cy + side / 2], [cx - side / 2, cy + side / 2]]);
  for (const h of hints) starts.push(h.map(([x, y]) => [x * k, y * k]));

  // Broad sweep: squares of several sizes and positions, plain and tilted
  // (a photo taken from one side makes the far edge look shorter).
  const m = Math.min(W, H);
  for (const f of [0.45, 0.55, 0.65, 0.75, 0.85, 0.95]) {
    for (const asp of [0.7, 0.85, 1, 1.18, 1.4]) {
      const w = m * f * Math.sqrt(asp), h = (m * f) / Math.sqrt(asp);
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        const cx = W / 2 + i * W * 0.1, cy = H / 2 + j * H * 0.1;
        for (const [side, t] of [[0, 0], [0, 0.2], [1, 0.2], [2, 0.2], [3, 0.2]]) {
          // Tilt shrinks one edge (top, right, bottom, left) by t.
          const q = [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
          const sh = (i0, i1, len, ax) => { q[i0][ax] += len * t / 2; q[i1][ax] -= len * t / 2; };
          if (t) [() => sh(0, 1, w, 0), () => sh(1, 2, h, 1), () => sh(3, 2, w, 0), () => sh(0, 3, h, 1)][side]();
          starts.push(q);
        }
      }
    }
  }

  let best = null;
  for (const n of sizes) {
    const pts = pattern(n);
    const ranked = starts.map((s) => ({ s, score: scoreQuad(L, s, pts, L.coarse) }))
      .sort((a, b) => b.score - a.score).slice(0, 24);
    let bestN = null;
    for (const { s } of ranked) {
      const rough = refine(L, s, pts, L.coarse, 1.5);
      const r = refine(L, rough.q, pts, L.m);
      if (!bestN || r.score > bestN.score) bestN = r;
    }
    // Hop: shift, grow and shrink the best fit by about a space, re-fit, keep any gain.
    for (let round = 0; round < 3; round++) {
      const q0 = bestN.q, cx = q0.reduce((s, p) => s + p[0], 0) / 4, cy = q0.reduce((s, p) => s + p[1], 0) / 4;
      const cell = Math.hypot(q0[1][0] - q0[0][0], q0[1][1] - q0[0][1]) / n;
      let gained = false;
      for (const [dx, dy, g] of [[cell, 0, 1], [-cell, 0, 1], [0, cell, 1], [0, -cell, 1], [0, 2 * cell, 1], [0, -2 * cell, 1],
        [2 * cell, 0, 1], [-2 * cell, 0, 1], [0, 0, 1.12], [0, 0, 0.89], [0, cell, 1.12], [0, -cell, 1.12]]) {
        const q = q0.map(([x, y]) => [cx + (x - cx) * g + dx, cy + (y - cy) * g + dy]);
        const r = refine(L, refine(L, q, pts, L.coarse, 1.5).q, pts, L.m);
        if (r.score > bestN.score + 1e-4) { bestN = r; gained = true; }
      }
      if (!gained) break;
    }
    if (!best || bestN.score > best.score) best = { ...bestN, size: n };
  }
  return { corners: best.q.map(([x, y]) => [x / k, y / k]), size: best.size, score: best.score };
}
