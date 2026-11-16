import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from '../skills/imagegen-swarm/scripts/scoped-env.mjs';
import { STDIO_DISCARD, STDIO_PIPE } from '../skills/imagegen-swarm/scripts/stdio-modes.mjs';
import {
  DEFAULT_STYLE_THRESHOLD, bestStyleEngines, recordStyleScore, resolveSeriesConfig, splitJobsDocument,
  styleDecision, styleMeans, stylePrompt, styleRefsForEngine, styleRouteAllows, takeStyleScreen,
} from '../skills/imagegen-swarm/scripts/series-policy.mjs';

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'imagegen-swarm', 'scripts');
const PY = process.env.PYTHON ?? 'python3';
let failed = 0;
const measured = [];

function check(name, fn) {
  try {
    fn();
    console.log('ok  ' + name);
  } catch (error) {
    failed++;
    console.error('FAIL ' + name);
    console.error(error.stack || error);
  }
}

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

check('style text is the same for every subject', () => {
  const guide = 'flat gouache, muted teal and cream, thick ink outlines';
  const cat = stylePrompt('a cat at a window', guide);
  const dog = stylePrompt('a dog on a train', guide);
  const marker = '\n\nSTYLE GUIDE (apply to every image in this series; do not change the subject):\n' + guide;
  assert.ok(cat.endsWith(marker));
  assert.ok(dog.endsWith(marker));
  assert.equal(cat.slice(cat.indexOf('\n\nSTYLE GUIDE')), dog.slice(dog.indexOf('\n\nSTYLE GUIDE')));
  assert.ok(cat.startsWith('a cat at a window'));
  assert.equal(cat.includes('a dog'), false);
});

check('style references fill free slots and otherwise stay text-only', () => {
  const full = styleRefsForEngine({ maxRefs: 1, jobRefs: ['subject.png'], styleRefs: ['anchor.png'], video: false });
  assert.deepEqual(full.refs, ['subject.png']);
  assert.equal(full.textOnly, true);
  assert.match(full.reason, /reference limit 1/);

  const open = styleRefsForEngine({ maxRefs: 3, jobRefs: ['subject.png'], styleRefs: ['a.png', 'b.png'], video: false });
  assert.deepEqual(open.refs, ['a.png', 'b.png', 'subject.png']);
  assert.equal(open.textOnly, false);
  assert.equal(open.reason, null);

  const partial = styleRefsForEngine({ maxRefs: 3, jobRefs: ['s1.png', 's2.png'], styleRefs: ['a.png', 'b.png'], video: false });
  assert.deepEqual(partial.refs, ['a.png', 's1.png', 's2.png']);
  assert.equal(partial.attached, 1);
  assert.match(partial.reason, /1 of 2/);

  const video = styleRefsForEngine({ maxRefs: 10, jobRefs: ['frame.png'], styleRefs: ['anchor.png'], video: true });
  assert.equal(video.textOnly, true);
  assert.deepEqual(video.refs, ['frame.png']);
});

check('a low score requeues until max retries, then fails', () => {
  assert.deepEqual(styleDecision({ score: 0.9, threshold: 0.72, redos: 0, maxRetries: 2 }), { action: 'keep', redos: 0 });
  assert.deepEqual(styleDecision({ score: 0.2, threshold: 0.72, redos: 0, maxRetries: 2 }), { action: 'redo', redos: 1 });
  assert.deepEqual(styleDecision({ score: 0.2, threshold: 0.72, redos: 2, maxRetries: 2 }), { action: 'fail', redos: 3 });
  assert.equal(DEFAULT_STYLE_THRESHOLD, 0.72);
});

