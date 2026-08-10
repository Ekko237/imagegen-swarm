#!/usr/bin/env node
// check.mjs — readiness doctor for the image-gen skill.
// Run after unzipping: `node scripts/check.mjs`
// Reports Node, codex (+login), and dreamina/jimeng (+login) status per engine.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const ok = (m) => `  ✅ ${m}`;
const no = (m) => `  ❌ ${m}`;
const line = (m) => process.stdout.write(m + "\n");

function probe(bin, args) {
  return new Promise((res) => {
    let out = "";
    const c = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" && !path.isAbsolute(bin) });
    c.on("error", () => res({ code: -1, out }));
    c.stdout.on("data", (d) => (out += d.toString()));
    c.stderr.on("data", (d) => (out += d.toString()));
    c.on("close", (code) => res({ code, out }));
  });
}

async function resolveCodex() {
  if (process.env.CODEX_BIN && existsSync(process.env.CODEX_BIN)) return process.env.CODEX_BIN;
  const onPath = await new Promise((r) => {
    const c = spawn("codex", ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
    c.on("error", () => r(false));
    c.on("close", (code) => r(code === 0));
  });
  if (onPath) return "codex";
  const binDir = path.join(homedir(), "AppData", "Local", "OpenAI", "Codex", "bin");
  if (existsSync(binDir)) {
    let best = null, m = 0;
    for (const d of await readdir(binDir).catch(() => [])) {
      const exe = path.join(binDir, d, "codex.exe");
      try { const s = await stat(exe); if (s.mtimeMs > m) { m = s.mtimeMs; best = exe; } } catch {}
    }
    if (best) return best;
  }
  return null;
}

function resolveDreamina() {
  const exe = process.platform === "win32" ? "dreamina.exe" : "dreamina";
  const cands = [];
  if (process.env.DREAMINA_INSTALL_DIR) cands.push(path.join(process.env.DREAMINA_INSTALL_DIR, exe));
  cands.push(path.join(homedir(), "bin", exe), path.join(homedir(), ".local", "bin", exe));
  for (const c of cands) if (existsSync(c)) return c;
  return "dreamina"; // may still resolve via PATH
}

async function main() {
  line("image-gen readiness check\n==========================");

  // Node
  line(`Node: ${process.version}  (${process.platform}/${process.arch})`);
  line(ok("node is running this script"));

  // Codex engine (images)
  line("\n[codex engine — images]");
  const codex = await resolveCodex();
  let codexReady = false;
  if (codex) {
    const v = await probe(codex, ["--version"]);
    line(ok(`codex found: ${codex}${v.code === 0 ? `  (${v.out.trim().split("\n")[0]})` : ""}`));
    const auth = path.join(process.env.CODEX_HOME || path.join(homedir(), ".codex"), "auth.json");
    if (existsSync(auth)) { line(ok("codex login state present (auth.json)")); codexReady = true; }
    else line(no("not logged in — run: codex login"));
  } else {
    line(no("codex not found — install @openai/codex (npm i -g @openai/codex) or the Codex app, then: codex login"));
  }

  // Jimeng engine (images + video)
  line("\n[jimeng engine — Dreamina images + video]");
  const dreamina = resolveDreamina();
  const dExists = dreamina !== "dreamina" || (await probe("dreamina", ["version"])).code === 0;
  let jimengReady = false;
  if (dExists) {
    const cred = await probe(dreamina, ["user_credit"]);
    let credits = null;
    try { credits = JSON.parse(cred.out.slice(cred.out.indexOf("{"), cred.out.lastIndexOf("}") + 1)).total_credit; } catch {}
    line(ok(`dreamina found: ${dreamina}`));
    if (credits != null) { line(ok(`logged in — ${credits} credits available`)); jimengReady = true; }
    else line(no(`not logged in (or user_credit failed) — run: dreamina login   [output: ${cred.out.trim().slice(0, 120)}]`));
  } else {
    line(no("dreamina not found — install: curl -fsSL https://jimeng.jianying.com/cli | bash  (run in Git Bash on Windows), then: dreamina login"));
  }

  // Summary
  line("\n==========================");
  line(`codex  (images):        ${codexReady ? "READY ✅" : "NOT READY ❌"}`);
  line(`jimeng (images+video):  ${jimengReady ? "READY ✅" : "NOT READY ❌"}`);
  if (!codexReady && !jimengReady) { line("\nNo engine ready yet — see SETUP.md."); process.exit(1); }
  line("\nAt least one engine is ready. See SETUP.md for anything marked ❌.");
}

main().catch((e) => { line(no(String(e?.stack || e))); process.exit(1); });
