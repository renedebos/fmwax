// ONE ANSWER, ALWAYS (the review, 2026-11-19). The helper's requests to a
// WiiM resolved only on the response's "end" or the request's "error". A
// speaker that sent headers and then stalled, or reset mid-answer, gave
// neither: the caller waited for ever, a press got no reply and readings
// stopped. Run against a local server that does each.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { ask } from "../../helper/fmwax-helper.mjs";

function server(how) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      if (how === "fine") { res.end('{"status":"play"}'); return; }
      if (how === "silent") return;
      res.writeHead(200, { "content-type": "application/json", "content-length": "100" });
      res.write('{"status":');
      if (how === "reset") setTimeout(() => req.socket.destroy(), 100);
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}
const TIMEOUT = 400;
async function asked(how) {
  const s = await server(how);
  const t = Date.now();
  try {
    const v = await Promise.race([
      ask((on) => http.get({ host: "127.0.0.1", port: s.address().port, path: "/", timeout: TIMEOUT }, on), TIMEOUT, (res, body) => JSON.parse(body)),
      new Promise((r) => setTimeout(() => r("never settled"), TIMEOUT + 2500)),
    ]);
    return { v, ms: Date.now() - t };
  } finally { s.closeAllConnections(); s.close(); }
}

test("a whole answer is the answer", async () => {
  assert.deepEqual((await asked("fine")).v, { status: "play" });
});
test("no answer at all ends as nothing, at the timeout", async () => {
  const r = await asked("silent");
  assert.equal(r.v, null); assert.ok(r.ms < TIMEOUT + 1500, `took ${r.ms} ms`);
});
test("headers, then silence: ends as nothing, never waits for ever", async () => {
  const r = await asked("stall");
  assert.equal(r.v, null); assert.ok(r.ms < TIMEOUT + 1500, `took ${r.ms} ms`);
});
test("headers, then the connection dropped: ends as nothing", async () => {
  const r = await asked("reset");
  assert.equal(r.v, null); assert.ok(r.ms < TIMEOUT + 1500, `took ${r.ms} ms`);
});
test("an answer that can't be read ends as nothing", async () => {
  const s = await new Promise((resolve) => { const x = http.createServer((q, res) => res.end("not json")); x.listen(0, "127.0.0.1", () => resolve(x)); });
  try {
    assert.equal(await ask((on) => http.get({ host: "127.0.0.1", port: s.address().port, path: "/" }, on), 1000, (res, body) => JSON.parse(body)), null);
  } finally { s.closeAllConnections(); s.close(); }
});

// SENT, NOT ANSWERED (the review, 2026-11-19): told apart from a speaker that
// could not be reached, so the house does not start the music a second way.
test("a speaker reached that never answers is marked reached; one that refuses the connection is not", async () => {
  const s = await server("silent");
  const seen = {}, port = s.address().port;
  try {
    assert.equal(await ask((on) => http.get({ host: "127.0.0.1", port, path: "/", timeout: 300 }, on), 300, (r, b) => b, seen), null);
    assert.equal(seen.reached, true);
  } finally { s.closeAllConnections(); s.close(); }
  const gone = {};
  assert.equal(await ask((on) => http.get({ host: "127.0.0.1", port, path: "/", timeout: 300 }, on), 300, (r, b) => b, gone), null);
  assert.equal(gone.reached, undefined);
});

test("a command the speaker did not answer is no-answer; one that never reached it is unreachable", async () => {
  const { obey } = await import("../../helper/fmwax-helper.mjs");
  const m = { id: "1", cmd: "pause", speaker: "Pro Plus" };
  const sp = { "Pro Plus": "192.0.2.1" };
  assert.equal((await obey(sp, m, async (ip, c, j, t, seen) => { seen.reached = true; return null; })).code, "no-answer");
  assert.equal((await obey(sp, m, async () => null)).code, "unreachable");
  assert.equal((await obey(sp, m, async () => "nope")).code, "failed");
});
