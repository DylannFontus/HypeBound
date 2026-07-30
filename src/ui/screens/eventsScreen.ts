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

export interface EventsCallbacks {
  onBack: () => void;
  onPlayMode: (modeId: string) => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * A real datetime, written out.
 *
 * Long-form and local, because "ends 2026-08-07T00:00:00Z" is technically the
 * honest answer and practically an unreadable one — and an honest timer nobody
 * can read is not much of a promise.
 */
const stamp = (at: number): string =>
  new Date(at).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** "3 days, 4 hours" — a gap, never a countdown that outlives its window. */
function distance(from: number, to: number): string {
  const ms = Math.max(0, to - from);
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}, ${hours % 24} hour${hours % 24 === 1 ? "" : "s"}`;
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function createEventsScreen(callbacks: EventsCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen events-screen";

  /** which event's rules popup is open, if any */
  let rulesFor: string | null = null;
  /** the last thing that happened, echoed under the event it happened to */
  let notice: { eventId: string; text: string; good: boolean } | null = null;

  function activeCard(view: EventView, now: number): string {
    const { event } = view;
    return `
      <article class="event-card is-live" data-event="${esc(event.id)}" style="--event-accent:${esc(event.accent)}">
        <div class="event-key" aria-hidden="true"><span class="event-emblem">${esc(event.currency.symbol)}</span></div>
        <div class="event-body">
          <div class="event-title-row">
            <h2 class="event-name">${esc(event.name)}</h2>
            <span class="event-tag event-tag-live">Running now</span>
          </div>
          <p class="event-blurb muted">${esc(event.blurb)}</p>
          <p class="event-timer" id="ev-timer-${esc(event.id)}">
            Ends <strong>${esc(stamp(view.endsAt ?? now))}</strong> — ${esc(distance(now, view.endsAt ?? now))} left
          </p>
          <div class="event-balance">
            <span class="event-symbol">${esc(event.currency.symbol)}</span>
            <strong>${view.balance}</strong>
            <span class="muted">${esc(event.currency.name)}</span>
            <span class="muted event-earned">· ${view.earned} earned in total</span>
          </div>
          <div class="event-actions">
            <button class="btn btn-ghost btn-sm" data-rules="${esc(event.id)}">Event rules</button>
            ${event.featuredModes
              .map(
                (mode) =>
                  `<button class="btn btn-ghost btn-sm" data-mode="${esc(mode)}">Play ${esc(mode)}</button>`
              )
              .join("")}
          </div>
        </div>
      </article>

      <section class="event-panel">
        <div class="eyebrow">Event missions</div>
        <p class="muted event-completion">
          ${view.claimedCount} of ${view.missionsRequired} claimed toward the ${esc(event.name)} frame${
            view.completionGranted ? " — earned" : ""
          }
        </p>
        ${view.missions
          .map(
            (mission) => `
          <div class="event-mission ${mission.claimed ? "is-claimed" : ""}" data-mission="${esc(mission.id)}">
            <div class="event-mission-head">
              <span class="event-mission-name">${esc(mission.name)}</span>
              <span class="event-mission-reward">${esc(event.currency.symbol)} ${mission.reward}</span>
            </div>
            <p class="muted event-mission-text">${esc(mission.text)}</p>
            <div class="event-bar"><i style="width:${Math.round(mission.fraction * 100)}%"></i></div>
            ${
              mission.claimed
                ? `<span class="event-claimed muted">Claimed</span>`
                : mission.claimable
                  ? `<button class="btn btn-primary btn-sm" data-claim="${esc(event.id)}|${esc(mission.id)}">Claim ${event.currency.symbol} ${mission.reward}</button>`
                  : `<span class="muted event-progress">${Math.round(mission.fraction * 100)}%</span>`
            }
          </div>`
          )
          .join("")}
      </section>

