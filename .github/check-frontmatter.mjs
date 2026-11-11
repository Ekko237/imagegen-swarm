import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const text = readFileSync(path.join(root, "SKILL.md"), "utf8");

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

console.log(`frontmatter ok: name=${name[1]}, description=${description.length} chars`);
