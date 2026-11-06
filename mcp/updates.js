// UPDATES BY A CLICK (MC-34 stage 2, 2026-10-26). A house made by the Deploy
// button runs from its owner's own GitHub copy of the public repository, and
// Cloudflare deploys that copy on every push. Cloudflare's import leaves out
// .github/, so the copy has no way to fetch a newer version until its owner
// adds one: the setup page's Updates step gives a GitHub link that opens the
// "Get the latest version" workflow already written, to be committed once;
// after that an update is Run workflow on GitHub (install/update.mjs does the
// work). The page also says when the public repository has a newer version
// than this house runs (version.js, stamped by the copy script).
import { UPDATED, VERSION, VERSION_DAY } from "./version.js";
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
// and the day it was made (.fmwax-copy: `day`, or the day of `at` in a copy
// made before `day` was written), read at most once an hour. Null when it
// cannot be read.
const LATEST_KEY = "update:latest";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export async function latestVersion(env, now = Date.now()) {
  const source = updateSource(env);
  if (!source) return null;
  try {
    const kept = await programsKV(env).get(LATEST_KEY, { type: "json" });
    if (kept?.from && now - kept.read < 3600e3) return { from: kept.from, day: DAY.test(kept.day ?? "") ? kept.day : null };
  } catch { /* read it again */ }
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${source.slug}/main/.fmwax-copy`, { headers: { "user-agent": "fmwax-house" } });
    if (!r.ok) return null;
    const copy = await r.json();
    const from = String(copy?.from ?? "");
    if (!/^[0-9a-f]{40}$/.test(from)) return null;
    const day = DAY.test(String(copy?.day ?? "")) ? copy.day : DAY.test(String(copy?.at ?? "").slice(0, 10)) ? String(copy.at).slice(0, 10) : null;
    try { await programsKV(env).put(LATEST_KEY, JSON.stringify({ from, day, read: now }), { expirationTtl: 86400 }); } catch { /* read again next time */ }
    return { from, day };
  } catch { return null; }
}

// A VERSION A PERSON CAN READ (the owner, 2026-11-05: "should there be a
// version number?"): the day it was made, in words that read the same
// everywhere ("5 November 2026"), and the commit's first seven characters
// as its code, for a problem report. Null in the author's own house.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function dayWords(day) {
  const m = DAY.test(String(day ?? "")) ? String(day).split("-").map(Number) : null;
  return m && m[1] >= 1 && m[1] <= 12 ? `${m[2]} ${MONTHS[m[1] - 1]} ${m[0]}` : null;
}
export const versionCode = (sha) => (/^[0-9a-f]{40}$/.test(String(sha ?? "")) ? String(sha).slice(0, 7) : null);
// "the version of 5 November 2026 (code b8a5d8a)", "version b8a5d8a" when
// its day is not known, or null.
export function versionWords(sha = VERSION, day = VERSION_DAY) {
  const code = versionCode(sha);
  if (!code) return null;
  const when = dayWords(day);
  return when ? `the version of ${when} (code ${code})` : `version ${code}`;
}

// What the setup page says: null for a house with no source (the author's,
// or one made from the terminal); else its version, the newest, and the
// owner's copy and links once given, and whether updates were turned on for
// that copy (UPDATES_ON, set by the press that opens GitHub's page).
// A house its workflow has updated (UPDATED) has updates on whatever the page
// saw (2026-11-05: fmwax-house2, turned on before the page noted it, still
// offered step 1 after its update).
export async function updateFacts(env, now = Date.now(), { current = VERSION, currentDay = VERSION_DAY, updated = UPDATED } = {}) {
  const source = updateSource(env);
  if (!source) return null;
  const own = githubRepo(env.UPDATE_REPO);
  const newest = await latestVersion(env, now);
  const latest = newest?.from ?? null;
  // Its own day, or the newest's when it is the newest (a copy made before
  // the day was stamped).
  const day = currentDay ?? (latest && latest === current ? newest.day : null);
  return {
    source: source.web, current, latest,
    // In words for the page: "5 November 2026", and the code for a report.
    currentWhen: dayWords(day), latestWhen: dayWords(newest?.day), code: versionCode(current),
    newer: !!(latest && current && latest !== current),
    own: own?.web ?? null, ownSlug: own?.slug ?? null, on: !!own && (updated === true || env.UPDATES_ON === own.web),
    turnOn: own ? turnOnLink(own, source) : null, run: own ? runLink(own) : null,
  };
}
