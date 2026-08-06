/**
 * Photograph every dialogue the player can reach, because a modal is not a
 * route and the per-route census is structurally blind to it.
 *
 * The previous integration verdict named the modals as the thing that broke the
 * game into two languages: fourteen plates that were still `base.css` flat glass
 * — one fill, one 1px border, no light source, no grain, no contact shadow —
 * sitting over screens made of `.mat-panel`. A builder has since lacquered them
 * from `screens.css` §O. This takes the picture that says whether it worked.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { seedPlayedAccount } from "./lib/account.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));
const ORIGIN = "http://localhost:5173";
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const dir = String(arg("dir", "scripts/screenshots/w4/ic3"));
const [vw, vh] = String(arg("size", "1600x900")).split("x").map(Number);
const tag = String(arg("tag", ""));
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const shot = async (n) => {
  const f = path.join(dir, `${n}${tag}.png`);
  await page.screenshot({ path: f });
  console.log(f);
};
const material = (sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return { sel: s, missing: true };
    const cs = getComputedStyle(e);
    return {
      sel: s,
      cls: e.className,
      bgImage: /grain|url\(/.test(cs.backgroundImage) ? "grain+fill" : cs.backgroundImage.slice(0, 60),
      layers: cs.backgroundImage.split("),").length,
      borderColour: cs.borderTopColor + " | " + cs.borderBottomColor,
      shadow: cs.boxShadow.slice(0, 200),
      radius: cs.borderTopLeftRadius,
      backdrop: cs.backdropFilter,
    };
  }, sel);

const probes = [];

await seedPlayedAccount(page, ORIGIN);

// --- card detail overlay, from the collection -------------------------------
await page.goto(`${ORIGIN}/?nointro#collection`, { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
const cell = page.locator(".card-cell, .collection-cell, .col-cell").first();
if (await cell.count()) {
  await cell.click();
  await page.waitForTimeout(900);
  await shot("M1-card-detail");
  probes.push(await material(".detail-info"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}

// --- a battle: the settings quick panel and the concede confirm -------------
await page.goto(`${ORIGIN}/?nointro#battle`, { waitUntil: "networkidle" });
await page.waitForSelector(".mulligan-panel", { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(1300);
probes.push(await material(".mulligan-panel"));
if (await page.locator(".mulligan-actions .btn-primary").count())
  await page.click(".mulligan-actions .btn-primary");
await page
  .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 40000 })
  .catch(() => {});
await page.waitForTimeout(1800);

const controls = page.locator(".battle-controls .btn");
if ((await controls.count()) >= 3) {
  await controls.nth(1).click(); // gear
  await page.waitForTimeout(700);
  await shot("M2-battle-settings");
  probes.push(await material(".settings-quick"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  probes.push({
    note: "settings-quick still open after Escape?",
    open: await page.locator(".settings-overlay").count(),
  });
  await page.mouse.click(30, vh - 30); // backdrop
  await page.waitForTimeout(400);
  probes.push({
    note: "settings-quick still open after backdrop click?",
    open: await page.locator(".settings-overlay").count(),
  });
  if (await page.locator(".settings-overlay").count()) {
    await page.evaluate(() => document.querySelector(".settings-overlay")?.remove());
  }
  await controls.nth(2).click(); // concede flag
  await page.waitForTimeout(700);
  await shot("M3-concede-confirm");
  probes.push(await material(".confirm-panel"));
  probes.push(
    await page.evaluate(() => {
      const p = document.querySelector(".confirm-panel");
      const o = document.querySelector(".confirm-overlay");
      if (!p || !o) return { note: "no confirm" };
      const b = p.getBoundingClientRect();
      const ocs = getComputedStyle(o);
      return {
        note: "confirm geometry",
        panel: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
        panelCentreX: Math.round(b.x + b.width / 2),
        viewportCentreX: Math.round(window.innerWidth / 2),
        overlayDisplay: ocs.display,
        overlayJustify: ocs.justifyContent,
        overlayAlign: ocs.alignItems,
        overlayBg: ocs.backgroundImage.slice(0, 200),
        overlayBgColor: ocs.backgroundColor,
        overlayBackdrop: ocs.backdropFilter,
      };
    })
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  probes.push({ note: "confirm open after Escape?", open: await page.locator(".confirm-overlay").count() });
  await page.evaluate(() => document.querySelector(".confirm-overlay")?.remove());
  await page.waitForTimeout(200);
  await controls.nth(0).click(); // emote
  await page.waitForTimeout(600);
  await shot("M4-emote");
}

console.log(JSON.stringify(probes, null, 1));
await browser.close();
