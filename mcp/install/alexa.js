// mcp/alexa-model.js -> mcp/install/alexa-house-radio.json (MC-38)
//
// House radio's interaction model, made from the roster (djs.js) and the
// house's speakers (house.json `devices.rooms`), for the owner to paste into
// Amazon's developer console: Build → Interaction Model → JSON Editor. The
// test compares the file with what this makes, so a DJ or a speaker that
// changed without `npm run alexa` fails the suite. --check exits 1 without
// writing.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { alexaModel } from "../alexa-model.js";
import { ROSTER } from "../djs.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ALEXA_MODEL_FILE = join(HERE, "alexa-house-radio.json");
const HOUSE_JSON = join(HERE, "..", "house.json");

export function renderModel(house = JSON.parse(readFileSync(HOUSE_JSON, "utf8"))) {
  return JSON.stringify(alexaModel({ roster: ROSTER, rooms: house.devices?.rooms ?? [] }), null, 2) + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const want = renderModel();
  let have = "";
  try { have = readFileSync(ALEXA_MODEL_FILE, "utf8"); } catch { have = ""; }
  if (process.argv.includes("--check")) {
    if (have !== want) { console.error("install/alexa-house-radio.json is behind the roster or the speakers: run `npm run alexa`."); process.exit(1); }
  } else if (have !== want) {
    writeFileSync(ALEXA_MODEL_FILE, want);
    console.log(`Wrote ${ALEXA_MODEL_FILE}`);
  } else {
    console.log("install/alexa-house-radio.json is current.");
  }
}
