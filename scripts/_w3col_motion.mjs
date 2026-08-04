/**
 * Record what actually animates in the collection domain.
 *
 * Stills cannot show motion and four review rounds were wasted trying. This
 * listens for animationstart/animationend and transitionstart/transitionend on
 * the whole document, plus long tasks, and prints what ran, for how long, and
 * with what stagger — which is the only way to say whether a cascade is a
 * cascade or a single pop.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const scenario = process.argv[2] ?? "enter";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
for (let i = 0; i < 5; i++) {
  try { await seedPlayedAccount(page, ORIGIN); break; } catch { await page.waitForTimeout(900); }
}

const arm = async () =>
  page.evaluate(() => {
    const w = window;
    w.__anim = [];
    w.__tasks = [];
    w.__t0 = performance.now();
    const push = (kind, e) => {
      const target = e.target;
      const name = e.animationName ?? e.propertyName ?? "?";
      w.__anim.push({
        kind,
        name,
        at: Math.round(performance.now() - w.__t0),
        cls: (target?.className && String(target.className).slice(0, 44)) || target?.tagName || "?",
      });
    };
    for (const type of ["animationstart", "animationend", "transitionstart", "transitionend"]) {
      document.addEventListener(type, (e) => push(type, e), true);
    }
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__tasks.push(Math.round(entry.duration));
    }).observe({ entryTypes: ["longtask"] });
  });

const report = async (label) => {
  const out = await page.evaluate(() => ({ anim: window.__anim, tasks: window.__tasks }));
  const starts = out.anim.filter((a) => a.kind === "animationstart");
  const byName = new Map();
  for (const a of starts) {
    const entry = byName.get(a.name) ?? { n: 0, first: a.at, last: a.at };
    entry.n += 1;
    entry.first = Math.min(entry.first, a.at);
    entry.last = Math.max(entry.last, a.at);
    byName.set(a.name, entry);
  }
  console.log(`\n=== ${label} ===`);
  for (const [name, e] of [...byName.entries()].sort((a, b) => a[1].first - b[1].first)) {
    console.log(
      `  ${name.padEnd(22)} x${String(e.n).padEnd(4)} first ${String(e.first).padStart(5)}ms  last ${String(e.last).padStart(5)}ms  spread ${e.last - e.first}ms`
    );
  }
  const trans = out.anim.filter((a) => a.kind === "transitionstart");
  const tnames = new Map();
  for (const t of trans) tnames.set(t.name, (tnames.get(t.name) ?? 0) + 1);
  if (tnames.size) console.log("  transitions:", [...tnames.entries()].map(([k, v]) => `${k}x${v}`).join(", "));
  const worst = Math.max(0, ...out.tasks);
  console.log(`  long tasks: ${out.tasks.length}, worst ${worst}ms, total ${out.tasks.reduce((a, b) => a + b, 0)}ms`);
};

if (scenario === "enter") {
  await page.goto(`${ORIGIN}/#lobby`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await arm();
  await page.evaluate(() => { location.hash = "#collection"; });
  await page.waitForTimeout(2600);
  await report("lobby -> collection");
} else if (scenario === "filter") {
  await page.goto(`${ORIGIN}/#collection`, { waitUntil: "networkidle" });
  await page.waitForSelector(".card-cell");
  await page.waitForTimeout(2600);
  await arm();
  await page.click("#col-search");
  await page.keyboard.type("light", { delay: 60 });
  await page.waitForTimeout(1400);
  await report("typing 'light'");
} else if (scenario === "hover") {
  await page.goto(`${ORIGIN}/#collection`, { waitUntil: "networkidle" });
  await page.waitForSelector(".card-cell canvas");
  await page.waitForTimeout(2600);
  await arm();
  const box = await (await page.$(".card-cell")).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await page.waitForTimeout(500);
  const lifted = await page.evaluate(() => {
    const cell = document.querySelector(".card-cell");
    const cs = getComputedStyle(cell);
    return { transform: cs.transform, shadow: cs.boxShadow.slice(0, 90), filter: cs.filter };
  });
  await page.screenshot({ path: "scripts/screenshots/w2/collection/r5-hover.png" });
  console.log("hovered cell:", JSON.stringify(lifted, null, 1));
  await report("hover one tile");
} else if (scenario === "detail") {
  await page.goto(`${ORIGIN}/#collection`, { waitUntil: "networkidle" });
  await page.waitForSelector(".card-cell canvas");
  await page.waitForTimeout(2600);
  await arm();
  await page.click(".card-cell");
  await page.waitForTimeout(200);
  await page.screenshot({ path: "scripts/screenshots/w2/collection/r5-detail-mid.png" });
  await page.waitForTimeout(1000);
  await report("open card detail");
} else if (scenario === "add") {
  await page.goto(`${ORIGIN}/#deckbuilder`, { waitUntil: "networkidle" });
  await page.waitForSelector(".pool-cell canvas");
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    for (const b of document.querySelectorAll(".builder-actions .btn")) if (b.textContent === "Clear") b.click();
  });
  await page.waitForTimeout(700);
  await arm();
  await page.click(".pool-cell:not(.unowned)");
  await page.waitForTimeout(900);
  await report("add one card to the deck");
}

await browser.close();
