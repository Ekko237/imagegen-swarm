import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isInvokedDirectly } from './direct.mjs';
import {
  RATE_LIMIT_STRIKES, STEAL_FACTOR, applyEngineFailure, attemptDisposition, classifyEngineError,
  failureText, medianSeconds, paidBudgetLeft, paidMayTake, shouldSteal,
} from './batch.mjs';
import { engineSpec, loadApiConfig, monthSpent, openaiSize } from './api-image.mjs';
import {
  extractGenerated, parseAgyReply, parseEncodedArg, parseToolArgs, parseTranscript, transcriptFile,
} from './gemini-image.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}`);
    console.error(error.stack || error);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`ok  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}`);
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
  const broken = `{"tool_calls":[{"name":"generate_image","args":{"Prompt":${JSON.stringify(LONG).slice(0, -1)}`;
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
  const line = `{"content":"Generated image is saved at /brain/solo.png","media":[{"mime_type":"image/png","uri":"file:///brain/solo.png"}],"tool_calls":[{"name":"generate_image","args":{"Prompt":"${'x'.repeat(50)}`;
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
  const reply = `{"status":"SUCCESS","conversation_id":"${id}","response":"path /brain/out.png and then ${LONG}`;
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

check('at most one duplicate, and the loser is ignored once someone has won', () => {
  assert.equal(shouldSteal({ activeCount: 2, holderTypical: 110, holderElapsed: 500 }), false);
  assert.equal(shouldSteal({ activeCount: 0, holderTypical: 110, holderElapsed: 500 }), false);
  assert.equal(attemptDisposition({ cancelled: false, won: true, code: 0, status: 'ok' }), 'ignore');
  assert.equal(attemptDisposition({ cancelled: true, won: false, code: 0, status: 'ok' }), 'ignore');
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
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
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
    await writeFile(wrapper, await readFile(path.join(here, '..', 'references', 'lovart-lv.example.sh')));
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
    await writeFile(wrapper, await readFile(path.join(here, '..', 'references', 'lovart-lv.example.sh')));
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
    await writeFile(path.join(bin, 'stat'), `#!/bin/sh
if [ "$1" = "-c" ]; then
  echo "stat: illegal option -- c" >&2
  exit 1
fi
if [ "$1" = "-f" ]; then
  exec /usr/bin/stat -c %a "$3"
fi
exit 1
`);
    await chmod(path.join(bin, 'stat'), 0o755);
    const envFile = path.join(dir, 'env');
    const agent = path.join(dir, 'agent.py');
    const wrapper = path.join(dir, 'lv');
    await writeFile(envFile, 'export LOVART_ACCESS_KEY=ak_test\nexport LOVART_SECRET_KEY=sk_test\n');
    await chmod(envFile, 0o600);
    await writeFile(agent, 'import sys\nprint("no credits")\nsys.exit(3)\n');
    await writeFile(wrapper, await readFile(path.join(here, '..', 'references', 'lovart-lv.example.sh')));
    await chmod(wrapper, 0o755);
    const ok = await run(wrapper, ['chat'], {
      LOVART_ENV: envFile,
      LOVART_AGENT_SKILL: agent,
      HOME: dir,
      PATH: `${bin}:${process.env.PATH}`,
    });
    assert.equal(ok.code, 3, `stdout=${ok.stdout} stderr=${ok.stderr}`);
    assert.match(ok.stdout, /no credits/);
    assert.doesNotMatch(ok.stderr, /Refusing to run/);
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
      assert.equal(r.code, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
      assert.match(r.stdout, /--jobs/, entry);
    }
    for (const entry of ['batch-link.mjs', 'scripts/batch.mjs', 'batch-chain.mjs']) {
      const r = await run(process.execPath, [entry, '--help'], undefined, dir);
      assert.equal(r.code, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
      assert.match(r.stdout, /--jobs/, entry);
    }
    for (const entry of [geminiPath, geminiLink, path.join(parentLink, 'gemini-image.mjs')]) {
      const r = await run(process.execPath, [entry, '--help']);
      assert.equal(r.code, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
      assert.match(r.stdout, /gemini-image\.mjs/, entry);
    }

    const imported = await run(process.execPath, ['--input-type=module', '-e',
      `await import(${JSON.stringify(pathToFileURL(batchPath).href)}); console.log('imported-only');`]);
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
    assert.ok(Math.abs(w / h - a / b) / (a / b) < 0.03, `${aspect} -> ${w}x${h}`);
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

// 真实跑 batch.mjs：没配 key 的付费线路，不会产生任何请求和花费
async function paidBatch(dir, jobs, args) {
  const config = path.join(dir, 'api.json');
  await writeFile(config, JSON.stringify({ provider: 'openai', model: 'gpt-image-2', key_env: 'IMAGE_GEN_TEST_NO_KEY', price_per_image: 0.04, budget_per_batch: 1, budget_per_month: 5 }));
  await writeFile(path.join(dir, 'jobs.json'), JSON.stringify(jobs));
  const r = await run(process.execPath, [path.join(here, 'batch.mjs'), '--jobs', path.join(dir, 'jobs.json'), '--out', path.join(dir, 'out'), ...args],
    { IMAGE_GEN_API_CONFIG: config, IMAGE_GEN_API_LEDGER: path.join(dir, 'ledger.jsonl'), IMAGE_GEN_TEST_NO_KEY: '' });
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
    assert.deepEqual(events.at(-1).paid, { images: 0, usd: 0, month_usd: 0, budget_per_month: 5 });
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
      { IMAGE_GEN_API_CONFIG: config, IMAGE_GEN_API_LEDGER: path.join(dir, 'ledger.jsonl'), IMAGE_GEN_TEST_NO_KEY: '' });
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

if (failed) {
  console.error(`${failed} test(s) failed`);
  process.exit(1);
}
console.log('reliability tests ok');
