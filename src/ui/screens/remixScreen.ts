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
import { banner, count, disposeBag, enter, icon, meter, quantify, rovingList, stamp, unspec } from "./data/kit";

export interface RemixCallbacks {
  onBack: () => void;
  onPlay: (ruleId: string) => void;
}

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function createRemixScreen(callbacks: RemixCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen remix-screen";
  const bag = disposeBag();

  function render(): void {
    const now = Date.now();
    const current = modifierForWeek(now);
    const quest = remixQuestView(now);
    const rotation = allModifiers();
    const playable = playableModifiers();
    /*
     * The week's rule gets key art, because the week's rule is the screen.
     *
     * The hero panel was six lines of text with a 3px pink rule down its left
     * edge and no picture anywhere on the route — and because `.panel` carries no
     * padding, the rule and the text were both hard against x=0 of the panel and
     * the CTA had its left cap clipped. Seeded by the modifier id, so the rotation
     * looks like a different week when the week turns over.
     */
    const key = banner("#e46bd6", {
      width: 1280,
      height: 194,
      seed: current.id,
      emblem: "spiral",
      patternAlpha: 0.06,
    });

    root.innerHTML = `
      <div class="ambient-bg"></div>
      <header class="screen-header">
        <button class="btn btn-ghost" id="remix-back">${icon("arrow-left", 16)} Lobby</button>
        <h1 class="title">Remix Queue</h1>
        <span class="muted">This Week's Meta</span>
      </header>

      <div class="remix-body data-body">
        <section class="panel d-pad d-enter remix-current" id="remix-current">
          <div class="d-key remix-key" style="--key-art:url('${key}');--key-aspect:6.6/1" aria-hidden="true">
            <div class="d-key-scrim"></div>
          </div>
          <div class="remix-current-text">
            <div class="t-label">This week's rule</div>
            <h2 class="remix-name t-display">${esc(current.name)}</h2>
            <p class="remix-rule" id="remix-rule">${esc(current.text)}</p>
            <p class="muted remix-until">
              ${icon("timer", 14)} In force until <strong>${esc(stamp(weekEnd(now)))}</strong>, then the queue rotates.
            </p>
            <p class="muted remix-both">
              The rule applies to <strong>both players</strong>. Remix never touches Ranked.
            </p>
            <button type="button" class="mat-hero act r-chip remix-cta" id="remix-play">${icon(
              "play",
              16
            )} Play this week's Remix</button>
          </div>
        </section>

        <section class="panel d-pad d-enter remix-quest" id="remix-quest">
          <div class="t-label">Weekly Remix quest</div>
          <p class="remix-quest-line">
            Win ${quantify(quest.required, "Remix match", "Remix matches")} —
            <strong class="num">${count(quest.wins)}</strong> / <span class="num">${count(quest.required)}</span>
          </p>
          ${meter({ value: quest.wins / quest.required, steps: quest.required, animate: true })}
          <p class="muted">
            ${
              quest.claimed
                ? `Paid this week: ${quest.clout} Clout.`
                : `Pays ${quest.clout} Clout, automatically, the moment the third win lands.`
            }
          </p>
        </section>

        <section class="panel d-pad d-enter remix-rotation">
          <div class="t-label">The launch rotation — ${playable.length} of ${rotation.length} playable</div>
          <div class="remix-rows" id="remix-rows">
          ${rotation
            .map((modifier) => {
              const live = modifier.id === current.id;
              /*
               * Each rule is a real `<button>`, not a `<div>` with a nested one.
               *
               * The row itself was inert and only the "Play it" pill inside it
               * could be reached, so a keyboard player tabbed past six rules
               * without ever being told what any of them said. `mat-panel act` is
               * the foundation's raised material plus its six-state mixin, which
               * is where the hover, the press and the designed focus ring come
               * from; a deferred rule is `disabled`, so it is announced as
               * unavailable rather than merely looking dim.
               */
              return `
              <button type="button"
                      class="mat-panel act r-tile remix-row d-enter ${modifier.deferred ? "is-deferred" : ""} ${
                        live ? "is-live" : ""
                      }"
                      data-rule="${esc(modifier.id)}"
                      ${modifier.deferred ? "disabled" : `data-play="${esc(modifier.id)}"`}
                      ${live ? 'aria-current="true"' : ""}>
                <span class="remix-row-head">
                  <span class="remix-row-name">${esc(modifier.name)}</span>
                  ${live ? `<span class="remix-tag">This week</span>` : ""}
                  ${modifier.deferred ? `<span class="remix-tag remix-tag-off">Not yet</span>` : ""}
                </span>
                <span class="muted remix-row-text">${esc(modifier.text)}</span>
                ${
                  /*
                   * A locked rule says it is locked, and *then* says why.
                   *
                   * These lines used to render as a bare italic paragraph — "the
                   * engine records confluence use as a per-turn boolean rather
                   * than a count, so there is no number for balanceOverrides to
                   * bend" — which is honest, correct, and a page of somebody's
                   * backlog printed on a mode-select screen. The lock glyph and
                   * the "Coming soon" framing turn the same sentence into an
                   * explanation instead of a ticket.
                   */
                  modifier.deferred
                    ? `<span class="remix-why">${icon("lock", 13)}
                         <span><strong>Coming soon.</strong> ${esc(unspec(modifier.deferred))}</span></span>`
                    : `<span class="remix-go">${icon("play", 13)} Play it</span>`
                }
              </button>`;
            })
            .join("")}
          </div>
        </section>

        <section class="panel d-pad d-enter remix-locked">
          <div class="t-label">Not in this build</div>
          ${[...DEFERRED_REMIX.entries()]
            .map(
              ([name, reason]) =>
                `<p class="remix-deferred">${icon("lock", 13)}<span><strong>${esc(name)}</strong> — ${esc(
                  unspec(reason)
                )}</span></p>`
            )
            .join("")}
        </section>
      </div>
    `;

    enter(root, ".panel", 40);
    bag.run();
    bag.add(rovingList(root.querySelector<HTMLElement>("#remix-rows"), ".remix-row"));
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
      bag.run();
      delete (window as unknown as { hypeboundRemix?: unknown }).hypeboundRemix;
    },
  };
}
