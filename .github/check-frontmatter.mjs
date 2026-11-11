import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = path.join(root, "skills", "imagegen-swarm");
const text = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");

if (!text.startsWith("---\n")) {
  console.error("SKILL.md must start with --- frontmatter");
  process.exit(1);
}

const end = text.indexOf("\n---\n", 4);
if (end === -1) {
  console.error("SKILL.md frontmatter is not closed");
  process.exit(1);
}

const frontmatter = text.slice(4, end);
const name = frontmatter.match(/^name:\s*(\S+)\s*$/m);
if (!name || !name[1]) {
  console.error("SKILL.md frontmatter needs a name");
  process.exit(1);
}

const desc = frontmatter.match(/^description:\s*(.*)\s*$/m);
if (!desc || !desc[1]) {
  console.error("SKILL.md frontmatter needs a description");
  process.exit(1);
}

let description = desc[1].trim();
if (description.startsWith('"') && description.endsWith('"')) {
  description = JSON.parse(description);
} else if (description.startsWith("'") && description.endsWith("'")) {
  description = description.slice(1, -1);
}

if (description.length > 1024) {
  console.error(`description is ${description.length} chars, max is 1024`);
  process.exit(1);
}

if (name[1] !== "imagegen-swarm") {
  console.error(`SKILL.md name is ${name[1]}, expected imagegen-swarm`);
  process.exit(1);
}

function skillFiles(dir, found = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === ".git" || ent.name === "node_modules") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) skillFiles(full, found);
    else if (ent.name === "SKILL.md") found.push(path.relative(root, full));
  }
  return found;
}

const found = skillFiles(root);
if (found.length !== 1 || found[0] !== path.join("skills", "imagegen-swarm", "SKILL.md")) {
  console.error(`expected exactly skills/imagegen-swarm/SKILL.md, found: ${found.join(", ") || "(none)"}`);
  process.exit(1);
}

const claudePlugin = JSON.parse(readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8"));
const codexPlugin = JSON.parse(readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf8"));
const codexMarketplace = JSON.parse(readFileSync(path.join(root, ".agents", "plugins", "marketplace.json"), "utf8"));
const codexSource = codexMarketplace.plugins?.[0]?.source;
if (codexSource !== "./") {
  console.error(`Codex marketplace plugin source must be ./ so the installed plugin is this repo, got ${JSON.stringify(codexSource)}`);
  process.exit(1);
}
if (claudePlugin.skills !== "./skills/imagegen-swarm") {
  console.error(`Claude plugin skills must be ./skills/imagegen-swarm, got ${JSON.stringify(claudePlugin.skills)}`);
  process.exit(1);
}
if (codexPlugin.skills !== "./skills/") {
  console.error(`Codex plugin skills must be ./skills/, got ${JSON.stringify(codexPlugin.skills)}`);
  process.exit(1);
}

for (const rel of [
  "scripts/batch.mjs",
  "scripts/check.mjs",
  "references/codex.md",
  "references/lovart.md",
  "references/lovart-lv.example.sh",
  "evals/run.mjs",
  "evals/evals.json",
  "SETUP.md",
]) {
  if (!existsSync(path.join(skillDir, rel))) {
    console.error(`skill is missing ${rel}`);
    process.exit(1);
  }
}

console.log(`frontmatter ok: name=${name[1]}, description=${description.length} chars`);