check('series routing prefers the engine with the higher mean while it has a free lane', () => {
  const scores = {};
  recordStyleScore(scores, 'gemini', 0.4);
  recordStyleScore(scores, 'jimeng', 0.91);
  recordStyleScore(scores, 'jimeng', 0.89);
  assert.deepEqual(bestStyleEngines(scores, ['gemini', 'jimeng', 'grok']), ['jimeng']);
  assert.equal(styleMeans(scores).jimeng.n, 2);
  const shared = {
    enabled: true, video: false, allowedEngines: null, prefer: 'consistent', scores,
    fitting: ['gemini', 'jimeng'], free: { gemini: true, jimeng: true },
  };
  assert.equal(styleRouteAllows({ ...shared, engine: 'gemini' }), false);
  assert.equal(styleRouteAllows({ ...shared, engine: 'jimeng' }), true);
  assert.equal(styleRouteAllows({ ...shared, engine: 'gemini', free: { gemini: true, jimeng: false } }), true);
  assert.equal(styleRouteAllows({ ...shared, engine: 'grok', allowedEngines: ['jimeng'] }), false);
  assert.equal(styleRouteAllows({ ...shared, engine: 'gemini', prefer: 'off' }), true);
  assert.equal(styleRouteAllows({ enabled: false, engine: 'grok', allowedEngines: ['jimeng'] }), true);
});

check('series turns on from the flag, from true, or from a style string', () => {
  const off = resolveSeriesConfig({ flag: false, fileSeries: null, root: null, cli: {} });
  assert.equal(off.enabled, false);
  const fromFlag = resolveSeriesConfig({ flag: true, fileSeries: null, root: null, cli: { style: 'flat ink' } });
  assert.equal(fromFlag.enabled, true);
  assert.equal(fromFlag.style, 'flat ink');
  assert.equal(fromFlag.threshold, 0.72);
  assert.equal(fromFlag.maxRetries, 2);
  assert.equal(fromFlag.prefer, 'consistent');
  const doc = splitJobsDocument({
    series: { style: 'same heroine', ref: ['hero.png'], threshold: 0.5, max_retries: 1, engines: ['gemini'], prefer: 'off' },
    jobs: [{ id: 'cover', prompt: 'at a window' }],
  });
  const fromFile = resolveSeriesConfig({ flag: false, fileSeries: doc.series, root: doc.root, cli: {} });
  assert.equal(fromFile.enabled, true);
  assert.deepEqual(fromFile.styleRefs, ['hero.png']);
  assert.equal(fromFile.threshold, 0.5);
  assert.deepEqual(fromFile.engines, ['gemini']);
  assert.equal(fromFile.prefer, 'off');
  const shorthand = resolveSeriesConfig({ flag: false, fileSeries: 'thick outlines', root: null, cli: {} });
  assert.equal(shorthand.style, 'thick outlines');
  assert.throws(() => resolveSeriesConfig({ flag: true, fileSeries: null, root: null, cli: {} }), /style guide/);
});

await checkAsync('the first text-only image becomes the anchor and the next one is scored', async () => {
  const series = { styleRefs: [], visualAnchor: null, anchorJob: null, threshold: 0.72, maxRetries: 1 };
  const scores = [];
  const first = takeStyleScreen(series, { id: 'a', styleRedos: 0 }, async () => { scores.push('a'); return 0.1; }, async () => {});
  const claimed = await first;
  assert.equal(claimed.claim, true);
  assert.equal(claimed.score, null);
  let released = false;
  const second = takeStyleScreen(series, { id: 'b', styleRedos: 0 }, async () => { scores.push('b'); return 0.2; }, async () => {
    if (!released) {
      released = true;
      series.visualAnchor = 'kept.png';
    }
  });
  const scored = await second;
  assert.equal(scored.action, 'redo');
  assert.equal(scored.score, 0.2);
  assert.deepEqual(scores, ['b']);
});

async function writePng(file, rgb) {
  const r = await run(PY, ['-c', 'from PIL import Image\nimport sys\nImage.new("RGB", (64, 64), tuple(int(n) for n in sys.argv[1].split(","))).save(sys.argv[2])', rgb, file]);
  assert.equal(r.code, 0, r.stderr);
}

