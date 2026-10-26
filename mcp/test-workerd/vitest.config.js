// The workerd half of the station suite: the same wrangler.toml the deploy
// reads, so the binding, the migration tag and the SQLite flavour of the
// class are what get exercised — a config drift fails here before it fails
// in production. Run with: npm run test:workerd (from mcp/).
//
// The vitest 3 line on purpose. The vitest 4 pool (>=0.10) hard-pins a
// wrangler that refuses Node 20, and this machine's documented commands
// (`npx wrangler secret put`, deploys) resolve the LOCAL wrangler first —
// upgrading the pool would break deploys to fix nothing. Revisit when the
// machine moves to Node 22.
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["test-workerd/**/*.test.js"],
    poolOptions: {
      workers: {
        // Resolved against THIS FILE (the vitest-4 pool resolved against the
        // working directory instead — mind this line if the pool upgrades).
        wrangler: { configPath: "../wrangler.toml" },
      },
    },
  },
});
