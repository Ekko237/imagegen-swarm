import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);

export function log(event) {
  appendFileSync(process.env.SWARM_FAKE_CALLS, JSON.stringify({ event, args }) + "\n");
}

export function generate(engine) {
  log(engine + ":generate");
  const scenario = process.env.SWARM_FAKE_SCENARIO;
  if (scenario === "hang") {
    setInterval(() => {}, 1000);
    return;
  }
  if (scenario === "error" || scenario === "unavailable") {
    const error_kind = scenario === "error" ? "fixture_error" : "image_gen_unavailable";
    console.log(JSON.stringify({ status: "error", error_kind, reason: "fixture requested " + error_kind }));
    process.exitCode = 1;
    return;
  }
  const size = scenario === "tiny" ? "1" : "512";
  const output = args[args.indexOf("--out") + 1];
  const result = spawnSync(process.env.PYTHON || "python3", [
    "-c", "from PIL import Image; import sys; n = int(sys.argv[2]); Image.new('RGB', (n, n), 'red').save(sys.argv[1])",
    output, size,
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("fixture image generation failed: " + result.stderr);
  console.log(JSON.stringify({ status: "ok", path: output }));
}
