#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// 图片转换交给跨平台的 imgtool.py（Pillow）
const PY = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const IMGTOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), "imgtool.py");

let JSON_MODE = false;

function printHelp() {
  process.stdout.write(`lovart.mjs — Lovart image generation

  node scripts/lovart.mjs --out <file.png> --prompt "<text>" [flags]

  --out <file>        输出 PNG 路径（必填）
  --prompt <text>     提示词（必填，或用 --prompt-file）
  --prompt-file <p>   从文件读提示词
  --ref <file>        参考图，可重复。会先 upload 到 Lovart CDN 再作为 attachments
  --aspect <r>        比例，如 2:3 / 16:9。⚠️ Lovart 没有比例参数，本 flag 只是
                      把要求写进提示词，是软约束——出图后请自行校验
  --model <tool>      锁定模型，默认 generate_image_nano_banana_pro
                      可选 generate_image_seedream_v4_5 / generate_image_gpt_image_2 等
  --mode <m>          fast(默认) | thinking
  --lv <path>         lv 包装脚本位置（默认 $LOVART_LV 或 ~/tools/lovart-skill/lv）
  --timeout <sec>     单次 chat 超时，默认 300
  --json              输出单行 JSON
`);
}

function fail(msg, kind = "error") {
  if (JSON_MODE) process.stdout.write(JSON.stringify({ status: "error", error: msg, error_kind: kind }) + "\n");
  else process.stderr.write(`ERROR ${msg}\n`);
  process.exit(kind === "invalid_args" ? 2 : 1);
}

function run(cmd, args, timeoutSec) {
  return new Promise((res) => {
    let out = "", err = "", killed = false;
    const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const t = timeoutSec ? setTimeout(() => { killed = true; c.kill("SIGKILL"); }, timeoutSec * 1000) : null;
    c.on("error", (e) => { if (t) clearTimeout(t); res({ code: -1, out, err: err + e }); });
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => { if (t) clearTimeout(t); res({ code, out, err, killed }); });
  });
}

