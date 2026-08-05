/**
 * Film the gallery arriving, because `shot.mjs` cannot.
 *
 * `shot.mjs --frames` waits for `.screen-out` to disappear before it starts its
 * burst, which is correct for photographing a settled screen and useless for the
 * one thing §3a is mostly about: the first four hundred milliseconds. Every
 * frame of a `lobby → gallery --frames 7x55` burst came back identical and fully
 * settled, which a review would read as "the entrance does not animate".
 *
 * So this uses the same passive CDP screencast `_w7r_idle.mjs` validated: Chrome
 * pushes a frame **when it composites one**, nothing here asks the page for
 * anything, and the hash is written from inside the page after the cast has
 * already started. What lands on disk is what a player saw, in order, with the
 * millisecond each frame was composited.
 *
 * usage: node scripts/_w7gal_film.mjs [route] [--dir <path>] [--ms 1400]
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const route = argv.find((a) => !a.startsWith("--")) ?? "gallery";
const dir = String(flag("dir", "scripts/screenshots/w7/gal/film"));
const span = Number(flag("ms", 1400));
const [vw, vh] = String(flag("size", "1280x720")).split("x").map(Number);
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
await seedPlayedAccount(page, ORIGIN);

/* Start from the lobby, settled, so what is filmed is the transition and not a
   cold boot. */
await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
await page.waitForTimeout(1600);

const client = await page.context().newCDPSession(page);
const frames = [];
client.on("Page.screencastFrame", async (ev) => {
  frames.push({ t: (ev.metadata.timestamp ?? 0) * 1000, data: ev.data });
  try {
    await client.send("Page.screencastFrameAck", { sessionId: ev.sessionId });
  } catch {
    /* cast stopped between the push and the ack */
  }
});
await client.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
await page.waitForTimeout(120);
await page.evaluate((r) => {
  location.hash = `#${r}`;
}, route);
await page.waitForTimeout(span);
await client.send("Page.stopScreencast");
await client.detach();

const t0 = frames[0]?.t ?? 0;
let written = 0;
for (const [i, f] of frames.entries()) {
  const ms = Math.round(f.t - t0);
  /* every third composited frame, up to twelve, is enough to read a cascade */
  if (i % 3 !== 0 || written >= 12) continue;
  const file = path.join(dir, `${route}-${String(written).padStart(2, "0")}-${String(ms).padStart(4, "0")}ms.png`);
  writeFileSync(file, Buffer.from(f.data, "base64"));
  console.log(file);
  written += 1;
}
console.log(`${frames.length} frames composited in ${span}ms (${new Set(frames.map((f) => f.data)).size} distinct)`);

await browser.close();
