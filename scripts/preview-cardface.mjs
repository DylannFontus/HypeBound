/**
 * Photograph the card face itself, at a size a human can judge.
 *
 * `preview-cards.mjs` waits fifteen seconds for a `window.hypebound` global that
 * no longer exists, so the one tool for reviewing the most-looked-at art in the
 * game has been dead for a while. This replaces it by asking the Vite dev server
 * for the renderer module directly — no global, nothing for the app to expose —
 * and laying the results out on a black sheet.
 *
 * Usage:
 *   node scripts/preview-cardface.mjs                       a mixed sheet
 *   node scripts/preview-cardface.mjs --set rarity          the rarity ladder
 *   node scripts/preview-cardface.mjs --set pending         art-pending only
 *   node scripts/preview-cardface.mjs --set currents        one card per Current
 *   node scripts/preview-cardface.mjs --set tile            at real grid size
 *   node scripts/preview-cardface.mjs --set board           at real board size
 *   node scripts/preview-cardface.mjs --set leaders         leader medallions
 *   node scripts/preview-cardface.mjs --ids a,b,c --width 300
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readdirSync } from "node:fs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? true);
};

const set = flag("set", "mixed");
const width = Number(flag("width", 0)) || null;
const ids = flag("ids", null);
const outDir = flag("dir", path.join(HERE, "screenshots", "w1", "cards"));
const outName = flag("out", `face-${set}`);
mkdirSync(outDir, { recursive: true });

/** Which cards actually have a PNG on disk — read here, never guessed in the page. */
const artDir = path.join(HERE, "..", "public", "assets", "art");
const paintedKeys = existsSync(artDir)
  ? readdirSync(artDir).map((f) => f.replace(/\.(png|webp|jpg)$/i, ""))
  : [];

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });

