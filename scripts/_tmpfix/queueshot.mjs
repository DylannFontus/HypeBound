/** Photograph #queue, which needs a session in storage before it will render. */
import { chromium } from "playwright-core";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const outDir = path.resolve("scripts/screenshots/w1/frontdoor");
mkdirSync(outDir, { recursive: true });
const frames = Number(process.argv[2] ?? 1);
const gap = Number(process.argv[3] ?? 500);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
try {
  await seedPlayedAccount(page, ORIGIN);
  await page.evaluate(() => {
    localStorage.setItem(
      "hypebound-auth:session",
      JSON.stringify({
        accessToken: "dev-review-token",
        refreshToken: "dev-review-refresh",
        expiresAtMs: Date.now() + 3600_000,
        account: { userId: "dev-review", email: "review@example.com" },
      })
    );
  });
  await page.goto(`${ORIGIN}/#queue`, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3200);
  for (let i = 0; i < frames; i++) {
    await page.screenshot({ path: path.join(outDir, frames === 1 ? "queue-after.png" : `queue-after-${i}.png`) });
    if (i < frames - 1) await page.waitForTimeout(gap);
  }
  console.log("route:", await page.evaluate(() => location.hash), "screen:", await page.evaluate(() => document.querySelector(".screen")?.className));
  if (errors.length) console.log(errors.slice(0, 5).join("\n"));
} finally {
  await browser.close();
}
