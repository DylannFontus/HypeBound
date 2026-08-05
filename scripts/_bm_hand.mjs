/**
 * Battle-motion measurement: the deal, the hand's cascade, the hover spread and
 * the carried card.
 *
 * Everything here is instrumented rather than photographed. Four earlier review
 * rounds were wasted judging motion from stills, and a cascade in particular is
 * invisible in one: what tells you whether seven cards arrived together is seven
 * `animationstart` timestamps, not a picture of seven cards.
 *
 * Hover and drag go through `page.mouse`, not synthetic `PointerEvent`s: a
 * dispatched event does not put the element into `:hover`, so a synthetic hover
 * measures the stylesheet's resting state and reports it as a defect.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
import { suppressHmrReload } from "./lib/nohmr.mjs";

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const OUT = arg("dir", "D:/Gooner Card Game/scripts/screenshots/w2/battlemotion");
mkdirSync(OUT, { recursive: true });
const [W, H] = String(arg("size", "1600x900")).split("x").map(Number);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
let reloads = 0;
page.on("framenavigated", (f) => { if (f === page.mainFrame()) reloads++; });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

await page.addInitScript(() => {
  window.__anim = [];
  window.__deal = 0;
  document.addEventListener("animationstart", (e) => {
    window.__anim.push({ n: e.animationName, t: performance.now() });
  }, true);
  window.__long = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__long.push({ t: e.startTime, d: e.duration });
    }).observe({ entryTypes: ["longtask"] });
  } catch {}
  window.__gaps = [];
  let last = 0;
  const tick = (now) => { if (last) window.__gaps.push({ t: now, d: now - last }); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

await suppressHmrReload(page);
await seedPlayedAccount(page);
await page.goto("http://localhost:5173/?nointro#battle", { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 30000 });
await page.waitForTimeout(1200);

// --- the deal ---------------------------------------------------------------
const navBefore = reloads;
await page.evaluate(() => {
  window.__anim.length = 0; window.__long.length = 0; window.__gaps.length = 0;
  window.__deal = performance.now();
  document.querySelector(".mulligan-actions .btn-primary")?.click();
});
await page.waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1600);
if (reloads !== navBefore) console.log(`!! page navigated ${reloads - navBefore} times during the deal — timings below are suspect`);

const deal = await page.evaluate(() => {
  const t0 = window.__deal;
  const rel = (t) => Math.round(t - t0);
  const named = (n) => window.__anim.filter((a) => a.n === n).map((a) => rel(a.t));
  return {
    t0,
    hand: named("hand-card-in"),
    turn: named("hand-card-turn"),
    long: window.__long.filter((e) => e.t >= t0).map((e) => ({ t: rel(e.t), d: Math.round(e.d) })),
    gaps: window.__gaps.filter((g) => g.t >= t0 && g.d > 40).map((g) => ({ t: rel(g.t), d: Math.round(g.d) })),
    frames: window.__gaps.filter((g) => g.t >= t0).length,
    styles: [...document.querySelectorAll(".hand-card")].map((el) => ({
      delay: getComputedStyle(el).animationDelay,
      from: `${el.style.getPropertyValue("--from-x")},${el.style.getPropertyValue("--from-y")}`,
    })),
    piles: ["deck-x", "deck-y", "discard-x", "discard-y"].map(
      (n) => `${n}=${getComputedStyle(document.documentElement).getPropertyValue(`--pile-${n}`).trim()}`
    ),
  };
});

console.log("=== DEAL ===");
console.log("t0 valid:", Number.isFinite(deal.t0) && deal.t0 > 0);
console.log("hand-card-in starts (ms after confirm):", deal.hand.join(", ") || "(none)");
if (deal.hand.length > 1) console.log(`  spread = ${Math.max(...deal.hand) - Math.min(...deal.hand)}ms across ${deal.hand.length} cards`);
console.log("hand-card-turn starts:", deal.turn.join(", ") || "(none)");
console.log("animation-delay per card:", deal.styles.map((s) => s.delay).join(", "));
console.log("--from-x,--from-y per card:", deal.styles.map((s) => s.from).join(" | "));
console.log("pile origins:", deal.piles.join("  "));
console.log(`frames sampled: ${deal.frames}`);
console.log("long tasks > 50ms:", deal.long.map((e) => `${e.t}ms:${e.d}ms`).join(", ") || "(none)");
console.log("rAF gaps > 40ms:", deal.gaps.map((g) => `${g.t}ms:${g.d}ms`).join(", ") || "(none)");
console.log("worst rAF gap:", deal.gaps.reduce((a, g) => Math.max(a, g.d), 0) + "ms");

// --- hover: do the neighbours give way? -------------------------------------
const boxes = await page.evaluate(() =>
  [...document.querySelectorAll(".hand-card")].map((c) => {
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) };
  })
);
console.log("\n=== HOVER ===");
console.log("resting sizes:", boxes.map((b) => `${b.w}x${b.h}`).join(", "));
const pick = Math.min(3, boxes.length - 1);
if (boxes.length >= 3) {
  await page.mouse.move(boxes[pick].x, boxes[pick].y);
  await page.waitForTimeout(340);
  const after = await page.evaluate(() =>
    [...document.querySelectorAll(".hand-card")].map((c) => {
      const r = c.getBoundingClientRect();
      return {
        w: Math.round(r.width), h: Math.round(r.height),
        x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
        spread: c.style.getPropertyValue("--spread-x") || "-",
        tr: getComputedStyle(c).transform,
      };
    })
  );
  console.log(`hovering index ${pick}:`);
  after.forEach((a, i) => {
    console.log(
      `  [${i}]${i === pick ? "*" : " "} ${a.w}x${a.h}  dx=${a.x - Math.round(boxes[i].x)} dy=${a.y - Math.round(boxes[i].y)}  --spread-x=${a.spread}`
    );
  });
  const scale = (after[pick].w / boxes[pick].w).toFixed(3);
  console.log(`  hovered scale = ${scale}x; neighbours moved = ${after.filter((a, i) => i !== pick && Math.abs(a.x - Math.round(boxes[i].x)) > 0).length}`);
  await page.mouse.move(W / 2, 40);
  await page.waitForTimeout(260);
}

// --- carried: is the ghost bigger than rest and hover? ----------------------
console.log("\n=== CARRIED ===");
const playable = await page.evaluate(() => {
  const c = document.querySelector(".hand-card.playable");
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) };
});
if (!playable) {
  console.log("no playable card in hand — skipped");
} else {
  await page.mouse.move(playable.x, playable.y);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.move(playable.x + 20, playable.y - 40, { steps: 3 });
  const swings = [];
  for (let i = 0; i < 9; i++) {
    await page.mouse.move(playable.x + 20 + i * 42, playable.y - 40 - i * 16, { steps: 1 });
    await page.waitForTimeout(24);
    swings.push(await page.evaluate(() => document.querySelector(".hand-drag-ghost")?.style.transform ?? "(none)"));
  }
  await page.waitForTimeout(260);
  const carried = await page.evaluate(() => {
    const ghost = document.querySelector(".hand-drag-ghost");
    const gc = ghost?.querySelector("canvas");
    const sh = ghost?.querySelector(".hand-drag-shadow");
    const r = gc?.getBoundingClientRect();
    return {
      ghost: r ? `${Math.round(r.width)}x${Math.round(r.height)}` : "(none)",
      lifted: ghost?.classList.contains("lifted") ?? false,
      box: gc ? getComputedStyle(gc).boxShadow.slice(0, 96) : "-",
      outline: gc ? getComputedStyle(gc).outline : "-",
      shadowT: sh ? getComputedStyle(sh).transform : "(none)",
      shadowO: sh ? getComputedStyle(sh).opacity : "-",
    };
  });
  console.log(`resting ${playable.w}x${playable.h}  ->  carried ${carried.ghost}  lifted=${carried.lifted}`);
  console.log(`  rim: ${carried.box}`);
  console.log(`  outline: ${carried.outline}`);
  console.log(`  ground shadow: ${carried.shadowT} @ ${carried.shadowO}`);
  console.log("  ghost transforms while moving:");
  for (const s of swings) console.log("   ", s);
  await page.screenshot({ path: `${OUT}/carried.png` });
  await page.mouse.up();
  await page.waitForTimeout(500);
}

await page.screenshot({ path: `${OUT}/board-after.png` });
console.log(`\nnavigations during run: ${reloads}`);
await browser.close();
