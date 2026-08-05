/**
 * Instrument the data screens' motion rather than inferring it from stills.
 *
 * Records every animationstart/animationend and transitionrun on the incoming
 * screen, plus longtasks and a rAF frame-interval histogram, for a navigation
 * into each route and then for four seconds of idle on it.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => existsSync(p));
const ROUTES = (process.argv[2] ?? "profile,mastery,stats,replays,news,events,story,inbox,patchnotes,leaderboards,settings,custom,gauntlet,tour,doomscroll,remixhub").split(",");
const REDUCED = process.argv[3] === "reduced";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  reducedMotion: REDUCED ? "reduce" : "no-preference",
});
await seedPlayedAccount(page);
await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.evaluate(async () => {
  const profile = await import("/src/save/profile.ts");
  const { getContent } = await import("/src/engine/content.ts");
  const content = getContent();
  const leaders = Object.keys(content.leaders);
  let t = Date.now() - 40 * 3.6e6;
  for (let i = 0; i < 32; i++) {
    t += 3.1e6;
    profile.recordMatch(null, ["win", "loss", "win", "draw"][i % 4], {
      deckName: ["Neon Rush", "Gothic Control", "Meme Tempo", "Corporate Value"][i % 4],
      leaderCardId: leaders[i % leaders.length],
      opponentLeaderCardId: leaders[(i + 4) % leaders.length],
      mode: ["ai-beginner", "ai-standard", "gauntlet", "story"][i % 4],
      content, turns: 6 + (i % 9), now: t,
    });
  }
  (await import("/src/save/storage.ts")).flushAllStores();
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1000);

await page.addInitScript(() => {});

for (const route of ROUTES) {
  // back to lobby first, so every measurement is a real navigation
  await page.evaluate(() => { location.hash = "#lobby"; });
  await page.waitForTimeout(900);

  const nav = await page.evaluate(async (r) => {
    const anims = [];
    const trans = new Set();
    const longtasks = [];
    const frames = [];
    const t0 = performance.now();
    const onStart = (e) => anims.push({ n: e.animationName, t: Math.round(performance.now() - t0), el: (e.target.className || "").toString().split(" ")[0] });
    const onEnd = (e) => anims.push({ n: e.animationName + ":end", t: Math.round(performance.now() - t0) });
    const onTrans = (e) => trans.add(e.propertyName);
    document.addEventListener("animationstart", onStart, true);
    document.addEventListener("animationend", onEnd, true);
    document.addEventListener("transitionrun", onTrans, true);
    let po = null;
    try {
      po = new PerformanceObserver((l) => l.getEntries().forEach((x) => longtasks.push(Math.round(x.duration))));
      po.observe({ entryTypes: ["longtask"] });
    } catch {}
    let last = performance.now();
    let raf = 0;
    const tick = () => { const now = performance.now(); frames.push(now - last); last = now; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);

    // sample "is anything drawn" every 16ms during the transition
    const blanks = [];
    const sampler = setInterval(() => {
      const screens = document.querySelectorAll(".screen");
      let visible = 0;
      for (const s of screens) {
        const cs = getComputedStyle(s);
        if (Number(cs.opacity) > 0.02) visible++;
      }
      blanks.push({ t: Math.round(performance.now() - t0), n: screens.length, v: visible });
    }, 16);

    location.hash = `#${r}`;
    await new Promise((res) => setTimeout(res, 1400));
    clearInterval(sampler);
    cancelAnimationFrame(raf);
    po?.disconnect();
    document.removeEventListener("animationstart", onStart, true);
    document.removeEventListener("animationend", onEnd, true);
    document.removeEventListener("transitionrun", onTrans, true);

    const starts = anims.filter((a) => !a.n.endsWith(":end"));
    const names = {};
    for (const a of starts) names[a.n] = (names[a.n] ?? 0) + 1;
    const delays = starts.map((a) => a.t).sort((a, b) => a - b);
    const ends = anims.filter((a) => a.n.endsWith(":end")).map((a) => a.t);
    const sorted = [...frames].sort((a, b) => a - b);
    return {
      animCount: starts.length,
      names,
      firstStart: delays[0] ?? null,
      lastStart: delays.at(-1) ?? null,
      lastEnd: ends.length ? Math.max(...ends) : null,
      staggerSpread: delays.length > 1 ? delays.at(-1) - delays[0] : 0,
      transitions: [...trans].slice(0, 10),
      longtasks,
      p50frame: Number((sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(1)),
      p95frame: Number((sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1)),
      worstFrame: Number((sorted.at(-1) ?? 0).toFixed(1)),
      blankFrames: blanks.filter((b) => b.v === 0).length,
      blankSamples: blanks.length,
    };
  }, route);

  // idle: is the screen alive at rest?
  const idle = await page.evaluate(async () => {
    const running = () =>
      document.getAnimations().filter((a) => a.playState === "running").map((a) => {
        const k = a.animationName ?? a.transitionProperty ?? "?";
        return k;
      });
    await new Promise((r) => setTimeout(r, 1200));
    const a = running();
    const counts = {};
    for (const n of a) counts[n] = (counts[n] ?? 0) + 1;
    // does anything actually change pixel-wise? sample a computed transform on animated nodes
    const infinite = document.getAnimations().filter((x) => {
      const t = x.effect?.getComputedTiming?.();
      return t && (t.iterations === Infinity);
    }).length;
    return { runningNow: a.length, byName: counts, infinite };
  });

  console.log(JSON.stringify({ route, nav, idle }));
}
await browser.close();
