// RELEASE DATES AND FILTERED QUERIES IN search_tracks (2026-09-23). Asked for
// "new Colemine releases in 2026", one curator run refused because nothing it
// could see carried a date, and the next filled the set with 2014-2025
// records. The album's date rides in the same answer, so it is returned; and a
// query may be words for the service as they are, so Spotify's year: filter
// can find a year's records the curator cannot name yet.

import { test } from "node:test";
import assert from "node:assert/strict";

import { __test } from "../worker.js";
import { makeEnv, installFetch } from "./harness.js";

const { callTool } = __test;

test("search_tracks returns each hit's release date, and passes a {query} to Spotify as it is", async () => {
  const f = installFetch();
  const inner = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u));
    if (url.hostname === "api.spotify.com" && url.pathname === "/v1/search") {
      asked.push(url.searchParams.get("q"));
      return Response.json({ tracks: { items: [{ uri: "spotify:track:x", id: "x", name: "New One",
        artists: [{ name: "Kelly Finnigan" }], album: { name: "LP", release_date: "2026-03-13" }, duration_ms: 200000 }] } });
    }
    return inner(u, init);
  };
  try {
    const out = await callTool(makeEnv(), "search_tracks", { catalog: "spotify",
      queries: [{ query: 'artist:"Kelly Finnigan" year:2026' }, { title: "New One", artist: "Kelly Finnigan" }] }, { remaining: 40 });
    assert.deepEqual(asked, ['artist:"Kelly Finnigan" year:2026', "New One Kelly Finnigan"]);
    assert.equal(out.resolved[0].results[0].released, "2026-03-13");
    assert.equal(out.resolved[0].query, 'artist:"Kelly Finnigan" year:2026');
  } finally { globalThis.fetch = inner; f.restore(); }
});
