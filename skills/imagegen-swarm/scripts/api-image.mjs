import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInvokedDirectly } from './direct.mjs';

// 按次付费的 API 线路：订阅额度都见底时的最后一档，用多少算多少。
// 配置文件 ~/.config/imagegen-swarm/api.json（IMAGE_GEN_API_CONFIG 可改），key 放环境变量或权限 600 的 key 文件，不写进配置。
// 每出一张图往花费账本 ~/.config/imagegen-swarm/api-spend.jsonl 记一行，本月花费到 budget_per_month 就不再出。
const here = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(homedir(), '.config', 'imagegen-swarm');
export const CONFIG_FILE = process.env.IMAGE_GEN_API_CONFIG ?? path.join(CONFIG_DIR, 'api.json');
export const LEDGER_FILE = process.env.IMAGE_GEN_API_LEDGER ?? path.join(CONFIG_DIR, 'api-spend.jsonl');

const PROVIDERS = {
  openai: { base: 'https://api.openai.com', keyEnv: 'OPENAI_API_KEY' },
  gemini: { base: 'https://generativelanguage.googleapis.com', keyEnv: 'GEMINI_API_KEY' },
};
// 老的 GPT Image 模型只有三种固定尺寸；gpt-image-2 起可以自定宽高（16 的倍数，长短边比不超过 3:1）
const OPENAI_FIXED = { 'gpt-image-1': true, 'gpt-image-1-mini': true, 'gpt-image-1.5': true };
const OPENAI_FIXED_SIZES = { '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536' };
const GEMINI_WIDE = ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'];
const GEMINI_COMMON = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const GEMINI_RATIOS = { 'gemini-nano-banana-2.1': GEMINI_WIDE, 'gemini-3.1-flash-image': GEMINI_WIDE };
const GEMINI_REFS = { 'gemini-2.5-flash-image': 3 };

const ratioValue = aspect => {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(aspect));
  if (!m) throw new Error(`bad aspect: ${aspect}`);
  return Number(m[1]) / Number(m[2]);
};

// 没有配置文件返回 null（这条线路不开）；有配置但写错了直接报错
export function loadApiConfig(file = CONFIG_FILE) {
  if (!existsSync(file)) return null;
  const c = JSON.parse(readFileSync(file, 'utf8'));
  if (!PROVIDERS[c.provider]) throw new Error(`${file}: provider must be openai or gemini`);
  if (!c.model) throw new Error(`${file}: model is required`);
  for (const k of ['price_per_image', 'budget_per_batch', 'budget_per_month']) {
    if (!(Number(c[k]) > 0)) throw new Error(`${file}: ${k} must be a positive number (USD)`);
  }
  return {
    provider: c.provider, model: c.model,
    base: String(c.base_url ?? PROVIDERS[c.provider].base).replace(/\/+$/, ''),
    keyEnv: c.key_env ?? PROVIDERS[c.provider].keyEnv,
    keyFile: c.key_file ? path.resolve(homedir(), c.key_file.replace(/^~\//, '')) : null,
    quality: c.quality ?? 'low', imageSize: c.image_size ?? '1K',
    price: Number(c.price_per_image), budgetBatch: Number(c.budget_per_batch), budgetMonth: Number(c.budget_per_month),
    lanes: Number(c.lanes ?? 4), maxRefs: c.max_refs, ratios: c.ratios,
  };
}

// key 先看环境变量，再看 key 文件（必须是 600，和 Lovart 的凭证文件同一个要求）
export function readKey(config) {
  if (process.env[config.keyEnv]) return process.env[config.keyEnv].trim();
  if (!config.keyFile) throw new Error(`not_configured: set ${config.keyEnv} or key_file in ${CONFIG_FILE}`);
  const mode = statSync(config.keyFile).mode & 0o777;
  if (process.platform !== 'win32' && mode !== 0o600) throw new Error(`not_configured: ${config.keyFile} must be chmod 600 (now ${mode.toString(8)})`);
  return readFileSync(config.keyFile, 'utf8').trim();
}

// batch.mjs 用来判断这条线路接得了哪些图
export function engineSpec(config) {
  let ratios;
  if (config.ratios) ratios = config.ratios;
  else if (config.provider === 'gemini') ratios = GEMINI_RATIOS[config.model] ?? GEMINI_COMMON;
  else if (OPENAI_FIXED[config.model]) ratios = Object.keys(OPENAI_FIXED_SIZES);
  else ratios = null;
  const acceptsRatio = ratios ? aspect => ratios.includes(aspect) : aspect => { const r = ratioValue(aspect); return r >= 1 / 3 && r <= 3; };
  const maxRefs = config.maxRefs ?? (config.provider === 'gemini' ? GEMINI_REFS[config.model] ?? 14 : 16);
  return { acceptsRatio, maxRefs };
}

// OpenAI 新模型的自定尺寸：约 157 万像素（和 1536x1024 一样多），两边都取 16 的倍数
export function openaiSize(model, aspect) {
  if (OPENAI_FIXED[model]) {
    const size = OPENAI_FIXED_SIZES[aspect ?? '1:1'];
    if (!size) throw new Error(`${model} only supports 1:1, 3:2, 2:3`);
    return size;
  }
  if (!aspect) return '1024x1024';
  const r = ratioValue(aspect);
  if (r < 1 / 3 || r > 3) throw new Error(`${model} needs an aspect between 1:3 and 3:1`);
  const pixels = 1536 * 1024;
  const w = Math.round(Math.sqrt(pixels * r) / 16) * 16;
  const h = Math.round(Math.sqrt(pixels / r) / 16) * 16;
  return `${w}x${h}`;
}

// 本月（本地时间）账本里记的花费
export function monthSpent(text, now = new Date()) {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let usd = 0, images = 0;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.month !== month) continue;
    usd += row.usd;
    images++;
  }
  return { month, usd: Math.round(usd * 10000) / 10000, images };
}

