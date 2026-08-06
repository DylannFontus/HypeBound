/**
 * The HUD's own radius and edge ladder, read off the live board.
 *
 * §7's first craft line is "rounded corners that are consistent, not three
 * different radii on one screen". The action log was the one plate up there
 * still wearing `base.css`'s 20px, and picking its replacement by eye would
 * only have added a fourth guess — so this prints what every other surface on
 * the battle HUD actually computes to, and the log is set to match rather than
 * to look about right.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await seedPlayedAccount(page, "http://localhost:5173");
await page.goto("http://localhost:5173/?nointro#battle", { waitUntil: "networkidle" });
await page.waitForSelector(".battle-hud", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(3200);
console.log(
  await page.evaluate(() => {
    const out = [];
    for (const sel of [
      ".history-panel",
      ".leader-plate",
      ".obsession-dial",
      ".ability-btn",
      ".hype-wrap",
      ".confluence-btn",
    ]) {
      const e = document.querySelector(sel);
      if (!e) {
        out.push(`${sel.padEnd(18)} absent`);
        continue;
      }
      const cs = getComputedStyle(e);
      const b = e.getBoundingClientRect();
      out.push(
        `${sel.padEnd(18)} ${String(Math.round(b.width)).padStart(4)}x${String(Math.round(b.height)).padEnd(4)}` +
          ` radius ${cs.borderRadius.padEnd(9)} top ${cs.borderTopColor.padEnd(26)} bottom ${cs.borderBottomColor.padEnd(
            22
          )} bgimg ${cs.backgroundImage === "none" ? "none" : "yes"} blur ${cs.backdropFilter}`
      );
    }
    return out.join("\n");
  })
);
await browser.close();
