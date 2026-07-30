/**
 * Achievements — the browsable trophy room.
 *
 * `03-screens-and-navigation.md` §4.2.8: category tabs, progress bars, rewards,
 * a completion percentage per category, hidden achievements shown as "???" with
 * an unlock hint, and a shortcut to go and wear what you won.
 *
 * Three things this screen is careful about, all of them about not lying:
 *
 * **It shows the ceiling.** The points header reads *"250 of 625"*, not just
 * *"250"*. §9 hangs frames off point milestones, and a player deciding whether a
 * milestone is close deserves to know how many points exist to be had.
 *
 * **A deferred achievement says what it is waiting for.** *Front Row Seat* needs
 * a server, so its row says so rather than sitting in the Community tab looking
 * merely hard. That is the same rule the mastery ladder follows for cosmetics it
 * cannot grant.
 *
 * **A hidden achievement stays hidden, and only until it is found.** The Deep
 * Cuts tab shows "???" and the hint; the moment it unlocks it reads normally,
 * because a secret you have already discovered is not a secret.
 */

import type { ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import type { AchievementReward, AchievementView, MilestoneView } from "../../game/achievements";
import { achievementsData } from "../../game/achievements";
import { achievementBoard, claimAchievement, claimPointMilestone, getProfile } from "../../save/profile";
import { audio } from "../../audio/audio";

export interface AchievementsCallbacks {
  onBack: () => void;
  onProfile: () => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** What a reward says on a row. */
function rewardLabel(reward: AchievementReward): string {
  switch (reward.kind) {
    case "clout":
      return `<span class="currency-icon clout">◈</span>${reward.amount} Clout`;
    case "fragments":
      return `${reward.amount} Signal`;
    case "cosmetic":
      return esc(reward.name);
  }
}

const bar = (have: number, need: number): string =>
  `<div class="mastery-bar"><span style="width:${need > 0 ? Math.min(100, (have / need) * 100) : 100}%"></span></div>`;

export function createAchievementsScreen(content: ContentIndex, callbacks: AchievementsCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen achievements-screen";

  const categories = achievementsData().categories;
  let tab = categories[0]!.id;

  const row = (view: AchievementView): string => {
    const { def } = view;
    const name = view.concealed ? "???" : def.name;
    const text = view.concealed ? (def.hint ?? "") : def.text;
    return `
      <li class="ach-row ${view.unlocked ? "unlocked" : ""} ${view.claimed ? "claimed" : ""} ${view.concealed ? "concealed" : ""}"
          data-id="${esc(def.id)}">
        <div class="ach-points" title="${def.points} achievement points">${def.points}</div>
        <div class="ach-row-body">
          <div class="ach-head">
            <strong class="ach-name">${esc(name)}</strong>
            <div class="ach-rewards">
              ${def.rewards.map((reward) => `<span class="ach-reward">${rewardLabel(reward)}</span>`).join("")}
            </div>
          </div>
          <p class="ach-text muted">${esc(text)}</p>
          ${
            view.deferred
              ? `<p class="ach-deferred muted">Not earnable yet — ${esc(view.deferred)}.</p>`
              : `${bar(view.have, view.need)}
                 <p class="ach-progress muted">${view.have.toLocaleString()} / ${view.need.toLocaleString()}</p>`
          }
        </div>
        <div class="ach-action">
          ${
            view.claimed
              ? `<span class="muted">Claimed</span>`
              : view.claimable
                ? `<button class="btn btn-primary ach-claim" data-id="${esc(def.id)}">Claim</button>`
                : view.unlocked
                  ? `<span class="muted">Unlocked</span>`
                  : `<span class="muted">Locked</span>`
          }
        </div>
      </li>`;
  };

  const milestoneRow = (view: MilestoneView): string => `
    <li class="ach-milestone ${view.unlocked ? "unlocked" : ""} ${view.claimed ? "claimed" : ""}"
        data-points="${view.milestone.points}">
      <div class="ach-milestone-head">
        <strong>${esc(view.milestone.name)}</strong>
        <span class="muted">${view.milestone.points} pts</span>
      </div>
      ${bar(view.have, view.milestone.points)}
      <div class="ach-milestone-foot">
        <span class="ach-reward">${rewardLabel(view.milestone.reward)}</span>
        ${
          view.claimed
            ? `<span class="muted">Claimed</span>`
            : view.claimable
              ? `<button class="btn btn-primary ach-claim-milestone" data-points="${view.milestone.points}">Claim</button>`
              : `<span class="muted">${(view.milestone.points - view.have).toLocaleString()} to go</span>`
        }
      </div>
    </li>`;

  const render = (): void => {
    const profile = getProfile();
    const board = achievementBoard(content);
    const shown = board.views.filter((view) => view.def.category === tab);

    const countsFor = (categoryId: string): { done: number; total: number } => {
      const inCategory = board.views.filter((view) => view.def.category === categoryId);
      return { done: inCategory.filter((view) => view.unlocked).length, total: inCategory.length };
    };

    const tabButton = (categoryId: string, label: string): string => {
      const { done, total } = countsFor(categoryId);
      const waiting = board.views.filter((view) => view.def.category === categoryId && view.claimable).length;
      return `<button class="btn mastery-tab ${tab === categoryId ? "active" : ""}" data-tab="${esc(categoryId)}">
                ${esc(label)} <span class="muted">${done}/${total}</span>
                ${waiting > 0 ? `<span class="mastery-badge">${waiting}</span>` : ""}
              </button>`;
    };

    const category = categories.find((entry) => entry.id === tab)!;
    const { done, total } = countsFor(tab);

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="ach-back">← Back</button>
        <h1 class="title">Achievements</h1>
        <div class="mastery-wallet">
          <div class="currency"><span class="currency-icon clout">◈</span><span class="currency-value">${profile.clout.toLocaleString()}</span></div>
          <div class="currency"><span class="currency-icon">✦</span><span class="currency-value">${profile.shards.toLocaleString()}</span></div>
        </div>
      </header>

      <main class="ach-body">
        <section class="panel panel-chrome ach-summary">
          <div class="ach-score">
            <span class="ach-score-value" id="ach-points">${board.points.toLocaleString()}</span>
            <span class="muted">of ${board.reachable.toLocaleString()} achievement points</span>
          </div>
          <p class="mastery-rule">
            <strong>Earned once, kept forever.</strong> Nothing here rotates, resets or expires, and
            nothing here can be bought. Points count the moment you do the thing — the Claim button
            only hands over the reward.
          </p>
          <ul class="ach-milestones">${board.milestones.map(milestoneRow).join("")}</ul>
        </section>

        <nav class="mastery-tabs ach-tabs">
          ${categories.map((entry) => tabButton(entry.id, entry.name)).join("")}
        </nav>

        <section class="panel panel-chrome ach-list-panel">
          <div class="ach-category-head">
            <h2 class="ach-category-name">${esc(category.name)}</h2>
            <span class="muted">${esc(category.blurb)}</span>
            <span class="ach-category-pct">${total > 0 ? Math.round((done / total) * 100) : 0}%</span>
          </div>
          <ul class="ach-list" id="ach-list">${shown.map(row).join("")}</ul>
          <button class="btn btn-ghost" id="ach-profile">Wear what you won →</button>
        </section>
      </main>`;

    root.querySelector("#ach-back")?.addEventListener("click", () => {
      audio.play("sfx.ui.click");
      callbacks.onBack();
    });
    root.querySelector("#ach-profile")?.addEventListener("click", () => callbacks.onProfile());

    for (const button of root.querySelectorAll<HTMLElement>(".mastery-tab")) {
      button.addEventListener("click", () => {
        tab = button.dataset["tab"] ?? tab;
        audio.play("sfx.ui.hover");
        render();
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>(".ach-claim")) {
      button.addEventListener("click", () => {
        const grant = claimAchievement(content, button.dataset["id"] ?? "");
        if (grant) audio.play("sfx.ui.confirm");
        render();
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>(".ach-claim-milestone")) {
      button.addEventListener("click", () => {
        const grant = claimPointMilestone(content, Number(button.dataset["points"] ?? 0));
        if (grant) audio.play("sfx.ui.confirm");
        render();
      });
    }
  };

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundAchievements?: unknown }).hypeboundAchievements = {
    points: () => achievementBoard(content).points,
    reachable: () => achievementBoard(content).reachable,
    list: () =>
      achievementBoard(content).views.map((view) => ({
        id: view.def.id,
        category: view.def.category,
        points: view.def.points,
        have: view.have,
        need: view.need,
        unlocked: view.unlocked,
        claimed: view.claimed,
        claimable: view.claimable,
        deferred: view.deferred,
        concealed: view.concealed,
      })),
    milestones: () =>
      achievementBoard(content).milestones.map((view) => ({
        points: view.milestone.points,
        unlocked: view.unlocked,
        claimed: view.claimed,
        claimable: view.claimable,
      })),
    claim: (id: string) => {
      const grant = claimAchievement(content, id);
      render();
      return grant;
    },
    claimMilestone: (points: number) => {
      const grant = claimPointMilestone(content, points);
      render();
      return grant;
    },
    show: (categoryId: string) => {
      tab = categoryId;
      render();
    },
    refresh: render,
  };

  return {
    root,
    dispose: () => {
      delete (window as unknown as { hypeboundAchievements?: unknown }).hypeboundAchievements;
    },
  };
}
