/**
 * Film a drag on the real GPU, and subtract the frames in a way that can only
 * be answered by the mat.
 *
 * Two waves reported "the board opens no socket, nothing lights, nothing gives
 * way", and both reports were made from stills of a board with nothing in the
 * air — the drop feedback only exists between `pointerdown` and `pointerup`, and
 * `page.screenshot` blocks the very loop that draws it. `_w4b_drag.mjs` did take
 * stills mid-gesture; it also picked whatever card was first in hand, which on
 * most deals is a spell or an equipment — neither of which occupies a slot, so
 * neither opens a row. A capture of a *correctly working* board holding an
 * equipment looks exactly like a capture of a broken one.
 *
 * Three things make the number here mean something:
 *
 * 1. **A character, or nothing.** Only a card with `needsSlot` asks the row to
 *    open. The script fails loudly rather than filming the wrong gesture.
 * 2. **Reduced motion on.** The specular crawl, the turn wash and both breathe
 *    cycles are decorative and §3 says they die under reduced motion; the drop
 *    feedback is functional and `board.update` deliberately keeps it. So with
 *    the setting on, a frame-to-frame difference over the mat has exactly one
 *    possible author. Filmed with it off, the sweep alone moves more of the
 *    frame than the socket ever will and the diff is unreadable — which is what
 *    the first run of this script produced.
 * 3. **The pointer's own box is masked out.** The drag ghost is a DOM card
 *    following the cursor; it is 130×180 of guaranteed difference sitting on top
 *    of the thing being measured. Excluding it, plus the hand bar, leaves the
 *    arena and nothing else.
 *
 * The comparison is therefore: pointer resting at P over the player's row, no
 * button down, against pointer at exactly P with a character in hand. Anything
 * non-zero outside the masks is the board answering.
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { seedPlayedAccount } from "./lib/account.mjs";

const ORIGIN = "http://localhost:5173";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => existsSync(p));

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};
const outDir = String(arg("dir", "scripts/screenshots/w6/drop"));
const tag = String(arg("out", "drag"));
const [vw, vh] = String(arg("size", "1600x900")).split("x").map(Number);
const still = arg("motion", null) === null;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  ignoreDefaultArgs: ["--hide-scrollbars"],
  // No `--use-gl=angle --use-angle=swiftshader`: those two flags are what capped
  // this project's camera at 1.6fps. See the note at the top of shot.mjs.
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log(`  pageerror: ${e.message}`));

const cdp = await page.context().newCDPSession(page);
const frames = [];
let moment = "boot";
cdp.on("Page.screencastFrame", async (f) => {
  frames.push({ moment, data: f.data });
  await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});

try {
  await seedPlayedAccount(page, ORIGIN);
  if (still) {
    await page.evaluate(async () => {
      const { updateSettings } = await import("/src/save/settings.ts");
      updateSettings({ reducedMotion: true });
    });
  }
  await page.goto(`${ORIGIN}/?nointro#battle?seed=414`, { waitUntil: "networkidle" });
  await page.waitForSelector(".mulligan-panel", { timeout: 25000 }).catch(() => {});
  if (await page.locator(".mulligan-actions .btn-primary").count()) {
    await page.click(".mulligan-actions .btn-primary");
  }
  await page
    .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(1800);

  /**
   * Turn one has one Hype and nothing in hand costs one, so the first several
   * deals contain no playable character at all — which is how the previous run
   * of this script ended up filming an equipment and proving nothing. End turns
   * until the row has something to receive.
   */
  const findCharacter = () =>
    page.evaluate(() => {
      const hand = window.hypeboundBattle.debug().hand;
      const nodes = [...document.querySelectorAll(".hand-card")];
      const pick = hand.find(
        (c) => c.type === "character" && c.ok !== false && nodes.some((n) => n.dataset.instanceId === c.instanceId)
      );
      if (!pick) return { hand: hand.map((c) => ({ t: c.type, ok: c.ok })) };
      const node = nodes.find((n) => n.dataset.instanceId === pick.instanceId);
      const r = node.getBoundingClientRect();
      return { id: pick.instanceId, type: pick.type, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });

  let card = await findCharacter();
  for (let turn = 0; !card.id && turn < 8; turn++) {
    await page.click(".end-turn-btn");
    await page.waitForTimeout(600);
    await page
      .waitForFunction(() => document.querySelector(".end-turn-btn:not([disabled])") !== null, null, { timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(1400);
    card = await findCharacter();
  }
  if (!card.id) {
    console.log(JSON.stringify(card));
    throw new Error("no playable CHARACTER in hand — a slot-less card cannot test a slot");
  }
  console.log(`carrying a ${card.type} (${card.id}); reducedMotion=${still}`);

  /** The point the pointer sits at for both halves of the comparison. */
  const P = { x: Math.round(vw * 0.5), y: Math.round(vh * 0.62) };
  const LEFT = { x: Math.round(vw * 0.3), y: Math.round(vh * 0.62) };
  /**
   * NOT a refusal, and the first run of this script wrongly read it as one.
   * `isPlayZone` deliberately accepts `z > -6`, so holding a card over the
   * rival's own row still plays it into your row — exactly what the reference
   * allows. A capture there shows a green ghost and an open trough because both
   * are correct.
   */
  const RIVAL = { x: Math.round(vw * 0.5), y: Math.round(vh * 0.26) };
  /** Past the rival's leader (z < -6): genuinely outside the play zone. */
  const FAR = { x: Math.round(vw * 0.5), y: Math.round(vh * 0.12) };
  /** Off the mat's x bound (|x| > 10): the other half of the refusal. */
  const OFFSIDE = { x: Math.round(vw * 0.155), y: Math.round(vh * 0.5) };

  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  /**
   * The label goes on BEFORE the pointer moves, not after.
   *
   * Labelling after the move tags every frame of the travel with the *previous*
   * moment, so the last frame of "over the row" is actually a frame taken
   * halfway to somewhere else — which is how the first pass at this measured a
   * card 63px away from where the script had put it and drew conclusions from
   * it.
   */
  const ghostState = () =>
    page.evaluate(() => {
      const ghost = document.querySelector(".hand-drag-ghost");
      const face = ghost?.querySelector("canvas");
      const r = face?.getBoundingClientRect();
      return {
        rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
        scale: face ? face.style.scale || "1" : null,
        classes: ghost ? [...ghost.classList].filter((c) => c.startsWith("drop-")).join(",") || "(none)" : "(gone)",
        probe: window.hypeboundBattle.debug().dropProbe,
      };
    });
  const seen = {};
  const at = async (name, to, ms) => {
    moment = name;
    if (to) await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.waitForTimeout(ms);
    seen[name] = await ghostState();
  };

  // Rest, with the pointer already parked where the drag will end up.
  await at("0-rest-at-P", P, 600);

  moment = "1-picked-up";
  await page.mouse.move(card.x, card.y, { steps: 8 });
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.move(card.x, card.y - 50, { steps: 4 });
  await page.waitForTimeout(600);
  seen["1-picked-up"] = await ghostState();

  await at("2-drag-at-P", P, 650);
  await at("3-drag-at-LEFT", LEFT, 600);
  await at("4-drag-at-RIVAL", RIVAL, 600);
  await at("4b-drag-at-FAR", FAR, 600);
  await at("4c-drag-at-OFFSIDE", OFFSIDE, 600);
  await at("5-back-at-P", P, 500);

  await page.mouse.up();
  await at("6-played", null, 900);

  await cdp.send("Page.stopScreencast");
  for (const [name, s] of Object.entries(seen)) {
    const p = s.probe ?? {};
    console.log(
      `  ${name.padEnd(18)} ghost ${String(s.classes).padEnd(14)} scale ${String(s.scale).padEnd(5)} ` +
        `world ${p.world ? `${p.world.x},${p.world.z}` : "null"} board=${p.overBoard ?? "-"} arena=${p.overArena ?? "-"}`
    );
  }

  const byMoment = new Map();
  for (const f of frames) {
    if (!byMoment.has(f.moment)) byMoment.set(f.moment, []);
    byMoment.get(f.moment).push(f);
  }
  const last = new Map();
  for (const [name, list] of byMoment) {
    console.log(`  ${name}: ${list.length} frames`);
    const picks = list.length > 3 ? [list[0], list[Math.floor(list.length / 2)], list[list.length - 1]] : list;
    picks.forEach((f, i) => writeFileSync(path.join(outDir, `${tag}-${name}-${i}.png`), Buffer.from(f.data, "base64")));
    if (list.length) {
      const file = path.join(outDir, `${tag}-${name}-last.png`);
      writeFileSync(file, Buffer.from(list[list.length - 1].data, "base64"));
      last.set(name, file);
    }
  }

  /** The two rows, as fractions of the frame, measured off the captures. */
  const PLAYER_ROW = { y0: Math.round(vh * 0.5), y1: Math.round(vh * 0.78) };
  const ENEMY_ROW = { y0: Math.round(vh * 0.22), y1: Math.round(vh * 0.5) };
  const cases = [
    ["2-drag-at-P", PLAYER_ROW],
    ["3-drag-at-LEFT", PLAYER_ROW],
    ["4-drag-at-RIVAL", PLAYER_ROW],
    ["4b-drag-at-FAR", ENEMY_ROW],
    ["4c-drag-at-OFFSIDE", ENEMY_ROW],
    ["1-picked-up", PLAYER_ROW],
  ];
  const report = {};
  const restFile = last.get("0-rest-at-P");
  for (const [name, band] of cases) {
    const file = last.get(name);
    if (!file || !restFile) continue;
    /**
     * The mask is the ghost's OWN rect, read from the live page, plus a margin
     * for the shadow it throws down-right. A fixed box sized for a full-size
     * ghost swallows exactly the ring of socket that shrinking the card
     * uncovers — which is the thing being measured — and a run with the fix in
     * therefore scored *lower* than a run without it.
     */
    const r = seen[name]?.rect;
    const masks = [{ x: 0, y: Math.round(vh * 0.78), w: vw, h: vh }];
    if (r) masks.push({ x: r.x - 12, y: r.y - 12, w: r.w + 24, h: r.h + 56 });
    report[name] = await amplify(page, restFile, file, 6, {
      out: path.join(outDir, `${tag}-diff-${name}.png`),
      masks,
      band,
    });
  }
  console.log(JSON.stringify(report, null, 2));
  console.log(outDir);
} finally {
  await browser.close();
}

/**
 * Subtract two PNGs, amplify, blank the masks, and report the player's row band.
 *
 * Chrome does the decode and the arithmetic; node has no image library here and
 * is not getting one for this.
 */
async function amplify(page, aPath, bPath, gain, opts) {
  const b64 = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;
  const res = await page.evaluate(
    async ([a, b, g, o]) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = ia.width;
      const h = ia.height;
      const data = (img) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const x = c.getContext("2d");
        x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, w, h).data;
      };
      const da = data(ia);
      const db = data(ib);
      const masked = (x, y) => o.masks.some((m) => x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h);
      const oc = document.createElement("canvas");
      oc.width = w;
      oc.height = h;
      const octx = oc.getContext("2d");
      const out = octx.createImageData(w, h);
      const px = out.data;
      let bandSum = 0;
      let bandN = 0;
      let bandMoved = 0;
      let peak = 0;
      let peakAt = null;
      for (let i = 0; i < da.length; i += 4) {
        const p = i / 4;
        const x = p % w;
        const y = (p / w) | 0;
        if (masked(x, y)) {
          px[i] = 0;
          px[i + 1] = 0;
          px[i + 2] = 40;
          px[i + 3] = 255;
          continue;
        }
        const d = (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3;
        if (y >= o.band.y0 && y < o.band.y1) {
          bandSum += d;
          bandN++;
          if (d > 12) bandMoved++;
          if (d > peak) {
            peak = d;
            peakAt = { x, y };
          }
        }
        const v = Math.min(255, d * g);
        px[i] = v;
        px[i + 1] = v;
        px[i + 2] = v;
        px[i + 3] = 255;
      }
      octx.putImageData(out, 0, 0);
      octx.strokeStyle = "#ff0044";
      octx.lineWidth = 2;
      octx.strokeRect(1, o.band.y0, w - 2, o.band.y1 - o.band.y0);
      return {
        png: oc.toDataURL("image/png"),
        rowBandMeanDelta: +(bandSum / Math.max(1, bandN)).toFixed(2),
        rowBandMovedPct: +((bandMoved / Math.max(1, bandN)) * 100).toFixed(2),
        rowBandPeak: +peak.toFixed(1),
        peakAt,
      };
    },
    [b64(aPath), b64(bPath), gain, opts]
  );
  writeFileSync(opts.out, Buffer.from(res.png.split(",")[1], "base64"));
  return { ...res, png: undefined, out: opts.out };
}
