/** CPU-profile one navigation and print the heaviest self-time frames. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const route = process.argv[2] ?? "pass";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
await page.evaluate((r) => {
  location.hash = "#" + r;
}, route);
await page.waitForTimeout(1200);
const { profile } = await cdp.send("Profiler.stop");

const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const total = profile.samples.length;
for (const id of profile.samples) {
  const n = byId.get(id);
  if (!n) continue;
  const f = n.callFrame;
  const key = `${f.functionName || "(anon)"} @ ${(f.url || "").split("/").slice(-1)[0]}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + 1);
}
const us = profile.endTime - profile.startTime;
const perSample = us / 1000 / total;
console.log(`route ${route}: ${total} samples over ${Math.round(us / 1000)}ms`);
for (const [k, c] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)) {
  console.log(`  ${(c * perSample).toFixed(1)}ms  ${k}`);
}
await browser.close();
