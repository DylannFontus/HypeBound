/**
 * Where the unsampled window on an ordinary menu leg actually is.
 *
 * `tests/never-a-blank-frame.test.ts` reports a >200ms stretch with no rAF
 * sample on `lobby → missions` and `missions → mastery` and cannot say whether
 * it is the constructor, the first paint or the teardown. This records the rAF
 * gaps beside a MutationObserver on `#app`, so every gap is bracketed by
 * "before the destination element existed" or "after it did".
 */
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

const legs = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: BROWSERS.find((p) => existsSync(p)),
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page);

for (const spec of legs) {
  const [from, to] = spec.split(">");
  await page.goto(`${ORIGIN}/#${from}`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    (n) => document.querySelectorAll(".screen").length === 1 && document.querySelector(".screen")?.dataset.nav === "settled" && document.querySelector(".screen")?.classList.contains(n),
    `${from}-screen`,
    { timeout: 40000 }
  );
  await page.waitForTimeout(400);

  const report = await page.evaluate(async (hash) => {
    const t0 = performance.now();
    const events = [];
    const at = () => Math.round(performance.now() - t0);
    const tasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) tasks.push({ t: Math.round(e.startTime - t0), ms: Math.round(e.duration) });
    }).observe({ entryTypes: ["longtask"] });
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) if (n instanceof HTMLElement) events.push({ t: at(), add: n.className.slice(0, 42) });
        for (const n of r.removedNodes) if (n instanceof HTMLElement) events.push({ t: at(), remove: n.className.slice(0, 42) });
      }
    }).observe(document.getElementById("app"), { childList: true });
    document.addEventListener("animationstart", (e) => events.push({ t: at(), anim: e.animationName }), true);

    const frames = [];
    let stop = false;
    const tick = () => {
      frames.push(Math.round(performance.now() - t0));
      if (!stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    location.hash = hash;
    await new Promise((r) => setTimeout(r, 2600));
    stop = true;
    const gaps = [];
    for (let i = 1; i < frames.length; i += 1) {
      const g = frames[i] - frames[i - 1];
      if (g > 60) gaps.push({ from: frames[i - 1], to: frames[i], ms: g });
    }
    return { gaps, tasks: tasks.filter((x) => x.ms > 40), events };
  }, `#${to}`);

  console.log(`\n=== ${from} → ${to} ===`);
  console.log("gaps  :", report.gaps.map((g) => `${g.from}→${g.to} (${g.ms}ms)`).join("  ") || "none");
  console.log("tasks :", report.tasks.map((t) => `${t.t}+${t.ms}`).join("  ") || "none");
  console.log("dom   :");
  for (const e of report.events) console.log("   ", e.t, e.add ? `+ ${e.add}` : e.remove ? `- ${e.remove}` : `@ ${e.anim}`);
}

await browser.close();
