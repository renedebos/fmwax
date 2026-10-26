// A BLANK HOUSE (the trial, 2026-10-17): no stand-in speaker on its pages,
// and Claude told to start a first set rather than "press 1".
import { test } from "node:test";
import assert from "node:assert/strict";

import worker, { __test } from "../worker.js";
import { makeEnv, installFetch, PID } from "./harness.js";

const KEY = "pagekey12345";
function blank() {
  const e = makeEnv();
  for (const n of ["DEFAULT_DEVICE", "ROOM_DEVICES", "WIIM_SPEAKERS"]) delete e[n];
  e.PROGRAM_LIBRARY_KEY = KEY;
  e.BUTTONS = JSON.stringify([{ button: 1, guest: true, live: true, name: "Requests", playlist: PID, catalog: "spotify" }]);
  return e;
}

test("a house with no speakers names none: no stand-in Pro Plus and no 'undefined' on its pages", async () => {
  const f = installFetch();
  try {
    const e = blank();
    for (const p of [`/buttons/${KEY}`, `/buttons/${KEY}/wiim`, `/buttons/${KEY}/djs`, `/buttons/${KEY}/hank`]) {
      const r = await worker.fetch(new Request(`https://fmwax.test${p}`), e, null);
      // What a person sees or a script is handed, not the notes in the code.
      const html = (await r.text()).replace(/<script[\s\S]*?<\/script>/g, (m) => m.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ""))
        .replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "");
      assert.ok(r.status < 500, `${p}: ${r.status}`);
      assert.doesNotMatch(html, /Pro Plus/, `${p} names the stand-in`);
      assert.doesNotMatch(html, />undefined</, `${p} prints undefined`);
    }
  } finally { f.restore(); }
});

test("a set written onto an empty requests preset tells Claude to start it and how to save the preset", async () => {
  const f = installFetch({ contents: [] });
  try {
    const out = await __test.callTool(blank(), "replace_playlist", { playlist: "guest on spotify", uris: ["spotify:track:aaa"] }, { remaining: 40 });
    assert.match(out.first_set, /likely the house's first set, and preset 1/);
    assert.match(out.first_set, /Start the set now with play_playlist rather than saying "press 1"/);
    assert.match(out.first_set, /hold 1 on that speaker/);
  } finally { f.restore(); }
  const g = installFetch({ contents: ["spotify:track:old"] });
  try {
    const again = await __test.callTool(blank(), "replace_playlist", { playlist: "guest on spotify", uris: ["spotify:track:bbb"] }, { remaining: 40 });
    assert.equal(again.first_set, undefined, "a preset that held a set before is pressed as usual");
  } finally { g.restore(); }
});
