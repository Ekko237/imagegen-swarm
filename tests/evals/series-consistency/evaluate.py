"""Score labeled image pairs with every series-consistency candidate (validation only).

Usage:
  python3 fetch.py <cache-dir>
  python3 evaluate.py <cache-dir> [--work <dir>] [--json results.json]
                      [--clip-model file.onnx]... [--dino-model file.onnx]

Pairs:
  same-real             two images of the same group in dataset.json (character, mascot, logo, landmark)
  diff-real             images from two groups of different style families
  diff-same-family      two different characters by the same artist / from the same film
  same-augment          an image and a crop + flip + hue shift + brightness change of it
  diff-palette-matched  image A and a different-group image B recolored to A's palette
                        (per-channel histogram matching): the case the old palette score accepts

The shipped methods come from skills/imagegen-swarm/scripts/imgtool.py, so the numbers describe
the code that runs in batch.mjs. phash, dhash, LBP, hue-saturation histograms, ORB and DINOv2 are
comparison candidates only and live in this file. numpy, onnxruntime and opencv are optional here.
"""
import argparse
import glob
import json
import math
import os
import random
import sys
import time

from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "skills", "imagegen-swarm", "scripts"))
import imgtool  # noqa: E402


# ---------------------------------------------------------------- comparison-only candidates

def gray(rgb, w, h):
    return list(rgb.convert("L").resize((w, h), imgtool._BOX).tobytes())


