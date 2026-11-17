import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { childEnv } from '../skills/imagegen-swarm/scripts/scoped-env.mjs';
import { STDIO_QUIET, removableWorkPath, sandboxMayWiden } from '../skills/imagegen-swarm/scripts/safety.mjs';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isInvokedDirectly } from '../skills/imagegen-swarm/scripts/direct.mjs';
import {
  RATE_LIMIT_STRIKES, STEAL_FACTOR, applyEngineFailure, attemptDisposition, classifyEngineError,
  failureText, keepCounts, medianSeconds, paidBudgetLeft, paidMayTake, prepareOutputDir, shouldSteal,
} from '../skills/imagegen-swarm/scripts/batch.mjs';
import { engineSpec, loadApiConfig, monthSpent, openaiSize } from '../skills/imagegen-swarm/scripts/api-image.mjs';
import {
  extractGenerated, parseAgyReply, parseEncodedArg, parseToolArgs, parseTranscript, transcriptFile,
} from '../skills/imagegen-swarm/scripts/gemini-image.mjs';

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'imagegen-swarm', 'scripts');
const exampleWrapper = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'lovart-lv.example.sh');
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log("ok  " + (name));
  } catch (error) {
    failed++;
    console.error("FAIL " + (name));
    console.error(error.stack || error);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log("ok  " + (name));
  } catch (error) {
    failed++;
    console.error("FAIL " + (name));
    console.error(error.stack || error);
  }
}

const LONG = 'a detailed scene, '.repeat(80);

check('truncated tool prompt still parses and keeps the image', () => {
  const promptArg = JSON.stringify(LONG).slice(0, 40); // cut inside the JSON string
  assert.equal(typeof parseEncodedArg(promptArg), 'string');
  assert.ok(parseEncodedArg(promptArg).length > 0);
  const steps = parseTranscript([
    JSON.stringify({
      tool_calls: [{ name: 'generate_image', args: { Prompt: promptArg, AspectRatio: JSON.stringify('16:9'), ImageName: JSON.stringify('result') } }],
      content: 'calling generate_image',
    }),
    JSON.stringify({
      content: 'Generated image is saved at /brain/result.png',
      media: [{ mime_type: 'image/png', uri: 'file:///brain/result.png' }],
    }),
  ].join('\n'));
  const generated = extractGenerated(steps);
  assert.equal(generated.length, 1);
  assert.equal(generated[0].file, '/brain/result.png');
  assert.equal(generated[0].call.AspectRatio, '16:9');
  assert.equal(typeof generated[0].call.Prompt, 'string');
});

check('a truncated transcript line does not drop a later image', () => {
  const broken = "{\"tool_calls\":[{\"name\":\"generate_image\",\"args\":{\"Prompt\":" + (JSON.stringify(LONG).slice(0, -1));
  assert.throws(() => JSON.parse(broken));
  const steps = parseTranscript([
    broken,
    JSON.stringify({
      content: 'Generated image is saved at /brain/kept.png',
      media: [{ mime_type: 'image/png', uri: 'file:///brain/kept.png' }],
    }),
  ].join('\n'));
  const generated = extractGenerated(steps);
  assert.equal(generated.length, 1);
  assert.equal(generated[0].file, '/brain/kept.png');
});

check('a single truncated line that names the saved image is recovered', () => {
  const line = "{\"content\":\"Generated image is saved at /brain/solo.png\",\"media\":[{\"mime_type\":\"image/png\",\"uri\":\"file:///brain/solo.png\"}],\"tool_calls\":[{\"name\":\"generate_image\",\"args\":{\"Prompt\":\"" + ('x'.repeat(50));
  assert.throws(() => JSON.parse(line));
  const generated = extractGenerated(parseTranscript(line));
  assert.equal(generated.length, 1);
  assert.equal(generated[0].file, '/brain/solo.png');
});

check('complete transcript args are unchanged', () => {
  const args = parseToolArgs({ Prompt: JSON.stringify('a cat'), AspectRatio: JSON.stringify('1:1') });
  assert.deepEqual(args, { Prompt: 'a cat', AspectRatio: '1:1' });
  const steps = parseTranscript(JSON.stringify({
    content: 'Generated image is saved at /brain/ok.png',
    tool_calls: [{ name: 'generate_image', args: { Prompt: JSON.stringify('a cat'), AspectRatio: JSON.stringify('1:1') } }],
    media: [{ mime_type: 'image/png', uri: 'file:///brain/ok.png' }],
  }));
  const generated = extractGenerated(steps);
  assert.equal(generated[0].call.Prompt, 'a cat');
  assert.equal(generated[0].call.AspectRatio, '1:1');
});

check('truncated agy stdout still yields the conversation id', () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  const reply = "{\"status\":\"SUCCESS\",\"conversation_id\":\"" + (id) + "\",\"response\":\"path /brain/out.png and then " + (LONG);
  assert.throws(() => JSON.parse(reply));
  const parsed = parseAgyReply(reply);
  assert.equal(parsed.status, 'SUCCESS');
  assert.equal(parsed.conversation_id, id);
  assert.match(parsed.response, /\/brain\/out\.png/);
});

check('explicit agy failure is not turned into success', () => {
  const parsed = parseAgyReply('{"status":"FAILURE","conversation_id":"12345678-1234-1234-1234-123456789abc","response":"429 RESOURCE_EXHAUSTED"}');
  assert.equal(parsed.status, 'FAILURE');
});

