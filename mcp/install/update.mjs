#!/usr/bin/env node
// GET THE LATEST VERSION (MC-34 stage 2, 2026-10-26). A house made by the
// Deploy button lives in its owner's own GitHub copy, which Cloudflare deploys
// on every push. That copy's "Get the latest version" workflow (made from the
// setup page, updates.js) clones the public repository and runs THIS file
// from the clone, so the newest way of updating is always the one used:
//
//   node <latest>/mcp/install/update.mjs <latest> <here>
//
// Everything of the latest version comes in, and whatever it no longer has
// goes, except what is the house's own: its .git and .github, and in its
// wrangler.jsonc the name and the stores' ids Cloudflare wrote there (a
// binding new in this version keeps no id, and the deploy makes its store).
// package.json keeps the house's name too.
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OWN = new Set([".git", ".github", "wrangler.jsonc"]);

// A wrangler.jsonc as the copy writes it: comment lines, then plain JSON.
export function readConfig(file) {
  const text = readFileSync(file, "utf8");
  const head = text.split("\n").filter((l) => l.startsWith("//")).join("\n");
  return { head, config: JSON.parse(text.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")) };
}

// The latest config, with this house's name, stores and anything it named
// that the latest leaves to the house (an account, its own routes).
export function mergeConfig(latest, here) {
  const ids = Object.fromEntries((here.kv_namespaces ?? []).filter((k) => k.id).map((k) => [k.binding, k.id]));
  const out = { ...latest, name: here.name ?? latest.name };
  out.kv_namespaces = (latest.kv_namespaces ?? []).map((k) => (ids[k.binding] ? { ...k, id: ids[k.binding] } : { ...k }));
  for (const k of ["account_id", "routes"]) if (here[k] !== undefined && latest[k] === undefined) out[k] = here[k];
  return out;
}

export function update(latestDir, hereDir) {
  const latest = resolve(latestDir), here = resolve(hereDir);
  for (const f of ["wrangler.jsonc", join("mcp", "worker.js"), ".fmwax-copy"]) {
    if (!existsSync(join(latest, f))) throw new Error(`${latest} is not a copy of fmwax: it has no ${f}`);
  }
  if (!existsSync(join(here, "wrangler.jsonc"))) throw new Error(`${here} has no wrangler.jsonc: is this the house's copy?`);
  const mine = readConfig(join(here, "wrangler.jsonc"));
  const theirs = readConfig(join(latest, "wrangler.jsonc"));
  const ownName = existsSync(join(here, "package.json")) ? JSON.parse(readFileSync(join(here, "package.json"), "utf8")).name : null;

  for (const e of readdirSync(here)) if (!OWN.has(e)) rmSync(join(here, e), { recursive: true, force: true });
  for (const e of readdirSync(latest)) if (!OWN.has(e)) cpSync(join(latest, e), join(here, e), { recursive: true });

  writeFileSync(join(here, "wrangler.jsonc"), `${theirs.head}\n${JSON.stringify(mergeConfig(theirs.config, mine.config), null, 2)}\n`);
  if (ownName && existsSync(join(here, "package.json"))) {
    const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
    writeFileSync(join(here, "package.json"), `${JSON.stringify({ ...pkg, name: ownName }, null, 2)}\n`);
  }
  return JSON.parse(readFileSync(join(latest, ".fmwax-copy"), "utf8")).from ?? null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [latestDir, hereDir] = process.argv.slice(2);
  if (!latestDir || !hereDir) { console.error("node update.mjs <latest> <here>"); process.exit(2); }
  try {
    const from = update(latestDir, hereDir);
    console.log(`Updated to the version made from ${String(from ?? "?").slice(0, 7)}.`);
  } catch (e) { console.error(String(e?.message ?? e)); process.exit(1); }
}
