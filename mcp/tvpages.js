// THE TV'S OTHER PAGES (MC-46, tasks/mc46-tv-page.md; the owner, 2026-11-15:
// "do all of them in your order"): the Shelf and a DJ's dials, each a page of
// its own reached from the TV page (tv.js) and going back to it. Both keep
// that page's rules, measured on the Bravia: every control a real button or
// link, the one in hand filled amber, nothing to type in, sizes in rem.
//
// THE SHELF: the programs as covers, newest first, six across. THE PAGE
// ITSELF SCROLLS, not a box inside it (the owner on the Bravia, 2026-11-15:
// the second row was cut off and nothing scrolled): a TV's browser scrolls a
// page by itself, with its cursor at the screen's edge or as focus moves. A cover is a form: its press is the
// Shelf's own Play (/notes/<key>/play) on the room the TV page showed, and it
// comes back to the TV page, which shows the cover large once it plays. Only
// Spotify programs start from here; a Tidal one is dim and says where it
// starts.
//
// THE DIALS, AS SLIDERS (the owner: "i dont like those dials.. can we do
// sliders?"). Each dial is a slider with a − and a + at its ends. The remote
// moves between those two buttons and OK steps the knob, because focus and OK
// are what was measured to work on the TV (whether the Left key reaches a
// page was never seen, so a slider that needs the arrows themselves was not
// built). The cursor can also press anywhere on the track. Apply is the Tune
// route's own POST (/<dj>/tune, tuning.js reads it), back to the TV page.
import { esc, SHAPE_LABELS, spkWords, talkScript } from "./programs.js";
import { TV_ARROWS_JS, TV_BASE_CSS, TV_I_BACK } from "./tv.js";

const HEAD = (title, css) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&display=swap">
<style>${TV_BASE_CSS}${css}
</style>
</head>
<body>`;

// "1:09:12" and "56:40" as the Shelf says a length on a TV: "1 h 09", "57 min".
export function tvRuntime(r) {
  const m = String(r ?? "").trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const mins = Math.round((Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) / 60);
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, "0")}` : `${mins} min`;
}

const SHELF_CSS = `
html,body{height:auto;overflow:visible}
html{overflow-y:auto;overflow-x:hidden;scroll-padding:5.5rem 0 1rem}
main.tvs{box-sizing:border-box;min-height:100vh;padding:0 1.75rem 1.5rem}
.shead{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:.875rem;padding:1.125rem 0 .75rem;background:var(--ground)}
.shead h1{margin:0;font-size:1.75rem;font-weight:800}
.shead .gap{flex:1}
.snote{margin:0;font-size:1rem;color:var(--ink-3)}.snote b{color:var(--ink)}
.sgrid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:.375rem .25rem}
.sgrid form{display:flex;min-width:0;margin:0}
.prog{box-sizing:border-box;width:100%;display:flex;flex-direction:column;gap:.375rem;padding:.4375rem;border-radius:.75rem;border:0;background:transparent;color:var(--ink);font:inherit;text-align:left;text-decoration:none;cursor:pointer;min-width:0}
div.prog{cursor:default;opacity:.5}
.pcover{position:relative;display:block;width:100%;padding-top:100%;border-radius:.5rem;background:var(--sleeve);overflow:hidden}
.pcover img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;display:block}
.pt{font-size:.875rem;font-weight:700;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;min-height:2.1rem}
.ps{font-size:.8125rem;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gnote{margin:2rem 0;font-size:1.1875rem;line-height:1.4;color:var(--ink-2);max-width:44rem}`;

// `rows`: { id, title, dj, runtime, catalog, image }, newest first. A press
// OPENS the program (its notes, with Play on them: the owner, 2026-11-16,
// "what if I want to listen to other music while reading programs?"), so
// nothing on the Shelf starts music. `action` is unused since then.
export function renderTvShelf({ base, room = null, rows = [], unreadable = false, reading = null }) {
  const back = `${base}/tv${room ? `?room=${encodeURIComponent(room.slug)}` : ""}`;
  // Every cover is asked for at once, none "lazy": on the Bravia the lazy
  // ones stayed blank (the owner's photo, 2026-11-15; not seen in a desktop
  // browser, so the cause is believed, not known).
  const cover = (r) => `<span class="pcover">${/^https:\/\//.test(String(r.image ?? "")) ? `<img src="${esc(r.image)}" alt="" decoding="async">` : ""}</span>`;
  const tile = (r) => {
    const cat = r.catalog ?? "spotify";
    const len = tvRuntime(r.runtime);
    const sub = cat === "tidal" ? "Tidal · from the phone" : cat === "files" ? "The archive" : [r.dj, len].filter(Boolean).join(" · ");
    return `
    <a class="prog" href="${esc(base)}/tv/notes/${esc(r.id)}?${room ? `room=${esc(encodeURIComponent(room.slug))}&amp;` : ""}from=shelf" data-f="p:${esc(r.id)}">${cover(r)}<span class="pt">${esc(r.title)}</span><span class="ps">${esc(sub)}</span></a>`;
  };
  const n = rows.length;
  return `${HEAD("The Shelf, on the TV", SHELF_CSS)}
<main class="tvs">
  <header class="shead" data-bar><a class="pill" data-f="back" href="${esc(back)}">${TV_I_BACK}Home</a><h1>The Shelf</h1><span class="gap"></span>` +
    `<p class="snote">${n} program${n === 1 ? "" : "s"}, newest first · a press opens one</p>` +
    // THE READING (readindex.js): the Shelf's other list, as on the phone.
    `${reading ? `<a class="pill" data-f="reading" href="${esc(base)}/tv/reading${room ? `?room=${esc(encodeURIComponent(room.slug))}` : ""}">Reading${reading.n ? ` · ${reading.n}` : ""}</a>` : ""}</header>
  ${unreadable ? `<p class="gnote">The Shelf could not be read just now. Try again in a moment.</p>`
    : n ? `<section class="sgrid" aria-label="Programs">${rows.map(tile).join("")}
  </section>` : `<p class="gnote">Nothing is on the Shelf yet. A set a DJ makes and you keep lands here.</p>`}
</main>
<script>
(function () {
  var main = document.querySelector("main.tvs"); if (!main) return;
  ${TV_ARROWS_JS}
  function home() { return main.querySelector("a.prog") || main.querySelector("a.pill"); }
  document.addEventListener("keydown", function (ev) {
    var dir = TV_DIRS[ev.key]; if (!dir || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    var was = document.activeElement;
    setTimeout(function () { if (document.activeElement === was) tvMove(main, dir, home); }, 0);
  });
  var el = home(); if (el) el.focus();
})();
</script>
</body>
</html>
`;
}

const TUNE_CSS = `
main.tvt{box-sizing:border-box;width:100vw;height:100vh;padding:1.125rem 2.5rem 1.25rem}
main.tvt form{height:100%;margin:0;display:flex;flex-direction:column;gap:.625rem}
.thead{display:flex;align-items:center;gap:.875rem;flex:0 0 auto}
.thead h1{margin:0;font-size:1.75rem;font-weight:800}
.thead .gap{flex:1}
.tsubl{margin:0;display:flex;align-items:center;gap:.5rem;font-size:.9375rem;color:var(--ink-3);flex:0 0 auto}
.ring{display:inline-block;box-sizing:border-box;width:.875rem;height:.875rem;border-radius:50%;border:.125rem solid var(--q-ink)}
.tlist{display:flex;flex-direction:column;justify-content:center;gap:.375rem;flex:1 1 auto;min-height:0}
.trow{display:grid;grid-template-columns:9rem 3rem minmax(0,1fr) 3rem 8.5rem;align-items:center;gap:.875rem;height:3.5rem}
.tk{font-size:1.125rem;font-weight:700}
.step{box-sizing:border-box;width:3rem;height:3rem;border-radius:50%;border:.125rem solid var(--rule);padding:0;background:transparent;color:var(--ink);font:inherit;font-size:1.625rem;font-weight:600;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer}
.sl{position:relative;height:3.5rem;margin:0 1rem;cursor:pointer}
.slbase,.slfill{position:absolute;top:1.125rem;height:.5rem;border-radius:999px}
.slbase{left:0;right:0;background:var(--rule)}
.slfill{left:0;background:var(--q-ink)}
.slstop{position:absolute;top:1.0625rem;width:.625rem;height:.625rem;margin-left:-.3125rem;border-radius:50%;background:#5A5E6A}
.slother{position:absolute;top:1rem;width:.75rem;height:.75rem;margin-left:-.375rem;border-radius:50%;background:var(--q-ink)}
.slknob{position:absolute;top:.4375rem;box-sizing:border-box;width:1.875rem;height:1.875rem;margin-left:-.9375rem;border-radius:50%;background:#FFFFFF;border:.25rem solid var(--ground);box-shadow:0 0 0 .125rem #FFFFFF}
.sllab{position:absolute;top:2.4375rem;font-size:.8125rem;color:var(--ink-3);white-space:nowrap;transform:translateX(-50%)}
.sllab.first{transform:none}.sllab.last{transform:translateX(-100%)}
.sllab.on{color:#FFFFFF;font-weight:800;font-size:.9375rem}
.sllab .ring{width:.625rem;height:.625rem;margin-right:.25rem;border-width:.09375rem}
.tval{font-size:1.25rem;font-weight:800;color:var(--ink)}
.tval.ch{color:var(--focus)}
.tfoot{display:flex;align-items:center;gap:1rem;flex:0 0 auto}
.tfine{margin:0;flex:1;font-size:.9375rem;color:var(--ink-3)}
.pill.apply{height:3rem;padding:0 1.5rem;font-size:1.0625rem;font-weight:700;background:var(--q-deep);border-color:var(--q-deep);color:var(--q-on-deep)}`;

const pct = (v, lo, hi) => (hi === lo ? 0 : ((v - lo) / (hi - lo)) * 100).toFixed(2);
const yearWord = (y, now) => (y >= now ? "now" : String(y));

