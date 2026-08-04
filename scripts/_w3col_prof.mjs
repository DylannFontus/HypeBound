/** CPU-profile the lobby -> collection navigation and print the hottest self-time frames. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const route = process.argv[2] ?? "collection";
const ms = Number(process.argv[3] ?? 3000);

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
for (let i = 0; i < 5; i++) {
  try { await seedPlayedAccount(page, ORIGIN); break; } catch { await page.waitForTimeout(900); }
}
await page.goto(`${ORIGIN}/#lobby`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 150 });
await cdp.send("Profiler.start");
await page.evaluate((r) => { location.hash = "#" + r; }, route);
await page.waitForTimeout(ms);
const { profile } = await cdp.send("Profiler.stop");

const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
for (const id of profile.samples) {
  const n = byId.get(id);
  if (!n) continue;
  const f = n.callFrame;
  const key = `${f.functionName || "(anon)"} @ ${(f.url || "").split("/").slice(-1)[0]}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + 1);
}
const total = profile.samples.length;
const per = (profile.endTime - profile.startTime) / 1000 / total;
console.log("wall", Math.round((profile.endTime - profile.startTime) / 1000), "ms");
for (const [k, c] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(String(Math.round(c * per)).padStart(6), "ms ", k);
}
await browser.close();