async function styleOf(output, anchors) {
  const r = await run(PY, [path.join(here, 'imgtool.py'), 'style', output, ...anchors]);
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
}

await checkAsync('palette score is 1 for the same color and low for a complementary color', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'style-score-'));
  try {
    const blue = path.join(dir, 'blue.png');
    const red = path.join(dir, 'red.png');
    const wide = path.join(dir, 'wide.png');
    await writePng(blue, '20,40,220');
    const large = await run(PY, ['-c', 'from PIL import Image\nimport sys\nImage.new("RGB", (320, 180), (20, 40, 220)).save(sys.argv[1])', wide]);
    assert.equal(large.code, 0, large.stderr);
    await writePng(red, '220,30,40');
    const same = await styleOf(blue, [blue]);
    const resized = await styleOf(wide, [blue]);
    const complement = await styleOf(red, [blue]);
    const best = await styleOf(blue, [red, blue]);
    measured.push({ same: same.score, resized: resized.score, complement: complement.score, bestOfTwo: best.score });
    console.log('measured palette scores ' + JSON.stringify(measured.at(-1)));
    assert.equal(same.method, 'palette-histogram');
    assert.ok(same.score >= 0.99, JSON.stringify(same));
    assert.ok(resized.score >= 0.99, JSON.stringify(resized));
    assert.ok(complement.score < DEFAULT_STYLE_THRESHOLD, JSON.stringify(complement));
    assert.ok(complement.score < 0.5, JSON.stringify(complement));
    assert.equal(best.score, same.score);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const FAKE = [
  "import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
  "import path from 'node:path';",
  "const args = process.argv.slice(2);",
  "function value(flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : ''; }",
  "const refs = [];",
  "for (let i = 0; i < args.length; i++) if (args[i] === '--ref') refs.push(args[i + 1]);",
  "const out = value('--out');",
  "appendFileSync(process.env.IMAGE_GEN_FAKE_LOG, JSON.stringify({ script: path.basename(process.argv[1]), prompt: value('--prompt'), refs }) + '\\n');",
  "mkdirSync(path.dirname(out), { recursive: true });",
  "const statePath = process.env.IMAGE_GEN_FAKE_STATE;",
  "let state = {};",
  "try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch { state = {}; }",
  "const key = path.basename(process.argv[1]);",
  "const n = state[key] ?? 0;",
  "state[key] = n + 1;",
  "writeFileSync(statePath, JSON.stringify(state));",
  "copyFileSync(n === 0 ? process.env.IMAGE_GEN_FAKE_FIRST : process.env.IMAGE_GEN_FAKE_REST, out);",
  "process.stdout.write(JSON.stringify({ status: 'ok' }) + '\\n');",
].join('\n');

async function fakeBatch(dir, jobs, args, colors) {
  const scripts = path.join(dir, 'scripts');
  const off = path.join(dir, 'off');
  await mkdir(scripts);
  await mkdir(off);
  await writeFile(path.join(scripts, 'gemini-image.mjs'), FAKE);
  await writeFile(path.join(scripts, 'grok-image.mjs'), FAKE);
  const blue = path.join(dir, 'blue.png');
  const red = path.join(dir, 'red.png');
  await writePng(blue, '20,40,220');
  await writePng(red, '220,30,40');
  await writeFile(path.join(dir, 'jobs.json'), JSON.stringify(jobs));
  const log = path.join(dir, 'calls.jsonl');
  await writeFile(log, '');
  const env = {
    IMAGE_GEN_TEST_SCRIPTS: 'yes',
    IMAGE_GEN_SCRIPT_DIR: scripts,
    IMAGE_GEN_ENGINE_OFF: off,
    IMAGE_GEN_FAKE_LOG: log,
    IMAGE_GEN_FAKE_STATE: path.join(dir, 'state.json'),
    IMAGE_GEN_FAKE_FIRST: colors?.first ?? blue,
    IMAGE_GEN_FAKE_REST: colors?.rest ?? blue,
  };
  const r = await run(process.execPath, [path.join(here, 'batch.mjs'), '--jobs', path.join(dir, 'jobs.json'), '--out', path.join(dir, 'out'), ...args], env);
  const events = r.stdout.trim() ? r.stdout.trim().split('\n').map(line => JSON.parse(line)) : [];
  const calls = (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { code: r.code, stderr: r.stderr, events, calls, blue, red };
}

await checkAsync('series mode screens a mock engine and requeues a low score', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'series-batch-'));
  try {
    const anchor = path.join(dir, 'anchor-src.png');
    await writePng(anchor, '20,40,220');
    const runResult = await fakeBatch(dir, [{ id: 'cover', prompt: 'the heroine at a window' }], [
      '--engines', 'gemini', '--lanes', 'gemini=1', '--series', '--style', 'flat gouache, thick outlines',
      '--style-ref', anchor, '--style-threshold', '0.72', '--style-retries', '2',
    ], { first: path.join(dir, 'red.png'), rest: path.join(dir, 'blue.png') });
    assert.equal(runResult.code, 0, JSON.stringify(runResult.events) + runResult.stderr);
    const summary = runResult.events.at(-1);
    assert.equal(summary.event, 'summary');
    assert.equal(summary.keep.generated, 2);
    assert.equal(summary.keep.kept, 1);
    assert.equal(summary.keep.redone, 0);
    assert.equal(summary.keep.style_redos, 1);
    assert.equal(summary.keep.generated, summary.keep.kept + summary.keep.redone + summary.keep.duplicates + summary.keep.style_redos);
    assert.equal(typeof summary.delivery_seconds, 'number');
    assert.ok(summary.delivery_seconds >= summary.elapsed_seconds);
    assert.equal(summary.series.method, 'palette-histogram');
    assert.equal(summary.series.threshold, 0.72);
    assert.deepEqual(summary.series.text_only_engines, []);
    assert.ok(summary.results === undefined);
    const redo = runResult.events.find(event => event.event === 'style_redo');
    assert.ok(redo.score < 0.72);
    const results = JSON.parse(await readFile(path.join(dir, 'out', 'batch-results.json'), 'utf8'));
    assert.equal(results.keep.style_redos, 1);
    assert.equal(results.delivery_seconds, summary.delivery_seconds);
    assert.ok(results.results.done[0].style_score >= 0.72);
    assert.equal(results.results.attempts.filter(attempt => attempt.outcome === 'style_redo').length, 1);
    assert.equal(runResult.calls.length, 2);
    assert.ok(runResult.calls[0].prompt.includes('STYLE GUIDE'));
    assert.ok(runResult.calls[0].prompt.includes('the heroine at a window'));
    assert.equal(runResult.calls[0].prompt, runResult.calls[1].prompt);
    assert.equal(runResult.calls[0].refs[0], anchor);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await checkAsync('a full reference slot logs text-only and still receives the style guide', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'series-text-'));
  try {
    await writeFile(path.join(dir, 'style.txt'), 'thick ink outlines\n');
    const runResult = await fakeBatch(dir, [{ id: 'cover', prompt: 'the heroine', ref: ['subject.png'] }], [
      '--engines', 'grok', '--lanes', 'grok=1', '--series', '--style-file', path.join(dir, 'style.txt'),
      '--style-ref', path.join(dir, 'blue.png'), '--style-threshold', '0.01',
    ]);
    assert.equal(runResult.code, 0, JSON.stringify({ events: runResult.events, stderr: runResult.stderr }));
    const textOnly = runResult.events.find(event => event.event === 'style_text_only');
    assert.equal(textOnly.engine, 'grok');
    assert.match(textOnly.reason, /reference limit 1/);
    assert.equal(runResult.calls.length, 1);
    assert.ok(runResult.calls[0].prompt.includes('STYLE GUIDE'));
    assert.ok(runResult.calls[0].prompt.includes('thick ink outlines'));
    assert.equal(runResult.calls[0].refs.length, 1);
    assert.ok(runResult.calls[0].refs[0].endsWith('subject.png'));
    assert.deepEqual(runResult.events.at(-1).series.text_only_engines, ['grok']);
    const results = JSON.parse(await readFile(path.join(dir, 'out', 'batch-results.json'), 'utf8'));
    assert.deepEqual(results.series.text_only_engines, ['grok']);
    assert.equal(results.keep.style_redos, 0);
    assert.equal(typeof results.delivery_seconds, 'number');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await checkAsync('series.engines skips the other mock engine', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'series-few-'));
  try {
    const runResult = await fakeBatch(dir, [
      { id: 'cover-1', prompt: 'at a window' },
      { id: 'cover-2', prompt: 'on a train' },
    ], [
      '--engines', 'gemini,grok', '--lanes', 'gemini=1,grok=1', '--series', '--style', 'flat gouache',
      '--series-engines', 'gemini', '--style-threshold', '0.01',
    ]);
    assert.equal(runResult.code, 0, JSON.stringify(runResult.events) + runResult.stderr);
    assert.equal(runResult.calls.every(call => call.script === 'gemini-image.mjs'), true);
    assert.equal(runResult.events.some(event => event.engine === 'grok' && event.event === 'start'), false);
    const cat = runResult.calls.find(call => call.prompt.startsWith('at a window'));
    const dog = runResult.calls.find(call => call.prompt.startsWith('on a train'));
    assert.equal(cat.prompt.slice(cat.prompt.indexOf('\n\nSTYLE GUIDE')), dog.prompt.slice(dog.prompt.indexOf('\n\nSTYLE GUIDE')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await checkAsync('a jobs file with series true enables the anchor without the flag', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'series-file-'));
  try {
    const runResult = await fakeBatch(dir, {
      series: true,
      style: 'same heroine, thick outlines',
      jobs: [{ id: 'cover', prompt: 'at a window' }],
    }, ['--engines', 'gemini', '--lanes', 'gemini=1', '--style-threshold', '0.01']);
    assert.equal(runResult.code, 0, JSON.stringify(runResult.events) + runResult.stderr);
    assert.ok(runResult.calls[0].prompt.includes('same heroine, thick outlines'));
    const results = JSON.parse(await readFile(path.join(dir, 'out', 'batch-results.json'), 'utf8'));
    assert.equal(results.results.done[0].style_anchor, true);
    assert.equal(results.keep.kept, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await checkAsync('without series mode the prompt and keep counts stay unchanged', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'series-off-'));
  try {
    const runResult = await fakeBatch(dir, [{ id: 'one', prompt: 'a lemon slice' }], [
      '--engines', 'gemini', '--lanes', 'gemini=1',
    ]);
    assert.equal(runResult.code, 0, JSON.stringify(runResult.events) + runResult.stderr);
    assert.equal(runResult.calls[0].prompt, 'a lemon slice');
    assert.equal(runResult.calls[0].refs.length, 0);
    const summary = runResult.events.at(-1);
    assert.equal(summary.series, undefined);
    assert.deepEqual(summary.keep, { generated: 1, kept: 1, redone: 0, duplicates: 0, style_redos: 0, resumed: 0 });
    assert.equal(typeof summary.delivery_seconds, 'number');
    assert.equal(summary.events === undefined, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await checkAsync('series mode without a style guide fails before an engine starts', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'series-miss-'));
  try {
    const runResult = await fakeBatch(dir, [{ id: 'one', prompt: 'a lemon slice' }], [
      '--engines', 'gemini', '--lanes', 'gemini=1', '--series',
    ]);
    assert.notEqual(runResult.code, 0);
    assert.equal(runResult.calls.length, 0);
    assert.match(runResult.events.at(-1).reason, /style guide/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

if (failed) {
  console.error(failed + ' test(s) failed');
  process.exit(1);
}
console.log('series tests ok');
if (measured.length) console.log('measured ' + JSON.stringify(measured));