// One slider: − , the track with its knob, +, what it says now, and the
// hidden field the form sends (a stop's place, or a year). THE KNOB IS THE
// ONE WHITE DISC ON THE TRACK and the track is lit up to it (the owner on the
// Bravia, 2026-11-15: the ring that marked the DJ's own stop read as the
// selection, "hard to tell what the active value is"); the DJ's own stop is
// a small ring before that stop's name instead. A year slider says its year
// under the knob, and shows the other end of the years as a small dot (the
// same "1990" under both ends of both sliders read as from and to being
// the same year).
function slider({ label, name, lo, hi, value, own, labels = null, now = 0, other = null }) {
  const says = labels ? labels[value] ?? "" : name === "years_to" ? yearWord(value, now) : String(value);
  const track = labels
    ? `<i class="slfill" style="width:${pct(value, lo, hi)}%"></i>` + labels.map((l, i) => `<i class="slstop" style="left:${pct(i, lo, hi)}%"></i>`).join("") +
      labels.map((l, i) => `<span class="sllab${i === 0 ? " first" : i === labels.length - 1 ? " last" : ""}${i === value ? " on" : ""}" style="left:${pct(i, lo, hi)}%">${i === own ? `<i class="ring" aria-hidden="true"></i>` : ""}${esc(l)}</span>`).join("")
    : `<i class="slfill"></i><i class="slother" style="left:${pct(other, lo, hi)}%"></i><span class="sllab on" data-at style="left:${pct(value, lo, hi)}%">${esc(says)}</span>`;
  return `
      <div class="trow" data-kind="${labels ? "stops" : "year"}" data-own="${own}"${labels ? ` data-labels="${esc(JSON.stringify(labels))}"` : ` data-now="${now}" data-by="${hi - lo > 30 ? 5 : 1}"`}>
        <span class="tk">${esc(label)}</span>
        <button type="button" class="step" data-step="-1" aria-label="${esc(label)}: down">−</button>
        <span class="sl" data-sl><i class="slbase"></i>${track}<i class="slknob" style="left:${pct(value, lo, hi)}%"></i></span>
        <button type="button" class="step" data-step="1" aria-label="${esc(label)}: up">+</button>
        <output class="tval${value !== own ? " ch" : ""}">${esc(says)}</output>
        <input type="hidden" name="${esc(name)}" value="${value}" data-min="${lo}" data-max="${hi}">
      </div>`;
}

// `dials` as tuning.js's tuneDials gives them; `action` the Tune route. The
// TV's Tune is only offered while that DJ plays, so it always applies (the
// route keeps the dials and says so when the DJ has stopped meanwhile).
export function renderTvTune({ base, room = null, dj, action, dials = [], runsLeft = 0 }) {
  const back = `${base}/tv${room ? `?room=${encodeURIComponent(room.slug)}` : ""}`;
  const rows = dials.map((d) => {
    if (d.id === "years") {
      const [lo, hi] = d.track, [a, b] = d.value;
      return slider({ label: "From the year", name: "years_from", lo, hi, value: a, own: lo, now: d.now, other: b }) +
        slider({ label: "To the year", name: "years_to", lo, hi, value: b, own: hi, now: d.now, other: a });
    }
    return slider({ label: d.name, name: d.id, lo: 0, hi: Math.max(1, d.labels.length - 1), value: d.value, own: d.ownAt, labels: d.labels });
  }).join("");
  const fine = runsLeft > 0 ? `Uses 1 of today's ${runsLeft} remaining DJ run${runsLeft === 1 ? "" : "s"}.`
    : "No DJ runs are left today: it is kept, and the next new songs follow it.";
  return `${HEAD(`Tune ${dj.name}, on the TV`, TUNE_CSS)}
<main class="tvt">
  <form method="post" action="${esc(action)}">
    <input type="hidden" name="do" value="apply"><input type="hidden" name="back" value="tv"><input type="hidden" name="room" value="${esc(room?.slug ?? "")}">
    <header class="thead"><a class="pill" data-f="back" href="${esc(back)}">${TV_I_BACK}Back</a><h1>Tune ${esc(dj.name)}</h1><span class="gap"></span><button type="button" class="pill" data-reset>Reset</button></header>
    <p class="tsubl">Press − or + to move a slider · <i class="ring" aria-hidden="true"></i>marks ${esc(dj.name)}'s own · changes start after this song</p>
    <div class="tlist">${rows}
    </div>
    <footer class="tfoot"><p class="tfine">${esc(fine)}</p><button type="submit" class="pill apply">Apply after this song</button></footer>
  </form>
</main>
<script>
(function () {
  var main = document.querySelector("main.tvt"); if (!main) return;
  ${TV_ARROWS_JS}
  function rows() { return Array.prototype.slice.call(main.querySelectorAll(".trow")); }
  function field(row) { return row.querySelector("input[type=hidden]"); }
  function num(el, a) { return Number(el.getAttribute(a)); }
  function at(v, lo, hi) { return (hi === lo ? 0 : (v - lo) / (hi - lo) * 100).toFixed(2) + "%"; }
  function year(name) { var i = main.querySelector('input[name="' + name + '"]'); return i ? Number(i.value) : null; }
  function draw(row) {
    var inp = field(row), v = Number(inp.value), lo = num(inp, "data-min"), hi = num(inp, "data-max"), out = row.querySelector("output");
    var fill = row.querySelector(".slfill");
    row.querySelector(".slknob").style.left = at(v, lo, hi);
    out.classList.toggle("ch", v !== num(row, "data-own"));
    if (row.getAttribute("data-kind") === "stops") {
      var labels = []; try { labels = JSON.parse(row.getAttribute("data-labels") || "[]"); } catch (e) {}
      out.textContent = labels[v] || "";
      fill.style.width = at(v, lo, hi);
      Array.prototype.forEach.call(row.querySelectorAll(".sllab"), function (l, i) { l.classList.toggle("on", i === v); });
    } else {
      var word = inp.name === "years_to" && v >= num(row, "data-now") ? "now" : String(v);
      out.textContent = word;
      /* The year under the knob, the other end as a dot, the years between lit. */
      var a = year("years_from"), b = year("years_to"), lab = row.querySelector("[data-at]"), dot = row.querySelector(".slother");
      lab.textContent = word; lab.style.left = at(v, lo, hi);
      if (a !== null && b !== null) {
        dot.style.left = at(inp.name === "years_to" ? a : b, lo, hi);
        fill.style.left = at(a, lo, hi); fill.style.width = ((b - a) / ((hi - lo) || 1) * 100).toFixed(2) + "%";
      }
    }
  }
  /* The years keep their order: from never passes to. */
  function put(row, v) {
    var inp = field(row), lo = num(inp, "data-min"), hi = num(inp, "data-max");
    if (inp.name === "years_from") hi = Math.min(hi, year("years_to"));
    if (inp.name === "years_to") lo = Math.max(lo, year("years_from"));
    inp.value = String(Math.max(lo, Math.min(hi, Math.round(v))));
    rows().forEach(draw);
  }
  main.addEventListener("click", function (ev) {
    var t = ev.target && ev.target.closest ? ev.target : null; if (!t) return;
    /* RESET puts every slider back on the DJ's own and sends nothing: Apply
       sends it (the review, 2026-11-16: Reset applied at once and used a
       DJ run, one press from Back). */
    if (t.closest("[data-reset]")) {
      rows().forEach(function (row) { field(row).value = String(num(row, "data-own")); });
      rows().forEach(draw); return;
    }
    var b = t.closest("[data-step]");
    if (b) {
      /* A press is one stop or one year; five years where a DJ's years run
         past thirty, landing on the fives. */
      var row = b.parentNode, cur = Number(field(row).value), d = Number(b.getAttribute("data-step")), by = num(row, "data-by") || 1;
      put(row, by > 1 ? (d > 0 ? Math.floor(cur / by) * by + by : Math.ceil(cur / by) * by - by) : cur + d); return;
    }
    var sl = t.closest("[data-sl]");
    if (sl) {
      var r = sl.getBoundingClientRect(), inp = field(sl.parentNode), lo = num(inp, "data-min"), hi = num(inp, "data-max");
      put(sl.parentNode, lo + (ev.clientX - r.left) / (r.width || 1) * (hi - lo));
    }
  });
  var form = main.querySelector("form");
  var apply = main.querySelector(".pill.apply"), applyWords = apply ? apply.textContent : "";
  form.addEventListener("submit", function (ev) {
    if (form.getAttribute("data-sent")) { ev.preventDefault(); return; }
    form.setAttribute("data-sent", "1");
    if (apply) apply.textContent = "Sending\u2026";
  });
  window.addEventListener("pageshow", function (ev) { if (ev.persisted) { form.removeAttribute("data-sent"); if (apply) apply.textContent = applyWords; } });
  function home() { return main.querySelector('.step[data-step="1"]') || main.querySelector("a.pill"); }
  document.addEventListener("keydown", function (ev) {
    var dir = TV_DIRS[ev.key]; if (!dir || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    var was = document.activeElement;
    setTimeout(function () { if (document.activeElement === was) tvMove(main, dir, home); }, 0);
  });
  rows().forEach(draw);
  var el = home(); if (el) el.focus();
})();
</script>
</body>
</html>
`;
}

// THE PROGRAM NOTES ON THE TV (the owner, 2026-11-15, from About this song:
// "maybe have button for full program notes"). The whole page the DJ wrote,
// set for reading from the couch: the title and the DJ's opening, every stop
// with its words and its songs, and the closing parts. It scrolls as a page;
// Page up and Page down turn it with OK and go dim at either end. The song
// that plays is marked, and "To the song" goes to its stop. Back returns to
// the display. Its bar is FIXED, not sticky (tv.js says why).
const NOTES_CSS = `
html,body{height:auto;overflow:visible}
html{overflow-y:auto;overflow-x:hidden;scroll-padding:5.5rem 0 1rem}
main.tvn{box-sizing:border-box;min-height:100vh;padding:5rem 3rem 3rem}
.nhead{position:fixed;top:0;left:0;right:0;z-index:1;display:flex;align-items:center;gap:.75rem;padding:1.125rem 3rem .875rem;background:var(--ground)}
.nhead .gap{flex:1}
.nhead .nt{margin:0;font-size:1.125rem;font-weight:700;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.nbody{max-width:46rem}
.nk{margin:1rem 0 .375rem;font-size:.875rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#E08A62}
h1.n1{margin:0 0 .75rem;font-size:2.25rem;font-weight:800;line-height:1.12}
.nstand{margin:0 0 1.5rem;font-family:Newsreader,Georgia,serif;font-size:1.5rem;line-height:1.45;color:var(--ink)}
.nstop{padding:1.25rem 0 .5rem;border-top:.125rem solid var(--rule)}
.nlab{margin:0 0 .375rem;font-size:.8125rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.nlab .now{display:inline-block;margin-left:.625rem;padding:.125rem .5rem;border-radius:999px;background:var(--q-deep);color:var(--q-on-deep);letter-spacing:.04em}
h2.nh{margin:0 0 .75rem;font-size:1.5rem;font-weight:800;line-height:1.2}
.np{margin:0 0 1rem;font-family:Newsreader,Georgia,serif;font-size:1.3125rem;line-height:1.55;color:var(--ink)}
.nsongs{margin:0 0 1rem;padding:0;list-style:none;display:flex;flex-direction:column;gap:.25rem}
.nsongs li{font-size:1rem;color:var(--ink-3)}
.nsongs li b{font-weight:600;color:var(--ink-2)}
.nsongs li.on{color:var(--q-ink)}.nsongs li.on b{color:#FFFFFF}
.nend{margin:2rem 0 0;font-size:1rem;color:var(--ink-3)}
.nplay{display:inline-flex;align-items:center;gap:.5rem;font-weight:800}
.nplay svg{width:1.125rem;height:1.125rem}
.nhead form{margin:0}
.nsaid{margin:0 0 .75rem;padding:.625rem .875rem;border-radius:.75rem;border:.125rem solid var(--focus);color:var(--focus);font-size:1rem;line-height:1.35}
.ntop{display:flex;gap:1.375rem;align-items:flex-start;margin:0 0 .25rem}
.ntop img{width:11rem;height:11rem;border-radius:.625rem;object-fit:cover;flex:0 0 auto;background:var(--sleeve)}
.ntop .nk{margin-top:0}
.nmeta{margin:0 0 1rem;font-size:.9375rem;color:var(--ink-3)}`;

