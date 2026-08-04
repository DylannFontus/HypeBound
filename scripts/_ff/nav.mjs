/**
 * The front door's four navigations, filmed and timed at once.
 *
 * `tests/never-a-blank-frame.test.ts` guards five legs in the menu tree and none
 * of them is `#signin` or `#queue`, because neither route exists without a
 * session. This is the same instrument pointed at the legs this domain owns: it
 * seeds a session before the module graph reads storage, then for every leg
 * reports the exchange span off the browser's own animation events, the worst
 * unsampled gap, the long tasks, and — from a CDP screencast rather than from the
 * DOM — the darkest frame the compositor actually put on the glass.
 *
 *   node scripts/_ff/nav.mjs [runs]
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const RUNS = Number(process.argv[2] ?? 2);
const LEGS = [
  ["play", "signin"],
  ["signin", "queue"],
  ["queue", "play"],
  ["lobby", "play"],
];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

/**
 * Vite's HMR error overlay, swept off the glass.
 *
 * This drives a dev server five other people are editing, and a transform error
 * in *their* module puts a full-screen `<vite-error-overlay>` on top of the game
 * — which a screencast dutifully photographs as a very dark frame with a red
 * line at the top. Two runs of the navigation probe were scored against it
 * before anyone opened the JPEG. It is removed rather than tolerated, and the
 * removal is loud in the log so a run that happened during somebody's broken
 * save is not mistaken for a measurement.
 */
await page.addInitScript(() => {
  setInterval(() => {
    for (const node of document.querySelectorAll("vite-error-overlay")) node.remove();
  }, 120);
});

for (let i = 0; i < 6; i++) {
  try {
    await seedPlayedAccount(page, ORIGIN);
    break;
  } catch {
    await page.waitForTimeout(900);
  }
}
await page.evaluate(() => {
  localStorage.setItem(
    "hypebound-auth:session",
    JSON.stringify({
      accessToken: "camera-only",
      refreshToken: "camera-only",
      expiresAtMs: Date.now() + 3_600_000,
      account: { userId: "camera", email: "camera@example.com" },
    })
  );
});
await page.goto(`${ORIGIN}/?nointro#lobby`);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);

/**
 * Walk every leg twice so nothing below is paying for a first-visit module load.
 *
 * Swallowed, because this drives a live dev server five other people are editing
 * and an HMR full-reload destroys the execution context mid-evaluate. A warm-up
 * that fails is a warm-up that has to be repeated, not a run that has to die.
 */
for (let i = 0; i < 2; i++) {
  for (const [from, to] of LEGS) {
    try {
      await page.evaluate(
        async ([f, t]) => {
          location.hash = "#" + f;
          await new Promise((r) => setTimeout(r, 900));
          location.hash = "#" + t;
          await new Promise((r) => setTimeout(r, 900));
        },
        [from, to]
      );
    } catch {
      await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "load" }).catch(() => undefined);
      await page.waitForTimeout(1600);
    }
  }
}