// lv 会把人类可读的行和 JSON 混在一起输出，取最后一个完整 JSON 对象
function lastJson(t) {
  const end = t.lastIndexOf("}"); if (end < 0) return null;
  let d = 0, start = -1;
  for (let i = end; i >= 0; i--) { const c = t[i]; if (c === "}") d++; else if (c === "{") { if (--d === 0) { start = i; break; } } }
  if (start < 0) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

// --lv 是显式意图：给了就必须存在，不静默回退到默认位置（否则调试时会跑错二进制）
function resolveLv(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  const cands = [process.env.LOVART_LV, path.join(homedir(), "tools", "lovart-skill", "lv")].filter(Boolean);
  for (const p of cands) if (existsSync(p)) return p;
  return null;
}

async function main() {
  const o = { out: null, prompt: null, refs: [], aspect: null, model: "generate_image_nano_banana_pro",
              mode: null, lv: null, timeout: 300, json: false };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    switch (a[i]) {
      case "-h": case "--help": printHelp(); process.exit(0);
      case "--out": o.out = a[++i]; break;
      case "--prompt": o.prompt = a[++i]; break;
      case "--prompt-file": o.prompt = await readFile(a[++i], "utf-8"); break;
      case "--ref": o.refs.push(a[++i]); break;
      case "--aspect": o.aspect = a[++i]; break;
      case "--model": o.model = a[++i]; break;
      case "--mode": o.mode = a[++i]; break;
      case "--lv": o.lv = a[++i]; break;
      case "--timeout": o.timeout = Number(a[++i]); break;
      case "--json": o.json = true; JSON_MODE = true; break;
      default: fail(`unknown flag: ${a[i]}`, "invalid_args");
    }
  }
  if (!o.out) fail("--out is required", "invalid_args");
  o.out = path.resolve(o.out);
  if (!o.prompt || !o.prompt.trim()) fail("--prompt (or --prompt-file) is required", "invalid_args");

  const lv = resolveLv(o.lv);
  if (!lv) fail("找不到 lv 包装脚本。装 https://github.com/lovartai/lovart-skill 到 ~/tools/lovart-skill/ " +
                "并建 ~/.lovart/env（AK/SK 从 Lovart 头像菜单「Lovart 龙虾」取）", "not_configured");

  const start = Date.now();

  // 1) 参考图先传 CDN（upload 按内容嗅探，扩展名不符也吃）
  const attachments = [];
  for (const ref of o.refs) {
    if (!existsSync(ref)) fail(`ref not found: ${ref}`, "invalid_args");
    const r = await run(lv, ["upload", "--file", ref], 120);
    const j = lastJson(r.out);
    if (r.code !== 0 || !j || !j.url)
      fail(`upload failed for ${path.basename(ref)}: ${(j && j.message) || r.err.trim().slice(0, 200)}`);
    attachments.push(j.url);
  }

  // 2) 比例只能写进提示词——Lovart CLI 没有 aspect/ratio 参数
  let prompt = o.prompt.trim();
  if (o.aspect) {
    const [w, h] = o.aspect.split(":").map(Number);
    const orient = w && h ? (h > w ? "vertical" : w > h ? "horizontal" : "square") : "";
    prompt += ` ${orient} ${o.aspect}.`.replace(/\s+/g, " ");
  }

  // 3) 每次都开新 thread（不传 --thread-id）：同 thread 并发提交会 409，不同 thread 才能并行
  const tmp = path.join(path.dirname(path.resolve(o.out)), `.lovart-${process.pid}-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  const args = ["chat", "--prompt", prompt, "--json", "--download", "--output-dir", tmp];
  if (attachments.length) args.push("--attachments", ...attachments);
  if (o.model) args.push("--prefer-models", JSON.stringify({ IMAGE: [o.model] }));
  if (o.mode) args.push("--mode", o.mode);

  const r = await run(lv, args, o.timeout);
  if (r.killed) { await rm(tmp, { recursive: true, force: true }).catch(() => {});
                  fail(`timed out after ${o.timeout}s`, "timeout"); }
  const j = lastJson(r.out);
  if (r.code !== 0 || !j) { await rm(tmp, { recursive: true, force: true }).catch(() => {});
                            fail(r.err.trim().slice(0, 300) || "no JSON from lv"); }

  // agent 可能只回文字：内容审核拒绝 / 超时 / 没调生成工具。CLI 会标出来，别当成功。
  if (j.generation_succeeded !== true) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    fail(`no image produced (${String(j.generation_note || j.final_status || "agent returned text only").slice(0, 200)})`, "no_image");
  }
  const got = (j.downloaded || []).find((d) => d.type === "image" && d.local_path);
  if (!got) { await rm(tmp, { recursive: true, force: true }).catch(() => {});
              fail("succeeded but no image artifact was downloaded", "no_image"); }

  await mkdir(path.dirname(path.resolve(o.out)), { recursive: true });
  // 模型可能交 JPG / WebP：统一转成真正的 PNG
  const conv = await run(PY, [IMGTOOL, "png", path.resolve(got.local_path), o.out], 60);
  await rm(tmp, { recursive: true, force: true });
  if (conv.code !== 0) fail(`could not convert the Lovart artifact to PNG: ${conv.err.trim().slice(0, 200)}`);

  const s = await stat(o.out);
  const result = { status: "ok", provider: "lovart", path: o.out, bytes: s.size,
                   model: o.model, aspect: o.aspect, thread_id: j.thread_id,
                   elapsed_seconds: Math.round((Date.now() - start) / 1000) };
  if (o.json) process.stdout.write(JSON.stringify(result) + "\n");
  else process.stdout.write(`OK lovart ${o.out}\n`);
  process.exit(0);
}

main().catch((e) => fail(String(e && e.message || e)));