const proseOf = (blocks) => (Array.isArray(blocks) ? blocks : [])
  .map((b) => String(typeof b === "string" ? b : b?.text ?? "").trim()).filter(Boolean);

// `rec` the program's record; `uri` the song playing, to mark; `dj` the
// writer's name as the house knows it now. Opened from the Shelf (`from`
// "shelf"), its way back is the Shelf and **Play on the <room>** leads its bar
// (`play`: the Shelf's own Play route and the program's id); after Play the
// page stays, saying what happened (`said`) with the first stop marked.
// `meta` the Shelf's listing of it: its cover and length.
export function renderTvNotes({ base, room = null, rec, uri = "", dj = null, from = "dis", play = null, noPlay = null, said = "", meta = null }) {
  const shelf = from === "shelf";
  const back = shelf ? `${base}/tv/shelf${room ? `?room=${encodeURIComponent(room.slug)}` : ""}`
    : `${base}/tv?${room ? `room=${encodeURIComponent(room.slug)}&` : ""}v=dis`;
  const labels = SHAPE_LABELS[rec?.shape] ?? SHAPE_LABELS.argument;
  const sections = Array.isArray(rec?.sections) ? rec.sections : [];
  const at = sections.findIndex((s) => (Array.isArray(s?.tracks) ? s.tracks : []).some((t) => t?.uri && t.uri === uri));
  const stop = (sec, i) => {
    const paras = proseOf(sec?.prose);
    const songs = (Array.isArray(sec?.tracks) ? sec.tracks : []).filter((t) => t?.title);
    if (!paras.length && !songs.length) return "";
    const label = [String(sec?.label ?? "").trim() || (paras.length ? `Part ${i + 1}` : ""), String(sec?.years ?? "").trim()].filter(Boolean).join(" · ");
    return `
    <section class="nstop" id="stop-${i + 1}">${label || i === at ? `
      <p class="nlab">${esc(label)}${i === at ? `<span class="now">Playing now</span>` : ""}</p>` : ""}${sec?.heading ? `
      <h2 class="nh">${esc(sec.heading)}</h2>` : ""}${paras.map((t) => `
      <p class="np">${esc(t)}</p>`).join("")}${songs.length ? `
      <ul class="nsongs" aria-label="The songs">${songs.map((t) => `<li${t.uri && t.uri === uri ? ' class="on"' : ""}><b>${esc(t.title)}</b>${t.artist ? ` · ${esc(t.artist)}` : ""}</li>`).join("")}</ul>` : ""}
    </section>`;
  };
  const closing = (blocks, title) => {
    const paras = proseOf(blocks);
    return paras.length ? `
    <section class="nstop">
      <h2 class="nh">${esc(title)}</h2>${paras.map((t) => `
      <p class="np">${esc(t)}</p>`).join("")}
    </section>` : "";
  };
  const title = String(rec?.title ?? "Program notes");
  const songsN = sections.reduce((n, sec) => n + (Array.isArray(sec?.tracks) ? sec.tracks.filter((t) => t?.title).length : 0), 0);
  const length = tvRuntime(meta?.runtime);
  const metaLine = [length, songsN ? `${songsN} song${songsN === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  const cover = shelf && /^https:\/\//.test(String(meta?.image ?? "")) ? `<img src="${esc(meta.image)}" alt="" decoding="async">` : "";
  const PLAY_I = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"></path></svg>`;
  const playBtn = play && room ? `<form method="post" action="${esc(play.action)}"><input type="hidden" name="slug" value="${esc(play.slug)}">` +
    `<input type="hidden" name="device" value="${esc(room.name)}"><input type="hidden" name="back" value="tvnotes">` +
    `<button type="submit" class="pill nplay" data-f="play"${said ? "" : " data-home"}>${PLAY_I}${at >= 0 ? "Play from the start" : `Play on the ${esc(room.name)}`}</button></form>` : "";
  return `${HEAD(`${title}, on the TV`, NOTES_CSS).replace("family=Archivo:wght@400;600;700;800&display=swap", "family=Archivo:wght@400;600;700;800&family=Newsreader:opsz,wght@6..72,400&display=swap")}
<main class="tvn">
  <header class="nhead" data-bar><a class="pill" data-f="back" href="${esc(back)}">${TV_I_BACK}${shelf ? "Shelf" : "Back"}</a>${playBtn}` +
    `${shelf ? "" : `<p class="nt">${esc(title)}</p>`}<span class="gap"></span>` +
    `${at >= 0 ? `<a class="pill" data-f="song" href="#stop-${at + 1}">To the song</a>` : ""}` +
    `<button type="button" class="pill" data-page="-1">Page up</button><button type="button" class="pill" data-page="1">Page down</button></header>
  <article class="nbody">${said ? `
    <p class="nsaid" role="status">${esc(said)}</p>` : ""}${noPlay ? `
    <p class="nmeta">${esc(noPlay)}</p>` : ""}${cover ? `
    <div class="ntop">${cover}<div>` : ""}
    <p class="nk">${esc([dj, labels.kind].filter(Boolean).join(" · "))}</p>
    <h1 class="n1">${esc(title)}</h1>${shelf && metaLine ? `
    <p class="nmeta">${esc(metaLine)}</p>` : ""}${cover ? `</div></div>` : ""}${rec?.thesis ? `
    <p class="nstand">${esc(rec.thesis)}</p>` : ""}${sections.map(stop).join("")}${closing(rec?.complications, labels.complications)}${closing(rec?.coda, labels.coda)}
    <p class="nend">The end of the notes.</p>
  </article>
</main>
<script>
(function () {
  var main = document.querySelector("main.tvn"); if (!main) return;
  var root = document.documentElement;
  ${TV_ARROWS_JS}
  function btn(d) { return main.querySelector('[data-page="' + d + '"]'); }
  function pages() {
    var y = window.pageYOffset || root.scrollTop || 0;
    btn(-1).disabled = y < 4;
    btn(1).disabled = y + window.innerHeight >= root.scrollHeight - 4;
    var a = document.activeElement;
    if (!a || a === document.body || a.disabled) { var n = !btn(1).disabled ? btn(1) : !btn(-1).disabled ? btn(-1) : main.querySelector("a.pill"); if (n) n.focus(); }
  }
  function turn(d) { tvTurn(main.querySelector(".nbody"), main.querySelector(".nhead"), d); setTimeout(pages, 300); }
  main.addEventListener("click", function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest("[data-page]") : null;
    if (b && !b.disabled) turn(Number(b.getAttribute("data-page")));
  });
  window.addEventListener("scroll", pages, { passive: true });
  window.addEventListener("resize", pages);
  function home() { return main.querySelector("[data-home]") || btn(1); }
  /* Play is sent once, and says it is on its way (the review, 2026-11-16:
     two quick OKs started the program twice). */
  main.addEventListener("submit", function (ev) {
    var f = ev.target, b = f && f.querySelector ? f.querySelector("button") : null;
    if (f.getAttribute("data-sent")) { ev.preventDefault(); return; }
    f.setAttribute("data-sent", "1");
    if (b) { b.setAttribute("data-was", b.lastChild ? b.lastChild.textContent : ""); if (b.lastChild) b.lastChild.textContent = "Starting\u2026"; }
  });
  window.addEventListener("pageshow", function (ev) {
    if (!ev.persisted) return;
    Array.prototype.forEach.call(main.querySelectorAll("form[data-sent]"), function (f) {
      f.removeAttribute("data-sent");
      var b = f.querySelector("button"); if (b && b.lastChild && b.hasAttribute("data-was")) b.lastChild.textContent = b.getAttribute("data-was");
    });
  });
  document.addEventListener("keydown", function (ev) {
    var dir = TV_DIRS[ev.key]; if (!dir || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    /* Up and down scroll the text; left and right move between the buttons. */
    if (dir === "up" || dir === "down") { tvScroll(dir === "down" ? 1 : -1, !!ev.repeat); ev.preventDefault(); return; }
    var was = document.activeElement;
    setTimeout(function () { if (document.activeElement === was) tvMove(main, dir, home); }, 0);
  });
  (main.querySelector("[data-home]") || btn(1)).focus(); pages();
})();
</script>
</body>
</html>
`;
}

// READ MORE (readmore.js; the owner's canvas "Read more on the TV",
// 2026-11-22). Two pages from About this song: the short list of the
// Guardian's pieces about the artist, and one piece, read as the program
// notes are read. Back from the piece is the list; back from the list is
// the song. Every piece says whose it is and where it lives.
const READ_CSS = `
html,body{height:auto;overflow:visible}
html{overflow-y:auto;overflow-x:hidden;scroll-padding:5.5rem 0 1rem}
main.tvr{box-sizing:border-box;min-height:100vh;padding:5.25rem 3rem 2rem}
.rhead{position:fixed;top:0;left:0;right:0;z-index:1;display:flex;align-items:center;gap:.875rem;padding:1.125rem 3rem .875rem;background:var(--ground)}
.rhead h1{margin:0;font-size:1.75rem;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.rhead .gap{flex:1}.rhead .rhint{margin:0;font-size:.9375rem;color:var(--ink-3);white-space:nowrap}
.rlbl{margin:.25rem 0 .625rem;font-size:.875rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--q-ink)}
.rlist{display:flex;flex-direction:column;gap:.5rem}
a.ritem{display:flex;align-items:center;gap:1.25rem;padding:.875rem 1.25rem;border-radius:.75rem;border:.125rem solid var(--raised);background:var(--raised);color:var(--ink);text-decoration:none}
.ritem .rk{flex:0 0 6.5rem;font-size:.8125rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--q-ink)}
.ritem .rw{flex:1;min-width:0;display:flex;flex-direction:column;gap:.1875rem}
.ritem .rt{font-size:1.25rem;font-weight:600;line-height:1.25}
.ritem .rm{font-size:.9375rem;color:var(--ink-2)}
.ritem .rgo{font-size:.9375rem;font-weight:600;color:var(--ink-2);white-space:nowrap}
.rfoot{margin:1.25rem 0 0;font-size:.875rem;color:var(--ink-3)}
.rlist+.rlbl,.rlist+.rfoot+.rlbl{margin-top:1.5rem}
.tvr a.ritem:focus{scroll-margin:7rem 0 2rem}
.rchips{display:flex;flex-wrap:wrap;gap:.75rem;margin:0 0 1rem}
.rchip b{font-weight:800;margin-left:.25rem}
.rchip.on{background:var(--q-deep);border-color:var(--q-deep);color:var(--q-on-deep)}
.rnote{margin:0 0 1rem;font-size:1.0625rem;color:var(--ink-2)}
.ritem.rart .rta{font-size:1.5rem;font-weight:800}
.ritem.rweb{background:transparent;border-color:var(--rule)}
.rwait{margin:0;font-size:1.125rem;line-height:1.45;color:var(--ink-2)}
.rsaid{margin:0 0 1rem;padding:.625rem .875rem;border-radius:.75rem;border:.125rem solid var(--focus);color:var(--focus);font-size:1rem;line-height:1.35}
.rask{margin:0;display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
.rask .rhint{font-size:.9375rem;color:var(--ink-3)}
.rcode{display:flex;align-items:center;justify-content:center;gap:4rem;min-height:calc(100vh - 9rem)}
.rqr{flex:0 0 auto;width:20rem;height:20rem;border-radius:1rem;overflow:hidden;background:#fff}
.rqr svg{display:block;width:100%;height:100%}
.rcw{max-width:32rem}
.rct{margin:0 0 1rem;font-size:1.875rem;font-weight:800;line-height:1.2}
.rcp{margin:0;font-size:1.25rem;line-height:1.5;color:var(--ink-2)}`;

// `song` and `songQ` (its query words) ride every link, so the list stays
// the one for the song it was opened from. `find` is where the song stands
// with the curator's web search (readfind.js): its pieces, each opening as a
// code for a phone; a search waiting; or the button that asks.
export function renderTvRead({ base, room = null, name = "", items = [], song = null, songQ = "", find = null, said = "" }) {
  const rq = room ? `room=${encodeURIComponent(room.slug)}&` : "";
  const back = `${base}/tv?${rq}v=dis`;
  const at = `${base}/tv/read?${rq}${songQ || `a=${encodeURIComponent(name)}`}`;
  let n = 0;
  const f = (extra = "") => `data-f="r${n}"${n++ === 0 ? " data-home" : ""}${extra}`;
  const row = (it) => `
    <a class="ritem" ${f()} href="${esc(`${at}&id=${encodeURIComponent(it.id)}`)}">` +
    `<span class="rk">${esc(it.kind)}</span><span class="rw"><span class="rt">${esc(it.title)}</span>` +
    `<span class="rm">${esc(["The Guardian", it.year, it.min ? `${it.min} min` : ""].filter(Boolean).join(" · "))}</span></span><span class="rgo">Read ›</span></a>`;
  const web = (it, i) => `
    <a class="ritem rweb" ${f()} href="${esc(`${at}&s=${encodeURIComponent(find.slug)}&x=${it.ix ?? i}`)}">` +
    `<span class="rk">${esc(it.kind)}</span><span class="rw"><span class="rt">${esc(it.title)}</span>` +
    `<span class="rm">${esc(it.line)}</span></span><span class="rgo">Phone ›</span></a>`;
  const guardian = items.length ? `
  <p class="rlbl">Read here on the TV</p>
  <div class="rlist">${items.map(row).join("")}
  </div>` : "";
  const found = find?.state === "found" ? `
  <p class="rlbl">On other sites · opens on your phone</p>
  <div class="rlist">${find.items.map(web).join("")}
  </div>` : "";
  const asked = find?.state === "asked" ? `
  <p class="rlbl">On other sites</p>
  <p class="rwait" data-wait>The curator is searching the web for ${esc(song?.title ? `“${song.title}”` : name)}. A few minutes: this page looks again by itself.</p>` : "";
  const none = find?.state === "none" ? `
  <p class="rfoot">The curator searched the web for this song and found nothing more worth listing.</p>` : "";
  const ask = find?.state === "ask" && song?.title ? `
  <p class="rlbl">On other sites</p>
  <form class="rask" method="post" action="${esc(base)}/readfind"><input type="hidden" name="t" value="${esc(song.title)}">` +
    `<input type="hidden" name="a" value="${esc(song.artist)}"><input type="hidden" name="al" value="${esc(song.album ?? "")}">` +
    `<input type="hidden" name="room" value="${esc(room?.slug ?? "")}">` +
    `<button type="submit" class="pill" ${f()}>Find articles and interviews</button>` +
    `<span class="rhint">The curator searches the web for this song. It takes a few minutes, once.</span></form>` : "";
  return `${HEAD(`Read more about ${name}, on the TV`, READ_CSS)}
<main class="tvr">
  <header class="rhead"><a class="pill" data-f="back" href="${esc(back)}">${TV_I_BACK}Back</a><h1>Read more about ${esc(name)}</h1><span class="gap"></span>` +
    `<p class="rhint">Up and down to choose · OK to open</p></header>${said ? `
  <p class="rsaid" role="status">${esc(said)}</p>` : ""}${guardian}${found}${asked}${ask}${none}${items.length ? `
  <p class="rfoot">Guardian articles courtesy of Guardian News &amp; Media Ltd. The music keeps playing while you read.</p>` : ""}
</main>
<script>
(function () {
  var main = document.querySelector("main.tvr"); if (!main) return;
  ${TV_ARROWS_JS}
  function home() { return main.querySelector("[data-home]") || main.querySelector("a.pill"); }
  document.addEventListener("keydown", function (ev) {
    var dir = TV_DIRS[ev.key]; if (!dir || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    var was = document.activeElement;
    setTimeout(function () { if (document.activeElement === was) tvMove(main, dir, home); }, 0);
  });
  var form = main.querySelector("form.rask");
  if (form) form.addEventListener("submit", function (ev) {
    if (form.getAttribute("data-sent")) { ev.preventDefault(); return; }
    form.setAttribute("data-sent", "1"); form.querySelector("button").textContent = "Asking…";
  });
  /* A search is waiting: the page asks for itself again each minute, without
     the answer's words, until the pieces are here. */
  if (main.querySelector("[data-wait]")) setTimeout(function () { location.replace(location.href.replace(/&fc=[a-z-]+/, "")); }, 60000);
  var el = home(); if (el) el.focus();
})();
</script>
</body>
</html>
`;
}

// ALL THE READING, ON THE TV, BY DJ (readindex.js; the canvas "Reading by
// DJ", its TV row): the phone's list, read only. The DJ chips across the top,
// one row per artist; an artist opens to its pieces. A Guardian piece is read
// on the TV, a piece on another site opens as a code for a phone; both come
// back to the artist. No search (the remote has no keyboard), no keep or
// remove: those are the phone's.
const TVR_JS = (main) => `
<script>
(function () {
  var main = document.querySelector("${main}"); if (!main) return;
  ${TV_ARROWS_JS}
  function home() { return main.querySelector("[data-home]") || main.querySelector("a.pill"); }
  document.addEventListener("keydown", function (ev) {
    var dir = TV_DIRS[ev.key]; if (!dir || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    var was = document.activeElement;
    setTimeout(function () { if (document.activeElement === was) tvMove(main, dir, home); }, 0);
  });
  /* Back from what a row opened: that row, so a long list is not walked again. */
  var el = null, k = null, page = main.getAttribute("data-page") || "";
  try { k = sessionStorage.getItem("tv:reading"); sessionStorage.removeItem("tv:reading"); } catch (e) {}
  if (k && k.indexOf(page + "|") === 0) { var f = k.slice(page.length + 1); el = main.querySelector('[data-f="' + f.replace(/["\\\\]/g, "") + '"]'); }
  main.addEventListener("click", function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest("a.ritem") : null;
    if (a) { try { sessionStorage.setItem("tv:reading", page + "|" + a.getAttribute("data-f")); } catch (e) {} }
  });
  el = el || home(); if (el) el.focus();
})();
</script>
</body>
</html>
`;

export function renderTvReading({ base, room = null, dj = "", view = null, n = 0, unreadable = false, djName = (k) => k }) {
  const rq = room ? `room=${encodeURIComponent(room.slug)}` : "";
  const at = (o) => `${base}/tv/reading?${[rq, ...Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`)].filter(Boolean).join("&")}`;
  const back = `${base}/tv/shelf${room ? `?room=${encodeURIComponent(room.slug)}` : ""}`;
  const chip = (key, label, count) => `<a class="pill rchip${key === dj ? " on" : ""}" data-f="c:${esc(key || "all")}" href="${esc(at({ dj: key }))}"${key === dj ? ` aria-current="page"` : ""}>${esc(label)} <b>${count}</b></a>`;
  const note = dj === "none" ? "Songs the house can't tie to a DJ: an album, the Spotify app or Talk." : dj ? `Artists ${djName(dj)} played, with something to read. Newest first.` : "Every artist with something to read, newest first.";
  const rows = (view?.artists ?? []).map((a, i) => `
    <a class="ritem rart" data-f="a:${esc(a.key)}"${i === 0 ? " data-home" : ""} href="${esc(at({ dj, a: a.key }))}"><span class="rw"><span class="rt rta">${esc(a.name)}</span>` +
    `<span class="rm">${esc([a.summary, a.sub].filter(Boolean).join(" · "))}</span></span><span class="rgo">Open ›</span></a>`).join("");
  return `${HEAD("Reading, on the TV", READ_CSS)}
