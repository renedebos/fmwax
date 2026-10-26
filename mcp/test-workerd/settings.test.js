import { describe, test, expect } from "vitest";
import { env } from "cloudflare:test";
import { settingsOf, withSettings } from "../settings.js";

// The settings store's shadow (MC-31, step 1) on the real binding and
// migration, with the real house's vars: what comes back from the object is
// what the deploy handed over, BUTTONS' array of tables included.
describe("the settings store against the real binding", () => {
test("the real vars go into HOUSE and come back the same", async () => {
  const n = Object.keys(settingsOf(env)).length;
  expect(n).toBeGreaterThan(10);
  expect((await withSettings(env, null)).__settings).toBe("vars: nothing stored, copied in");
  const read = await withSettings(env, null);
  expect(read.__settings).toBe("store");
  for (const [name, v] of Object.entries(settingsOf(env))) expect(JSON.stringify(read[name])).toBe(JSON.stringify(v));
});

test("the owner is claimed once on the real object, and recovered by the code's hash", async () => {
  const stub = env.HOUSE.get(env.HOUSE.idFromName(crypto.randomUUID()));
  const op = async (body) => (await stub.fetch("https://house/owner", { method: "POST", body: JSON.stringify(body) })).json();
  const a = "a".repeat(64), b = "b".repeat(64), r = "c".repeat(64);
  expect(await op({ op: "look", token: a })).toMatchObject({ claimed: false, owner: false });
  const [one, two] = await Promise.all([op({ op: "claim", token: a, recovery: r }), op({ op: "claim", token: b, recovery: r })]);
  expect([one.ok, two.ok].filter(Boolean)).toHaveLength(1);
  const winner = one.ok ? a : b, loser = one.ok ? b : a;
  expect(await op({ op: "look", token: winner })).toMatchObject({ claimed: true, owner: true });
  expect((await op({ op: "look", token: loser })).owner).toBe(false);
  expect((await op({ op: "recover", token: loser, recovery: "d".repeat(64) })).ok).toBe(false);
  expect((await op({ op: "recover", token: loser, recovery: r })).ok).toBe(true);
  expect((await op({ op: "look", token: loser })).owner).toBe(true);
});

test("the real object makes the house's keys once, keeps a given one, and refuses a name it does not know", async () => {
  const stub = env.HOUSE.get(env.HOUSE.idFromName(crypto.randomUUID()));
  // Every answer read to the end: one left unread keeps the object busy.
  const keys = async (body) => { const r = await stub.fetch("https://house/keys", { method: "POST", body: JSON.stringify(body) });
    return { status: r.status, json: await r.json() }; };
  const one = (await keys({ make: ["MCP_SECRET", "PROGRAM_LIBRARY_KEY"] })).json;
  expect(one.held.sort()).toEqual(["MCP_SECRET", "PROGRAM_LIBRARY_KEY"]);
  const doc1 = await (await stub.fetch("https://house/settings")).json();
  await keys({ make: ["MCP_SECRET"] });
  const doc2 = await (await stub.fetch("https://house/settings")).json();
  expect(doc2.keys.MCP_SECRET).toBe(doc1.keys.MCP_SECRET);
  expect(doc1.keys.MCP_SECRET).toMatch(/^[A-Za-z0-9_-]{32}$/);
  expect((await keys({ set: { SPOTIFY_CLIENT_ID: "0123456789abcdef0123456789abcdef" } })).status).toBe(200);
  expect((await keys({ set: { OPENAI_API_KEY: "x" } })).status).toBe(400);
});
});

