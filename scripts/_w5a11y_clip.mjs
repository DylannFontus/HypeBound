/**
 * Where does the interface cut through its own letters?
 *
 * `--ui-scale` grows every rem in the app and leaves every `px` and `vh` where
 * it was, so any box sized in the second unit and filled with the first will
 * eventually clip. A screenshot only catches it where somebody happens to look,
 * and the razor is quiet: the lobby's nine destination tiles were slicing their
 * subtitles through the x-height at 140% on the most-visited screen in the game
 * and four waves of visual review walked past it.
 *
 * So this asks the DOM directly. For every element that hides its overflow, it
 * compares scroll size to client size — the browser's own statement that there
 * is more content than box — and reports the ones carrying text.
 *
 *   node scripts/_w5a11y_clip.mjs 1280x720 1 1.4 1.6
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const [sizeArg, ...scaleArgs] = process.argv.slice(2);
const [w, h] = (sizeArg ?? "1280x720").split("x").map(Number);
const scales = scaleArgs.length > 0 ? scaleArgs.map(Number) : [1, 1.4, 1.6];

const ROUTES = [
  "lobby", "play", "collection", "decks", "deckbuilder", "shop", "missions",
  "profile", "gauntlet", "events", "a11y", "settings", "mastery", "story",
  "stats", "gallery", "achievements", "leaderboards", "queue", "pass", "news", "inbox",
];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await seedPlayedAccount(page);

for (const scale of scales) {
  console.log(`\n================ ${w}x${h} @ --ui-scale ${scale} ================`);
  for (const route of ROUTES) {
    await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
    await page.evaluate((s) => document.documentElement.style.setProperty("--ui-scale", String(s)), scale);
    await page
      .waitForFunction(
        () =>
          document.getAnimations().filter((a) => {
            if (a.playState !== "running") return false;
            const t = a.effect?.getTiming?.();
            return Boolean(t) && t.iterations !== Infinity;
          }).length === 0,
        null,
        { timeout: 6000 }
      )
      .catch(() => {});
    await page.waitForTimeout(300);

    const hits = await page.evaluate(() => {
      const found = [];
      const seen = new Set();
      for (const el of document.querySelectorAll(".screen:not(.screen-out) *")) {
        const s = getComputedStyle(el);
        const hidesY = s.overflowY === "hidden" || s.overflowY === "clip";
        const hidesX = s.overflowX === "hidden" || s.overflowX === "clip";
        if (!hidesY && !hidesX) continue;
        const overY = hidesY ? el.scrollHeight - el.clientHeight : 0;
        const overX = hidesX ? el.scrollWidth - el.clientWidth : 0;
        if (overY < 2 && overX < 2) continue;
        // Only text matters here; a clipped decorative layer is a decision.
        const text = (el.innerText ?? "").trim().replace(/\s+/g, " ").slice(0, 34);
        if (text.length < 3) continue;
        // `text-overflow: ellipsis` on a nowrap line is a designed truncation.
        if (overX >= 2 && overY < 2 && s.textOverflow === "ellipsis" && s.whiteSpace.startsWith("nowrap")) continue;
        // So is `-webkit-line-clamp`: the ellipsis is drawn and the reader can see it.
        if (s.webkitLineClamp && s.webkitLineClamp !== "none") continue;
        // Visually-hidden text is meant to be a 1px box.
        if (/\b(sr-only|rw-sr|visually-hidden)\b/.test(String(el.className))) continue;
        // A container clipping a positioned decoration is not clipping its copy.
        if (el.children.length > 0 && [...el.children].some((c) => { const cs = getComputedStyle(c); return cs.position === "absolute" || cs.position === "fixed"; })) continue;
        const key = `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")}|${overX}|${overY}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")} clipped ${overX}px wide / ${overY}px tall — "${text}"`);
      }
      return found;
    });
    if (hits.length > 0) {
      console.log(`  --- #${route}`);
      for (const hit of hits.slice(0, 12)) console.log(`    ${hit}`);
    }
  }
}

await browser.close();
