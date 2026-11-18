// Hermetic tests for the series-mode consistency scores (imgtool.py style / backends).
// They need Python with Pillow only. The optional CLIP backend is tested through its fallback,
// and through a stub onnxruntime module when numpy happens to be installed. No network, no model.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from '../skills/imagegen-swarm/scripts/scoped-env.mjs';
import { STDIO_DISCARD, STDIO_PIPE } from '../skills/imagegen-swarm/scripts/stdio-modes.mjs';
import {
  DEFAULT_STYLE_METHOD, DEFAULT_STYLE_THRESHOLD, STYLE_METHODS, normalizeStyleMethod, resolveSeriesConfig,
  resolveStyleMethod, styleResult, takeStyleScreen,
} from '../skills/imagegen-swarm/scripts/series-policy.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const here = path.join(root, 'skills', 'imagegen-swarm', 'scripts');
const fixtures = path.join(root, 'tests', 'fixtures', 'series-consistency');
const PY = process.env.PYTHON ?? 'python3';
const IMGTOOL = path.join(here, 'imgtool.py');
// Never pick up a real model from the developer's home directory.
const NO_CLIP = { IMAGE_GEN_CLIP_MODEL: path.join(tmpdir(), 'imagegen-swarm-no-such-model.onnx') };
let failed = 0;

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log('ok  ' + name);
  } catch (error) {
    failed++;
    console.error('FAIL ' + name);
    console.error(error.stack || error);
  }
}

