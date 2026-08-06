/**
 * What the player actually sees between two screens, measured three ways at once.
 *
 * `page.screenshot` blocks the very thread whose stalls are the thing under
 * test, and an rAF gap trace cannot see a compositor-driven curtain at all —
 * both of those cost this project review rounds. So the frames here come off a
 * CDP screencast (compositor output, unaffected by main-thread blocking), the
 * choreography comes from `animationstart`/`animationend` recorded in the page,
 * and the blocking comes from a `longtask` PerformanceObserver. Three
 * instruments that fail in different directions; where they agree, believe them.
 *
 *   node scripts/_ic_motion.mjs --legs "lobby>play,lobby>collection" --dir <out>
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : (argv[i + 1] ?? true);
};
const legs = String(flag("legs", "lobby>play")).split(",").map((s) => s.trim().split(">"));
const dir = String(flag("dir", "scripts/screenshots/w3/integration/motion"));
const [vw, vh] = String(flag("size", "1600x900")).split("x").map(Number);
const hold = Number(flag("hold", 2600));
const writeFrames = argv.includes("--frames");

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
await seedPlayedAccount(page, ORIGIN);

for (const [from, to] of legs) {
  await page.goto(`${ORIGIN}/?nointro#${from}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(1400);

  await page.evaluate(() => {
    const w = window;
    w.__ic = { anim: [], long: [], t0: 0 };
    const on = (e) =>
      w.__ic.anim.push({
        phase: e.type === "animationstart" ? "s" : "e",
        name: e.animationName,
        at: Math.round(performance.now() - w.__ic.t0),
        on: String(e.target.className || e.target.tagName).slice(0, 44),
      });
    document.addEventListener("animationstart", on, true);
    document.addEventListener("animationend", on, true);
    new PerformanceObserver((l) => {
      for (const en of l.getEntries())
        w.__ic.long.push({ at: Math.round(en.startTime - w.__ic.t0), ms: Math.round(en.duration) });
    }).observe({ entryTypes: ["longtask"] });
  });

  const session = await page.context().newCDPSession(page);
  const shots = [];
  session.on("Page.screencastFrame", (f) => {
    shots.push({ t: f.metadata.timestamp ?? 0, data: f.data });
    void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await session.send("Page.startScreencast", {
    format: "jpeg",
    quality: 80,
    everyNthFrame: 1,
    maxWidth: vw,
    maxHeight: vh,
  });
  await page.waitForTimeout(320);

  const clickWall = Date.now();
  await page.evaluate((h) => {
    window.__ic.t0 = performance.now();
    location.hash = h;
  }, `#${to}`);
  await page.waitForTimeout(hold);
  await session.send("Page.stopScreencast");

  const rec = await page.evaluate(() => window.__ic);
  await session.detach().catch(() => {});

  const frames = shots
    .map((s) => ({ t: Math.round(s.t * 1000 - clickWall), data: s.data }))
    .filter((f) => f.t > -120);
  const times = frames.map((f) => f.t);
  const gaps = [];
  for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);
  gaps.sort((a, b) => b - a);

  const legDir = `${dir}/${from}-to-${to}`;
  if (writeFrames) {
    mkdirSync(legDir, { recursive: true });
    for (const f of frames)
      writeFileSync(`${legDir}/t${String(Math.max(0, f.t)).padStart(5, "0")}.jpg`, Buffer.from(f.data, "base64"));
  }

  const anim = rec.anim.filter((a) => a.at >= -40 && a.at < hold);
  const starts = anim.filter((a) => a.phase === "s");
  const ends = anim.filter((a) => a.phase === "e");
  const names = [...new Set(starts.map((a) => a.name))];
  const lastEnd = ends.length ? Math.max(...ends.map((a) => a.at)) : null;
  const firstStart = starts.length ? Math.min(...starts.map((a) => a.at)) : null;

  console.log(
    JSON.stringify(
      {
        leg: `${from} -> ${to}`,
        composited: {
          frames: frames.length,
          spanMs: times.length ? times[times.length - 1] - times[0] : 0,
          worstGapMs: gaps[0] ?? null,
          top3Gaps: gaps.slice(0, 3),
          firstFrameAfterClickMs: times.find((t) => t >= 0) ?? null,
        },
        longTasks: rec.long.filter((l) => l.at >= -50 && l.at < 1600),
        animation: {
          distinctKeyframes: names.length,
          names: names.slice(0, 14),
          firstStartMs: firstStart,
          lastEndMs: lastEnd,
          settleMs: lastEnd,
          starts: starts.slice(0, 10),
        },
        framesWritten: writeFrames ? legDir : null,
      },
      null,
      1
    )
  );
}

await browser.close();