      <section class="event-panel">
        <div class="eyebrow">Reward shop</div>
        ${view.shop
          .map(
            (row) => `
          <div class="event-shop-row ${row.soldOut ? "is-sold-out" : ""}">
            <span class="event-shop-name">${esc(row.entry.name)}</span>
            <span class="event-shop-stock muted">${row.soldOut ? "Sold out" : `${row.left} left`}</span>
            <span class="event-shop-cost">${esc(event.currency.symbol)} ${row.entry.cost}</span>
            <button class="btn btn-ghost btn-sm" data-buy="${esc(event.id)}|${esc(row.entry.id)}" ${
              row.affordable ? "" : "disabled"
            }>Buy</button>
          </div>`
          )
          .join("")}
      </section>

      ${
        notice && notice.eventId === event.id
          ? `<p class="${notice.good ? "validation-ok" : "validation-problem"}" id="ev-notice">${esc(notice.text)}</p>`
          : ""
      }

      <section class="event-panel event-locked">
        <div class="eyebrow">Event leaderboard</div>
        <p class="muted">${esc(DEFERRED_EVENTS.get("Event leaderboards") ?? "Needs a server.")}</p>
      </section>
    `;
  }

  function railCard(view: EventView, now: number, kind: "upcoming" | "archive"): string {
    const { event } = view;
    const returns = view.returnsAt;
    return `
      <article class="event-card is-${kind}" data-event="${esc(event.id)}" style="--event-accent:${esc(event.accent)}">
        <div class="event-key" aria-hidden="true"><span class="event-emblem">${esc(event.currency.symbol)}</span></div>
        <div class="event-body">
          <div class="event-title-row">
            <h3 class="event-name">${esc(event.name)}</h3>
            <span class="event-tag">${kind === "upcoming" ? "Coming up" : "Ended"}</span>
          </div>
          <p class="event-blurb muted">${esc(event.blurb)}</p>
          <p class="event-timer">
            ${
              returns
                ? `${kind === "upcoming" ? "Opens" : "Returns"} <strong>${esc(stamp(returns))}</strong> — in ${esc(distance(now, returns))}`
                : "No further runs are scheduled."
            }
          </p>
          ${
            kind === "archive"
              ? `<p class="muted event-rerun">Reruns are guaranteed. ${
                  view.balance > 0
                    ? `${view.balance} ${esc(event.currency.name)} are still banked and will be waiting.`
                    : `Your ${esc(event.currency.name)} progress and shop stock come back exactly as you left them.`
                }</p>`
              : ""
          }
          <div class="event-actions">
            <button class="btn btn-ghost btn-sm" data-rules="${esc(event.id)}">Event rules</button>
          </div>
        </div>
      </article>`;
  }

  function render(): void {
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
        <button class="btn btn-ghost" id="ev-back">← Lobby</button>
        <h1 class="title">Event Hub</h1>
        <span class="muted">${live.length} running · ${upcoming.length} coming up · ${archived.length} archived</span>
      </header>

      <div class="events-body">
        ${
          live.length > 0
            ? live.map((view) => activeCard(view, now)).join("")
            : `<p class="muted events-empty" id="ev-none">
                 Nothing is running right now. Every event below returns on a published date —
                 nothing here is missable.
               </p>`
        }

        ${
          upcoming.length > 0
            ? `<section class="event-rail" id="ev-upcoming">
                 <div class="eyebrow">Coming up</div>
                 ${upcoming.map((view) => railCard(view, now, "upcoming")).join("")}
               </section>`
            : ""
        }

        ${
          archived.length > 0
            ? `<section class="event-rail" id="ev-archive">
                 <div class="eyebrow">Archive</div>
                 ${archived.map((view) => railCard(view, now, "archive")).join("")}
               </section>`
            : ""
        }
      </div>

      ${
        popup
          ? `<div class="overlay" id="ev-rules-overlay">
               <div class="overlay-panel" role="dialog" aria-label="${esc(popup.event.name)} rules">
                 <h2 class="title">${esc(popup.event.name)}</h2>
                 <ul class="event-rules-list">
                   ${popup.event.rules.map((rule) => `<li>${esc(rule)}</li>`).join("")}
                 </ul>
                 <button class="btn btn-primary" id="ev-rules-close">Close</button>
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
      delete (window as unknown as { hypeboundEvents?: unknown }).hypeboundEvents;
    },
  };
}
