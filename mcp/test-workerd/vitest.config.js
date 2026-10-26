// The workerd half of the station suite: the same wrangler.toml the deploy
// reads, so the binding, the migration tag and the SQLite flavour of the
// class are what get exercised — a config drift fails here before it fails
// in production. Run with: npm run test:workerd (from mcp/).
//
// Vitest 4 and Cloudflare's plugin (2026-10-25): the vitest 3 pool was held
// back while this machine ran Node 20, and its tools carried 13 known
// problems GitHub flags on the public copy. The pool package is now
// @cloudflare/vitest-plugin; package.json's overrides lift three of its
// pinned dependencies (zod, sharp, undici) past their advisories.
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

export default defineConfig({
  plugins: [
    // Resolved against the working directory, mcp/ (the vitest 3 pool
    // resolved it against this file).
    cloudflareTest({ wrangler: { configPath: "./wrangler.toml" } }),
  ],
  test: {
    include: ["test-workerd/**/*.test.js"],
  },
});
