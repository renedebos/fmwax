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
// The workflow the house's copy runs. HARDENED 2026-11-15 (the release
// audit: it cloned the public repository's newest commit and ran THAT
// commit's update.mjs with leave to write here, so whatever had just been
// pushed upstream ran in the house's own repository before anybody looked):
//   - the updater that runs is THIS house's own (mcp/install/update.mjs, as
//     it was when the house was last updated), never the one that arrives.
//     It keeps .github, so what arrives cannot change this workflow either;
//   - the exact commit taken is fetched by its id, printed, and written into
//     the commit made here, with how to go back; the form takes a commit's id
//     for a household that wants one it has looked at, and takes the newest
//     when left empty;
//   - what changes is printed before it is committed, and the commit on
//     GitHub is the full difference.
// Still by hand only (workflow_dispatch): nothing reaches a house by itself.
export function updateWorkflow(source) {
  return `# Get the latest version of fmwax, keeping this house's own name and stores.
# Made by the house's setup page (Updates). To update: this repository's
# Actions tab, "Get the latest version", Run workflow. Cloudflare deploys the
# result as it deploys every push here. To go back: revert the commit this
# makes ("The latest version of fmwax"), and Cloudflare deploys the one before.
name: Get the latest version
on:
  workflow_dispatch:
    inputs:
      revision:
        description: "Optional: the exact commit of the public repository to take (its 40 characters). Empty: the newest."
        required: false
        default: ""
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
          REVISION: \${{ inputs.revision }}
        run: |
          if [ -n "$REVISION" ] && ! printf '%s' "$REVISION" | grep -Eq '^[0-9a-f]{40}$'; then echo "A revision is a commit's 40 characters, 0-9 and a-f."; exit 1; fi
          git init -q "$RUNNER_TEMP/latest"
          git -C "$RUNNER_TEMP/latest" fetch -q --depth 1 "$SOURCE" "\${REVISION:-HEAD}"
          git -C "$RUNNER_TEMP/latest" checkout -q FETCH_HEAD
          REV=$(git -C "$RUNNER_TEMP/latest" rev-parse HEAD)
          echo "Taking $SOURCE at $REV"
          node mcp/install/update.mjs "$RUNNER_TEMP/latest" .
          git add -A
          if git diff --cached --quiet; then echo "This house has the latest version already."; exit 0; fi
          echo "What changes:"; git diff --cached --stat | tail -n 60
          FROM=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).from.slice(0, 7))' "$RUNNER_TEMP/latest/.fmwax-copy")
          git -c user.name="fmwax update" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "The latest version of fmwax ($FROM)" -m "Taken from $SOURCE at $REV. To go back: revert this commit on GitHub, and Cloudflare deploys the version before it."
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
export async function latestVersion(env, now = Date.now(), source = updateSource(env)) {
  if (!source) return null;
  // The author's house reads its public copy (PUBLIC_COPY) under its own key.
  const key = source.slug === updateSource(env)?.slug ? LATEST_KEY : `${LATEST_KEY}:copy`;
  try {
    const kept = await programsKV(env).get(key, { type: "json" });
    if (kept?.from && now - kept.read < 3600e3) return { from: kept.from, day: DAY.test(kept.day ?? "") ? kept.day : null };
  } catch { /* read it again */ }
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${source.slug}/main/.fmwax-copy`, { headers: { "user-agent": "fmwax-house" } });
    if (!r.ok) return null;
    const copy = await r.json();
    const from = String(copy?.from ?? "");
    if (!/^[0-9a-f]{40}$/.test(from)) return null;
    const day = DAY.test(String(copy?.day ?? "")) ? copy.day : DAY.test(String(copy?.at ?? "").slice(0, 10)) ? String(copy.at).slice(0, 10) : null;
    try { await programsKV(env).put(key, JSON.stringify({ from, day, read: now }), { expirationTtl: 86400 }); } catch { /* read again next time */ }
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

// WHICH VERSION THIS HOUSE RUNS, AND GITHUB'S (2026-11-17, the owner: "is
// there a way to see what version we are running on the tv page... on the
// phone app and what version is on github?"). A copy's own (version.js)
// first; else the commit `npm run deploy` stamped (dev/deploy.mjs:
// HOUSE_COMMIT, a "+" when the app had changes not yet committed, and
// HOUSE_COMMIT_DAY), which is how the author's house knows its own.
const SHA = /^[0-9a-f]{40}$/;
export function houseVersion(env, { current = VERSION, currentDay = VERSION_DAY } = {}) {
  if (SHA.test(String(current ?? ""))) return { sha: current, day: DAY.test(currentDay ?? "") ? currentDay : null, stamped: false, changed: false };
  const m = /^([0-9a-f]{40})(\+?)$/.exec(String(env?.HOUSE_COMMIT ?? ""));
  if (!m) return null;
  return { sha: m[1], day: DAY.test(env.HOUSE_COMMIT_DAY ?? "") ? env.HOUSE_COMMIT_DAY : null, stamped: true, changed: m[2] === "+" };
}
// The one line both screens show, the House rules page's last and the foot
// of the TV's rooms screen: this house's version, then GitHub's. GitHub's is
// the public repository the house came from (SOURCE_REPO), or, in the
// author's house, the public copy made from it (PUBLIC_COPY). How far behind
// that copy is was counted at the deploy (HOUSE_AHEAD changes to the app
// since HOUSE_AHEAD_OF), and is said only while GitHub still has that copy.
// Null when the house knows no version of its own.
export async function versionLine(env, now = Date.now(), opts = {}) {
  const mine = houseVersion(env, opts);
  if (!mine) return null;
  const words = versionWords(mine.sha, mine.day);
  const own = `This house runs ${words}${mine.changed ? ", with changes not yet committed" : ""}.`;
  const copy = githubRepo(env?.PUBLIC_COPY);
  const source = updateSource(env) ?? copy;
  const newest = source ? await latestVersion(env, now, source).catch(() => null) : null;
  if (!newest?.from) return own;
  const theirs = versionWords(newest.from, newest.day);
  const ahead = Number(env?.HOUSE_AHEAD);
  const counted = !!copy && !updateSource(env) && env?.HOUSE_AHEAD_OF === newest.from && Number.isInteger(ahead) && ahead >= 0;
  const github = newest.from === mine.sha || (counted && ahead === 0) ? "GitHub has the same version."
    : counted ? `GitHub has ${theirs}, ${ahead} ${ahead === 1 ? "change" : "changes"} behind.`
    : mine.stamped ? `GitHub has ${theirs}.`
    : `GitHub has a newer version: ${theirs}.`;
  return `${own} ${github}`;
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
