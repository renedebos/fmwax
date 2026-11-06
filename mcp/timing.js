// THE STOPWATCH (the owner, 2026-11-02: "go", step 1 of making the pages
// faster, tasks/mc37-speed.md). Loaded took about 800 ms on the server and
// the other tabs 200 to 450, with spikes of 2 to 5 s nobody could place. Each
// request carries one, and the owner's pages answer with a Server-Timing
// header: the route's phases in order, then the time spent waiting on the
// ledger (the Durable Object), the store (KV), Spotify and other fetches,
// each summed with its count. The browser's network panel shows it, and
// dev/timings.mjs reads it from the page's performance entries.
//
// A Worker's clock stands still while it computes and moves only across a
// wait (Cloudflare's guard against timing attacks), so these are waits, not
// work: a phase that only renders reads 0. Waits that overlap are each counted
// in full, so a sum can be longer than the phase it ran in.

export function stopwatch(now = () => Date.now()) {
  const start = now();
  let last = start;
  const laps = [];
  const sums = new Map();
  return {
    // The time since the last lap, under this phase's name.
    lap(name) {
      const t = now();
      laps.push([name, t - last]);
      last = t;
    },
    add(kind, ms) {
      const s = sums.get(kind) ?? { ms: 0, n: 0 };
      s.ms += ms;
      s.n += 1;
      sums.set(kind, s);
    },
    header() {
      const parts = laps.map(([name, ms]) => `${name};dur=${ms}`);
      for (const [kind, s] of sums) parts.push(`${kind};dur=${s.ms};desc="${s.n} ${s.n === 1 ? "call" : "calls"}"`);
      parts.push(`total;dur=${now() - start}`);
      return parts.join(", ");
    },
  };
}

// A wait, timed into its kind's sum. The promise is the caller's own, so what
// it answers or throws is unchanged; without a stopwatch it is returned as it
// came.
export function timed(env, kind, p) {
  const w = env?.__watch;
  if (!w || typeof p?.finally !== "function") return p;
  const t0 = Date.now();
  return p.finally(() => w.add(kind, Date.now() - t0));
}

// The owner's pages and their poll only: a public programme page or the
// health check says nothing of how the house is built.
const TIMED_PATHS = /^\/(buttons|notes)\//;
export function withTimings(response, watch, path) {
  if (!watch || !response || response.status === 101 || !TIMED_PATHS.test(path)) return response;
  // A response passed through from elsewhere has headers that cannot change:
  // it goes out as it came.
  try { response.headers.append("server-timing", watch.header()); } catch { /* immutable */ }
  return response;
}
