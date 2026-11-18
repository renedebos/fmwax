#!/usr/bin/env node
// THE DEPLOY, WITH ITS VERSION (2026-11-17, the owner: "is there a way to see
// what version we are running on the tv page... on the phone app and what
// version is on github?"). `npm run deploy` ends here: wrangler deploy, with
// the commit it was made from stamped into the Worker when this folder is a
// git repository, so the House rules page and the TV's rooms screen can say
// which version the house runs (updates.js, versionLine):
//   HOUSE_COMMIT      the commit, with a "+" when the app (mcp/, helper/) has
//                     changes not yet committed;
//   HOUSE_COMMIT_DAY  that commit's day, YYYY-MM-DD, in this computer's zone;
//   HOUSE_AHEAD_OF, HOUSE_AHEAD
//                     when house.json names its public copy (site.publicCopy,
//                     the author's house only): the commit that copy was made
//                     from, read from its .fmwax-copy on GitHub, and how many
//                     commits that changed the app came after it.
// A house made from the copy knows its version from version.js, and none of
// this is needed; without git it deploys as before, unstamped.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MCP = join(dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = "wrangler@4.162.0";

function git(args) {
  const r = spawnSync("git", args, { cwd: MCP, encoding: "utf8" });
  return r.status === 0 ? String(r.stdout).trim() : null;
}

// The --var pairs for this deploy, from git and the public copy's marker
// (exported for the test).
export function stampVars({ head, changed, day, from = null, ahead = null }) {
  if (!/^[0-9a-f]{40}$/.test(String(head ?? ""))) return [];
  const vars = [`HOUSE_COMMIT:${head}${changed ? "+" : ""}`];
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(day ?? ""))) vars.push(`HOUSE_COMMIT_DAY:${day}`);
  if (/^[0-9a-f]{40}$/.test(String(from ?? "")) && Number.isInteger(ahead) && ahead >= 0) {
    vars.push(`HOUSE_AHEAD_OF:${from}`, `HOUSE_AHEAD:${ahead}`);
  }
  return vars;
}

async function copyFrom() {
  let slug = null;
  try { slug = JSON.parse(readFileSync(join(MCP, "house.json"), "utf8"))?.site?.publicCopy ?? null; } catch { slug = null; }
  if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(String(slug ?? ""))) return null;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${slug}/main/.fmwax-copy`,
      { headers: { "user-agent": "fmwax-house" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const from = String((await r.json())?.from ?? "");
    return /^[0-9a-f]{40}$/.test(from) ? from : null;
  } catch { return null; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const head = git(["rev-parse", "HEAD"]);
  let vars = [];
  if (head) {
    const changed = !!git(["status", "--porcelain", "--", "../mcp", "../helper"]);
    const day = git(["show", "-s", "--format=%cd", "--date=format-local:%Y-%m-%d", "HEAD"]);
    const from = await copyFrom();
    const count = from ? git(["rev-list", "--count", `${from}..HEAD`, "--", "../mcp", "../helper"]) : null;
    const ahead = count != null && /^\d+$/.test(count) ? Number(count) : null;
    vars = stampVars({ head, changed, day, from, ahead });
    console.log(`Deploying ${head.slice(0, 7)}${changed ? " (with changes not yet committed)" : ""}` +
      (ahead != null ? `, ${ahead} app ${ahead === 1 ? "change" : "changes"} after the public copy (${from.slice(0, 7)})` : ""));
  }
  const r = spawnSync("npx", ["--yes", WRANGLER, "deploy", ...vars.flatMap((v) => ["--var", v])], { cwd: MCP, stdio: "inherit" });
  process.exit(r.status ?? 1);
}
