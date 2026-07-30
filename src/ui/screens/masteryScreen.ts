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
import { DEFERRED_COSMETICS } from "../../game/progression/mastery";
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

export interface MasteryCallbacks {
  onBack: () => void;
}

type Tab = "faction" | "leader" | "bias";

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const ROMAN: Record<number, string> = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V" };

/** How many characters the Bias Board draws before it starts saying "and N more". */
const BIAS_SHOWN = 60;

/** What a reward says on the ladder. */
function rewardLabel(reward: MasteryReward): string {
  switch (reward.kind) {
    case "clout":
      return `<span class="currency-icon clout">◈</span>${reward.amount} Clout`;
    case "fragments":
      return `${reward.amount} Signal`;
    case "pack":
      return "Faction Pack — 5 cards from this faction";
    case "pick":
      return `Choose 1 of ${reward.choices} ${reward.rarity}s (${reward.copies} copies)`;
    case "lore":
      // a lookup rather than repeat-and-patch, which produces "IVI" at page 5
      return `Lore page ${ROMAN[reward.page] ?? reward.page}`;
    case "cosmetic":
      return reward.name;
  }
}

/** Why a cosmetic is not being granted — the deferral, said out loud. */
const deferredNote = (reward: MasteryReward): string =>
  reward.kind === "cosmetic" ? (DEFERRED_COSMETICS.get(reward.cosmetic) ?? "not built yet") : "";

const bar = (have: number, need: number): string =>
  `<div class="mastery-bar"><span style="width:${need > 0 ? Math.min(100, (have / need) * 100) : 100}%"></span></div>`;

