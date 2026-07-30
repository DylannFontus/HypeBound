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

export interface HypeWaveCallbacks {
  onBack: () => void;
  onMissions: () => void;
  onShop: () => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Schedule dates are authored as UTC midnight, so they are formatted in UTC.
 *
 * Formatting them locally renders 2026-07-27T00:00Z as "26 July" for everyone
 * west of Greenwich — a run advertised as ending a day before the data says it
 * does. These are calendar dates in a data file rather than moments in a
 * player's day, and they should read the same everywhere.
 */
const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** What a reward says on a tier row. */
function rewardLabel(reward: PassReward): string {
  switch (reward.kind) {
    case "clout":
      return `<span class="currency-icon clout">◈</span>${reward.amount}`;
    case "fragments":
      return `${reward.amount} Signal`;
    case "glimmer":
      return `<span class="currency-icon glimmer">✧</span>${reward.amount}`;
    case "pack":
      return "1 Merch Drop";
    case "pick":
      return `Choose 1 of ${reward.choices} ${reward.rarity}s${reward.copies > 1 ? ` ×${reward.copies}` : ""}`;
    case "cosmetic":
      return esc(reward.name);
  }
}

/** Why a reward is not being granted — the deferral, said out loud. */
const deferredNote = (reward: PassReward): string =>
  reward.kind === "cosmetic" && !reward.ref ? (DEFERRED_PASS.get(reward.name) ?? "not built yet") : "";

const PACING_COPY: Record<PassView["pacing"], string> = {
  ahead: "Ahead of pace",
  "on-pace": "On pace",
  rebound: "Wave Rebound is on — +50% until you catch up",
};

export function createHypeWaveScreen(content: ContentIndex, callbacks: HypeWaveCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen pass-screen";

  /** the tier whose pick is open, or null */
  let picking: number | null = null;
  /** which pass is being looked at: the live season's id, or an archive's */
  let showing: string | null = null;

  const tierRow = (view: PassView, row: PassView["rows"][number]): string => {
    const pick = row.free.find((reward) => reward.kind === "pick");
    const choices =
      picking === row.tier && pick ? (passPickChoices(content, view.season.id, row.tier) ?? []) : [];

    const cell = (track: "free" | "backstage"): string => {
      const rewards = track === "free" ? row.free : row.backstage;
      const claimed = track === "free" ? row.freeClaimed : row.backstageClaimed;
      const claimable = track === "free" ? row.freeClaimable : row.backstageClaimable;
      const locked = track === "backstage" && !view.backstage;
      return `
        <div class="pass-cell ${claimed ? "claimed" : ""} ${claimable ? "claimable" : ""} ${locked ? "locked" : ""}">
          <div class="pass-rewards">
            ${rewards
              .map((reward) => {
                const note = deferredNote(reward);
                return `<span class="pass-reward ${note ? "deferred" : ""}" ${note ? `title="${esc(note)}"` : ""}>
                          ${rewardLabel(reward)}
                        </span>`;
              })
              .join("")}
          </div>
          ${
            claimed
              ? `<span class="muted pass-state">Claimed</span>`
              : claimable && pick && track === "free"
                ? `<button class="btn btn-ghost pass-pick-open" data-tier="${row.tier}">Pick one</button>`
                : claimable
                  ? `<button class="btn btn-primary pass-claim" data-track="${track}" data-tier="${row.tier}">Claim</button>`
                  : row.unlocked && locked
                    ? `<span class="muted pass-state">Backstage</span>`
                    : row.unlocked
                      ? `<span class="muted pass-state">—</span>`
                      : ""
          }
        </div>`;
    };

    return `
      <li class="pass-row ${row.unlocked ? "unlocked" : ""} ${row.onPaceLine ? "pace" : ""}" data-tier="${row.tier}">
        <span class="pass-tier">${row.tier}</span>
        ${cell("free")}
        ${cell("backstage")}
        ${
          choices.length > 0
            ? `<div class="pass-choices">
                 ${choices
                   .map(
                     (card: CardDef) =>
                       `<button class="btn btn-ghost pass-pick" data-tier="${row.tier}" data-card="${esc(card.id)}">
                          ${esc(card.name)}
                        </button>`
                   )
                   .join("")}
               </div>`
            : ""
        }
      </li>`;
  };

  const passPanel = (view: PassView): string => {
    const { state } = view;
    const pct = state.complete ? 100 : Math.min(100, (state.intoTier / state.perTier) * 100);
    return `
      <section class="panel panel-chrome pass-head" data-season="${esc(view.season.id)}">
        <div class="pass-head-top">
          <div>
            <div class="eyebrow">${view.live ? `Season ${view.season.number}` : "Archive Pass"}</div>
            <h2 class="pass-season">${esc(view.season.name)}</h2>
            <p class="muted pass-dates">
              ${
                view.live
                  ? `Runs until ${DATE.format(new Date(seasonEnd(view.season)))}.`
                  : `Ended ${DATE.format(new Date(seasonEnd(view.season)))} — and is still going. It never expires.`
              }
            </p>
          </div>
          <div class="pass-tier-big">
            <span class="pass-tier-value">${state.tier}</span>
            <span class="muted">of 50</span>
          </div>
        </div>

        <div class="mastery-bar"><span style="width:${pct}%"></span></div>
        <div class="pass-progress-line">
          <span class="muted">
            ${state.complete ? "Tier 50 reached." : `${state.perTier - state.intoTier} XP to tier ${state.tier + 1}.`}
          </span>
          <span class="pass-pacing pass-pacing-${view.pacing}">
            ${view.live ? esc(PACING_COPY[view.pacing]) : `Earning at half rate, forever, until tier 50.`}
          </span>
        </div>

        ${
          view.encoreOwed > 0
            ? `<div class="pass-encore">
                 <span>Encore — ${view.encoreOwed} tier${view.encoreOwed === 1 ? "" : "s"} past 50,
                 worth ${view.encoreOwed * view.encoreClout} Clout.</span>
                 <button class="btn btn-primary" id="pass-encore">Collect</button>
               </div>`
            : ""
        }

        <div class="pass-actions">
          ${
            view.backstage
              ? `<span class="pass-owned">Backstage Pass held — the second column is yours.</span>`
              : `<button class="btn btn-primary pass-buy" data-season="${esc(view.season.id)}">
                   Backstage Pass — <span class="currency-icon glimmer">✧</span>${view.backstagePrice}
                 </button>
                 <span class="muted">Cosmetics only. Never cards, never Clout, and not for sale for money.</span>`
          }
          ${
            view.live && !view.state.complete
              ? `<button class="btn btn-ghost pass-skip" data-season="${esc(view.season.id)}">
                   Skip a tier — <span class="currency-icon glimmer">✧</span>${view.tierSkipPrice}
                 </button>`
              : ""
          }
        </div>
      </section>

      <section class="panel panel-chrome pass-track">
        <div class="pass-track-head">
          <span class="pass-tier">Tier</span>
          <span class="pass-col">Free</span>
          <span class="pass-col">Backstage${view.backstage ? "" : " <span class='muted'>(locked)</span>"}</span>
        </div>
        <ul class="pass-rows">${view.rows.map((row) => tierRow(view, row)).join("")}</ul>
      </section>`;
  };

  const render = (): void => {
    syncHypeWave();
    const profile = getProfile();
    const { live, archives } = hypeWaveViews();
    const passes = [live, ...archives].filter((view): view is PassView => view !== null);
    const view = passes.find((entry) => entry.season.id === showing) ?? passes[0] ?? null;

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="pass-back">← Back</button>
        <h1 class="title">Hype Wave</h1>
        <div class="mastery-wallet">
          <div class="currency"><span class="currency-icon clout">◈</span><span class="currency-value">${profile.clout.toLocaleString()}</span></div>
          <div class="currency"><span class="currency-icon glimmer">✧</span><span class="currency-value" id="pass-glimmer">${(profile.glimmer ?? 0).toLocaleString()}</span></div>
        </div>
      </header>

      <main class="pass-body">
        <section class="panel panel-chrome pass-intro">
          <p class="mastery-rule">
            <strong>The pass is fed by the XP you already earn.</strong> Every match and every mission
            pays into it — there is no separate grind, no login streak, and nothing here resets.
            Fall behind and <em>Wave Rebound</em> pays you 50% extra until you are level with the
            season; miss the season entirely and the pass keeps going as an Archive Pass, forever.
          </p>
          <p class="muted">
            Seasonal cosmetics return to the shop two seasons later through the Rerun Vault, so
            nothing here is missable. That is why you will not find a countdown on this screen.
          </p>
        </section>

        ${
          passes.length > 1
            ? `<nav class="mastery-tabs pass-tabs">
                 ${passes
                   .map(
                     (entry) =>
                       `<button class="btn mastery-tab ${view?.season.id === entry.season.id ? "active" : ""}"
                                data-season="${esc(entry.season.id)}">
                          ${esc(entry.season.name)}${entry.live ? "" : " <span class='muted'>archive</span>"}
                          ${entry.unclaimed > 0 ? `<span class="mastery-badge">${entry.unclaimed}</span>` : ""}
                        </button>`
                   )
                   .join("")}
               </nav>`
            : ""
        }

        ${
          view
            ? passPanel(view)
            : `<section class="panel panel-chrome pass-between">
                 <h2 class="profile-section-title">Between seasons</h2>
                 <p>
                   No Hype Wave is running right now. The next one starts
                   ${
                     nextSeasonStart()
                       ? DATE.format(new Date(nextSeasonStart()!))
                       : "when the next one is announced"
                   }.
                 </p>
                 <p class="muted">
                   Nothing is being lost in the meantime — missions and Mastery are unaffected, and
                   an unfinished pass would still be here, still earning.
                 </p>
                 <button class="btn btn-ghost" id="pass-missions">Daily missions →</button>
               </section>`
        }
      </main>`;

    root.querySelector("#pass-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    root.querySelector("#pass-missions")?.addEventListener("click", () => callbacks.onMissions());

    for (const button of root.querySelectorAll<HTMLElement>(".pass-tabs .mastery-tab")) {
      button.addEventListener("click", () => {
        showing = button.dataset["season"] ?? null;
        picking = null;
        audio.play("sfx.ui.hover");
        render();
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>(".pass-claim")) {
      button.addEventListener("click", () => {
        const grant = claimPassTier(
          content,
          view!.season.id,
          button.dataset["track"] as "free" | "backstage",
          Number(button.dataset["tier"])
        );
        if (grant) audio.play("sfx.ui.confirm");
        render();
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>(".pass-pick-open")) {
      button.addEventListener("click", () => {
        picking = picking === Number(button.dataset["tier"]) ? null : Number(button.dataset["tier"]);
        audio.play("sfx.ui.hover");
        render();
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>(".pass-pick")) {
      button.addEventListener("click", () => {
        const grant = claimPassTier(
          content,
          view!.season.id,
          "free",
          Number(button.dataset["tier"]),
          button.dataset["card"]
        );
        if (grant) audio.play("sfx.ui.confirm");
        picking = null;
        render();
      });
    }
    root.querySelector("#pass-encore")?.addEventListener("click", () => {
      if (claimEncore()) audio.play("sfx.ui.confirm");
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
      delete (window as unknown as { hypeboundPass?: unknown }).hypeboundPass;
    },
  };
}
