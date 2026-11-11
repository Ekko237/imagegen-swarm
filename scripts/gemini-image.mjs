import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, copyFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'];
const BRAIN = path.join(homedir(), '.gemini', 'antigravity-cli', 'brain');

function parse(argv) {
  const o = { aspect: '1:1', model: 'gemini-3.8-flash-low', timeout: 600000, refs: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--json') continue;
    if (flag === '--help' || flag === '-h') {
      console.log(`gemini-image.mjs --prompt <text> --out <png> [--ref <image>]... [--aspect ${RATIOS.join('|')}] [--model <agy model>] [--agy <path>] [--timeout ms] [--json]`);
      process.exit(0);
    }
    const keys = { '--prompt': 'prompt', '--prompt-file': 'promptFile', '--out': 'out', '--ref': 'ref', '--aspect': 'aspect', '--model': 'model', '--agy': 'agy', '--timeout': 'timeout' };
    if (!keys[flag] || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`invalid argument: ${flag}`);
    const value = argv[++i];
    if (keys[flag] === 'ref') { o.refs.push(path.resolve(value)); continue; }
    if (['prompt', 'promptFile', 'out', 'agy'].includes(keys[flag]) && o[keys[flag]] !== undefined) throw new Error(`duplicate argument: ${flag}`);
    o[keys[flag]] = value;
  }
  if (!o.out || Boolean(o.prompt) === Boolean(o.promptFile)) throw new Error('require --out and exactly one of --prompt / --prompt-file');
  if (!RATIOS.includes(o.aspect)) throw new Error(`unsupported --aspect (generate_image accepts ${RATIOS.join(', ')})`);
  if (o.refs.length > 3) throw new Error('generate_image accepts at most 3 --ref images');
  o.timeout = Number(o.timeout);
  if (!Number.isFinite(o.timeout) || o.timeout <= 0) throw new Error('--timeout must be positive milliseconds');
  o.out = path.resolve(o.out);
  if (path.extname(o.out).toLowerCase() !== '.png') throw new Error('--out extension must be .png');
  o.agy = o.agy ?? process.env.AGY_BIN ?? path.join(homedir(), '.local', 'bin', 'agy');
  if (!existsSync(o.agy)) throw new Error(`agy not found: ${o.agy} (install the Antigravity CLI or pass --agy)`);
  return o;
}

function run(bin, args, cwd, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    let killTimer;
    const timer = setTimeout(() => {
      timedOut = true; child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
    }, timeout);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(killTimer);
      if (timedOut) reject(new Error(`${bin} timeout after ${timeout}ms`));
      else if (code !== 0) reject(new Error(`${bin} exited ${code}: ${stderr || stdout}`));
      else resolve(stdout);
    });
  });
}

// 图片转换、尺寸、解码指纹都交给跨平台的 imgtool.py（Pillow）
const PY = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const IMGTOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), 'imgtool.py');

