#!/usr/bin/env node
// codex-image.mjs — generate an image via Codex CLI's built-in image_gen tool.
// Self-contained (plain Node ESM, no bun / no TypeScript). Uses the user's
// Codex/ChatGPT login — no OPENAI_API_KEY is read or sent.
//
// Ported from the baoyu-image-gen codex-imagegen wrapper (spawn + instruction),
// simplified to a single Node file so it runs in a bun-less environment.
//
// SANDBOX: defaults to Codex's standard "workspace-write" mode, with the output
// directory made the writable workspace (-C). The agent can still read its own
// image_gen output from $CODEX_HOME and write the final PNG.
// NOTE: if an attempt fails while using that default, the next attempt escalates
// to "danger-full-access" (which drops isolation) so unattended runs do not
// silently produce nothing. Pass --no-escalate to disable this, or pass
// --sandbox <mode> explicitly — an explicit mode is never widened.
//
// Usage:
//   node codex-image.mjs --out <output.png> (--prompt <text> | --prompt-file <path>) [options]
// Options:
//   --aspect <ratio>   1:1 (default) | 16:9 | 9:16 | 4:3 | 2.35:1
//   --ref <file>       reference image (repeatable)
//   --sandbox <mode>   read-only | workspace-write (default) | danger-full-access
//   --no-escalate      never auto-widen the sandbox after a failed attempt
//   --timeout <ms>     per-attempt codex exec timeout (default 300000)
//   --retries <n>      retry attempts on failure (default 2)
//   --codex <path>     explicit path to codex(.exe); else auto-resolve
//   --json             emit a single JSON result line (default: human text)
// Exit: 0 on success, 1 on failure.

