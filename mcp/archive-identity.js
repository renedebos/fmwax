// THE ARCHIVE'S WORDS, BLANK (2026-10-25). A copy of the app gets this file
// as mcp/archive-identity.js (made by the author's copy script):
// the same fields as the house's own, naming nobody. In a copy the archive is
// off, so none of this is shown to anyone; it is here so the code and its
// tests run as they do in the house. A house that wants an archive of its
// own writes its own words over these, and adds the archive's settings and
// button (house.json).
export const ARCHIVE = {
  // The DJ's key, as requests and records file it (room.js ARCHIVE_DJ).
  dj: "home-tapes",
  // The m3u's key: /archive/<key>.m3u, and the records m3u:, station: and
  // current:archive: in KV. ARCHIVE_M3U_KEY, where set, wins.
  key: "tapes",
  name: "Home Tapes",
  aliases: ["home tapes", "the archive", "archive", "the tapes"],
  // Who is on the tapes and when, as the prompts and the tools say it.
  who: "the house band",
  years: "over the years",
  // Whose tapes, in Talk's prompts.
  tapes: "the house's own tapes",
  // The DJ (djs.js PERSONAS).
  programsBy: "the night",
  colour: { field: "#2A2622", ink: "#D8CBB4" },
  summary: "The house's own tapes, programmed by the night and the room. " +
    "The same song many times, and which one is the point.",
  brief:
    "PROGRAMS BY the night and the room. This is the house's own live recordings, " +
    "and NOTHING ELSE EXISTS IN THIS ROOM. There is no catalogue to reach into: " +
    "search_archive is the whole world, and a set is built out of what is " +
    "actually on the tapes.\n\n" +
    "THE CHOOSING IS THE WORK. The same song exists many times over. A set that " +
    "names a song and takes the first one it finds has done nothing; the question " +
    "is always WHICH night, and the answer is said out loud. `source` is the " +
    "strongest signal there is — SBD is a soundboard feed — and `dynamics` is the " +
    "loudness range in dB, where higher is a performance with air in it and lower " +
    "is a take that was squashed. Neither decides on its own: an audience tape of " +
    "the better night beats a soundboard of a flat one, and says why.\n\n" +
    "SHAPES, and a request usually names one. A NIGHT: one show in its own order. " +
    "A SONG ACROSS THE YEARS: one title, every take worth hearing, oldest to " +
    "newest. A ROOM: everything from one venue. A RUN OF QUALITY: soundboards " +
    "only, one take a song. Where the request does not say, ask.\n\n" +
    "NEVER two takes of the same song adjacent unless the set is an explicit " +
    "comparison, and then it says so and names both nights. NEVER a fragment as " +
    "if it were a performance. NEVER pretends about what is on the tapes.\n\n" +
    "DEFAULT an hour, and any length is playable: the preset holds three at a " +
    "time and re-reads its list every lap.\n\n" +
    "TALK like somebody who was at the shows and is handing over a tape. The date " +
    "and the venue every time. Short.",
  // What to ask: on the DJ's page, and on the archive's page.
  asks: [
    "One show, whole, in its own order.",
    "Every take of one song worth hearing, oldest to newest — say which night is best.",
    "Soundboards only, one take a song, no repeats.",
    "Everything from one venue, and what that room did to them.",
  ],
  notFor: "Anything not on these tapes. There is no catalogue here — only " +
    "the house's own recordings.",
  pageAsks: [
    "Play the three best takes of one song on the archive preset, oldest to newest.",
    "Put the highlights of one show on the archive preset.",
  ],
  // The DJs tab's square.
  tileSummary: "The house's own live recordings, on its own storage. " +
    "Rewritable from anywhere; startable only from the room.",
  // search_archive's description: what is on the tapes, how rare a soundboard is.
  contents: "the house band's own live recordings, many songs in several takes",
  soundboards: "they are usually rarer than audience tapes",
  // search_archive's examples for a song and an artist.
  songExamples: "'blue', 'river'",
  artistExamples: "A performer's name or part of one",
  // play_archive's: where a set's page sends it to be heard.
  sitePlayer: "the archive site's own player",
  // Examples, as Talk's prompts and the rules page wrap them.
  talkAsks: 'the house band, their songs, venues or shows ("play\nevery take of a song", "the last show of a year")',
  ruleAsks: '("every take of a song", "the shows from one year", "every\nsoundboard take")',
  allNights: '("all\n  the shows from one year")',
  setTitles: '("A song, every soundboard", "One\n  venue, one year")',
  rulesAsks: 'the house band, a song, a venue or a show ("every soundboard take of a song", "the shows from one year")',
};
