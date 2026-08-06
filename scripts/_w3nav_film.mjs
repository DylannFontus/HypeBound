/**
 * A plain screencast to disk, at a size you can actually look at.
 *
 * `_w3nav_curtain.mjs` decodes every frame inside the page to produce numbers,
 * which caps how large the reel can be before the decode is slower than the
 * thing being measured. This one only writes files, so it can film at something
 * near full size — which is what you need when the question is "is the portrait
 * on screen or merely in the DOM".
 *
 *   node scripts/_w3nav_film.mjs lobby battle --size 1600x900 --dir <out> --every 3
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const VALUED = new Set(["--size", "--dir", "--every", "--hold"]);
const routes = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith("--")) {
    if (VALUED.has(argv[i])) i += 1;
    continue;
  }
  routes.push(argv[i]);
}
const [vw, vh] = String(flag("size", "1600x900")).split("x").map(Number);
const dir = String(flag("dir", "scripts/screenshots/w3/shell/film"));
const every = Number(flag("every", 3));
const hold = Number(flag("hold", 6500));
const ORIGIN = "http://localhost:5173";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#${routes[0] ?? "lobby"}`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 });
await page.waitForTimeout(1200);

const session = await page.context().newCDPSession(page);
const shots = [];
session.on("Page.screencastFrame", (f) => {
  shots.push({ t: f.metadata.timestamp ?? 0, data: f.data });
  void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await session.send("Page.startScreencast", { format: "jpeg", quality: 88, everyNthFrame: every, maxWidth: vw, maxHeight: vh });

const clickWall = Date.now();
await page.evaluate((hash) => {
  location.hash = hash;
}, `#${routes[1] ?? "battle"}`);
await page.waitForTimeout(hold);
await session.send("Page.stopScreencast");
await session.detach().catch(() => {});

mkdirSync(dir, { recursive: true });
for (const shot of shots) {
  const t = Math.round(shot.t * 1000 - clickWall);
  if (t < -60) continue;
  writeFileSync(`${dir}/t${String(Math.max(0, t)).padStart(5, "0")}.jpg`, Buffer.from(shot.data, "base64"));
}
console.log(`${shots.length} frames -> ${dir}`);
await browser.close();
