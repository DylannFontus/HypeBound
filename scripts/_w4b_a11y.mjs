/**
 * The board under the four settings that are not negotiable.
 *
 * Reduced motion, high contrast, `--ui-scale 1.4` and keyboard focus each get a
 * capture of a live board *with a card in the air*, because the thing this wave
 * added — the row trough and the drop socket — only exists during a drag and is
 * therefore invisible to every existing accessibility sweep.
 *
 * Settings are written straight into `hypebound:settings` **before the app
 * boots**, in the store's own `{version, data}` envelope, rather than through an
 * `await import("/src/save/settings.ts")` in the page. In a Vite dev build that
 * import is a second copy of the module — the app's carries an HMR `?t=` query —
 * so it writes to a store nothing is reading, and the measurement comes back
 * saying the setting had no effect. That trap has already cost this project one
 * wrong conclusion about reduced motion and is written up in
 * docs/VISUAL-OVERHAUL-STATE.md.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const outDir = "scripts/screenshots/w4/board";
mkdirSync(outDir, { recursive: true });

const cases = [
  { name: "rm", settings: { reducedMotion: true }, size: [1280, 720] },
  { name: "hc", settings: { highContrast: true }, size: [1280, 720] },
  { name: "scale14", settings: { uiScale: 1.4 }, size: [1280, 720] },
  { name: "scale14-phone", settings: { uiScale: 1.4 }, size: [844, 390] },
];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});

for (const c of cases) {
  const page = await browser.newPage({ viewport: { width: c.size[0], height: c.size[1] }, deviceScaleFactor: 1 });
  try {
    await seedPlayedAccount(page, ORIGIN);
    /**
     * `addInitScript`, not `evaluate`, and the difference is a debounce.
     *
     * Every store in this game writes through a debounced flush, so the page
     * left running by the seeding step will happily overwrite a hand-patched
     * `hypebound:settings` a few hundred milliseconds later — which is what
     * happened, and the capture came back with `reducedMotion` reading false
     * while the script insisted it had set it. An init script runs before any
     * page code on the *next* navigation, so nothing exists yet to overwrite it.
     */
    await page.addInitScript((patch) => {
      const key = "hypebound:settings";
      let envelope = { version: 2, data: {} };
      try {
        const raw = localStorage.getItem(key);
        if (raw) envelope = JSON.parse(raw);
      } catch {
        /* no settings yet */
      }
      envelope.data = { ...(envelope.data ?? {}), ...patch };
      localStorage.setItem(key, JSON.stringify(envelope));
    }, c.settings);

    await page.goto(`${ORIGIN}/?nointro#battle`, { waitUntil: "networkidle" });
    await page.waitForSelector(".mulligan-panel", { timeout: 25000 }).catch(() => {});
    if (await page.locator(".mulligan-actions .btn-primary").count()) {
      await page.click(".mulligan-actions .btn-primary");
    }
    await page
      .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(1500);

    const applied = await page.evaluate(() => ({
      reduced: document.documentElement.dataset.reducedMotion ?? "unset",
      contrast: document.documentElement.dataset.contrast ?? "unset",
      scale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim() || "unset",
      rootFont: getComputedStyle(document.documentElement).fontSize,
    }));

    const card = await page.evaluate(() => {
      const all = window.hypeboundBattle.debug().hand.filter((x) => x.ok);
      const list = [...all.filter((x) => x.type === "character"), ...all];
      const nodes = [...document.querySelectorAll(".hand-card")];
      for (const x of list) {
        const node = nodes.find((n) => n.dataset.instanceId === x.instanceId);
        if (!node) continue;
        const r = node.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      return null;
    });

    if (card) {
      await page.mouse.move(card.x, card.y);
      await page.mouse.down();
      await page.mouse.move(c.size[0] * 0.5, c.size[1] * 0.58, { steps: 8 });
      await page.waitForTimeout(450);
    }
    await page.screenshot({ path: path.join(outDir, `a11y-${c.name}.png`) });

    /** Does the invitation hold still when the player asked for stillness? */
    let stillness = null;
    if (c.name === "rm" && card) {
      const first = await page.screenshot();
      await page.waitForTimeout(700);
      const second = await page.screenshot();
      stillness = { identical: Buffer.compare(first, second) === 0, bytes: [first.length, second.length] };
    }
    if (card) await page.mouse.up();

    console.log(c.name, JSON.stringify({ applied, stillness }));
  } catch (error) {
    console.log(c.name, "FAILED", error.message);
  } finally {
    await page.close();
  }
}
await browser.close();
