/**
 * Photograph a route with the accessibility settings actually applied.
 *
 * `shot.mjs --eval` runs after the route has mounted, which is fine for poking
 * at a screen and useless for a setting that is read at mount — the capture came
 * back at 100% scale with the decorative layer still running. This sets the
 * saved settings first, reloads, and then navigates, which is the order a player
 * who changed them yesterday actually experiences.
 *
 *   node scripts/probe/a11y-shot.mjs --scale 1.4 --reduced mastery events
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const scale = Number(flag("scale", 1));
const reduced = argv.includes("--reduced");
const contrast = argv.includes("--contrast");
const outDir = String(flag("dir", "scripts/screenshots/review"));
const suffix = String(flag("suffix", "a11y"));
const routes = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1]?.startsWith("--") !== true);

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);

const applied = await page.evaluate(
  async ({ scale, reduced, contrast }) => {
    const m = await import("/src/save/settings.ts");
    m.updateSettings({ uiScale: scale, reducedMotion: reduced, ...(contrast ? { highContrast: true } : {}) });
    const s = m.getSettings();
    return { uiScale: s.uiScale, reducedMotion: s.reducedMotion, highContrast: s.highContrast ?? null };
  },
  { scale, reduced, contrast }
);
console.log("applied:", JSON.stringify(applied));

for (const route of routes) {
  await page.goto(`${ORIGIN}/#${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1300);
  const file = path.join(outDir, `${route}-${suffix}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}

await browser.close();