const box = await page.evaluate(
  async ({ set, width, ids, paintedKeys }) => {
    const [content, renderer, leader, palette, backs] = await Promise.all([
      import("/src/engine/content.ts"),
      import("/src/ui/cardRenderer/renderCard.ts"),
      import("/src/ui/cardRenderer/renderLeader.ts"),
      import("/src/ui/cardRenderer/palette.ts"),
      import("/src/ui/cardRenderer/renderCardBack.ts"),
    ]);
    const index = content.getContent();
    const all = Object.values(index.cards).filter((c) => !c.token);

    const painted = (card) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = `assets/art/${card.art ?? card.id}.png`;
      });

    const painted_ = new Set(paintedKeys);
    const first = (pred, n) => all.filter(pred).slice(0, n);
    const byId = (id) => index.cards[id];

    let picks = [];
    let size = width ?? 300;
    let mode = "card";

    if (ids) picks = String(ids).split(",").map(byId).filter(Boolean);
    else if (set === "rarity") {
      // the same Current four times, so only the rarity ladder varies
      for (const r of ["common", "rare", "epic", "legendary"]) {
        const c = all.find((c) => c.rarity === r && c.type === "character");
        if (c) picks.push(c);
      }
      size = width ?? 340;
    } else if (set === "ladder") {
      /**
       * The four tiers on **one** Current, which is the only way to see the
       * ladder at all. The default `rarity` set picks whichever card happens to
       * be first at each tier, so the frames differ by Current as well as by
       * rarity and every comparison is confounded.
       */
      const which = String(ids ?? "halo,tide").split(",");
      for (const cur of which) {
        for (const r of ["common", "rare", "epic", "legendary"]) {
          const c = all.find((c) => c.rarity === r && c.current === cur && c.type === "character");
          if (c) picks.push(c);
        }
      }
      size = width ?? 320;
    } else if (set === "pending") {
      picks = all.filter((c) => !painted_.has(c.art ?? c.id)).slice(0, 12);
      size = width ?? 300;
    } else if (set === "currents") {
      for (const cur of ["cinder", "tide", "root", "gale", "pulse", "halo", "veil", "prism"]) {
        const c = all.find((c) => c.current === cur && c.type === "character");
        if (c) picks.push(c);
      }
      size = width ?? 300;
    } else if (set === "tile") {
      picks = all.slice(0, 21);
      size = width ?? 185;
    } else if (set === "board") {
      picks = all.filter((c) => c.type === "character").slice(0, 8);
      size = width ?? 121;
      mode = "board";
    } else if (set === "foil") {
      const hero = all.find((c) => c.rarity === "legendary" && c.type === "character");
      picks = [hero, hero, hero, hero];
      size = width ?? 300;
      mode = "foil";
    } else if (set === "leaders") {
      picks = Object.values(index.leaders).slice(0, 8);
      size = width ?? 300;
      mode = "leader";
    } else {
      picks = [
        byId("idols-lumi-starcall"),
        byId("idols-encore-diva"),
        byId("goth-crypt-usher"),
        byId("after-designated-driver"),
        byId("neutral-block-button"),
        byId("idols-arena-tour"),
      ].filter(Boolean);
      size = width ?? 300;
    }

    await Promise.all(picks.map(painted));
    await new Promise((r) => setTimeout(r, 400));

    document.querySelectorAll("#face-sheet").forEach((n) => n.remove());
    const sheet = document.createElement("div");
    sheet.id = "face-sheet";
    sheet.style.cssText =
      "position:fixed;inset:0;z-index:99999;display:flex;flex-wrap:wrap;gap:20px;align-content:flex-start;" +
      "background:#0b0614;padding:22px;overflow:hidden";
    /**
     * A back beside a front, which is the only useful way to look at a back.
     * The defect it exists to catch is not "is the back nice" but "is it the
     * same object as the face" — and that is a question about the pair.
     */
    if (set === "back") {
      const face = byId("idols-lumi-starcall") ?? all[0];
      const styles = [
        { color: "#b56cff", emblem: "diamond" },
        { color: "#ff6b2c", emblem: "starburst" },
        { color: "#35d0d8", emblem: "spiral" },
        { color: "#ffd86b", emblem: "rose" },
      ];
      const wide = width ?? 300;
      sheet.appendChild(renderer.renderCardToCanvas(face, wide, {}));
      for (const style of styles) {
        const canvas = backs.renderCardBackToCanvas(style, wide / 512);
        canvas.style.width = `${wide}px`;
        canvas.style.height = `${wide * (680 / 512)}px`;
        sheet.appendChild(canvas);
      }
      document.body.appendChild(sheet);
      await new Promise((r) => setTimeout(r, 700));
      const box = sheet.getBoundingClientRect();
      return { w: Math.ceil(box.width), h: Math.ceil(box.height), n: styles.length + 1, size: wide, palette: !!palette };
    }

    picks.forEach((card, i) => {
      let node;
      if (mode === "leader") {
        node = leader.renderLeaderToCanvas(card, size, {
          health: card.health ?? 25,
          maxHealth: card.health ?? 25,
          armor: 3,
        });
      } else if (mode === "foil") {
        node = renderer.renderCardToCanvas(card, size, i === 0 ? {} : { premium: true, phase: [0, 0.15, 0.45, 0.75][i] });
      } else {
        node = renderer.renderCardToCanvas(card, size, mode === "board" ? { statEmphasis: true } : {});
      }
      sheet.appendChild(node);
    });
    document.body.appendChild(sheet);
    await new Promise((r) => setTimeout(r, 700));
    const r = sheet.getBoundingClientRect();
    return { w: Math.ceil(r.width), h: Math.ceil(r.height), n: picks.length, size, palette: !!palette };
  },
  { set, width, ids, paintedKeys }
);

await page.waitForTimeout(600);
const file = path.join(outDir, `${outName}.png`);
await page.locator("#face-sheet").screenshot({ path: file });
console.log(`${file}  (${box.n} cards at ${box.size}px)`);
if (errors.length) console.log("page errors:", errors.slice(0, 4));
await browser.close();
