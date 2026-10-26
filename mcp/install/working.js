// THE WAITS, SAID (the owner, 2026-10-19: a step that takes time must be seen
// to be under way, or it looks stuck). In a terminal, a step at work shows a
// running count of seconds on its line; piped to a file, nothing extra.
// Used by both install commands, door.js and helper.js.
export function working(what) {
  if (!process.stdout.isTTY || !what) return () => {};
  const start = Date.now();
  const draw = () => process.stdout.write(`\r   ${what}… ${Math.round((Date.now() - start) / 1000)} s `);
  draw();
  const timer = setInterval(draw, 1000);
  return () => { clearInterval(timer); process.stdout.write("\r\x1b[K"); };
}
