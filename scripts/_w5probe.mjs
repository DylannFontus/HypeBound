/**
 * A measuring probe for wave 5: open a route, run a snippet, print what it
 * returned.
 *
 * `shot.mjs` can already run JS in the page, but it only ever writes a PNG — so
 * a question whose answer is a number rather than a picture had nowhere to go,
 * and the alternative was reading a value off a screenshot by eye. That is how
 * the grain measurement in `VISUAL-OVERHAUL-STATE.md` came back 8x wrong.
 *
 * It launches with the same flags as the camera deliberately: no
 * `--use-angle=swiftshader` (which capped the camera at 1.6fps for four review
 * rounds) and no `--hide-scrollbars` (which erased the very gutter this wave is
 * being asked to measure). A probe that describes a differently-configured
 * browser from the one the pictures come out of is worse than no probe.
 *
 *   node scripts/_w5probe.mjs <route> "<js returning anything JSON-able>"
 *       [--size WxH] [--wait ms]
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
void HERE;
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const route = argv[0];
const source = argv[1];
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const [vw, vh] = String(flag("size", "1600x900")).split("x").map(Number);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
try {
  await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(Number(flag("wait", 1100)));
  const out = await page.evaluate((s) => new Function(s)(), source);
  console.log(JSON.stringify(out, null, 2));
  if (errors.length) console.log(`console errors: ${errors.slice(0, 6).join(" | ")}`);
} finally {
  await browser.close();
}
