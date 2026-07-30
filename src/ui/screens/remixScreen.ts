/**
 * The Remix Queue — `09-game-modes.md` §12, "This Week's Meta".
 *
 * §12 asks for the modifier to be *"displayed on the queue tile and in the
 * mulligan screen"*, which is a small requirement carrying a large one: a global
 * rule change that the player discovers by losing to it is a bug. So the rule is
 * stated in full before anything starts, and again on the mulligan.
 *
 * The screen also prints the **whole launch rotation**, including the four
 * modifiers that are not playable yet and the reason each is not. §12.1 publishes
 * a ten-week table; showing six and quietly dropping four would leave a player
 * who read the design wondering which weeks were skipped and why.
 */

import type { Screen } from "../shell";
import {
  DEFERRED_REMIX,
  allModifiers,
  modifierForWeek,
  playableModifiers,
  weekEnd,
} from "../../game/remix";
import { remixQuestView } from "../../save/profile";
import { audio } from "../../audio/audio";

export interface RemixCallbacks {
  onBack: () => void;
  onPlay: (ruleId: string) => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const stamp = (at: number): string =>
  new Date(at).toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function createRemixScreen(callbacks: RemixCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen remix-screen";

  function render(): void {
    const now = Date.now();
    const current = modifierForWeek(now);
    const quest = remixQuestView(now);
    const rotation = allModifiers();
    const playable = playableModifiers();

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="remix-back">← Lobby</button>
        <h1 class="title">Remix Queue</h1>
        <span class="muted">This Week's Meta</span>
      </header>

      <div class="remix-body">
        <section class="panel remix-current" id="remix-current">
          <div class="eyebrow">This week's rule</div>
          <h2 class="remix-name">${esc(current.name)}</h2>
          <p class="remix-rule" id="remix-rule">${esc(current.text)}</p>
          <p class="muted remix-until">
            In force until <strong>${esc(stamp(weekEnd(now)))}</strong>, then the queue rotates.
          </p>
          <p class="muted remix-both">
            The rule applies to <strong>both players</strong>. Remix never touches Ranked.
          </p>
          <button class="btn btn-primary" id="remix-play">Play this week's Remix</button>
        </section>

        <section class="panel remix-quest" id="remix-quest">
          <div class="eyebrow">Weekly Remix quest</div>
          <p class="remix-quest-line">
            Win ${quest.required} Remix matches — <strong>${quest.wins} / ${quest.required}</strong>
          </p>
          <div class="remix-bar"><i style="width:${Math.round(Math.min(1, quest.wins / quest.required) * 100)}%"></i></div>
          <p class="muted">
            ${
              quest.claimed
                ? `Paid this week: ${quest.clout} Clout.`
                : `Pays ${quest.clout} Clout, automatically, the moment the third win lands.`
            }
          </p>
        </section>

        <section class="panel remix-rotation">
          <div class="eyebrow">The launch rotation — ${playable.length} of ${rotation.length} playable</div>
          ${rotation
            .map((modifier) => {
              const live = modifier.id === current.id;
              return `
              <div class="remix-row ${modifier.deferred ? "is-deferred" : ""} ${live ? "is-live" : ""}" data-rule="${esc(modifier.id)}">
                <div class="remix-row-head">
                  <span class="remix-row-name">${esc(modifier.name)}</span>
                  ${live ? `<span class="remix-tag">This week</span>` : ""}
                  ${modifier.deferred ? `<span class="remix-tag remix-tag-off">Not yet</span>` : ""}
                </div>
                <p class="muted remix-row-text">${esc(modifier.text)}</p>
                ${
                  modifier.deferred
                    ? `<p class="muted remix-why">${esc(modifier.deferred)}</p>`
                    : `<button class="btn btn-ghost btn-sm" data-play="${esc(modifier.id)}">Play it</button>`
                }
              </div>`;
            })
            .join("")}
        </section>

        <section class="panel remix-locked">
          <div class="eyebrow">Not in this build</div>
          ${[...DEFERRED_REMIX.entries()]
            .map(([name, reason]) => `<p class="muted"><strong>${esc(name)}</strong> — ${esc(reason)}</p>`)
            .join("")}
        </section>
      </div>
    `;

    root.querySelector("#remix-back")?.addEventListener("click", () => callbacks.onBack());
    root.querySelector("#remix-play")?.addEventListener("click", () => {
      audio.play("sfx.ui.confirm");
      callbacks.onPlay(current.id);
    });
    for (const button of root.querySelectorAll<HTMLElement>("[data-play]")) {
      button.addEventListener("click", () => {
        audio.play("sfx.ui.confirm");
        callbacks.onPlay(button.dataset.play ?? current.id);
      });
    }
  }

  render();

  /** Automation hook, the same shape the other screens expose. */
  (window as unknown as { hypeboundRemix?: unknown }).hypeboundRemix = {
    current: () => {
      const modifier = modifierForWeek(Date.now());
      return { id: modifier.id, name: modifier.name, text: modifier.text };
    },
    rotation: () =>
      allModifiers().map((modifier) => ({
        id: modifier.id,
        name: modifier.name,
        deferred: modifier.deferred ?? null,
      })),
    quest: () => remixQuestView(),
    refresh: render,
  };

  return {
    root,
    resume: render,
    dispose: () => {
      delete (window as unknown as { hypeboundRemix?: unknown }).hypeboundRemix;
    },
  };
}