<main class="tvr" data-page="list:${esc(dj)}">
  <header class="rhead"><a class="pill" data-f="back" href="${esc(back)}">${TV_I_BACK}Shelf</a><h1>Reading</h1><span class="gap"></span>` +
    `<p class="rhint">Left and right: the DJs · Down: their artists · OK to open</p></header>${n && view ? `
  <nav class="rchips" aria-label="DJs">${chip("", "All", view.all)}${view.chips.map((c) => chip(c.key, djName(c.key), c.n)).join("")}${view.none ? chip("none", "Not from a DJ", view.none) : ""}</nav>
  <p class="rnote">${esc(note)}</p>
  <div class="rlist">${rows}
  </div>
  <p class="rfoot">To search, keep or remove pieces, use the Shelf's Reading on the phone.</p>` : unreadable ? `
  <p class="rfoot" role="status">The reading could not be read just now. Try again in a moment.</p>` : `
  <p class="rfoot">Nothing to read yet. Pieces about the artists this house plays are kept here as they are found; a search is asked for from About this song.</p>`}
</main>${TVR_JS("main.tvr")}`;
}

export function renderTvReadingArtist({ base, room = null, dj = "", artist, djName = (k) => k }) {
  const rq = room ? `room=${encodeURIComponent(room.slug)}&` : "";
  const scope = dj === "none" ? "Not from a DJ" : dj ? djName(dj) : "All";
  const back = `${base}/tv/reading?${rq}${dj ? `dj=${encodeURIComponent(dj)}` : ""}`.replace(/[?&]$/, "");
  let i = 0;
  const row = (it) => {
    const g = (it.from ?? it.source) === "guardian";
    return `
    <a class="ritem${g ? "" : " rweb"}" data-f="p:${i}"${i++ === 0 ? " data-home" : ""} href="${esc(`${base}/tv/read?${rq}from=reading${dj ? `&rd=${encodeURIComponent(dj)}` : ""}&ra=${encodeURIComponent(artist.key)}&k=${encodeURIComponent(it.pk)}`)}">` +
      `<span class="rk">${esc(it.kind ?? "")}</span><span class="rw"><span class="rt">${esc(it.title)}</span><span class="rm">${esc(it.line)}</span></span>` +
      `<span class="rgo">${g ? "Read ›" : "Phone ›"}</span></a>`;
  };
  const label = (b) => (b.source === "web" ? `${b.song || "A song"} · your search · opens on your phone` : b.source === "guardian" ? "The Guardian · read here" : "Kept");
  const played = artist.djs.length ? `Played by ${artist.djs.map(djName).join(" and ")}.` : "Not from a DJ: an album, the Spotify app or Talk.";
  return `${HEAD(`${artist.name}, on the TV`, READ_CSS)}
