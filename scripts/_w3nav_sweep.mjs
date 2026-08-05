/**
 * Every menu route, once, with the shell's new bookkeeping under inspection.
 *
 * `markCascade` writes `data-cascade` and `data-rise` on a screen's own
 * children at mount, which means the entrance cascade is now something the
 * router does to forty-nine screens it did not write. That is exactly the kind
 * of change that works on the five routes anybody tests and quietly does
 * nothing on the rest, so this visits all of them and reports how many
 * containers and risers each one got, plus anything the console threw.
 *
 *   node scripts/_w3nav_sweep.mjs
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";

const ROUTES = [
  "lobby", "play", "collection", "decks", "shop", "missions", "mastery", "pass",
  "achievements", "events", "inbox", "news", "profile", "settings", "replays",
  "gallery", "lab", "doomscroll", "remixhub", "uikit", "tour", "story",
  "gauntlet", "custom", "queue", "deckbuilder", "banner", "patchnotes", "stats",
  "leaderboards", "a11y", "fairness", "privacy", "legal", "support",
];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const shouted = [];
page.on("pageerror", (e) => shouted.push(`THROW ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") shouted.push(`ERROR ${m.text().slice(0, 160)}`);
});
await seedPlayedAccount(page, ORIGIN);
await page.goto(`${ORIGIN}/?nointro#lobby`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

let bare = 0;
for (const route of ROUTES) {
  shouted.length = 0;
  const t0 = Date.now();
  await page.evaluate((hash) => {
    location.hash = hash;
  }, `#${route}`);
  const settled = await page
    .waitForFunction(
      (name) => {
        const s = document.querySelectorAll(".screen");
        return s.length === 1 && s[0] && s[0].dataset.nav === "settled" && s[0].classList.contains(name);
      },
      `${route}-screen`,
      { timeout: 20000 }
    )
    .then(
      () => true,
      () => false
    );
  await page.waitForTimeout(120);
  const shape = await page.evaluate(() => {
    const screen = document.querySelector(".screen");
    if (screen === null) return null;
    return {
      cls: screen.className.replace("screen ", "").split(" ")[0],
      nodes: screen.getElementsByTagName("*").length,
      containers: screen.querySelectorAll(":scope > [data-cascade]").length,
      risers: screen.querySelectorAll(":scope > [data-cascade] > [data-rise]").length,
      kids: screen.children.length,
    };
  });
  if (shape !== null && shape.containers === 0) bare += 1;
  console.log(
    `${route.padEnd(13)} ${settled ? "settled" : "STUCK  "} ${String(Date.now() - t0).padStart(5)}ms  ` +
      `${shape === null ? "no screen" : `${String(shape.nodes).padStart(5)} nodes, ${shape.kids} children, ` +
        `${shape.containers} cascade container(s), ${String(shape.risers).padStart(2)} riser(s)`}` +
      `${shouted.length > 0 ? `  << ${shouted.join(" ; ")}` : ""}`
  );
}
console.log(`\n${bare} of ${ROUTES.length} routes got no cascade container at all.`);
await browser.close();
