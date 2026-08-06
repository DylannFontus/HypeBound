/**
 * Is the *backdrop* alive, with the content taken away?
 *
 * ## Why this is not just `_w7rw_probe.mjs idle`
 *
 * It is, for the arithmetic — `meanDelta` below is that file's function
 * character for character, and `calib` recomputes the Hearthstone floor from
 * `hearthstone_frames/` with it, so if this file's numbers are not on the
 * published scale it says so before it measures anything. What it adds is the
 * one thing that probe cannot do: hide the screen's own content and photograph
 * what is left.
 *
 * That matters because a whole-screen idle figure cannot tell the two halves
 * apart. Measured just now, `#achievements` — which still carries `.rw-wash`,
 * the flat plate this wave is replacing — reads a whole-screen median of 1.405,
 * comfortably "alive", because reward tiles, meters and wallet chips move on
 * their own. A whole-screen number would therefore have credited the room for
 * life the room is not producing, which is exactly the class of confident wrong
 * answer nine instruments here have already given.
 *
 * So `--bare` hides every direct child of the screen except the decorative
 * planes (`.d-room`, `.d-room-glass`, `.rw-wash`, `.ambient-bg`) and samples
 * what remains. Two routes measured the same way in the same run, differing only
 * in which backdrop they carry, is an attribution rather than a reading.
 *
 * Sampling is on a 200ms grid because every published floor in this project is a
 * 200ms figure: a 3.6s breathe moves 0.2% of its amplitude in 20ms, so a
 * frame-to-frame reel reports a screen that is visibly breathing as 0.00.
 *
 *   node scripts/_w8col_idle.mjs calib
 *   node scripts/_w8col_idle.mjs missions pass gauntlet --bare
 */
import { chromium } from "playwright-core";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./lib/png.mjs";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const [VW, VH] = String(flag("size", "1600x900")).split("x").map(Number);
const SECONDS = Number(flag("seconds", 5));
const BARE = argv.includes("--bare");

/** Identical to `_w7rw_probe.mjs::meanDelta`, which is identical to `_ic6_calib`. */
function meanDelta(a, b) {
  const n = Math.min(a.data.length, b.data.length);
  let sum = 0;
  let count = 0;
  for (let i = 0; i + 2 < n; i += a.channels) {
    sum += Math.abs(a.data[i] - b.data[i]);
    sum += Math.abs(a.data[i + 1] - b.data[i + 1]);
    sum += Math.abs(a.data[i + 2] - b.data[i + 2]);
    count += 3;
  }
  return sum / count;
}

const quantiles = (values) => {
  const s = [...values].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: q(0), median: q(0.5), max: s[s.length - 1] };
};
const f3 = (x) => x.toFixed(3);

if (argv[0] === "calib") {
  const dir = path.join(HERE, "..", "hearthstone_frames");
  const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  const deltas = [];
  let prev = null;
  for (const file of files) {
    const img = decodePng(readFileSync(path.join(dir, file)));
    if (prev) deltas.push(meanDelta(prev, img));
    prev = img;
  }
  const s = quantiles(deltas);
  console.log(
    `[reference] hearthstone_frames n=${s.n} min=${f3(s.min)} median=${f3(s.median)} max=${f3(s.max)}` +
      `   (published: n 203, min 0.501, median 1.713)`
  );
  const ok = s.n === 203 && Math.abs(s.min - 0.501) < 0.002 && Math.abs(s.median - 1.713) < 0.002;
  console.log(ok ? "[calib] this file is on the published scale." : "[calib] !! NOT the published scale — do not quote it.");
  process.exit(ok ? 0 : 1);
}

/** Hide everything on the screen except the decorative planes behind it. */
const STRIP = () => {
  const screen = document.querySelector(".screen:not(.screen-out)") ?? document.querySelector(".screen");
  if (!screen) return "no screen";
  const KEEP = ["d-room", "d-room-glass", "rw-wash", "ambient-bg"];
  const kept = [];
  for (const child of [...screen.children]) {
    const cls = String(child.className);
    if (KEEP.some((k) => cls.split(/\s+/).includes(k))) {
      kept.push(cls.split(/\s+/)[0]);
      continue;
    }
    child.style.visibility = "hidden";
  }
  return kept.length ? `kept ${kept.join(", ")}` : "kept nothing — this screen has no backdrop layer";
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });

try {
  await seedPlayedAccount(page, ORIGIN);
  /*
   * A flag's *value* is not a route. Without this, `--seconds 5` added a route
   * called "5", which navigated to `#5`, fell through to the unknown-route
   * screen and printed a perfectly plausible idle figure for it under the label
   * "5". A run that measures something nobody asked for and labels it with a
   * number is one line away from a finding nobody can attribute.
   */
  const VALUED = new Set(["--size", "--seconds"]);
  const routes = argv.filter((a, i) => !a.startsWith("--") && !VALUED.has(argv[i - 1]));
  console.log(`[idle] ${VW}×${VH}, ${SECONDS}s on a 200ms grid${BARE ? ", content hidden" : ""}\n`);
  for (const route of routes) {
    await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
    await page
      .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(1600);
    let note = "";
    if (BARE) note = await page.evaluate(STRIP);
    await page.waitForTimeout(400);
    const shots = [];
    for (let i = 0; i * 0.2 < SECONDS; i += 1) {
      shots.push(decodePng(await page.screenshot()));
      await page.waitForTimeout(200);
    }
    const ds = [];
    for (let i = 1; i < shots.length; i += 1) ds.push(meanDelta(shots[i - 1], shots[i]));
    const s = quantiles(ds);
    console.log(
      `  ${route.padEnd(14)} n=${s.n} min=${f3(s.min)} median=${f3(s.median)} max=${f3(s.max)}` +
        `  [reference min 0.501 median 1.713]  ${s.median < 0.501 ? "BELOW REFERENCE FLOOR" : "alive"}` +
        (note ? `   (${note})` : "")
    );
  }
} finally {
  await browser.close();
}
