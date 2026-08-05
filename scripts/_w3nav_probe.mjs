/**
 * The navigation stall, measured five ways at once.
 *
 * Every earlier instrument answered one question and was believed about the
 * other four. `page.screenshot` blocks, so it cannot sample a stall; an rAF gap
 * trace runs on the main thread, so it reports blocking whether or not the
 * player saw anything wrong; a DOM opacity probe cannot tell a lit screen from
 * a screen at 12% over black. So this runs all of them together on the same
 * navigation and prints them side by side:
 *
 *   - long tasks, from the hash change to the first frame that changed pixels
 *   - the compositor's own frames, as luminance and as frame-to-frame delta
 *   - when the picture first moved, which is the only honest "did it respond"
 *   - animationstart/animationend, to catch a keyframe whose clock was eaten
 *   - the cover's own motion, against Hearthstone's 0.6-1.3/200ms idle floor
 *
 *   node scripts/_w3nav_probe.mjs lobby collection lobby missions lobby --size 1600x900
 *
 * Legs are read pairwise off the list: a→b, b→c, c→d. `--battle` seeds a match
 * route. Nothing here asserts; it prints, because the numbers are the point.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};
const VALUED = new Set(["--size"]);
const routes = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith("--")) {
    if (VALUED.has(argv[i])) i += 1;
    continue;
  }
  routes.push(argv[i]);
}
const [vw, vh] = String(flag("size", "1600x900")).split("x").map(Number);
const ORIGIN = "http://localhost:5173";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
await seedPlayedAccount(page, ORIGIN);

const settled = (id, timeout = 40000) =>
  page
    .waitForFunction(
      (name) => {
        const screens = document.querySelectorAll(".screen");
        const only = screens[0];
        return screens.length === 1 && only && only.dataset.nav === "settled" && only.classList.contains(name);
      },
      `${id}-screen`,
      { timeout }
    )
    .then(
      () => true,
      () => false
    );

/** Decode a screencast reel inside the page and reduce it to numbers. */
const REDUCE = async (shots) => {
  const out = [];
  let previous = null;
  for (const shot of shots) {
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
    for (let i = 0, p = 0; i < px.length; i += 4, p += 1) {
      const v = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      lum[p] = v;
      sum += v;
    }
    let delta = 0;
    let moved = 0;
    if (previous !== null) {
      let acc = 0;
      for (let p = 0; p < lum.length; p += 1) {
        const d = Math.abs(lum[p] - previous[p]);
        acc += d;
        if (d >= 12) moved += 1;
      }
      delta = acc / lum.length;
      moved = (100 * moved) / lum.length;
    }
    previous = lum;
    const sorted = Float32Array.from(lum).sort();
    out.push({
      t: shot.t,
      mean: sum / lum.length,
      p95: sorted[Math.floor(0.95 * sorted.length)],
      delta,
      moved,
    });
  }
  return out;
};

