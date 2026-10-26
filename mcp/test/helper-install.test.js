// THE HOME HELPER'S INSTALL (MC-31 stage 5, 2026-10-19): where it keeps
// itself on each system, and the files that start it at sign-in. The install
// itself is run by dev/helper-check.mjs on Windows, macOS and Linux.
import { test } from "node:test";
import assert from "node:assert/strict";

import { helperPaths, systemdUnit, launchdPlist, windowsLauncher, manifestOf } from "../install/helper-service.js";

test("its places: a folder of its own, the helper's settings where they always were, a start of its own name", () => {
  const linux = helperPaths({ os: "linux", home: "/home/jane" });
  assert.equal(linux.envFile, "/home/jane/.config/fmwax-helper/env");
  assert.equal(linux.script, "/home/jane/.fmwax-helper/helper/fmwax-helper.mjs");
  assert.equal(linux.keymap, "/home/jane/.fmwax-helper/mcp/keymap.js");
  assert.equal(linux.service.file, "/home/jane/.config/systemd/user/fmwax-home-helper.service");
  assert.deepEqual(linux.handMade, ["/home/jane/.config/systemd/user/fmwax-helper.service"], "the owner's own helper is known, and left alone");
  const mac = helperPaths({ os: "darwin", home: "/Users/jane" });
  assert.equal(mac.service.file, "/Users/jane/Library/LaunchAgents/com.fmwax.home-helper.plist");
  assert.equal(mac.log, "/Users/jane/Library/Logs/fmwax-home-helper.log");
  const win = helperPaths({ os: "win32", home: "/c/Users/Jane Doe", env: { LOCALAPPDATA: "/c/Users/Jane Doe/AppData/Local", APPDATA: "/c/Users/Jane Doe/AppData/Roaming" } });
  assert.equal(win.app, "/c/Users/Jane Doe/AppData/Local/fmwax-helper");
  assert.match(win.service.file, /Start Menu\/Programs\/Startup\/fmwax-home-helper\.vbs$/);
});

test("the start files: quoted for a space, escaped for XML, and every one starts it again when it stops", () => {
  const unit = systemdUnit({ node: "/usr/bin/node", script: "/home/jane doe/.fmwax-helper/helper/fmwax-helper.mjs" });
  assert.match(unit, /^ExecStart="\/usr\/bin\/node" "\/home\/jane doe\/\.fmwax-helper\/helper\/fmwax-helper\.mjs"$/m);
  assert.match(unit, /^Restart=always$/m);
  const plist = launchdPlist({ node: "/usr/local/bin/node", script: "/Users/a&b/.fmwax-helper/helper/fmwax-helper.mjs", log: "/Users/a&b/Library/Logs/x.log" });
  assert.match(plist, /<string>\/Users\/a&amp;b\/\.fmwax-helper\/helper\/fmwax-helper\.mjs<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  const vbs = windowsLauncher({ node: "C:\\Program Files\\nodejs\\node.exe", script: "C:\\Users\\Jane Doe\\AppData\\Local\\fmwax-helper\\helper\\fmwax-helper.mjs", log: "C:\\Users\\Jane Doe\\helper.log" });
  assert.ok(vbs.includes('sh.Run """C:\\Program Files\\nodejs\\node.exe"" ""C:\\Users\\Jane Doe\\AppData\\Local\\fmwax-helper\\helper\\fmwax-helper.mjs"" --log ""C:\\Users\\Jane Doe\\helper.log""", 0, True'));
  assert.match(vbs, /WScript\.Sleep 15000/);
});

test("the record of an install lists each thing once", () => {
  const m = manifestOf({ house: "https://h.example", made: ["/a", "/b", "/a"], service: { kind: "linux" }, at: "x" });
  assert.deepEqual(m, { version: 1, house: "https://h.example", at: "x", made: ["/a", "/b"], service: { kind: "linux" } });
});
