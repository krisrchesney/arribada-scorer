// Arribada final scoring (rulebook p.13). Pure functions, no DOM.
//
// A board is {size, cells, players}:
//   size    9 (2-player side) or 11 (3-4 player side)
//   cells   size x size array; each entry is null (empty), {rock:true},
//           or {owner, v} where owner is a color key or null (neutral)
//           and v is 1-8 or "W" (wild, a face-down captured tile)
//   players array of color keys in the game

export const COLORS = { pink: "Pink", green: "Green", blue: "Blue", purple: "Purple" };
export const QNAMES = ["Upper left", "Upper right", "Lower right", "Lower left"];

/** Quadrant index 0-3 for a space, or null for the center rock.
 *  Quadrants form a pinwheel around the rock, so the layout is the same
 *  from every side of the table. */
export function quadrant(r, c, n) {
  const m = (n - 1) / 2;
  if (r === m && c === m) return null;
  if (r <= m && c < m) return 0;
  if (r < m && c >= m) return 1;
  if (r >= m && c > m) return 2;
  return 3;
}

/** Do three values along a path form a set or a sequence? null = wild. */
export function fits(a, b, c) {
  const xs = [a, b, c];
  const known = xs.filter((x) => x != null);
  if (known.every((x) => x === known[0])) return true;
  for (let s = 1; s <= 6; s++) {
    for (const exp of [[s, s + 1, s + 2], [s + 2, s + 1, s]]) {
      if (xs.every((x, i) => x == null || x === exp[i])) return true;
    }
  }
  return false;
}

const val = (t) => (t.v === "W" ? null : t.v);
const key = (r, c) => r + "," + c;

/** Set of "r,c" keys for owned tiles that belong to a group.
 *  Any connected set of 3+ cells contains a 3-cell path through each of
 *  its members, and every longer set or run is made of valid 3-cell
 *  windows, so checking all 3-cell paths is exact. */
export function grouped(board) {
  const { size: n, cells } = board;
  const owned = (r, c) => {
    const t = cells[r] && cells[r][c];
    return t && !t.rock && t.owner ? t : null;
  };
  const g = new Set();
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const t = owned(r, c);
    if (!t) continue;
    const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
      .filter(([y, x]) => owned(y, x)?.owner === t.owner);
    for (let i = 0; i < nb.length; i++) for (let j = i + 1; j < nb.length; j++) {
      const A = owned(...nb[i]), B = owned(...nb[j]);
      if (fits(val(A), val(t), val(B))) {
        g.add(key(...nb[i])); g.add(key(...nb[j])); g.add(key(r, c));
      }
    }
  }
  return g;
}

/** 2-player: what the player with fewer tiles in a quadrant scores. */
export function secondPenalty(k) {
  return k === 0 ? -10 : k <= 2 ? -5 : k === 3 ? -2 : 0;
}

/** Final scoring. Returns per-player stranded loss and quadrant points,
 *  the tile counts used for majorities, and the stranded cell keys. */
export function score(board) {
  const { size: n, cells, players: P } = board;
  const g = grouped(board);
  const res = {};
  P.forEach((p) => (res[p] = { strand: 0, strandTiles: [], q: [0, 0, 0, 0] }));
  const counts = [0, 1, 2, 3].map(() => Object.fromEntries(P.map((p) => [p, 0])));
  const stranded = new Set();
  const others = new Set();

  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const t = cells[r][c];
    if (!t || t.rock || !t.owner) continue;
    if (!res[t.owner]) { others.add(t.owner); continue; }
    if (g.has(key(r, c))) {
      const q = quadrant(r, c, n);
      if (q != null) counts[q][t.owner]++;
    } else {
      stranded.add(key(r, c));
      res[t.owner].strand -= t.v === "W" ? 0 : t.v;
      res[t.owner].strandTiles.push(t.v === "W" ? "wild" : t.v);
    }
  }

  counts.forEach((cnt, q) => {
    if (n === 9) {
      if (P.length !== 2) return;
      const [a, b] = P, ca = cnt[a], cb = cnt[b];
      if (ca === 0 && cb === 0) return;
      if (ca === cb) {
        // Not covered by the rulebook: split first and second place.
        const each = Math.floor((10 + secondPenalty(ca)) / 2);
        res[a].q[q] = each; res[b].q[q] = each;
      } else {
        const [w, l] = ca > cb ? [a, b] : [b, a];
        res[w].q[q] = 10;
        res[l].q[q] = secondPenalty(cnt[l]);
      }
    } else {
      const pts = [20, 16, 10, 8];
      const ranked = P.filter((p) => cnt[p] > 0).sort((x, y) => cnt[y] - cnt[x]);
      let i = 0;
      while (i < ranked.length) {
        let j = i;
        while (j < ranked.length && cnt[ranked[j]] === cnt[ranked[i]]) j++;
        let sum = 0;
        for (let k = i; k < j; k++) sum += pts[k] || 0;
        for (let k = i; k < j; k++) res[ranked[k]].q[q] = Math.floor(sum / (j - i));
        i = j;
      }
    }
  });

  return { res, counts, stranded, others: [...others] };
}

export function emptyBoard(n) {
  const cells = Array.from({ length: n }, () => Array(n).fill(null));
  const m = (n - 1) / 2;
  cells[m][m] = { rock: true };
  return cells;
}