def phash_bits(rgb):
    n = 32
    px = gray(rgb, n, n)
    cos = [[math.cos(math.pi * (2 * x + 1) * u / (2 * n)) for x in range(n)] for u in range(8)]
    rows = [[sum(px[y * n + x] * cos[u][x] for x in range(n)) for u in range(8)] for y in range(n)]
    coef = [sum(rows[y][u] * cos[v][y] for y in range(n)) for v in range(8) for u in range(8)][1:]
    median = sorted(coef)[len(coef) // 2]
    return [c > median for c in coef]


def dhash_bits(rgb):
    px = gray(rgb, 9, 8)
    return [px[r * 9 + c] > px[r * 9 + c + 1] for r in range(8) for c in range(8)]


def bit_similarity(a, b):
    return 1.0 - sum(x != y for x, y in zip(a, b)) / len(a)


def lbp_hist(g, n=64):
    hist = [0.0] * 256
    for y in range(1, n - 1):
        for x in range(1, n - 1):
            i = y * n + x
            code = 0
            for k, d in enumerate((-n - 1, -n, -n + 1, 1, n + 1, n, n - 1, -1)):
                if g[i + d] >= g[i]:
                    code |= 1 << k
            hist[code] += 1
    total = sum(hist) or 1.0
    return [v / total for v in hist]


def hs_hist(rgb):
    hsv = rgb.resize((64, 64), imgtool._BOX).convert("HSV").tobytes()
    hist = [0.0] * 40
    for i in range(0, len(hsv), 3):
        h, s, v = hsv[i], hsv[i + 1], hsv[i + 2]
        if s < 40 or v < 40:
            hist[36 + min(3, v // 64)] += 1
        else:
            hist[(h * 12 // 256) * 3 + min(2, (s - 40) * 3 // 216)] += 1
    total = sum(hist) or 1.0
    return [v / total for v in hist]


def intersection(a, b):
    return sum(min(x, y) for x, y in zip(a, b))


def candidate_features(path):
    rgb = imgtool.load_rgb(path)
    g = gray(rgb, 64, 64)
    return {"phash": phash_bits(rgb), "dhash": dhash_bits(rgb), "lbp": lbp_hist(g), "hs": hs_hist(rgb)}


class Orb:
    def __init__(self):
        import cv2
        import numpy
        self.cv2, self.np = cv2, numpy
        self.orb = cv2.ORB_create(nfeatures=1000)
        self.matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
        self.cache = {}

    def feat(self, path):
        if path not in self.cache:
            img = self.np.array(imgtool.load_rgb(path).convert("L"))
            scale = 512 / max(img.shape)
            img = self.cv2.resize(img, None, fx=scale, fy=scale)
            self.cache[path] = self.orb.detectAndCompute(img, None)
        return self.cache[path]

    def inliers(self, a, b):
        (ka, da), (kb, db) = self.feat(a), self.feat(b)
        if da is None or db is None or len(ka) < 8 or len(kb) < 8:
            return 0
        good = [m[0] for m in self.matcher.knnMatch(da, db, k=2) if len(m) == 2 and m[0].distance < 0.75 * m[1].distance]
        if len(good) < 8:
            return 0
        src = self.np.float32([ka[m.queryIdx].pt for m in good])
        dst = self.np.float32([kb[m.trainIdx].pt for m in good])
        _, mask = self.cv2.findHomography(src, dst, self.cv2.RANSAC, 5.0)
        return int(mask.sum()) if mask is not None else 0

    def score(self, a, b):
        return max(self.inliers(a, b), self.inliers(b, a))


class Dino:
    """DINOv2-small CLS embedding (resize 256, center crop 224, ImageNet normalization)."""

    def __init__(self, model):
        import numpy
        import onnxruntime
        self.np = numpy
        self.session = onnxruntime.InferenceSession(model, providers=["CPUExecutionProvider"])

    def embed(self, path):
        np = self.np
        img = imgtool.load_rgb(path)
        w, h = img.size
        s = 256 / min(w, h)
        img = img.resize((max(224, round(w * s)), max(224, round(h * s))), imgtool._BICUBIC)
        w, h = img.size
        left, top = (w - 224) // 2, (h - 224) // 2
        img = img.crop((left, top, left + 224, top + 224))
        x = (np.asarray(img, np.float32) / 255.0 - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
        v = self.session.run(None, {"pixel_values": x.transpose(2, 0, 1)[None]})[0][0, 0]
        return v / np.linalg.norm(v)


# ---------------------------------------------------------------- pairs

def histogram_match(source, reference):
    src, ref = imgtool.load_rgb(source), imgtool.load_rgb(reference)
    channels = []
    for sc, rc in zip(src.split(), ref.split()):
        def cdf(hist):
            total, acc, out = float(sum(hist)), 0, []
            for v in hist:
                acc += v
                out.append(acc / total)
            return out
        cs, cr = cdf(sc.histogram()), cdf(rc.histogram())
        lut, j = [], 0
        for i in range(256):
            while j < 255 and cr[j] < cs[i]:
                j += 1
            lut.append(j)
        channels.append(sc.point(lut))
    return Image.merge("RGB", channels)


def augment(path, rng):
    img = imgtool.load_rgb(path)
    w, h = img.size
    s = rng.uniform(0.75, 0.9)
    cw, ch = int(w * s), int(h * s)
    x, y = rng.randint(0, w - cw), rng.randint(0, h - ch)
    img = img.crop((x, y, x + cw, y + ch))
    if rng.random() < 0.5:
        img = ImageOps.mirror(img)
    hue, sat, val = img.convert("HSV").split()
    shift = rng.randint(-12, 12)
    hue = hue.point(lambda v: (v + shift) % 256)
    img = Image.merge("HSV", (hue, sat, val)).convert("RGB")
    factor = rng.uniform(0.85, 1.15)
    return img.point(lambda v: max(0, min(255, int(v * factor))))


def build_pairs(cache, work, seed=7):
    dataset = json.load(open(os.path.join(HERE, "dataset.json"), encoding="utf-8"))
    items = []
    for group in dataset["groups"]:
        files = sorted(glob.glob(os.path.join(cache, group["id"], "*.jpg")) + glob.glob(os.path.join(cache, group["id"], "*.png")))
        if len(files) != len(group["files"]):
            raise SystemExit(f"{group['id']}: expected {len(group['files'])} images in the cache, found {len(files)} (run fetch.py)")
        items += [{"path": f, "group": group["id"], "family": group["family"]} for f in files]
    rng = random.Random(seed)
    os.makedirs(work, exist_ok=True)
    pairs = []
    for i, a in enumerate(items):
        for b in items[i + 1:]:
            if a["group"] == b["group"]:
                subset = "same-real"
            else:
                subset = "diff-same-family" if a["family"] == b["family"] else "diff-real"
            pairs.append({"a": a["path"], "b": b["path"], "label": int(subset.startswith("same")), "subset": subset})
    count = 0
    for group in dataset["groups"]:
        for item in [it for it in items if it["group"] == group["id"]][:3]:
            target = os.path.join(work, f"aug-{count:03d}.jpg")
            augment(item["path"], rng).save(target, quality=90)
            pairs.append({"a": item["path"], "b": target, "label": 1, "subset": "same-augment"})
            count += 1
    for n in range(48):
        a, b = rng.sample(items, 2)
        while a["group"] == b["group"]:
            a, b = rng.sample(items, 2)
        target = os.path.join(work, f"pal-{n:03d}.jpg")
        histogram_match(b["path"], a["path"]).save(target, quality=90)
        pairs.append({"a": a["path"], "b": target, "label": 0, "subset": "diff-palette-matched"})
    return items, pairs


# ---------------------------------------------------------------- metrics

def auc(pos, neg):
    values = sorted([(v, 1) for v in pos] + [(v, 0) for v in neg])
    rank_sum, i = 0.0, 0
    while i < len(values):
        j = i
        while j < len(values) and values[j][0] == values[i][0]:
            j += 1
        rank = (i + j + 1) / 2.0
        rank_sum += rank * sum(1 for k in range(i, j) if values[k][1])
        i = j
    return (rank_sum - len(pos) * (len(pos) + 1) / 2.0) / (len(pos) * len(neg))


def rates(pos, neg, threshold):
    fpr = sum(v >= threshold for v in neg) / len(neg)
    fnr = sum(v < threshold for v in pos) / len(pos)
    return fpr, fnr


def youden(pos, neg):
    best = None
    for t in sorted(set(round(v, 3) for v in pos + neg)):
        fpr, fnr = rates(pos, neg, t)
        if best is None or (1 - fpr) + (1 - fnr) > best[0]:
            best = ((1 - fpr) + (1 - fnr), t, fpr, fnr)
    return best[1:]


def quantiles(values, qs=(0.1, 0.25, 0.5, 0.75, 0.9)):
    ordered = sorted(values)
    return [round(ordered[min(len(ordered) - 1, int(q * len(ordered)))], 3) for q in qs]


SUBSETS = {
    "all": ("label", 1, 0),
    "real": ("subset", "same-real", "diff-real"),
    "same-family": ("subset", "same-real", "diff-same-family"),
    "palette-matched": ("subset", "same-real", "diff-palette-matched"),
    "augment": ("subset", "same-augment", "diff-real"),
}


def split(pairs, name, key):
    field, pos_value, neg_value = SUBSETS[key]
    pos = [p["scores"][name] for p in pairs if p[field] == pos_value]
    neg = [p["scores"][name] for p in pairs if p[field] == neg_value]
    return pos, neg


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("cache")
    parser.add_argument("--work", default=None)
    parser.add_argument("--json", default=None)
    parser.add_argument("--clip-model", action="append", default=[])
    parser.add_argument("--dino-model", default=None)
    args = parser.parse_args()
    work = args.work or os.path.join(args.cache, "_synthetic")
    items, pairs = build_pairs(args.cache, work)
    paths = sorted({p["a"] for p in pairs} | {p["b"] for p in pairs})
    print(f"{len(items)} images in {len({i['group'] for i in items})} groups, {len(pairs)} pairs", file=sys.stderr)

    timings = {}
    started = time.time()
    structure = {p: imgtool.structure_features(p) for p in paths}
    timings["structure features per image (s)"] = (time.time() - started) / len(paths)
    cands = {p: candidate_features(p) for p in paths}
    embeddings = {}
    for model in args.clip_model:
        os.environ["IMAGE_GEN_CLIP_MODEL"] = model
        started = time.time()
        clip = imgtool._Clip()
        name = "clip:" + os.path.basename(model)
        embeddings[name] = {p: clip.embed(p) for p in paths}
        timings[name + " per image (s)"] = (time.time() - started) / len(paths)
    if args.dino_model:
        dino = Dino(args.dino_model)
        embeddings["dinov2:" + os.path.basename(args.dino_model)] = {p: dino.embed(p) for p in paths}
    try:
        orb = Orb()
    except Exception as exc:  # opencv missing: skip this comparator
        print("orb skipped:", exc, file=sys.stderr)
        orb = None

    for pair in pairs:
        a, b = pair["a"], pair["b"]
        raw, parts = imgtool.structure_parts(structure[a], structure[b])
        palette, _, grid = imgtool._palette_parts(structure[a]["palette"], structure[b]["palette"])
        ca, cb = cands[a], cands[b]
        scores = {
            "palette-histogram (1.3.x)": palette, "structure (new)": raw,
            "ssim": parts["ssim"], "hog": parts["hog"], "luminance grid": grid,
            "phash": bit_similarity(ca["phash"], cb["phash"]), "dhash": bit_similarity(ca["dhash"], cb["dhash"]),
            "lbp": intersection(ca["lbp"], cb["lbp"]), "hue-sat hist": intersection(ca["hs"], cb["hs"]),
        }
        if orb:
            scores["orb inliers"] = orb.score(a, b)
        for name, vectors in embeddings.items():
            scores[name] = float(vectors[a] @ vectors[b])
        pair["scores"] = scores

    methods = list(pairs[0]["scores"].keys())
    counts = {}
    for p in pairs:
        counts[p["subset"]] = counts.get(p["subset"], 0) + 1
    report = {"images": len(items), "pairs": len(pairs), "subset_counts": counts, "timings": timings, "methods": {}}
    for name in methods:
        entry = {"auc": {key: round(auc(*split(pairs, name, key)), 3) for key in SUBSETS}}
        pos, neg = split(pairs, name, "all")
        t, fpr, fnr = youden(pos, neg)
        entry["youden"] = {"raw_threshold": t, "fpr": round(fpr, 3), "fnr": round(fnr, 3)}
        entry["same_quantiles"] = quantiles(pos)
        entry["diff_quantiles"] = quantiles(neg)
        report["methods"][name] = entry
    shipped = {"palette-histogram (1.3.x)": 0.72, "structure (new)": imgtool.RAW_OPERATING_POINT["structure"]}
    for name in methods:
        if name.startswith("clip:"):
            shipped[name] = imgtool.RAW_OPERATING_POINT["clip"]
    for name, t in shipped.items():
        pos, neg = split(pairs, name, "all")
        fpr, fnr = rates(pos, neg, t)
        _, pm = split(pairs, name, "palette-matched")
        _, fam = split(pairs, name, "same-family")
        report["methods"][name]["shipped"] = {
            "raw_threshold": t, "fpr": round(fpr, 3), "fnr": round(fnr, 3),
            "palette_matched_accepted": round(sum(v >= t for v in pm) / len(pm), 3),
            "same_family_accepted": round(sum(v >= t for v in fam) / len(fam), 3),
        }
    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=1)

    print("| method | " + " | ".join(SUBSETS) + " |")
    print("|---|" + "---:|" * len(SUBSETS))
    for name in methods:
        print(f"| {name} | " + " | ".join(f"{report['methods'][name]['auc'][k]:.3f}" for k in SUBSETS) + " |")
    print()
    print("| method | raw threshold | FPR | FNR | palette-matched accepted | same-family accepted |")
    print("|---|---:|---:|---:|---:|---:|")
    for name in shipped:
        s = report["methods"][name]["shipped"]
        print(f"| {name} | {s['raw_threshold']} | {s['fpr']:.3f} | {s['fnr']:.3f} | {s['palette_matched_accepted']:.3f} | {s['same_family_accepted']:.3f} |")
    print()
    print("| method | Youden threshold | FPR | FNR | same p10/p25/p50/p75/p90 | different p10/p25/p50/p75/p90 |")
    print("|---|---:|---:|---:|---|---|")
    for name in methods:
        m = report["methods"][name]
        print(f"| {name} | {m['youden']['raw_threshold']} | {m['youden']['fpr']:.3f} | {m['youden']['fnr']:.3f} | "
              f"{' / '.join(map(str, m['same_quantiles']))} | {' / '.join(map(str, m['diff_quantiles']))} |")
    print()
    print("subset counts:", json.dumps(counts))
    print("timings:", json.dumps({k: round(v, 4) for k, v in timings.items()}))


if __name__ == "__main__":
    main()