import { spawn } from "node:child_process";
import { readFile, writeFile, open, stat, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const SHELL_METACHAR = /[;|&`$<>\n\r()'"]/;

function parseArgs(argv) {
  const o = {
    prompt: "", promptFile: null, out: "", aspect: "1:1", refs: [],
    sandbox: "workspace-write", timeoutMs: 300_000, retries: 2, codex: null, json: false,
    noEscalate: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--prompt": o.prompt = next(); break;
      case "--prompt-file": o.promptFile = next(); break;
      case "--out": case "--image": o.out = next(); break;
      case "--aspect": case "--ar": o.aspect = next(); break;
      case "--ref": o.refs.push(next()); break;
      case "--sandbox": o.sandbox = next(); o.noEscalate = true; break; // explicit mode is never widened
      case "--no-escalate": o.noEscalate = true; break;
      case "--timeout": o.timeoutMs = Number(next()); break;
      case "--retries": o.retries = Number(next()); break;
      case "--codex": o.codex = next(); break;
      case "--json": o.json = true; break;
      case "-h": case "--help": printHelp(); process.exit(0);
      default: fail("invalid_args", `Unknown argument: ${a}`);
    }
  }
  if (!o.out) fail("invalid_args", "--out is required");
  if (o.prompt && o.promptFile) fail("invalid_args", "--prompt and --prompt-file are mutually exclusive");
  if (!o.prompt && !o.promptFile) fail("invalid_args", "--prompt or --prompt-file required");
  const abs = (p) => (path.isAbsolute(p) ? p : path.resolve(process.cwd(), p));
  o.out = abs(o.out);
  if (o.promptFile) o.promptFile = abs(o.promptFile);
  o.refs = o.refs.map(abs);
  // out/ref paths get interpolated into the agent instruction; reject metachars.
  if (SHELL_METACHAR.test(o.out)) fail("invalid_args", `--out path has unsafe characters: ${o.out}`);
  for (const r of o.refs) if (SHELL_METACHAR.test(r)) fail("invalid_args", `--ref path has unsafe characters: ${r}`);
  return o;
}

function printHelp() {
  process.stdout.write(`codex-image.mjs — image via Codex CLI image_gen\n\n` +
    `node codex-image.mjs --out <png> (--prompt <t> | --prompt-file <p>) [--aspect 1:1] [--ref f]... [--sandbox workspace-write] [--no-escalate] [--timeout ms] [--retries n] [--codex path] [--json]\n`);
}

let JSON_MODE = false;
function fail(kind, msg) {
  if (JSON_MODE) process.stdout.write(JSON.stringify({ status: "error", error: msg, error_kind: kind }) + "\n");
  else process.stderr.write(`Error [${kind}]: ${msg}\n`);
  process.exit(kind === "invalid_args" ? 2 : 1);
}

// Resolve the codex executable: explicit flag / CODEX_BIN env > PATH > Codex desktop-app bin.
async function resolveCodex(explicit) {
  explicit = explicit || process.env.CODEX_BIN || null;
  if (explicit) {
    if (!existsSync(explicit)) fail("codex_not_installed", `codex path not found: ${explicit}`);
    return explicit;
  }
  const onPath = await new Promise((res) => {
    const c = spawn("codex", ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
    c.on("error", () => res(false));
    c.on("close", (code) => res(code === 0));
  });
  if (onPath) return "codex";
  const binDir = path.join(homedir(), "AppData", "Local", "OpenAI", "Codex", "bin");
  if (existsSync(binDir)) {
    let best = null, bestMtime = 0;
    for (const d of await readdir(binDir)) {
      const exe = path.join(binDir, d, "codex.exe");
      try { const s = await stat(exe); if (s.mtimeMs > bestMtime) { bestMtime = s.mtimeMs; best = exe; } } catch {}
    }
    if (best) return best;
  }
  fail("codex_not_installed", "codex CLI not found on PATH or under ~/AppData/Local/OpenAI/Codex/bin. Install @openai/codex or the Codex app, then `codex login`.");
}

function buildInstruction(prompt, o) {
  const refHint = o.refs.length > 0
    ? `\nREFERENCE IMAGES (attached above): ${o.refs.length} image(s) provided for style/composition guidance.\n`
    : "";
  return `You have an internal tool called image_gen for image generation. You MUST call it before doing anything else.

TASK: Generate an image with the spec below, then save to disk.

PROMPT:
${prompt}

ASPECT RATIO: ${o.aspect}
OUTPUT PATH: ${o.out}
${refHint}
STEPS:
1. Call image_gen with the prompt and aspect ratio above${o.refs.length > 0 ? " (using the attached reference images for guidance)" : ""}.
2. Move or copy ONLY the image produced by that image_gen call from Codex default location ($CODEX_HOME/generated_images/...) to: ${o.out}
3. Verify with: ls -la ${o.out}
4. Reply with ONLY this JSON line (no markdown fences, no other text):
   {"status":"ok","path":"${o.out}","bytes":<file_size_in_bytes>}

HARD CONSTRAINTS:
- Do NOT search for, find, inspect, reuse, or copy any pre-existing files from $CODEX_HOME/generated_images/ or any other directory.
- Do NOT run ls/find/rg/grep/glob over $CODEX_HOME/generated_images/ before image_gen has been called.
- You MUST call image_gen first. Only after image_gen completes may you copy the newly created file from this turn.
- Do NOT use curl, wget, Python, or any external API.
- Do NOT use bash to fabricate an image; only image_gen produces real pixels.
- Use ONLY the image_gen internal tool.`;
}

async function isPng(file) {
  try {
    const fh = await open(file, "r");
    const buf = Buffer.alloc(8);
    await fh.read(buf, 0, 8, 0);
    await fh.close();
    return buf.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  } catch { return false; }
}

function runCodexExec(codex, instruction, o, cwd) {
  return new Promise((resolve) => {
    const args = ["exec", "--json", "--sandbox", o.sandbox, "--skip-git-repo-check", "-C", cwd];
    for (const r of o.refs) args.push("--image", r);
    args.push("-");
    let stdout = "", stderr = "", timedOut = false;
    const child = spawn(codex, args, { stdio: ["pipe", "pipe", "pipe"], shell: false, cwd });
    child.on("error", (e) => resolve({ code: -1, stdout, stderr: stderr + String(e), timedOut }));
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.stdin.write(instruction);
    child.stdin.end();
    const t = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 2000); }, o.timeoutMs);
    child.on("close", (code) => { clearTimeout(t); resolve({ code, stdout, stderr, timedOut }); });
  });
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  JSON_MODE = o.json;
  const codex = await resolveCodex(o.codex);
  const prompt = o.promptFile ? await readFile(o.promptFile, "utf-8").catch(() => fail("prompt_file_missing", `Prompt file not found: ${o.promptFile}`)) : o.prompt;
  const outDir = path.dirname(o.out);
  await mkdir(outDir, { recursive: true });
  const instruction = buildInstruction(prompt, o);

  const logDir = path.join(tmpdir(), `codex-img-${Date.now()}`);
  await mkdir(logDir, { recursive: true }).catch(() => {});
  const start = Date.now();
  let lastErr = "unknown";
  for (let attempt = 1; attempt <= o.retries + 1; attempt++) {
    if (!o.json) process.stderr.write(`[codex] attempt ${attempt}/${o.retries + 1} (sandbox=${o.sandbox}) -> ${o.out}\n`);
    const run = await runCodexExec(codex, instruction, o, outDir);
    await writeFile(path.join(logDir, `attempt-${attempt}.log`), run.stdout + `\n--- stderr ---\n` + run.stderr).catch(() => {});
    if (run.timedOut) { lastErr = `timeout after ${o.timeoutMs}ms`; continue; }
    if (run.code === -1 || run.stderr.includes("not found: codex") || run.stderr.includes("command not found")) fail("codex_not_installed", `codex could not be launched: ${run.stderr.slice(0, 300)}`);
    if (existsSync(o.out) && await isPng(o.out)) {
      const s = await stat(o.out);
      const result = { status: "ok", provider: "codex", path: o.out, bytes: s.size, aspect: o.aspect, attempts: attempt, elapsed_seconds: Math.round((Date.now() - start) / 1000) };
      if (o.json) process.stdout.write(JSON.stringify(result) + "\n");
      else process.stdout.write(`OK  codex  ${o.out}  (${s.size} bytes, ${result.elapsed_seconds}s, attempt ${attempt})\n`);
      process.exit(0);
    }
    lastErr = run.code !== 0 ? `codex exec exited ${run.code}: ${run.stderr.slice(0, 200)}` : `no valid PNG at ${o.out} (agent may not have called image_gen, or sandbox blocked the write — try --sandbox with a broader mode)`;
    if (!o.json) process.stderr.write(`[codex] attempt ${attempt} failed: ${lastErr}\n`);
    // AUTO-ESCALATE SANDBOX: workspace-write can be blocked from writing the PNG in some
    // (especially unattended) environments, and retrying the SAME mode just burns attempts.
    // On failure, escalate to danger-full-access for the remaining attempts so an unattended
    // batch does not silently yield 0 images. Only escalates from the workspace-write default;
    // if the caller passed --sandbox explicitly, that choice is respected and never widened.
    // Pass --no-escalate to keep the default mode for every attempt.
    if (o.sandbox === "workspace-write" && !o.noEscalate) {
      o.sandbox = "danger-full-access";
      if (!o.json) process.stderr.write(`[codex] sandbox workspace-write failed -> escalating to danger-full-access for next attempt\n`);
    }
  }
  fail("generation_failed", lastErr);
}

main().catch((e) => fail("spawn_failed", String(e?.stack || e)));
