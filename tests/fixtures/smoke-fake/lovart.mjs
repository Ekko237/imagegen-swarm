import { generate, log } from "./generate.mjs";

if (process.argv.includes("--query-mode")) {
  log("lovart:query-mode");
  const scenario = process.env.SWARM_FAKE_SCENARIO;
  const billing_mode = scenario === "fast" ? "fast" : "unlimited";
  const unlimited_models = scenario === "unlisted" ? [] : ["generate_image_nano_banana_pro"];
  console.log(JSON.stringify({ status: "ok", billing_mode, unlimited_models }));
} else {
  generate("lovart");
}
