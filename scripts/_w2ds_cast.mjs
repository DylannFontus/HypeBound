/** CDP screencast of a navigation, so the transition is seen rather than inferred. */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
const FROM = process.argv[2] ?? "lobby";
const TO = process.argv[3] ?? "mastery";
const OUT = process.argv[4] ?? `D:/Gooner Card Game/scripts/screenshots/w2/datascreens/cast-${TO}`;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true, ignoreDefaultArgs: ["--hide-scrollbars"], args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await seedPlayedAccount(page);
await page.goto(`http://localhost:5173/?nointro#${FROM}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const cdp = await page.context().newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async (f) => {
  frames.push({ t: Date.now(), data: f.data });
  await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, everyNthFrame: 1 });
const t0 = Date.now();
await page.evaluate((r) => { location.hash = `#${r}`; }, TO);
await page.waitForTimeout(1500);
await cdp.send("Page.stopScreencast");

console.log(`${frames.length} frames over ${Date.now() - t0}ms`);
let i = 0;
for (const f of frames) {
  const ms = f.t - t0;
  writeFileSync(path.join(OUT, `f${String(i).padStart(2, "0")}-${ms}ms.jpg`), Buffer.from(f.data, "base64"));
  i++;
}
console.log(frames.map((f) => f.t - t0).join(", "));
await browser.close();
