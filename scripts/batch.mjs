import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 抢活：一批图共用一个队列，所有引擎同时开工，每个引擎开几条通道，哪条通道空了就接下一张它做得了的活。
// 某家额度用完、没登录或没装：关掉它的全部通道，手上的活退回队列；单张失败换别家再试；输出已存在的跳过（断点续跑）。
const here = path.dirname(fileURLToPath(import.meta.url));
const ENGINES = {
  gemini: { script: 'gemini-image.mjs', ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'], ratioFlag: '--aspect', maxRefs: 3 },
  jimeng: { script: 'jimeng-image.mjs', ratios: ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'], ratioFlag: '--aspect', maxRefs: 10, video: true, textVideo: true },
  codex: { script: 'codex-image.mjs', ratios: null, ratioFlag: '--aspect', maxRefs: Infinity, extra: ['--json'] },
  grok: { script: 'grok-image.mjs', ratios: ['1:1', '16:9', '9:16', '3:2', '2:3'], ratioFlag: '--ratio', maxRefs: 1, video: true },
  lovart: { script: 'lovart.mjs', ratios: null, ratioFlag: '--aspect', maxRefs: Infinity, extra: ['--json'] },
  muse: { script: 'muse-image.py', ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'], ratioFlag: '--aspect', maxRefs: Infinity },
};
// Muse 只有一个专用浏览器，其余引擎各开两条通道；排在前面的先接活
// 停用开关：~/.config/image-gen/engine-off/<引擎名> 存在就不开这家的通道（IMAGE_GEN_ENGINE_OFF 可改目录）
const OFF_DIR = process.env.IMAGE_GEN_ENGINE_OFF ?? path.join(homedir(), '.config', 'image-gen', 'engine-off');
const OFF = existsSync(OFF_DIR) ? readdirSync(OFF_DIR) : [];
const DEFAULT_LANES = { gemini: 2, jimeng: 2, codex: 2, grok: 2, lovart: 2, muse: 1 };
// 这类报错说明这家整体用不了（额度、登录、安装），不是这一张的问题
const ENGINE_DOWN = /quota|credit|积分|余额|rate.?limit|usage limit|weekly limit|exhausted|insufficient|not enough|429|unauthori|not logged|log ?in|ComplianceConfirmation|not_configured|not_installed|not found:|ENOENT/i;

function parse(argv) {
  const o = { engines: Object.keys(ENGINES), lanes: { ...DEFAULT_LANES }, tries: 3 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') {
      console.log('batch.mjs --jobs <jobs.json> --out <dir> [--engines gemini,jimeng,codex,grok,lovart,muse] [--lanes gemini=2,muse=1] [--tries 3]\n' +
        'jobs.json: [{"id": "cat", "prompt": "...", "ref": ["a.png"], "aspect": "1:1", "video": false, "engine": "gemini"}]（ref、aspect、video、engine 可省）');
      process.exit(0);
    }
    const value = argv[++i];
    if (!value) throw new Error(`missing value for ${flag}`);
    if (flag === '--jobs') o.jobs = path.resolve(value);
    else if (flag === '--out') o.out = path.resolve(value);
    else if (flag === '--engines') o.engines = value.split(',');
    else if (flag === '--lanes') for (const pair of value.split(',')) { const [k, n] = pair.split('='); o.lanes[k] = Number(n); }
    else if (flag === '--tries') o.tries = Number(value);
    else throw new Error(`invalid argument: ${flag}`);
  }
  if (!o.jobs || !o.out) throw new Error('require --jobs and --out');
  for (const e of o.engines) if (!ENGINES[e]) throw new Error(`unknown engine: ${e}`);
  o.engines = o.engines.filter(e => !OFF.includes(e));
  return o;
}

function exec(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

// 清单写了比例的图，交回的宽高比差超过 3% 就不算数（codex、lovart、muse 的比例只写在说明里，偶尔不照做）
const PY = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
async function ratioOff(file, aspect) {
  const r = await exec(PY, [path.join(here, 'imgtool.py'), 'size', file]);
  if (r.code !== 0) throw new Error(`imgtool size failed on ${file}: ${r.stderr}`);
  const { width: w, height: h } = JSON.parse(r.stdout);
  const [a, b] = aspect.split(':').map(Number);
  return Math.abs(w / h - a / b) / (a / b) > 0.03 ? `${w}×${h}` : null;
}

const log = event => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));

async function main() {
  const o = parse(process.argv.slice(2));
  const jobs = JSON.parse(await readFile(o.jobs, 'utf8'));
  const base = path.dirname(o.jobs);
  const ids = new Set();
  for (const job of jobs) {
    if (!job.id || !job.prompt) throw new Error(`every job needs id and prompt: ${JSON.stringify(job)}`);
    if (ids.has(job.id)) throw new Error(`duplicate job id: ${job.id}`);
    ids.add(job.id);
    job.ref = (job.ref ?? []).map(r => path.resolve(base, r));
    job.file = path.join(o.out, `${job.id}.${job.video ? 'mp4' : 'png'}`);
    job.tried = [];
  }
  await mkdir(o.out, { recursive: true });
  const start = Date.now();
  const down = new Map();
  const done = [], failed = [];
  const queue = [];
  for (const job of jobs) {
    if (existsSync(job.file) && (await stat(job.file)).size > 0) done.push({ id: job.id, file: job.file, engine: 'existing' });
    else queue.push(job);
  }
  const fits = (engine, job) => {
    const e = ENGINES[engine];
    return !down.has(engine) && !job.tried.includes(engine) && (!job.engine || job.engine === engine)
      && (!job.video || e.video) && (!job.aspect || !e.ratios || e.ratios.includes(job.aspect))
      && job.ref.length <= e.maxRefs && (!job.video || job.ref.length > 0 || e.textVideo);
  };
  // 没有任何还开着、还没试过的引擎能接的活，判定失败
  const settleOrphans = () => {
    for (let i = queue.length - 1; i >= 0; i--) {
      const job = queue[i];
      if (!o.engines.some(engine => fits(engine, job)) || job.tried.length >= o.tries) {
        queue.splice(i, 1);
        failed.push({ id: job.id, tried: job.tried, reason: job.reason ?? '没有能接这张图的引擎（比例、参考图数、视频或额度）' });
        log({ event: 'failed', id: job.id, reason: failed.at(-1).reason });
      }
    }
  };
  settleOrphans();

  let running = 0;
  async function lane(engine, n) {
    const e = ENGINES[engine];
    while (!down.has(engine)) {
      const index = queue.findIndex(job => fits(engine, job));
      if (index < 0) {
        // 暂时没活可接：别的通道还有活在跑就等着（它失败退回的活可能正好归这里），都跑完了才退出
        if (running === 0) return;
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      const job = queue.splice(index, 1)[0];
      running++;
      job.tried.push(engine);
      const script = path.join(here, e.script);
      const args = [script, '--prompt', job.prompt, '--out', job.file, ...(e.extra ?? []),
        ...job.ref.flatMap(r => ['--ref', r]), ...(job.aspect ? [e.ratioFlag, job.aspect] : []), ...(job.video ? ['--video'] : [])];
      log({ event: 'start', id: job.id, engine, lane: n });
      const began = Date.now();
      const r = await exec(script.endsWith('.py') ? PY : process.execPath, args);
      const line = r.stdout.trim().split('\n').at(-1) ?? '';
      const report = line.startsWith('{') ? JSON.parse(line) : { status: 'error', reason: (r.stderr || r.stdout).slice(-500) };
      const seconds = Math.round((Date.now() - began) / 1000);
      running--;
      const off = r.code === 0 && report.status === 'ok' && job.aspect && !job.video ? await ratioOff(job.file, job.aspect) : null;
      if (off) {
        await rm(job.file);
        report.status = 'error';
        report.reason = `比例不对：要 ${job.aspect}，交回 ${off}`;
      }
      if (r.code === 0 && report.status === 'ok') {
        done.push({ id: job.id, file: job.file, engine, lane: n, seconds, started: new Date(began).toISOString(), finished: new Date().toISOString() });
        log({ event: 'done', id: job.id, engine, seconds });
        continue;
      }
      job.reason = `${engine}: ${report.reason ?? report.error ?? 'unknown error'}`.slice(0, 600);
      if (ENGINE_DOWN.test(job.reason)) {
        down.set(engine, job.reason);
        job.tried.pop();
        log({ event: 'engine_down', engine, reason: job.reason });
      } else {
        log({ event: 'retry', id: job.id, engine, reason: job.reason });
      }
      queue.push(job);
      settleOrphans();
    }
  }

  const lanes = o.engines.flatMap(engine => Array.from({ length: o.lanes[engine] ?? 0 }, (_, n) => lane(engine, n + 1)));
  await Promise.all(lanes);
  settleOrphans();
  for (const job of queue.splice(0)) failed.push({ id: job.id, tried: job.tried, reason: job.reason ?? '所有通道都已退出' });
  const byEngine = Object.fromEntries(o.engines.map(engine => [engine, done.filter(d => d.engine === engine).length]));
  const summary = { status: failed.length ? 'partial' : 'ok', done: done.length, failed: failed.length, by_engine: byEngine,
    engines_down: Object.fromEntries(down), elapsed_seconds: Math.round((Date.now() - start) / 1000), results: { done, failed } };
  await writeFile(path.join(o.out, 'batch-results.json'), JSON.stringify(summary, null, 2));
  log({ event: 'summary', ...summary, results: undefined });
  if (failed.length) process.exitCode = 1;
}

main().catch(e => { console.log(JSON.stringify({ status: 'error', reason: e.message })); process.exitCode = 1; });
