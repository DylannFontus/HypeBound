/**
 * The records-hub camera: `shot.mjs`, plus an account that has actually played.
 *
 * A separate entry point rather than a flag on `shot.mjs`, because that file is
 * shared with two builders working in parallel and a wave is not the moment to
 * edit somebody else's tool. Everything here that matters — the GPU flags, the
 * missing `--hide-scrollbars`, `?nointro` — is copied from it deliberately;
 * `tests/camera-truth.test.ts` exists because a swiftshader-capped camera once
 * cost four rounds of motion review.
 *
 *   node scripts/_w4rec_shot.mjs profile --out after-profile --dir <dir>
 *     --size WxH --wait ms --empty (skip the history seed) --frames <n>x<ms>
 *     --eval "<js>" --scale n
 */

import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
import { seedHistory } from "./lib/records.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const route = argv[0];
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const has = (name) => argv.includes(`--${name}`);

const slug = String(route).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "screen";
const outName = String(flag("out", slug));
const outDir = String(flag("dir", path.join(HERE, "screenshots", "w4", "records")));
const [vw, vh] = String(flag("size", "1600x900")).split("x").map(Number);
const settle = Number(flag("wait", 1200));
const scale = Number(flag("scale", 1));
const evalJs = flag("eval", null);
const clip = flag("clip", null);
const burst = (() => {
  const raw = flag("frames", null);
  if (!raw) return null;
  const [n, ms] = String(raw).split("x").map(Number);
  return { count: n || 1, interval: ms || 150 };
})();

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: scale });
const written = [];

const shoot = async (name) => {
  const file = path.join(outDir, `${name}.png`);
  const target = clip ? page.locator(String(clip)).first() : page;
  await target.screenshot({ path: file });
  written.push(file);
};

try {
  await seedPlayedAccount(page, ORIGIN);
  if (!has("empty")) await seedHistory(page);

  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 })
    .catch(() => {});
  if (evalJs) await page.evaluate(String(evalJs));
  await page.waitForTimeout(settle);

  if (burst) {
    for (let i = 0; i < burst.count; i++) {
      await shoot(`${outName}-${i}`);
      if (i < burst.count - 1) await page.waitForTimeout(burst.interval);
    }
  } else {
    await shoot(outName);
  }
  console.log(written.join("\n"));
} finally {
  await browser.close();
}
