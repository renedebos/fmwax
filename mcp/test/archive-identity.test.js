// THE ARCHIVE'S WORDS, IN ONE PLACE (2026-10-25, the owner: going public as
// "A, off and nameless"). Whose tapes the archive holds is said in
// archive-identity.js and nowhere else, so a copy of the app takes the blank
// in install/ in its place and names nobody.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

import { ARCHIVE } from "../archive-identity.js";
import { ARCHIVE as BLANK } from "../install/archive-identity.blank.js";

const MCP = new URL("..", import.meta.url).pathname;
// A copy has the blank as its own: there is nobody to keep out of the code.
const isCopy = ARCHIVE.dj === BLANK.dj;
const kind = (v) => (Array.isArray(v) ? `array of ${typeof v[0]}` : typeof v);

test("the blank has every field the house's has, of the same kind", () => {
  assert.deepEqual(Object.keys(BLANK).sort(), Object.keys(ARCHIVE).sort());
  for (const k of Object.keys(ARCHIVE)) assert.equal(kind(BLANK[k]), kind(ARCHIVE[k]), k);
  assert.equal(BLANK.asks.length, 4, "the DJ's page shows four asks");
  assert.ok(BLANK.aliases.includes("the archive"), "\"the archive\" finds the archive's DJ in any house");
  assert.match(BLANK.dj, /^[a-z0-9-]+$/);
  assert.match(BLANK.key, /^[a-z0-9-]+$/);
});

test("the blank names nobody the house's archive does", { skip: isCopy && "this is a copy" }, () => {
  const text = JSON.stringify(BLANK).toLowerCase();
  for (const word of [ARCHIVE.key, ARCHIVE.dj, ...ARCHIVE.name.toLowerCase().split(/\s+/).filter((w) => w !== "archive")]) {
    assert.ok(!text.includes(word.toLowerCase()), `the blank says "${word}"`);
  }
});

// Every file a copy carries from mcp/ and helper/, and the rules page, read
// for the archive's key, which in this house is also its family's name: only
// archive-identity.js may say it.
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name.startsWith(".") || d.name === "node_modules") return [];
    const p = join(dir, d.name);
    return d.isDirectory() ? files(p) : [p];
  });
}
const TEXT = new Set([".js", ".mjs", ".md", ".json", ".toml", ".xml", ".html", ".css", ".yml", ".txt", ".service"]);

test("the archive's name is said only in archive-identity.js", { skip: isCopy && "this is a copy" }, () => {
  const all = [...files(MCP), ...files(join(MCP, "../helper")), join(MCP, "../docs/house-rules.md")]
    .filter((p) => TEXT.has(extname(p)) && !p.endsWith("/archive-identity.js"));
  assert.ok(all.length > 100, "the code is all here");
  const word = new RegExp(ARCHIVE.key, "i");
  const saying = all.filter((p) => word.test(readFileSync(p, "utf8"))).map((p) => p.slice(MCP.length));
  assert.deepEqual(saying, [], "move the words into archive-identity.js");
});
