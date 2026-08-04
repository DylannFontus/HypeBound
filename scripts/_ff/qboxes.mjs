/** Report the geometry of every layer on the queue, so a stray rectangle can be named. */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const size = (process.argv[2] ?? "1600x900").split("x").map(Number);
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
await page.goto(`${ORIGIN}/#starter`, { waitUntil: "networkidle" });
if (await page.locator(".starter-screen").count()) {
  await page.evaluate(() => window.hypeboundStarter?.choose("neon-idols"));
  await page.waitForSelector(".starter-screen", { state: "detached", timeout: 20000 }).catch(() => {});
}
await page.evaluate(() => {
  localStorage.setItem(
    "hypebound-auth:session",
    JSON.stringify({
      accessToken: "camera-only",
      refreshToken: "camera-only",
      expiresAtMs: Date.now() + 3_600_000,
      account: { userId: "camera", email: "camera@example.com" },
    })
  );
});
await page.goto(`${ORIGIN}/#queue`);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1800);
const rows = await page.evaluate(() => {
  const out = [];
  const sel = [
    ".queue-world", ".queue-room", ".queue-room-art", ".queue-backlight", ".queue-floor",
    ".queue-horizon", ".queue-sweep", ".queue-haze", ".queue-vignette", ".queue-body",
    ".queue-stage", ".queue-plinth", ".queue-cast", ".queue-reflect", ".queue-reflect-plane",
    ".queue-leader", ".queue-leader-far", ".queue-leader-near", ".queue-leader-lit",
    ".queue-call", ".queue-note", ".queue-readout",
  ];
  for (const s of sel) {
    for (const el of document.querySelectorAll(s)) {
      const r = el.getBoundingClientRect();
      out.push(`${s.padEnd(22)} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  const doc = document.documentElement;
  out.push(`scrollHeight ${doc.scrollHeight} client ${doc.clientHeight}`);
  return out;
});
console.log(rows.join("\n"));
await browser.close();
