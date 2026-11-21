import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { run } from "../skills/imagegen-swarm/scripts/readiness.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const scripts = fileURLToPath(new URL("./fixtures/smoke-fake/", import.meta.url));
const smoke = fileURLToPath(new URL("../skills/imagegen-swarm/scripts/smoke.mjs", import.meta.url));
const check = fileURLToPath(new URL("../skills/imagegen-swarm/scripts/check.mjs", import.meta.url));

async function runSmoke(t, engines, scenario, args = [], entry = smoke) {
  const home = await mkdtemp(path.join(tmpdir(), "swarm-smoke-test-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, ".codex"));
  await writeFile(path.join(home, ".codex", "auth.json"), "{}");
  const calls = path.join(home, "calls.jsonl");
  await writeFile(calls, "");
  const out = path.join(home, "output");
  const pathCodex = scenario === "path-codex";
  if (pathCodex) {
    const executable = path.join(home, "codex");
    await writeFile(executable, "#!/bin/sh\necho codex-fixture\n");
    await chmod(executable, 0o700);
  }
  const command = [
    entry, ...(entry === check ? ["--live"] : []), "--engines", engines, "--out", out, "--json", ...args,
  ];
  const options = {
    encoding: "utf8", timeout: 20000,
    env: {
      PATH: pathCodex ? home + path.delimiter + process.env.PATH : process.env.PATH, PYTHON: process.env.PYTHON || "python3",
      CODEX_HOME: path.join(home, ".codex"), ...(!pathCodex && { CODEX_BIN: process.execPath }),
      AGY_BIN: path.join(scripts, "agy"),
      IMAGE_GEN_SMOKE_SCRIPTS_DIR: scripts, SWARM_FAKE_SCENARIO: scenario, SWARM_FAKE_CALLS: calls,
      IMAGE_GEN_ENGINE_OFF: path.join(home, "engine-off"),
    },
  };
  const result = spawnSync(process.execPath, command, options);
  assert.ifError(result.error);
  const rows = result.stdout.trim().split("\n").map(line => JSON.parse(line));
  const events = (await readFile(calls, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const [run] = await readdir(out);
  return { code: result.status, rows, events, progress: result.stderr, output: path.join(out, run) };
}

test("1×1 PNG fails and leaves a log but removes images", async t => {
  const { code, rows, output } = await runSmoke(t, "codex", "tiny");
  assert.equal(code, 1);
  assert.equal(rows[0].result, "FAIL");
  assert.match(rows[0].reason, /256×256/);
  assert.deepEqual((await readdir(output)).sort(), ["SMOKE_TABLE.txt", "codex.log", "smoke-last.json"]);
});

test("512×512 PNG passes with check --live; --keep preserves the PNG", async t => {
  const { code, rows, output } = await runSmoke(t, "codex", "large", ["--keep"], check);
  assert.equal(code, 0);
  assert.equal(rows[0].result, "PASS");
  assert.deepEqual(await readdir(path.join(output, "images")), ["codex.png"]);
  const cache = JSON.parse(await readFile(path.join(output, "smoke-last.json"), "utf8"));
  const { image, exit_code, ...expected } = rows[0];
  assert.equal(exit_code, 0);
  assert.match(image, /images[/\\]codex\.png$/);
  assert.deepEqual(cache.engines.codex, expected);
});

test("explicit engine error_kind fails and is reported", async t => {
  const { code, rows } = await runSmoke(t, "codex", "error");
  assert.equal(code, 1);
  assert.equal(rows[0].result, "FAIL");
  assert.equal(rows[0].error_kind, "fixture_error");
});

test("Codex image_gen_unavailable skips", async t => {
  const { code, rows } = await runSmoke(t, "codex", "unavailable");
  assert.equal(code, 0);
  assert.equal(rows[0].result, "SKIP");
  assert.match(rows[0].reason, /lacks image_gen/);
});

for (const scenario of ["fast", "unlisted"]) {
  test("Lovart " + scenario + " skips without generating", async t => {
    const { code, rows, events } = await runSmoke(t, "lovart", scenario);
    assert.equal(code, 0);
    assert.equal(rows[0].result, "SKIP");
    assert.deepEqual(events.map(entry => entry.event), ["lovart:query-mode"]);
  });
}

test("Lovart unlimited plus whitelisted model generates with --require-free", async t => {
  const { code, rows, events } = await runSmoke(t, "lovart", "whitelisted");
  assert.equal(code, 0);
  assert.equal(rows[0].result, "PASS");
  assert.deepEqual(events.map(entry => entry.event), ["lovart:query-mode", "lovart:generate"]);
  assert.ok(events[1].args.includes("--require-free"));
});

test("default skips paid API and Jimeng without invoking either", async t => {
  const { code, rows, events } = await runSmoke(t, "api,jimeng", "large");
  assert.equal(code, 0);
  assert.deepEqual(rows.map(row => [row.engine, row.result]), [["api", "SKIP"], ["jimeng", "SKIP"]]);
  assert.deepEqual(events, []);
});

test("required Muse skip exits 1", async t => {
  const { code, rows, events } = await runSmoke(t, "muse", "large", ["--require", "muse"]);
  assert.equal(code, 1);
  assert.equal(rows[0].result, "SKIP");
  assert.deepEqual(events.map(entry => entry.event), ["muse:list-chats"]);
});

test("repeated pixel fingerprint fails the later engine", async t => {
  const { code, rows } = await runSmoke(t, "codex,lovart", "whitelisted");
  assert.equal(code, 1);
  assert.deepEqual(rows.map(row => row.result), ["PASS", "FAIL"]);
  assert.match(rows[1].reason, /matches an earlier output/);
});

test("smoke emits each result before starting the next engine and keeps the timeout table", async t => {
  const { code, rows, output, progress, events } = await runSmoke(t, "codex,api", "hang", ["--timeout", "1"]);
  assert.equal(code, 1);
  assert.deepEqual(rows.map(row => [row.result, row.error_kind]), [["FAIL", "timeout"], ["SKIP", undefined]]);
  assert.deepEqual(events.map(event => event.event), ["codex:generate"]);
  assert.match(progress, /START codex\ncodex +FAIL.*timeout[^\n]*\nSTART api\napi +SKIP/);
  const table = await readFile(path.join(output, "SMOKE_TABLE.txt"), "utf8");
  assert.match(table, /^ENGINE +RESULT/m);
  assert.match(table, /^codex +FAIL.*timeout/m);
  assert.match(table, /^api +SKIP/m);
});

test("SIGINT records the active engine and prints the final table", { skip: process.platform === "win32" }, async t => {
  const home = await mkdtemp(path.join(tmpdir(), "swarm-smoke-signal-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(path.join(home, "auth.json"), "{}");
  const child = spawn(process.execPath, [smoke, "--engines", "codex,api", "--out", home], {
    env: {
      ...process.env, CODEX_HOME: home, CODEX_BIN: process.execPath,
      IMAGE_GEN_SMOKE_SCRIPTS_DIR: scripts, IMAGE_GEN_ENGINE_OFF: path.join(home, "engine-off"),
      SWARM_FAKE_SCENARIO: "hang", SWARM_FAKE_CALLS: path.join(home, "calls.jsonl"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGKILL"));
  const closed = once(child, "close");
  let printed = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", data => {
    printed += data;
    if (data.includes("START codex")) child.kill("SIGINT");
  });
  assert.deepEqual(await closed, [130, null]);
  assert.match(printed, /ENGINE +RESULT[^\n]*\ncodex +FAIL.*interrupted[^\n]*\napi +SKIP/);
  const directory = (await readdir(home)).find(name => name.startsWith("imagegen-smoke-"));
  const table = await readFile(path.join(home, directory, "SMOKE_TABLE.txt"), "utf8");
  assert.ok(printed.endsWith(table));
});

test("Gemini quota is a distinct smoke skip and is redacted", async t => {
  const { rows, code, output } = await runSmoke(t, "gemini", "quota", ["--require", "gemini"]);
  assert.equal(code, 1);
  assert.equal(rows[0].result, "SKIP");
  assert.equal(rows[0].error_kind, "quota_exhausted");
  assert.match(rows[0].reason, /额度/);
  assert.match(rows[0].reason, /\[redacted\]/);
  assert.doesNotMatch(rows[0].reason, /[\r\n]/);
  const table = await readFile(path.join(output, "SMOKE_TABLE.txt"), "utf8");
  assert.match(table, /agy version: 1\.5\.13/);
  assert.match(table, /Remaining Gemini image quota: unavailable/);
});

test("smoke subprocess timeout kills descendants", { skip: process.platform === "win32" }, async t => {
  const home = await mkdtemp(path.join(tmpdir(), "swarm-process-tree-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const marker = path.join(home, "grandchild-survived");
  const grandchild = "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'alive'), 1400);";
  const parent = "require('node:child_process').spawn(process.execPath, ['-e', process.argv[1], process.argv[2]], {stdio: 'inherit'});";
  const result = await run(process.execPath, ["-e", parent, grandchild, marker], { timeout: 1000 });
  assert.ok(result.timedOut);
  await delay(900);
  assert.deepEqual(await readdir(home), []);
});

test("Codex found on PATH is invoked without an invalid explicit file argument", { skip: process.platform === "win32" }, async t => {
  const { code, rows, events } = await runSmoke(t, "codex", "path-codex");
  assert.equal(code, 0);
  assert.equal(rows[0].result, "PASS");
  assert.equal(events.length, 1);
  assert.equal(events[0].args.includes("--codex"), false);
});
