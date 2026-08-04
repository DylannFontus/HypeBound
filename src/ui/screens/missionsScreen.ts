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
 *
 * ## The three defects this rebuild answers
 *
 * **Two of the eight missions rendered as raw unpanelled text.** The bonus
 * dailies were emitted as `.mission-card` — a class styled as a *vertical list
 * row* with a top border and no background — inside `.missions-list`, which is a
 * *grid*. Two row-styled items landed in adjacent 300px grid cells with no
 * border, no padding and no plate, colliding at the column boundary, with
 * shrink-to-fit ghost buttons while every other mission button on the screen was
 * full width. They are ordinary missions now, in the same grid, wearing the same
 * plate.
 *
 * **The grid abandoned six hundred pixels.** `repeat(auto-fill, minmax(300px,
 * 1fr))` for a list that is always exactly three items manufactures empty
 * tracks. `auto-fit` collapses them and the three cards stretch.
 *
 * **Claiming was acoustically and visually identical to pressing Back.**
 * `claimMission` played `sfx.ui.click` — the same sound as the Back button — and
 * then called `render()`, which rebuilds the whole tree, so nothing could
 * animate across the state change and the Clout counter simply *was* a different
 * number on the next frame. It now throws the reward at the wallet chip, the
 * chip lands it, and the counter ratchets. See `rewardKit::flyReward` for why
 * the flight has to live on `document.body`.
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
import { icon } from "../art/uiIcons";
import { num as formatNumber, plural } from "../format";
import { motionEnabled } from "../motion";
import {
  backButton,
  coinChip,
  coinInline,
  describeReward,
  esc,
  flyReward,
  railHtml,
  rewardTileHtml,
  syncWallets,
  tokenHtml,
  WASH,
} from "./rewards/rewardKit";
import { installRewardsTheme } from "./rewards/rewardsTheme";

export interface MissionsCallbacks {
  onBack: () => void;
  onPlay: () => void;
  onOpenShop: () => void;
  onDailyPuzzle: () => void;
  onDailyDoomscroll: () => void;
}

