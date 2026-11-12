// The search count (search lean, d86030a): every "search: n=" and "set: " line from
// Workers Logs between two times, in Pacific time. Reads ONLY those console lines,
// never request URLs (they carry the page key); still, ask the owner before each run.
//   CLOUDFLARE_API_TOKEN=… node mcp/dev/search-lean.mjs <from ISO> [to ISO]
import { readFileSync } from "node:fs";
const ACC = JSON.parse(readFileSync(new URL("../house.json", import.meta.url), "utf8")).worker.accountId;
const from = Date.parse(process.argv[2]), to = Date.parse(process.argv[3] ?? new Date().toISOString());
async function q(needle, offset) {
  const body = {
    queryId: "search-lean", view: "events", limit: 2000,
    timeframe: { from, to },
    parameters: {
      datasets: ["cloudflare-workers"], filterCombination: "and",
      filters: [
        { key: "$metadata.service", operation: "eq", type: "string", value: "music-control-mcp" },
        { key: "$metadata.message", operation: "includes", type: "string", value: needle },
      ],
    },
  };
  if (offset) body.offset = offset;
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/workers/observability/telemetry/query`, {
    method: "POST", headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.success) { console.error(JSON.stringify(j.errors ?? j).slice(0, 500)); process.exit(1); }
  return (j.result?.events?.events ?? []).map((e) => ({ t: e.timestamp, m: e.$metadata?.message ?? "" }));
}
const out = [];
for (const needle of ["search: n=", "set: "]) {
  const rows = (await q(needle)).filter((r) => r.m.startsWith(needle));
  console.error(needle, rows.length);
  out.push(...rows);
}
out.sort((a, b) => a.t - b.t);
for (const r of out) console.log(new Date(r.t).toLocaleString("sv-SE", { timeZone: "America/Los_Angeles" }), r.m);
