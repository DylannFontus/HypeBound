/**
 * The same twelve screens at every size the constraints name, measured not eyeballed.
 *
 * `verify-mobile.mjs` already passes at four viewports, and it checks three real
 * things: sideways scroll, 44px touch targets, and 11px text. None of those is
 * the question a critic has. The question is whether the screen still *works* —
 * whether the one action it exists for is reachable, whether a label has
 * collided with the value beside it, whether the hero is now below the fold.
 * Those are different failures and a pass on the first says nothing about them.
 *
 * So this takes a picture at every size AND reports, per route:
 *
 *   xscroll   the page scrolls sideways                     (hard fail)
 *   offright  a control whose right edge is past the viewport
 *   cut       a hero or primary action crossing the bottom of its scroller
 *   overlap   two text nodes whose boxes intersect          (the 160% tell)
 *
 * `--ui-scale` is set through `src/save/settings.ts` rather than by writing the
 * custom property, because the property is only half of it: the same setting
 * also drives icon sizing and several grid track calculations, and a sweep that
 * wrote the variable alone would measure a state no player can reach.
 *
 *   node scripts/_ic6_sweep.mjs --size 1280x720 --scale 1.4 --dir <out> --tag s14
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedPlayedAccount } from "./lib/account.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : (argv[i + 1] ?? true);
};
const [VW, VH] = String(flag("size", "1280x720")).split("x").map(Number);
const SCALE = Number(flag("scale", 1));
const TAG = String(flag("tag", `${VW}x${VH}-s${SCALE}`));
const OUT = String(flag("dir", path.join(HERE, "screenshots", "w6", "critic-final", "sweep")));
const ROUTES = String(
  flag(
    "routes",
    "lobby,play,collection,deckbuilder,shop,pass,profile,stats,settings,lab,doomscroll,custom,remixhub,gallery,missions,mastery,decks,events,story,gauntlet,a11y,leaderboards"
  )
).split(",");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
await seedPlayedAccount(page, ORIGIN);

/**
 * Written through the store and flushed, not poked into the custom property.
 *
 * `settingsStore` debounces its save by 250ms, so a write followed immediately
 * by a navigation is lost — which is exactly what the first version of this
 * file did, and it reported `scale=1` on every row while claiming to be
 * sweeping 160%. `flushAllStores` is the same escape hatch `lib/account.mjs`
 * uses for the same reason.
 */
if (SCALE !== 1) {
  const applied = await page.evaluate(async (s) => {
    const mod = await import("/src/save/settings.ts");
    const storage = await import("/src/save/storage.ts");
    // `updateSettings` takes a *patch object*, not a mutator. Passing a function
    // spreads to `{}` and silently changes nothing, which is how the first run
    // of this sweep printed `scale=1` on every row while claiming 160%.
    mod.updateSettings({ uiScale: s });
    storage.flushAllStores();
    return mod.getSettings().uiScale;
  }, SCALE);
  console.log(`settings.uiScale = ${applied}`);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
}

function audit() {
  const vw = window.innerWidth;
  const screen = document.querySelector(".screen");
  const out = { xscroll: false, offright: [], cut: [], overlap: [], scaleSeen: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim() };
  out.xscroll =
    document.documentElement.scrollWidth > vw + 2 ||
    document.body.scrollWidth > vw + 2 ||
    (screen ? screen.scrollWidth > screen.clientWidth + 2 : false);
  if (!screen) return { ...out, err: "no .screen" };

  const label = (e) =>
    `${e.tagName.toLowerCase()}.${String(e.className || "").trim().split(/\s+/).slice(0, 2).join(".")} "${(e.textContent || "").trim().slice(0, 22)}"`;

  const controls = [...screen.querySelectorAll("button, a, input, select, [role='button']")];
  for (const e of controls) {
    const b = e.getBoundingClientRect();
    if (b.width < 4 || b.height < 4) continue;
    if (b.right > vw + 1 || b.left < -1) out.offright.push(`${label(e)} x=${Math.round(b.left)}..${Math.round(b.right)}`);
  }

  const vh = window.innerHeight;
  for (const e of controls) {
    if (!/\b(mat-hero|btn-primary)\b/.test(String(e.className))) continue;
    const b = e.getBoundingClientRect();
    if (b.height < 12) continue;
    let cut = b.top < vh && b.bottom > vh + 1 ? vh : 0;
    for (let p = e.parentElement; p && !cut; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (!/(auto|scroll|hidden)/.test(cs.overflowY)) continue;
      const pb = p.getBoundingClientRect();
      if (b.top < pb.bottom && b.bottom > pb.bottom + 1) cut = pb.bottom;
      break;
    }
    if (cut) out.cut.push(`${label(e)} cut at y=${Math.round(cut)}`);
  }

  /**
   * Two *leaf* text boxes that intersect. Restricted to leaves with real text
   * and to pairs that are not ancestor/descendant, because every label sits
   * inside a box that contains it and a naive intersection test reports the
   * whole document.
   */
  const leaves = [...screen.querySelectorAll("*")].filter((e) => {
    if (e.children.length) return false;
    const t = (e.textContent || "").trim();
    if (!t || t.length < 2) return false;
    const b = e.getBoundingClientRect();
    return b.width > 8 && b.height > 6 && b.bottom > 0 && b.top < window.innerHeight;
  });
  for (let i = 0; i < leaves.length; i += 1) {
    for (let j = i + 1; j < leaves.length; j += 1) {
      const a = leaves[i].getBoundingClientRect();
      const b = leaves[j].getBoundingClientRect();
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 4 && oy > 4) {
        if (getComputedStyle(leaves[i]).position === "absolute" || getComputedStyle(leaves[j]).position === "absolute") continue;
        out.overlap.push(`${label(leaves[i])} X ${label(leaves[j])} (${Math.round(ox)}x${Math.round(oy)}px)`);
      }
      if (out.overlap.length > 6) return out;
    }
  }
  return out;
}

console.log(`\n=== ${TAG} : ${VW}x${VH} @ ui-scale ${SCALE} ===`);
for (const route of ROUTES) {
  await page.goto(`${ORIGIN}/?nointro#${route}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 25000 })
    .catch(() => {});
  await page.waitForTimeout(1300);
  const r = await page.evaluate(audit);
  await page.screenshot({ path: path.join(OUT, `${TAG}-${route}.png`) });
  const bad = [
    r.xscroll ? "XSCROLL" : "",
    r.offright?.length ? `offright=${r.offright.length}` : "",
    r.cut?.length ? `cut=${r.cut.length}` : "",
    r.overlap?.length ? `overlap=${r.overlap.length}` : "",
    r.err ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  console.log(`${route.padEnd(13)} scale=${r.scaleSeen.padEnd(4)} ${bad || "clean"}`);
  for (const s of (r.offright ?? []).slice(0, 3)) console.log(`      offright ${s}`);
  for (const s of (r.cut ?? []).slice(0, 3)) console.log(`      cut      ${s}`);
  for (const s of (r.overlap ?? []).slice(0, 3)) console.log(`      overlap  ${s}`);
}

await browser.close();
