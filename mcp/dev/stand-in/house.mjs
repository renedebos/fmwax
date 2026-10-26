// A STAND-IN HOUSE for the helper's install (dev/helper-check.mjs), loaded
// with `node --import`: install/helper.js's own fetch is answered here, so
// nothing is asked of a real house. It names one WiiM with its address, and
// says the helper's line is open and each read newer than the last. A
// remover runs without it, and its word to the house goes nowhere that answers.
const house = new URL(process.env.FMWAX_STANDIN_HOUSE);
const key = process.env.FMWAX_STANDIN_KEY;
const real = globalThis.fetch;
globalThis.fetch = async (u, init = {}) => {
  const url = new URL(String(u));
  if (url.host !== house.host) return real(u, init);
  // The pairing door (2026-10-21): "good-code" gives the key, "old-code" has
  // run out, anything else is not this house's.
  if (url.pathname === "/helper/pair") {
    const code = JSON.parse(init.body ?? "{}").code;
    return code === "good-code" ? Response.json({ ok: true, key })
      : Response.json({ ok: false, code: code === "old-code" ? "expired" : "bad" }, { status: code === "old-code" ? 410 : 403 });
  }
  const auth = new Headers(init.headers ?? {}).get("authorization");
  if (auth !== `Bearer ${key}`) return new Response("not found", { status: 404 });
  if (url.pathname === "/helper/speakers" && (init.method ?? "GET") === "GET") {
    return Response.json({ ok: true, names: ["Check WiiM"], learns: false, speakers: { "Check WiiM": "127.0.0.1" } });
  }
  if (url.pathname === "/helper/status") {
    return Response.json({ ok: true, hands: true, read: { at: Date.now(), speakers: { "Check WiiM": "play" } } });
  }
  return new Response("not found", { status: 404 });
};
