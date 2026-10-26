// UPDATES BY A CLICK (MC-34 stage 2, 2026-10-26). A house made by the Deploy
// button: its owner's GitHub copy given once on the setup page, a workflow
// committed once from GitHub's own page, then Run workflow for each new
// version, whose update.mjs takes everything new and keeps the house's own
// name and stores.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import worker from "../worker.js";
import { githubRepo, turnOnLink, updateWorkflow, WORKFLOW_PATH } from "../updates.js";
import { mergeConfig, update } from "../install/update.mjs";
import { makeEnv, makeHouseStore } from "./harness.js";
import { VERSION } from "../version.js";

const SOURCE = "https://github.com/someone/fmwax";
const SHA_NEW = "b".repeat(40);

test("a GitHub repository, however it is pasted; anything else is not one", () => {
  for (const v of ["github.com/you/fmwax-house2", "https://github.com/you/fmwax-house2", "https://github.com/you/fmwax-house2.git",
    "you/fmwax-house2", "  https://www.github.com/you/fmwax-house2/ "]) {
    assert.deepEqual(githubRepo(v), { slug: "you/fmwax-house2", web: "https://github.com/you/fmwax-house2" }, v);
  }
  for (const v of ["", "fmwax-house2", "https://gitlab.com/you/x", "github.com/you/x/tree/main", "you/..", "-you/x", "you/x?y=1"]) {
    assert.equal(githubRepo(v), null, v);
  }
});

test("the workflow: run by hand, the public repository's own update.mjs, a pinned checkout, a commit only when something changed", () => {
  const wf = updateWorkflow(githubRepo(SOURCE));
  assert.match(wf, /^name: Get the latest version$/m);
  assert.match(wf, /^ {2}workflow_dispatch:$/m);
  assert.ok(!/schedule:|push:/.test(wf), "never by itself: one bad version must not reach every house at once");
  assert.match(wf, /SOURCE: https:\/\/github\.com\/someone\/fmwax$/m);
  assert.match(wf, /actions\/checkout@[0-9a-f]{40} # v7\.0\.1/);
  assert.match(wf, /node "\$RUNNER_TEMP\/latest\/mcp\/install\/update\.mjs" "\$RUNNER_TEMP\/latest" \./);
  assert.match(wf, /git diff --cached --quiet; then echo "This house has the latest version already\."; exit 0; fi/);
  const link = turnOnLink(githubRepo("you/fmwax-house2"), githubRepo(SOURCE));
  assert.ok(link.startsWith(`https://github.com/you/fmwax-house2/new/main?filename=${WORKFLOW_PATH}&value=`));
  assert.equal(decodeURIComponent(link.split("&value=")[1]), wf);
});

test("update.mjs: everything of the latest comes in, what it dropped goes, the house's name, stores and .github stay", () => {
  const root = mkdtempSync(join(tmpdir(), "fmwax-update-"));
  try {
    const latest = join(root, "latest"), here = join(root, "here");
    const put = (dir, file, text) => { mkdirSync(join(dir, file, ".."), { recursive: true }); writeFileSync(join(dir, file), text); };
    const cfg = (o) => `// The Deploy to Cloudflare button's config\n${JSON.stringify(o, null, 2)}\n`;
    put(latest, "wrangler.jsonc", cfg({ name: "fmwax-house", main: "mcp/worker.js",
      kv_namespaces: [{ binding: "TOKENS" }, { binding: "PROGRAMS" }, { binding: "NEWSTORE" }],
      migrations: [{ tag: "v1" }, { tag: "v2" }, { tag: "v3" }], vars: { SOURCE_REPO: SOURCE } }));
    put(latest, "mcp/worker.js", "new worker");
    put(latest, "mcp/new-file.js", "new");
    put(latest, ".fmwax-copy", JSON.stringify({ from: SHA_NEW }));
    put(latest, "package.json", JSON.stringify({ name: "fmwax-house", scripts: { deploy: "npx wrangler@4.200.0 deploy" } }));
    put(latest, ".github/workflows/install-check.yml", "the author's own check");
    put(here, "wrangler.jsonc", cfg({ name: "fmwax-house2", main: "mcp/worker.js",
      kv_namespaces: [{ binding: "TOKENS", id: "t".repeat(32) }, { binding: "PROGRAMS", id: "p".repeat(32) }], migrations: [{ tag: "v1" }, { tag: "v2" }] }));
    put(here, "mcp/worker.js", "old worker");
    put(here, "mcp/gone.js", "dropped since");
    put(here, "package.json", JSON.stringify({ name: "fmwax-house2", scripts: { deploy: "npx wrangler@4.129.1 deploy" } }));
    put(here, ".github/workflows/update.yml", "this house's own updater");
    mkdirSync(join(here, ".git"));

    assert.equal(update(latest, here), SHA_NEW);
    assert.equal(readFileSync(join(here, "mcp/worker.js"), "utf8"), "new worker");
    assert.ok(existsSync(join(here, "mcp/new-file.js")));
    assert.ok(!existsSync(join(here, "mcp/gone.js")), "what the latest dropped goes");
    assert.ok(existsSync(join(here, ".git")));
    assert.equal(readFileSync(join(here, ".github/workflows/update.yml"), "utf8"), "this house's own updater");
    assert.ok(!existsSync(join(here, ".github/workflows/install-check.yml")), "the author's checks stay the author's");
    const text = readFileSync(join(here, "wrangler.jsonc"), "utf8");
    assert.ok(text.startsWith("// The Deploy to Cloudflare button's config\n"));
    const merged = JSON.parse(text.split("\n").filter((l) => !l.startsWith("//")).join("\n"));
    assert.equal(merged.name, "fmwax-house2");
    assert.deepEqual(merged.kv_namespaces, [{ binding: "TOKENS", id: "t".repeat(32) }, { binding: "PROGRAMS", id: "p".repeat(32) }, { binding: "NEWSTORE" }],
      "its own stores kept; a new one left for the deploy to make");
    assert.deepEqual(merged.migrations.map((m) => m.tag), ["v1", "v2", "v3"], "the latest migrations");
    assert.equal(merged.vars.SOURCE_REPO, SOURCE);
    const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
    assert.deepEqual(pkg, { name: "fmwax-house2", scripts: { deploy: "npx wrangler@4.200.0 deploy" } });
    // Not a copy of fmwax: refused before anything is touched.
    rmSync(join(latest, "mcp/worker.js"));
    assert.throws(() => update(latest, here), /not a copy of fmwax/);
    assert.equal(readFileSync(join(here, "mcp/worker.js"), "utf8"), "new worker");
  } finally { rmSync(root, { recursive: true, force: true }); }
  // A house that named its own account or routes keeps them.
  assert.deepEqual(mergeConfig({ name: "a", kv_namespaces: [] }, { name: "b", account_id: "c".repeat(32), routes: [{ pattern: "music.example.org", custom_domain: true }] }),
    { name: "b", kv_namespaces: [], account_id: "c".repeat(32), routes: [{ pattern: "music.example.org", custom_domain: true }] });
});

// The setup page, on a house made by the button.
const KEY = "setup-key-0123456789abcdef";
const ORIGIN = "https://fmwax-house2.someone.workers.dev";
async function house({ source = SOURCE } = {}) {
  const e = makeEnv();
  e.HOUSE = (await makeHouseStore()).binding;
  e.SETUP_KEY = KEY;
  e.HOUSE_TZ = "America/Los_Angeles";
  if (source) e.SOURCE_REPO = source;
  return e;
}
const go = (e, path, { method = "GET", form = null, cookie = null } = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, {
  method, redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" ? { origin: ORIGIN } : {}) },
  body: form ? new URLSearchParams(form) : undefined }), e, null);
