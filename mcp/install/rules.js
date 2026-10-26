// docs/house-rules.md -> mcp/rules.js
//
// The house rules are written once, as a page anyone can read in the repo,
// and the app shows the same words (Speakers → House rules). A Worker cannot
// read the docs folder, so this copies the page into a module the Worker
// bundles. The test compares the two, so an edit to the page that was not
// copied fails the suite; `npm run rules` is what closes the gap. --check
// exits 1 without writing, for the deploy.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const RULES_DOC = join(HERE, "..", "..", "docs", "house-rules.md");
export const RULES_MODULE = join(HERE, "..", "rules.js");

export function render(md) {
  return "// Generated from docs/house-rules.md by `npm run rules`. Edit the page, not this.\n" +
    `export const RULES_MD = ${JSON.stringify(md)};\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const want = render(readFileSync(RULES_DOC, "utf8"));
  let have = "";
  try { have = readFileSync(RULES_MODULE, "utf8"); } catch { have = ""; }
  if (process.argv.includes("--check")) {
    if (have !== want) { console.error("mcp/rules.js is behind docs/house-rules.md: run `npm run rules`."); process.exit(1); }
  } else if (have !== want) {
    writeFileSync(RULES_MODULE, want);
    console.log("wrote mcp/rules.js");
  }
}
