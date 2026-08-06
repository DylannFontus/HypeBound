/**
 * Is the screen alive at rest, as a number rather than as an opinion.
 *
 * §3's "idle is never dead" cannot be judged from a still, and four rounds of
 * review were spent trying. This films a settled screen with a CDP screencast
 * and reports, frame to frame, what fraction of pixels changed by more than a
 * just-noticeable amount — plus the number of distinct CSS animations the
 * browser says are running on it, which catches the opposite failure: a screen
 * full of declared keyframes whose durations resolved to nothing.
 *
 *   node scripts/_ff/idle.mjs <route|queue> [seconds]
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const route = process.argv[2] ?? "queue";
const seconds = Number(process.argv[3] ?? 6);

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
await page.goto(`${ORIGIN}/?nointro#${route}`);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(Number(process.argv[4] ?? 2600));

const running = await page.evaluate(() => {
  const names = new Map();
  for (const animation of document.getAnimations()) {
    const name = animation.animationName ?? "(web)";
    const effect = animation.effect?.getTiming?.();
    const duration = typeof effect?.duration === "number" ? effect.duration : 0;
    if (animation.playState !== "running" || duration === 0) continue;
    names.set(name, (names.get(name) ?? 0) + 1);
  }
  return [...names].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}×${c}`);
});

const session = await page.context().newCDPSession(page);
const shots = [];
session.on("Page.screencastFrame", (frame) => {
  shots.push(frame.data);
  void session.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
});
await session.send("Page.startScreencast", { format: "png", maxWidth: 480, maxHeight: 270, everyNthFrame: 4 });
await page.waitForTimeout(seconds * 1000);
await session.send("Page.stopScreencast");

const moved = await page.evaluate(async (list) => {
  const grabs = [];
  for (const data of list) {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const pen = canvas.getContext("2d", { willReadFrequently: true });
    pen.drawImage(image, 0, 0);
    grabs.push(pen.getImageData(0, 0, canvas.width, canvas.height).data);
  }
  const out = [];
  for (let i = 1; i < grabs.length; i += 1) {
    const a = grabs[i - 1];
    const b = grabs[i];
    if (a.length !== b.length) continue;
    let changed = 0;
    for (let p = 0; p < a.length; p += 4) {
      if (Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]) > 9) changed += 1;
    }
    out.push((100 * changed) / (a.length / 4));
  }
  return out;
}, shots);
await session.detach().catch(() => undefined);

const mean = moved.length ? moved.reduce((a, b) => a + b, 0) / moved.length : 0;
console.log(
  `${route}: ${shots.length} frames over ${seconds}s — pixels changed per sampled frame: ` +
    `mean ${mean.toFixed(2)}%  max ${Math.max(0, ...moved).toFixed(2)}%  min ${Math.min(100, ...moved).toFixed(2)}%`
);
console.log(`  running animations: ${running.join("  ") || "NONE"}`);
await browser.close();
