import { COLORS, QNAMES, quadrant, score, emptyBoard } from "./scoring.js";
import { check } from "./checks.js";
import { CELL, warp, balance, squareToQuad, readBoard, trainingCrops } from "./vision.js";
import { loadModel } from "./digits.js";
import { findGrid } from "./detect.js";

const $ = (id) => document.getElementById(id);
const cssColor = (c) => `var(--p-${c})`;
const fmt = (v) => (v > 0 ? `+${v}` : `${v}`);
const cls = (v) => (v < 0 ? "neg" : v > 0 ? "pos" : "");

const store = {
  get(k, d) { try { const v = localStorage.getItem("arribada." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("arribada." + k, JSON.stringify(v)); } catch {} },
};

const state = {
  size: store.get("size", 9),
  cells: null, players: [], track: {}, sel: null, unsure: new Set(),
  photo: null, corners: null, warped: null, rotation: 0,
};

function defaultPlayers(n) {
  const saved = store.get("players" + n, null);
  if (saved) return saved;
  return n === 9 ? ["pink", "purple"] : ["pink", "green", "blue"];
}

function show(step) {
  for (const id of ["stepShoot", "stepAlign", "stepResult"]) $(id).hidden = id !== step;
  window.scrollTo(0, 0);
}

function syncSizeButtons() {
  for (const s of ["", "b", "c"]) {
    $("sz9" + s).setAttribute("aria-pressed", state.size === 9);
    $("sz11" + s).setAttribute("aria-pressed", state.size === 11);
  }
}

function setSize(n, { resetBoard }) {
  state.size = n; store.set("size", n);
  if (resetBoard) {
    state.cells = emptyBoard(n); state.unsure = new Set(); state.sel = null;
    state.players = defaultPlayers(n);
  }
  syncSizeButtons();
}

/* ---------- step 1: photo ---------- */

async function loadPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    let img;
    try {
      img = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      img = new Image();
      await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
    }
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const scale = Math.min(1, 1600 / Math.max(iw, ih));
    const cv = document.createElement("canvas");
    cv.width = Math.round(iw * scale);
    cv.height = Math.round(ih * scale);
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    state.photo = { canvas: cv, data: ctx.getImageData(0, 0, cv.width, cv.height) };
  } catch {
    alertStatus("That file couldn't be opened as a photo. Try a JPEG or PNG.");
    return;
  } finally {
    URL.revokeObjectURL(url);
  }

  alertStatus("Finding the board…");
  await new Promise((r) => setTimeout(r, 30)); // let the message paint
  const t0 = performance.now();
  const { width: W, height: H } = state.photo.canvas;
  const last = store.get("corners", null);
  const grid = findGrid(state.photo.data, { hints: last ? [last.map(([x, y]) => [x * W, y * H])] : [] });
  state.corners = grid.corners;
  setSize(grid.size, { resetBoard: false });
  alertStatus("");
  if (grid.score < GRID_CONFIDENT) {
    $("alignNote").textContent = "Couldn't line up the grid on its own. Drag the four dots onto the outer corners of the grid, then tap Score it.";
    show("stepAlign"); drawAlign();
    return;
  }
  await scoreNow(t0);
}

// Fits on real boards score about 0.5; a wrong fit stays under about 0.4.
const GRID_CONFIDENT = 0.42;

function alertStatus(msg) {
  let el = document.querySelector("#stepShoot .status");
  if (!el) { el = document.createElement("div"); el.className = "status"; el.setAttribute("role", "status"); $("stepShoot").append(el); }
  el.textContent = msg;
}

for (const id of ["shoot", "pick"]) {
  $(id).addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) loadPhoto(f);
  });
}

$("manualBtn").onclick = () => {
  state.cells = emptyBoard(state.size); state.unsure = new Set(); state.sel = null;
  state.players = defaultPlayers(state.size); state.warped = null;
  $("status").textContent = "Tap each space to add tiles.";
  show("stepResult"); render();
};

/* ---------- step 2: align ---------- */

const ac = $("alignCanvas"), loupe = $("loupe");
let drag = -1;

function drawAlign() {
  const { canvas: img } = state.photo;
  ac.width = img.width; ac.height = img.height;
  const ctx = ac.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const k = ac.width / Math.max(1, ac.clientWidth);   // canvas px per CSS px
  const map = squareToQuad(state.corners), n = state.size;
  ctx.lineWidth = 1.5 * k;
  ctx.strokeStyle = "rgba(14,124,118,.9)";
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    let [x, y] = map(i / n, 0); ctx.moveTo(x, y); [x, y] = map(i / n, 1); ctx.lineTo(x, y);
    [x, y] = map(0, i / n); ctx.moveTo(x, y); [x, y] = map(1, i / n); ctx.lineTo(x, y);
  }
  ctx.stroke();
  state.corners.forEach(([x, y], i) => {
    ctx.beginPath(); ctx.arc(x, y, 11 * k, 0, Math.PI * 2);
    ctx.fillStyle = i === drag ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.75)"; ctx.fill();
    ctx.lineWidth = 3 * k; ctx.strokeStyle = "#0E7C76"; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 2 * k, 0, Math.PI * 2); ctx.fillStyle = "#0E7C76"; ctx.fill();
  });
}

