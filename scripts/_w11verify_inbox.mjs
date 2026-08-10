/**
 * Two questions verify:inbox could not answer, because it crashed on a stale
 * selector before reaching one and reported the other without saying which half
 * was wrong: does the lobby mission rail actually render, and does the open
 * message actually state its retention?
 *
 * The trap this avoids is the one the project has hit twelve times — believing
 * a script's verdict about markup the script was written against three waves
 * ago. So this asks the DOM what classes are really there rather than asserting
 * a class name and calling a miss a defect.
 */
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message.slice(0, 200)));
await page.goto("http://localhost:5173/?nointro#lobby", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

const rail = await page.evaluate(async () => {
  const q = (s) => [...document.querySelectorAll(s)];
  const raw = await (await fetch("/data/missions.json")).json();
  const names = new Set([...(raw.daily ?? []), ...(raw.weekly ?? [])].map((m) => m.name));
  const rows = q(".lobby-rail .mission-list .mission .mission-text").map((n) => n.textContent.trim());
  return {
    scriptSelectorRows: rows,
    unknown: rows.filter((r) => !names.has(r) && !r.startsWith("No dailies")),
    lobbyRailExists: q(".lobby-rail").length,
    missionListExists: q(".mission-list").length,
    missionNodes: q(".mission").length,
    missionTextNodes: q(".mission-text").length,
    anyMissionish: q("[class*='mission']").map((n) => n.className).slice(0, 12),
    railText: q(".lobby-rail").map((n) => n.innerText.replace(/\s+/g, " ").slice(0, 220)),
    missionsInData: [...names].slice(0, 4),
  };
});
console.log("--- LOBBY MISSION RAIL ---");
console.log(JSON.stringify(rail, null, 2));

await page.goto("http://localhost:5173/?nointro#inbox", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
const mail = await page.evaluate(() => {
  const q = (s) => [...document.querySelectorAll(s)];
  const foot = document.querySelector(".mail-reading-foot");
  return {
    subject: document.querySelector(".mail-reading-subject")?.textContent?.trim() ?? null,
    footExists: !!foot,
    footChildClasses: foot ? [...foot.children].map((c) => c.className) : [],
    faintInsideFoot: q(".mail-reading-foot .faint").length,
    retentionText: document.querySelector(".mail-retention")?.textContent?.trim() ?? null,
  };
});
console.log("--- INBOX READING PANE ---");
console.log(JSON.stringify(mail, null, 2));

await browser.close();