function githubRaw(from) {
  const inner = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u, init) => {
    if (String(u).startsWith("https://raw.githubusercontent.com/")) { asked.push(String(u)); return Response.json({ from }); }
    return inner(u, init);
  };
  return { asked, restore: () => { globalThis.fetch = inner; } };
}

test("the Updates step: offered on a button house, the copy given once, then the two GitHub links; refused a bad address", async () => {
  const e = await house();
  const me = ((await go(e, "/setup/claim", { method: "POST", form: { key: KEY } })).headers.get("set-cookie") ?? "").split(";")[0];
  const raw = githubRaw(SHA_NEW);
  try {
    const list = await (await go(e, "/setup", { cookie: me })).text();
    assert.match(list, /Updates/);
    assert.match(list, /Turn on updates/);
    assert.equal(raw.asked[0], "https://raw.githubusercontent.com/someone/fmwax/main/.fmwax-copy");
    let page = await (await go(e, "/setup/updates", { cookie: me })).text();
    assert.match(page, /Your copy's address on GitHub/);
    // The author's own version.js says null; a copy's names its commit,
    // which is not the newest the stand-in GitHub gives.
    assert.match(page, VERSION ? /A newer version is out\./ : /not known yet/);
    // A visitor is sent to the claim; a bad address is refused in words.
    assert.equal((await go(e, "/setup/updates")).headers.get("location"), `${ORIGIN}/setup`);
    const bad = await go(e, "/setup/updates", { method: "POST", form: { repo: "my house" }, cookie: me });
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), /not a GitHub repository&#39;s address/);
    const r = await go(e, "/setup/updates", { method: "POST", form: { repo: "github.com/you/fmwax-house2" }, cookie: me });
    assert.equal(r.headers.get("location"), "/setup/updates?saved=1#turn-on");
    page = await (await go(e, "/setup/updates?saved=1", { cookie: me })).text();
    assert.match(page, /href="https:\/\/github\.com\/you\/fmwax-house2\/new\/main\?filename=\.github\/workflows\/update\.yml&amp;value=/);
    assert.match(page, /href="https:\/\/github\.com\/you\/fmwax-house2\/actions\/workflows\/update\.yml"/);
    assert.match(page, /Commit changes/);
    assert.match(page, /Run workflow/);
    const after = await (await go(e, "/setup", { cookie: me })).text();
    assert.match(after, VERSION ? /A newer version is out/ : /From you\/fmwax-house2/);
    assert.equal(raw.asked.length, 1, "the newest version read once an hour, not on every look");
  } finally { raw.restore(); }
});

test("a house from the terminal or the author's own has no Updates step", async () => {
  const e = await house({ source: null });
  const me = ((await go(e, "/setup/claim", { method: "POST", form: { key: KEY } })).headers.get("set-cookie") ?? "").split(";")[0];
  assert.ok(!/Turn on updates/.test(await (await go(e, "/setup", { cookie: me })).text()));
  assert.equal((await go(e, "/setup/updates", { cookie: me })).headers.get("location"), `${ORIGIN}/setup`);
});
