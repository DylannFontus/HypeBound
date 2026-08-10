/**
 * What the engine says about itself, and therefore what tier the game picks.
 *
 * The iPad report is engine-shaped, so before measuring anything the first
 * question is whether the two engines even take the same branch through
 * `atmosphere.ts::detectTier`. That function reads `navigator.deviceMemory`,
 * which is a Chromium-only API — every other engine gets the `?? 4` fallback
 * and is therefore classified by a number nobody measured. This prints the
 * inputs and the answer so the claim is a reading rather than an assertion.
 */

import { chromium, webkit } from "playwright-core";
import { existsSync } from "node:fs";

const ORIGIN = "http://localhost:5173";
const CHROME = ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((p) => existsSync(p));

const IPAD = { width: 1194, height: 834 };

async function probe(name, type, opts) {
  const browser = await type.launch({ headless: true, ...(opts ?? {}) });
  const context = await browser.newContext({
    viewport: IPAD,
    deviceScaleFactor: 2,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/#lobby?nointro=1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const out = await page.evaluate(() => {
    const nav = navigator;
    const supports = (prop, value) => {
      try {
        return CSS.supports(prop, value);
      } catch {
        return false;
      }
    };
    return {
      ua: nav.userAgent,
      deviceMemory: nav.deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
      coarse: matchMedia("(pointer: coarse)").matches,
      gfxTier: document.documentElement.dataset.gfxTier,
      dpr: devicePixelRatio,
      screens: document.querySelectorAll(".screen").length,
      rooms: document.querySelectorAll(".d-room").length,
      roomLayers: document.querySelectorAll(".d-room > *").length,
      atmVisible: !!document.querySelector(".atmosphere"),
      support: {
        backdropFilter: supports("backdrop-filter", "blur(4px)"),
        webkitBackdropFilter: supports("-webkit-backdrop-filter", "blur(4px)"),
        colorMix: supports("color", "color-mix(in srgb, red 10%, transparent)"),
        maskImage: supports("mask-image", "linear-gradient(#000, transparent)"),
        contain: supports("contain", "layout paint style"),
        atProperty: typeof CSS !== "undefined" && "registerProperty" in CSS,
        inert: "inert" in HTMLElement.prototype,
        getAnimations: typeof document.documentElement.getAnimations === "function",
        requestIdleCallback: typeof requestIdleCallback === "function",
      },
    };
  });
  await browser.close();
  return { name, ...out };
}

const runs = [];
runs.push(await probe("chromium", chromium, CHROME ? { executablePath: CHROME } : {}));
runs.push(await probe("webkit", webkit, {}));
for (const r of runs) console.log(JSON.stringify(r, null, 2));
