/**
 * What the two `void element.offsetWidth` lines in `atmosphere.ts` actually
 * cost, timed directly rather than inferred from a sampling profiler.
 *
 * The profiler said `travel` had 111ms of self time on one call and `enterRoom`
 * 40ms. A sampling profiler attributes a forced layout to whichever frame was on
 * the stack when the sample landed, which is exactly the kind of "confident
 * answer to a narrower question" this project keeps getting caught by — so this
 * calls the two methods with a stopwatch either side, on the lobby and again
 * with the Collection's 1,529-node grid in the document, which is the state they
 * are actually called in.
 *
 *   node scripts/_w7leg_reflow.mjs
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const ORIGIN = "http://localhost:5173";
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
// `?nointro` before the seeder, so the first-run cinematic cannot sit on top
// of the starter picker for the whole of its timeout.
await page.goto(`${ORIGIN}/?nointro`, { waitUntil: "networkidle" });
await seedPlayedAccount(page, ORIGIN);

const quiet = () =>
  page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 });

for (const route of ["lobby", "collection", "deckbuilder"]) {
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  await quiet();
  await page.waitForTimeout(2500);
  const out = await page.evaluate(async () => {
    /**
     * The DOM rather than the module. Vite's HMR serves `atmosphere.ts?t=...`,
     * so a dynamic `import()` from here gets a *second* module instance whose
     * `getAtmosphere()` has never been mounted — which is how this probe first
     * reported "-1.0ms" for both. The lines under test are two forced layouts
     * on two named elements, and those are reachable from the document.
     */
    const nodes = document.querySelectorAll("#app *").length;
    const root = document.querySelector(".atmosphere");
    const body = document.querySelector(".atm-body");
    const slot = document.querySelector(".atm-room:not(.is-front)");
    if (!root || !body || !slot) return { nodes, travel: null, room: null };
    const time = (fn) => {
      const a = performance.now();
      fn();
      return performance.now() - a;
    };
    const travels = [];
    const rooms = [];
    const kinds = ["descend", "ascend", "sibling-left", "sibling-right", "replace"];
    for (let i = 0; i < 5; i += 1) {
      // exactly `travel()`: clear the attribute, force layout, set it again
      travels.push(
        time(() => {
          delete root.dataset.travel;
          void body.offsetWidth;
          root.dataset.travel = kinds[i];
        })
      );
      // exactly `enterRoom()`: repaint the back slot, force layout, swap
      rooms.push(
        time(() => {
          slot.style.setProperty("--room-key", i % 2 ? "#b56cff" : "#6f7dff");
          void slot.offsetWidth;
        })
      );
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
    const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
    return { nodes, travel: median(travels), room: median(rooms), travels, rooms };
  });
  console.log(
    `${route.padEnd(13)} #app nodes ${String(out.nodes).padStart(5)}   travel() ${(out.travel ?? -1)
      .toFixed(1)
      .padStart(7)}ms   enterRoom() ${(out.room ?? -1).toFixed(1).padStart(6)}ms`
  );
  console.log(
    `              travel ${(out.travels ?? []).map((n) => n.toFixed(1)).join(" ")}   room ${(out.rooms ?? [])
      .map((n) => n.toFixed(1))
      .join(" ")}`
  );
}

await browser.close();