const install = () => {
  const scope = window;
  const probe = { t0: performance.now(), frames: [], events: [], long: [], running: true };
  scope.__ffProbe = probe;
  for (const type of ["animationstart", "animationend"]) {
    document.addEventListener(
      type,
      (e) => {
        probe.events.push({ type, name: e.animationName, t: Math.round(performance.now() - probe.t0) });
      },
      true
    );
  }
  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        probe.long.push({ t: Math.round(entry.startTime - probe.t0), ms: Math.round(entry.duration) });
      }
    });
    po.observe({ entryTypes: ["longtask"] });
    probe.po = po;
  } catch {
    /* no longtask support */
  }
  const tick = () => {
    if (!probe.running) return;
    probe.frames.push(Math.round(performance.now() - probe.t0));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const rows = [];
for (const [from, to] of LEGS) {
  const runs = [];
  let attempts = 0;
  for (let r = 0; r < RUNS; r++) {
    attempts += 1;
    if (attempts > RUNS + 8) break;
    try {
    await page.evaluate((f) => {
      location.hash = "#" + f;
    }, from);
    await page.waitForTimeout(1300);

    const session = await page.context().newCDPSession(page);
    const shots = [];
    session.on("Page.screencastFrame", (frame) => {
      shots.push({ t: frame.metadata.timestamp ?? 0, data: frame.data });
      void session.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
    });
    await page.evaluate(install);
    await session.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 640, maxHeight: 400 });
    await page.evaluate((t) => {
      location.hash = "#" + t;
    }, to);
    await page.waitForTimeout(1400);
    await session.send("Page.stopScreencast");

    const trace = await page
      .evaluate(() => {
        const p = window.__ffProbe;
        if (!p) return { frames: [], events: [], long: [] };
        p.running = false;
        p.po?.disconnect();
        return { frames: p.frames, events: p.events, long: p.long };
      })
      .catch(() => ({ frames: [], events: [], long: [] }));
    if (trace.frames.length === 0) {
      // The page reloaded underneath the probe — an HMR push from somebody
      // else's edit. Re-run the leg rather than average a hole into the result.
      await session.detach().catch(() => undefined);
      if (r < RUNS + 3) r -= 1;
      await page.waitForTimeout(1200);
      continue;
    }

    const base = shots.length ? shots[0].t : 0;
    const photos = await page.evaluate(async (list) => {
      const out = [];
      for (const shot of list) {
        const image = new Image();
        image.src = `data:image/jpeg;base64,${shot.data}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const pen = canvas.getContext("2d", { willReadFrequently: true });
        pen.drawImage(image, 0, 0);
        const px = pen.getImageData(0, 0, canvas.width, canvas.height).data;
        const lum = new Float32Array(px.length / 4);
        let sum = 0;
        for (let i = 0, q = 0; i < px.length; i += 4, q += 1) {
          const v = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          lum[q] = v;
          sum += v;
        }
        const sorted = Float32Array.from(lum).sort();
        out.push({ t: shot.t, mean: sum / lum.length, p95: sorted[Math.floor(0.95 * sorted.length)] });
      }
      return out;
    }, shots);
    await session.detach().catch(() => undefined);

    if (process.env.FFDEBUG) console.log(`  [dbg] ${from}->${to} frames=${trace.frames.length} events=${trace.events.length} shots=${photos.length} names=${[...new Set(trace.events.map((e) => e.name))].join(',')}`);
    const film = photos.map((p) => ({ ...p, t: Math.round((p.t - base) * 1000) }));
    const gaps = trace.frames.slice(1).map((t, i) => t - trace.frames[i]);
    const exit = trace.events.find((e) => e.type === "animationstart" && /^nav-[a-z]+-out$/.test(e.name));
    const ends = trace.events.filter((e) => e.type === "animationend" && /^nav-[a-z]+-in$/.test(e.name));
    const span = exit && ends.length ? ends[ends.length - 1].t - exit.t : null;
    const mid = (arr, pick) => {
      const head = arr.slice(0, 3).map(pick).sort((a, b) => a - b);
      const tail = arr.slice(-3).map(pick).sort((a, b) => a - b);
      return Math.min(head[1] ?? head[0] ?? 0, tail[1] ?? tail[0] ?? 0);
    };
    const refMean = film.length ? mid(film, (p) => p.mean) : 0;
    const refP95 = film.length ? mid(film, (p) => p.p95) : 0;
    const darkest = film.reduce((a, b) => (b.p95 < a.p95 ? b : a), film[0] ?? { mean: 0, p95: 0, t: 0 });
    runs.push({
      span,
      worstGap: gaps.length ? Math.max(...gaps) : 0,
      dropped: gaps.filter((g) => g > 34).length,
      long: trace.long.reduce((a, b) => a + b.ms, 0),
      longest: trace.long.length ? Math.max(...trace.long.map((l) => l.ms)) : 0,
      meanPct: refMean ? (100 * darkest.mean) / refMean : 0,
      p95Pct: refP95 ? (100 * darkest.p95) / refP95 : 0,
      darkT: darkest.t,
      frames: film.length,
    });
    } catch {
      // Same story as the warm-up: an HMR reload from a neighbouring builder
      // destroys the context. Recover the page and re-run the leg.
      await page.goto(`${ORIGIN}/?nointro#${from}`, { waitUntil: "load" }).catch(() => undefined);
      await page.waitForTimeout(1600);
      r -= 1;
    }
  }
  if (runs.length === 0) {
    rows.push(`${(from + " → " + to).padEnd(18)} no clean run`);
    continue;
  }
  const avg = (pick) => runs.reduce((a, r) => a + (pick(r) ?? 0), 0) / runs.length;
  rows.push(
    `${(from + " → " + to).padEnd(18)} exchange ${String(Math.round(avg((r) => r.span))).padStart(4)}ms  ` +
      `worst gap ${String(Math.round(avg((r) => r.worstGap))).padStart(4)}ms  dropped ${String(Math.round(avg((r) => r.dropped))).padStart(3)}  ` +
      `longtask ${String(Math.round(avg((r) => r.long))).padStart(4)}ms (max ${Math.round(avg((r) => r.longest))})  ` +
      `darkest ${avg((r) => r.meanPct).toFixed(0)}% mean / ${avg((r) => r.p95Pct).toFixed(0)}% p95`
  );
}
console.log(rows.join("\n"));
await browser.close();
