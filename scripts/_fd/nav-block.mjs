/**
 * Where does the front door's navigation actually block?
 *
 * rAF gaps say "somewhere"; the Long Animation Frames API says which script and
 * which function. Both are recorded for the same leg so they can be compared.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const legs = process.argv[2]
  ? [process.argv[2].split(">")]
  : [
      ["lobby", "play"],
      ["play", "signin"],
      ["signin", "queue"],
      ["queue", "play"],
    ];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--no-sandbox", "--enable-gpu", "--use-gl=angle"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
for (let i = 0; i < 6; i++) {
  try {
    await seedPlayedAccount(page, ORIGIN);
    break;
  } catch {
    await page.waitForTimeout(900);
  }
}

for (const [from, to] of legs) {
  await page.goto(`${ORIGIN}/#${from}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  const out = await page.evaluate(async (target) => {
    const loaf = [];
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        loaf.push({
          start: e.startTime,
          dur: e.duration,
          block: e.blockingDuration,
          work: e.renderStart ? Math.round(e.renderStart - e.startTime) : null,
          style: e.styleAndLayoutStart ? Math.round(e.duration - (e.styleAndLayoutStart - e.startTime)) : null,
          scripts: (e.scripts ?? []).map((s) => ({
            name: s.name,
            src: `${s.sourceURL ?? ""}:${s.sourceFunctionName ?? ""}`,
            dur: Math.round(s.duration),
            fwd: Math.round(s.forcedStyleAndLayoutDuration ?? 0),
          })),
        });
      }
    });
    try {
      po.observe({ type: "long-animation-frame", buffered: false });
    } catch {
      /* older engine */
    }

    const frames = [];
    let last = performance.now();
    const t0 = last;
    let stop = false;
    const tick = () => {
      const n = performance.now();
      frames.push(Math.round(n - last));
      last = n;
      if (!stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    location.hash = "#" + target;
    await new Promise((r) => setTimeout(r, 1500));
    stop = true;
    po.disconnect();

    const gaps = [];
    let t = 0;
    for (const g of frames) {
      t += g;
      if (g > 34) gaps.push({ at: Math.round(t), gap: g });
    }
    return {
      gaps,
      worst: Math.max(...frames),
      loaf: loaf
        .filter((l) => l.dur > 45)
        .map((l) => ({
          at: Math.round(l.start - t0),
          dur: Math.round(l.dur),
          block: Math.round(l.block),
          scripts: l.scripts.filter((s) => s.dur > 8),
        })),
    };
  }, to);
  console.log(`\n=== ${from} -> ${to} ===`);
  console.log("rAF gaps >34ms:", JSON.stringify(out.gaps));
  for (const l of out.loaf) {
    console.log(`  LoAF at ${l.at}ms  dur ${l.dur}  blocking ${l.block}`);
    for (const s of l.scripts) console.log(`      ${s.dur}ms  ${s.name}  ${s.src}  forcedLayout ${s.fwd}ms`);
  }
}
await browser.close();