export function createMasteryScreen(content: ContentIndex, callbacks: MasteryCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen mastery-screen";

  let tab: Tab = "faction";
  /** the track whose ladder is open, or null for the overview grid */
  let openId: string | null = null;
  /** a lore page opened for reading: `kind:id:page` */
  let openLore: string | null = null;

  const trackFor = (id: string): MasteryView | undefined =>
    (tab === "faction" ? factionMastery(content) : leaderMastery(content)).find((view) => view.id === id);

  // -------------------------------------------------------------------------
  // Overview
  // -------------------------------------------------------------------------

  const trackCard = (view: MasteryView, subtitle: string): string => `
    <li class="mastery-track ${view.unclaimed > 0 ? "has-reward" : ""}" data-id="${esc(view.id)}">
      <div class="mastery-track-head">
        <span class="mastery-rank">${view.rank}</span>
        <div class="mastery-track-name">
          <strong>${esc(view.name)}</strong>
          <span class="muted">${esc(subtitle)}</span>
        </div>
        ${view.unclaimed > 0 ? `<span class="mastery-badge">${view.unclaimed}</span>` : ""}
      </div>
      ${bar(view.intoRank, view.toNext)}
      <div class="mastery-track-foot muted">
        ${view.maxed ? "Mastered" : `${view.toNext - view.intoRank} XP to rank ${view.rank + 1}`}
      </div>
    </li>`;

  const biasCard = (view: AffinityView): string => `
    <li class="mastery-track bias ${view.unclaimed > 0 ? "has-reward" : ""}" data-id="${esc(view.cardId)}">
      <div class="mastery-track-head">
        <span class="mastery-rank">${view.tier}</span>
        <div class="mastery-track-name">
          <strong>${esc(view.name)}</strong>
          <span class="muted">${view.tierName ? esc(view.tierName) : "No tier yet"}</span>
        </div>
        ${view.unclaimed > 0 ? `<span class="mastery-badge">${view.unclaimed}</span>` : ""}
      </div>
      ${bar(view.ap, view.nextAt || view.ap)}
      <div class="mastery-track-foot muted">
        ${view.nextAt > 0 ? `${view.ap} / ${view.nextAt} AP` : `${view.ap} AP — Parasocial`}
      </div>
    </li>`;

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

  const ladderRow = (view: MasteryView, row: MasteryView["rows"][number]): string => {
    const pick = row.rewards.find((reward) => reward.kind === "pick");
    const choices = row.claimable && pick ? (masteryPickChoices(content, tab as MasteryTrack, view.id, row.rank) ?? []) : [];
    const lore = row.rewards.find((reward) => reward.kind === "lore");
    return `
      <li class="mastery-row ${row.earned ? "earned" : ""} ${row.claimed ? "claimed" : ""}" data-rank="${row.rank}">
        <span class="mastery-row-rank">${row.rank}</span>
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
                         `<button class="btn btn-ghost mastery-pick" data-card="${esc(card.id)}">${esc(card.name)}</button>`
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
              ? `<span class="muted">Claimed</span>`
              : row.claimable && !pick
                ? `<button class="btn btn-primary mastery-claim">Claim</button>`
                : row.claimable && pick
                  ? `<span class="muted">Pick one</span>`
                  : row.earned
                    ? `<span class="muted mastery-waiting">Earned — waiting on the cosmetics layer</span>`
                    : `<span class="muted">Locked</span>`
          }
        </div>
      </li>`;
  };

  const ladder = (view: MasteryView): string => `
    <section class="panel panel-chrome mastery-detail" data-track="${esc(view.id)}">
      <div class="mastery-detail-head">
        <button class="btn btn-ghost" id="mastery-close">← All tracks</button>
        <h2 class="mastery-detail-title">${esc(view.name)} — rank ${view.rank}</h2>
        <span class="muted">${view.maxed ? "Mastered" : `${view.intoRank} / ${view.toNext} XP`}</span>
      </div>
      <ul class="mastery-ladder">${view.rows.map((row) => ladderRow(view, row)).join("")}</ul>
    </section>`;

  const biasLadder = (view: AffinityView): string => {
    const ap = publishedAffinity().ap;
    return `
      <section class="panel panel-chrome mastery-detail" data-track="${esc(view.cardId)}">
        <div class="mastery-detail-head">
          <button class="btn btn-ghost" id="mastery-close">← Bias Board</button>
          <h2 class="mastery-detail-title">${esc(view.name)} — ${view.ap} AP</h2>
          <span class="muted">${view.tierName ? esc(view.tierName) : "No tier yet"}</span>
        </div>
        <p class="muted mastery-ap-rule">
          Play it <strong>+${ap.play}</strong> · support it <strong>+${ap.support}</strong> ·
          its Parasocial triggers <strong>+${ap.parasocial}</strong> · win with it <strong>+${ap.win}</strong>.
          At most <strong>${publishedAffinity().perMatchCap}</strong> per match, so devotion spreads across a roster.
        </p>
        <ul class="mastery-ladder">
          ${view.tiers
            .map(
              (tier, index) => `
                <li class="mastery-row ${tier.earned ? "earned" : ""} ${tier.claimed ? "claimed" : ""}" data-rank="${index + 1}">
                  <span class="mastery-row-rank">${tier.ap}</span>
                  <div class="mastery-row-body">
                    <div class="mastery-row-rewards">
                      <strong>${esc(tier.name)}</strong>
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
                        ? `<span class="muted">Claimed</span>`
                        : tier.claimable
                          ? `<button class="btn btn-primary mastery-claim">Claim</button>`
                          : tier.earned
                            ? `<span class="muted mastery-waiting">Earned — waiting on the cosmetics layer</span>`
                            : `<span class="muted">Locked</span>`
                    }
                  </div>
                </li>`
            )
            .join("")}
        </ul>
      </section>`;
  };

  // -------------------------------------------------------------------------

  const render = (): void => {
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
      `<button class="btn mastery-tab ${tab === id ? "active" : ""}" data-tab="${id}">
         ${label}${counts[id] > 0 ? `<span class="mastery-badge">${counts[id]}</span>` : ""}
       </button>`;

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="mastery-back">← Back</button>
        <h1 class="title">Mastery</h1>
        <div class="mastery-wallet">
          <div class="currency"><span class="currency-icon clout">◈</span><span class="currency-value" id="mastery-clout">${profile.clout.toLocaleString()}</span></div>
          <div class="currency"><span class="currency-icon">✦</span><span class="currency-value">${profile.shards.toLocaleString()}</span></div>
        </div>
      </header>

      <main class="mastery-body">
        <section class="panel panel-chrome mastery-intro">
          <p class="mastery-rule">
            <strong>Mastery counts matches, not missions.</strong> Every match pays its own XP into
            the faction and the leader you played it with — win or lose. Nothing here expires, and
            nothing here can be bought.
          </p>
        </section>

        <nav class="mastery-tabs">
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
                ? `<ul class="mastery-grid" id="mastery-factions">${factions
                    .map((view) => trackCard(view, view.maxed ? "Mastered" : `Rank ${view.rank} of 20`))
                    .join("")}</ul>`
                : tab === "leader"
                  ? `<ul class="mastery-grid" id="mastery-leaders">${leaders
                      .map((view) =>
                        trackCard(view, content.factions[view.factionId as keyof typeof content.factions]?.name ?? "")
                      )
                      .join("")}</ul>`
                  : board.length === 0
                    ? `<p class="muted mastery-empty" id="mastery-bias">Play a match, or open a Merch Drop, and the characters you field appear here.</p>`
                    : `<ul class="mastery-grid" id="mastery-bias">${board.slice(0, BIAS_SHOWN).map(biasCard).join("")}</ul>
                       ${
                         board.length > BIAS_SHOWN
                           ? `<p class="muted mastery-empty">Showing the ${BIAS_SHOWN} characters you have spent the most time with.
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
      delete (window as unknown as { hypeboundMastery?: unknown }).hypeboundMastery;
    },
  };
}
