import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 用法：node evals/run.mjs <输出目录> [--only id,id]
// 逐项跑 evals.json 的固定任务，核对机器能查的 checks；content 一栏留给评委看图打分
const here = path.dirname(fileURLToPath(import.meta.url));
const PY = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const SCRIPTS = { gemini: 'gemini-image.mjs', muse: 'muse-image.py', grok: 'grok-image.mjs', codex: 'codex-image.mjs', lovart: 'lovart.mjs' };
const MUSE_PY = path.join(here, '..', 'scripts', 'muse-image.py');

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

async function size(file) {
  const r = await exec(PY, [path.join(here, '..', 'scripts', 'imgtool.py'), 'size', file]);
  if (r.code !== 0) throw new Error(`imgtool size failed on ${file}: ${r.stderr}`);
  const { width, height } = JSON.parse(r.stdout);
  return [width, height];
}

async function main() {
  const [outDir, ...rest] = process.argv.slice(2);
  if (!outDir) throw new Error('usage: node evals/run.mjs <outdir> [--only id,id]');
  const only = rest[0] === '--only' ? new Set(rest[1].split(',')) : null;
  const spec = JSON.parse(await readFile(path.join(here, 'evals.json'), 'utf8'));
  const out = path.resolve(outDir);
  await mkdir(out, { recursive: true });
  const produced = {}, results = [];
  for (const task of spec.tasks) {
    if (only && !only.has(task.id)) continue;
    if (task.engine === 'batch') {
      // 抢活：清单交给 batch.mjs，查全部出完、比例都对（batch 自己核对）、至少几家引擎接到活
      const dir = path.join(out, task.id);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'jobs.json'), JSON.stringify(task.jobs));
      const started = Date.now();
      const r = await exec('node', [path.join(here, '..', 'scripts', 'batch.mjs'), '--jobs', path.join(dir, 'jobs.json'), '--out', path.join(dir, 'out')]);
      const summary = JSON.parse(r.stdout.trim().split('\n').at(-1));
      const used = Object.values(summary.by_engine ?? {}).filter(n => n > 0).length;
      const failed = [];
      if (summary.status !== task.checks.status) failed.push(`status ${summary.status}，失败 ${summary.failed} 张：${summary.reason ?? ''}`);
      if (used < task.checks.min_engines) failed.push(`只有 ${used} 家引擎接到活：${JSON.stringify(summary.by_engine)}`);
      results.push({ id: task.id, engine: 'batch', pass: !failed.length, failed, seconds: Math.round((Date.now() - started) / 1000),
        file: path.join(dir, 'out'), size: JSON.stringify(summary.by_engine), content: task.content });
      console.log(JSON.stringify(results.at(-1)));
      continue;
    }
    const file = path.join(out, `${task.id}.png`);
    const missing = task.args.map(a => a.match(/^\{(.+)\}$/)?.[1]).find(id => id && !produced[id]);
    if (missing) {
      results.push({ id: task.id, engine: task.engine, pass: false, failed: [`依赖的 ${missing} 没出图`], seconds: 0, file: null, size: null, content: task.content ?? null });
      console.log(JSON.stringify(results.at(-1)));
      continue;
    }
    const args = task.args.map(a => a.replace(/^\{(.+)\}$/, (_, id) => produced[id]));
    const started = Date.now();
    const script = path.join(here, '..', 'scripts', SCRIPTS[task.engine]);
    const r = await exec(script.endsWith('.py') ? PY : 'node', [script, ...args, '--out', file]);
    const report = JSON.parse(r.stdout.trim().split('\n').at(-1));
    const failed = [];
    const c = task.checks;
    // codex、lovart 的报错字段叫 error，其余引擎叫 reason
    const reason = report.reason ?? report.error ?? '';
    if (report.status !== c.status) failed.push(`status ${report.status}（要 ${c.status}）：${reason}`);
    if (c.reason_includes && !String(reason).includes(c.reason_includes)) failed.push(`reason 不含「${c.reason_includes}」`);
    if (report.status === 'ok') {
      produced[task.id] = file;
      const [w, h] = await size(file);
      report.width = w; report.height = h;
      if (c.ratio) {
        const [a, b] = c.ratio.split(':').map(Number);
        if (Math.abs(w / h - a / b) / (a / b) > 0.02) failed.push(`比例 ${w}×${h} 不是 ${c.ratio}`);
      }
      if (c.prompt_verbatim !== undefined && report.prompt_verbatim !== c.prompt_verbatim) failed.push(`prompt_verbatim=${report.prompt_verbatim}`);
    }
    if (c.muse_chat_removed) {
      const listed = JSON.parse((await exec(PY, [MUSE_PY, '--list-chats'])).stdout).chats;
      const left = listed.filter(chat => chat.title?.startsWith('image-gen：'));
      if (left.length) failed.push(`Muse 里还留着侧聊天：${left.map(chat => chat.title).join('、')}`);
    }
    results.push({ id: task.id, engine: task.engine, pass: !failed.length, failed, seconds: Math.round((Date.now() - started) / 1000),
      file: report.status === 'ok' ? file : null, size: report.width ? `${report.width}×${report.height}` : null, content: task.content ?? null });
    console.log(JSON.stringify(results.at(-1)));
  }
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ pass_rule: spec.pass_rule, content_rubric: spec.content_rubric, results }, null, 2));
  if (results.some(row => !row.pass)) process.exitCode = 1;
}

main().catch(e => { console.error(e.stack); process.exitCode = 1; });
