import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir, totalmem } from 'node:os';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInvokedDirectly } from './direct.mjs';
import { engineSpec, loadApiConfig, readLedger } from './api-image.mjs';

// 抢活：一批图共用一个队列，所有引擎同时开工，每个引擎开几条通道，哪条通道空了就接下一张它做得了的活。
// 队列空了以后抢尾单：正在做的那家已经明显超过自己的通常耗时（中位数的 1.5 倍）才允许再做一份，
// 同时最多一份重复；谁先做完用谁，另一份停掉或丢掉。
// 额度用完、没登录或没装：立刻关掉它的全部通道，手上的活退回队列。
// 普通的 429 / 限流先退避，连续失败达到次数才关掉。单张失败换别家再试；输出已存在的跳过（断点续跑）。
const here = path.dirname(fileURLToPath(import.meta.url));
const ENGINES = {
  gemini: { script: 'gemini-image.mjs', ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'], ratioFlag: '--aspect', maxRefs: 3 },
  jimeng: { script: 'jimeng-image.mjs', ratios: ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'], ratioFlag: '--aspect', maxRefs: 10, video: true, textVideo: true },
  codex: { script: 'codex-image.mjs', ratios: null, ratioFlag: '--aspect', maxRefs: Infinity, extra: ['--json'] },
  grok: { script: 'grok-image.mjs', ratios: ['1:1', '16:9', '9:16', '3:2', '2:3'], ratioFlag: '--ratio', maxRefs: 1, video: true },
  lovart: { script: 'lovart.mjs', ratios: null, ratioFlag: '--aspect', maxRefs: Infinity, extra: ['--json'] },
  muse: { script: 'muse-image.py', ratios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'], ratioFlag: '--aspect', maxRefs: Infinity },
};
// 按次付费的 API 线路（最后一档）：写了 ~/.config/imagegen-swarm/api.json 才开。
// 只接订阅引擎都接不了的图（都没额度、都试过、或比例和参考图数都不合适），从不抢尾单，花到本批或本月预算就关掉
const API = loadApiConfig();
if (API) {
  const spec = engineSpec(API);
  ENGINES.api = { script: 'api-image.mjs', ratios: null, acceptsRatio: spec.acceptsRatio, ratioFlag: '--aspect', maxRefs: spec.maxRefs, paid: true, extra: ['--json'] };
}
// 通道数以 8GB 内存为基准（M1 实测同时 12 份单张不变慢、内存还剩约 30%）：Gemini、Codex 6 条，即梦、Grok 4 条，Lovart 2 条；
// 按本机内存等比例增减，每家至少 1 条、最多 1.5 倍，Muse 只有一个专用浏览器固定 1 条；排在前面的先接活
// 停用开关：~/.config/imagegen-swarm/engine-off/<引擎名> 存在就不开这家的通道（IMAGE_GEN_ENGINE_OFF 可改目录）。
// 旧目录 ~/.config/image-gen/engine-off 里的开关仍然有效，避免改名后把已经关掉的引擎重新打开。
function engineOffNames() {
  const dirs = process.env.IMAGE_GEN_ENGINE_OFF
    ? [process.env.IMAGE_GEN_ENGINE_OFF]
    : [path.join(homedir(), '.config', 'imagegen-swarm', 'engine-off'), path.join(homedir(), '.config', 'image-gen', 'engine-off')];
  const names = new Set();
  for (const dir of dirs) if (existsSync(dir)) for (const name of readdirSync(dir)) names.add(name);
  return [...names];
}
const OFF = engineOffNames();
// 各家单张耗时的起始估计（秒），开跑后按本批实测的中位数更新
const TYPICAL_SECONDS = { gemini: 30, jimeng: 35, codex: 35, grok: 55, lovart: 45, muse: 110, api: 30 };
const BASE_LANES = { gemini: 6, jimeng: 4, codex: 6, grok: 4, lovart: 2, muse: 1 };
// IMAGE_GEN_MEMORY_GB 可指定按多大内存来定通道数（想给别的程序留内存时设小一点）
const MEMORY_GB = Number(process.env.IMAGE_GEN_MEMORY_GB ?? totalmem() / 2 ** 30);
const DEFAULT_LANES = Object.fromEntries(Object.entries(BASE_LANES).map(([engine, n]) =>
  [engine, engine === 'muse' ? 1 : Math.max(1, Math.min(Math.round(n * 1.5), Math.round(n * MEMORY_GB / 8)))]));
// API 线路只发网络请求，不占内存，通道数照配置文件的 lanes（默认 4）
if (API) DEFAULT_LANES.api = API.lanes;
// 额度用完、没登录、没装：立刻停用。普通 429 / 限流先退避，连续这么多次才停用。
export const RATE_LIMIT_STRIKES = 3;
export const STEAL_FACTOR = 1.5;
const QUOTA_DOWN = /\bquota\b|\bcredits?\b|积分|余额|insufficient_quota|预算用完|budget used up|insufficient balance|usage limit|weekly limit|insufficient\s+(?:credits?|quota|balance|funds)|not enough\s+(?:credits?|quota|balance)|out of\s+(?:credits?|quota)/i;
const AUTH_DOWN = /unauthori[sz]ed|\bnot logged[ -]?in\b|\blog[ -]?in\b|authentication required|ComplianceConfirmation|not_configured/i;
// 「not found / ENOENT」只认引擎本身没装。参考图或输出文件找不到不算整家引擎挂了。
const NOT_INSTALLED = /not[_\s-]?installed|找不到\s*lv|\b(?:agy|codex(?:\s+CLI|\s+path)?|grok|dreamina|lv|muse|playwright)\s+not found\b|\bnot found:\s*(?:agy|codex|grok|dreamina|lv|muse)\b|\bcommand not found\b|\bspawn\w*\b[^\n]{0,200}\bENOENT\b/i;
const RATE_LIMIT = /\b429\b|rate[\s-]?limit|too many requests|RESOURCE_EXHAUSTED/i;

export function failureText(report) {
  const detail = report?.reason ?? report?.error ?? 'unknown error';
  if (report?.error_kind && !String(detail).includes(String(report.error_kind))) return `${detail} (${report.error_kind})`;
  return String(detail);
}

// 'down' 立刻停用；'rate_limit' 计入连续限流；'retry' 只是这一张失败。
export function classifyEngineError(reason) {
  const text = String(reason ?? '');
  if (QUOTA_DOWN.test(text) || AUTH_DOWN.test(text) || NOT_INSTALLED.test(text)) return 'down';
  if (RATE_LIMIT.test(text)) return 'rate_limit';
  return 'retry';
}

export function applyEngineFailure(state, reason) {
  const strikes = state?.strikes ?? 0;
  const kind = classifyEngineError(reason);
  if (kind === 'down') return { action: 'down', strikes: 0, down: true };
  if (kind === 'rate_limit') {
    const next = strikes + 1;
    if (next >= RATE_LIMIT_STRIKES) return { action: 'down', strikes: next, down: true };
    return { action: 'backoff', strikes: next, down: false, backoffSeconds: 2 ** next };
  }
  return { action: 'retry', strikes: 0, down: false };
}

// 本批已完成耗时的中位数；还没有样本就用调用方给的起始估计。偶数个取靠后的那个，和原先下标算法一致。
export function medianSeconds(samples, fallback) {
  const seconds = [...samples].filter(n => n > 0).sort((a, b) => a - b);
  if (!seconds.length) return fallback;
  return seconds[Math.floor(seconds.length / 2)];
}

// 只有持有者已经超过自己通常耗时的 1.5 倍，才允许再开一份；已经有一份重复时不再开。
export function shouldSteal({ activeCount, holderTypical, holderElapsed }) {
  if (activeCount !== 1) return false;
  if (!(holderTypical > 0) || !(holderElapsed >= 0)) return false;
  return holderElapsed > holderTypical * STEAL_FACTOR;
}

// 付费线路只在没有一家订阅引擎接得了这张图时才接；清单点名要它的直接接
export function paidMayTake({ named, subscriptionCanTake }) {
  return named || !subscriptionCanTake;
}

// 再开一张付费图后，本批（含正在做的）和本月的估算花费都不能超过预算
export function paidBudgetLeft({ price, committed, budgetBatch, monthSpent, budgetMonth }) {
  const next = (committed + 1) * price;
  if (next > budgetBatch + 1e-9) return `本批 API 预算用完：上限 $${budgetBatch}，每张约 $${price}（budget used up）`;
  if (monthSpent + next > budgetMonth + 1e-9) return `本月 API 预算用完：已花约 $${monthSpent}，上限 $${budgetMonth}（budget used up）`;
  return null;
}

// 已有一份做完，或这一份是被取消的：丢掉，不要当成失败，也不要再改写出的图。
export function attemptDisposition({ cancelled, won, code, status }) {
  if (cancelled || won) return 'ignore';
  if (code === 0 && status === 'ok') return 'win';
  return 'fail';
}

function parse(argv) {
  const o = { engines: Object.keys(ENGINES), lanes: { ...DEFAULT_LANES }, tries: 3 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') {
      console.log('batch.mjs --jobs <jobs.json> --out <dir> [--engines gemini,jimeng,codex,grok,lovart,muse,api] [--lanes gemini=2,muse=1] [--tries 3]\n' +
        'api 是按次付费的最后一档，写了 ~/.config/image-gen/api.json 才有\n' +
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
  for (const e of o.engines) {
    if (e === 'api' && !API) throw new Error('api engine is not configured: write ~/.config/image-gen/api.json (see SETUP.md)');
    if (!ENGINES[e]) throw new Error(`unknown engine: ${e}`);
  }
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

// 并行的另一家可能也写进了 tried，只能删掉自己这次，不能 pop 掉队尾
function untry(job, engine) {
  const at = job.tried.lastIndexOf(engine);
  if (at >= 0) job.tried.splice(at, 1);
}

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
  const rateStrikes = new Map();
  const rateBackoffUntil = new Map();
  const done = [], failed = [];
  const queue = [];
  for (const job of jobs) {
    if (existsSync(job.file) && (await stat(job.file)).size > 0) done.push({ id: job.id, file: job.file, engine: 'existing' });
    else queue.push(job);
  }
  const capable = (engine, job) => {
    const e = ENGINES[engine];
    const ratioOk = !job.aspect || (e.acceptsRatio ? e.acceptsRatio(job.aspect) : !e.ratios || e.ratios.includes(job.aspect));
    return !down.has(engine) && !job.tried.includes(engine) && (!job.engine || job.engine === engine)
      && (!job.video || e.video) && ratioOk
      && job.ref.length <= e.maxRefs && (!job.video || job.ref.length > 0 || e.textVideo);
  };
  // 订阅引擎还在限流退避也算接得了：付费线路等它，不为了快去花钱
  const fits = (engine, job) => capable(engine, job) && (!ENGINES[engine].paid || paidMayTake({
    named: job.engine === engine,
    subscriptionCanTake: o.engines.some(other => !ENGINES[other].paid && capable(other, job)),
  }));
  const monthAtStart = API ? readLedger().usd : 0;
  let paidCommitted = 0;
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
  // 一次尝试从开工算到收尾（量比例、清临时文件、把没出成的图退回队列）都算正在跑：
  // 别的通道看到没人在跑、队列也空才收工，收尾没做完就把计数减掉的话，退回来的图会没人接
  async function attempt(engine, n, job) {
    running++;
    // 付费线路开工就先占上这张的预算，没出成再还回去
    if (ENGINES[engine].paid) paidCommitted++;
    try {
      await attemptOnce(engine, n, job);
    } finally {
      running--;
      if (ENGINES[engine].paid && !done.some(d => d.id === job.id && d.engine === engine && d.lane === n)) paidCommitted--;
    }
  }

  async function attemptOnce(engine, n, job) {
    const e = ENGINES[engine];
    job.tried.push(engine);
    const record = { id: job.id, engine, lane: n, started: new Date().toISOString() };
    job.active.push(record);
    attempts.push(record);
    // 先写临时文件，赢了才改成正式文件名
    const temp = path.join(o.out, `.attempt-${job.id}-${engine}-${serial++}${path.extname(job.file)}`);
    const script = path.join(here, e.script);
    // Muse 不能用信号停（它的浏览器库收到中断会卡住），改用取消文件
    record.cancelFile = engine === 'muse' ? `${temp}.cancel` : null;
    const args = [script, '--prompt', job.prompt, '--out', temp, ...(e.extra ?? []), ...(record.cancelFile ? ['--cancel-file', record.cancelFile] : []),
      ...job.ref.flatMap(r => ['--ref', r]), ...(job.aspect ? [e.ratioFlag, job.aspect] : []), ...(job.video ? ['--video'] : [])];
    log({ event: job.active.length > 1 ? 'steal' : 'start', id: job.id, engine, lane: n });
    const r = await exec(script.endsWith('.py') ? PY : process.execPath, args, child => { record.child = child; });
    delete record.child;
    record.finished = record.finished ?? new Date().toISOString();
    job.active.splice(job.active.indexOf(record), 1);
    const line = r.stdout.trim().split('\n').at(-1) ?? '';
    // 被停掉的那份，或别人已经交卷的那份，不再解析、不再当成失败
    let report = { status: 'error', reason: (r.stderr || r.stdout).slice(-500) };
    if (record.outcome !== 'cancelled' && !job.won) {
      if (line.startsWith('{')) {
        try { report = JSON.parse(line); } catch { report = { status: 'error', reason: line.slice(-500) }; }
      }
      if (r.code === 0 && report.status === 'ok' && job.aspect && !job.video) {
        const off = await ratioOff(temp, job.aspect);
        if (off) {
          report.status = 'error';
          report.reason = `比例不对：要 ${job.aspect}，交回 ${off}`;
        }
      }
    }
    const disposition = attemptDisposition({ cancelled: record.outcome === 'cancelled', won: Boolean(job.won), code: r.code, status: report.status });
    if (disposition === 'ignore') {
      record.outcome = 'cancelled';
      await rm(temp, { force: true });
      return;
    }
    if (disposition === 'win') {
      rateStrikes.set(engine, 0);
      job.won = true;
      await rm(job.file, { force: true });
      await writeFile(job.file, await readFile(temp));
      await rm(temp, { force: true });
      record.outcome = 'done';
      const seconds = Math.round((Date.parse(record.finished) - Date.parse(record.started)) / 1000);
      done.push({ id: job.id, file: job.file, engine, lane: n, seconds, started: record.started, finished: record.finished });
      log({ event: 'done', id: job.id, engine, seconds });
      // 同一张图还在别家做的那份停掉：Muse 写取消文件，它删掉自己的侧聊天再退出；其余引擎连同子进程整组发 SIGINT
      for (const other of job.active) {
        other.outcome = 'cancelled';
        other.finished = new Date().toISOString();
        if (other.cancelFile) await writeFile(other.cancelFile, 'cancel');
        else if (other.child) {
          try { process.kill(-other.child.pid, 'SIGINT'); } catch { /* 那一份已经退出，忽略即可 */ }
        }
        log({ event: 'cancel', id: job.id, engine: other.engine });
      }
      return;
    }
    await rm(temp, { force: true });
    record.outcome = 'failed';
    job.reason = `${engine}: ${failureText(report)}`.slice(0, 600);
    const next = applyEngineFailure({ strikes: rateStrikes.get(engine) ?? 0 }, job.reason);
    rateStrikes.set(engine, next.strikes);
    if (next.action === 'down') {
      down.set(engine, job.reason);
      untry(job, engine);
      log({ event: 'engine_down', engine, reason: job.reason, ...(next.strikes ? { rate_limit_strikes: next.strikes } : {}) });
    } else if (next.action === 'backoff') {
      // 限流不算这张已经试过：退避结束后同一家还能再接，连续三次才停用
      untry(job, engine);
      rateBackoffUntil.set(engine, Date.now() + next.backoffSeconds * 1000);
      log({ event: 'rate_limit', id: job.id, engine, strikes: next.strikes, backoff_seconds: next.backoffSeconds, reason: job.reason });
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
  const typical = engine => medianSeconds(done.filter(d => d.engine === engine).map(d => d.seconds), TYPICAL_SECONDS[engine]);

  async function lane(engine, n) {
    while (!down.has(engine)) {
      const until = rateBackoffUntil.get(engine) ?? 0;
      if (until > Date.now()) {
        await new Promise(resolve => setTimeout(resolve, Math.min(1000, until - Date.now())));
        continue;
      }
      const index = queue.findIndex(job => fits(engine, job));
      if (index >= 0 && ENGINES[engine].paid) {
        const over = paidBudgetLeft({ price: API.price, committed: paidCommitted, budgetBatch: API.budgetBatch, monthSpent: monthAtStart, budgetMonth: API.budgetMonth });
        if (over) {
          // 付费线路原本接得了、被预算挡下的图，失败原因写明预算用完
          for (const job of queue) if (fits(engine, job)) job.reason = `${engine}: ${over}`;
          down.set(engine, over);
          log({ event: 'engine_down', engine, reason: over });
          settleOrphans();
          return;
        }
      }
      if (index >= 0) {
        await attempt(engine, n, queue.splice(index, 1)[0]);
        continue;
      }
      // 付费线路不抢尾单
      if (ENGINES[engine].paid) {
        if (running === 0) return;
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      // 队列空了才考虑抢尾单：持有者超过自己中位数的 1.5 倍才抢，已经有一份重复就不再抢。
      // 挑超出比例最大的那张。谁先做完用谁。
      const now = Date.now();
      const overrun = job => ((now - Date.parse(job.active[0].started)) / 1000) / typical(job.active[0].engine);
      const tail = jobs.filter(job => {
        if (job.won || job.active.length !== 1 || !fits(engine, job)) return false;
        const holder = job.active[0];
        const elapsed = (now - Date.parse(holder.started)) / 1000;
        return shouldSteal({ activeCount: job.active.length, holderTypical: typical(holder.engine), holderElapsed: elapsed });
      }).sort((a, b) => overrun(b) - overrun(a))[0];
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
  for (const name of readdirSync(o.out)) if (/^\.(attempt-|codex-img-|gemini-image-|grok-image-|jimeng-image-|muse-image-|lovart-|api-image-)/.test(name)) await rm(path.join(o.out, name), { recursive: true, force: true });
  const byEngine = Object.fromEntries(o.engines.map(engine => [engine, done.filter(d => d.engine === engine).length]));
  const last = done.filter(d => d.finished).map(d => Date.parse(d.finished));
  const paidImages = done.filter(d => d.engine === 'api').length;
  const paid = API ? { images: paidImages, usd: Math.round(paidImages * API.price * 10000) / 10000, month_usd: readLedger().usd, budget_per_month: API.budgetMonth } : undefined;
  const summary = { status: failed.length ? 'partial' : 'ok', done: done.length, failed: failed.length, by_engine: byEngine, paid,
    engines_down: Object.fromEntries(down), elapsed_seconds: Math.round(((last.length ? Math.max(...last) : Date.now()) - start) / 1000),
    results: { done, failed, attempts } };
  await writeFile(path.join(o.out, 'batch-results.json'), JSON.stringify(summary, null, 2));
  log({ event: 'summary', ...summary, results: undefined });
  if (failed.length) process.exitCode = 1;
}

if (isInvokedDirectly(import.meta.url)) main().catch(e => { console.log(JSON.stringify({ status: 'error', reason: e.message })); process.exitCode = 1; });
