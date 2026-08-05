/**
 * The Hype Wave — `03-screens-and-navigation.md` §4.2.5, `08-progression.md` §10.
 *
 * Fifty tiers, two tracks, and a pacing line. What this screen is careful about
 * is tone, because §10.6.4 makes it binding: *"Pass pacing UI shows a calm state
 * ('ahead / on pace / Rebound active'), never countdown-panic framing, never
 * 'last chance!' copy. Countdown timers appear only as factual dates."*
 *
 * So: the season's end is a date, not a clock. Falling behind is announced as
 * *"Wave Rebound is on"* — a thing being done for you — rather than as a
 * warning. And the Rerun Vault is stated up front, because the honest answer to
 * "will I miss this forever" is no.
 *
 * The Backstage Pass is sold here and cannot be bought with money, only with
 * Glimmer the pass itself pays out. That is worth saying on the screen rather
 * than only in a design document.
 *
 * ## Why the track is a rail now, and not a table
 *
 * It was fifty near-identical HTML rows of text: *"◈75 / Minor seasonal
 * cosmetic"*, fifty times, in a 445px column holding about 40px of content, with
 * not one reward depicted. "Seasonal card back", "Seasonal leader skin",
 * "Animated profile portrait", "Card-back tint I/II/III" were all plain text in
 * a grey box. The season XP bar was a 3px flat rail at 0% with no tier pips.
 *
 * All three reference games show you the object: Hearthstone's Rewards Track is
 * a horizontal rail of 3D chests with a filling energy meter and a level-up
 * burst; MTG Arena's Mastery Pass is a horizontal node track with an illustrated
 * tile per item and split free/premium lanes; Gwent's Journey is an illustrated
 * road with milestone portraits.
 *
 * So this is a horizontal scroll-snap rail: a medallion per tier with the filled
 * meter running *through* it, the free lane above and the Backstage lane below,
 * and every reward rendered as a tile — a card back is the real rendered card
 * back, currency is its icon and a tabular numeral, a pick is its rarity mark.
 * The rail scrolls itself to the player's current tier on arrival, because the
 * first thing anybody wants to know is where they are.
 *
 * A **list view** is kept behind a toggle. A rail is a better picture and a worse
 * document; fifty rows in reading order is the thing a screen reader and a
 * player counting Glimmer both want, and it must never be the view that was
 * deleted.
 *
 * ## What is kept for the browser check
 *
 * `.pass-row` (fifty of them), `.pass-row.pace`, `.pass-cell.locked`,
 * `.pass-reward.deferred` with its `title`, `.pass-pacing` and `.pass-body` are
 * the hooks `scripts/verify-pass.mjs` drives. They live on the rebuilt elements
 * on purpose: a check that can still prove a rebuilt track claims the right
 * tiers is worth more than a tidy class list.
 */