function toCanvas(e) {
  const r = ac.getBoundingClientRect();
  return [(e.clientX - r.left) * (ac.width / r.width), (e.clientY - r.top) * (ac.height / r.height)];
}

function drawLoupe(e) {
  const [x, y] = state.corners[drag];
  const r = ac.getBoundingClientRect(), box = $("alignBox").getBoundingClientRect();
  const k = ac.width / r.width;
  const ctx = loupe.getContext("2d"), zoom = 3, half = 64 / zoom * k;
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, 128, 128);
  ctx.drawImage(state.photo.canvas, x - half, y - half, half * 2, half * 2, 0, 0, 128, 128);
  ctx.strokeStyle = "#0E7C76"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(64, 50); ctx.lineTo(64, 78); ctx.moveTo(50, 64); ctx.lineTo(78, 64); ctx.stroke();
  let lx = e.clientX - box.left - 64, ly = e.clientY - box.top - 170;
  if (ly < 0) ly = e.clientY - box.top + 50;
  loupe.style.left = Math.max(0, Math.min(box.width - 128, lx)) + "px";
  loupe.style.top = ly + "px";
  loupe.hidden = false;
}

ac.addEventListener("pointerdown", (e) => {
  const p = toCanvas(e), k = ac.width / ac.getBoundingClientRect().width;
  let best = -1, bd = Infinity;
  state.corners.forEach(([x, y], i) => { const d = Math.hypot(x - p[0], y - p[1]); if (d < bd) { bd = d; best = i; } });
  if (bd > 90 * k) return;
  drag = best;
  ac.setPointerCapture(e.pointerId);
  e.preventDefault();
  drawAlign(); drawLoupe(e);
});
ac.addEventListener("pointermove", (e) => {
  if (drag < 0) return;
  const [x, y] = toCanvas(e);
  state.corners[drag] = [Math.max(0, Math.min(ac.width, x)), Math.max(0, Math.min(ac.height, y))];
  drawAlign(); drawLoupe(e);
});
const endDrag = () => { if (drag >= 0) { drag = -1; loupe.hidden = true; drawAlign(); } };
ac.addEventListener("pointerup", endDrag);
ac.addEventListener("pointercancel", endDrag);
window.addEventListener("resize", () => { if (!$("stepAlign").hidden) drawAlign(); });

$("retakeBtn").onclick = () => show("stepShoot");
$("againBtn").onclick = () => show("stepShoot");

$("adjustBtn").onclick = () => {
  $("alignNote").textContent = "Drag the four dots onto the outer corners of the grid so the lines sit on the spaces.";
  show("stepAlign"); drawAlign();
};

$("readBtn").onclick = async () => {
  const btn = $("readBtn");
  btn.disabled = true; btn.textContent = "Reading…";
  await new Promise((r) => setTimeout(r, 30)); // let the label paint
  try { await scoreNow(performance.now()); } finally { btn.disabled = false; btn.textContent = "Score it"; }
};

async function scoreNow(t0) {
  try {
    const n = state.size;
    const { width: pw, height: ph } = state.photo.canvas;
    store.set("corners", state.corners.map(([x, y]) => [x / pw, y / ph]));
    state.warped = balance(warp(state.photo.data, state.corners, n * CELL), n);
    const res = await readBoard(state.warped, n);
    const ms = performance.now() - t0;
    state.cells = res.cells; state.unsure = res.unsure; state.rotation = res.rotation; state.sel = null;
    const seen = [...new Set(res.cells.flat().filter((t) => t && t.owner).map((t) => t.owner))];
    const want = n === 9 ? 2 : seen.length >= 3 ? seen.length : 3;
    state.players = seen.length >= want ? seen : [...new Set([...seen, ...defaultPlayers(n)])].slice(0, Math.max(want, seen.length));
    const u = res.unsure.size;
    $("status").textContent = `Read in ${(ms / 1000).toFixed(1)} s. ` +
      (u ? `${u} space${u > 1 ? "s are" : " is"} marked “?”. Check ${u > 1 ? "those" : "it"} against the board first.` : "Compare with the board and tap anything that's wrong.");
    show("stepResult"); render();
  } catch (err) {
    console.error(err);
    $("status").textContent = "Couldn't read the board. Tap Adjust grid to check the corners, or enter it by hand.";
    show("stepResult"); state.cells ||= emptyBoard(state.size); render();
  }
}