await checkAsync('full transcript is preferred over the clipped log', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gemini-log-'));
  try {
    await writeFile(path.join(dir, 'transcript.jsonl'), '{}\n');
    await writeFile(path.join(dir, 'transcript_full.jsonl'), '{}\n');
    assert.equal(transcriptFile(dir), path.join(dir, 'transcript_full.jsonl'));
    await writeFile(path.join(dir, 'transcript_full.jsonl'), '');
    assert.equal(transcriptFile(dir), path.join(dir, 'transcript.jsonl'));
    await rm(path.join(dir, 'transcript_full.jsonl'));
    assert.equal(transcriptFile(dir), path.join(dir, 'transcript.jsonl'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

check('quota, auth, and not-installed stop the engine immediately', () => {
  for (const reason of [
    'gemini: quota exhausted',
    'lovart: insufficient credits',
    'jimeng: 积分不足',
    'jimeng: 余额不足',
    'codex: usage limit reached',
    'muse: weekly limit',
    'grok: 401 unauthorized',
    'codex: not logged in',
    'jimeng: please log in',
    'jimeng: AigcComplianceConfirmationRequired',
    'lovart: wrapper missing (not_configured)',
    'codex: codex CLI not found: install it (codex_not_installed)',
    'gemini: agy not found: /tmp/agy',
    'codex: spawn codex ENOENT',
    'jimeng: Error: spawnSync dreamina ENOENT',
    failureText({ error: '找不到 lv 包装脚本', error_kind: 'not_configured' }),
  ]) {
    assert.equal(classifyEngineError(reason), 'down', reason);
    assert.equal(applyEngineFailure({ strikes: 0 }, reason).action, 'down', reason);
  }
});

check('one 429 or rate limit backs off and does not disable', () => {
  for (const reason of [
    'gemini: 429 RESOURCE_EXHAUSTED',
    'grok: rate limit exceeded',
    'codex: HTTP 429 Too Many Requests',
    'lovart: too many requests',
  ]) {
    assert.equal(classifyEngineError(reason), 'rate_limit', reason);
    const first = applyEngineFailure({ strikes: 0 }, reason);
    assert.equal(first.action, 'backoff', reason);
    assert.equal(first.down, false);
    assert.equal(first.strikes, 1);
    assert.ok(first.backoffSeconds >= 2);
  }
});

check('the third consecutive rate limit disables the engine', () => {
  let state = { strikes: 0 };
  let last;
  for (let i = 0; i < RATE_LIMIT_STRIKES; i++) {
    last = applyEngineFailure(state, 'gemini: 429 RESOURCE_EXHAUSTED');
    state = { strikes: last.strikes };
  }
  assert.equal(last.action, 'down');
  assert.equal(last.strikes, RATE_LIMIT_STRIKES);
  assert.equal(STEAL_FACTOR, 1.5);
});

check('a non-rate-limit error resets the consecutive streak', () => {
  const next = applyEngineFailure({ strikes: 2 }, 'gemini: content policy refusal');
  assert.equal(next.action, 'retry');
  assert.equal(next.strikes, 0);
});

check('generic not-found and file ENOENT stay per-image errors', () => {
  for (const reason of [
    'lovart: ref not found: /tmp/cat.png (invalid_args)',
    'gemini: ENOENT: no such file or directory, open \'/tmp/out.png\'',
    'codex: file not found: notes.txt',
    'muse: the castle was not found in the prompt',
    failureText({ error: 'ref not found: cat.png', error_kind: 'invalid_args' }),
  ]) {
    assert.equal(classifyEngineError(reason), 'retry', reason);
  }
});

check('explicit quota still wins when a 429 is in the same message', () => {
  assert.equal(classifyEngineError('lovart: 429 quota exhausted'), 'down');
  assert.equal(classifyEngineError('gemini: 429 RESOURCE_EXHAUSTED'), 'rate_limit');
});

check('fast engine does not steal a slow engine that just started', () => {
  // codex ~35s/img, muse ~110s/img. Remaining time used to exceed 1.2× codex immediately.
  assert.equal(shouldSteal({ activeCount: 1, holderTypical: 110, holderElapsed: 1 }), false);
  assert.equal(shouldSteal({ activeCount: 1, holderTypical: 110, holderElapsed: 110 }), false);
  assert.equal(shouldSteal({ activeCount: 1, holderTypical: 110, holderElapsed: 110 * STEAL_FACTOR }), false);
  assert.equal(shouldSteal({ activeCount: 1, holderTypical: 110, holderElapsed: 110 * STEAL_FACTOR + 0.01 }), true);
  assert.equal(shouldSteal({ activeCount: 1, holderTypical: 35, holderElapsed: 52 }), false);
  assert.equal(shouldSteal({ activeCount: 1, holderTypical: 35, holderElapsed: 53 }), true);
});

check('keep counts returned images, saved files, aspect redos, and dropped duplicates', () => {
  assert.deepEqual(keepCounts([
    { produced: true, outcome: 'done' },
    { produced: true, outcome: 'failed' },
    { produced: false, outcome: 'failed' },
    { produced: true, outcome: 'cancelled' },
    { produced: false, outcome: 'cancelled' },
    { produced: true, outcome: 'style_redo' },
    { produced: true, outcome: 'style_rejected' },
  ]), { generated: 5, kept: 1, redone: 1, duplicates: 1, style_redos: 2 });
  assert.equal(5, 1 + 1 + 1 + 2);
  assert.deepEqual(keepCounts(undefined), { generated: 0, kept: 0, redone: 0, duplicates: 0, style_redos: 0 });
});

check('at most one duplicate, and the loser is ignored once someone has won', () => {
  assert.equal(shouldSteal({ activeCount: 2, holderTypical: 110, holderElapsed: 500 }), false);
  assert.equal(shouldSteal({ activeCount: 0, holderTypical: 110, holderElapsed: 500 }), false);
  assert.equal(attemptDisposition({ cancelled: false, won: true, code: 0, status: 'ok' }), STDIO_QUIET);
  assert.equal(attemptDisposition({ cancelled: true, won: false, code: 0, status: 'ok' }), STDIO_QUIET);
  assert.equal(attemptDisposition({ cancelled: false, won: false, code: 0, status: 'ok' }), 'win');
  assert.equal(attemptDisposition({ cancelled: false, won: false, code: 1, status: 'error' }), 'fail');
});

check('steal threshold uses the median, not the slowest sample', () => {
  assert.equal(medianSeconds([30, 35, 200], 35), 35);
  assert.equal(medianSeconds([], 110), 110);
  const median = medianSeconds([30, 35, 200], 35);
  assert.equal(shouldSteal({ activeCount: 1, holderTypical: median, holderElapsed: median * STEAL_FACTOR }), false);
  assert.equal(shouldSteal({ activeCount: 1, holderTypical: median, holderElapsed: 201 }), true);
});

function run(cmd, args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: childEnv(env), stdio: [STDIO_QUIET, "pipe", "pipe"] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

async function hintBatch(dir, document, args = []) {
  const scripts = path.join(dir, 'scripts');
  const off = path.join(dir, 'off');
  const callsFile = path.join(dir, 'calls.jsonl');
  const styleCallsFile = path.join(dir, 'style-calls.jsonl');
  const python = path.join(scripts, 'python.cjs');
  await mkdir(scripts);
  await mkdir(off);
  await writeFile(callsFile, '');
  await writeFile(styleCallsFile, '');
  // These tests cover hinting, not palette scoring (covered by series.test.mjs).
  // HOME is isolated below, which can hide pip's user-site Pillow install on CI.
  // Pin a scorer fixture instead of depending on the host's PYTHON/Pillow setup.
  await writeFile(python, [
    '#!' + process.execPath,
    "const assert = require('node:assert/strict');",
    "const { appendFileSync, readFileSync } = require('node:fs');",
    'const args = process.argv.slice(2);',
    'assert.equal(args.length, 4);',
    'assert.deepEqual(args.slice(0, 2), ' + JSON.stringify([path.join(here, 'imgtool.py'), 'style']) + ');',
    'for (const file of args.slice(2)) assert.ok(readFileSync(file).length > 0);',
    'appendFileSync(' + JSON.stringify(styleCallsFile) + ', JSON.stringify(args) + "\\n");',
    'console.log(JSON.stringify({ method: "palette-histogram", score: 1 }));',
  ].join('\n'));
  await chmod(python, 0o755);
  await writeFile(path.join(scripts, 'gemini-image.mjs'), [
    "import { appendFileSync, writeFileSync } from 'node:fs';",
    'const args = process.argv.slice(2);',
    'const out = args[args.indexOf("--out") + 1];',
    'appendFileSync(' + JSON.stringify(callsFile) + ', JSON.stringify(args) + "\\n");',
    'writeFileSync(out, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC", "base64"));',
    'console.log(JSON.stringify({ status: "ok" }));',
  ].join('\n'));
  const jobsFile = path.join(dir, 'jobs.json');
  await writeFile(jobsFile, JSON.stringify(document));
  const result = await run(process.execPath, [path.join(here, 'batch.mjs'),
    '--jobs', jobsFile, '--out', path.join(dir, 'out'), '--engines', 'gemini', '--lanes', 'gemini=1', ...args], {
    HOME: dir,
    PYTHON: python,
    IMAGE_GEN_API_CONFIG: path.join(dir, 'no-api.json'),
    IMAGE_GEN_ENGINE_OFF: off,
    IMAGE_GEN_TEST_SCRIPTS: 'yes',
    IMAGE_GEN_SCRIPT_DIR: scripts,
  });
  const events = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const calls = (await readFile(callsFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const styleCalls = (await readFile(styleCallsFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const saved = JSON.parse(await readFile(path.join(dir, 'out', 'batch-results.json'), 'utf8'));
  return { ...result, events, calls, styleCalls, saved };
}

const sharedRefJobs = count => Array.from({ length: count }, (_, i) => ({
  id: 'hint-' + i, prompt: 'same character, scene ' + i, ref: ['anchor.png'],
}));

for (const scenario of [
  { name: 'hints once for four jobs sharing a reference', hint: true, jobs: () => sharedRefJobs(4) },
  { name: 'hints for more than four jobs', hint: true, jobs: () => sharedRefJobs(5) },
  { name: 'hints for an object without a series key', hint: true, jobs: () => ({ jobs: sharedRefJobs(4) }) },
  { name: 'compares resolved paths relative to the jobs file', hint: true, jobs: dir => sharedRefJobs(4).map((job, i) => ({
    ...job, ref: [i === 0 ? path.join(dir, 'anchor.png') : './nested/../anchor.png'],
  })) },
  { name: 'hints for identical ordered multi-reference lists', hint: true, jobs: () => sharedRefJobs(4).map(job => ({ ...job, ref: ['a.png', 'b.png'] })) },
  { name: 'does not hint for differing references despite similar prompts', jobs: () => sharedRefJobs(4).map((job, i) => ({ ...job, ref: [i ? 'anchor.png' : 'other.png'] })) },
  { name: 'does not hint for fewer than four jobs', jobs: () => sharedRefJobs(3) },
  ...[false, null, 0, ''].map(series => ({
    name: 'does not hint for explicit series ' + JSON.stringify(series),
    jobs: () => ({ series, jobs: sharedRefJobs(4) }),
  })),
  ...[true, 'fixture style', { style: 'fixture style' }].map(series => ({
    name: 'does not hint for explicit enabled series ' + JSON.stringify(series),
    series: true, jobs: () => ({ series, style: 'fixture style', jobs: sharedRefJobs(4) }),
  })),
  { name: 'does not hint with the series flag', series: true, jobs: () => sharedRefJobs(4), args: ['--series', '--style', 'fixture style'] },
  { name: 'does not hint when a job lacks references', jobs: () => sharedRefJobs(4).map((job, i) => ({ ...job, ref: i ? job.ref : [] })) },
  { name: 'does not hint for empty reference paths', jobs: () => sharedRefJobs(4).map(job => ({ ...job, ref: [''] })) },
  { name: 'does not hint without any references', jobs: () => sharedRefJobs(4).map(({ ref, ...job }) => job) },
  { name: 'does not hint when reference order differs', jobs: () => sharedRefJobs(4).map((job, i) => ({ ...job, ref: i ? ['a.png', 'b.png'] : ['b.png', 'a.png'] })) },
  { name: 'does not hint when reference multiplicity differs', jobs: () => sharedRefJobs(4).map((job, i) => ({ ...job, ref: i ? ['a.png'] : ['a.png', 'a.png'] })) },
]) {
  await checkAsync('series hint ' + scenario.name, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'batch-hint-'));
    try {
      const document = scenario.jobs(dir);
      const jobs = Array.isArray(document) ? document : document.jobs;
      const result = await hintBatch(dir, document, scenario.args);
      assert.equal(result.code, 0, result.stderr + result.stdout);
      const stderrLines = result.stderr.trim().split('\n').filter(Boolean);
      assert.equal(stderrLines.length, scenario.hint ? 1 : 0, result.stderr);
      if (scenario.hint) {
        const hint = JSON.parse(stderrLines[0]);
        assert.equal(hint.event, 'series_hint');
        assert.equal(typeof hint.at, 'string');
        assert.match(hint.message, /这批任务共用同一组参考图，如果要统一风格，可以加 --series/);
        assert.match(hint.message, /All jobs share the same reference images; add --series if they should share one style\./);
      }
      assert.equal(result.events.some(event => event.event === 'series_hint'), false);
      const summary = result.events.at(-1);
      assert.equal(summary.event, 'summary');
      assert.equal(summary.series_hint, scenario.hint ? true : undefined);
      assert.equal(result.saved.series_hint, summary.series_hint);
      assert.equal(Boolean(summary.series), Boolean(scenario.series));
      assert.equal(summary.done, jobs.length);
      assert.equal(summary.failed, 0);
      assert.deepEqual(summary.keep, { generated: jobs.length, kept: jobs.length, redone: 0, duplicates: 0, style_redos: 0, resumed: 0 });
      assert.equal(result.calls.length, jobs.length);
      assert.equal(result.styleCalls.length, scenario.series ? jobs.length - 1 : 0);
      for (const call of result.styleCalls) {
        assert.equal(call[3], result.saved.results.done[0].file);
      }
      for (let i = 0; i < jobs.length; i++) {
        const args = result.calls[i];
        const prompt = args[args.indexOf('--prompt') + 1];
        if (scenario.series) assert.ok(prompt.startsWith(jobs[i].prompt + '\n\nSTYLE GUIDE'));
        else assert.equal(prompt, jobs[i].prompt);
        const refs = args.flatMap((value, index) => value === '--ref' ? [args[index + 1]] : []);
        assert.deepEqual(refs, (jobs[i].ref ?? []).map(ref => path.resolve(dir, ref)));
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

for (const scenario of [
  { name: 'rejects an old PNG after a failed exec', preExisting: true, action: '', code: 7, success: false },
  { name: 'rejects an old PNG after a successful exec', preExisting: true, action: '', code: 0, success: false },
  { name: 'rejects identical content with a changed mtime', preExisting: true, action: 'await utimes(out, 1, 1);', code: 0, success: false },
  { name: 'accepts a newly created PNG', preExisting: false, action: 'await copyFile(fresh, out);', code: 0, success: true },
  { name: 'accepts a changed PNG at an existing output path', preExisting: true, action: 'await copyFile(fresh, out);', code: 0, success: true },
  { name: 'accepts changed content with the same size and restored mtime', preExisting: true, action: 'const before = await stat(out); await copyFile(fresh, out); await utimes(out, before.atime, before.mtime);', code: 0, success: true },
]) {
  await checkAsync('codex-image ' + scenario.name, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'codex-image-'));
    try {
      const out = path.join(dir, 'out.png');
      const fresh = path.join(dir, 'fresh.png');
      const codex = path.join(dir, 'fake-codex');
      const codexHome = path.join(dir, '.codex');
      const oldPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
      const newPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC', 'base64');
      await mkdir(path.join(codexHome, 'generated_images'), { recursive: true });
      if (scenario.preExisting) await writeFile(out, oldPng);
      await writeFile(fresh, newPng);
      await writeFile(codex, `#!${process.execPath}
const { copyFile, stat, utimes } = require('node:fs/promises');
const out = ${JSON.stringify(out)};
const fresh = ${JSON.stringify(fresh)};
process.stdin.resume();
process.stdin.on('end', async () => {
  ${scenario.action}
  process.exit(${scenario.code});
});
`);
      await chmod(codex, 0o755);
      const result = await run(process.execPath, [path.join(here, 'codex-image.mjs'),
        '--prompt', 'test', '--out', out, '--codex', codex, '--retries', '0', '--json'],
      { HOME: dir, CODEX_HOME: codexHome });
      const report = JSON.parse(result.stdout.trim());
      if (scenario.success) {
        assert.equal(result.code, 0, result.stderr);
        assert.equal(report.status, 'ok');
        assert.equal(report.path, out);
        assert.deepEqual(await readFile(out), newPng);
      } else {
        assert.notEqual(result.code, 0);
        assert.equal(report.status, 'error');
        assert.equal(report.error_kind, 'generation_failed');
        assert.match(report.error, /no new PNG.*unchanged from before this run/);
        assert.match(report.error, new RegExp('codex exec exited ' + scenario.code));
        assert.deepEqual(await readFile(out), oldPng);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

await checkAsync('lovart wrapper accepts mode 600 on Linux and still surfaces no credits', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lv-wrap-'));
  try {
    const envFile = path.join(dir, 'env');
    const agent = path.join(dir, 'agent.py');
    const wrapper = path.join(dir, 'lv');
    await writeFile(envFile, 'export LOVART_ACCESS_KEY=ak_test\nexport LOVART_SECRET_KEY=sk_test\n');
    await chmod(envFile, 0o600);
    await writeFile(agent, 'import sys\nprint("no credits")\nsys.exit(3)\n');
    await writeFile(wrapper, await readFile(exampleWrapper));
    await chmod(wrapper, 0o755);
    const ok = await run(wrapper, ['chat'], { LOVART_ENV: envFile, LOVART_AGENT_SKILL: agent, HOME: dir });
    assert.equal(ok.code, 3, ok.stderr);
    assert.match(ok.stdout, /no credits/);
    assert.doesNotMatch(ok.stderr, /Refusing to run/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await checkAsync('lovart wrapper refuses group-readable credentials', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lv-wrap-'));
  try {
    const envFile = path.join(dir, 'env');
    const wrapper = path.join(dir, 'lv');
    await writeFile(envFile, 'export LOVART_ACCESS_KEY=ak_test\nexport LOVART_SECRET_KEY=sk_test\n');
    await chmod(envFile, 0o644);
    await writeFile(wrapper, await readFile(exampleWrapper));
    await chmod(wrapper, 0o755);
    const denied = await run(wrapper, ['chat'], { LOVART_ENV: envFile, HOME: dir });
    assert.notEqual(denied.code, 0);
    assert.match(denied.stderr, /mode 644/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await checkAsync('BSD stat fallback still runs and does not mask no credits', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lv-wrap-'));
  try {
    const bin = path.join(dir, 'bin');
    await mkdir(bin);
    // GNU stat -c fails here, like macOS. BSD stat -f %Lp prints the real mode from the system stat.
    await writeFile(path.join(bin, 'stat'), "#!/bin/sh\nif [ \"$1\" = \"-c\" ]; then\n  echo \"stat: illegal option -- c\" >&2\n  exit 1\nfi\nif [ \"$1\" = \"-f\" ]; then\n  exec /usr/bin/stat -c %a \"$3\"\nfi\nexit 1\n");
    await chmod(path.join(bin, 'stat'), 0o755);
    const envFile = path.join(dir, 'env');
    const agent = path.join(dir, 'agent.py');
    const wrapper = path.join(dir, 'lv');
    await writeFile(envFile, 'export LOVART_ACCESS_KEY=ak_test\nexport LOVART_SECRET_KEY=sk_test\n');
    await chmod(envFile, 0o600);
    await writeFile(agent, 'import sys\nprint("no credits")\nsys.exit(3)\n');
    await writeFile(wrapper, await readFile(exampleWrapper));
    await chmod(wrapper, 0o755);
    const ok = await run(wrapper, ['chat'], {
      LOVART_ENV: envFile,
      LOVART_AGENT_SKILL: agent,
      HOME: dir,
      PATH: (bin) + ":" + (process.env.PATH),
    });
    assert.equal(ok.code, 3, "stdout=" + (ok.stdout) + " stderr=" + (ok.stderr));
    assert.match(ok.stdout, /no credits/);
    assert.doesNotMatch(ok.stderr, /Refusing to run/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await checkAsync('output directory is created and resolved before a job starts', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'batch-out-'));
  try {
    const real = path.join(dir, 'real');
    const link = path.join(dir, 'link');
    const missing = path.join(dir, 'missing', 'nested');
    await mkdir(real);
    await symlink(real, link);
    assert.equal(await prepareOutputDir(link), await realpath(real));
    const created = await prepareOutputDir(missing);
    assert.equal(created, await realpath(missing));
    assert.equal(await realpath(path.dirname(created)), await realpath(path.join(dir, 'missing')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await checkAsync('symlink launch runs main; a missing entry path does not', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'entry-link-'));
  try {
    const batchPath = path.join(here, 'batch.mjs');
    const geminiPath = path.join(here, 'gemini-image.mjs');
    const batchUrl = pathToFileURL(batchPath).href;
    const fileLink = path.join(dir, 'batch-link.mjs');
    const geminiLink = path.join(dir, 'gemini-link.mjs');
    const parentLink = path.join(dir, 'scripts');
    const chained = path.join(dir, 'batch-chain.mjs');
    await symlink(batchPath, fileLink);
    await symlink(geminiPath, geminiLink);
    await symlink(here, parentLink);
    await symlink(fileLink, chained);

    assert.equal(isInvokedDirectly(batchUrl, undefined), false);
    assert.equal(isInvokedDirectly(batchUrl, ''), false);
    assert.equal(isInvokedDirectly(batchUrl, path.join(dir, 'missing.mjs')), false);
    assert.equal(isInvokedDirectly(batchUrl, fileLink), true);
    assert.equal(isInvokedDirectly(batchUrl, path.join(parentLink, 'batch.mjs')), true);
    assert.equal(isInvokedDirectly(batchUrl, chained), true);
    assert.equal(isInvokedDirectly(batchUrl, geminiPath), false);

    for (const entry of [batchPath, fileLink, path.join(parentLink, 'batch.mjs'), chained]) {
      const r = await run(process.execPath, [entry, '--help']);
      assert.equal(r.code, 0, "stdout=" + (r.stdout) + " stderr=" + (r.stderr));
      assert.match(r.stdout, /--jobs/, entry);
    }
    for (const entry of ['batch-link.mjs', 'scripts/batch.mjs', 'batch-chain.mjs']) {
      const r = await run(process.execPath, [entry, '--help'], undefined, dir);
      assert.equal(r.code, 0, "stdout=" + (r.stdout) + " stderr=" + (r.stderr));
      assert.match(r.stdout, /--jobs/, entry);
    }
    for (const entry of [geminiPath, geminiLink, path.join(parentLink, 'gemini-image.mjs')]) {
      const r = await run(process.execPath, [entry, '--help']);
      assert.equal(r.code, 0, "stdout=" + (r.stdout) + " stderr=" + (r.stderr));
      assert.match(r.stdout, /gemini-image\.mjs/, entry);
    }

    const imported = await run(process.execPath, ['--input-type=module', '-e',
      "await import(" + (JSON.stringify(pathToFileURL(batchPath).href)) + "); console.log('imported-only');"]);
    assert.equal(imported.code, 0, imported.stderr);
    assert.match(imported.stdout, /imported-only/);
    assert.doesNotMatch(imported.stdout + imported.stderr, /require --jobs|batch\.mjs --jobs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

check('paid line only takes images no subscription engine can take', () => {
  assert.equal(paidMayTake({ named: false, subscriptionCanTake: true }), false);
  assert.equal(paidMayTake({ named: false, subscriptionCanTake: false }), true);
  assert.equal(paidMayTake({ named: true, subscriptionCanTake: true }), true);
});

check('paid budget counts in-flight images against batch and month caps', () => {
  const base = { price: 0.04, budgetBatch: 0.1, monthSpent: 0, budgetMonth: 10 };
  assert.equal(paidBudgetLeft({ ...base, committed: 0 }), null);
  assert.equal(paidBudgetLeft({ ...base, committed: 1 }), null);
  assert.match(paidBudgetLeft({ ...base, committed: 2 }), /本批 API 预算用完/);
  assert.match(paidBudgetLeft({ ...base, budgetBatch: 5, monthSpent: 9.97, committed: 0 }), /本月 API 预算用完/);
  assert.equal(classifyEngineError(paidBudgetLeft({ ...base, committed: 2 })), 'down');
});

check('paid API errors map to down / rate_limit / retry', () => {
  assert.equal(classifyEngineError('api: unauthorized (HTTP 401): bad key'), 'down');
  assert.equal(classifyEngineError('api: insufficient balance (HTTP 402): {}'), 'down');
  assert.equal(classifyEngineError('api: HTTP 429: {"error":{"code":"insufficient_quota"}}'), 'down');
  assert.equal(classifyEngineError('api: HTTP 429: {"error":{"status":"RESOURCE_EXHAUSTED"}}'), 'rate_limit');
  assert.equal(classifyEngineError('api: not_configured: set OPENAI_API_KEY'), 'down');
  assert.equal(classifyEngineError('api: HTTP 400: content policy violation'), 'retry');
});

check('openai sizes follow the model', () => {
  assert.equal(openaiSize('gpt-image-1.5', '3:2'), '1536x1024');
  assert.throws(() => openaiSize('gpt-image-1', '16:9'), /only supports/);
  for (const aspect of ['16:9', '9:16', '4:5', '21:9', '1:1']) {
    const [w, h] = openaiSize('gpt-image-2', aspect).split('x').map(Number);
    const [a, b] = aspect.split(':').map(Number);
    assert.equal(w % 16, 0); assert.equal(h % 16, 0);
    assert.ok(Math.abs(w / h - a / b) / (a / b) < 0.03, (aspect) + " -> " + (w) + "x" + (h));
  }
  assert.throws(() => openaiSize('gpt-image-2', '4:1'), /1:3 and 3:1/);
});

check('api engine spec: ratios and reference limits per model', () => {
  const g25 = engineSpec({ provider: 'gemini', model: 'gemini-2.5-flash-image' });
  assert.equal(g25.maxRefs, 3);
  assert.ok(g25.acceptsRatio('4:5'));
  assert.ok(!g25.acceptsRatio('8:1'));
  const nb = engineSpec({ provider: 'gemini', model: 'gemini-nano-banana-2.1' });
  assert.equal(nb.maxRefs, 14);
  assert.ok(nb.acceptsRatio('8:1'));
  const oa = engineSpec({ provider: 'openai', model: 'gpt-image-2' });
  assert.ok(oa.acceptsRatio('16:10'));
  assert.ok(!oa.acceptsRatio('4:1'));
  assert.ok(!engineSpec({ provider: 'openai', model: 'gpt-image-1' }).acceptsRatio('16:9'));
});

check('month spend only counts this month', () => {
  const rows = [{ month: '2026-11', usd: 0.04 }, { month: '2026-11', usd: 0.05 }, { month: '2026-10', usd: 9 }].map(r => JSON.stringify(r)).join('\n');
  assert.deepEqual(monthSpent(rows, new Date(2026, 10, 13)), { month: '2026-11', usd: 0.09, images: 2 });
});

await checkAsync('api config: absent means off, missing price is an error, quality defaults to medium', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'api-cfg-'));
  try {
    assert.equal(loadApiConfig(path.join(dir, 'none.json')), null);
    await writeFile(path.join(dir, 'bad.json'), JSON.stringify({ provider: 'openai', model: 'gpt-image-2', budget_per_batch: 1, budget_per_month: 5 }));
    assert.throws(() => loadApiConfig(path.join(dir, 'bad.json')), /price_per_image/);
    await writeFile(path.join(dir, 'ok.json'), JSON.stringify({ provider: 'openai', model: 'gpt-image-2', price_per_image: 0.05, budget_per_batch: 1, budget_per_month: 5 }));
    assert.equal(loadApiConfig(path.join(dir, 'ok.json')).quality, 'medium');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Exercise the real API entry with fetch replaced before import: no network or keys.
for (const provider of ['openai', 'gemini']) {
  for (const scenario of [
    { name: 'missing config', noConfig: true, charged: false, calls: 0 },
    { name: 'invalid config', badConfig: true, charged: false, calls: 0 },
    { name: 'missing key', noKey: true, charged: false, calls: 0 },
    { name: 'missing key file', keyFile: true, charged: false, calls: 0 },
    { name: 'invalid argument', args: ['--invalid'], charged: false, calls: 0 },
    { name: 'invalid timeout', args: ['--timeout', 'NaN'], charged: false, calls: 0 },
    { name: 'invalid base URL', base: 'invalid URL', charged: false, calls: 0 },
    { name: 'missing reference', args: ['--ref', 'missing.png'], charged: false, calls: 0 },
    { name: 'invalid reference type', ref: true, charged: false, calls: 0 },
    { name: 'HTTP 400', http: 400, charged: false, calls: 1 },
    { name: 'HTTP 401', http: 401, charged: false, calls: 1 },
    { name: 'HTTP 402', http: 402, charged: false, calls: 1 },
    { name: 'HTTP 429', http: 429, charged: false, calls: 1 },
    { name: 'request timeout', unknown: true, calls: 1 },
    { name: 'response without image', noImage: true, calls: 1 },
    { name: 'charged before local validation fails', localFail: true, charged: true, calls: 1 },
    { name: 'confirmed bytes dedup by spend ID', success: true, repeat: 2, calls: 2 },
  ]) {
    await checkAsync('api failure accounting ' + provider + ': ' + scenario.name, async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'api-report-'));
      try {
        const config = path.join(dir, 'api.json');
        const ledger = path.join(dir, 'ledger.jsonl');
        const calls = path.join(dir, 'calls.jsonl');
        const mock = path.join(dir, 'fetch.mjs');
        const python = path.join(dir, 'python.cjs');
        await writeFile(ledger, '');
        await writeFile(calls, '');
        await writeFile(path.join(dir, 'ref.txt'), 'fixture');
        if (!scenario.noConfig) await writeFile(config, JSON.stringify({ provider,
          model: provider === 'openai' ? 'gpt-image-2' : 'gemini-2.5-flash-image',
          key_env: 'IMAGE_GEN_TEST_NO_KEY', key_file: scenario.keyFile ? path.join(dir, 'missing-key') : undefined,
          base_url: scenario.base ?? 'https://fixture.invalid',
          price_per_image: scenario.badConfig ? -1 : 0.04, budget_per_batch: 1, budget_per_month: 5 }));
        await writeFile(mock, [
          "import { appendFileSync } from 'node:fs';",
          'globalThis.fetch = async () => {',
          '  appendFileSync(' + JSON.stringify(calls) + ', "request\\n");',
          ...(scenario.unknown ? ['throw new Error("request timed out");'] : [
            'return new Response(JSON.stringify(' + JSON.stringify(scenario.http || scenario.noImage ? {}
              : provider === 'openai' ? { data: [{ b64_json: 'Zml4dHVyZQ==' }] }
              : { output_image: { data: 'Zml4dHVyZQ==' } }) + '), { status: ' + (scenario.http ?? 200) + ' });',
          ]),
          '};',
        ].join('\n'));
        await writeFile(python, [
          '#!' + process.execPath,
          "const { copyFileSync } = require('node:fs');",
          ...(scenario.localFail ? ['console.error("fixture decode failed"); process.exit(1);'] : [
            'const [, command, source, target] = process.argv.slice(2);',
            'if (command === "png") { copyFileSync(source, target); console.log("{}"); }',
            'else console.log(JSON.stringify({ width: 1, height: 1 }));',
          ]),
        ].join('\n'));
        await chmod(python, 0o755);
        for (let i = 0; i < (scenario.repeat ?? 1); i++) {
          const result = await run(process.execPath, ['--import', mock, path.join(here, 'api-image.mjs'),
            '--prompt', 'fixture', '--out', path.join(dir, 'out.png'), '--spend-id', 'fixture-attempt',
            ...(scenario.ref ? ['--ref', path.join(dir, 'ref.txt')] : scenario.args ?? [])], {
            HOME: dir, PYTHON: python, IMAGE_GEN_API_CONFIG: config, IMAGE_GEN_API_LEDGER: ledger,
            IMAGE_GEN_TEST_NO_KEY: scenario.noKey || scenario.keyFile ? '' : 'fixture-key',
          }, dir);
          assert.equal(result.code, scenario.success ? 0 : 1, result.stdout + result.stderr);
          const report = JSON.parse(result.stdout.trim());
          assert.equal(report.status, scenario.success ? 'ok' : 'error');
          assert.equal(report.engine, 'api');
          assert.equal(report.charged, scenario.charged);
          if (!scenario.success) assert.equal(typeof report.reason, 'string');
        }
        assert.equal((await readFile(calls, 'utf8')).trim().split('\n').filter(Boolean).length, scenario.calls);
        const entries = (await readFile(ledger, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
        assert.equal(entries.length, scenario.charged || scenario.success ? 1 : 0);
        if (entries.length) {
          assert.equal(entries[0].spend_id, 'fixture-attempt');
          assert.equal(entries[0].uncertain, undefined);
          assert.equal(entries[0].usd, 0.04);
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
}

// All batch paid-line tests run fake scripts under an isolated HOME.
async function paidBatch(dir, jobs, args) {
  const scripts = path.join(dir, 'scripts');
  await mkdir(scripts);
  await writeFile(path.join(scripts, 'api-image.mjs'),
    'console.log(JSON.stringify({ status: "error", charged: false, reason: "not_configured: fixture has no key" })); process.exitCode = 1;');
  const config = path.join(dir, 'api.json');
  await writeFile(config, JSON.stringify({ provider: 'openai', model: 'gpt-image-2', price_per_image: 0.04, budget_per_batch: 1, budget_per_month: 5 }));
  await writeFile(path.join(dir, 'jobs.json'), JSON.stringify(jobs));
  const r = await run(process.execPath, [path.join(here, 'batch.mjs'), '--jobs', path.join(dir, 'jobs.json'), '--out', path.join(dir, 'out'), ...args],
    { HOME: dir, IMAGE_GEN_API_CONFIG: config, IMAGE_GEN_API_LEDGER: path.join(dir, 'ledger.jsonl'),
      IMAGE_GEN_TEST_SCRIPTS: 'yes', IMAGE_GEN_SCRIPT_DIR: scripts, IMAGE_GEN_ENGINE_OFF: path.join(dir, 'off') });
  return r.stdout.trim().split('\n').map(line => JSON.parse(line));
}

await checkAsync('batch hands an image to the paid line when no subscription engine can take it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'api-batch-'));
  try {
    // grok 没有 16:10，只有付费线路接得了
    const events = await paidBatch(dir, [{ id: 'wide', prompt: 'x', aspect: '16:10' }], ['--engines', 'grok,api']);
    assert.ok(events.some(e => e.event === 'start' && e.engine === 'api'), JSON.stringify(events));
    assert.ok(!events.some(e => e.event === 'start' && e.engine === 'grok'));
    const downEvent = events.find(e => e.event === 'engine_down' && e.engine === 'api');
    assert.match(downEvent.reason, /not_configured/);
    assert.equal(events.at(-1).failed, 1);
    assert.deepEqual(events.at(-1).keep, { generated: 0, kept: 0, redone: 0, duplicates: 0, style_redos: 0, resumed: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await checkAsync('batch keeps the paid line idle while a subscription engine can still take the image', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'api-batch-'));
  try {
    // gemini 接得了 1:1，只是这次没给它开通道：付费线路也不能接
    const events = await paidBatch(dir, [{ id: 'sq', prompt: 'x', aspect: '1:1' }], ['--engines', 'gemini,api', '--lanes', 'gemini=0']);
    assert.ok(!events.some(e => e.event === 'start'), JSON.stringify(events));
    assert.equal(events.at(-1).failed, 1);
    assert.deepEqual(events.at(-1).paid, { images: 0, usd: 0, month_usd: 0, budget_per_month: 5, discarded: 0, uncertain: 0, stopped_by_budget: 0 });
    assert.deepEqual(events.at(-1).keep, { generated: 0, kept: 0, redone: 0, duplicates: 0, style_redos: 0, resumed: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await checkAsync('images stopped by the paid budget say so in their failure reason', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'api-batch-'));
  try {
    // 每张估价 0.5 超过本批预算 0.1：一张都不发请求，两张都写明预算用完
    const config = path.join(dir, 'api.json');
    await writeFile(config, JSON.stringify({ provider: 'openai', model: 'gpt-image-2', key_env: 'IMAGE_GEN_TEST_NO_KEY', price_per_image: 0.5, budget_per_batch: 0.1, budget_per_month: 5 }));
    await writeFile(path.join(dir, 'jobs.json'), JSON.stringify([{ id: 'a', prompt: 'x' }, { id: 'b', prompt: 'y' }]));
    const r = await run(process.execPath, [path.join(here, 'batch.mjs'), '--jobs', path.join(dir, 'jobs.json'), '--out', path.join(dir, 'out'), '--engines', 'api'],
      { HOME: dir, IMAGE_GEN_API_CONFIG: config, IMAGE_GEN_API_LEDGER: path.join(dir, 'ledger.jsonl'), IMAGE_GEN_ENGINE_OFF: path.join(dir, 'off') });
    const events = r.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.ok(!events.some(e => e.event === 'start'), JSON.stringify(events));
    const failedEvents = events.filter(e => e.event === 'failed');
    assert.equal(failedEvents.length, 2);
    for (const e of failedEvents) assert.match(e.reason, /本批 API 预算用完/);
    const results = JSON.parse(await readFile(path.join(dir, 'out', 'batch-results.json'), 'utf8'));
    for (const f of results.results.failed) assert.match(f.reason, /本批 API 预算用完/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function chargedBatch(dir, options = {}) {
  const { cap = 0.04, monthCap = 5, prior = 0, passAt = Infinity, lanes = 1,
    count = 1, series = true, mode = 'image', childLedger = true, subscription = false } = options;
  const noImage = ['quota', 'unknown', 'killed', 'not-configured', 'pre-request-once'].includes(mode);
  const scripts = path.join(dir, 'scripts');
  const callsFile = path.join(dir, 'calls.jsonl');
  const ledger = path.join(dir, 'ledger.jsonl');
  const config = path.join(dir, 'api.json');
  const python = path.join(scripts, 'python.cjs');
  await mkdir(scripts);
  await writeFile(callsFile, '');
  const now = new Date();
  const month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  await writeFile(ledger, prior ? JSON.stringify({ month, usd: prior }) + '\n' : '');
  await writeFile(config, JSON.stringify({ provider: 'openai', model: 'gpt-image-2',
    price_per_image: 0.04, budget_per_batch: cap, budget_per_month: monthCap, lanes }));
  await writeFile(path.join(dir, 'anchor.png'), 'fixture anchor');
  // This fixture replaces Python entirely, including size checks: no host Pillow.
  await writeFile(python, [
    '#!' + process.execPath,
    "const assert = require('node:assert/strict');",
    "const { readFileSync } = require('node:fs');",
    'const [script, command, file, ...anchors] = process.argv.slice(2);',
    'assert.equal(script, ' + JSON.stringify(path.join(here, 'imgtool.py')) + ');',
    'const image = JSON.parse(readFileSync(file, "utf8"));',
    'if (command === "size") console.log(JSON.stringify({ width: 2, height: 1 }));',
    'else {',
    '  assert.equal(command, "style"); assert.equal(anchors.length, 1);',
    '  assert.ok(readFileSync(anchors[0]).length);',
    '  console.log(JSON.stringify({ score: image.subscription || image.call >= ' + passAt + ' ? 1 : 0.1 }));',
    '}',
  ].join('\n'));
  await chmod(python, 0o755);
  await writeFile(path.join(scripts, 'api-image.mjs'), [
    "import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';",
    'import { loadApiConfig, recordPaidSpend } from ' + JSON.stringify(pathToFileURL(path.join(here, 'api-image.mjs')).href) + ';',
    'const args = process.argv.slice(2);',
    'const value = flag => args[args.indexOf(flag) + 1];',
    'const callsFile = ' + JSON.stringify(callsFile) + ';',
    'const first = !readFileSync(callsFile, "utf8").trim();',
    'appendFileSync(callsFile, JSON.stringify({ out: value("--out"), prompt: value("--prompt"), image: ' + (!noImage || mode === 'pre-request-once') + (['rate-once', 'pre-request-once'].includes(mode) ? ' && !first' : '') + ' }) + "\\n");',
    'const call = readFileSync(callsFile, "utf8").trim().split("\\n").length;',
    ...(mode === 'rate-once' ? ['if (first) { console.log(JSON.stringify({ status: "error", reason: "HTTP 429 Too Many Requests" })); process.exit(1); }'] : []),
    ...(mode === 'pre-request-once' ? ['if (first) { console.log(JSON.stringify({ status: "error", charged: false, reason: "reference file missing" })); process.exit(1); }'] : []),
    ...(!noImage || mode === 'pre-request-once' ? ['writeFileSync(value("--out"), JSON.stringify({ call }));'] : []),
    ...(childLedger && (!noImage || mode === 'pre-request-once') ? [
      'await recordPaidSpend(loadApiConfig(), { spendId: value("--spend-id"), refs: 1 });',
      'await recordPaidSpend(loadApiConfig(), { spendId: value("--spend-id"), refs: 1 });', // Dedup the same confirmed attempt.
    ] : []),
    ...(mode === 'quota' ? ['console.log(JSON.stringify({ status: "error", reason: "quota exhausted" })); process.exitCode = 1;']
      : mode === 'not-configured' ? ['console.log(JSON.stringify({ status: "error", charged: false, reason: "not_configured: set FIXTURE_KEY" })); process.exitCode = 1;']
      : mode === 'killed' ? ['process.kill(process.pid, "SIGKILL");']
      : mode === 'unknown' ? ['console.log(JSON.stringify({ status: "error", reason: "connection timed out" })); process.exitCode = 1;']
      : mode === 'duplicate' ? ['console.log(JSON.stringify({ status: "error", reason: "stale output: identical to a reference image" })); process.exitCode = 1;']
      : ['console.log(JSON.stringify({ status: "ok" }));']),
  ].join('\n'));
  await writeFile(path.join(scripts, 'gemini-image.mjs'), [
    "import { writeFileSync } from 'node:fs';",
    'const args = process.argv.slice(2);',
    'writeFileSync(args[args.indexOf("--out") + 1], JSON.stringify({ subscription: true }));',
    'console.log(JSON.stringify({ status: "ok" }));',
  ].join('\n'));
  const jobs = Array.from({ length: count }, (_, i) => ({ id: 'paid-' + i, prompt: 'fixture ' + i,
    ...(mode === 'aspect' ? { aspect: '1:1' } : {}) }));
  const document = series ? { series: { style: 'fixture style', ref: ['anchor.png'], max_retries: 10 }, jobs } : jobs;
  const jobsFile = path.join(dir, 'jobs.json');
  await writeFile(jobsFile, JSON.stringify(document));
  const result = await run(process.execPath, [path.join(here, 'batch.mjs'), '--jobs', jobsFile,
    '--out', path.join(dir, 'out'), '--engines', subscription ? 'api,gemini' : 'api',
    '--lanes', 'api=' + lanes + ',gemini=1'], {
    HOME: dir, PYTHON: python, IMAGE_GEN_API_CONFIG: config, IMAGE_GEN_API_LEDGER: ledger,
    IMAGE_GEN_ENGINE_OFF: path.join(dir, 'off'), IMAGE_GEN_TEST_SCRIPTS: 'yes', IMAGE_GEN_SCRIPT_DIR: scripts,
  });
  const rows = text => text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const events = rows(result.stdout);
  const saved = JSON.parse(await readFile(path.join(dir, 'out', 'batch-results.json'), 'utf8'));
  return { ...result, events, summary: events.at(-1), saved,
    calls: rows(await readFile(callsFile, 'utf8')), ledger: rows(await readFile(ledger, 'utf8')) };
}

for (const scenario of [
  { name: 'one image cap', cap: 0.04, expected: 1 },
  { name: 'two image cap', cap: 0.08, expected: 2 },
  { name: 'fractional cap', cap: 0.10, expected: 2 },
  { name: 'three image cap', cap: 0.12, expected: 3 },
  { name: 'four image cap with child ledger deduplication', cap: 0.16, expected: 4, childLedger: true },
  { name: 'month cap with earlier spend', cap: 1, monthCap: 0.16, prior: 0.08, expected: 2 },
  { name: 'concurrent lanes', cap: 0.12, lanes: 3, count: 6, expected: 3 },
]) {
  await checkAsync('paid series discards respect ' + scenario.name, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'paid-series-'));
    try {
      const result = await chargedBatch(dir, scenario);
      assert.equal(result.code, 1, result.stdout + result.stderr);
      const charged = result.calls.filter(call => call.image).length;
      assert.equal(charged, scenario.expected);
      const usd = Math.round(charged * 0.04 * 10000) / 10000;
      assert.ok(usd <= scenario.cap + 1e-9);
      assert.ok((scenario.prior ?? 0) + usd <= (scenario.monthCap ?? 5) + 1e-9);
      assert.equal(result.summary.paid.uncertain, 0);
      assert.equal(result.summary.paid.images, charged);
      assert.equal(result.summary.paid.usd, usd);
      assert.equal(result.summary.paid.discarded, charged);
      assert.equal(result.summary.paid.stopped_by_budget, scenario.count ?? 1);
      assert.deepEqual(result.saved.paid, result.summary.paid);
      assert.equal(result.summary.keep.style_redos, charged);
      assert.equal(result.saved.results.failed.length, scenario.count ?? 1);
      for (const job of result.saved.results.failed) {
        assert.equal(job.stopped_by_budget, true);
        assert.match(job.reason, /stopped by the paid budget/);
        assert.match(job.reason, scenario.prior ? /本月 API 预算用完/ : /本批 API 预算用完/);
      }
      const entries = result.ledger.filter(row => row.spend_id);
      assert.equal(entries.length, charged);
      assert.equal(new Set(entries.map(row => row.spend_id)).size, charged);
      assert.equal(monthSpent(result.ledger.map(row => JSON.stringify(row)).join('\n')).usd, result.summary.paid.month_usd);
      assert.equal(result.summary.paid.month_usd, Math.round(((scenario.prior ?? 0) + usd) * 10000) / 10000);
      for (const call of result.calls) assert.match(call.prompt, /STYLE GUIDE/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

for (const scenario of [
  { name: 'aspect discard', mode: 'aspect', series: false, charged: 1, stopped: 1 },
  { name: 'duplicate returned before error', mode: 'duplicate', series: false, charged: 1, stopped: 1 },
  { name: 'uncertain failure retains reservation', mode: 'unknown', series: false, charged: 0, uncertain: 1, stopped: 1 },
  { name: 'killed request retains reservation', mode: 'killed', series: false, charged: 0, uncertain: 1, stopped: 1 },
  { name: 'missing key releases reservation', mode: 'not-configured', series: false, charged: 0, stopped: 0 },
  { name: 'pre-request error leaves budget for another job', mode: 'pre-request-once', count: 2, series: false, charged: 1, stopped: 0, kept: 1, partial: true },
  { name: 'quota failure releases reservation', mode: 'quota', series: false, charged: 0, stopped: 0 },
  { name: 'uncharged rate limit leaves budget for retry', mode: 'rate-once', passAt: 2, charged: 1, stopped: 0, kept: 1 },
  { name: 'sufficient budget keeps redo routing', cap: 0.20, passAt: 3, charged: 3, stopped: 0, kept: 1 },
  { name: 'exhausted style retries still count', cap: 1, charged: 11, stopped: 0 },
  { name: 'subscription stays eligible with no paid budget', cap: 0.01, subscription: true, charged: 0, stopped: 0, kept: 1 },
]) {
  await checkAsync('paid accounting ' + scenario.name, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'paid-accounting-'));
    try {
      const result = await chargedBatch(dir, scenario);
      assert.equal(result.code, scenario.kept && !scenario.partial ? 0 : 1, result.stdout + result.stderr);
      assert.equal(result.summary.done, scenario.kept ?? 0);
      assert.equal(result.summary.paid.uncertain, scenario.uncertain ?? 0);
      assert.equal(result.summary.paid.images, scenario.charged);
      assert.equal(result.summary.paid.discarded, scenario.charged - (scenario.subscription ? 0 : scenario.kept ?? 0));
      assert.equal(result.summary.paid.stopped_by_budget, scenario.stopped);
      assert.equal(result.summary.paid.usd, Math.round(scenario.charged * 0.04 * 10000) / 10000);
      assert.equal(result.ledger.length, scenario.charged);
      assert.deepEqual(result.saved.paid, result.summary.paid);
      if (scenario.stopped) assert.match(result.saved.results.failed[0].reason, /stopped by the paid budget/);
      assert.ok(result.ledger.every(row => !row.uncertain));
      if (scenario.uncertain) {
        assert.equal(result.calls.length, 1);
        assert.equal(result.saved.results.attempts[0].charged, null);
      }
      if (scenario.mode === 'not-configured') assert.equal(result.saved.results.attempts[0].charged, false);
      if (scenario.mode === 'pre-request-once') {
        assert.equal(result.calls.length, 2);
        assert.deepEqual(result.saved.results.attempts.map(attempt => attempt.charged), [false, true]);
      }
      if (scenario.mode === 'aspect') assert.equal(result.summary.keep.redone, 1);
      if (scenario.mode === 'quota') assert.equal(result.saved.results.attempts[0].charged, false);
      if (scenario.mode === 'rate-once') {
        assert.equal(result.calls.length, 2);
        assert.deepEqual(result.saved.results.attempts.map(attempt => attempt.charged), [false, true]);
      }
      if (scenario.subscription) assert.equal(result.calls.length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

for (const scenario of [
  { cap: 0.04, expected: 1 },
  { cap: 0.08, expected: 2 },
  { cap: 0.10, expected: 2 },
  { cap: 0.12, expected: 3, lanes: 3 },
  { cap: 1, monthCap: 0.12, prior: 0.04, expected: 2 },
]) {
  await checkAsync('unknown paid failures reserve slots without ledger entries: ' + JSON.stringify(scenario), async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'paid-unknown-'));
    try {
      const result = await chargedBatch(dir, { ...scenario, mode: 'unknown', count: 6, series: false });
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.equal(result.calls.length, scenario.expected);
      assert.equal(result.summary.paid.uncertain, scenario.expected);
      assert.equal(result.summary.paid.images, 0);
      assert.equal(result.summary.paid.usd, 0);
      assert.equal(result.summary.paid.discarded, 0);
      assert.ok(result.summary.paid.stopped_by_budget > 0);
      assert.deepEqual(result.saved.paid, result.summary.paid);
      assert.equal(result.ledger.length, scenario.prior ? 1 : 0);
      assert.equal(result.summary.paid.month_usd, scenario.prior ?? 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

check('child processes receive named keys and not the rest of the environment', () => {
  const source = { PATH: '/usr/bin', HOME: '/tmp/home', UNRELATED_SECRET: 'nope', IMAGE_GEN_RUN_ID: 'from-parent' };
  const env = childEnv({ IMAGE_GEN_RUN_ID: 'run-1' }, source);
  assert.equal(env.UNRELATED_SECRET, undefined);
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/tmp/home');
  assert.equal(env.IMAGE_GEN_RUN_ID, 'run-1');
});

check('batch cleanup deletes only this run, and only marked directories', () => {
  const runId = 'run-a';
  assert.equal(removableWorkPath({ name: '.gemini-image-1', isFile: false, marker: runId, runId, ownedNames: new Set() }), true);
  assert.equal(removableWorkPath({ name: '.gemini-image-1', isFile: false, marker: 'run-b', runId, ownedNames: new Set() }), false);
  assert.equal(removableWorkPath({ name: '.gemini-image-1', isFile: false, marker: '', runId, ownedNames: new Set() }), false);
  assert.equal(removableWorkPath({ name: '.attempt-cat-grok-1.png', isFile: true, marker: '', runId, ownedNames: new Set(['.attempt-cat-grok-1.png']) }), true);
  assert.equal(removableWorkPath({ name: '.attempt-old.png', isFile: true, marker: '', runId, ownedNames: new Set() }), false);
  assert.equal(removableWorkPath({ name: 'cat.png', isFile: true, marker: runId, runId, ownedNames: new Set(['cat.png']) }), false);
});

check('sandbox retry stays in workspace-write until the user approves a wider sandbox', () => {
  const blocked = { escalateSandbox: true, approved: false, blocked: true, sandbox: 'workspace-write' };
  assert.equal(sandboxMayWiden(blocked), false);
  assert.equal(sandboxMayWiden({ ...blocked, approved: true }), true);
  assert.equal(sandboxMayWiden({ ...blocked, approved: true, blocked: false }), false);
  assert.equal(sandboxMayWiden({ escalateSandbox: false, approved: true, blocked: true, sandbox: 'workspace-write' }), false);
});

await checkAsync('dreamina wrapper rejects commands outside image generation', async () => {
  const r = await run(process.execPath, [path.join(here, 'jimeng.mjs'), 'login']);
  assert.notEqual(r.code, 0);
  assert.match(r.stdout + r.stderr, /image generation/);
});

await checkAsync('lovart client still starts from the split entry', async () => {
  const r = await run(process.env.PYTHON ?? 'python3', [path.join(here, 'lovart_agent.py'), '--help']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /query-mode/);
});

if (failed) {
  console.error((failed) + " test(s) failed");
  process.exit(1);
}
console.log('reliability tests ok');