<main class="tvr" data-page="artist:${esc(artist.key)}">
  <header class="rhead"><a class="pill" data-f="back" href="${esc(back)}">${TV_I_BACK}${esc(scope)}</a><h1>${esc(artist.name)}</h1><span class="gap"></span>` +
    `<p class="rhint">Up and down to choose · OK to open</p></header>
  <p class="rnote">${esc(played)}</p>${artist.blocks.map((b) => `
  <p class="rlbl">${esc(label(b))}</p>
  <div class="rlist">${b.items.map(row).join("")}
  </div>`).join("")}
</main>${TVR_JS("main.tvr")}`;
}

// A PIECE ON ANOTHER SITE, AS A CODE (qr.js): the TV app opens the house's
// own pages only, so a phone's camera opens the piece.
export function renderTvCode({ back, item, line = "", svg = "" }) {
  let host = "";
  try { host = new URL(item.url).hostname.replace(/^www\./, ""); } catch { host = ""; }
  return `${HEAD(`${item.title}, on your phone`, READ_CSS)}
<main class="tvr">
  <header class="rhead"><a class="pill" data-f="back" data-home href="${esc(back)}">${TV_I_BACK}Back</a><h1>Read it on your phone</h1></header>
  <div class="rcode">${svg ? `<div class="rqr">${svg}</div>` : ""}
    <div class="rcw"><p class="rlbl">${esc(line)}</p>
      <p class="rct">${esc(item.title)}</p>
      <p class="rcp">${svg ? "Point your phone's camera at the code. The piece opens on its own site, in your phone's browser."
        : "This piece's address is too long for a code. It is in About this song on the phone."}</p>
      <p class="rfoot">${esc(host)}${item.paywalled ? " · this site may ask for a subscription" : ""}</p></div>
  </div>
</main>
<script>
(function () {
  var main = document.querySelector("main.tvr"); if (!main) return;
  var b = main.querySelector("[data-home]"); if (b) b.focus();
})();
</script>
</body>
</html>
`;
}

export function renderTvPiece({ back, piece }) {
  const line = ["The Guardian", piece.by, piece.year, piece.min ? `${piece.min} min` : ""].filter(Boolean).join(" · ");
  return `${HEAD(`${piece.title}, on the TV`, NOTES_CSS).replace("family=Archivo:wght@400;600;700;800&display=swap", "family=Archivo:wght@400;600;700;800&family=Newsreader:opsz,wght@6..72,400&display=swap")}
<main class="tvn">
  <header class="nhead" data-bar><a class="pill" data-f="back" href="${esc(back)}">${TV_I_BACK}Back</a>` +
    `<p class="nt">${esc(line)}</p><span class="gap"></span>` +
    `<button type="button" class="pill" data-page="-1">Page up</button><button type="button" class="pill" data-page="1" data-home>Page down</button></header>
  <article class="nbody">
    <p class="nk">${esc(piece.kind || "From the Guardian")}</p>
    <h1 class="n1">${esc(piece.title)}</h1>${piece.stand ? `
    <p class="nstand">${esc(piece.stand)}</p>` : ""}${piece.body.map((b) => b.h ? `
    <h2 class="nh">${esc(b.h)}</h2>` : `
    <p class="np">${esc(b.p)}</p>`).join("")}
    <p class="nend">Courtesy of Guardian News &amp; Media Ltd. Read it on the Guardian: ${esc(piece.url.replace(/^https:\/\/www\./, ""))}</p>
  </article>
