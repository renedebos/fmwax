// UPDATES BY A CLICK (MC-34 stage 2, 2026-10-26). A house made by the Deploy
// button runs from its owner's own GitHub copy of the public repository, and
// Cloudflare deploys that copy on every push. Cloudflare's import leaves out
// .github/, so the copy has no way to fetch a newer version until its owner
// adds one: the setup page's Updates step gives a GitHub link that opens the
// "Get the latest version" workflow already written, to be committed once;
// after that an update is Run workflow on GitHub (install/update.mjs does the
// work). The page also says when the public repository has a newer version
// than this house runs (version.js, stamped by the copy script).
import { VERSION } from "./version.js";
import { programsKV } from "./services.js";

// The public repository this house came from (SOURCE_REPO, in the button's
// config), and the owner's own copy (UPDATE_REPO, given on the setup page):
// both GitHub repositories, as { slug, web }.
export function githubRepo(value) {
  const m = String(value ?? "").trim().replace(/\.git$/, "").replace(/\/+$/, "")
    .match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/);
  if (!m || m[2] === "." || m[2] === "..") return null;
  return { slug: `${m[1]}/${m[2]}`, web: `https://github.com/${m[1]}/${m[2]}` };
}
export const updateSource = (env) => githubRepo(env?.SOURCE_REPO);

export const WORKFLOW_PATH = ".github/workflows/update.yml";
// The workflow the house's copy runs. The public repository's own update.mjs
// does the work, so a better way of updating arrives with the next version.
export function updateWorkflow(source) {
  return `# Get the latest version of fmwax, keeping this house's own name and stores.
# Made by the house's setup page (Updates). To update: this repository's
# Actions tab, "Get the latest version", Run workflow. Cloudflare deploys the
# result as it deploys every push here.
name: Get the latest version
on:
  workflow_dispatch:
permissions:
  contents: write
jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - name: The latest version
        env:
          SOURCE: ${source.web}
        run: |
          git clone --depth 1 "$SOURCE" "$RUNNER_TEMP/latest"
          node "$RUNNER_TEMP/latest/mcp/install/update.mjs" "$RUNNER_TEMP/latest" .
          git add -A
          if git diff --cached --quiet; then echo "This house has the latest version already."; exit 0; fi
          FROM=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).from.slice(0, 7))' "$RUNNER_TEMP/latest/.fmwax-copy")
          git -c user.name="fmwax update" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "The latest version of fmwax ($FROM)"
          git push
`;
}
// GitHub's own "new file" page, the workflow filled in: Commit changes, once.
export function turnOnLink(own, source) {
  return `${own.web}/new/main?filename=${WORKFLOW_PATH}&value=${encodeURIComponent(updateWorkflow(source))}`;
}
export const runLink = (own) => `${own.web}/actions/workflows/update.yml`;

// The public repository's newest version: the commit its copy was made from
// (.fmwax-copy), read at most once an hour. Null when it cannot be read.
const LATEST_KEY = "update:latest";
export async function latestVersion(env, now = Date.now()) {
  const source = updateSource(env);
  if (!source) return null;
  try {
    const kept = await programsKV(env).get(LATEST_KEY, { type: "json" });
    if (kept?.from && now - kept.read < 3600e3) return kept.from;
  } catch { /* read it again */ }
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${source.slug}/main/.fmwax-copy`, { headers: { "user-agent": "fmwax-house" } });
    if (!r.ok) return null;
    const from = String((await r.json())?.from ?? "");
    if (!/^[0-9a-f]{40}$/.test(from)) return null;
    try { await programsKV(env).put(LATEST_KEY, JSON.stringify({ from, read: now }), { expirationTtl: 86400 }); } catch { /* read again next time */ }
    return from;
  } catch { return null; }
}

// What the setup page says: null for a house with no source (the author's,
// or one made from the terminal); else its version, the newest, and the
// owner's copy and links once given.
export async function updateFacts(env, now = Date.now()) {
  const source = updateSource(env);
  if (!source) return null;
  const own = githubRepo(env.UPDATE_REPO);
  const latest = await latestVersion(env, now);
  return {
    source: source.web, current: VERSION, latest,
    newer: !!(latest && VERSION && latest !== VERSION),
    own: own?.web ?? null, ownSlug: own?.slug ?? null,
    turnOn: own ? turnOnLink(own, source) : null, run: own ? runLink(own) : null,
  };
}
