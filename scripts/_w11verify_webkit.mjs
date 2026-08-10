/**
 * Can Playwright's WebKit time a repaint against *this* application, or not?
 *
 * The iPad work rests on a claim made in two places — `_w10ipad_layers.mjs` and
 * `tests/compositor-budget.test.ts` — that "Playwright's WebKit turned out to
 * have no display link at all — it fires one `requestAnimationFrame` in a
 * second and cannot be used to time a repaint". That claim is why the freeze
 * was costed with a Chromium layer census standing in for Safari rather than
 * observed directly, and it is therefore the single load-bearing assumption of
 * the whole fix.
 *
 * On a trivial `setContent` page the same WebKit 26.5 build fires **64** rAF
 * callbacks in a second. So the claim is either wrong, or it is true only of
 * the real app — and those two possibilities lead to very different places: the
 * first means the stall was never looked at on a WebKit engine when it could
 * have been, the second means the app does something that stops the display
 * link, which would itself be a very strong lead on a freeze.
 *
 * This measures both arms in one run, on the same browser instance, so the
 * difference cannot be a launch-flag or machine-load artefact:
 *
 *   1. `about:blank` with one heading — the control.
 *   2. the lobby, idle — is the display link running once the app is up?
 *   3. the lobby → collection navigation — the leg the owner reports as frozen.
 *
 * The frame counter is installed by an `evaluate` that resolves when it is
 * done, never one that stays open across the thing it is measuring, because an
 * fps probe living inside a long-lived `page.evaluate` is instrument four in
 * this project's own list and reported 9-19fps for a page running at 75.
 */
import { webkit, chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

/** Count rAF callbacks and the worst gap between them, over `ms`. */
const COUNT = (ms) => `
  (() => new Promise((resolve) => {
    let frames = 0, worst = 0, last = performance.now();
    const t0 = last;
    const tick = () => {
      const now = performance.now();
      worst = Math.max(worst, now - last);
      last = now;
      frames++;
      if (now - t0 < ${ms}) requestAnimationFrame(tick);
      else resolve({ frames, ms: Math.round(now - t0), fps: +(frames / ((now - t0) / 1000)).toFixed(1), worstGapMs: Math.round(worst) });
    };
    requestAnimationFrame(tick);
  }))()`;

async function run(name, launcher, opts) {
  const browser = await launcher.launch(opts);
  const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [${name}] page error: ${e.message.slice(0, 120)}`));

  await page.setContent("<h1>control</h1>");
  const control = await page.evaluate(COUNT(1000));
  console.log(`${name}  control (blank page)     ${JSON.stringify(control)}`);

  try {
    await seedPlayedAccount(page);
    await page.goto(`${ORIGIN}/#lobby`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".lobby-screen", { timeout: 30000 });
    await page.waitForTimeout(3000);

    const idle = await page.evaluate(COUNT(1500));
    console.log(`${name}  lobby, idle              ${JSON.stringify(idle)}`);

    // The reported leg. Start counting, then change the hash from inside the
    // same task so the navigation happens inside the measured window.
    const nav = await page.evaluate(`
      (() => new Promise((resolve) => {
        let frames = 0, worst = 0, last = performance.now();
        const t0 = last;
        const tick = () => {
          const now = performance.now();
          worst = Math.max(worst, now - last);
          last = now;
          frames++;
          if (now - t0 < 2500) requestAnimationFrame(tick);
          else resolve({ frames, ms: Math.round(now - t0), fps: +(frames / ((now - t0) / 1000)).toFixed(1), worstGapMs: Math.round(worst) });
        };
        requestAnimationFrame(tick);
        location.hash = '#collection';
      }))()`);
    console.log(`${name}  lobby -> collection      ${JSON.stringify(nav)}`);

    const tier = await page.evaluate(() => ({
      tier: document.documentElement.dataset.gfxTier ?? "(unset)",
      deviceMemory: navigator.deviceMemory ?? null,
      cores: navigator.hardwareConcurrency,
      coarse: matchMedia("(pointer: coarse)").matches,
    }));
    console.log(`${name}  tier/signals             ${JSON.stringify(tier)}`);
  } catch (e) {
    console.log(`${name}  app arm failed: ${String(e).slice(0, 160)}`);
  }
  await browser.close();
}

await run("webkit  ", webkit, { headless: true });
await run("chromium", chromium, { headless: true, executablePath: CHROME, args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
