/**
 * The Event Hub — `03-screens-and-navigation.md` §4.4.3, `#/events`, **NOW
 * (reduced)**, and `09-game-modes.md` §14.
 *
 * "Reduced" is the spec's own word and it is the honest part of this screen. The
 * live half of §14 — schedules pushed from a service, leaderboards ranking you
 * against other accounts — needs a server this build does not have. What ships
 * is the offline half in full: events whose calendar is **published data**, an
 * archive that says the date each one comes back, missions credited from real
 * matches, a currency you earn and spend, and a shop that restores its stock
 * when the event returns.
 *
 * ## The two things this screen refuses to do
 *
 * **No fake countdown.** §14's honest-timer rule is binding. Every deadline
 * drawn here is the real `runEnd` of a real window, and an event that has ended
 * says so and names the day it returns. Nothing says "ends soon!" that does not
 * mean it.
 *
 * **No empty leaderboard.** The leaderboard tab §4.4.3 asks for would rank one
 * account against nobody. It is shown as unavailable with the reason, exactly
 * as the online modes are in mode select, rather than drawn with a single row
 * that happens to be you.
 */

import type { Screen } from "../shell";
import type { EventView } from "../../game/events";
import { runStart } from "../../game/events";
import { DEFERRED_EVENTS } from "../../game/events";
import { buyEventItem, claimEventMission, eventViews, settleEvents } from "../../save/profile";
import { audio } from "../../audio/audio";
import {
  banner,
  count,
  countUp,
  disposeBag,
  emblemFor,
  enter,
  esc,
  icon,
  meter,
  modeAction,
  quantify,
  rovingList,
  stamp,
  unspec,
} from "./data/kit";

export interface EventsCallbacks {
  onBack: () => void;
  onPlayMode: (modeId: string) => void;
}

/**
 * "3 days, 4 hours" — a gap, never a countdown that outlives its window.
 *
 * `quantify` rather than a hand-rolled `n === 1 ? "" : "s"`, because the same
 * hand-rolled test was written five times in this domain and got it wrong twice
 * ("1 turns" shipped in two places).
 */
