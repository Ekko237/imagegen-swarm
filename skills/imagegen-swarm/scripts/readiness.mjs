import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadApiConfig, readKey, readLedger } from "./api-image.mjs";
import { LOVART_DEFAULT_MODEL } from "./lovart.mjs";
import { childEnv } from "./scoped-env.mjs";
import { STDIO_DISCARD, STDIO_PIPE } from "./stdio-modes.mjs";

export const ENGINES = ["codex", "grok", "gemini", "jimeng", "muse", "lovart", "api"];
export const PY = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SMOKE_CACHE = process.env.IMAGE_GEN_SMOKE_CACHE || path.join(homedir(), ".config", "imagegen-swarm", "smoke-last.json");

export function turnedOff(engine, env = process.env) {
  const configured = env.IMAGE_GEN_ENGINE_OFF;
  const dirs = configured ? [configured] : ["imagegen-swarm", "image-gen"].map(name =>
    path.join(homedir(), ".config", name, "engine-off"));
  return dirs.some(dir => existsSync(path.join(dir, engine)));
}

export function run(bin, args, { timeout = 25000, env = childEnv(), signal } = {}) {
  return new Promise(resolve => {
    let stdout = "", stderr = "", timedOut = false;
    if (signal?.aborted) return resolve({ code: null, stdout, stderr, timedOut });
    const grouped = process.platform !== "win32";
    const child = spawn(bin, args, {
      stdio: [STDIO_DISCARD, STDIO_PIPE, STDIO_PIPE], detached: grouped, env,
    });
    const kill = () => {
      try {
        if (grouped) process.kill(-child.pid, "SIGKILL");
        else if (child.pid) {
          const task = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
          task.once("error", () => child.kill("SIGKILL"));
          task.unref();
        }
      } catch {}
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeout);
    signal?.addEventListener("abort", kill, { once: true });
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    const finish = code => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      resolve({ code, stdout, stderr, timedOut });
    };
    child.once("error", () => finish(-1));
    child.once("close", finish);
  });
}

