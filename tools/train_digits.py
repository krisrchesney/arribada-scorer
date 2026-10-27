"""Train the tile digit reader and write model/digits.json.

Training data:
  * synthetic tiles rendered with system fonts (always), and
  * real crops exported from the app ("Save for training"), any
    training/*.json files. Real crops are weighted up because they look
    exactly like what the app sees.

Usage:  python tools/train_digits.py [--epochs 12] [--synthetic 40000]
Needs numpy, pillow, torch.
"""
import argparse, base64, glob, json, math, os, random

import numpy as np
import torch
import torch.nn as nn
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CROP = 24
CLASSES = ["1", "2", "3", "4", "5", "6", "7", "8", "blank"]
FONT_DIR = r"C:\Windows\Fonts"
FONTS = ["GOTHIC.TTF", "GOTHICB.TTF", "segoeui.ttf", "segoeuisl.ttf", "seguisb.ttf", "calibri.ttf",
         "calibril.ttf", "Candara.ttf", "corbel.ttf", "corbell.ttf", "arial.ttf", "verdana.ttf",
         "tahoma.ttf", "trebuc.ttf", "bahnschrift.ttf", "ARLRDBD.TTF", "CENTURY.TTF"]

# Stroke-drawn shapes in a unit box (x right, y down).
OPEN_STROKES = {
    "4": [[(0.62, 0.0), (0.0, 0.68), (1.0, 0.68)], [(0.7, 0.35), (0.7, 1.0)]],
    "4u": [[(0.12, 0.0), (0.12, 0.62), (1.0, 0.62)], [(0.72, 0.15), (0.72, 1.0)]],
    "1": [[(0.2, 0.22), (0.55, 0.0), (0.55, 1.0)]],
}

TILE_BG =[(236, 228, 210), (245, 240, 228), (225, 214, 190), (240, 232, 220)]
SHELLS = [(229, 80, 122), (138, 92, 201), (163, 188, 23), (30, 159, 168), (200, 90, 150), (120, 80, 170)]


def normalize(g):
    """Same contrast normalization as normalizeCrop() in js/vision.js."""
    s = np.sort(g.ravel())
    lo, hi = s[int(len(s) * 0.02)], s[int(len(s) * 0.9)]
    span = max(hi - lo, 60.0)
    return np.clip((hi - g) / span, 0, 1).astype(np.float32)