/* ---------- step 3: board, editor, scoring ---------- */

function render() {
  const n = state.size;
  const board = { size: n, cells: state.cells, players: state.players };
  const sc = score(board), issues = check(board);
  const flagged = new Set(issues.flatMap((i) => i.cells || []));

  const b = $("board");
  b.style.setProperty("--n", n);
  b.replaceChildren();
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const t = state.cells[r][c], q = quadrant(r, c, n);
    const el = document.createElement("button");
    el.className = "cell"; el.setAttribute("role", "gridcell");
    if (r % 2 === 0 && c % 2 === 0 && q != null) el.classList.add("nest");
    if (q != null && c < n - 1) { const q2 = quadrant(r, c + 1, n); if (q2 != null && q2 !== q) el.classList.add("qR"); }
    if (q != null && r < n - 1) { const q2 = quadrant(r + 1, c, n); if (q2 != null && q2 !== q) el.classList.add("qB"); }
    if (state.sel && state.sel[0] === r && state.sel[1] === c) el.classList.add("sel");
    if (state.unsure.has(r + "," + c)) el.classList.add("unsure");
    if (flagged.has(r + "," + c)) el.classList.add("flag");
    let desc = "empty";
    if (t?.rock) { el.innerHTML = '<div class="rock"></div>'; desc = "rock"; }
    else if (t) {
      const v = t.v === "W" ? "" : t.v;
      const tile = document.createElement("div");
      tile.className = "tile" + (sc.stranded.has(r + "," + c) ? " strand" : "");
      if (t.owner) {
        const disc = document.createElement("div");
        disc.className = "disc"; disc.style.background = cssColor(t.owner); disc.textContent = v;
        tile.append(disc);
        desc = `${COLORS[t.owner]} ${t.v === "W" ? "wild" : t.v}`;
      } else { tile.textContent = v; desc = `neutral ${v}`; }
      el.append(tile);
    }
    el.setAttribute("aria-label", `Row ${r + 1} column ${c + 1}: ${desc}`);
    el.onclick = () => { state.sel = [r, c]; render(); };
    b.append(el);
  }
  renderEditor();
  renderChecks(issues);
  renderTally(sc);
  $("trainBox").hidden = !state.warped;
  syncSizeButtons();
}

function chip(html, pressed, onclick, extra = "") {
  const bt = document.createElement("button");
  bt.className = "chip " + extra;
  bt.setAttribute("aria-pressed", pressed ? "true" : "false");
  bt.innerHTML = html; bt.onclick = onclick;
  return bt;
}
const colorChip = (p) => `<span class="dot" style="background:${cssColor(p)}"></span>${COLORS[p]}`;

function renderEditor() {
  const pc = $("playerChips");
  pc.replaceChildren(...Object.keys(COLORS).map((k) => chip(colorChip(k), state.players.includes(k), () => {
    state.players = state.players.includes(k) ? state.players.filter((p) => p !== k) : [...state.players, k];
    store.set("players" + state.size, state.players);
    render();
  })));

  if (!state.sel) { $("cellTools").hidden = true; $("selLabel").textContent = "Tap a space to fix it"; return; }
  const [r, c] = state.sel, t = state.cells[r][c];
  $("cellTools").hidden = false;
  $("selLabel").textContent = `Row ${r + 1}, column ${c + 1}`;
  const set = (nt) => { state.cells[r][c] = nt; state.unsure.delete(r + "," + c); render(); };
  const owners = [...new Set([...state.players, ...(t?.owner ? [t.owner] : [])])];
  $("ownerChips").replaceChildren(
    chip("Empty", !t, () => set(null)),
    chip("No shell", t && !t.rock && !t.owner, () => set({ owner: null, v: t && !t.rock && t.v !== "W" ? t.v : 1 })),
    ...owners.map((p) => chip(colorChip(p), t?.owner === p, () => set({ owner: p, v: t && !t.rock ? t.v : 1 }))),
    chip("Rock", !!t?.rock, () => set({ rock: true })),
  );
  const vals = [];
  if (t && !t.rock) {
    for (let v = 1; v <= 8; v++) vals.push(chip(String(v), t.v === v, () => set({ ...t, v }), "num"));
    if (t.owner) vals.push(chip("Wild", t.v === "W", () => set({ ...t, v: "W" })));
  }
  $("valChips").replaceChildren(...vals);
}

function renderChecks(issues) {
  $("checks").replaceChildren(...issues.map((i) => {
    const d = document.createElement("div");
    d.className = "check " + i.level;
    d.textContent = i.text + (i.cells ? " Highlighted on the board." : "");
    return d;
  }));
}

