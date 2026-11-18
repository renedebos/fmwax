// THE DEPLOY'S STAMP (2026-11-17, dev/deploy.mjs): the commit, its day, and
// how far the public copy is behind, as wrangler --var pairs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stampVars } from "../dev/deploy.mjs";

test("the deploy stamps the commit, its day and the public copy's distance, and nothing it cannot vouch for", () => {
  const HEAD = "e".repeat(40), FROM = "4".repeat(40);
  assert.deepEqual(stampVars({ head: HEAD, changed: false, day: "2026-11-17", from: FROM, ahead: 3 }),
    [`HOUSE_COMMIT:${HEAD}`, "HOUSE_COMMIT_DAY:2026-11-17", `HOUSE_AHEAD_OF:${FROM}`, "HOUSE_AHEAD:3"]);
  assert.deepEqual(stampVars({ head: HEAD, changed: true, day: "2026-11-17" }), [`HOUSE_COMMIT:${HEAD}+`, "HOUSE_COMMIT_DAY:2026-11-17"]);
  assert.deepEqual(stampVars({ head: HEAD, changed: false, day: "17 Nov", from: FROM, ahead: null }), [`HOUSE_COMMIT:${HEAD}`]);
  assert.deepEqual(stampVars({ head: null }), [], "no git: deployed as before");
});
