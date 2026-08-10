/**
 * Did the rule I wrote actually win the cascade?
 *
 * Between a stylesheet edit and a measurement sits the question nobody asks
 * until the numbers come back strange: is the declaration in effect at all. The
 * low-tier crawl rule measured as though it had changed nothing, and there are
 * two very different explanations — the change is worthless, or the change is
 * not applying — which look identical in a byte count. This prints the computed
 * style so they stop looking identical.
 */

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((p) => existsSync(p));
const TIER = process.argv[2] ?? "low";


/**
 * Force the graphics tier, and force it in the only place that cannot lose.
 *
 * `page.addInitScript` looked like the obvious way to do this and silently did
 * nothing: an init script runs at document-start, `document.documentElement` is
 * still null at that point, and the assignment throws into a void Playwright
 * does not surface. Three separate measurements in this pass were labelled
 * `tier=low` and taken at `high`, which is instrument fifteen and was caught
 * only because a rule that provably applies measured as though it did not.
 *
 * Rewriting the served HTML puts the attribute on `<html>` before a single byte
 * is parsed, so `atmosphere.ts::detectTier` reads it as a declared answer and
 * every tier-gated rule in the stylesheet is live from first paint. The probe
 * then re-reads the tier out of the page and refuses to report under a label it
 * has not confirmed.
 */
async function forceTier(context, tier) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (request.resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    const body = (await response.text()).replace(/<html/i, `<html data-gfx-tier="${tier}"`);
    return route.fulfill({ response, body });
  });
}

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME ?? undefined,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true });
await forceTier(context, TIER);
const page = await context.newPage();
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(3000);

const out = await page.evaluate(() => {
  const q = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return "(absent)";
    const cs = getComputedStyle(el);
    return {
      display: cs.display,
      animationName: cs.animationName,
      willChange: cs.willChange,
      transform: cs.transform === "none" ? "none" : cs.transform.slice(0, 46),
    };
  };
  const screen = document.querySelector(".screen");
  const scs = getComputedStyle(screen);
  return {
    tier: document.documentElement.dataset["gfxTier"],
    "d-room-crawl": q(".d-room-crawl"),
    "d-room-grid": q(".d-room-grid"),
    "d-room-dust": q(".d-room-dust"),
    "atm-grid": q(".atm-grid"),
    "atm-fore-grain": q(".atm-fore-grain"),
    "atm-body": q(".atm-body"),
    screen: { nav: screen.dataset["nav"], willChange: scs.willChange, filter: scs.filter },
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
