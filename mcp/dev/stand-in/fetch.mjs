// THE HOUSE door.js WAITS FOR, answered here (the installer's check,
// dev/door-check.mjs): the stand-in deploy names an address that was never
// deployed, so door.js's own fetch is answered in this process, loaded with
// `node --import`. Like a real new house, its setup page says "not found" for
// the first two asks, until the setup key has reached it (the owner's Mac,
// 2026-10-19), while /health answers at once.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const host = new URL(process.env.FMWAX_STANDIN_ADDRESS).hostname;
const real = globalThis.fetch;
let setupAsks = 0;
globalThis.fetch = async (u, init) => {
  const url = new URL(String(u));
  if (url.hostname !== host) return real(u, init);
  appendFileSync(join(process.env.FMWAX_STANDIN_DIR, "fetches.jsonl"), `${JSON.stringify({ path: url.pathname })}\n`);
  if (url.pathname === "/health") return Response.json({ ok: true });
  if (url.pathname === "/setup") return ++setupAsks > 2 ? new Response("<!doctype html><title>Set up</title>") : new Response("not found", { status: 404 });
  return new Response("not found", { status: 404 });
};
