import { describe, test, expect } from "vitest";
import { env } from "cloudflare:test";
import { __test } from "../worker.js";
import { PERSONAS } from "../djs.js";
import { CATALOGS } from "../catalog.js";

// A playlist id names its catalog by its shape — Spotify's is 22 base-62
// characters, Tidal's a UUID — so a line whose `catalog` and `playlist`
// disagree is a line the parser would read one way and the deploy another.
const ID_SHAPE = {
  spotify: /^[A-Za-z0-9]{22}$/,
  tidal: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};

// The house as the deploy will read it: this suite runs against the same
// wrangler.toml, so a BUTTONS entry naming a DJ that does not exist, a preset
// used twice, or a value wrangler hands over in a shape the parser does not
// take, fails here before it fails on the live house's first request.
describe("the house in wrangler.toml", () => {
  test("parses, and every occupied button names a DJ from the roster", () => {
    const h = __test.house(env);
    expect(h.buttons.length).toBeGreaterThan(0);
    for (const b of h.buttons) {
      if (b.archive) continue;
      // A slot may be installed with NOBODY on it — the wall shows every
      // preset the house has, not only the occupied ones. What is never
      // optional is the playlist: that is the part a preset points at.
      if (b.key !== null) expect(Object.keys(PERSONAS)).toContain(b.key);
      expect(CATALOGS).toContain(b.catalog);
      expect(b.playlist).toMatch(ID_SHAPE[b.catalog]);
    }
  });

  test("the labels a tool may use are the buttons plus the replay playlist", () => {
    const labels = __test.parseAliases(env);
    const buttons = __test.house(env).buttons.filter((b) => !b.archive);
    for (const b of buttons) {
      expect(labels[b.button]).toEqual({ catalog: b.catalog, id: b.playlist });
    }
    // The replay playlist is where Talk writes a set asked for with no DJ —
    // and starting is Spotify's alone, so it is required exactly when this
    // house has a Spotify button. Read from the config rather than assumed: a household
    // running only Tidal has nothing to replay through and needs none.
    const alias = env.PROGRAM_REPLAY_PLAYLIST ?? "replay";
    if (buttons.some((b) => b.catalog === "spotify")) {
      expect(Object.keys(labels)).toContain(alias);
    }
  });
});
