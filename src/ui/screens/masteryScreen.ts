/**
 * Mastery — Faction, Leader and the Bias Board.
 *
 * `08-progression.md` §4, §5 and §6, on one screen with three tabs, because they
 * are three views of the same thing: a record of what you have actually played.
 *
 * Three decisions worth stating, all of them about honesty:
 *
 * **A rank that cannot pay does not offer a button.** Most of the design's
 * mastery rewards are cosmetics the game has no system for. Those rows read
 * "Earned" and say what they are waiting for, rather than offering a Claim that
 * would take the rank away and hand over nothing.
 *
 * **The XP the bar counts is the XP a match paid.** Both come from
 * `progression.json`'s `xp` block, so the "N to go" on a track and the number
 * actually granted cannot drift apart.
 *
 * **Lore is readable here, not merely announced.** A page unlocked at rank 7 is
 * the reward; a line saying "you unlocked a lore page" is not. Clicking an
 * earned page opens it in place.
 */

import type { CardDef, ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import type { AffinityView, MasteryReward, MasteryTrack, MasteryView } from "../../game/progression/mastery";
import { DEFERRED_COSMETICS, xpForRank } from "../../game/progression/mastery";
import { factionMasteryConfig, leaderMasteryConfig } from "../../game/progression/data";
import { masteryLore, type LoreKind } from "../../game/progression/masteryLore";
import {
  biasBoard,
  claimAffinityTier,
  claimMasteryRank,
  factionMastery,
  getProfile,
  leaderMastery,
  masteryPickChoices,
  publishedAffinity,
} from "../../save/profile";
import { audio } from "../../audio/audio";
import {
  cloutIcon,
  colourFor,
  count,
  countUp,
  crestMark,
  disposeBag,
  enter,
  esc,
  icon,
  meter,
  rankMark,
  rewardMark,
  rovingList,
  shardsIcon,
  type RewardKind,
} from "./data/kit";

export interface MasteryCallbacks {
  onBack: () => void;
}

type Tab = "faction" | "leader" | "bias";

const ROMAN: Record<number, string> = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V" };

/** How many characters the Bias Board draws before it starts saying "and N more". */
const BIAS_SHOWN = 60;

/** How many ranks a Mastery track has. Used for the tick marks and the crest. */
const TRACK_RANKS = 20;

/**
 * Milestones get a heavier plate.
 *
 * MTGA draws its mastery milestones as larger nodes with a rim glow, so the
 * track has a rhythm and a player can see the next *big* thing rather than only
 * the next thing. Twenty identical rungs have no rhythm at all.
 */
const MILESTONES = new Set([5, 10, 15, 20]);

/**
 * What a locked rung says on its right-hand end.
 *
 * It used to say "Rank 7" — which the *same row* already says, in a tabular
 * numeral, four hundred pixels to the left. Recon defect 7 counted the rank
 * printed three times per tile on the overview and the same duplication survived
 * onto the ladder: twenty rows whose only right-hand content was the number that
 * opens them. A column that repeats another column is a column with nothing in
 * it, and this one is the widest thing on the row.
 *
 * So it answers the question a player actually has in front of a locked reward,
 * which is *how far*. The distance is computed from the same curve the bar above
 * it fills against — `xpForRank` on the track's own config — so the ladder and
 * the meter cannot disagree about what rank 7 costs.
 *
 * Guarded, because `factionMasteryConfig()` parses and validates the progression
 * file on first call and throws on a malformed one. A distance label is
 * information; it must never be the thing that takes the screen down.
 */
function xpAwayFrom(track: MasteryTrack, xpNow: number, rank: number): number | null {
  if (track === "affinity") return null;
  try {
    const config = track === "faction" ? factionMasteryConfig() : leaderMasteryConfig();
    return Math.max(0, xpForRank(config, rank) - xpNow);
  } catch {
    return null;
  }
}

/** What a reward says on the ladder, and what shape it is drawn as. */
function rewardShape(reward: MasteryReward): RewardKind {
  return reward.kind;
}

function rewardLabel(reward: MasteryReward): string {
  switch (reward.kind) {
    case "clout":
      return `${cloutIcon(14)}<span class="num">${count(reward.amount)}</span> Clout`;
    case "fragments":
      return `${shardsIcon(14)}<span class="num">${count(reward.amount)}</span> Signal`;
    case "pack":
      return "Faction Pack <span class='mastery-reward-note'>5 cards from this faction</span>";
    case "pick":
      return `Choose 1 of ${count(reward.choices)} ${esc(reward.rarity)}s <span class='mastery-reward-note'>${count(
        reward.copies
      )} copies</span>`;
    case "lore":
      // a lookup rather than repeat-and-patch, which produces "IVI" at page 5
      return `Lore page ${ROMAN[reward.page] ?? reward.page}`;
    case "cosmetic":
      return esc(reward.name);
  }
}

/** Why a cosmetic is not being granted — the deferral, said out loud. */
const deferredNote = (reward: MasteryReward): string =>
  reward.kind === "cosmetic" ? (DEFERRED_COSMETICS.get(reward.cosmetic) ?? "not built yet") : "";

export function createMasteryScreen(content: ContentIndex, callbacks: MasteryCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen mastery-screen";

  let tab: Tab = "faction";
  /** the track whose ladder is open, or null for the overview grid */
  let openId: string | null = null;
  /** a lore page opened for reading: `kind:id:page` */
  let openLore: string | null = null;
  const bag = disposeBag();

  const trackFor = (id: string): MasteryView | undefined =>
    (tab === "faction" ? factionMastery(content) : leaderMastery(content)).find((view) => view.id === id);

  // -------------------------------------------------------------------------
  // Overview
  // -------------------------------------------------------------------------

  /**
   * A track tile: a crest, a name, a rank medallion and a ticked rail.
   *
   * The old tile printed the rank integer **three times** — a grey circle, the
   * words "Rank 13 of 20", and an amber pill that was actually the unclaimed
   * count wearing the same shape. All ten factions rendered identically because
   * nothing on the tile knew its faction had a colour, let alone a crest, even
   * though `FACTION_COLOR` and `cosmetics.json`'s emblem table have both existed
   * the whole time and the statistics screen one click away already used one of
   * them.
   *
   * Now: the crest says which faction, the medallion says which rank, the
   * subtitle says how far to the next one, and the gift badge — a glyph and a
   * count — cannot be mistaken for a rank because it is not a bare number.
   */
  const trackCard = (view: MasteryView, subtitle: string): string => {
    const colour = colourFor(view.factionId);
    const toGo = Math.max(0, view.toNext - view.intoRank);
    return `
      <li>
        <button type="button" class="d-tile mat-panel act d-enter mastery-track ${view.unclaimed > 0 ? "has-reward" : ""}"
                data-id="${esc(view.id)}" style="--row-accent:${esc(colour)}"
                aria-label="${esc(view.name)}, rank ${view.rank} of ${TRACK_RANKS}">
          ${crestMark(view.factionId, 52, view.rank > 0 ? 1 : 0.45)}
          ${
            /*
             * The gift badge is a corner pip on the crest, not a word in the
             * title.
             *
             * Laid out inside `.d-tile-name` it stole the title's width, and at
             * 1600×900 **five of the ten faction names were ellipsised** —
             * "Viral Influence…", "Corporate Cre…", "Cosplay Cham…",
             * "Touch-Grass O…", "Algorithm Synd…". Ellipsising your own faction
             * names on the faction screen is the one thing this screen cannot
             * do, and the data is fixed: those ten strings will never get
             * shorter. It only looked fine at `--ui-scale: 1.4` because the grid
             * drops to two columns there.
             *
             * On the crest it reads the way an unread pip reads on an avatar,
             * it cannot collide with type, and the title gets the whole tile.
             */
            view.unclaimed > 0
              ? `<span class="d-badge d-tile-pip">${icon("chest", 12)}<span class="num">${count(
                  view.unclaimed
                )}</span></span>`
              : ""
          }
          <span class="d-tile-name">
            <span>${esc(view.name)}</span>
          </span>
          <span class="d-tile-sub">${esc(subtitle)}</span>
          ${meter({
            value: view.maxed ? 1 : view.toNext > 0 ? view.intoRank / view.toNext : 0,
            steps: 0,
            colour,
            animate: true,
          })}
          <span class="d-tile-foot">
            <span class="mastery-rank-chip">
              ${rankMark({ tier: view.rank, tiers: TRACK_RANKS, colour }, 30)}
              <span class="mastery-rank-number">Rank <span class="num">${count(view.rank)}</span></span>
            </span>
            <span class="mastery-togo">${
              view.maxed ? "Mastered" : `<span class="num">${count(toGo)}</span> XP to go`
            }</span>
          </span>
        </button>
      </li>`;
  };

  const biasCard = (view: AffinityView): string => {
    const colour = colourFor(view.factionId);
    return `
      <li>
        <button type="button" class="d-tile mat-panel act d-enter mastery-track bias ${view.unclaimed > 0 ? "has-reward" : ""}"
                data-id="${esc(view.cardId)}" style="--row-accent:${esc(colour)}"
                aria-label="${esc(view.name)}, ${view.ap} affinity">
          ${crestMark(view.factionId, 52, view.tier > 0 ? 1 : 0.45)}
          ${
            view.unclaimed > 0
              ? `<span class="d-badge d-tile-pip">${icon("chest", 12)}<span class="num">${count(
                  view.unclaimed
                )}</span></span>`
              : ""
          }
          <span class="d-tile-name">
            <span>${esc(view.name)}</span>
          </span>
          <span class="d-tile-sub">${view.tierName ? esc(view.tierName) : "No tier yet"}</span>
          ${meter({
            value: view.nextAt > 0 ? view.ap / view.nextAt : 1,
            steps: 0,
            colour,
            animate: true,
          })}
          <span class="d-tile-foot">
            <span>${
              view.nextAt > 0
                ? `<span class="num">${count(view.ap)}</span> / <span class="num">${count(view.nextAt)}</span> AP`
                : `<span class="num">${count(view.ap)}</span> AP — Parasocial`
            }</span>
          </span>
        </button>
      </li>`;
  };

  // -------------------------------------------------------------------------
  // The ladder for one track
  // -------------------------------------------------------------------------

  const loreBlock = (kind: LoreKind, id: string, page: number, fallback: string, earned: boolean): string => {
    const key = `${kind}:${id}:${page}`;
    if (openLore !== key) {
      return earned ? `<button class="btn btn-ghost mastery-read" data-lore="${esc(key)}">Read</button>` : "";
    }
    const lore = masteryLore(kind, id, page, fallback);
    return `
      <div class="mastery-lore" data-lore-open="${esc(key)}">
        <h4>${esc(lore.title)}</h4>
        ${lore.body.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}
        ${lore.quote ? `<p class="mastery-lore-quote">${esc(lore.quote)}</p>` : ""}
        ${lore.written ? "" : `<p class="muted">Nobody has written this page yet. It will appear here when they do.</p>`}
      </div>`;
  };

  /**
   * One rung.
   *
   * Every reward now draws the object it actually is — a stack of cards for a
   * pack, a struck coin for Clout, an open page for lore, a hung plate for a
   * cosmetic — so a player scanning the ladder sees *what is up there* rather
   * than twenty grey pills and the word "Locked" twenty times. Milestone ranks
   * carry a heavier plate and a rim glow, which is the rhythm MTGA's track has
   * and this one did not.
   */
  const ladderRow = (view: MasteryView, row: MasteryView["rows"][number], colour: string): string => {
    const pick = row.rewards.find((reward) => reward.kind === "pick");
    const choices = row.claimable && pick ? (masteryPickChoices(content, tab as MasteryTrack, view.id, row.rank) ?? []) : [];
    const lore = row.rewards.find((reward) => reward.kind === "lore");
    const state = row.claimed ? "claimed" : row.claimable ? "claimable" : row.earned ? "earned" : "locked";
    const headline = row.rewards[0];

    return `
      <li class="mastery-row d-enter mat-panel ${row.earned ? "earned" : ""} ${row.claimed ? "claimed" : ""}
                 ${MILESTONES.has(row.rank) ? "is-milestone" : ""} is-${state}"
          data-rank="${row.rank}" style="--row-accent:${esc(colour)}">
        <span class="mastery-row-rank">
          <span class="t-label">Rank</span>
          <span class="num">${count(row.rank)}</span>
        </span>
        ${
          headline
            ? rewardMark(rewardShape(headline), state === "locked" ? "#6a6382" : colour, MILESTONES.has(row.rank) ? 54 : 44)
            : ""
        }
        <div class="mastery-row-body">
          <div class="mastery-row-rewards">
            ${row.rewards
              .map(
                (reward) =>
                  `<span class="mastery-reward ${reward.kind === "cosmetic" ? "deferred" : ""}"
                     ${reward.kind === "cosmetic" ? `title="${esc(deferredNote(reward))}"` : ""}>
                     ${rewardLabel(reward)}
                   </span>`
              )
              .join("")}
          </div>
          ${
            choices.length > 0
              ? `<div class="mastery-choices">
                   ${choices
                     .map(
                       (card: CardDef) =>
                         `<button type="button" class="mat-chip act r-chip mastery-pick" data-card="${esc(card.id)}">${esc(
                           card.name
                         )}</button>`
                     )
                     .join("")}
                 </div>`
              : ""
          }
          ${
            lore && lore.kind === "lore"
              ? loreBlock(
                  tab === "faction" ? "faction" : "leader",
                  view.id,
                  lore.page,
                  view.name,
                  row.earned
                )
              : ""
          }
        </div>
        <div class="mastery-row-action">
          ${
            row.claimed
              ? `<span class="mastery-state is-done">${icon("check", 14)} Claimed</span>`
              : row.claimable && !pick
                ? `<button type="button" class="mat-hero act r-chip mastery-claim">Claim</button>`
                : row.claimable && pick
                  ? `<span class="mastery-state">Pick one</span>`
                  : row.earned
                    ? `<span class="mastery-state mastery-waiting">Earned — waiting on the cosmetics layer</span>`
                    : `<span class="mastery-state is-locked">${icon("lock", 13)} ${
                        (() => {
                          const away = xpAwayFrom(tab === "leader" ? "leader" : "faction", view.xp, row.rank);
                          /*
                           * Rank 1 costs nothing on the curve and is still not
                           * earned, because a track nobody has played has no
                           * ranks at all — see `buildView`. "0 XP away" is the
                           * arithmetic being honest and the sentence being
                           * wrong; the gate is a match, so say so.
                           */
                          if (away === null) return "Locked";
                          if (away <= 0) return "One match away";
                          return `<span class="num">${count(away)}</span> XP away`;
                        })()
                      }</span>`
          }
        </div>
      </li>`;
  };

  const ladder = (view: MasteryView): string => {
    const colour = colourFor(view.factionId);
    const toGo = Math.max(0, view.toNext - view.intoRank);
    return `
      <section class="mat-panel mastery-detail" data-track="${esc(view.id)}"
               style="--row-accent:${esc(colour)}">
        <div class="mastery-detail-head">
          <button type="button" class="mat-chip act r-chip" id="mastery-close">
            ${icon("arrow-left", 14)} All tracks
          </button>
          ${crestMark(view.factionId, 64)}
          <div class="mastery-detail-title-group">
            <h2 class="mastery-detail-title t-display">${esc(view.name)}</h2>
            <p class="t-label">${view.maxed ? "Mastered" : `Rank ${count(view.rank)} of ${TRACK_RANKS}`}</p>
          </div>
          <div class="mastery-detail-xp">
            <span class="mastery-detail-xp-value num">${count(view.intoRank)} / ${count(view.toNext)}</span>
            <span class="t-label">${view.maxed ? "Complete" : `${count(toGo)} XP to go`}</span>
          </div>
        </div>
        ${meter({
          value: view.maxed ? 1 : view.toNext > 0 ? view.intoRank / view.toNext : 0,
          steps: 0,
          colour,
          animate: true,
          className: "mastery-detail-meter",
        })}
        <ul class="mastery-ladder">${view.rows.map((row) => ladderRow(view, row, colour)).join("")}</ul>
      </section>`;
  };

  const biasLadder = (view: AffinityView): string => {
    const ap = publishedAffinity().ap;
    const colour = colourFor(view.factionId);
    return `
      <section class="mat-panel mastery-detail" data-track="${esc(view.cardId)}"
               style="--row-accent:${esc(colour)}">
        <div class="mastery-detail-head">
          <button type="button" class="mat-chip act r-chip" id="mastery-close">
            ${icon("arrow-left", 14)} Bias Board
          </button>
          ${crestMark(view.factionId, 64)}
          <div class="mastery-detail-title-group">
            <h2 class="mastery-detail-title t-display">${esc(view.name)}</h2>
            <p class="t-label">${view.tierName ? esc(view.tierName) : "No tier yet"}</p>
          </div>
          <div class="mastery-detail-xp">
            <span class="mastery-detail-xp-value num">${count(view.ap)}</span>
            <span class="t-label">Affinity</span>
          </div>
        </div>
        <p class="t-body mastery-ap-rule">
          Play it <strong>+${ap.play}</strong> · support it <strong>+${ap.support}</strong> ·
          its Parasocial triggers <strong>+${ap.parasocial}</strong> · win with it <strong>+${ap.win}</strong>.
          At most <strong>${publishedAffinity().perMatchCap}</strong> per match, so devotion spreads across a roster.
        </p>
        <ul class="mastery-ladder">
          ${view.tiers
            .map((tier, index) => {
              const state = tier.claimed ? "claimed" : tier.claimable ? "claimable" : tier.earned ? "earned" : "locked";
              const headline = tier.rewards[0];
              return `
                <li class="mastery-row d-enter mat-panel ${tier.earned ? "earned" : ""} ${tier.claimed ? "claimed" : ""} is-${state}"
                    data-rank="${index + 1}" style="--row-accent:${esc(colour)}">
                  <span class="mastery-row-rank">
                    <span class="t-label">AP</span>
                    <span class="num">${count(tier.ap)}</span>
                  </span>
                  ${headline ? rewardMark(rewardShape(headline), state === "locked" ? "#6a6382" : colour, 44) : ""}
                  <div class="mastery-row-body">
                    <div class="mastery-row-rewards">
                      <strong class="mastery-tier-name">${esc(tier.name)}</strong>
                      ${tier.rewards
                        .map(
                          (reward) =>
                            `<span class="mastery-reward ${reward.kind === "cosmetic" ? "deferred" : ""}"
                               ${reward.kind === "cosmetic" ? `title="${esc(deferredNote(reward))}"` : ""}>
                               ${rewardLabel(reward)}
                             </span>`
                        )
                        .join("")}
                    </div>
                    ${tier.rewards
                      .filter((reward) => reward.kind === "lore")
                      .map((reward) =>
                        reward.kind === "lore" ? loreBlock("bias", view.cardId, reward.page, view.name, tier.earned) : ""
                      )
                      .join("")}
                  </div>
                  <div class="mastery-row-action">
                    ${
                      tier.claimed
                        ? `<span class="mastery-state is-done">${icon("check", 14)} Claimed</span>`
                        : tier.claimable
                          ? `<button type="button" class="mat-hero act r-chip mastery-claim">Claim</button>`
                          : tier.earned
                            ? `<span class="mastery-state mastery-waiting">Earned — waiting on the cosmetics layer</span>`
                            : `<span class="mastery-state is-locked">${icon("lock", 13)} ${count(tier.ap)} AP</span>`
                    }
                  </div>
                </li>`;
            })
            .join("")}
        </ul>
      </section>`;
  };

  // -------------------------------------------------------------------------

  const render = (): void => {
    bag.run();
    const profile = getProfile();
    const factions = factionMastery(content);
    const leaders = leaderMastery(content);
    const board = biasBoard(content);
    const openTrack = openId && tab !== "bias" ? trackFor(openId) : undefined;
    const openBias = openId && tab === "bias" ? board.find((view) => view.cardId === openId) : undefined;

    const counts = {
      faction: factions.reduce((sum, view) => sum + view.unclaimed, 0),
      leader: leaders.reduce((sum, view) => sum + view.unclaimed, 0),
      bias: board.reduce((sum, view) => sum + view.unclaimed, 0),
    };

    const tabButton = (id: Tab, label: string): string =>
      `<button type="button" class="d-chip mat-chip act mastery-tab ${tab === id ? "active is-on" : ""}"
               role="radio" aria-checked="${tab === id}" data-tab="${id}">
         ${label}${
           counts[id] > 0
             ? `<span class="d-badge">${icon("chest", 12)}<span class="num">${count(counts[id])}</span></span>`
             : ""
         }
       </button>`;

    /**
     * The band that fills the lower half.
     *
     * Recon defect 17: the mastery grid ended at y≈510 of 900 and the rest was
     * unbroken void, which the eye reads as content that failed to load rather
     * than as space. Three closest claimable rewards, with their art, is a
     * secondary band that earns its place — it is the answer to "what am I
     * playing towards", which is the whole question this screen exists for.
     */
    const nextRewards = (): string => {
      const pool = [...factions, ...leaders]
        .filter((view) => !view.maxed)
        .map((view) => {
          const nextRow = view.rows.find((entry) => entry.rank > view.rank) ?? view.rows[view.rows.length - 1];
          const toGo = Math.max(0, view.toNext - view.intoRank);
          return nextRow ? { view, row: nextRow, toGo } : null;
        })
        .filter((entry): entry is { view: MasteryView; row: MasteryView["rows"][number]; toGo: number } => entry !== null)
        .sort((a, b) => a.toGo - b.toGo)
        .slice(0, 3);

      if (pool.length === 0) return "";

      return `
        <section class="mat-panel mastery-next">
          <div class="mastery-next-head">
            <h2 class="t-heading">Closest rewards</h2>
            <p class="t-body">The three ranks you are nearest to, across every track.</p>
          </div>
          <ul class="mastery-next-list">
            ${pool
              .map(({ view, row, toGo }) => {
                const colour = colourFor(view.factionId);
                const headline = row.rewards[0];
                return `
                  <li class="mastery-next-item d-enter mat-panel" style="--row-accent:${esc(colour)}">
                    ${headline ? rewardMark(rewardShape(headline), colour, 52) : ""}
                    <div class="mastery-next-text">
                      <span class="d-row-title">${headline ? rewardLabel(headline) : `Rank ${count(row.rank)}`}</span>
                      <span class="d-row-meta">${esc(view.name)} · rank ${count(row.rank)}</span>
                    </div>
                    <span class="mastery-next-go">
                      <span class="num">${count(toGo)}</span>
                      <span class="t-label">XP to go</span>
                    </span>
                  </li>`;
              })
              .join("")}
          </ul>
        </section>`;
    };

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="mastery-back">${icon("arrow-left", 16)} Back</button>
        <h1 class="title">Mastery</h1>
        <div class="mastery-wallet">
          <div class="currency">${cloutIcon(15)}<span class="currency-value num" id="mastery-clout">${count(
            profile.clout
          )}</span></div>
          <div class="currency">${shardsIcon(15)}<span class="currency-value num">${count(profile.shards)}</span></div>
        </div>
      </header>

      <main class="mastery-body data-body">
        <section class="mat-panel mastery-intro">
          <p class="mastery-rule">
            <strong>Mastery counts matches, not missions.</strong> Every match pays its own XP into
            the faction and the leader you played it with — win or lose. Nothing here expires, and
            nothing here can be bought.
          </p>
        </section>

        <nav class="mastery-tabs d-chips" role="radiogroup" aria-label="Mastery track">
          ${tabButton("faction", "Factions")}
          ${tabButton("leader", "Leaders")}
          ${tabButton("bias", "Bias Board")}
        </nav>

        ${
          openTrack
            ? ladder(openTrack)
            : openBias
              ? biasLadder(openBias)
              : tab === "faction"
                ? `<ul class="mastery-grid d-grid" id="mastery-factions">${factions
                    .map((view) =>
                      trackCard(
                        view,
                        view.maxed ? "Every rank taken" : `${view.rows.length - view.rank} ranks left`
                      )
                    )
                    .join("")}</ul>
                   ${nextRewards()}`
                : tab === "leader"
                  ? `<ul class="mastery-grid d-grid" id="mastery-leaders">${leaders
                      .map((view) =>
                        trackCard(view, content.factions[view.factionId as keyof typeof content.factions]?.name ?? "")
                      )
                      .join("")}</ul>
                     ${nextRewards()}`
                  : board.length === 0
                    ? `<div class="empty d-enter" id="mastery-bias">
                         ${icon("kw-parasocial", 40)}
                         <h3 class="t-heading">Nobody has caught your eye yet</h3>
                         <p class="t-body">Play a match, or open a Merch Drop, and the characters you field start collecting affinity here.</p>
                       </div>`
                    : `<ul class="mastery-grid d-grid" id="mastery-bias">${board
                        .slice(0, BIAS_SHOWN)
                        .map(biasCard)
                        .join("")}</ul>
                       ${
                         board.length > BIAS_SHOWN
                           ? `<p class="t-body mastery-empty">Showing the ${BIAS_SHOWN} characters you have spent the most time with.
                                ${board.length - BIAS_SHOWN} more are on the board at zero — play one and it comes to the top.</p>`
                           : ""
                       }`
        }
      </main>`;

    root.querySelector("#mastery-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    root.querySelector("#mastery-close")?.addEventListener("click", () => {
      openId = null;
      openLore = null;
      render();
    });
    for (const button of root.querySelectorAll<HTMLElement>(".mastery-tab")) {
      button.addEventListener("click", () => {
        tab = (button.dataset["tab"] ?? "faction") as Tab;
        openId = null;
        openLore = null;
        audio.play("sfx.ui.hover");
        render();
      });
    }
    for (const element of root.querySelectorAll<HTMLElement>(".mastery-track")) {
      element.addEventListener("click", () => {
        openId = element.dataset["id"] ?? null;
        openLore = null;
        audio.play("sfx.ui.click");
        render();
      });
    }
    for (const element of root.querySelectorAll<HTMLElement>(".mastery-read")) {
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        openLore = element.dataset["lore"] ?? null;
        render();
      });
    }
    for (const row of root.querySelectorAll<HTMLElement>(".mastery-row")) {
      const rank = Number(row.dataset["rank"] ?? 0);
      row.querySelector(".mastery-claim")?.addEventListener("click", () => {
        const granted =
          tab === "bias"
            ? claimAffinityTier(content, openId ?? "", rank)
            : claimMasteryRank(content, tab as MasteryTrack, openId ?? "", rank);
        if (granted) audio.play("sfx.ui.click");
        render();
      });
      for (const pick of row.querySelectorAll<HTMLElement>(".mastery-pick")) {
        pick.addEventListener("click", () => {
          const granted = claimMasteryRank(
            content,
            tab as MasteryTrack,
            openId ?? "",
            rank,
            pick.dataset["card"] ?? ""
          );
          if (granted) audio.play("sfx.ui.click");
          render();
        });
      }
    }

    enter(root);
    countUp(root);
    bag.add(rovingList(root.querySelector<HTMLElement>(".mastery-grid"), ".d-tile"));
  };

  render();

  /** Automation hook, the same shape the shop, tour and missions screens expose. */
  (window as unknown as { hypeboundMastery?: unknown }).hypeboundMastery = {
    factions: () => factionMastery(content),
    leaders: () => leaderMastery(content),
    bias: () => biasBoard(content),
    open: (nextTab: Tab, id: string) => {
      tab = nextTab;
      openId = id;
      openLore = null;
      render();
    },
    claim: (nextTab: MasteryTrack, id: string, rank: number, cardId?: string) => {
      const granted = claimMasteryRank(content, nextTab, id, rank, cardId);
      render();
      return granted;
    },
    picks: (nextTab: MasteryTrack, id: string, rank: number) =>
      (masteryPickChoices(content, nextTab, id, rank) ?? []).map((card) => card.id),
    published: () => ({ affinity: publishedAffinity() }),
    refresh: render,
  };

  return {
    root,
    dispose: () => {
      bag.run();
      delete (window as unknown as { hypeboundMastery?: unknown }).hypeboundMastery;
    },
  };
}
