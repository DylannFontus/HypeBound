/**
 * Is the lobby mission rail really empty, or is verify:inbox looking for a
 * class the lobby stopped using?
 *
 * `verify-inbox.mjs` asks for `.lobby-rail .mission-list .mission .mission-text`
 * and reports "the lobby's mission rail is empty" when it finds nothing.
 * `lobbyScreen.ts` renders `<ul class="lobby-mission-list">`. Those are not the
 * same selector, and a zero count proves only that one of them is wrong — which
 * is exactly the shape of the twelve instruments this project has already had
 * to throw away.
 *
 * So this seeds the same account verify:inbox does, mounts the same screen, and
 * then reports **what the rail actually contains** rather than whether one
 * guessed selector matched. It cross-checks the rows against `missions.json` the
 * same way, so a rail full of invented rows still fails.
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
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message.slice(0, 200)));

await seedPlayedAccount(page);
await page.goto("http://localhost:5173/#lobby", { waitUntil: "networkidle" });
await page.waitForSelector(".lobby-screen", { timeout: 20000 });
await page.waitForFunction(() => document.querySelectorAll(".screen-out").length === 0, null, { timeout: 20000 });

const out = await page.evaluate(async () => {
  const q = (s) => [...document.querySelectorAll(s)];
  const raw = await (await fetch("/data/missions.json")).json();
  const names = new Set([...(raw.daily ?? []), ...(raw.weekly ?? [])].map((m) => m.name));
  const rail = document.querySelector(".lobby-rail");
  const list = document.querySelector(".lobby-mission-list");
  const rows = list ? [...list.querySelectorAll("li")] : [];
  const rowTexts = rows.map((li) => li.innerText.replace(/\s+/g, " ").trim());
  // The name is the first line of each row; compare that against the data.
  const firstLines = rows.map((li) => (li.innerText.trim().split("\n")[0] ?? "").trim());
  return {
    whatTheScriptAsksFor: q(".lobby-rail .mission-list .mission .mission-text").length,
    railPresent: !!rail,
    railHidden: rail ? rail.getAttribute("data-open") : null,
    missionListPresent: !!list,
    missionListClass: list ? list.className : null,
    rowCount: rows.length,
    rowTexts,
    rowsNotInMissionsJson: firstLines.filter((n) => n && !names.has(n) && !n.startsWith("No dailies")),
    railVisibleBox: rail ? rail.getBoundingClientRect().width > 0 && rail.getBoundingClientRect().height > 0 : false,
  };
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