def render(label, rng):
    """Render one 24x24 crop the way the app would see it (before normalizing)."""
    S = 96  # 4x supersampled
    on_shell = rng.random() < 0.6
    if on_shell:
        base = np.array(SHELLS[rng.randrange(len(SHELLS))], float)
        base = np.clip(base * rng.uniform(0.7, 1.15) + np.array([rng.uniform(-20, 20) for _ in range(3)]), 0, 255)
    bg = TILE_BG[rng.randrange(len(TILE_BG))]
    im = Image.new("RGB", (S, S), (233, 200, 140))  # sand behind
    d = ImageDraw.Draw(im)
    # turtle body (white tile) roughly centered
    ox, oy = rng.uniform(-10, 10), rng.uniform(-10, 10)
    R = rng.uniform(62, 80)
    d.ellipse([S / 2 - R + ox, S / 2 - R + oy, S / 2 + R + ox, S / 2 + R + oy], fill=bg)
    if on_shell:
        Rs = rng.uniform(48, 72)
        d.ellipse([S / 2 - Rs + ox, S / 2 - Rs + oy, S / 2 + Rs + ox, S / 2 + Rs + oy], fill=tuple(int(x) for x in base))
    ink = (rng.randrange(20, 70),) * 3
    if on_shell and rng.random() < 0.5:
        ink = tuple(int(x * 0.25) for x in base)
    # small edge numbers on neutral 1, 7, 8 tiles ("10" / "0")
    if not on_shell and rng.random() < 0.5:
        f = ImageFont.truetype(os.path.join(FONT_DIR, "arial.ttf"), int(rng.uniform(9, 14)))
        for (ex, ey) in [(S / 2 + ox, oy - 2), (S / 2 + ox, S - 10 + oy), (ox - 2, S / 2 + oy), (S - 10 + ox, S / 2 + oy)]:
            if rng.random() < 0.6:
                d.text((ex, ey), rng.choice(["0", "10"]), fill=ink, font=f, anchor="mm")
    if label != "blank":
        font = ImageFont.truetype(os.path.join(FONT_DIR, rng.choice(FONTS)), int(rng.uniform(50, 80)))
        layer = Image.new("L", (S, S), 0)
        cx, cy = S / 2 + ox * 0.6 + rng.uniform(-6, 6), S / 2 + oy * 0.6 + rng.uniform(-6, 6)
        if label in OPEN_STROKES and rng.random() < 0.45:
            # The real tiles use an open-top 4 and a flagged 1, which few system fonts have.
            h = rng.uniform(30, 48); w = h * rng.uniform(0.6, 0.8); lw = int(rng.uniform(3, 7))
            dl = ImageDraw.Draw(layer)
            shape = rng.choice([k for k in OPEN_STROKES if k[0] == label])
            for stroke in OPEN_STROKES[shape]:
                dl.line([(cx + (x - 0.5) * w, cy + (y - 0.5) * h) for x, y in stroke], fill=255, width=lw, joint="curve")
        else:
            ImageDraw.Draw(layer).text((cx, cy), label, fill=255, font=font, anchor="mm",
                                       stroke_width=rng.choice([0, 0, 1, 2]), stroke_fill=255)
        if label == "6" and rng.random() < 0.3:  # some printings underline the 6
            bb = layer.getbbox()
            if bb:
                ImageDraw.Draw(layer).line([bb[0], bb[3] + 3, bb[2], bb[3] + 3], fill=255, width=3)
        layer = layer.rotate(rng.uniform(-12, 12), resample=Image.BILINEAR)
        im.paste(Image.new("RGB", (S, S), ink), (0, 0), layer)
    if rng.random() < 0.4:  # glare
        g = Image.new("L", (S, S), 0)
        gx, gy, gr = rng.uniform(10, 86), rng.uniform(10, 86), rng.uniform(6, 18)
        ImageDraw.Draw(g).ellipse([gx - gr, gy - gr, gx + gr, gy + gr], fill=int(rng.uniform(60, 160)))
        im.paste(Image.new("RGB", (S, S), (255, 255, 255)), (0, 0), g.filter(ImageFilter.GaussianBlur(6)))
    im = im.filter(ImageFilter.GaussianBlur(rng.uniform(0.5, 3.0)))
    im = im.resize((CROP, CROP), Image.BILINEAR)
    a = np.asarray(im, float)
    a = a + np.random.default_rng(rng.randrange(1 << 30)).normal(0, rng.uniform(1, 8), a.shape)
    a = a * rng.uniform(0.6, 1.2) + rng.uniform(-25, 25)
    gray = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    return normalize(np.clip(gray, 0, 255))


def synthetic(n, seed=1):
    rng = random.Random(seed)
    X = np.zeros((n, 1, CROP, CROP), np.float32)
    y = np.zeros(n, np.int64)
    for i in range(n):
        k = rng.randrange(len(CLASSES))
        X[i, 0] = render(CLASSES[k], rng)
        y[i] = k
    return X, y


def real_crops():
    X, y = [], []
    for f in sorted(glob.glob(os.path.join(ROOT, "training", "*.json"))):
        data = json.load(open(f))
        for t in data["crops"]:
            if t["label"] not in CLASSES:
                continue
            X.append(np.array(t["crop"], np.float32).reshape(1, CROP, CROP) / 255)
            y.append(CLASSES.index(t["label"]))
    if not X:
        return np.zeros((0, 1, CROP, CROP), np.float32), np.zeros(0, np.int64)
    return np.stack(X), np.array(y)


