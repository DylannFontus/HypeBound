/**
 * Missions.
 *
 * The screen the economy's §3.5 contract is kept on. Three things about it are
 * deliberate:
 *
 * **It says what everything pays, before you earn it.** The Clout and XP on each
 * card come from `balance.economy.missions`, the same object the claim reads —
 * the shop panel's published-odds rule applied to income.
 *
 * **It says nothing expires.** F6 forbids lose-it-if-you-miss-it grants, and a
 * player cannot tell a banking system from a hidden timer unless the screen
 * tells them. So it does, in a sentence, at the top.
 *
 * **Progress is shown per requirement.** "Win 4 matches using at least 2
 * different factions" is two bars, not one, because a single bar at 75% cannot
 * say which half is the problem.
 */

import type { ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import type { MissionView } from "../../game/missions";
import type { CheckInStep } from "../../game/progression/data";
import { canReroll, dayIndex, weekIndex } from "../../game/missions";
import {
  bonusDailies,
  claimMission,
  checkInView,
  claimCheckIn,
  claimWeeklyRestock,
  getProfile,
  onRookieRoad,
  rerollSlot,
  rerollTokens,
  restockAvailable,
  syncMissions,
} from "../../save/profile";
import { audio } from "../../audio/audio";

export interface MissionsCallbacks {
  onBack: () => void;
  onPlay: () => void;
  onOpenShop: () => void;
  onDailyPuzzle: () => void;
  onDailyDoomscroll: () => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "Resets in 4h 12m", from the real 09:00 UTC boundary — never a fake countdown. */
function untilReset(now: number, weekly: boolean): string {
  const DAY = 86_400_000;
  const next = weekly ? (weekIndex(now) + 1) * 7 * DAY + 4 * DAY + 9 * 3_600_000 : (dayIndex(now) + 1) * DAY + 9 * 3_600_000;
  const left = Math.max(0, next - now);
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${minutes}m`;
}

/** What a Stream Check-In step says on the track (§11). */
function stepLabel(step: CheckInStep): string {
  switch (step.kind) {
    case "clout":
      return `<span class="currency-icon clout">◈</span>${step.amount}`;
    case "fragments":
      return `${step.amount} Signal`;
    case "glimmer":
      return `<span class="currency-icon glimmer">✧</span>${step.amount}`;
    case "rerollTokens":
      return `${step.amount} reroll tokens`;
    case "pack":
      return "1 Merch Drop";
    case "cosmetic":
      return step.name;
  }
}

export function createMissionsScreen(content: ContentIndex, callbacks: MissionsCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen missions-screen";

  const render = (): void => {
    const now = Date.now();
    const views = syncMissions(content, now);
    const profile = getProfile();
    const bonus = bonusDailies(content, now);
    const dailies = views.filter((view) => view.active.cadence === "daily");
    const weeklies = views.filter((view) => view.active.cadence === "weekly");
    const restock = restockAvailable(content, now);
    const checkIn = checkInView(now);
    const tokens = rerollTokens();
    const rookie = onRookieRoad(content, now);

    const card = (view: MissionView): string => {
      const rerollable = canReroll(profile.missions.rotation, view.active.cadence, now);
      return `
        <li class="mission ${view.progress.complete ? "done" : ""}" data-id="${esc(view.active.missionId)}" data-cadence="${view.active.cadence}">
          <div class="mission-head">
            <div class="mission-name">${esc(view.def.name)}</div>
            <div class="mission-reward">
              <span class="currency-icon clout">◈</span>${view.reward.clout}
              <span class="mission-xp">+${view.reward.xp} XP</span>
            </div>
          </div>
          <p class="mission-text">${esc(view.def.text)}</p>
          ${view.progress.parts
            .map(
              (part) => `
                <div class="mission-part">
                  <div class="mission-bar"><span style="width:${Math.min(100, (part.have / Math.max(1, part.need)) * 100)}%"></span></div>
                  <div class="mission-part-label muted">${esc(part.label)} <strong>${Math.min(part.have, part.need)}/${part.need}</strong></div>
                </div>`
            )
            .join("")}
          <div class="mission-actions">
            ${
              view.progress.complete
                ? `<button class="btn btn-primary mission-claim">Claim</button>`
                : rerollable
                  ? `<button class="btn btn-ghost mission-reroll">Reroll</button>`
                  : `<span class="muted mission-note">Reroll used</span>`
            }
          </div>
        </li>`;
    };

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="missions-back">← Back</button>
        <h1 class="title">Missions</h1>
        <div class="missions-wallet">
          <div class="currency"><span class="currency-icon clout">◈</span><span class="currency-value" id="missions-clout">${profile.clout.toLocaleString()}</span></div>
        </div>
      </header>

      <main class="missions-body">
        <section class="panel panel-chrome missions-intro">
          <p class="missions-rule">
            <strong>Nothing here expires.</strong> Missions bank while you are away — you simply
            hold up to three dailies at a time. There is no streak to break and no timer to beat.
          </p>
          ${rookie ? `<p class="missions-rookie">Rookie Road: your dailies are paying <strong>double</strong> for your first ${content.balance.economy.missions.rookieRoadDays} days.</p>` : ""}
          ${
            restock > 0
              ? `<div class="missions-restock">
                   <span>Weekly Restock — <strong>${restock} free Merch Drops</strong>, claim any time this week.</span>
                   <button class="btn btn-primary" id="missions-restock">Claim</button>
                 </div>`
              : `<div class="missions-restock muted">Weekly Restock claimed. Next in ${untilReset(now, true)}.</div>`
          }
        </section>

        <section class="panel panel-chrome checkin-panel">
          <div class="stats-table-head">
            <h2 class="profile-section-title">Stream Check-In</h2>
            <span class="muted">${checkIn.claimed} of ${checkIn.steps.length} this month</span>
          </div>
          <ol class="checkin-steps">
            ${checkIn.steps
              .map(
                (step, index) => `
                  <li class="checkin-step ${index < checkIn.claimed ? "claimed" : ""} ${
                    index === checkIn.claimed ? "next" : ""
                  }">
                    <span class="checkin-index">${index + 1}</span>
                    <span class="checkin-reward">${stepLabel(step)}</span>
                  </li>`
              )
              .join("")}
          </ol>
          <div class="missions-restock ${checkIn.available ? "" : "muted"}">
            <span>
              ${
                checkIn.complete
                  ? "Every step claimed this month. The track starts again next month."
                  : checkIn.available
                    ? "Today's step is waiting."
                    : "Today's step is claimed. Come back any day — there is no streak to keep."
              }
            </span>
            ${checkIn.available ? `<button class="btn btn-primary" id="missions-checkin">Claim step ${checkIn.claimed + 1}</button>` : ""}
          </div>
          <p class="muted checkin-note">
            No streaks, no resets, no consecutive days. Log in on six scattered days and you claim
            six steps.${tokens > 0 ? ` You hold ${tokens} reroll token${tokens === 1 ? "" : "s"}.` : ""}
          </p>
        </section>

        <section class="missions-group">
          <div class="missions-group-head">
            <h2 class="missions-group-title"><span class="ui-icon ui-icon-mission-daily" aria-hidden="true">☀</span> Daily</h2>
            <span class="muted">New mission in ${untilReset(now, false)}</span>
          </div>
          <ul class="missions-list" id="missions-daily">${dailies.map(card).join("")}</ul>
        </section>

        <section class="missions-group">
          <div class="missions-group-head">
            <h2 class="missions-group-title">Bonus dailies</h2>
            <span class="muted">${bonus.progress.toward} / ${bonus.progress.every} toward a Merch Drop</span>
          </div>
          <ul class="missions-list" id="missions-bonus">
            <li class="mission-card ${bonus.puzzleDone ? "is-done" : ""}">
              <div class="mission-card-head">
                <span class="mission-name">Daily Puzzle</span>
                <span class="mission-reward">${bonus.puzzleClout} Clout</span>
              </div>
              <p class="muted mission-text">
                One Puzzle Rush scenario, chosen by today's date. ${
                  bonus.puzzleDone ? "Done today." : "Solve it to fill the slot."
                }
              </p>
              ${bonus.puzzleDone ? "" : `<button class="btn btn-ghost btn-sm" id="bonus-puzzle-go">Play it</button>`}
            </li>
            <li class="mission-card ${bonus.doomscrollDone ? "is-done" : ""}">
              <div class="mission-card-head">
                <span class="mission-name">Daily Doomscroll</span>
                <span class="mission-reward">${bonus.doomscrollClout} Clout${
                  bonus.doomscrollXp > 0 ? ` · ${bonus.doomscrollXp} XP` : ""
                }</span>
              </div>
              <p class="muted mission-text">
                Today's run seed, the same one for everybody. Clear it to fill the slot. ${
                  bonus.doomscrollDone ? "Done today." : ""
                }
              </p>
              ${bonus.doomscrollDone ? "" : `<button class="btn btn-ghost btn-sm" id="bonus-doom-go">Start today's run</button>`}
            </li>
          </ul>
          <p class="muted missions-foot">
            Every ${bonus.progress.every} dailies completed pays
            ${content.balance.economy.missions.dailyBonusDrops} Merch Drop — counted up, never reset, so a
            missed day costs nothing but time. ${bonus.progress.earned} earned so far.
          </p>
        </section>

        <section class="missions-group">
          <div class="missions-group-head">
            <h2 class="missions-group-title"><span class="ui-icon ui-icon-mission-weekly" aria-hidden="true">☾</span> Weekly</h2>
            <span class="muted">New missions in ${untilReset(now, true)}</span>
          </div>
          <ul class="missions-list" id="missions-weekly">${weeklies.map(card).join("")}</ul>
        </section>

        <p class="muted missions-foot">
          Completed ${profile.missions.dailiesCompleted} dailies and ${profile.missions.weekliesCompleted} weeklies.
          Finish all of a week's missions for ${content.balance.economy.missions.weeklyWrapDrops} extra Merch Drop.
        </p>
      </main>`;

    root.querySelector("#missions-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    root.querySelector("#bonus-puzzle-go")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onDailyPuzzle();
    });
    root.querySelector("#bonus-doom-go")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onDailyDoomscroll();
    });
    root.querySelector("#missions-checkin")?.addEventListener("click", () => {
      if (claimCheckIn(content, Date.now())) audio.play("sfx.ui.confirm");
      render();
    });
    root.querySelector("#missions-restock")?.addEventListener("click", () => {
      if (claimWeeklyRestock(content, Date.now()) > 0) audio.play("sfx.ui.click");
      render();
    });

    for (const element of root.querySelectorAll<HTMLElement>(".mission")) {
      const missionId = element.dataset["id"] ?? "";
      const cadence = (element.dataset["cadence"] ?? "daily") as "daily" | "weekly";
      element.querySelector(".mission-claim")?.addEventListener("click", () => {
        if (claimMission(content, cadence, missionId, Date.now())) audio.play("sfx.ui.click");
        render();
      });
      element.querySelector(".mission-reroll")?.addEventListener("click", () => {
        if (rerollSlot(content, cadence, missionId, Date.now())) audio.play("sfx.ui.hover");
        render();
      });
    }
  };

  render();

  /** Automation hook, the same shape the shop, starter and tour screens expose. */
  (window as unknown as { hypeboundMissions?: unknown }).hypeboundMissions = {
    views: () =>
      syncMissions(content, Date.now()).map((view) => ({
        id: view.active.missionId,
        cadence: view.active.cadence,
        complete: view.progress.complete,
        reward: view.reward,
        parts: view.progress.parts,
      })),
    claim: (cadence: "daily" | "weekly", missionId: string) => {
      const result = claimMission(content, cadence, missionId, Date.now());
      render();
      return result;
    },
    reroll: (cadence: "daily" | "weekly", missionId: string) => {
      const result = rerollSlot(content, cadence, missionId, Date.now());
      render();
      return result !== null;
    },
    restock: () => {
      const drops = claimWeeklyRestock(content, Date.now());
      render();
      return drops;
    },
    published: () => content.balance.economy.missions,
    refresh: render,
  };

  return {
    root,
    dispose: () => {
      delete (window as unknown as { hypeboundMissions?: unknown }).hypeboundMissions;
    },
  };
}