async function transcript(conversation) {
  const file = path.join(BRAIN, conversation, '.system_generated', 'logs', 'transcript.jsonl');
  return (await readFile(file, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
}

// generate_image 的参数在会话记录里是 JSON 编码过的字符串，逐个解开
const toolArgs = args => Object.fromEntries(Object.entries(args).map(([k, v]) => [k, JSON.parse(v)]));

async function main() {
  const start = Date.now(), o = parse(process.argv.slice(2));
  const prompt = (o.promptFile ? await readFile(o.promptFile, 'utf8') : o.prompt).trim();
  if (!prompt) throw new Error('empty prompt');
  await mkdir(path.dirname(o.out), { recursive: true });
  const work = await mkdtemp(path.join(path.dirname(o.out), `.gemini-image-${Date.now()}-`));
  try {
    // 解码后再散列，防止把参考图换个格式冒充新图
    const img = async (...args) => JSON.parse(await run(PY, [IMGTOOL, ...args], work));
    const fingerprint = async file => (await img('fp', file)).fp[0];
    const refs = [], refHashes = new Set();
    for (const [i, ref] of o.refs.entries()) {
      const copy = path.join(work, `ref-${i + 1}${path.extname(ref)}`);
      await copyFile(ref, copy);
      refs.push(copy);
      refHashes.add(await fingerprint(copy));
    }
    // agy 主代理没有 generate_image，出图交给内置的 image-generator 子代理；要求它原样转交提示词、只出一次
    const instruction = 'Delegate to your image-generator subagent. Do not use the imagegen-swarm skill or any other image engine. Tell the subagent: call generate_image exactly once, ' +
      `with AspectRatio ${JSON.stringify(o.aspect)}, ImageName "result"` +
      (refs.length ? `, ImagePaths ${JSON.stringify(refs)}` : '') +
      ', and Prompt set to the exact text between the markers below, copied character for character with no rewriting, no additions and no retries. ' +
      'If the tool fails, report the error and stop; never copy, convert or reuse any existing image.\n' +
      `<<<PROMPT\n${prompt}\nPROMPT>>>\n` +
      'Do not use any other tool yourself. When it finishes, reply with only the absolute path of the image.';
    const reply = await run(o.agy, ['-p', instruction, '--model', o.model, '--sandbox', '--disable-slash-commands', '--output-format', 'json',
      '--print-timeout', `${Math.ceil(o.timeout / 1000)}s`, '--log-file', path.join(work, 'agy.log')], work, o.timeout + 30000);
    const result = JSON.parse(reply);
    if (result.status !== 'SUCCESS') throw new Error(`agy status ${result.status}: ${reply.slice(-3000)}`);
    const parent = result.conversation_id, brain = path.join(BRAIN, parent);
    // 主会话记录里登记了它开的子代理；在主会话和子代理的记录里找 generate_image 调用和它保存的图
    const steps = await transcript(parent);
    const children = [...new Set(steps.flatMap(s => [...String(s.content ?? '').matchAll(/"conversationId":\s*"([0-9a-f-]{36})"/g)].map(m => m[1])))];
    const generated = [];
    for (const conversation of [parent, ...children]) {
      let call = null;
      for (const step of await transcript(conversation)) {
        const used = (step.tool_calls ?? []).find(t => t.name === 'generate_image');
        if (used) call = toolArgs(used.args);
        for (const media of step.media ?? []) {
          if (call && media.mime_type?.startsWith('image/') && /Generated image is saved at/.test(step.content ?? '')) {
            generated.push({ file: decodeURIComponent(new URL(media.uri).pathname), call });
          }
        }
      }
    }
    // 子代理出图失败（额度用完会报 429 RESOURCE_EXHAUSTED）时原因在主代理最后的回复里，放在报错最前面
    if (!generated.length) throw new Error(`generate_image produced no image: ${result.response?.slice(-1500)} (agy conversation ${parent})`);
    const picked = generated.find(g => result.response?.includes(g.file)) ?? generated.at(-1);
    const source = picked.file;
    if (path.dirname(source) !== brain) throw new Error(`generated image outside this conversation's artifacts: ${source}`);
    if ((await stat(source)).mtimeMs < start) throw new Error(`stale output: ${source} predates this run`);
    if (refHashes.has(await fingerprint(source))) throw new Error('stale output: matches a reference image');
    const { width, height } = await img('png', source, o.out);
    const data = await readFile(o.out);
    if (!data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('invalid output PNG signature');
    console.log(JSON.stringify({
      status: 'ok', path: o.out, engine: 'gemini', source_path: source, width, height, aspect: picked.call.AspectRatio,
      tool_prompt: picked.call.Prompt, prompt_verbatim: picked.call.Prompt.trim() === prompt, attempts: generated.length,
      conversation_id: parent, bytes: data.length, elapsed_seconds: Math.round((Date.now() - start) / 1000),
    }));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch(e => {
  console.log(JSON.stringify({ status: 'error', engine: 'gemini', reason: e.message }));
  process.exitCode = 1;
});