export const readLedger = () => monthSpent(existsSync(LEDGER_FILE) ? readFileSync(LEDGER_FILE, 'utf8') : '');

// HTTP 出错时把状态码写进原因，batch.mjs 靠它分辨：401/403 没登录、余额或额度用完停用整条线路、429 先退避
function httpError(status, body) {
  const text = body.slice(0, 600);
  if (status === 401 || status === 403) return new Error(`unauthorized (HTTP ${status}): ${text}`);
  if (status === 402) return new Error(`insufficient balance (HTTP 402): ${text}`);
  return new Error(`HTTP ${status}: ${text}`);
}

async function post(url, headers, body, timeout) {
  const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  if (!res.ok) throw httpError(res.status, text);
  return JSON.parse(text);
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const mimeOf = file => {
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new Error(`reference must be png, jpg or webp: ${file}`);
  return mime;
};

async function openaiImage(config, key, prompt, refs, aspect, timeout) {
  const size = openaiSize(config.model, aspect);
  const auth = { Authorization: `Bearer ${key}` };
  let json;
  if (!refs.length) {
    json = await post(`${config.base}/v1/images/generations`, { ...auth, 'Content-Type': 'application/json' },
      JSON.stringify({ model: config.model, prompt, size, quality: config.quality, n: 1, output_format: 'png' }), timeout);
  } else {
    const form = new FormData();
    for (const [k, v] of Object.entries({ model: config.model, prompt, size, quality: config.quality, n: '1', output_format: 'png' })) form.append(k, String(v));
    for (const ref of refs) form.append('image[]', new Blob([await readFile(ref)], { type: mimeOf(ref) }), path.basename(ref));
    json = await post(`${config.base}/v1/images/edits`, auth, form, timeout);
  }
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error(`no b64_json in response: ${JSON.stringify(json).slice(0, 600)}`);
  return Buffer.from(b64, 'base64');
}

// Gemini 的 Interactions 接口：图片放在 input 里，比例和尺寸放在 response_format 里
async function geminiImage(config, key, prompt, refs, aspect, timeout) {
  const input = [{ type: 'text', text: prompt }];
  for (const ref of refs) input.push({ type: 'image', mime_type: mimeOf(ref), data: (await readFile(ref)).toString('base64') });
  const format = { type: 'image', ...(aspect ? { aspect_ratio: aspect } : {}), ...(config.model === 'gemini-2.5-flash-image' ? {} : { image_size: config.imageSize }) };
  const json = await post(`${config.base}/v1beta/interactions`, { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    JSON.stringify({ model: config.model, input, response_format: format }), timeout);
  const fromSteps = (json.steps ?? []).filter(s => s.type === 'model_output').flatMap(s => s.content ?? []).find(c => c.type === 'image' && c.data);
  const b64 = fromSteps?.data ?? json.output_image?.data;
  if (!b64) throw new Error(`no image in response: ${JSON.stringify(json).slice(0, 600)}`);
  return Buffer.from(b64, 'base64');
}

function parse(argv) {
  const o = { ref: [], timeout: 300000 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--json') continue;
    if (flag === '--help' || flag === '-h') {
      console.log('api-image.mjs --prompt <text> --out <png> [--ref <image>]... [--aspect 16:9] [--timeout ms]\n' +
        `配置：${CONFIG_FILE}；花费账本：${LEDGER_FILE}`);
      process.exit(0);
    }
    if (flag === '--video') throw new Error('api engine does not make video');
    const keys = { '--prompt': 'prompt', '--prompt-file': 'promptFile', '--out': 'out', '--aspect': 'aspect', '--timeout': 'timeout' };
    const value = argv[i + 1];
    if (flag === '--ref' && value) { o.ref.push(path.resolve(value)); i++; continue; }
    if (!keys[flag] || !value || value.startsWith('--')) throw new Error(`invalid argument: ${flag}`);
    o[keys[flag]] = argv[++i];
  }
  if (!o.out || Boolean(o.prompt) === Boolean(o.promptFile)) throw new Error('require --out and exactly one of --prompt / --prompt-file');
  if (path.extname(o.out).toLowerCase() !== '.png') throw new Error('--out must be .png');
  o.out = path.resolve(o.out);
  o.timeout = Number(o.timeout);
  return o;
}

const PY = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
function imgtool(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(PY, [path.join(here, 'imgtool.py'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`imgtool ${args[0]} failed: ${err}`))));
  });
}

