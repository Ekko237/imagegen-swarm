import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir, totalmem } from 'node:os';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 抢活：一批图共用一个队列，所有引擎同时开工，每个引擎开几条通道，哪条通道空了就接下一张它做得了的活。
// 队列空了以后抢尾单：空闲通道估得出自己能明显早于正在做的那家交图，才把那张也做一份，谁先做完用谁，其余的立刻停掉。
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
// 通道数以 8GB 内存为基准（M1 实测同时 12 份单张不变慢、内存还剩约 30%）：Gemini、Codex 6 条，即梦、Grok 4 条，Lovart 2 条；
// 按本机内存等比例增减，每家至少 1 条、最多 1.5 倍，Muse 只有一个专用浏览器固定 1 条；排在前面的先接活
// 停用开关：~/.config/image-gen/engine-off/<引擎名> 存在就不开这家的通道（IMAGE_GEN_ENGINE_OFF 可改目录）
const OFF_DIR = process.env.IMAGE_GEN_ENGINE_OFF ?? path.join(homedir(), '.config', 'image-gen', 'engine-off');
const OFF = existsSync(OFF_DIR) ? readdirSync(OFF_DIR) : [];
// 各家单张耗时的起始估计（秒），开跑后按本批实测的中位数更新
const TYPICAL_SECONDS = { gemini: 30, jimeng: 35, codex: 35, grok: 55, lovart: 45, muse: 110 };
const BASE_LANES = { gemini: 6, jimeng: 4, codex: 6, grok: 4, lovart: 2, muse: 1 };
const MEMORY_GB = totalmem() / 2 ** 30;
const DEFAULT_LANES = Object.fromEntries(Object.entries(BASE_LANES).map(([engine, n]) =>
  [engine, engine === 'muse' ? 1 : Math.max(1, Math.min(Math.round(n * 1.5), Math.round(n * MEMORY_GB / 8)))]));
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

