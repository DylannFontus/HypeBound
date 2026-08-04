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
 *
 * ## What the rebuild changed
 *
 * Every achievement's whole visual identity was a point value in a 30px circle,
 * and every state was the word "Locked", "Unlocked" or "Claimed" in dim grey at
 * the far right — so a category of eight produced a vertical column of the word
 * "Locked" repeated eight times. The progress bars at 0% were a 2px hairline at
 * about 1.1:1, which is to say invisible. And `.ach-row.claimed { opacity: .66 }`
 * signalled a whole state with alpha, which is both illegible and ambiguous.
 *
 * Xbox, PlayStation and Hearthstone all give an achievement an *illustrated
 * badge*, desaturated when locked and full-colour with a rim light when earned.
 * There is no art budget and there must never be one, so `achievementBadge.ts`
 * strikes them: a hexagonal plate whose metal, bevel and studs come from the
 * point tier, with the number engraved into it, a padlock struck on when it is
 * not yet earned and a green tick when it has been paid out. Nine bitmaps for
 * the entire game.
 */

import type { ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import type { AchievementReward, AchievementView, MilestoneView } from "../../game/achievements";
import { achievementsData } from "../../game/achievements";
import { achievementBoard, claimAchievement, claimPointMilestone, getProfile } from "../../save/profile";
import { audio } from "../../audio/audio";
import { icon } from "../art/uiIcons";
import { num as formatNumber, percent } from "../format";
import { motionEnabled, tickerTo } from "../motion";
import {
  backButton,
  coinChip,
  describeReward,
  esc,
  flyReward,
  railHtml,
  rewardTileHtml,
  syncWallets,
  tokenHtml,
  WASH,
  type CoinKind,
} from "./rewards/rewardKit";
import { achievementBadge, badgeTierName, type BadgeState } from "./rewards/achievementBadge";
import { installRewardsTheme } from "./rewards/rewardsTheme";

export interface AchievementsCallbacks {
  onBack: () => void;
  onProfile: () => void;
}

/** Which wallet a claimed reward flies into, where there is one. */
function coinFor(reward: AchievementReward): CoinKind | null {
  if (reward.kind === "clout") return "clout";
  if (reward.kind === "fragments") return "shards";
  return null;
}

/** The badge state, from the three booleans the view carries. */
const badgeStateOf = (view: { unlocked: boolean; claimed: boolean }): BadgeState =>
  view.claimed ? "claimed" : view.unlocked ? "unlocked" : "locked";

export function createAchievementsScreen(content: ContentIndex, callbacks: AchievementsCallbacks): Screen {
  installRewardsTheme();

  const root = document.createElement("div");
  root.className = "screen achievements-screen";

  const categories = achievementsData().categories;
  let tab = categories[0]!.id;
  /** the last points total the player saw, so the header counts rather than jumps */
  let seenPoints: number | null = null;

  const badgeImg = (points: number, state: BadgeState, label: string): string => {
    const uri = achievementBadge(points, state);
    if (!uri) return `<div class="ach-badge num" style="display:grid;place-items:center">${points}</div>`;
    return `<img class="ach-badge" src="${uri}" alt="" title="${esc(label)}" loading="lazy" decoding="async">`;
  };

  const row = (view: AchievementView): string => {
    const { def } = view;
    const name = view.concealed ? "???" : def.name;
    const text = view.concealed ? (def.hint ?? "") : def.text;
    const state = badgeStateOf(view);
    return `
      <li class="ach-row mat-panel ${view.unlocked ? "unlocked" : ""} ${view.claimed ? "claimed" : ""} ${view.concealed ? "concealed" : ""}"
          data-id="${esc(def.id)}">
        ${badgeImg(def.points, state, `${def.points} points — ${badgeTierName(def.points)}`)}
        <div class="ach-row-body">
          <div class="ach-head">
            <strong class="ach-name">${esc(name)}</strong>
          </div>
          <p class="ach-text rw-note">${esc(text)}</p>
          ${
            view.deferred
              ? `<p class="ach-deferred">${icon("warning", { size: 14 })} Not earnable yet — ${esc(view.deferred)}.</p>`
              : `${railHtml({ value: view.have, max: view.need, height: 10, label: `${name} progress` })}
                 <p class="ach-progress">
                   <span class="rw-quiet">${formatNumber(def.points)} points</span>
                   <span class="num">${formatNumber(view.have)} / ${formatNumber(view.need)}</span>
                 </p>`
          }
        </div>
        <div class="ach-action">
          ${
            /*
             * The payout is a column of its own, not a chip inside the title
             * row.
             *
             * It used to sit at the far end of a flex row with `align-items:
             * baseline` beside the achievement's name — and a 38px plate has no
             * text baseline, so the browser aligned its *bottom margin edge* to
             * the name's baseline and hoisted the whole tile above the top of
             * the row. Photographed across a three-column grid, every reward
             * chip was floating clear of the card that owned it. It also put the
             * one thing the player is deciding about — what this pays — as far
             * as possible from the state that says whether they can have it.
             */
            def.rewards
              .map((reward) => {
                const visual = describeReward(reward, content);
                return rewardTileHtml(visual, {
                  /*
                   * 38, not 30. The quantity chip hangs off the plate's
                   * bottom-right corner, and at 30px it covered most of the
                   * icon underneath it — a Clout payout read as one muddy
                   * red-purple smudge rather than as a coin with a number on
                   * it. The chip is a fixed size, so the plate has to be big
                   * enough to still be a plate beside it.
                   */
                  art: 38,
                  bare: true,
                  title: visual.qty !== undefined ? `${formatNumber(visual.qty)} ${visual.name}` : visual.name,
                  className: "ach-reward",
                });
              })
              .join("")
          }
          ${
            view.claimed
              ? tokenHtml("claimed")
              : view.claimable
                ? `<button class="mat-hero act rw-back ach-claim" data-id="${esc(def.id)}">${icon("star-filled")}<span>Claim</span></button>`
                : view.unlocked
                  ? tokenHtml("claimable", "Unlocked")
                  : /*
                     * Not a chip. Eight rows in a category, all locked on a new
                     * account, produced a vertical column of the word LOCKED
                     * eight times — the exact defect the recon named, moved from
                     * plain text into a nicer box. The badge to the left of this
                     * already carries a struck padlock and is desaturated, the
                     * rail underneath already reads 0 / 1, and the word is here
                     * for a screen reader. Xbox and PlayStation both show a
                     * greyed badge and no label at all.
                     */
                    `<span class="rw-sr">Locked</span>`
          }
        </div>
      </li>`;
  };

  const milestoneRow = (view: MilestoneView): string => {
    const state = badgeStateOf(view);
    const visual = describeReward(view.milestone.reward, content);
    return `
      <li class="ach-milestone mat-panel ${view.unlocked ? "unlocked" : ""} ${view.claimed ? "claimed" : ""}"
          data-points="${view.milestone.points}">
        ${badgeImg(view.milestone.points, state, `${view.milestone.points} point milestone`)}
        <div class="ach-milestone-body">
          <div class="ach-milestone-head">
            <strong>${esc(view.milestone.name)}</strong>
            <span class="num">${formatNumber(view.milestone.points)} pts</span>
          </div>
          ${railHtml({
            value: view.have,
            max: view.milestone.points,
            height: 10,
            label: `${view.milestone.name} progress`,
            fill: "linear-gradient(var(--light-sweep), #ffe6a8 0%, var(--rarity-legendary) 55%, #a86a12 100%)",
          })}
          <div class="ach-milestone-foot">
            ${rewardTileHtml(visual, { art: 34, title: visual.name, className: "ach-reward" })}
            ${
              view.claimed
                ? tokenHtml("claimed")
                : view.claimable
                  ? `<button class="mat-hero act rw-back ach-claim-milestone" data-points="${view.milestone.points}">${icon("star-filled")}<span>Claim</span></button>`
                  : tokenHtml("locked", `${formatNumber(view.milestone.points - view.have)} to go`)
            }
          </div>
        </div>
      </li>`;
  };

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
      return `<button class="rw-tab mastery-tab mat-panel act" role="tab" aria-selected="${tab === categoryId}" data-tab="${esc(categoryId)}">
                <span>${esc(label)}</span>
                <span class="num rw-quiet" style="font-size:var(--fs-xs)">${done}/${total}</span>
                ${waiting > 0 ? `<span class="rw-badge num">${waiting}</span>` : ""}
              </button>`;
    };

    const category = categories.find((entry) => entry.id === tab)!;
    const { done, total } = countsFor(tab);

    root.innerHTML = `
      ${WASH}
      <header class="screen-header">
        ${backButton("ach-back")}
        <h1 class="title">Achievements</h1>
        <div class="rw-wallet">
          ${coinChip("clout", profile.clout)}
          ${coinChip("shards", profile.shards)}
        </div>
      </header>

      <main class="ach-body rw-ach-body">
        <section class="ach-summary rw-ach-summary mat-panel">
          <div class="ach-score">
            ${badgeImg(board.points, board.points > 0 ? "unlocked" : "locked", "Your achievement points").replace(
              'class="ach-badge"',
              'class="ach-badge" style="width:86px;height:86px"',
            )}
            <span class="ach-score-value" id="ach-points">${formatNumber(seenPoints ?? board.points)}</span>
            <span class="rw-note rw-quiet">of <span class="num" style="min-width:0">${formatNumber(board.reachable)}</span> achievement points</span>
          </div>
          <div class="rw-stack">
            <p class="rw-note" style="font-size:var(--fs-md);margin:0">
              <strong>Earned once, kept forever.</strong> Nothing here rotates, resets or expires, and
              nothing here can be bought. Points count the moment you do the thing — the Claim button
              only hands over the reward.
            </p>
            <ul class="ach-milestones">${board.milestones.map(milestoneRow).join("")}</ul>
          </div>
        </section>

        <nav class="rw-tabs ach-tabs" role="tablist">
          ${categories.map((entry) => tabButton(entry.id, entry.name)).join("")}
        </nav>

        <section class="ach-list-panel mat-panel rw-panel-pad">
          <div class="ach-category-head">
            <h2 class="ach-category-name t-heading" style="margin:0">${esc(category.name)}</h2>
            <span class="rw-note rw-quiet">${esc(category.blurb)}</span>
            <span class="ach-category-pct">${total > 0 ? percent(done / total) : "0%"}</span>
          </div>
          ${railHtml({ value: done, max: Math.max(1, total), height: 10, label: `${category.name} completion` })}
          <ul class="ach-list" id="ach-list" style="margin-top:var(--sp-3)">${shown.map(row).join("")}</ul>
          <button class="mat-panel act rw-back" id="ach-profile" style="margin-top:var(--sp-3)">
            ${icon("profile")}<span>Wear what you won</span>${icon("chevron-right")}
          </button>
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
      button.addEventListener("click", (event) => {
        const source = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const id = button.dataset["id"] ?? "";
        const rewards = board.views.find((view) => view.def.id === id)?.def.rewards ?? [];
        const grant = claimAchievement(content, id);
        if (grant) {
          audio.play("sfx.pack.rareReveal", { volume: 0.55, rate: 1.05 });
          if (motionEnabled()) {
            for (const [index, reward] of rewards.entries()) {
              const coin = coinFor(reward);
              if (coin) globalThis.setTimeout(() => flyReward(source, coin, root), index * 90);
            }
          }
        }
        render();
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>(".ach-claim-milestone")) {
      button.addEventListener("click", (event) => {
        const source = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const points = Number(button.dataset["points"] ?? 0);
        const reward = board.milestones.find((view) => view.milestone.points === points)?.milestone.reward;
        const grant = claimPointMilestone(content, points);
        if (grant) {
          audio.play("sfx.pack.rareReveal", { volume: 0.7, rate: 0.92 });
          const coin = reward ? coinFor(reward) : null;
          if (coin && motionEnabled()) flyReward(source, coin, root);
        }
        render();
      });
    }

    /*
     * The headline number counts rather than appears. It is the one figure on
     * this screen a player watches change, and printing it was the difference
     * between a trophy room and a database view.
     */
    const points = root.querySelector<HTMLElement>("#ach-points");
    if (points && seenPoints !== null && seenPoints !== board.points) tickerTo(points, board.points);
    else if (points) points.textContent = formatNumber(board.points);
    seenPoints = board.points;

    syncWallets(root);
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