/** "Resets in 4h 12m", from the real 09:00 UTC boundary — never a fake countdown. */
function untilReset(now: number, weekly: boolean): string {
  const DAY = 86_400_000;
  const next = weekly ? (weekIndex(now) + 1) * 7 * DAY + 4 * DAY + 9 * 3_600_000 : (dayIndex(now) + 1) * DAY + 9 * 3_600_000;
  const left = Math.max(0, next - now);
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  return hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${minutes}m`;
}

export function createMissionsScreen(content: ContentIndex, callbacks: MissionsCallbacks): Screen {
  installRewardsTheme();

  const root = document.createElement("div");
  root.className = "screen missions-screen";

  /**
   * Throw the reward at the wallet and let the chip catch it.
   *
   * Read before the state change, because the button is about to be replaced by
   * a re-render and a flight measured from a detached node starts at the origin.
   */
  const celebrate = (source: HTMLElement, clout: number): void => {
    if (!motionEnabled() || clout <= 0) return;
    flyReward(source.getBoundingClientRect(), "clout", root);
  };

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
        <li class="mission mat-panel ${view.progress.complete ? "done" : ""}"
            data-id="${esc(view.active.missionId)}" data-cadence="${view.active.cadence}">
          <div class="mission-head">
            <div class="mission-name">${esc(view.def.name)}</div>
            <div class="mission-reward">
              ${coinInline("clout", view.reward.clout)}
              <span class="rw-note rw-quiet" style="font-size:var(--fs-xs)">+<span class="num" style="min-width:0">${formatNumber(view.reward.xp)}</span> XP</span>
            </div>
          </div>
          <p class="mission-text">${esc(view.def.text)}</p>
          ${view.progress.parts
            .map(
              (part) => `
                <div class="mission-part">
                  ${railHtml({
                    value: Math.min(part.have, part.need),
                    max: part.need,
                    height: 10,
                    label: part.label,
                  })}
                  <div class="mission-part-label">
                    <span class="rw-quiet">${esc(part.label)}</span>
                    <span class="num">${formatNumber(Math.min(part.have, part.need))}/${formatNumber(part.need)}</span>
                  </div>
                </div>`,
            )
            .join("")}
          <div class="mission-actions">
            ${
              view.progress.complete
                ? `<button class="mat-hero act rw-back mission-claim" style="justify-content:center">${icon("check")}<span>Claim</span></button>`
                : rerollable
                  ? `<button class="mat-panel act rw-back mission-reroll" style="justify-content:center">${icon("refresh")}<span>Reroll</span></button>`
                  : tokenHtml("available", "Reroll used")
            }
          </div>
        </li>`;
    };

    /** A bonus daily, in the same plate as every other mission on the screen. */
    const bonusCard = (options: {
      name: string;
      text: string;
      clout: number;
      xp?: number;
      done: boolean;
      buttonId: string;
      buttonLabel: string;
    }): string => `
      <li class="mission mat-panel ${options.done ? "done" : ""}">
        <div class="mission-head">
          <div class="mission-name">${esc(options.name)}</div>
          <div class="mission-reward">
            ${coinInline("clout", options.clout)}
            ${
              options.xp
                ? `<span class="rw-note rw-quiet" style="font-size:var(--fs-xs)">+<span class="num" style="min-width:0">${formatNumber(options.xp)}</span> XP</span>`
                : ""
            }
          </div>
        </div>
        <p class="mission-text">${esc(options.text)}</p>
        <div class="mission-actions">
          ${
            options.done
              ? tokenHtml("claimed", "Done today")
              : `<button class="mat-panel act rw-back" id="${options.buttonId}" style="justify-content:center">${icon("play")}<span>${esc(options.buttonLabel)}</span></button>`
          }
        </div>
      </li>`;

    /** One check-in node: the reward drawn, the quantity tabular, the state plain. */
    const stepTile = (step: CheckInStep, index: number): string => {
      const state = index < checkIn.claimed ? "claimed" : index === checkIn.claimed ? "next" : "";
      const visual = describeReward(step, content);
      return `
        <li class="checkin-step mat-panel ${state}">
          <span class="checkin-index num">${index + 1}</span>
          ${rewardTileHtml(visual, {
            state: index < checkIn.claimed ? "claimed" : "none",
            art: 38,
            bare: true,
            title: visual.name,
          })}
          <span class="rw-tile-name checkin-reward">${esc(
            visual.qty !== undefined ? `${formatNumber(visual.qty)} ${visual.name}` : visual.name,
          )}</span>
        </li>`;
    };

    root.innerHTML = `
      ${WASH}
      <header class="screen-header">
        ${backButton("missions-back")}
        <h1 class="title">Missions</h1>
        <div class="rw-wallet">
          ${coinChip("clout", profile.clout, { id: "missions-clout" })}
        </div>
      </header>

      <main class="missions-body rw-missions-body">
        <section class="missions-intro mat-panel rw-panel-pad rw-stack">
          <p class="rw-note" style="font-size:var(--fs-md);margin:0">
            <strong>Nothing here expires.</strong> Missions bank while you are away — you simply
            hold up to three dailies at a time. There is no streak to break and no timer to beat.
          </p>
          ${
            rookie
              ? `<p class="rw-note" style="color:var(--accent-gold);margin:0">
                   Rookie Road: your dailies are paying <strong>double</strong> for your first
                   ${content.balance.economy.missions.rookieRoadDays} days.
                 </p>`
              : ""
          }
          <div class="rw-restock mat-well">
            ${
              restock > 0
                ? `<span class="rw-note">Weekly Restock — <strong>${restock} free Merch ${plural(restock, "Drop")}</strong>, claim any time this week.</span>
                   <button class="mat-hero act rw-back" id="missions-restock">${icon("merch-drop")}<span>Claim</span></button>`
                : `<span class="rw-note rw-quiet">Weekly Restock claimed. Next in ${untilReset(now, true)}.</span>
                   ${tokenHtml("claimed")}`
            }
          </div>
        </section>

        <section class="checkin-panel mat-panel rw-panel-pad">
          <div class="rw-section-head">
            <h2 class="rw-section-title t-heading">${icon("campfire")}<span>Stream Check-In</span></h2>
            <span class="rw-note rw-quiet"><span class="num" style="min-width:0">${checkIn.claimed}</span> of ${checkIn.steps.length} this month</span>
          </div>
          <ol class="checkin-steps">
            ${checkIn.steps.map(stepTile).join("")}
          </ol>
          <div class="rw-restock mat-well">
            <span class="rw-note ${checkIn.available ? "" : "rw-quiet"}">
              ${
                checkIn.complete
                  ? "Every step claimed this month. The track starts again next month."
                  : checkIn.available
                    ? "Today's step is waiting."
                    : "Today's step is claimed. Come back any day — there is no streak to keep."
              }
            </span>
            ${
              checkIn.available
                ? `<button class="mat-hero act rw-back" id="missions-checkin">${icon("star-filled")}<span>Claim step ${checkIn.claimed + 1}</span></button>`
                : tokenHtml("claimed")
            }
          </div>
          <p class="rw-note rw-quiet checkin-note" style="margin-top:var(--sp-3)">
            No streaks, no resets, no consecutive days. Log in on six scattered days and you claim
            six steps.${tokens > 0 ? ` You hold ${formatNumber(tokens)} reroll ${plural(tokens, "token")}.` : ""}
          </p>
        </section>

        <section class="missions-group">
          <div class="rw-section-head">
            <h2 class="rw-section-title t-heading">${icon("sun")}<span>Daily</span></h2>
            <span class="rw-note rw-quiet">New mission in ${untilReset(now, false)}</span>
          </div>
          <ul class="missions-list" id="missions-daily">${dailies.map(card).join("")}</ul>
        </section>

        <section class="missions-group">
          <div class="rw-section-head">
            <h2 class="rw-section-title t-heading">${icon("flame")}<span>Bonus dailies</span></h2>
            <span class="rw-note rw-quiet"><span class="num" style="min-width:0">${bonus.progress.toward}</span> / ${bonus.progress.every} toward a Merch Drop</span>
          </div>
          <ul class="missions-list" id="missions-bonus">
            ${bonusCard({
              name: "Daily Puzzle",
              text: `One Puzzle Rush scenario, chosen by today's date. ${bonus.puzzleDone ? "Done today." : "Solve it to fill the slot."}`,
              clout: bonus.puzzleClout,
              done: bonus.puzzleDone,
              buttonId: "bonus-puzzle-go",
              buttonLabel: "Play it",
            })}
            ${bonusCard({
              name: "Daily Doomscroll",
              text: `Today's run seed, the same one for everybody. Clear it to fill the slot.${bonus.doomscrollDone ? " Done today." : ""}`,
              clout: bonus.doomscrollClout,
              xp: bonus.doomscrollXp,
              done: bonus.doomscrollDone,
              buttonId: "bonus-doom-go",
              buttonLabel: "Start today's run",
            })}
            <li class="mission mat-panel">
              <div class="mission-head">
                <div class="mission-name">Every ${bonus.progress.every} dailies</div>
                <div class="mission-reward">${icon("merch-drop", { size: 17 })}<span class="num" style="min-width:0">${content.balance.economy.missions.dailyBonusDrops}</span></div>
              </div>
              <p class="mission-text">
                Counted up, never reset, so a missed day costs nothing but time.
              </p>
              ${railHtml({
                value: bonus.progress.toward,
                max: bonus.progress.every,
                height: 10,
                label: "Progress toward a bonus Merch Drop",
              })}
              <div class="mission-part-label">
                <span class="rw-quiet">Dailies completed</span>
                <span class="num">${formatNumber(bonus.progress.toward)}/${formatNumber(bonus.progress.every)}</span>
              </div>
              <div class="mission-actions">
                ${tokenHtml("available", `${formatNumber(bonus.progress.earned)} earned so far`)}
              </div>
            </li>
          </ul>
        </section>

        <section class="missions-group">
          <div class="rw-section-head">
            <h2 class="rw-section-title t-heading">${icon("moon")}<span>Weekly</span></h2>
            <span class="rw-note rw-quiet">New missions in ${untilReset(now, true)}</span>
          </div>
          <ul class="missions-list" id="missions-weekly">${weeklies.map(card).join("")}</ul>
        </section>

        <p class="rw-note rw-quiet missions-foot" style="margin:0">
          Completed <span class="num" style="min-width:0">${formatNumber(profile.missions.dailiesCompleted)}</span> dailies and
          <span class="num" style="min-width:0">${formatNumber(profile.missions.weekliesCompleted)}</span> weeklies.
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
    root.querySelector("#missions-checkin")?.addEventListener("click", (event) => {
      const source = event.currentTarget as HTMLElement;
      const step = checkIn.steps[checkIn.claimed];
      const box = source.getBoundingClientRect();
      if (claimCheckIn(content, Date.now())) {
        /*
         * A claim sound, not the confirm sound the Back button and the Buy
         * button both play. §7: sound and visual land on the same frame, and a
         * reward that sounds like navigation is not a reward.
         */
        audio.play("sfx.pack.rareReveal", { volume: 0.5, rate: 1.15 });
        const visual = step ? describeReward(step, content) : null;
        if (visual?.coin && motionEnabled()) flyReward(box, visual.coin, root);
      }
      render();
    });
    root.querySelector("#missions-restock")?.addEventListener("click", (event) => {
      const source = event.currentTarget as HTMLElement;
      if (claimWeeklyRestock(content, Date.now()) > 0) {
        audio.play("sfx.pack.open", { volume: 0.6 });
        void source;
      }
      render();
    });

    for (const element of root.querySelectorAll<HTMLElement>(".mission[data-id]")) {
      const missionId = element.dataset["id"] ?? "";
      const cadence = (element.dataset["cadence"] ?? "daily") as "daily" | "weekly";
      const view = views.find((entry) => entry.active.missionId === missionId && entry.active.cadence === cadence);
      element.querySelector(".mission-claim")?.addEventListener("click", (event) => {
        const source = event.currentTarget as HTMLElement;
        celebrate(source, view?.reward.clout ?? 0);
        if (claimMission(content, cadence, missionId, Date.now())) {
          audio.play("sfx.pack.rareReveal", { volume: 0.5, rate: 1.15 });
        }
        render();
      });
      element.querySelector(".mission-reroll")?.addEventListener("click", () => {
        if (rerollSlot(content, cadence, missionId, Date.now())) audio.play("sfx.ui.hover");
        render();
      });
    }

    syncWallets(root);
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