async function leg(from, to) {
  await page.goto(`${ORIGIN}/#${from}`, { waitUntil: "networkidle" });
  const ok = await settled(from);
  await page.waitForTimeout(500);

  const session = await page.context().newCDPSession(page);
  const shots = [];
  session.on("Page.screencastFrame", (f) => {
    shots.push({ t: f.metadata.timestamp ?? 0, data: f.data });
    void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });

  /**
   * Installed once per document, not once per leg.
   *
   * Setting `location.hash` is a same-document navigation, so a probe attached
   * per leg accumulates: five legs meant five long-task observers, five sets of
   * animation listeners and five rAF loops, which is how an earlier run of this
   * script reported 385 frames in 1.6 seconds on a page drawing 77.
   */
  await page.evaluate(() => {
    const w = window;
    if (w.__probed === true) return;
    w.__probed = true;
    w.__long = [];
    w.__anim = [];
    w.__raf = [];
    w.__t0 = performance.now();
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__long.push([Math.round(e.startTime - w.__t0), Math.round(e.duration)]);
    }).observe({ entryTypes: ["longtask"] });
    for (const type of ["animationstart", "animationend", "animationcancel"]) {
      document.addEventListener(
        type,
        (e) => w.__anim.push([type[9], e.animationName, Math.round(performance.now() - w.__t0)]),
        true
      );
    }
    const tick = () => {
      w.__raf.push(Math.round(performance.now() - w.__t0));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await session.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 480, maxHeight: 300 });
  /**
   * The click, on the screencast's own clock.
   *
   * `metadata.timestamp` is seconds since the epoch, so the only honest way to
   * ask "how long after the press did a pixel move" is to take the same clock
   * on this side of the wire immediately before setting the hash. Aligning on
   * "the frame before the first one that changed" — which is what this used to
   * do — measures the *gap* at the moment of movement and reports a blocked
   * thread as a slow response, which are two different defects.
   */
  const clickWall = Date.now();
  await page.evaluate((hash) => {
    const w = window;
    w.__long.length = 0;
    w.__anim.length = 0;
    w.__raf.length = 0;
    w.__t0 = performance.now();
    location.hash = hash;
  }, `#${to}`);
  await settled(to);
  await page.waitForTimeout(700);
  await session.send("Page.stopScreencast");

  const { long, anim, raf, veiled } = await page.evaluate(() => ({
    long: window.__long,
    anim: window.__anim,
    raf: window.__raf,
    veiled: document.querySelector(".nav-curtain") !== null,
  }));
  const rel = (await page.evaluate(REDUCE, shots)).map((f) => ({ ...f, t: Math.round(f.t * 1000 - clickWall) }));
  await session.detach().catch(() => {});

  const after = rel.filter((f) => f.t >= 0);
  const firstMove = after.find((f) => f.delta > 0.4) ?? null;
  const settleAt = (() => {
    for (let i = after.length - 1; i >= 0; i -= 1) if (after[i].delta > 0.4) return after[i].t;
    return 0;
  })();
  const in1600 = after.filter((f) => f.t <= 1600).length;
  const rafIn1600 = raf.filter((t) => t <= 1600).length;
  const worstLong = long.reduce((a, b) => (b[1] > a ? b[1] : a), 0);
  const unique = [...new Map(long.map((l) => [`${l[0]}:${l[1]}`, l])).values()].sort((a, b) => a[0] - b[0]);
  const beforeFirstPaint = unique.filter((l) => l[0] <= (firstMove?.t ?? 0));

  console.log(
    `\n${from} -> ${to}   ${veiled ? "[veiled]" : ""}\n` +
      `  first pixel movement   ${firstMove === null ? "never" : `${firstMove.t}ms`} after the click   (delta ${(firstMove?.delta ?? 0).toFixed(2)})\n` +
      `  last pixel movement    ${settleAt}ms\n` +
      `  compositor frames      ${after.length} total, ${in1600} in the first 1600ms; rAF ${rafIn1600} in 1600ms\n` +
      `  long tasks             ${unique.length} (${unique.map((l) => `${l[1]}@${l[0]}`).join(" ")}); worst ${worstLong}ms; before first paint: ${beforeFirstPaint.map((l) => `${l[1]}@${l[0]}`).join(", ") || "none"}\n` +
      `  darkest frame          mean ${Math.min(...after.map((f) => f.mean)).toFixed(1)}, p95 ${Math.min(...after.map((f) => f.p95)).toFixed(1)}  (settled mean ${after[after.length - 1].mean.toFixed(1)}, p95 ${after[after.length - 1].p95.toFixed(1)})\n` +
      `  quietest 200ms window  ${quietest(after).toFixed(3)} mean delta/255  (Hearthstone idle floor 0.6-1.3)\n` +
      `  nav animations         ${anim.filter((a) => a[1].startsWith("nav-")).map((a) => `${a[0]}:${a[1]}@${a[2]}`).join(" ")}`
  );
  return { from, to, rel: after, long: unique, anim, veiled };
}

/** The stillest 200ms of the whole navigation, which is where a dead cover hides. */
function quietest(frames) {
  let best = Infinity;
  for (let i = 0; i < frames.length; i += 1) {
    const window = frames.filter((f) => f.t >= frames[i].t && f.t < frames[i].t + 200);
    if (window.length < 3) continue;
    const mean = window.reduce((a, f) => a + f.delta, 0) / window.length;
    if (mean < best) best = mean;
  }
  return best === Infinity ? 0 : best;
}

for (let i = 0; i + 1 < routes.length; i += 1) await leg(routes[i], routes[i + 1]);

await browser.close();