async function main() {
  const start = Date.now(), o = parse(process.argv.slice(2));
  const config = loadApiConfig();
  if (!config) throw new Error(`not_configured: no ${CONFIG_FILE}`);
  const prompt = o.promptFile ? await readFile(o.promptFile, 'utf8') : o.prompt;
  if (!prompt.trim()) throw new Error('empty prompt');
  const spec = engineSpec(config);
  if (o.aspect && !spec.acceptsRatio(o.aspect)) throw new Error(`${config.model} does not support aspect ${o.aspect}`);
  if (o.ref.length > spec.maxRefs) throw new Error(`${config.model} takes at most ${spec.maxRefs} reference images`);
  const spent = readLedger();
  if (spent.usd + config.price > config.budgetMonth) {
    throw new Error(`本月 API 预算用完：已花约 $${spent.usd}，上限 $${config.budgetMonth}（budget used up）`);
  }
  const key = readKey(config);
  const call = config.provider === 'openai' ? openaiImage : geminiImage;
  const bytes = await call(config, key, prompt, o.ref, o.aspect, o.timeout);
  await mkdir(path.dirname(o.out), { recursive: true });
  const work = await mkdtemp(path.join(path.dirname(o.out), `.api-image-${Date.now()}-`));
  try {
    const raw = path.join(work, 'raw.bin');
    await writeFile(raw, bytes);
    // 接口交回的图照样核对：能解码、转成 PNG、不等于任何一张参考图
    await imgtool(['png', raw, o.out]);
    if (o.ref.length) {
      const { fp } = await imgtool(['fp', o.out, ...o.ref]);
      if (fp.slice(1).includes(fp[0])) throw new Error('stale output: identical to a reference image');
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  // 出图成功才记账；接口报错一般不收费
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  await mkdir(path.dirname(LEDGER_FILE), { recursive: true });
  await appendFile(LEDGER_FILE, JSON.stringify({ at: now.toISOString(), month, provider: config.provider, model: config.model, aspect: o.aspect ?? null, refs: o.ref.length, usd: config.price }) + '\n');
  const { width, height } = await imgtool(['size', o.out]);
  console.log(JSON.stringify({ status: 'ok', path: o.out, engine: 'api', provider: config.provider, model: config.model, width, height,
    usd: config.price, month_usd: Math.round((spent.usd + config.price) * 10000) / 10000, bytes: (await stat(o.out)).size,
    elapsed_seconds: Math.round((Date.now() - start) / 1000) }));
}

if (isInvokedDirectly(import.meta.url)) {
  main().catch(e => {
    console.log(JSON.stringify({ status: 'error', engine: 'api', reason: e.message }));
    process.exitCode = 1;
  });
}