function exec(bin, args, onChild) {
  return new Promise((resolve, reject) => {
    // 单独成一个进程组，抢尾单输了的一份可以连同它起的子进程一起停掉
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: Boolean(onChild) });
    onChild?.(child);
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

  // 每次尝试（成功、失败、被停掉）都记下来，时间线用
  const attempts = [];
  let running = 0, serial = 0;
  async function attempt(engine, n, job) {
    const e = ENGINES[engine];
    running++;
    job.tried.push(engine);
    const record = { id: job.id, engine, lane: n, started: new Date().toISOString() };
    job.active.push(record);
    attempts.push(record);
    // 先写临时文件，赢了才改成正式文件名
    const temp = path.join(o.out, `.attempt-${job.id}-${engine}-${serial++}${path.extname(job.file)}`);
    const script = path.join(here, e.script);
    const args = [script, '--prompt', job.prompt, '--out', temp, ...(e.extra ?? []),
      ...job.ref.flatMap(r => ['--ref', r]), ...(job.aspect ? [e.ratioFlag, job.aspect] : []), ...(job.video ? ['--video'] : [])];
    log({ event: job.active.length > 1 ? 'steal' : 'start', id: job.id, engine, lane: n });
    const r = await exec(script.endsWith('.py') ? PY : process.execPath, args, child => { record.child = child; });
    delete record.child;
    record.finished = record.finished ?? new Date().toISOString();
    running--;
    job.active.splice(job.active.indexOf(record), 1);
    if (record.outcome === 'cancelled') {
      await rm(temp, { force: true });
      return;
    }
    const line = r.stdout.trim().split('\n').at(-1) ?? '';
    const report = line.startsWith('{') ? JSON.parse(line) : { status: 'error', reason: (r.stderr || r.stdout).slice(-500) };
    const off = r.code === 0 && report.status === 'ok' && job.aspect && !job.video ? await ratioOff(temp, job.aspect) : null;
    if (off) {
      report.status = 'error';
      report.reason = `比例不对：要 ${job.aspect}，交回 ${off}`;
    }
    if (r.code === 0 && report.status === 'ok' && !job.won) {
      job.won = true;
      await rm(job.file, { force: true });
      await writeFile(job.file, await readFile(temp));
      await rm(temp, { force: true });
      record.outcome = 'done';
      const seconds = Math.round((Date.parse(record.finished) - Date.parse(record.started)) / 1000);
      done.push({ id: job.id, file: job.file, engine, lane: n, seconds, started: record.started, finished: record.finished });
      log({ event: 'done', id: job.id, engine, seconds });
      // 同一张图还在别家做的那份停掉（SIGINT：Muse 收到后会删掉自己的侧聊天再退出）
      for (const other of job.active) {
        other.outcome = 'cancelled';
        other.finished = new Date().toISOString();
        if (other.child) process.kill(-other.child.pid, 'SIGINT');
        log({ event: 'cancel', id: job.id, engine: other.engine });
      }
      return;
    }
    await rm(temp, { force: true });
    record.outcome = 'failed';
    job.reason = `${engine}: ${report.reason ?? report.error ?? 'unknown error'}`.slice(0, 600);
    if (ENGINE_DOWN.test(job.reason)) {
      down.set(engine, job.reason);
      job.tried.pop();
      log({ event: 'engine_down', engine, reason: job.reason });
    } else {
      log({ event: 'retry', id: job.id, engine, reason: job.reason });
    }
    // 别家还在做这张就不退回队列
    if (!job.active.length && !job.won) {
      queue.push(job);
      settleOrphans();
    }
  }

  // 某家单张耗时：本批已完成的取中位数，还没有就用起始估计
  const typical = engine => {
    const seconds = done.filter(d => d.engine === engine && d.seconds).map(d => d.seconds).sort((a, b) => a - b);
    return seconds.length ? seconds[Math.floor(seconds.length / 2)] : TYPICAL_SECONDS[engine];
  };

  async function lane(engine, n) {
    while (!down.has(engine)) {
      const index = queue.findIndex(job => fits(engine, job));
      if (index >= 0) {
        await attempt(engine, n, queue.splice(index, 1)[0]);
        continue;
      }
      // 队列空了：抢尾单。估算正在做的那家还要多久交图，比自己做一张的时间多出两成以上才抢，挑剩余时间最长的那张
      const now = Date.now();
      const remaining = job => typical(job.active[0].engine) - (now - Date.parse(job.active[0].started)) / 1000;
      const tail = jobs.filter(job => !job.won && job.active.length === 1 && fits(engine, job) && remaining(job) > typical(engine) * 1.2)
        .sort((a, b) => remaining(b) - remaining(a))[0];
      if (tail) {
        await attempt(engine, n, tail);
        continue;
      }
      // 暂时没活可接：别的通道还有活在跑就等着（它失败退回的活可能正好归这里），都跑完了才退出
      if (running === 0) return;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  for (const job of jobs) job.active = [];
  log({ event: 'lanes', memory_gb: Math.round(MEMORY_GB), lanes: Object.fromEntries(o.engines.map(engine => [engine, o.lanes[engine] ?? 0])) });
  const lanes = o.engines.flatMap(engine => Array.from({ length: o.lanes[engine] ?? 0 }, (_, n) => lane(engine, n + 1)));
  await Promise.all(lanes);
  settleOrphans();
  for (const job of queue.splice(0)) failed.push({ id: job.id, tried: job.tried, reason: job.reason ?? '所有通道都已退出' });
  // 被停掉的那几份留下的工作目录一并清掉
  for (const name of readdirSync(o.out)) if (/^\.(attempt-|codex-img-|gemini-image-|grok-image-|jimeng-image-|muse-image-|lovart-)/.test(name)) await rm(path.join(o.out, name), { recursive: true, force: true });
  const byEngine = Object.fromEntries(o.engines.map(engine => [engine, done.filter(d => d.engine === engine).length]));
  const last = done.filter(d => d.finished).map(d => Date.parse(d.finished));
  const summary = { status: failed.length ? 'partial' : 'ok', done: done.length, failed: failed.length, by_engine: byEngine,
    engines_down: Object.fromEntries(down), elapsed_seconds: Math.round(((last.length ? Math.max(...last) : Date.now()) - start) / 1000),
    results: { done, failed, attempts } };
  await writeFile(path.join(o.out, 'batch-results.json'), JSON.stringify(summary, null, 2));
  log({ event: 'summary', ...summary, results: undefined });
  if (failed.length) process.exitCode = 1;
}

main().catch(e => { console.log(JSON.stringify({ status: 'error', reason: e.message })); process.exitCode = 1; });
