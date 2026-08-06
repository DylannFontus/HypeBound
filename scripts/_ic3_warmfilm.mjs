/**
 * Film the *second* crossing of a leg, with the frames kept.
 *
 * The first crossing pays for a lazy chunk and is not what a player sees after
 * their first minute. This warms the route, goes back, and films the return —
 * so what lands on disk is the transition a returning player actually gets.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const from = String(arg("from", "lobby"));
const to = String(arg("to", "collection"));
const dir = String(arg("dir", `scripts/screenshots/w4/ic3/motion/warm-${from}-to-${to}`));
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#${from}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
// warm it
await page.evaluate((h) => (location.hash = h), `#${to}`);
await page.waitForTimeout(3000);
await page.evaluate((h) => (location.hash = h), `#${from}`);
await page.waitForTimeout(2600);

const session = await page.context().newCDPSession(page);
const shots = [];
session.on("Page.screencastFrame", (f) => {
  shots.push({ t: (f.metadata.timestamp ?? 0) * 1000, data: f.data });
  void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await session.send("Page.startScreencast", { format: "jpeg", quality: 78, everyNthFrame: 1, maxWidth: 1600, maxHeight: 900 });
await page.waitForTimeout(300);

const t0 = Date.now();
await page.evaluate((h) => (location.hash = h), `#${to}`);
await page.waitForTimeout(2600);
await session.send("Page.stopScreencast");

/**
 * "Is this frame a curtain?" measured, not eyeballed: mean luminance of the
 * whole frame, decoded in the page so no image library is needed.
 */
const frames = shots.map((s) => ({ t: Math.round(s.t - t0), data: s.data })).filter((f) => f.t > -60);
const lum = await page.evaluate(async (list) => {
  const out = [];
  for (const f of list) {
    const img = new Image();
    img.src = "data:image/jpeg;base64," + f.data;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 90;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    out.push({ t: f.t, l: Math.round((s / (d.length / 4)) * 10) / 10 });
  }
  return out;
}, frames.map((f) => ({ t: f.t, data: f.data })));

for (const f of frames) writeFileSync(`${dir}/t${String(Math.max(0, f.t)).padStart(5, "0")}.jpg`, Buffer.from(f.data, "base64"));

const base = lum[0]?.l ?? 0;
console.log("leg", `${from} -> ${to}`, "frames", frames.length, "baseline luminance", base);
console.log("luminance trace:", lum.map((x) => `${x.t}:${x.l}`).join(" "));
const dark = lum.filter((x) => x.t >= 0 && x.l < base * 0.5);
console.log(
  "frames under 50% of the outgoing screen's luminance:",
  dark.length,
  dark.length ? `from ${dark[0].t}ms to ${dark[dark.length - 1].t}ms` : ""
);
await browser.close();