function distance(from: number, to: number): string {
  const ms = Math.max(0, to - from);
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${quantify(days, "day")}, ${quantify(hours % 24, "hour")}`;
  if (hours >= 1) return quantify(hours, "hour");
  return quantify(Math.max(1, Math.floor(ms / 60_000)), "minute");
}

/**
 * How far through its run an event is, 0–1.
 *
 * Drawn as a ring around the banner's corner badge, so "ends Thursday" also has
 * a shape. An honest timer is §14's rule; making it legible at a glance is §4's.
 */
function elapsed(view: EventView, now: number): number {
  const end = view.endsAt;
  if (!end) return 0;
  const start = view.event.runs.map(runStart).find((at) => at <= now && now <= end);
  if (start === undefined || end <= start) return 0;
  return Math.max(0, Math.min(1, (now - start) / (end - start)));
}

export function createEventsScreen(callbacks: EventsCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen events-screen";

  /** which event's rules popup is open, if any */
  let rulesFor: string | null = null;
  /** the last thing that happened, echoed under the event it happened to */
  let notice: { eventId: string; text: string; good: boolean } | null = null;
  const bag = disposeBag();

  /**
   * The event's own currency mark.
   *
   * Authored as a Unicode symbol in the data file, which is exactly the thing
   * §C says to stop rendering as an icon — it comes out in whatever face the OS
   * has and becomes tofu where the code point is missing. It stays as the
   * *typographic* mark beside a number, where it belongs, and the drawn diamond
   * from the icon set carries the job of being an icon.
   */
  const currencyMark = (symbol: string): string =>
    `<span class="event-symbol" aria-hidden="true">${esc(symbol)}</span>`;

  function activeCard(view: EventView, now: number): string {
    const { event } = view;
    const key = banner(event.accent, {
      width: 1024,
      height: 384,
      seed: event.id,
      emblem: event.emblem,
      patternAlpha: 0.07,
    });
    const through = elapsed(view, now);

    return `
      <article class="event-card is-live" data-event="${esc(event.id)}" style="--event-accent:${esc(event.accent)}">
        <div class="d-key event-key" style="--key-art:url('${key}');--key-aspect:3.5/1">
          <div class="d-key-scrim"></div>
          <div class="d-key-caption">
            <span class="event-tag event-tag-live">${icon("live", 13)} Running now</span>
            <h2 class="event-name t-display">${esc(event.name)}</h2>
            <p class="event-blurb">${esc(event.blurb)}</p>
          </div>
          <div class="event-key-clock" aria-hidden="true">
            <span class="event-key-ring" style="--through:${(through * 100).toFixed(1)}%"></span>
            <span class="event-key-symbol">${esc(event.currency.symbol)}</span>
          </div>
        </div>

        <div class="event-body">
          <p class="event-timer" id="ev-timer-${esc(event.id)}">
            ${icon("timer", 15)} Ends <strong>${esc(stamp(view.endsAt ?? now))}</strong>
            <span class="event-timer-left">${esc(distance(now, view.endsAt ?? now))} left</span>
          </p>
          <div class="event-balance">
            ${currencyMark(event.currency.symbol)}
            <strong class="num" data-count="${view.balance}" data-digits="4">${count(view.balance)}</strong>
            <span class="event-currency-name">${esc(event.currency.name)}</span>
            <span class="event-earned">${count(view.earned)} earned in total</span>
          </div>
          <div class="event-actions">
            <button type="button" class="mat-chip act r-chip" data-rules="${esc(event.id)}">
              ${icon("info", 14)} Event rules
            </button>
            ${event.featuredModes
              .map(
                (mode) =>
                  `<button type="button" class="mat-hero act r-chip event-play" data-mode="${esc(mode)}">
                     ${icon("play", 14)} ${esc(modeAction(mode))}
                   </button>`
              )
              .join("")}
          </div>
        </div>
      </article>

      <section class="event-panel panel">
        <div class="event-panel-head">
          <h3 class="t-heading">Event missions</h3>
          <p class="event-completion">
            <span class="num">${count(view.claimedCount)}</span> of
            <span class="num">${count(view.missionsRequired)}</span> claimed toward the
            ${esc(event.name)} frame${view.completionGranted ? " — earned" : ""}
          </p>
        </div>
        <ul class="event-missions">
        ${view.missions
          .map(
            (mission) => `
          <li class="event-mission mat-panel d-enter ${mission.claimed ? "is-claimed" : ""}" data-mission="${esc(mission.id)}">
            <div class="event-mission-head">
              <span class="event-mission-name">${esc(mission.name)}</span>
              <span class="event-mission-reward">${currencyMark(event.currency.symbol)}<span class="num">${count(
                mission.reward
              )}</span></span>
            </div>
            <p class="event-mission-text">${esc(mission.text)}</p>
            ${meter({ value: mission.fraction, steps: 0, colour: event.accent, animate: true })}
            <div class="event-mission-foot">
              ${
                mission.claimed
                  ? `<span class="event-claimed">${icon("check", 14)} Claimed</span>`
                  : mission.claimable
                    ? `<button type="button" class="mat-hero act r-chip event-claim" data-claim="${esc(event.id)}|${esc(
                        mission.id
                      )}">Claim ${esc(event.currency.symbol)} ${count(mission.reward)}</button>`
                    : `<span class="event-progress num">${Math.round(mission.fraction * 100)}%</span>`
              }
            </div>
          </li>`
          )
          .join("")}
        </ul>
      </section>

      <section class="event-panel panel">
        <div class="event-panel-head">
          <h3 class="t-heading">Reward shop</h3>
          <p class="event-completion">Stock comes back when the event does.</p>
        </div>
        <ul class="event-shop">
        ${view.shop
          .map(
            (row) => `
          <li class="event-shop-row mat-panel d-enter ${row.soldOut ? "is-sold-out" : ""}">
            <span class="event-shop-name">${esc(row.entry.name)}</span>
            <span class="event-shop-stock">${row.soldOut ? "Sold out" : `${count(row.left)} left`}</span>
            <span class="event-shop-cost">${currencyMark(event.currency.symbol)}<span class="num">${count(
              row.entry.cost
            )}</span></span>
            <button type="button" class="mat-hero act r-chip event-buy" data-buy="${esc(event.id)}|${esc(
              row.entry.id
            )}" ${row.affordable && !row.soldOut ? "" : "disabled"}>Buy</button>
          </li>`
          )
          .join("")}
        </ul>
      </section>

      ${
        notice && notice.eventId === event.id
          ? `<p class="${notice.good ? "validation-ok" : "validation-problem"}" id="ev-notice">${esc(notice.text)}</p>`
          : ""
      }

      <section class="event-panel event-locked panel">
        <div class="event-panel-head">
          <h3 class="t-heading">Event leaderboard</h3>
        </div>
        <p class="t-body">${esc(unspec(DEFERRED_EVENTS.get("Event leaderboards") ?? "Needs a server."))}</p>
      </section>
    `;
  }

  /**
   * An event that is not running.
   *
   * Same generator as the live banner, three-quarters as lit, so the archive
   * reads as the same place with the house lights down rather than as a
   * different component. The vertical 84px gradient strip these used to carry
   * was replaced for the same reason the live one was: it was not a picture.
   */
  function railCard(view: EventView, now: number, kind: "upcoming" | "archive"): string {
    const { event } = view;
    const returns = view.returnsAt;
    const key = banner(event.accent, {
      width: 640,
      height: 360,
      seed: `${event.id}:${kind}`,
      emblem: event.emblem,
      patternAlpha: 0.05,
    });
    return `
      <article class="event-card is-${kind} d-enter" data-event="${esc(event.id)}" style="--event-accent:${esc(
        event.accent
      )}">
        <div class="d-key event-key" style="--key-art:url('${key}');--key-aspect:16/9">
          <div class="d-key-scrim"></div>
          <span class="event-key-symbol is-small" aria-hidden="true">${esc(event.currency.symbol)}</span>
        </div>
        <div class="event-body">
          <div class="event-title-row">
            <h3 class="event-name t-heading">${esc(event.name)}</h3>
            <span class="event-tag">${kind === "upcoming" ? "Coming up" : "Ended"}</span>
          </div>
          <p class="event-blurb">${esc(event.blurb)}</p>
          <p class="event-timer">
            ${
              returns
                ? `${icon("timer", 14)} ${kind === "upcoming" ? "Opens" : "Returns"} <strong>${esc(
                    stamp(returns)
                  )}</strong> <span class="event-timer-left">in ${esc(distance(now, returns))}</span>`
                : "No further runs are scheduled."
            }
          </p>
          ${
            kind === "archive"
              ? `<p class="event-rerun">Reruns are guaranteed. ${
                  view.balance > 0
                    ? `${count(view.balance)} ${esc(event.currency.name)} are still banked and will be waiting.`
                    : `Your ${esc(event.currency.name)} progress and shop stock come back exactly as you left them.`
                }</p>`
              : ""
          }
          <div class="event-actions">
            <button type="button" class="mat-chip act r-chip" data-rules="${esc(event.id)}">
              ${icon("info", 14)} Event rules
            </button>
          </div>
        </div>
      </article>`;
  }

  function render(): void {
    bag.run();
    /**
     * Settle first, then draw.
     *
     * A run that ended while the game was closed owes Clout the moment anybody
     * looks, and drawing a stale balance before paying it would show a number
     * that is about to change for reasons the screen never explained.
     */
    settleEvents();

    const now = Date.now();
    const views = eventViews(now);
    const live = views.filter((view) => view.phase === "active");
    const upcoming = views.filter((view) => view.phase === "upcoming");
    const archived = views.filter((view) => view.phase === "ended");
    const popup = rulesFor ? views.find((view) => view.event.id === rulesFor) : null;

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="ev-back">${icon("arrow-left", 16)} Lobby</button>
        <h1 class="title">Event Hub</h1>
        <span class="events-count">
          <span class="num">${count(live.length)}</span> running ·
          <span class="num">${count(upcoming.length)}</span> coming up ·
          <span class="num">${count(archived.length)}</span> archived
        </span>
      </header>

      <div class="events-body data-body">
        ${
          live.length > 0
            ? live.map((view) => activeCard(view, now)).join("")
            : `<div class="empty d-enter" id="ev-none">
                 ${icon("events", 40)}
                 <h3 class="t-heading">The hall is dark tonight</h3>
                 <p class="t-body">Every event below returns on a published date. Nothing here is missable, and nothing here expires while it still owes you something.</p>
               </div>`
        }

        ${
          upcoming.length > 0
            ? `<section class="event-rail" id="ev-upcoming">
                 <h2 class="t-heading event-rail-title">Coming up</h2>
                 <div class="event-rail-grid">${upcoming.map((view) => railCard(view, now, "upcoming")).join("")}</div>
               </section>`
            : ""
        }

        ${
          archived.length > 0
            ? `<section class="event-rail" id="ev-archive">
                 <h2 class="t-heading event-rail-title">Archive</h2>
                 <div class="event-rail-grid">${archived.map((view) => railCard(view, now, "archive")).join("")}</div>
               </section>`
            : ""
        }
      </div>

      ${
        popup
          ? `<div class="overlay" id="ev-rules-overlay">
               <div class="overlay-panel mat-panel" role="dialog" aria-label="${esc(popup.event.name)} rules">
                 <h2 class="title">${esc(popup.event.name)}</h2>
                 <ul class="event-rules-list">
                   ${popup.event.rules.map((rule) => `<li>${esc(unspec(rule))}</li>`).join("")}
                 </ul>
                 <button type="button" class="mat-hero act r-chip" id="ev-rules-close">Close</button>
               </div>
             </div>`
          : ""
      }
    `;

    root.querySelector("#ev-back")?.addEventListener("click", () => callbacks.onBack());
    root.querySelector("#ev-rules-close")?.addEventListener("click", () => {
      rulesFor = null;
      audio.play("sfx.ui.click");
      render();
    });

    for (const button of root.querySelectorAll<HTMLElement>("[data-rules]")) {
      button.addEventListener("click", () => {
        rulesFor = button.dataset.rules ?? null;
        audio.play("sfx.ui.click");
        render();
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>("[data-mode]")) {
      button.addEventListener("click", () => callbacks.onPlayMode(button.dataset.mode ?? ""));
    }
    for (const button of root.querySelectorAll<HTMLElement>("[data-claim]")) {
      button.addEventListener("click", () => {
        const [eventId, missionId] = (button.dataset.claim ?? "").split("|");
        if (!eventId || !missionId) return;
        const claim = claimEventMission(eventId, missionId);
        if (claim) {
          audio.play("sfx.ui.reward");
          notice = {
            eventId,
            good: true,
            text: claim.completionCosmeticId
              ? `Claimed ${claim.paid} ${claim.currencyName} — and that earned the event frame.`
              : `Claimed ${claim.paid} ${claim.currencyName}.`,
          };
        }
        render();
      });
    }
    for (const button of root.querySelectorAll<HTMLElement>("[data-buy]")) {
      button.addEventListener("click", () => {
        const [eventId, entryId] = (button.dataset.buy ?? "").split("|");
        if (!eventId || !entryId) return;
        const bought = buyEventItem(eventId, entryId);
        audio.play(bought.problem ? "sfx.ui.error" : "sfx.ui.reward");
        notice = {
          eventId,
          good: bought.problem === null,
          text: bought.problem ? `Could not buy that — ${bought.problem}.` : `Bought ${bought.entryName}.`,
        };
        render();
      });
    }

    enter(root);
    countUp(root);
    bag.add(rovingList(root.querySelector<HTMLElement>(".event-rail-grid"), ".event-card"));
  }

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundEvents?: unknown }).hypeboundEvents = {
    views: () => eventViews().map((view) => ({
      id: view.event.id,
      phase: view.phase,
      endsAt: view.endsAt,
      returnsAt: view.returnsAt,
      balance: view.balance,
      claimable: view.missions.filter((mission) => mission.claimable).length,
      shopLeft: view.shop.map((row) => row.left),
    })),
    runStarts: () => eventViews().map((view) => view.event.runs.map(runStart)),
    refresh: render,
  };

  return {
    root,
    resume: render,
    dispose: () => {
      bag.run();
      delete (window as unknown as { hypeboundEvents?: unknown }).hypeboundEvents;
    },
  };
}