def shift_aug(X):
    """Small random shifts so the few real crops generalize."""
    out = np.zeros_like(X)
    for i in range(len(X)):
        dx, dy = np.random.randint(-2, 3, 2)
        out[i] = np.roll(np.roll(X[i], dy, axis=1), dx, axis=2)
    return out


class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.c1 = nn.Conv2d(1, 8, 3, padding=1)
        self.c2 = nn.Conv2d(8, 16, 3, padding=1)
        self.f1 = nn.Linear(16 * 6 * 6, 64)
        self.f2 = nn.Linear(64, len(CLASSES))

    def forward(self, x):
        x = torch.max_pool2d(torch.relu(self.c1(x)), 2)
        x = torch.max_pool2d(torch.relu(self.c2(x)), 2)
        return self.f2(torch.relu(self.f1(x.flatten(1))))


def b64(t):
    return base64.b64encode(t.detach().numpy().astype("<f4").tobytes()).decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--synthetic", type=int, default=40000)
    ap.add_argument("--real-weight", type=int, default=30)
    args = ap.parse_args()
    torch.manual_seed(0); np.random.seed(0)

    Xs, ys = synthetic(args.synthetic)
    Xr, yr = real_crops()
    print(f"synthetic {len(Xs)}, real {len(Xr)}")
    # Hold out a third of the real crops (by sample) to report real accuracy.
    idx = np.random.permutation(len(Xr))
    hold = idx[: len(idx) // 3] if len(Xr) >= 30 else np.array([], int)
    trainr = np.setdiff1d(idx, hold)
    Xtr = [Xs] + [shift_aug(Xr[trainr]) for _ in range(args.real_weight)]
    ytr = [ys] + [yr[trainr]] * args.real_weight
    X = torch.tensor(np.concatenate(Xtr)); y = torch.tensor(np.concatenate(ytr))

    net = Net()
    opt = torch.optim.Adam(net.parameters(), 2e-3)
    for ep in range(args.epochs):
        perm = torch.randperm(len(X))
        tot = 0
        for i in range(0, len(X), 256):
            b = perm[i:i + 256]
            loss = nn.functional.cross_entropy(net(X[b]), y[b])
            opt.zero_grad(); loss.backward(); opt.step(); tot += loss.item() * len(b)
        msg = f"epoch {ep + 1}: loss {tot / len(X):.3f}"
        if len(hold):
            with torch.no_grad():
                acc = (net(torch.tensor(Xr[hold])).argmax(1).numpy() == yr[hold]).mean()
            msg += f", held-out real accuracy {acc:.1%} ({len(hold)} crops)"
        print(msg)

    with torch.no_grad():
        Xv, yv = synthetic(3000, seed=99)
        print(f"synthetic validation accuracy {(net(torch.tensor(Xv)).argmax(1).numpy() == yv).mean():.1%}")
        if len(Xr):
            pred = net(torch.tensor(Xr)).argmax(1).numpy()
            print(f"all real crops accuracy (includes training) {(pred == yr).mean():.1%}")

    layers = [
        {"type": "conv", "out": 8, "in": 1, "w": b64(net.c1.weight), "b": b64(net.c1.bias)},
        {"type": "conv", "out": 16, "in": 8, "w": b64(net.c2.weight), "b": b64(net.c2.bias)},
        {"type": "fc", "out": 64, "in": 576, "w": b64(net.f1.weight), "b": b64(net.f1.bias)},
        {"type": "fc", "out": len(CLASSES), "in": 64, "w": b64(net.f2.weight), "b": b64(net.f2.bias)},
    ]
    os.makedirs(os.path.join(ROOT, "model"), exist_ok=True)
    out = os.path.join(ROOT, "model", "digits.json")
    json.dump({"classes": CLASSES, "size": CROP, "trainedOnRealCrops": int(len(trainr)), "layers": layers}, open(out, "w"))
    print("wrote", out, os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    main()
