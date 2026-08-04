/**
 * Which layer of the front door costs the long render frame.
 *
 * Warm — the leg is walked repeatedly in one session so a first-visit decode
 * cannot be mistaken for a per-navigation cost — with one candidate neutralised
 * by an injected stylesheet each time. A variant that removes the gap names the
 * cost.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "../lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const LEG = (process.argv[2] ?? "signin>queue").split(">");
const VARIANTS = {
  baseline: "",
  "no room blur": ".queue-room,.signin-room{filter:none !important}",
  "no room at all": ".queue-room,.signin-room{display:none !important}",
  "no leader-far blur": ".queue-leader-far{filter:none !important}",
  "no leader at all": ".queue-plinth,.signin-portrait{display:none !important}",
  "no haze/vignette": ".queue-haze,.queue-vignette,.signin-vignette{display:none !important}",
  "no floor/sweep": ".queue-floor,.queue-sweep,.queue-horizon,.queue-backlight{display:none !important}",
  "no masks": "*{mask-image:none !important;-webkit-mask-image:none !important}",
  "no backdrop-filter": "*{backdrop-filter:none !important;-webkit-backdrop-filter:none !important}",
  "no filters at all": "*{filter:none !important}",
  "world hidden": ".queue-world,.signin-room,.signin-vignette,.signin-portrait{display:none !important}",
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--no-sandbox"],
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
await page.goto(`${ORIGIN}/#${LEG[0]}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
// Warm both endpoints before anything is measured.
for (let i = 0; i < 2; i++) {
  await page.evaluate(async (l) => {
    location.hash = "#" + l[1];
    await new Promise((r) => setTimeout(r, 1400));
    location.hash = "#" + l[0];
    await new Promise((r) => setTimeout(r, 1400));
  }, LEG);
}

for (const [label, css] of Object.entries(VARIANTS)) {
  const runs = [];
  for (let r = 0; r < 4; r++) {
    const out = await page.evaluate(
      async ([leg, sheet]) => {
        document.getElementById("probe-css")?.remove();
        if (sheet) {
          const s = document.createElement("style");
          s.id = "probe-css";
          s.textContent = sheet;
          document.head.appendChild(s);
        }
        if (location.hash !== "#" + leg[0]) {
          location.hash = "#" + leg[0];
          await new Promise((res) => setTimeout(res, 1400));
        }
        await new Promise((res) => setTimeout(res, 400));
        const frames = [];
        let last = performance.now();
        let stop = false;
        const tick = () => {
          const n = performance.now();
          frames.push(n - last);
          last = n;
          if (!stop) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        location.hash = "#" + leg[1];
        await new Promise((res) => setTimeout(res, 1200));
        stop = true;
        const over = frames.filter((f) => f > 34);
        return {
          worst: Math.round(Math.max(...frames)),
          lost: Math.round(over.reduce((a, b) => a + b - 16.7, 0)),
        };
      },
      [LEG, css]
    );
    runs.push(out);
  }
  const worst = Math.round(runs.reduce((a, r) => a + r.worst, 0) / runs.length);
  const lost = Math.round(runs.reduce((a, r) => a + r.lost, 0) / runs.length);
  console.log(
    `${label.padEnd(22)} worst ${String(worst).padStart(4)}ms   lost ${String(lost).padStart(4)}ms   (${runs.map((r) => r.worst).join("/")})`
  );
}
await browser.close();