function renderTally({ res, counts }) {
  const P = state.players;
  const totals = P.map((p) => (Number(state.track[p]) || 0) + res[p].strand + res[p].q.reduce((a, b) => a + b, 0));
  const best = Math.max(...totals);
  const rows = P.map((p, i) => {
    const r = res[p];
    return `<tr><td><span class="who">${colorChip(p)}</span></td>
      <td><input class="trk" type="number" inputmode="numeric" id="trk-${p}" aria-label="${COLORS[p]} score track" value="${state.track[p] ?? ""}" placeholder="0"></td>
      <td class="${cls(r.strand)}">${r.strand}</td>
      ${r.q.map((v) => `<td class="${cls(v)}">${fmt(v)}</td>`).join("")}
      <td><b>${totals[i]}</b>${P.length > 1 && totals[i] === best ? '<span class="lead">lead</span>' : ""}</td></tr>`;
  }).join("");
  $("tally").innerHTML = `<thead><tr><th>Player</th><th>Track</th><th title="Stranded tiles">Strand</th>${QNAMES.map((q, i) => `<th title="${q}">Q${i + 1}</th>`).join("")}<th>Total</th></tr></thead><tbody>${rows}</tbody>`;
  P.forEach((p) => {
    const inp = $("trk-" + p);
    inp.addEventListener("change", () => { state.track[p] = inp.value; render(); });
  });

  $("quads").innerHTML = counts.map((cnt, q) => `<div class="q"><span class="label">Q${q + 1} · ${QNAMES[q]}</span>${
    P.map((p) => `<div><span class="who"><span class="dot" style="background:${cssColor(p)}"></span>${cnt[p]} tile${cnt[p] === 1 ? "" : "s"}</span><span class="${cls(res[p].q[q])}">${fmt(res[p].q[q])}</span></div>`).join("")}</div>`).join("");

  $("strands").innerHTML = P.map((p) => {
    const s = res[p].strandTiles;
    return `<div><b>${COLORS[p]}</b> stranded: ${s.length ? s.join(", ") + ` → ${res[p].strand}` : "none"}</div>`;
  }).join("");

  $("rulesNote").textContent = state.size === 9
    ? "2 players, per quadrant: most tiles scores +10. The other player scores −10 with 0 tiles there, −5 with 1–2, −2 with 3, 0 with 4+. Ties split the combined points, rounded down."
    : "3–4 players, per quadrant: 20 / 16 / 10 / 8 for 1st–4th by tile count. You need at least one tile to place. Ties add up the tied places and split, rounded down.";
}

/* ---------- size, keyboard, training ---------- */

for (const s of ["", "b", "c"]) {
  $("sz9" + s).onclick = () => { if (state.size !== 9) { setSize(9, { resetBoard: s === "c" }); s === "b" ? drawAlign() : s === "c" && render(); } };
  $("sz11" + s).onclick = () => { if (state.size !== 11) { setSize(11, { resetBoard: s === "c" }); s === "b" ? drawAlign() : s === "c" && render(); } };
}
$("clearBtn").onclick = () => { setSize(state.size, { resetBoard: true }); state.warped = null; render(); };

document.addEventListener("keydown", (e) => {
  if ($("stepResult").hidden || !state.sel || e.target.tagName === "INPUT") return;
  const [r, c] = state.sel, n = state.size, t = state.cells[r][c];
  const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
  if (mv) { e.preventDefault(); state.sel = [Math.min(n - 1, Math.max(0, r + mv[0])), Math.min(n - 1, Math.max(0, c + mv[1]))]; render(); return; }
  if (/^[1-8]$/.test(e.key)) { state.cells[r][c] = { owner: t && !t.rock ? t.owner : null, v: +e.key }; state.unsure.delete(r + "," + c); render(); }
  if (e.key === "Backspace" || e.key === "Delete") { state.cells[r][c] = null; render(); }
});

$("trainBtn").onclick = () => {
  const n = state.size, cv = document.createElement("canvas");
  cv.width = cv.height = n * CELL;
  cv.getContext("2d").putImageData(state.warped, 0, 0);
  const payload = {
    app: "arribada-scorer", version: 1, savedAt: new Date().toISOString(),
    size: n, players: state.players, rotation: state.rotation, corners: state.corners,
    photoSize: [state.photo.canvas.width, state.photo.canvas.height],
    cells: state.cells,
    crops: trainingCrops(state.warped, n, state.rotation, state.cells),
    warpedJpeg: cv.toDataURL("image/jpeg", 0.9),
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `arribada-training-${payload.savedAt.replace(/[:.]/g, "-").slice(0, 19)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  $("trainBtn").textContent = "Saved. Thanks!";
  setTimeout(() => ($("trainBtn").textContent = "Save for training"), 3000);
};

/* ---------- start ---------- */
setSize(state.size, { resetBoard: true });
loadModel().catch(() => {}); // warm the model while the user takes the photo
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
