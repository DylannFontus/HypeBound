/**
 * Does anything on these twelve routes actually cascade?
 *
 * A still cannot show it and a burst of screenshots races the entrance, so this
 * reads the mechanism instead: `stagger()` writes `--enter-delay` onto each node
 * it is given, and `.d-enter` consumes it as an `animation-delay`. Distinct
 * delays across a screen's risers is the thing §3a asks for; one delay repeated,
 * or none at all, is the "everything arrives on one frame" tell.
 *
 * It also counts the animations Blink says are running on arrival, which catches
 * the opposite failure — a screen that writes the delays and then has no
 * keyframe attached to consume them.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";
import { seedHistory } from "./lib/records.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const ROUTES = [
  "profile", "stats", "leaderboards", "replays", "settings", "a11y",
  "privacy", "legal", "support", "gauntlet", "fairness", "cloudsave",
];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, ORIGIN);
await seedHistory(page);

const rows = [];
for (const route of ROUTES) {
  await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  // Navigate *inside* the app so the screen is built the way a player gets it.
  await page.evaluate((r) => {
    window.location.hash = `#${r}`;
  }, route);
  // Read on the very next frames, before the cascade has finished.
  const early = await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const screen = document.querySelector(".screen:not(.screen-out)");
    if (!screen) return { running: 0 };
    return {
      running: screen.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
    };
  });
  await page.waitForTimeout(1200);
  rows.push(
    await page.evaluate(
      ({ route, early }) => {
        const screen = document.querySelector(".screen:not(.screen-out)");
        if (!screen) return { route, err: "no screen" };
        const risers = [...screen.querySelectorAll(".d-enter")];
        const delays = risers.map((n) =>
          Math.round(parseFloat(getComputedStyle(n).getPropertyValue("--enter-delay")) || 0)
        );
        const unique = [...new Set(delays)].sort((a, b) => a - b);
        return {
          route,
          risers: risers.length,
          distinctDelays: unique.length,
          span: unique.length ? `${unique[0]}–${unique[unique.length - 1]}ms` : "—",
          runningOnArrival: early.running,
        };
      },
      { route, early }
    )
  );
}
console.table(rows);
await browser.close();
