// Sanity checks that catch misread or mistyped boards before scoring.
// Limits come from the rulebook's component list and setup.

import { COLORS } from "./scoring.js";

const TILE_SUPPLY = { 1: 15, 2: 15, 3: 15, 4: 15, 5: 15, 6: 15, 7: 10, 8: 10 };
const SHELLS = { 2: 26, 3: 24, 4: 20 };

/** Returns a list of {level: "error"|"warn", text, cells?: ["r,c"]}. */
export function check(board) {
  const { size: n, cells, players } = board;
  const out = [];
  const m = (n - 1) / 2;

  if (n === 9 && players.length !== 2)
    out.push({ level: "error", text: "The 9×9 board is the 2-player side. Pick exactly two players." });
  if (n === 11 && (players.length < 3 || players.length > 4))
    out.push({ level: "error", text: "The 11×11 board is the 3–4 player side. Pick 3 or 4 players." });

  const byValue = {}, byOwner = {}, foreign = new Set();
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const t = cells[r][c];
    if (!t) continue;
    if (t.rock) {
      if (r !== m || c !== m) out.push({ level: "error", text: "The rock can only be in the center space.", cells: [r + "," + c] });
      continue;
    }
    if (r === m && c === m) out.push({ level: "error", text: "Nothing can be placed on the center rock.", cells: [r + "," + c] });
    if (t.v !== "W") (byValue[t.v] ||= []).push(r + "," + c);
    if (t.owner) {
      (byOwner[t.owner] ||= []).push(r + "," + c);
      if (!players.includes(t.owner)) foreign.add(t.owner);
    }
  }

  for (const [v, list] of Object.entries(byValue)) {
    if (list.length > TILE_SUPPLY[v])
      out.push({ level: "error", text: `${list.length} tiles read as ${v}, but the game only has ${TILE_SUPPLY[v]}. Some are probably misread.`, cells: list });
  }

  const limit = SHELLS[players.length];
  if (limit) {
    for (const p of players) {
      const k = (byOwner[p] || []).length;
      if (k > limit)
        out.push({ level: "error", text: `${COLORS[p]} has ${k} shells on the board, but each player only has ${limit} in a ${players.length}-player game.`, cells: byOwner[p] });
    }
    const most = Math.max(0, ...players.map((p) => (byOwner[p] || []).length));
    if (most > 0 && most < limit - 3)
      out.push({ level: "warn", text: `The game ends when someone places all ${limit} shells, but the most anyone has is ${most}. Is the game over, or were some tiles missed?` });
  }

  if (foreign.size)
    out.push({ level: "error", text: `Tiles belong to ${[...foreign].map((f) => COLORS[f]).join(", ")}, who isn't marked as a player.` });

  return out;
}