import type { CardDef, ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import type { PassReward, PassView } from "../../game/progression/hypeWave";
import { DEFERRED_PASS, hypeWaveData, seasonEnd, seasonStart } from "../../game/progression/hypeWave";
import {
  buyBackstagePass,
  claimEncore,
  claimPassTier,
  getProfile,
  hypeWaveViews,
  passPickChoices,
  skipPassTier,
  syncHypeWave,
} from "../../save/profile";
import { audio } from "../../audio/audio";
import { icon } from "../art/uiIcons";
import { date as formatDate, num as formatNumber } from "../format";
import { motionEnabled } from "../motion";
import {
  backButton,
  coinChip,
  coinInline,
  describeReward,
  esc,
  flyReward,
  patchRow,
  railHtml,
  rewardTileHtml,
  riseIn,
  syncWallets,
  updateWallet,
  WASH,
  type CoinKind,
} from "./rewards/rewardKit";
import { createPaintQueue, paintRewardArt, type PaintQueue } from "./rewards/rewardArt";
import { installRewardsTheme } from "./rewards/rewardsTheme";

export interface HypeWaveCallbacks {
  onBack: () => void;
  onMissions: () => void;
  onShop: () => void;
}

/**
 * Schedule dates are authored as UTC midnight, so they are formatted in UTC and
 * in en-GB. The previous formatter passed `undefined` as the locale and printed
 * "Runs until 14 septembre 2026" inside an English sentence on any machine not
 * set to English.
 */
const DATE = (value: number): string => formatDate(value, { day: "numeric", month: "long", year: "numeric" });

/** Why a reward is not being granted — the deferral, said out loud. */
const deferredNote = (reward: PassReward): string =>
  reward.kind === "cosmetic" && !reward.ref ? (DEFERRED_PASS.get(reward.name) ?? "not built yet") : "";

const PACING_COPY: Record<PassView["pacing"], string> = {
  ahead: "Ahead of pace",
  "on-pace": "On pace",
  rebound: "Wave Rebound is on — +50% until you catch up",
};

const PACING_ICON: Record<PassView["pacing"], "chevron-up" | "check" | "refresh"> = {
  ahead: "chevron-up",
  "on-pace": "check",
  rebound: "refresh",
};

/** Which wallet a claimed reward should fly into, where there is one. */
function coinFor(reward: PassReward): CoinKind | null {
  if (reward.kind === "clout") return "clout";
  if (reward.kind === "fragments") return "shards";
  if (reward.kind === "glimmer") return "glimmer";
  return null;
}

export function createHypeWaveScreen(content: ContentIndex, callbacks: HypeWaveCallbacks): Screen {
  installRewardsTheme();

  const root = document.createElement("div");
  root.className = "screen pass-screen";

  /** the tier whose pick is open, or null */
  let picking: number | null = null;
  /** which pass is being looked at: the live season's id, or an archive's */
  let showing: string | null = null;
  /** the rail, or the fifty-row document */
  let view: "rail" | "list" = "rail";
  /** kept across renders so claiming a tier does not throw the track back to 1 */
  let railScroll: number | null = null;
  /** Nothing is rasterised on the navigation frame — see `rewardArt.ts`. */
  let art: PaintQueue | null = null;
  let cascaded = false;

  /* ---------------------------------------------------------------------
     one tier
     --------------------------------------------------------------------- */

  /**
   * One lane of one tier, buildable on its own so a claim can patch just it.
   *
   * It used to be a closure inside `tierRow`, which is the shape that forces a
   * claim to rebuild all fifty rows: there was no way to produce one cell's
   * markup without producing the whole track.
   */
  const cellHtml = (pass: PassView, row: PassView["rows"][number], track: "free" | "backstage"): string => {
    const pick = row.free.find((reward) => reward.kind === "pick");
    const milestone = row.tier % 10 === 0 || row.tier === hypeWaveData().tiers;
    {
      const rewards = track === "free" ? row.free : row.backstage;
      const claimed = track === "free" ? row.freeClaimed : row.backstageClaimed;
      const claimable = track === "free" ? row.freeClaimable : row.backstageClaimable;
      const locked = track === "backstage" && !pass.backstage;
      const state = claimed ? "claimed" : claimable ? "claimable" : locked || !row.unlocked ? "locked" : "available";

      /*
       * The state word is only *printed* where it says something the tile
       * cannot.
       *
       * Twenty tiers fit in one viewport, each with two lanes, so the honest
       * rendering of "state as a word under every tile" is the word LOCKED
       * forty times down a rail — which is what the first rebuild shipped, and
       * it is the same defect §5 catches in a column of repeated grey text. The
       * padlock is struck onto the reward tile instead (`.rw-tile[data-state]`),
       * the lane key at the top of the track says which lane is shut, and the
       * word survives on `.rw-sr` for a screen reader. What is left visible is
       * the three states that are events rather than the default: Claimed, the
       * Claim button, and Paid out.
       */
      const stateMark =
        claimed
          ? `<span class="pass-state" data-state="claimed">${icon("check")}<span>Claimed</span></span>`
          : claimable && pick && track === "free"
            ? `<button class="pass-claim mat-hero act pass-pick-open" data-tier="${row.tier}">Pick one</button>`
            : claimable
              ? `<button class="pass-claim mat-hero act pass-claim-btn" data-track="${track}" data-tier="${row.tier}">Claim</button>`
              : row.unlocked && locked
                ? `<span class="rw-sr">Needs the Backstage Pass</span>`
                : row.unlocked
                  ? `<span class="pass-state" data-state="available">${icon("dot")}<span>Paid out</span></span>`
                  : `<span class="rw-sr">Locked — tier ${row.tier}</span>`;

      return `
        <div class="pass-cell mat-panel ${claimed ? "claimed" : ""} ${claimable ? "claimable" : ""} ${locked ? "locked" : ""}"
             data-lane="${track}" data-state="${state}" data-milestone="${milestone ? 1 : 0}"
             data-rewards="${rewards.length}">
          <div class="pass-rewards">
            ${rewards
              .map((reward) => {
                const note = deferredNote(reward);
                const visual = describeReward(reward, content, pass.season.id, { tier: row.tier });
                return (
                  rewardTileHtml(visual, {
                    /* em, because the lane it sits in is em: a fixed 40px tile
                       was a quarter of its own cell at --ui-scale 1.4.
                       3.6, not 2.55: at 2.55 the object occupied 40px of a
                       134x147 plate and twenty tiers across a viewport read as
                       a row of empty boxes with a mark in the corner of each.
                       The whole argument for a rail over a table is that it
                       shows you the thing, so the thing has to be the tile. */
                    state: state === "available" ? "none" : state,
                    art: "3.6em",
                    bare: true,
                    title: visual.name,
                  }) +
                  `<span class="pass-reward ${note ? "deferred" : ""}"${note ? ` title="${esc(note)}"` : ""}>` +
                  `${esc(visual.name)}</span>`
                );
              })
              .join("")}
          </div>
          ${stateMark}
        </div>`;
    }
  };

  const tierRow = (pass: PassView, row: PassView["rows"][number]): string => {
    const pick = row.free.find((reward) => reward.kind === "pick");
    const choices =
      picking === row.tier && pick ? (passPickChoices(content, pass.season.id, row.tier) ?? []) : [];
    const milestone = row.tier % 10 === 0 || row.tier === hypeWaveData().tiers;

    /*
     * The tier the player is working on, marked.
     *
     * On a new account every one of the fifty tiers is locked and every plate is
     * the same grey, so the rail opens with nothing for the eye to land on and
     * no answer to "where am I" — which is the first question this screen
     * exists to answer and the reason it auto-scrolls at all. Hearthstone lights
     * the next chest; MTG Arena puts a lit ring on the current node. This is
     * that ring, and it is the only lit object on an untouched track.
     */
    const next = row.tier === pass.state.tier + 1;

    return `
      <li class="pass-row ${row.unlocked ? "unlocked" : ""} ${row.onPaceLine ? "pace" : ""}"
          data-tier="${row.tier}"${next ? ` data-next="1"` : ""}>
        ${cellHtml(pass, row, "free")}
        <div class="pass-node mat-chip" data-milestone="${milestone ? 1 : 0}">
          <span class="num">${row.tier}</span>
          ${next ? `<span class="rw-sr">Your next tier</span>` : ""}
        </div>
        ${cellHtml(pass, row, "backstage")}
        ${
          choices.length > 0
            ? `<div class="pass-choices mat-panel">
                 ${choices
                   .map(
                     (card: CardDef) =>
                       `<button class="mat-panel act pass-pick" data-tier="${row.tier}" data-card="${esc(card.id)}"
                                style="padding:6px 10px;font-size:var(--fs-sm)">
                          ${esc(card.name)}
                        </button>`,
                   )
                   .join("")}
               </div>`
            : ""
        }
      </li>`;
  };

  /* ---------------------------------------------------------------------
     the head
     --------------------------------------------------------------------- */

  const passHead = (pass: PassView): string => {
    const { state } = pass;
    const into = state.complete ? state.perTier : state.intoTier;
    return `
      <section class="rw-pass-head mat-panel" data-season="${esc(pass.season.id)}">
        <div class="rw-tier-badge mat-chip">
          <span class="num">${state.tier}</span>
          <span class="t-label">of ${hypeWaveData().tiers}</span>
        </div>

        <div class="rw-stack-tight">
          <div class="rw-spread">
            <div>
              <span class="t-label">${pass.live ? `Season ${pass.season.number}` : "Archive Pass"}</span>
              <h2 class="t-heading" style="margin:0">${esc(pass.season.name)}</h2>
            </div>
            <span class="rw-pace mat-chip pass-pacing pass-pacing-${pass.pacing}">
              ${icon(PACING_ICON[pass.pacing])}
              <span>${pass.live ? esc(PACING_COPY[pass.pacing]) : "Earning at half rate, forever, until tier 50"}</span>
            </span>
          </div>

          ${railHtml({
            value: into,
            max: state.perTier,
            label: `Progress to tier ${state.tier + 1}`,
            height: 14,
          })}

          <div class="rw-spread">
            <span class="rw-note rw-quiet">
              ${
                state.complete
                  ? "Tier 50 reached."
                  : `<span class="num" style="min-width:0">${formatNumber(state.perTier - state.intoTier)}</span> XP to tier ${state.tier + 1}.`
              }
            </span>
            <span class="rw-note rw-quiet pass-dates">
              ${
                pass.live
                  ? `Runs until ${DATE(seasonEnd(pass.season))}.`
                  : `Ended ${DATE(seasonEnd(pass.season))} — and is still going. It never expires.`
              }
            </span>
          </div>
        </div>

        <div class="rw-stack-tight" style="justify-items:end">
          ${
            pass.backstage
              ? `<span class="rw-tok mat-chip" data-state="claimed">${icon("check")}<span>Backstage held</span></span>`
              : `<button class="mat-hero act rw-back pass-buy" data-season="${esc(pass.season.id)}">
                   ${icon("pass")}<span>Backstage Pass</span>${coinInline("glimmer", pass.backstagePrice)}
                 </button>`
          }
          ${
            pass.live && !pass.state.complete
              ? `<button class="mat-panel act rw-back pass-skip" data-season="${esc(pass.season.id)}">
                   ${icon("chevron-up")}<span>Skip a tier</span>${coinInline("glimmer", pass.tierSkipPrice)}
                 </button>`
              : ""
          }
          ${
            pass.encoreOwed > 0
              ? `<button class="mat-hero act rw-back" id="pass-encore">
                   ${icon("star-filled")}<span>Collect Encore — ${formatNumber(pass.encoreOwed * pass.encoreClout)} Clout</span>
                 </button>`
              : ""
          }
        </div>
      </section>`;
  };

  /* ---------------------------------------------------------------------
     render
     --------------------------------------------------------------------- */

  const render = (): void => {
    syncHypeWave();
    const profile = getProfile();
    const { live, archives } = hypeWaveViews();
    const passes = [live, ...archives].filter((entry): entry is PassView => entry !== null);
    const pass = passes.find((entry) => entry.season.id === showing) ?? passes[0] ?? null;

    root.innerHTML = `
      ${WASH}
      <header class="screen-header">
        ${backButton("pass-back")}
        <h1 class="title">Hype Wave</h1>
        <div class="rw-wallet">
          ${coinChip("clout", profile.clout)}
          ${coinChip("glimmer", profile.glimmer ?? 0)}
        </div>
      </header>

      <main class="pass-body rw-pass-body">
        ${
          passes.length > 1
            ? `<nav class="rw-tabs pass-tabs" role="tablist">
                 ${passes
                   .map(
                     (entry) =>
                       `<button class="rw-tab mat-panel act" role="tab" data-season="${esc(entry.season.id)}"
                                aria-selected="${pass?.season.id === entry.season.id}">
                          ${esc(entry.season.name)}${entry.live ? "" : ` <span class="rw-quiet">archive</span>`}
                          ${entry.unclaimed > 0 ? `<span class="rw-badge num">${entry.unclaimed}</span>` : ""}
                        </button>`,
                   )
                   .join("")}
               </nav>`
            : `<div></div>`
        }

        ${pass ? passHead(pass) : ""}

        ${
          pass
            ? `<section class="pass-track mat-panel">
                 <div class="pass-lane-key">
                   <span class="rw-lane-tag">${icon("chevron-up")}<span>Free lane</span></span>
                   <span class="rw-lane-tag">${icon("pass")}<span>Backstage lane${pass.backstage ? "" : " — locked"}</span></span>
                   <span class="rw-lane-tag" style="margin-left:auto;text-transform:none;letter-spacing:0">
                     ${icon("info")}<span>Fed by the XP you already earn. Nothing here resets or expires.</span>
                   </span>
                   <div class="rw-seg mat-well" role="group" aria-label="Track view">
                     <button type="button" id="pass-view-rail" aria-pressed="${view === "rail"}">Track</button>
                     <button type="button" id="pass-view-list" aria-pressed="${view === "list"}">List</button>
                   </div>
                 </div>
                 <div class="${view === "rail" ? "rw-track" : "rw-pass-list"}" id="pass-scroller">
                   <ul class="pass-rows">${pass.rows.map((row) => tierRow(pass, row)).join("")}</ul>
                 </div>
               </section>`
            : `<section class="mat-panel rw-panel-pad rw-stack pass-between">
                 <h2 class="t-heading" style="margin:0">Between seasons</h2>
                 <p class="rw-note">
                   No Hype Wave is running right now. The next one starts
                   ${nextSeasonStart() ? DATE(nextSeasonStart()!) : "when the next one is announced"}.
                 </p>
                 <p class="rw-note rw-quiet">
                   Nothing is being lost in the meantime — missions and Mastery are unaffected, and
                   an unfinished pass would still be here, still earning.
                 </p>
                 <button class="mat-panel act rw-back" id="pass-missions">${icon("missions")}<span>Daily missions</span>${icon("chevron-right")}</button>
               </section>`
        }

        <section class="mat-panel rw-panel-pad">
        <p class="rw-note rw-quiet" style="margin:0">
          Seasonal cosmetics return to the shop two seasons later through the Rerun Vault, so nothing
          here is missable. Fall behind and <em>Wave Rebound</em> pays 50% extra until you are level
          with the season; miss the season entirely and the pass keeps going as an Archive Pass,
          forever. That is why you will not find a countdown on this screen.
        </p>
        </section>
      </main>`;

    bind(pass);

    art?.stop();
    art = createPaintQueue();
    paintRewardArt(root, art);

    if (!cascaded) {
      cascaded = true;
      /*
       * Ten of the fifty, capped: `stagger` compresses to a 24ms floor and then
       * clamps the index, so the leading tiers cascade visibly and the tail —
       * which is off the right-hand edge of a scroller that has not been
       * scrolled yet — arrives together. Fifty tiers at 40ms would be a
       * two-second entrance for content nobody is looking at.
       */
      riseIn(root.querySelectorAll(".pass-rows > li"), { from: 200, step: 38, max: 620 });
    }

    syncWallets(root);
    restoreScroll(pass);
  };

  /**
   * Put the track where the player is.
   *
   * A fifty-tier rail that opens at tier 1 makes the player scroll to find
   * themselves every single visit, and the answer to "where am I" is the first
   * thing this screen exists to give. On a re-render — which every claim causes
   * — the previous scroll position wins instead, so claiming tier 34 does not
   * throw the track back to the beginning.
   */
  const restoreScroll = (pass: PassView | null): void => {
    const scroller = root.querySelector<HTMLElement>("#pass-scroller");
    if (!scroller || view !== "rail") return;
    if (railScroll !== null) {
      scroller.scrollLeft = railScroll;
      return;
    }
    const current = pass ? scroller.querySelector<HTMLElement>(`.pass-row[data-tier="${pass.state.tier || 1}"]`) : null;
    if (!current) return;
    scroller.scrollLeft = Math.max(0, current.offsetLeft - scroller.clientWidth / 2 + current.clientWidth / 2);
    railScroll = scroller.scrollLeft;
  };

  const bind = (pass: PassView | null): void => {
    root.querySelector("#pass-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    root.querySelector("#pass-missions")?.addEventListener("click", () => callbacks.onMissions());

    const scroller = root.querySelector<HTMLElement>("#pass-scroller");
    scroller?.addEventListener("scroll", () => {
      railScroll = scroller.scrollLeft;
    });

    root.querySelector("#pass-view-rail")?.addEventListener("click", () => {
      view = "rail";
      railScroll = null;
      render();
    });
    root.querySelector("#pass-view-list")?.addEventListener("click", () => {
      view = "list";
      render();
    });

    for (const button of root.querySelectorAll<HTMLElement>(".pass-tabs .rw-tab")) {
      button.addEventListener("click", () => {
        showing = button.dataset["season"] ?? null;
        picking = null;
        railScroll = null;
        audio.play("sfx.ui.hover");
        render();
      });
    }

    for (const button of root.querySelectorAll<HTMLElement>(".pass-claim-btn")) {
      bindTierClaim(button, pass);
    }

    for (const button of root.querySelectorAll<HTMLElement>(".pass-pick-open")) {
      bindPickOpen(button);
    }

    for (const button of root.querySelectorAll<HTMLElement>(".pass-pick")) {
      button.addEventListener("click", () => {
        if (!pass) return;
        const grant = claimPassTier(
          content,
          pass.season.id,
          "free",
          Number(button.dataset["tier"]),
          button.dataset["card"],
        );
        if (grant) audio.play("sfx.pack.rareReveal", { volume: 0.45, rate: 1.2 });
        picking = null;
        render();
      });
    }

    root.querySelector("#pass-encore")?.addEventListener("click", (event) => {
      const source = event.currentTarget as HTMLElement;
      const paid = claimEncore();
      if (paid) {
        flyReward(source, "clout", root);
        audio.play("sfx.pack.rareReveal", { volume: 0.5, rate: 1.05 });
      }
      render();
    });

    for (const button of root.querySelectorAll<HTMLElement>(".pass-buy")) {
      button.addEventListener("click", () => {
        if (buyBackstagePass(button.dataset["season"] ?? "")) audio.play("sfx.ui.confirm");
        else callbacks.onShop();
        render();
      });
    }

    for (const button of root.querySelectorAll<HTMLElement>(".pass-skip")) {
      button.addEventListener("click", () => {
        if (skipPassTier(button.dataset["season"] ?? "")) audio.play("sfx.ui.confirm");
        render();
      });
    }
  };

  /**
   * Claiming a tier patches that tier's lane, the wallet and the tab badge.
   *
   * The track already kept its own scroll across a claim; the rest of the
   * screen did not keep anything, because `render()` replaced all of it. One
   * cell is the whole state change — the tier's rewards are paid, the plate
   * goes to `claimed`, the seal is struck on the tile — so one cell is what
   * moves. Every other plate on the rail keeps the phase of its own specular,
   * which is what stops fifty of them sweeping in lockstep on the frame the
   * player pressed Claim.
   */
  const bindTierClaim = (button: HTMLElement, pass: PassView | null): void => {
    button.addEventListener("click", () => {
      if (!pass) return;
      const tier = Number(button.dataset["tier"]);
      const track = button.dataset["track"] as "free" | "backstage";
      const before = pass.rows.find((entry) => entry.tier === tier);
      const rewards = before ? (track === "free" ? before.free : before.backstage) : [];
      celebrate(button, rewards);
      const grant = claimPassTier(content, pass.season.id, track, tier);
      if (grant) audio.play("sfx.pack.rareReveal", { volume: 0.45, rate: 1.2 });

      const { live, archives } = hypeWaveViews();
      const after = [live, ...archives].find((entry) => entry?.season.id === pass.season.id) ?? null;
      const row = after?.rows.find((entry) => entry.tier === tier);
      const cell = root.querySelector(`.pass-row[data-tier="${tier}"] .pass-cell[data-lane="${track}"]`);
      if (!after || !row || !cell) {
        render();
        return;
      }
      const replacement = patchRow(cell, cellHtml(after, row, track));
      if (replacement) {
        const next = replacement.querySelector<HTMLElement>(".pass-claim-btn");
        if (next) bindTierClaim(next, after);
        const pick = replacement.querySelector<HTMLElement>(".pass-pick-open");
        if (pick) bindPickOpen(pick);
        paintRewardArt(replacement, art ?? undefined);
      }
      const profile = getProfile();
      updateWallet(root, { clout: profile.clout, glimmer: profile.glimmer ?? 0 });
      const badge = root.querySelector<HTMLElement>(`.pass-tabs .rw-tab[data-season="${CSS.escape(after.season.id)}"] .rw-badge`);
      if (badge) {
        if (after.unclaimed > 0) badge.textContent = String(after.unclaimed);
        else badge.remove();
      }
    });
  };

  const bindPickOpen = (button: HTMLElement): void => {
    button.addEventListener("click", () => {
      picking = picking === Number(button.dataset["tier"]) ? null : Number(button.dataset["tier"]);
      audio.play("sfx.ui.hover");
      render();
    });
  };

  /**
   * The claim, as a thing that happens rather than a number that is different.
   *
   * Fired *before* the grant and the re-render: the flight has to read the
   * button's position while the button is still on screen, and the flyer lives
   * on `document.body` so it survives the `innerHTML` that replaces the row
   * underneath it. That single ordering is why claims in this domain never
   * animated — every previous attempt started the animation on an element that
   * was destroyed on the same frame.
   */
  const celebrate = (source: HTMLElement, rewards: readonly PassReward[]): void => {
    if (!motionEnabled()) return;
    const box = source.getBoundingClientRect();
    for (const [index, reward] of rewards.entries()) {
      const coin = coinFor(reward);
      if (!coin) continue;
      globalThis.setTimeout(() => flyReward(box, coin, root), index * 90);
    }
  };

  /**
   * When the next season begins — read from the season table, not from a view.
   *
   * A view only exists for a pass, and there is no pass for a season that has
   * not started, so this is the one thing on the screen the views cannot answer.
   * Null when nothing further is authored, and the panel says so in words rather
   * than printing a date that does not exist.
   */
  function nextSeasonStart(): number | null {
    const now = Date.now();
    return (
      hypeWaveData()
        .seasons.map(seasonStart)
        .filter((start) => start > now)
        .sort((a, b) => a - b)[0] ?? null
    );
  }

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundPass?: unknown }).hypeboundPass = {
    view: () => {
      const { live, archives } = hypeWaveViews();
      const chosen = [live, ...archives].find((entry) => entry?.season.id === showing) ?? live;
      if (!chosen) return null;
      return {
        seasonId: chosen.season.id,
        live: chosen.live,
        tier: chosen.state.tier,
        pacing: chosen.pacing,
        paceLine: chosen.paceLine,
        multiplier: chosen.multiplier,
        backstage: chosen.backstage,
        unclaimed: chosen.unclaimed,
        encoreOwed: chosen.encoreOwed,
        claimable: chosen.rows.filter((row) => row.freeClaimable || row.backstageClaimable).map((row) => row.tier),
      };
    },
    claim: (track: "free" | "backstage", tier: number, cardId?: string) => {
      const { live, archives } = hypeWaveViews();
      const chosen = [live, ...archives].find((entry) => entry?.season.id === showing) ?? live;
      if (!chosen) return null;
      const grant = claimPassTier(content, chosen.season.id, track, tier, cardId);
      render();
      return grant;
    },
    buy: () => {
      const { live } = hypeWaveViews();
      const ok = live ? buyBackstagePass(live.season.id) : false;
      render();
      return ok;
    },
    encore: () => {
      const paid = claimEncore();
      render();
      return paid;
    },
    show: (seasonId: string) => {
      showing = seasonId;
      render();
    },
    refresh: render,
  };

  return {
    root,
    dispose: () => {
      art?.stop();
      delete (window as unknown as { hypeboundPass?: unknown }).hypeboundPass;
    },
  };
}
