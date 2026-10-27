// Tiny CNN digit reader. Weights come from tools/train_digits.py.
// Architecture: conv3x3(8)-relu-pool2, conv3x3(16)-relu-pool2, fc64-relu, fc(classes).

let modelPromise = null;

function f32(b64) {
  const bin = atob(b64), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Float32Array(buf.buffer);
}

export function loadModel(url = new URL("../model/digits.json", import.meta.url)) {
  modelPromise ||= fetch(url).then((r) => {
    if (!r.ok) throw new Error("Digit model missing");
    return r.json();
  }).then((m) => ({
    classes: m.classes, size: m.size,
    layers: m.layers.map((l) => ({ ...l, w: f32(l.w), b: f32(l.b) })),
  }));
  return modelPromise;
}

function conv(x, C, H, W, l) {
  const { out: O, w, b } = l, y = new Float32Array(O * H * W);
  for (let o = 0; o < O; o++) for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) {
    let s = b[o];
    for (let c = 0; c < C; c++) for (let di = -1; di <= 1; di++) {
      const ii = i + di; if (ii < 0 || ii >= H) continue;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj; if (jj < 0 || jj >= W) continue;
        s += x[(c * H + ii) * W + jj] * w[((o * C + c) * 3 + di + 1) * 3 + dj + 1];
      }
    }
    y[(o * H + i) * W + j] = s > 0 ? s : 0;
  }
  return y;
}

function pool(x, C, H, W) {
  const h = H >> 1, w = W >> 1, y = new Float32Array(C * h * w);
  for (let c = 0; c < C; c++) for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
    const p = (c * H + 2 * i) * W + 2 * j;
    y[(c * h + i) * w + j] = Math.max(x[p], x[p + 1], x[p + W], x[p + W + 1]);
  }
  return y;
}

function fc(x, l, relu) {
  const { out: O, in: I, w, b } = l, y = new Float32Array(O);
  for (let o = 0; o < O; o++) {
    let s = b[o];
    for (let i = 0; i < I; i++) s += x[i] * w[o * I + i];
    y[o] = relu && s < 0 ? 0 : s;
  }
  return y;
}

export function predict(model, crop) {
  let x = crop, C = 1, H = model.size, W = model.size;
  for (const l of model.layers) {
    if (l.type === "conv") { x = pool(conv(x, C, H, W, l), l.out, H, W); C = l.out; H >>= 1; W >>= 1; }
  }
  const fcs = model.layers.filter((l) => l.type === "fc");
  fcs.forEach((l, i) => { x = fc(x, l, i < fcs.length - 1); });
  const mx = Math.max(...x), e = Array.from(x, (v) => Math.exp(v - mx)), z = e.reduce((a, b) => a + b, 0);
  const probs = e.map((v) => v / z);
  const k = probs.indexOf(Math.max(...probs));
  const name = model.classes[k];
  return { label: name === "blank" ? "blank" : Number(name), prob: probs[k], probs };
}

export async function classifyMany(crops) {
  const model = await loadModel();
  return crops.map((c) => predict(model, c));
}