</main>
<script>
(function () {
  var main = document.querySelector("main.tvn"); if (!main) return;
  var root = document.documentElement;
  ${TV_ARROWS_JS}
  function btn(d) { return main.querySelector('[data-page="' + d + '"]'); }
  function pages() {
    var y = window.pageYOffset || root.scrollTop || 0;
    btn(-1).disabled = y < 4;
    btn(1).disabled = y + window.innerHeight >= root.scrollHeight - 4;
    var a = document.activeElement;
    if (!a || a === document.body || a.disabled) { var n = !btn(1).disabled ? btn(1) : !btn(-1).disabled ? btn(-1) : main.querySelector("a.pill"); if (n) n.focus(); }
  }
  function turn(d) { tvTurn(main.querySelector(".nbody"), main.querySelector(".nhead"), d); setTimeout(pages, 300); }
  main.addEventListener("click", function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest("[data-page]") : null;
    if (b && !b.disabled) turn(Number(b.getAttribute("data-page")));
  });
  window.addEventListener("scroll", pages, { passive: true });
  window.addEventListener("resize", pages);
  function home() { return btn(1); }
  document.addEventListener("keydown", function (ev) {
    var dir = TV_DIRS[ev.key]; if (!dir || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (dir === "up" || dir === "down") { tvScroll(dir === "down" ? 1 : -1, !!ev.repeat); ev.preventDefault(); return; }
    var was = document.activeElement;
    setTimeout(function () { if (document.activeElement === was) tvMove(main, dir, home); }, 0);
  });
  btn(1).focus(); pages();
})();
</script>
</body>
</html>
`;
}

// THE DJS ON THE TV (tvdj.js; the owner's canvas "fmwax on the TV, the DJs",
// 2026-11-16; redrawn that evening, boards 6 and 8, the owner: "1. A 2. yes").
// The list: every DJ as their own sleeve (art/covers, the cover their
// playlist wears in Spotify and WiiM Home, served by …/tv/face/<dj>.jpg), in
// three groups. A DJ's screen ALWAYS FITS the screen (the owner's photo: the
// last asks pushed the steering row off it): the ideas and the last asks are
// rows of one line, a fixed number of each, and nothing on it grows. The
// settings are buttons, remembered for that DJ on this TV in a cookie the
// page's script writes; the Guide key's voice search goes to the DJ whose
// screen is open. Every press is a form to the house; the answer shows on the
// TV page.
const DJ_CSS = `
main.tvd{box-sizing:border-box;width:100vw;padding:1.125rem 1.75rem 1.25rem;display:flex;flex-direction:column;gap:.75rem}
main.tvd.one{height:100vh;overflow:hidden}
.dhead{display:flex;align-items:center;gap:.875rem;flex:0 0 auto;min-height:3.5rem}
.dhead h1{margin:0;font-size:1.75rem;font-weight:800}
.dhead .gap{flex:1}
.dnote{margin:0;font-size:1rem;color:var(--ink-3)}.dnote b{color:var(--ink)}
.glabel{margin:0;font-size:.8125rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dgrid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:.5rem .625rem}
.tvd.list{--tw:calc((100vw - 3.5rem - 1.25rem - 3.125rem) / 6);gap:.625rem}
.tvd.list .dhead{min-height:0}
.dband{box-sizing:border-box;border:.125rem solid var(--rule);border-radius:.875rem;padding:.5rem;background:var(--raised);min-width:0}
.dband .glabel{margin:0 0 .3125rem .25rem}
.dband .dgrid{grid-template-columns:repeat(var(--n),var(--tw));gap:.625rem}
.dpair{display:flex;gap:.75rem;align-items:stretch}
.dtile{box-sizing:border-box;display:flex;flex-direction:column;gap:.375rem;padding:.25rem;border-radius:.75rem;border:.125rem solid transparent;color:var(--ink);text-decoration:none;min-width:0}
.dtile.on{border-color:var(--q-ink)}
.sleeve{position:relative;display:block;width:100%;padding-top:100%;border-radius:.5rem;overflow:hidden}
.sleeve .sn{position:absolute;left:.625rem;right:.625rem;bottom:.625rem;font-family:Georgia,serif;font-size:1.25rem;font-weight:700;line-height:1.05}
.sleeve img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;display:block}
.sleeve.mini{width:3.5rem;height:3.5rem;padding-top:0;flex:0 0 auto}
.sleeve.mini .sn{display:none}
.dwhat{display:flex;align-items:center;gap:.3125rem;padding:0 .125rem;font-size:.875rem;font-weight:600;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dwhat svg{width:.8125rem;height:.8125rem;flex:0 0 auto}
.dtile.on .dwhat{color:var(--q-ink);font-weight:700}
.dtile:focus .dwhat{color:#131417}
.who{display:flex;flex-direction:column;gap:.125rem;min-width:0}
.who h1{line-height:1.1}
.who p{margin:0;font-size:.875rem;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.status{margin:0;display:inline-flex;align-items:center;gap:.375rem;padding:.375rem .75rem;border-radius:999px;background:var(--raised);border:.125rem solid var(--rule);font-size:.875rem;color:var(--ink-2);white-space:nowrap;max-width:22rem;overflow:hidden;text-overflow:ellipsis}
.status.on{background:var(--q-deep);border-color:var(--q-deep);color:var(--q-on-deep);font-weight:700}
.status svg{width:.875rem;height:.875rem;flex:0 0 auto}
.body{display:grid;grid-template-columns:minmax(0,1fr) 18.75rem;gap:1.125rem;flex:1 1 auto;min-height:0;overflow:hidden}
.body.two{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:auto minmax(0,1fr);row-gap:.5rem}
.col{display:flex;flex-direction:column;gap:.375rem;min-width:0;min-height:0;overflow:hidden}
.sayit{display:flex;align-items:center;gap:.625rem;margin:0 0 .125rem;min-height:2rem;font-size:1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 0 auto}
.body.two .sayit{grid-column:1/-1}
.sayit .mic{width:2rem;height:2rem;border-radius:50%;background:var(--q-deep);color:var(--q-on-deep);display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
.sayit .mic svg{width:1.0625rem;height:1.0625rem}
.sayit span.ex{color:var(--ink-2)}
.lrow{display:flex;align-items:center;gap:.625rem;min-height:2rem;flex:0 0 auto}
.lrow .glabel{flex:1 1 auto}
.lrow.gap{margin-top:.375rem}
.col form{margin:0;flex:0 0 auto}
.idea{box-sizing:border-box;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;width:100%;min-height:4.5rem;max-height:4.5rem;padding:.625rem 1rem;border-radius:.875rem;border:.125rem solid var(--rule);background:var(--raised);color:var(--ink);font:inherit;font-size:1.125rem;font-weight:700;line-height:1.3;text-align:left;overflow:hidden;cursor:pointer}
.col form{margin:0;flex:0 0 auto}
.body.one{grid-template-columns:minmax(0,1fr)}
.ideas3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem}
.ideas3 .idea{min-height:5.25rem;max-height:5.25rem;-webkit-line-clamp:3}
.alt{box-sizing:border-box;height:2rem;padding:0 .875rem;border-radius:999px;border:.125rem solid var(--q-ink);background:transparent;color:var(--q-ink);font:inherit;font-size:.875rem;font-weight:700;white-space:nowrap;cursor:pointer}
.big{box-sizing:border-box;width:100%;display:flex;flex-direction:column;align-items:flex-start;gap:.25rem;padding:.75rem 1rem;border-radius:.875rem;border:.125rem solid var(--rule);background:var(--raised);color:var(--ink);font:inherit;text-align:left;cursor:pointer}
.big b{font-size:1.25rem;font-weight:800}
.big span{font-size:.875rem;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.big:focus span{color:#3A2E0E}
.bigs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem;flex:0 0 auto}
.bigs form{margin:0;display:flex}
.sets{display:flex;flex-direction:column;gap:.25rem;padding:.75rem;border-radius:.875rem;background:var(--raised);border:.125rem solid var(--rule);min-width:0;align-self:start}
.sets p.sl{margin:.25rem 0 0;font-size:.8125rem;font-weight:600}
.seg{display:flex;gap:.375rem}
.seg button{flex:1;height:2.25rem;padding:0 .25rem;border-radius:999px;border:.125rem solid var(--rule);background:transparent;color:var(--ink);font:inherit;font-size:.8125rem;font-weight:600;white-space:nowrap;cursor:pointer}
.seg button[aria-pressed=true]{background:var(--q-deep);border-color:var(--q-deep);color:var(--q-on-deep);font-weight:700}
.sets .fine{margin:.5rem 0 0;font-size:.8125rem;color:var(--ink-3)}
.steer{display:flex;align-items:center;gap:.625rem;height:3.25rem;box-sizing:border-box;padding:0 .375rem 0 .875rem;border-radius:.875rem;background:var(--raised);border:.125rem solid var(--rule);flex:0 0 auto}
.steer p{margin:0;font-size:.875rem;color:var(--ink-3);flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.steer form{margin:0}
.steer .pill{height:2.5rem}
.round{box-sizing:border-box;width:2.5rem;height:2.5rem;border-radius:50%;border:.125rem solid var(--rule);color:var(--ink);display:inline-flex;align-items:center;justify-content:center;text-decoration:none;flex:0 0 auto}
.round svg{width:1.25rem;height:1.25rem}`;
// The list may be longer than a screen (a house with more DJs): it scrolls
// as a page, as the Shelf does.
const DJS_SCROLL = `
html,body{height:auto;overflow:visible}
html{overflow-y:auto;overflow-x:hidden;scroll-padding:1rem 0}`;

// A DJ's sleeve: the house's own cover of them, over their colours and name
// (what shows if the picture cannot be had).
const sleeve = (base, d, cls = "sleeve") => `<span class="${cls}" style="background:${esc(d.colour?.field ?? "#2B2B30")};color:${esc(d.colour?.ink ?? "#E9E8E3")}" aria-hidden="true">` +
  `<span class="sn">${esc(d.name)}</span><img src="${esc(base)}/tv/face/${esc(d.key)}.jpg" alt="" decoding="async"></span>`;
const BARS = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7" stroke="currentColor" stroke-width="3" stroke-linecap="round"></path></svg>`;
// The DJ whose screen is open, for TV Bro's voice search: the house sets it
// with the screen and clears it with the list and the TV page; a page shown
// again from the browser's history (the remote's Back) says it again here.
const djCookieJs = (key) => key
  ? `try { document.cookie = "tvdj=" + ${JSON.stringify(key)} + "; Path=/; Max-Age=1800; SameSite=Lax; Secure"; } catch (e) {}`
  : `try { document.cookie = "tvdj=; Path=/; Max-Age=0; SameSite=Lax; Secure"; } catch (e) {}`;
const DJ_SCRIPT = (extra = "", key = null) => `<script>
(function () {
  var main = document.querySelector("main.tvd"); if (!main) return;
  ${TV_ARROWS_JS}
  function home() { return main.querySelector("[data-home]") || main.querySelector(".col button") || main.querySelector("a.pill"); }
  ${extra}
  /* A press is sent once, and says it is on its way (a DJ can take a few
     seconds to answer). */
  function label(b) { return b ? (b.querySelector("span") || b) : null; }
  main.addEventListener("submit", function (ev) {
    var f = ev.target; if (f.getAttribute("data-sent")) { ev.preventDefault(); return; }
    f.setAttribute("data-sent", "1");
    var l = label(f.querySelector("button"));
    if (l) { l.setAttribute("data-was", l.textContent); l.textContent = "Sending\u2026"; }
  });
  window.addEventListener("pageshow", function (ev) {
    ${djCookieJs(key)}
    if (ev.persisted) Array.prototype.forEach.call(main.querySelectorAll("form[data-sent]"), function (f) {
      f.removeAttribute("data-sent");
      var l = label(f.querySelector("button")); if (l && l.hasAttribute("data-was")) l.textContent = l.getAttribute("data-was");
    });
  });
  document.addEventListener("keydown", function (ev) {
    var dir = TV_DIRS[ev.key]; if (!dir || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    var was = document.activeElement;
    setTimeout(function () { if (document.activeElement === was) tvMove(main, dir, home); }, 0);
  });
  var el = home(); if (el) el.focus();
})();
</script>`;

// The list. `groups` from tvdj.js tvDjList. EACH GROUP IN A BAND OF ITS OWN
// (the owner, 2026-11-16: "a narrow band around [each] group ... to visually
// separate the different djs and functionality"): the DJs on a preset of
// their own, the guest DJs who take turns on the guest preset, the writers.
// Every tile is the same width whatever band it is in.
export function renderTvDjs({ base, room = null, groups }) {
  const q = room ? `?room=${encodeURIComponent(room.slug)}` : "";
  let first = true;
  const tile = (d) => {
    const t = `
      <a class="dtile${d.playing ? " on" : ""}" href="${esc(base)}/tv/dj/${esc(d.key)}${esc(q)}" data-f="dj:${esc(d.key)}" aria-label="${esc(d.name)}"${first ? " data-home" : ""}>${sleeve(base, d)}` +
      `<span class="dwhat">${d.playing ? `${BARS}${esc(d.btn ? `${d.btn} · Playing` : `${d.what} · Playing`)}` : esc(d.what)}</span></a>`;
    first = false;
    return t;
  };
  const band = (label, list) => `
    <section class="dband" aria-label="${esc(label)}"><p class="glabel">${esc(label)}</p>` +
    `<div class="dgrid" style="--n:${Math.min(6, list.length)}">${list.map(tile).join("")}
    </div></section>`;
  const g = groups.guests.length, w = groups.writers.length;
  const guestWords = `Guest DJs · take turns on ${groups.laneBtn ? `preset ${groups.laneBtn}` : "the guest preset"}`;
  const writerWords = "Writers · a set, a page if kept";
  // The house DJs first, so the first of them is the one in hand.
  const houseBand = groups.house.length ? band("On their own preset", groups.house) : "";
  const pair = [g ? band(guestWords, groups.guests) : "", w ? band(writerWords, groups.writers) : ""].join("");
  // Guests and writers side by side while they fit in a row of six.
  const rest = !g && !w ? "" : g + w <= 6 ? `
  <div class="dpair">${pair}
  </div>` : pair;
  return `${HEAD("The DJs, on the TV", DJ_CSS + DJS_SCROLL)}
<main class="tvd list">
  <header class="dhead"><a class="pill" data-f="back" href="${esc(base)}/tv${esc(q)}">${TV_I_BACK}Home</a><h1>DJs</h1><span class="gap"></span>` +
    `${room ? `<p class="dnote">plays on the <b>${esc(room.name)}</b></p>` : ""}</header>${houseBand}${rest}
</main>
${DJ_SCRIPT()}
</body>
</html>
`;
}

const MIC = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>`;
const SLIDERS = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="2"></circle><circle cx="10" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="2"></circle></svg>`;

// How many rows of each a DJ's screen holds, so that it always fits: a
// writer's and a guest's beside their settings, a house DJ's in two columns
// under Play and Start fresh.
export const TV_DJ_ROWS = { ideas: 3 };

// One DJ's screen. `d` from tvdj.js tvDjFacts; `set` their settings on this
// TV; `action` the house's address for a press; `tune` Tune's address, or null.
export function renderTvDj({ base, room = null, d, set, action, tune = null }) {
  const q = room ? `?room=${encodeURIComponent(room.slug)}` : "";
  const hidden = `<input type="hidden" name="room" value="${esc(room?.slug ?? "")}">`;
  const press = (act, label, { words = "", cls = "idea", home = false, title = "" } = {}) =>
    `<form method="post" action="${esc(action)}"><input type="hidden" name="do" value="${esc(act)}">${words ? `<input type="hidden" name="words" value="${esc(words)}">` : ""}${hidden}` +
    `<button type="submit" class="${cls}"${home ? " data-home" : ""}${title ? ` title="${esc(title)}"` : ""}>${label}</button></form>`;
  const kind = d.kind;
  const status = d.playing ? `<p class="status on">${BARS}Playing${d.playingOn ? ` on the ${esc(d.playingOn)}` : ""}</p>`
    : kind === "guest" && d.laneWords ? `<p class="status">On preset ${esc(String(d.laneBtn ?? 3))} now: <b>${esc(d.laneWords)}</b></p>` : "";
  const sub = kind === "house" ? `House DJ · preset ${d.btn}${d.summary ? ` · ${d.summary}` : ""}`
    : kind === "guest" ? `Guest DJ · endless on preset ${d.laneBtn ?? 3}${d.needs ? ` · needs ${d.needs}` : ""}`
    : `Writer · a set with notes, on the Requests preset`;
  const say = kind === "house"
    ? `Press <b>Guide</b> and say ${d.playing ? "which way" : "what you'd like"}, or press one: <span class="ex">“more upbeat”, “no ballads”</span>`
    : kind === "guest"
      ? `Press <b>Guide</b> and say ${d.needs ? esc(d.needs) : "what you'd like"}, or press one`
      : `Press <b>Guide</b> and say what it's about, or press one`;
  const seg = (name, opts) => `<div class="seg" role="group" data-set="${esc(name)}">${opts.map(([v, label]) =>
    `<button type="button" data-v="${esc(String(v))}" aria-pressed="${String(set[name]) === String(v)}">${esc(label)}</button>`).join("")}</div>`;
  const sets = kind === "writer" ? `
    <aside class="sets" aria-label="How">
      <p class="sl">Length</p>${seg("len", [[30, "30 min"], [60, "1 hour"], [90, "90 min"], [120, "2 hours"]])}
      <p class="sl">Notes</p>${seg("notes", [["short", "Short"], ["long", "Long read"]])}
      <p class="sl">Keep it on the Shelf</p>${seg("keep", [[true, "Yes"], [false, "No"]])}
      <p class="sl">Play when ready</p>${seg("start", [[true, "On"], [false, "Off"]])}${d.services ? `
      <p class="sl">On</p>${seg("svc", d.services.map((x) => [x.key, `${x.key === "tidal" ? "Tidal" : "Spotify"} · ${x.btn}`]))}` : ""}
      <p class="fine">Remembered for ${esc(d.name)} on this TV.</p>
    </aside>` : kind === "guest" ? `
    <aside class="sets" aria-label="How">
      <p class="sl">Endless, on preset ${esc(String(d.laneBtn ?? 3))}</p>
      <p class="sl">If another guest DJ is playing</p>${seg("when", [["next", "After the song"], ["now", "Now"]])}
      <p class="fine">Remembered for ${esc(d.name)} on this TV.</p>
    </aside>` : "";
  // THE IDEAS, AS LARGER CARDS OF UP TO TWO LINES (the owner, 2026-11-16,
  // board 11, A: the last asks gone, "to free up room"): the guest preset's
  // neighbours while this guest holds it, otherwise the DJ's own; three.
  const ideaList = (d.near?.list?.length ? d.near.list : d.ideas).slice(0, TV_DJ_ROWS.ideas);
  const ideaLabel = d.near?.list?.length ? d.near.label : `${d.name}'s ideas`;
  const cards = ideaList.map((w, i) => press("words", esc(w), { words: w, cls: "idea", title: w, home: i === 0 && kind !== "house" })).join("");
  const surprise = kind !== "house" ? press("surprise", "Surprise me", { cls: "alt" }) : "";
  const ideasHead = ideaList.length || surprise ? `<div class="lrow"><p class="glabel">${esc(ideaLabel)}</p>${surprise}</div>` : "";
  const sayit = `<p class="sayit"><span class="mic">${MIC}</span><span>${say}</span></p>`;
  const body = kind === "house"
    ? `
  <div class="body one">
    <div class="col">${sayit}${ideasHead}<div class="ideas3">${cards}</div>
    </div>
  </div>`
    : `
  <div class="body">
    <div class="col">${sayit}${ideasHead}${cards}
    </div>${sets}
  </div>`;
  const top = kind === "house" ? `
  <div class="bigs">${press("play", `<b>Play preset ${esc(String(d.btn))}</b><span>${esc(d.carries ?? "Endless")}</span>`, { cls: "big", home: true })}` +
      `${press("fresh", `<b>Start fresh</b><span>A new one-hour opening · 1 DJ run (${esc(String(d.runsLeft))} left today)</span>`, { cls: "big" })}</div>` : "";
  const steerRow = `
  <section class="steer" aria-label="While ${esc(d.name)} plays"><p>${kind === "writer"
    ? `While ${esc(d.name)}'s set plays: the rest is replaced after the song`
    : `While ${esc(d.name)} plays`}</p>${press("more", "More like this", { cls: "pill" })}${press("change", "Change it up", { cls: "pill" })}${
    kind === "guest" && d.onLane ? press("fresh", "Start fresh", { cls: "pill" }) : ""}${tune ? `<a class="round" href="${esc(tune)}" aria-label="Tune ${esc(d.name)}">${SLIDERS}</a>` : ""}</section>`;
  const script = DJ_SCRIPT(`
  /* THE SETTINGS, REMEMBERED FOR THIS DJ ON THIS TV: a cookie the house reads
     when the words come, from a button here or from the Guide key. */
  var KEY = ${JSON.stringify(d.key)}, set = ${JSON.stringify(set)};
  function save() {
    var v = [set.len, set.notes, set.keep ? 1 : 0, set.start ? 1 : 0, set.when, set.svc].join(".");
    try { document.cookie = "tvs-" + KEY + "=" + v + "; Path=/; Max-Age=31536000; SameSite=Lax; Secure"; } catch (e) {}
  }
  Array.prototype.forEach.call(main.querySelectorAll(".seg[data-set]"), function (g) {
    var name = g.getAttribute("data-set");
    Array.prototype.forEach.call(g.querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-v");
        set[name] = v === "true" ? true : v === "false" ? false : /^\\d+$/.test(v) ? Number(v) : v;
        Array.prototype.forEach.call(g.querySelectorAll("button"), function (o) { o.setAttribute("aria-pressed", String(o === b)); });
        save();
      });
    });
  });`, d.key);
  return `${HEAD(`${d.name}, on the TV`, DJ_CSS)}
<main class="tvd one">
  <header class="dhead"><a class="pill" data-f="back" href="${esc(base)}/tv/djs${esc(q)}">${TV_I_BACK}DJs</a>${sleeve(base, d, "sleeve mini")}` +
    `<div class="who"><h1>${esc(d.name)}</h1><p>${esc(sub)}</p></div><span class="gap"></span>${status}</header>${top}${body}${steerRow}
</main>
${script}
</body>
</html>
`;
}

// TALK ON THE TV (MC-48, the owner 2026-11-19; the canvas "Talk on the TV"):
// the phone's Talk, made for a TV and its remote. The line, the minutes, the
// hang-up rules and the receiver's switch are the phone's own script
// (programs.js talkScript); only the markup is the TV's. In the fmwax TV app
// Guide held is the hold (the app hands Guide to window.fmwaxGuide); OK held
// on the button works anywhere. No speaker picker: the TV page's room, or
// another said by voice.
const TALK_TV_CSS = `
main.tvd.talk{box-sizing:border-box;height:100vh;display:flex;flex-direction:column;gap:1.125rem;padding:1.75rem 2.5rem 1.25rem}
.dhead{display:flex;align-items:center;gap:1rem}
.dhead h1{margin:0;font-size:2.125rem;font-weight:800;letter-spacing:-.03rem}
.dhead .gap{flex:1}
.tnote{margin:0;font-size:1.0625rem;color:var(--ink-2)}.tnote b{color:var(--ink)}
.tbody{flex:1;min-height:0;display:flex;align-items:center;gap:3rem}
.hold{flex:none;box-sizing:border-box;width:16.25rem;height:16.25rem;border-radius:50%;border:.375rem solid var(--rule);background:var(--raised);color:var(--ink);font:inherit;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.625rem;cursor:pointer;transition:background .2s,border-color .2s,box-shadow .08s linear}
.hold svg{width:3.5rem;height:3.5rem;color:var(--focus)}
.hold .hk{font-size:1.5rem;font-weight:800;text-align:center}.hold .hs{font-size:1rem;color:var(--ink-2);text-align:center;max-width:12rem}
/* THE BUTTON SAYS THE PHASE (MC-48): the remote's focus is its amber edge,
   never its fill, so the fill can say what the line does. */
main.talk .hold:focus{background:var(--raised)!important;border-color:var(--focus)!important;color:#E9E8E3!important}
main.talk .hold:focus .hs{color:#A9AAB2}
main.talk[data-phase=opening] .hold{border-style:dashed}
main.talk[data-phase=opening] .hold svg{color:#9A9CA4}
main.talk[data-phase=listening] .hold{background:var(--focus)!important;border-color:var(--focus)!important;color:var(--on-focus)!important;box-shadow:0 0 0 calc(.5rem + var(--lvl,0) * 2.5rem) rgba(242,182,58,.3)}
main.talk[data-phase=listening] .hold svg{color:var(--on-focus)}main.talk[data-phase=listening] .hold .hs{color:#3A2E0E}
main.talk[data-phase=thinking] .hold,main.talk[data-phase=speaking] .hold{background:#3B5378!important;color:#EDF1F7!important}
main.talk[data-phase=thinking] .hold svg,main.talk[data-phase=speaking] .hold svg,main.talk[data-phase=thinking] .hold .hs,main.talk[data-phase=speaking] .hold .hs{color:#AFC2E0}
.twords{display:flex;flex-direction:column;gap:.875rem;min-width:0;flex:1}
.tstate{margin:0;font-size:1.875rem;font-weight:700;line-height:1.2}
.tsum{margin:0;font-size:1.1875rem;line-height:1.45;color:var(--ink-2)}
.vsum.tvsound{margin:0;padding:.75rem 1rem;border-radius:.75rem;background:var(--raised);font-size:1.0625rem;line-height:1.4;color:var(--q-ink)}
.exchange{margin:0;display:grid;grid-template-columns:5.625rem minmax(0,1fr);column-gap:1.125rem;row-gap:.75rem;align-items:baseline}
.exchange dt{font-size:.9375rem;font-weight:700;letter-spacing:.125rem;color:var(--ink-2);text-transform:uppercase}
.exchange dd{margin:0;font-size:1.5rem;font-weight:700;line-height:1.3;overflow-wrap:anywhere}
.exchange dd#desk{font-family:Newsreader,Georgia,serif;font-weight:400;font-size:1.625rem;line-height:1.4}
.exchange:not(:has(dd:not(:empty))){display:none}
.tfoot{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem 1.25rem;border-top:.125rem solid var(--rule);padding-top:.875rem;font-size:1rem;color:var(--ink-2)}
.tfoot p{margin:0}.tfoot .meter{color:var(--ink)}.tfoot .gap{flex:1}`;
export function renderTvTalk({ base, room = null, devices = [], used = 0, usedSec = 0, cap = 60, idleMs = 30000, beatMs = 30000, rateCents = 5 }) {
  const q = room ? `?room=${encodeURIComponent(room.slug)}` : "";
  const here = room?.name ?? devices[0] ?? "";
  const dollars = (sec) => `$${(Math.max(0, Number(sec) || 0) / 60 * (Number(rateCents) || 5) / 100).toFixed(2)}`;
  const chooser = devices.map((d) => `<option${d === here ? " selected" : ""}>${esc(d)}</option>`).join("");
  const mic = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>`;
  const head = HEAD("Talk, on the TV", TALK_TV_CSS)
    .replace("family=Archivo:wght@400;600;700;800", "family=Archivo:wght@400;600;700;800&family=Newsreader:opsz,wght@6..72,400");
  return `${head}
<main class="tvd talk" data-phase="rest" data-preopen="1" data-level="1" data-base="${esc(base)}" data-room="${esc(here)}" data-idle="${Number(idleMs) || 30000}" data-beat="${Number(beatMs) || 30000}" data-rate="${Number(rateCents) || 5}">
  <header class="dhead"><a class="pill" data-f="back" href="${esc(base)}/tv${esc(q)}">${TV_I_BACK}Home</a><h1>Talk</h1><span class="gap"></span>` +
    `<p class="tnote"><span id="tspk">${spkWords(here)}</span> unless you say otherwise</p>` +
    `<select id="talkdev" name="device" hidden aria-label="Speaker to play on">${chooser}</select>` +
    `<button class="pill hangup" id="hangup" type="button" hidden>Hang up</button></header>
  <div class="tbody">
    <button class="hold" id="hold" type="button" aria-pressed="false" data-home>${mic}<span class="hk">Hold OK</span><span class="hs">and speak</span></button>
    <div class="twords">
      <p class="tstate" id="tstate" aria-live="polite">Hold the button and speak.</p>
      <p class="tsum">Say what you want, let go. The desk answers out loud and does the rest: a DJ and what you'd like, what's playing, a song's story, steering, keeping a set.</p>
      <p class="vsum tvsound" hidden>The music goes quiet while Talk is open, and comes back when you hang up.</p>
      <dl class="exchange lastex" id="exchange" aria-live="polite"><dt>You</dt><dd id="you"></dd><dt>Desk</dt><dd id="desk"></dd></dl>
    </div>
  </div>
  <footer class="tfoot"><p id="minutes">${Number(used) || 0} of ${cap} minutes today · about ${dollars(usedSec)}</p>` +
    `<p class="meter" id="meter" hidden></p><span class="gap"></span><p class="thelp">Quick commands without Talk: press Guide on any other screen</p></footer>
  <audio id="voice" autoplay playsinline></audio>
</main>
${DJ_SCRIPT(`
  /* The button says the phase (MC-48); the key is Guide in the fmwax TV app,
     OK elsewhere. */
  var app = false; try { app = !!window.fmwaxTV; } catch (e) {}
  var key = app ? "Guide" : "OK", hk = main.querySelector(".hold .hk"), hs = main.querySelector(".hold .hs");
  var WORDS = { rest: ["Hold " + key, app ? "or hold OK here" : "and speak"], ready: ["Hold " + key, "and speak"],
    opening: ["Getting ready\\u2026", "speak when it says Listening"], listening: ["Listening", "let go when you\\u2019re done"],
    thinking: ["Thinking\\u2026", ""], speaking: ["Speaking", "hold " + key + " to say more"] };
  function words() { var w = WORDS[main.getAttribute("data-phase")] || WORDS.rest; if (hk) hk.textContent = w[0]; if (hs) { hs.textContent = w[1]; hs.hidden = !w[1]; } }
  words(); new MutationObserver(words).observe(main, { attributes: true, attributeFilter: ["data-phase"] });`)}
${talkScript()}
</body>
</html>`;
}

// ABOUT FMWAX (the owner, 2026-11-19: "a dedicated page for the about
// information ... on the fmwax logo": the version, how far from GitHub, the
// helper, the Alexa skill, and help). Its own screen (the owner's choice),
// with the remote's keys. Read from the house's own records only: no Spotify
// call. What only the TV app knows (its version, the receiver) its script
// fills in.
const ABOUT_CSS = `
main.tvd.about{box-sizing:border-box;height:100vh;display:flex;flex-direction:column;gap:1rem;padding:1.5rem 2.5rem 1.25rem}
.dhead{display:flex;align-items:center;gap:1rem}
.dhead h1{margin:0;font-size:2rem;font-weight:800;letter-spacing:-.03rem}
.acols{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1.75rem}
.acol{display:flex;flex-direction:column;gap:1rem;min-width:0}
.ablock{border-radius:.875rem;background:var(--raised);padding:.875rem 1.125rem}
.ablock h2{margin:0 0 .5rem;font-size:.8125rem;font-weight:700;letter-spacing:.125rem;text-transform:uppercase;color:var(--ink-2)}
.ablock p{margin:0;font-size:1rem;line-height:1.4}
.ablock p+p{margin-top:.375rem}
.arows{margin:0;display:grid;grid-template-columns:auto minmax(0,1fr);column-gap:1rem;row-gap:.4375rem;align-items:baseline}
.arows dt{font-size:.9375rem;font-weight:700;color:var(--ink);white-space:nowrap}
.arows dd{margin:0;font-size:.9375rem;line-height:1.35;color:var(--ink-2)}
.arows dd b{color:var(--ink);font-weight:600}
.arows .on{color:#8FD19E}.arows .off{color:#F2B63A}
.arows .k{display:inline-block;min-width:4.5rem;padding:.0625rem .5rem;border:.0625rem solid var(--rule);border-radius:.375rem;font-weight:700;color:var(--ink);text-align:center}`;
export function renderTvAbout({ base, room = null, version = null, rows = [], talk = false }) {
  const q = room ? `?room=${encodeURIComponent(room.slug)}` : "";
  const ver = String(version ?? "").split(/(?<=\.)\s+/).filter(Boolean);
  const row = (r) => `<dt>${esc(r.label)}</dt><dd>${r.tone ? `<span class="${r.tone === "on" ? "on" : "off"}">${esc(r.state)}</span>` : `<b>${esc(r.state)}</b>`}${r.more ? ` · ${esc(r.more)}` : ""}</dd>`;
  const key = (k, what, cls = "") => `<dt${cls ? ` class="${cls}"` : ""}><span class="k">${esc(k)}</span></dt><dd${cls ? ` class="${cls}"` : ""}>${esc(what)}</dd>`;
  return `${HEAD("About fmwax, on the TV", ABOUT_CSS)}
<main class="tvd about">
  <header class="dhead"><a class="pill" data-f="back" href="${esc(base)}/tv${esc(q)}" data-home>${TV_I_BACK}Home</a><h1>About fmwax</h1></header>
  <div class="acols">
    <div class="acol">
      <section class="ablock" aria-label="This house"><h2>This house</h2>${ver.length ? ver.map((l) => `<p>${esc(l)}</p>`).join("") : "<p>This house doesn't know its own version.</p>"}
        <p class="tvapp" hidden></p></section>
      <section class="ablock" aria-label="What's connected"><h2>What's connected</h2>
        <dl class="arows">${rows.map(row).join("")}<dt class="rcv" hidden>Receiver</dt><dd class="rcv" hidden></dd></dl></section>
    </div>
    <div class="acol">
      <section class="ablock" aria-label="The remote"><h2>The remote</h2>
        <dl class="arows">${[
          key("OK", "Press what's selected" + (talk ? "; held on Talk's button, talk" : "")),
          key("Guide", "A quick command: say “skip”, “Hank, Daptone”, “what's playing”", "app"),
          talk ? key("Guide held", "On Talk: talk while you hold it. Elsewhere, about a second: open Talk", "app") : "",
          key("Back", "Close what's open, then the page before"),
          key("Back held", "The TV page's address (to set it again)", "app"),
          key("fmwax", "Your remote's fmwax button, if you set one up: fmwax and the receiver's input", "app"),
        ].join("")}</dl></section>
      <section class="ablock" aria-label="Help"><h2>More help</h2>
        <p>On the phone, at the foot of the Speakers tab: <b>Voice on the TV</b> (what to say), <b>House rules</b> (how everything behaves), and <b>Use</b>.</p></section>
    </div>
  </div>
</main>
${DJ_SCRIPT(`
  /* What only the fmwax TV app knows: its version and the receiver it
     switches for Talk. In a browser the app's keys are left out. */
  var m = /fmwaxTV\\/([0-9][0-9A-Za-z.]*)/.exec(navigator.userAgent), app = false;
  try { app = !!window.fmwaxTV; } catch (e) {}
  var ta = main.querySelector(".tvapp");
  if (ta) { ta.textContent = app ? "On this TV: the fmwax TV app" + (m && m[1].indexOf(".") > 0 ? " " + m[1] : "") + "." : "On this TV: a browser, not the fmwax TV app."; ta.hidden = false; }
  if (!app) Array.prototype.forEach.call(main.querySelectorAll(".app"), function (el) { el.hidden = true; });
  var rc = false; try { rc = app && window.fmwaxTV.sound && window.fmwaxTV.sound(); } catch (e) {}
  if (app) Array.prototype.forEach.call(main.querySelectorAll(".rcv"), function (el) {
    el.hidden = false; if (el.tagName === "DD") el.innerHTML = rc ? '<span class="on">Set</span> · goes to the TV’s sound while Talk is open' : '<span class="off">Not set</span> · Talk is heard only if the TV’s sound is';
  });`)}
</body>
</html>`;
}