export function lastJson(stdout) {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

async function resolveCodex(signal, env) {
  if (process.env.CODEX_BIN) return existsSync(process.env.CODEX_BIN) ? process.env.CODEX_BIN : null;
  if ((await run("codex", ["--version"], { signal, env })).code === 0) return "codex";
  const app = "Applications/Codex.app/Contents/Resources/codex";
  for (const exe of [path.join("/", app), path.join(homedir(), app)]) {
    if (existsSync(exe)) return exe;
  }
  if (process.platform !== "win32") return null;
  const dir = path.join(homedir(), "AppData", "Local", "OpenAI", "Codex", "bin");
  let best = null, latest = 0;
  for (const entry of await readdir(dir).catch(() => [])) {
    const file = path.join(dir, entry, "codex.exe");
    const info = await stat(file).catch(() => null);
    if (info && info.mtimeMs > latest) { best = file; latest = info.mtimeMs; }
  }
  return best;
}

const good = (reason, extra) => ({ loggedIn: true, reason, ...extra });
const bad = reason => ({ loggedIn: false, reason });

export async function probeEngine(engine, { scripts = SCRIPT_DIR, env = childEnv(), signal } = {}) {
  const probe = (bin, args) => run(bin, args, { env, signal });
  if (turnedOff(engine, env)) return bad("Engine disabled by an engine-off marker.");
  switch (engine) {
    case "codex": {
      const codex = await resolveCodex(signal, env);
      const auth = path.join(process.env.CODEX_HOME || path.join(homedir(), ".codex"), "auth.json");
      if (!codex) return bad("Codex CLI missing. See SETUP.md.");
      return existsSync(auth) ? good("Codex auth.json exists.", { codex }) : bad("Codex auth.json missing. Run codex login.");
    }
    case "grok": {
      const { code, stdout, stderr } = await probe("grok", ["models"]);
      const out = stdout + "\n" + stderr;
      return code === 0 && !/not authenticated/i.test(out) && /grok-[\w.-]+/i.test(out)
        ? good("Grok lists models.") : bad("Grok login or model listing failed. Check the CLI and run grok login --device-code.");
    }
    case "gemini": {
      const agy = process.env.AGY_BIN || path.join(homedir(), ".local", "bin", "agy");
      const { code, stdout, stderr } = await probe(agy, ["models"]);
      return code === 0 && /gemini-[\w.-]+/i.test(stdout + "\n" + stderr)
        ? good("Antigravity lists Gemini models.", { agy }) : bad("Gemini model listing failed. Install the Antigravity CLI and sign in.");
    }
    case "jimeng": {
      const name = process.platform === "win32" ? "dreamina.exe" : "dreamina";
      const dreams = [process.env.DREAMINA_INSTALL_DIR, path.join(homedir(), "bin"), path.join(homedir(), ".local", "bin")];
      const bin = dreams.filter(Boolean).map(dir => path.join(dir, name)).find(existsSync) || "dreamina";
      const { code, stdout } = await probe(bin, ["user_credit"]);
      const credits = stdout.match(/"total_credit"\s*:\s*(\d+)/)?.[1];
      return code === 0 && credits !== undefined
        ? good("Dreamina credit balance: " + credits + ".") : bad("Dreamina credit check failed. See SETUP.md and run dreamina login.");
    }
    case "muse": {
      const { code, stdout } = await probe(PY, [path.join(scripts, "muse-image.py"), "--list-chats"]);
      const report = lastJson(stdout);
      return code === 0 && report?.status === "ok" && Array.isArray(report.chats)
        ? good("Muse lists side chats.", { remoteDir: report.remote_dir }) : bad("Muse side chats unavailable. Check Playwright and run muse-image.py --login.");
    }
    case "lovart": {
      const { code, stdout } = await probe(process.execPath, [path.join(scripts, "lovart.mjs"), "--query-mode", "--json"]);
      const report = lastJson(stdout);
      if (code !== 0 || report?.status !== "ok" || !["fast", "unlimited"].includes(report.billing_mode)) {
        return bad("Lovart billing query failed. Check the wrapper or API credentials in SETUP.md.");
      }
      const free = report.billing_mode === "unlimited" && Array.isArray(report.unlimited_models)
        && report.unlimited_models.includes(LOVART_DEFAULT_MODEL);
      return good("Lovart credentials accepted.", { billingMode: report.billing_mode, free });
    }
    case "api": {
      try {
        const api = loadApiConfig();
        if (!api) return bad("Paid API line is off. Configure api.json as described in SETUP.md.");
        const key = readKey(api);
        const openai = api.provider === "openai";
        const url = api.base + (openai ? "/v1/models" : "/v1beta/models");
        const headers = openai ? { Authorization: "Bearer " + key } : { "x-goog-api-key": key };
        const result = await fetch(url, { headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
        if (!result.ok) return bad("API model listing failed (HTTP " + result.status + "). Check api.json and the key.");
        const spent = readLedger();
        const budget = spent.month + ": " + spent.images + " images, about $" + spent.usd
          + " of $" + api.budgetMonth + " monthly, $" + api.budgetBatch + " per batch and $" + api.price + " per image.";
        return good("Paid API key accepted by the free model list.", { keyEnv: api.keyEnv, budget });
      } catch {
        return bad("API model listing unavailable. Check api.json, the key and connectivity.");
      }
    }
    default: throw new Error("Unknown engine: " + engine);
  }
}

export async function readSmokeCache(file = SMOKE_CACHE) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return parsed?.engines ?? {};
  } catch { return {}; }
}

export function readinessState(loggedIn, latest, now = Date.now()) {
  if (!loggedIn) return "NOT READY ❌";
  const age = now - Date.parse(latest?.time);
  if (latest?.result === "PASS" && age >= 0 && age < 86400000) {
    return "READY ✅ (实测 " + latest.time + ")";
  }
  return "LOGGED IN, UNTESTED";
}
