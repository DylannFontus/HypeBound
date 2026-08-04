/**
 * Ask the running page a question and print the answer.
 *
 * `shot.mjs` can drive a route and take its picture, and a picture answers most
 * of the questions the AAA bar asks. It cannot answer the numeric ones — what
 * this element's computed width actually is, whether an animation is running,
 * what contrast a label measures against the plate under it — and those are
 * exactly the questions that decide whether a defect is real or whether the
 * reviewer is misreading a JPEG artefact. Four review rounds were spent arguing
 * about things a `getBoundingClientRect` would have settled in a second.
 *
 *   node scripts/probe.mjs profile "[...document.querySelectorAll('.d-row')].length"
 *
 * The expression is evaluated in the page after the same seeding and settle
 * `shot.mjs` uses, and whatever it returns is printed as JSON. Nothing here
 * writes a file; this is the instrument, not the record.
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
if (argv.length < 2) {
  console.error('usage: node scripts/probe.mjs <route> "<js expression>" [--size WxH] [--wait ms] [--raw]');
  process.exit(1);
}
const route = argv[0];
const expression = argv[1];
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const [vw, vh] = String(flag("size", "1600x900")).split("x").map(Number);
const settle = Number(flag("wait", 1100));

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
  // `?nointro` first, always: the opening cinematic is a sibling of `#app` and
  // covers the starter picker the seeder is waiting for, so seeding a fresh
  // profile without it is a coin flip against a 20-second timeout.
  await page.goto(`${ORIGIN}/?nointro`, { waitUntil: "networkidle" });
  if (!argv.includes("--raw")) await seedPlayedAccount(page, ORIGIN);
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(settle);
  const value = await page.evaluate(`(() => (${expression}))()`);
  console.log(JSON.stringify(value, null, 2));
  if (errors.length) console.error("page errors:", errors.slice(0, 6).join(" | "));
} finally {
  await browser.close();
}