function check(name, fn) {
  return checkAsync(name, async () => fn());
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: childEnv(env), stdio: [STDIO_DISCARD, STDIO_PIPE, STDIO_PIPE] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

async function style(output, anchors, method, env = NO_CLIP) {
  const args = [IMGTOOL, 'style', output, ...anchors];
  if (method) args.push('--method', method);
  const r = await run(PY, args, env);
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
}

// A flat cartoon "character", the same drawing moved and slightly recolored, and the anchor's
// own pixels sorted by brightness: exactly the same colors, no character at all.
const DRAW = `
import sys
from PIL import Image, ImageDraw
def character(dx=0, dy=0, tint=0):
    im = Image.new("RGB", (256, 256), (240, 232, 214))
    d = ImageDraw.Draw(im)
    teal = (40 + tint, 128, 128 - tint); ink = (30, 30, 40); coral = (220, 110 + tint, 90)
    d.ellipse((88 + dx, 30 + dy, 168 + dx, 110 + dy), fill=teal, outline=ink, width=5)
    d.ellipse((108 + dx, 58 + dy, 120 + dx, 70 + dy), fill=ink)
    d.ellipse((136 + dx, 58 + dy, 148 + dx, 70 + dy), fill=ink)
    d.rectangle((100 + dx, 112 + dy, 156 + dx, 190 + dy), fill=coral, outline=ink, width=5)
    for x0, y0, x1, y1 in ((100, 120, 60, 170), (156, 120, 196, 170), (112, 190, 96, 240), (144, 190, 160, 240)):
        d.line((x0 + dx, y0 + dy, x1 + dx, y1 + dy), fill=ink, width=7)
    return im
a = character()
a.save(sys.argv[1] + "/anchor.png")
character(10, 6, 12).save(sys.argv[1] + "/same.png")
raw = a.tobytes()
px = sorted((raw[i], raw[i + 1], raw[i + 2]) for i in range(0, len(raw), 3))
px.sort(key=lambda p: 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2])
twin = Image.new("RGB", a.size)
twin.frombytes(b"".join(bytes(p) for p in px))
twin.save(sys.argv[1] + "/palette-twin.png")
Image.new("RGB", (64, 64), (20, 40, 220)).save(sys.argv[1] + "/blue.png")
`;

async function drawFixtures(dir) {
  const r = await run(PY, ['-c', DRAW, dir]);
  assert.equal(r.code, 0, r.stderr);
  return {
    anchor: path.join(dir, 'anchor.png'), same: path.join(dir, 'same.png'),
    twin: path.join(dir, 'palette-twin.png'), blue: path.join(dir, 'blue.png'),
  };
}

const work = await mkdtemp(path.join(tmpdir(), 'series-consistency-'));
const drawn = await drawFixtures(work);
const fx = name => path.join(fixtures, name);

const FAKE = [
  "import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
  "import path from 'node:path';",
  "const args = process.argv.slice(2);",
  "function value(flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : ''; }",
  "const out = value('--out');",
  "appendFileSync(process.env.IMAGE_GEN_FAKE_LOG, JSON.stringify({ prompt: value('--prompt') }) + '\\n');",
  "mkdirSync(path.dirname(out), { recursive: true });",
  "const statePath = process.env.IMAGE_GEN_FAKE_STATE;",
  "let state = {};",
  "try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch { state = {}; }",
  "const n = state.n ?? 0;",
  "state.n = n + 1;",
  "writeFileSync(statePath, JSON.stringify(state));",
  "copyFileSync(n === 0 ? process.env.IMAGE_GEN_FAKE_FIRST : process.env.IMAGE_GEN_FAKE_REST, out);",
  "process.stdout.write(JSON.stringify({ status: 'ok' }) + '\\n');",
].join('\n');

async function fakeBatch(name, jobs, args, files, extraEnv = NO_CLIP) {
  const dir = path.join(work, 'batch-' + name);
  const scripts = path.join(dir, 'scripts');
  const off = path.join(dir, 'off');
  await mkdir(scripts, { recursive: true });
  await mkdir(off);
  await writeFile(path.join(scripts, 'gemini-image.mjs'), FAKE);
  await writeFile(path.join(dir, 'jobs.json'), JSON.stringify(jobs));
  const log = path.join(dir, 'calls.jsonl');
  await writeFile(log, '');
  const env = {
    IMAGE_GEN_TEST_SCRIPTS: 'yes', IMAGE_GEN_SCRIPT_DIR: scripts, IMAGE_GEN_ENGINE_OFF: off,
    IMAGE_GEN_FAKE_LOG: log, IMAGE_GEN_FAKE_STATE: path.join(dir, 'state.json'),
    IMAGE_GEN_FAKE_FIRST: files.first, IMAGE_GEN_FAKE_REST: files.rest, ...extraEnv,
  };
  const r = await run(process.execPath, [path.join(here, 'batch.mjs'), '--jobs', path.join(dir, 'jobs.json'), '--out', path.join(dir, 'out'), ...args], env);
  const events = r.stdout.trim() ? r.stdout.trim().split('\n').map(line => JSON.parse(line)) : [];
  const calls = (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean);
  let results = null;
  try { results = JSON.parse(await readFile(path.join(dir, 'out', 'batch-results.json'), 'utf8')); } catch { results = null; }
  return { code: r.code, stderr: r.stderr, events, calls, results };
}

// ---------------------------------------------------------------- policy

await check('method names normalize, and palette is the 1.3.x score', () => {
  assert.equal(DEFAULT_STYLE_METHOD, 'auto');
  assert.deepEqual(STYLE_METHODS, ['auto', 'structure', 'clip', 'palette-histogram']);
  assert.equal(normalizeStyleMethod(undefined), 'auto');
  assert.equal(normalizeStyleMethod(''), 'auto');
  assert.equal(normalizeStyleMethod('palette'), 'palette-histogram');
  assert.equal(normalizeStyleMethod('Structure'), 'structure');
  assert.throws(() => normalizeStyleMethod('sift'), /series method must be one of/);
});

await check('series method comes from the jobs file, and the CLI wins', () => {
  const fromFile = resolveSeriesConfig({ flag: false, fileSeries: { style: 'ink', method: 'palette' }, root: null, cli: {} });
  assert.equal(fromFile.method, 'palette-histogram');
  assert.equal(fromFile.threshold, DEFAULT_STYLE_THRESHOLD);
  const cli = resolveSeriesConfig({ flag: false, fileSeries: { style: 'ink', method: 'palette' }, root: null, cli: { method: 'structure' } });
  assert.equal(cli.method, 'structure');
  const old = resolveSeriesConfig({ flag: true, fileSeries: null, root: null, cli: { style: 'ink' } });
  assert.equal(old.method, 'auto');
  assert.throws(() => resolveSeriesConfig({ flag: true, fileSeries: null, root: null, cli: { style: 'ink', method: 'orb' } }), /series method/);
});

await check('auto falls back to structure; an explicit clip request fails when CLIP is missing', () => {
  const missing = { methods: { clip: { available: false, reason: 'model file not found' } } };
  const present = { methods: { clip: { available: true } } };
  assert.equal(resolveStyleMethod('auto', missing).method, 'structure');
  assert.match(resolveStyleMethod('auto', missing).reason, /model file not found/);
  assert.equal(resolveStyleMethod('auto', present).method, 'clip');
  assert.equal(resolveStyleMethod('clip', present).method, 'clip');
  assert.throws(() => resolveStyleMethod('clip', missing), /clip is not available: model file not found/);
  assert.deepEqual(resolveStyleMethod('palette', missing), { method: 'palette-histogram', reason: null });
});

await check('styleResult accepts a bare number or the imgtool object', () => {
  assert.deepEqual(styleResult(0.5), { score: 0.5, detail: null });
  const full = styleResult({ method: 'structure', score: 0.8, raw_score: 0.5, components: { ssim: 0.1 } });
  assert.equal(full.score, 0.8);
  assert.deepEqual(full.detail, { method: 'structure', raw_score: 0.5, components: { ssim: 0.1 } });
  assert.throws(() => styleResult({}), /not a number/);
});

await checkAsync('takeStyleScreen passes components through with the decision', async () => {
  const series = { styleRefs: ['a.png'], threshold: 0.72, maxRetries: 2 };
  const screened = await takeStyleScreen(series, { id: 'x', styleRedos: 0 },
    async () => ({ method: 'structure', score: 0.5, raw_score: 0.29, components: { ssim: 0.1, hog: 0.4, palette: 0.9 } }));
  assert.equal(screened.action, 'redo');
  assert.equal(screened.score, 0.5);
  assert.deepEqual(screened.detail.components, { ssim: 0.1, hog: 0.4, palette: 0.9 });
});

// ---------------------------------------------------------------- imgtool

await checkAsync('imgtool style without --method keeps the 1.3.x palette output', async () => {
  const result = await style(drawn.same, [drawn.anchor]);
  assert.equal(result.method, 'palette-histogram');
  assert.equal(result.color_weight, 0.8);
  assert.equal(result.structure_weight, 0.2);
  assert.equal(result.raw_score, result.score);
  assert.deepEqual(Object.keys(result.components).sort(), ['histogram', 'luminance_grid']);
  const alias = await style(drawn.same, [drawn.anchor], 'palette');
  assert.equal(alias.method, 'palette-histogram');
  assert.equal(alias.score, result.score);
});

await checkAsync('structure scores an identical image 1 and reports its components', async () => {
  const result = await style(drawn.anchor, [drawn.anchor], 'structure');
  assert.equal(result.method, 'structure');
  assert.equal(result.score, 1);
  assert.deepEqual(result.weights, { ssim: 0.4, hog: 0.5, palette: 0.1 });
  assert.deepEqual(Object.keys(result.components).sort(), ['hog', 'palette', 'ssim']);
  assert.equal(result.raw_operating_point, 0.42);
});

await checkAsync('a palette-matched different picture passes the palette score and fails structure', async () => {
  const palette = await style(drawn.twin, [drawn.anchor], 'palette-histogram');
  const structure = await style(drawn.twin, [drawn.anchor], 'structure');
  const same = await style(drawn.same, [drawn.anchor], 'structure');
  console.log('measured ' + JSON.stringify({ palette_twin: palette.score, structure_twin: structure.score, structure_same: same.score }));
  assert.ok(palette.score >= 0.9, JSON.stringify(palette));
  assert.ok(structure.score < DEFAULT_STYLE_THRESHOLD - 0.1, JSON.stringify(structure));
  assert.ok(same.score >= DEFAULT_STYLE_THRESHOLD + 0.1, JSON.stringify(same));
});

await checkAsync('the best of several anchors is used and its index is reported', async () => {
  const result = await style(drawn.same, [drawn.twin, drawn.anchor], 'structure');
  const direct = await style(drawn.same, [drawn.anchor], 'structure');
  assert.equal(result.anchor, 1);
  assert.equal(result.score, direct.score);
});

await checkAsync('real fixtures: structure keeps a same-landmark pair the palette score rejects', async () => {
  const palette = await style(fx('tower-b.jpg'), [fx('tower-a.jpg')], 'palette-histogram');
  const structure = await style(fx('tower-b.jpg'), [fx('tower-a.jpg')], 'structure');
  assert.ok(palette.score < DEFAULT_STYLE_THRESHOLD, JSON.stringify(palette));
  assert.ok(structure.score >= DEFAULT_STYLE_THRESHOLD, JSON.stringify(structure));
  // Regression values recorded with Pillow 13 (tolerance covers resampling differences).
  assert.ok(Math.abs(structure.raw_score - 0.532) < 0.02, JSON.stringify(structure));
});

await checkAsync('real fixtures: the same subject ranks above every different subject', async () => {
  for (const [anchor, same, others] of [
    ['tower-a.jpg', 'tower-b.jpg', ['pepper-a.jpg', 'pepper-b.jpg', 'tux-a.jpg', 'eiffel-a.jpg']],
    ['pepper-a.jpg', 'pepper-b.jpg', ['tower-a.jpg', 'tower-b.jpg', 'tux-a.jpg', 'eiffel-a.jpg']],
  ]) {
    const kept = await style(fx(same), [fx(anchor)], 'structure');
    assert.ok(kept.score >= DEFAULT_STYLE_THRESHOLD, anchor + ' ' + JSON.stringify(kept));
    for (const other of others) {
      const different = await style(fx(other), [fx(anchor)], 'structure');
      assert.ok(different.score < kept.score, anchor + ' vs ' + other + ' ' + different.score + ' >= ' + kept.score);
    }
  }
});

await checkAsync('backends reports structure, and CLIP missing without downloading anything', async () => {
  const r = await run(PY, [IMGTOOL, 'backends'], NO_CLIP);
  assert.equal(r.code, 0, r.stderr);
  const backends = JSON.parse(r.stdout);
  assert.equal(backends.methods.structure.available, true);
  assert.equal(backends.methods['palette-histogram'].available, true);
  assert.equal(backends.methods.clip.available, false);
  assert.match(backends.methods.clip.reason, /missing Python package|model file not found/);
  assert.equal(backends.auto, 'structure');
  assert.equal(backends.default_threshold, 0.72);
  const auto = await style(drawn.same, [drawn.anchor], 'auto');
  assert.equal(auto.method, 'structure');
  assert.equal(auto.requested_method, 'auto');
  const clip = await run(PY, [IMGTOOL, 'style', drawn.same, drawn.anchor, '--method', 'clip'], NO_CLIP);
  assert.notEqual(clip.code, 0);
  assert.match(clip.stderr, /clip method unavailable/);
  const unknown = await run(PY, [IMGTOOL, 'style', drawn.same, drawn.anchor, '--method', 'sift'], NO_CLIP);
  assert.notEqual(unknown.code, 0);
  assert.match(unknown.stderr, /unknown style method/);
});

// A stand-in onnxruntime: the embedding is a 4x4 grid of channel means of the normalized input.
const STUB = `
import numpy as np
class SessionOptions:
    log_severity_level = 0
class _Input:
    name = "pixel_values"
class InferenceSession:
    def __init__(self, path, options=None, providers=None):
        self.path = path
    def get_inputs(self):
        return [_Input()]
    def run(self, outputs, feeds):
        x = feeds["pixel_values"]
        assert x.shape == (1, 3, 224, 224), x.shape
        v = x[0].reshape(3, 4, 56, 4, 56).mean(axis=(2, 4)).ravel() + 3.0
        return [v[None].astype(np.float32)]
`;
const numpy = await run(PY, ['-c', 'import numpy']);
if (numpy.code !== 0) {
  console.log('skip clip plumbing tests: numpy is not installed (the optional backend is covered by the fallback tests)');
} else {
  const stubDir = path.join(work, 'stub');
  await mkdir(stubDir);
  await writeFile(path.join(stubDir, 'onnxruntime.py'), STUB);
  const model = path.join(work, 'fake-model.onnx');
  await writeFile(model, 'not a real model');
  const withStub = { PYTHONPATH: stubDir, IMAGE_GEN_CLIP_MODEL: model };

  await checkAsync('clip plumbing with a stub runtime: identical image scores 1, auto picks clip', async () => {
    const r = await run(PY, [IMGTOOL, 'backends', '--verify'], withStub);
    assert.equal(r.code, 0, r.stderr);
    const backends = JSON.parse(r.stdout);
    assert.equal(backends.methods.clip.available, true);
    assert.equal(backends.methods.clip.known_model, null);
    assert.equal(backends.auto, 'clip');
    const same = await style(drawn.anchor, [drawn.anchor], 'clip', withStub);
    assert.equal(same.method, 'clip');
    assert.equal(same.score, 1);
    assert.equal(same.raw_operating_point, 0.65);
    assert.deepEqual(Object.keys(same.components), ['clip_cosine']);
    const auto = await style(drawn.same, [drawn.anchor], 'auto', withStub);
    assert.equal(auto.method, 'clip');
    assert.ok(auto.score > 0 && auto.score <= 1);
  });

  await checkAsync('batch auto resolves to clip once when the backend is present', async () => {
    const result = await fakeBatch('clip', [{ id: 'cover', prompt: 'the heroine' }],
      ['--engines', 'gemini', '--lanes', 'gemini=1', '--series', '--style', 'ink', '--style-ref', drawn.anchor],
      { first: drawn.same, rest: drawn.same }, withStub);
    assert.equal(result.code, 0, JSON.stringify(result.events) + result.stderr);
    const summary = result.events.at(-1);
    assert.equal(summary.series.method, 'clip');
    assert.equal(summary.series.method_requested, 'auto');
    assert.deepEqual(summary.series.components, { clip_cosine: 1 });
  });
}

// ---------------------------------------------------------------- batch

await checkAsync('default series batch uses structure, redoes the palette twin and reports components', async () => {
  const result = await fakeBatch('auto', [{ id: 'cover', prompt: 'the heroine at a window' }],
    ['--engines', 'gemini', '--lanes', 'gemini=1', '--series', '--style', 'flat gouache', '--style-ref', drawn.anchor],
    { first: drawn.twin, rest: drawn.same });
  assert.equal(result.code, 0, JSON.stringify(result.events) + result.stderr);
  const summary = result.events.at(-1);
  assert.equal(summary.series.method, 'structure');
  assert.equal(summary.series.method_requested, 'auto');
  assert.match(summary.series.method_reason, /CLIP backend not installed/);
  assert.deepEqual(summary.series.components, { ssim: 0.4, hog: 0.5, palette: 0.1 });
  assert.equal(summary.series.threshold, 0.72);
  assert.equal(summary.keep.style_redos, 1);
  const redo = result.events.find(event => event.event === 'style_redo');
  assert.equal(redo.method, 'structure');
  assert.ok(redo.score < 0.72);
  assert.ok(redo.components.palette > 0.9, JSON.stringify(redo));
  const lanes = result.events.find(event => event.event === 'lanes');
  assert.equal(lanes.series.method, 'structure');
  const done = result.results.results.done[0];
  assert.ok(done.style_score >= 0.72);
  assert.equal(typeof done.style_raw_score, 'number');
  assert.deepEqual(Object.keys(done.style_components).sort(), ['hog', 'palette', 'ssim']);
  const attempt = result.results.results.attempts.find(item => item.outcome === 'style_redo');
  assert.ok(attempt.style_components);
  assert.equal(result.calls.length, 2);
});

await checkAsync('series.method palette in the jobs file keeps the 1.3.x score', async () => {
  const result = await fakeBatch('palette', {
    series: { style: 'flat gouache', ref: [drawn.anchor], method: 'palette' },
    jobs: [{ id: 'cover', prompt: 'the heroine' }],
  }, ['--engines', 'gemini', '--lanes', 'gemini=1'], { first: drawn.twin, rest: drawn.twin });
  assert.equal(result.code, 0, JSON.stringify(result.events) + result.stderr);
  const summary = result.events.at(-1);
  assert.equal(summary.series.method, 'palette-histogram');
  assert.equal(summary.series.method_requested, 'palette-histogram');
  assert.equal(summary.series.method_reason, undefined);
  assert.equal(summary.keep.style_redos, 0);
  assert.deepEqual(Object.keys(result.results.results.done[0].style_components).sort(), ['histogram', 'luminance_grid']);
});

await checkAsync('--style-method clip without the optional backend fails before any engine starts', async () => {
  const result = await fakeBatch('clip-missing', [{ id: 'cover', prompt: 'the heroine' }],
    ['--engines', 'gemini', '--lanes', 'gemini=1', '--series', '--style', 'ink', '--style-method', 'clip'],
    { first: drawn.same, rest: drawn.same });
  assert.notEqual(result.code, 0);
  assert.equal(result.calls.length, 0);
  assert.match(result.events.at(-1).reason, /clip is not available/);
});

await checkAsync('--style-method without series mode is rejected', async () => {
  const result = await fakeBatch('no-series', [{ id: 'cover', prompt: 'the heroine' }],
    ['--engines', 'gemini', '--lanes', 'gemini=1', '--style-method', 'structure'],
    { first: drawn.same, rest: drawn.same });
  assert.notEqual(result.code, 0);
  assert.equal(result.calls.length, 0);
  assert.match(result.events.at(-1).reason, /series options need --series/);
});

await rm(work, { recursive: true, force: true });
if (failed) {
  console.error(failed + ' test(s) failed');
  process.exit(1);
}
console.log('series consistency tests ok');
