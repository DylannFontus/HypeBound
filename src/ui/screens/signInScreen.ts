/**
 * Sign in, or make an account.
 *
 * The only thing this game asks anyone for, so it says exactly what it is for
 * and exactly what happens to it, on the screen where the asking happens rather
 * than behind a link to the privacy page. A player deciding whether to type
 * their address should not have to go and look up what it is for.
 *
 * Two truths on this screen that most sign-in forms would leave out, and that
 * are here because they are true:
 *
 * - **The address is never confirmed.** Email confirmation is off, so signing
 *   up is instant — and nothing checks that the address is yours. Saying so is
 *   the difference between a design decision and a quiet one.
 * - **An account now carries your save**, and that is a thing being sent
 *   somewhere rather than a feature being granted. Until cloud saves shipped
 *   this screen said the opposite, in as many words, and the sentence was true
 *   when it was written. What replaced it says what is uploaded, that it is
 *   readable by whoever runs the server, and where the button to delete it is.
 *
 * The second point is the reason this screen is edited whenever the online
 * surface changes: it is the last thing a player reads before deciding, so a
 * stale promise here is worse than no promise anywhere.
 *
 * ## The essay stays; it stopped being the screen
 *
 * All of the above used to be five paragraphs printed under the form, which
 * made a 720px column that was four fifths body copy and left the form itself
 * looking like a footnote. None of it is deleted — deleting it would be the
 * dishonest fix — but the parts a player only reads once sit behind a
 * disclosure, and the three facts that actually change a decision are on the
 * stage to the left of the form where they can be read in a glance.
 *
 * ## Three states that did not exist
 *
 * §5 asks for every state to be designed and this control had two. Submitting
 * used to set `disabled`, which drops the primary action to 42% opacity and
 * reads as the button switching itself off at the exact moment the player is
 * waiting on it; it now goes to the foundation's `loading` state, which keeps
 * the plate lit and runs a meter across it. An error used to be amber body copy
 * — a caution colour for a failure, with no icon and no indication of which
 * field was at fault; it is now `--danger`, prefixed with a mark, tied to the
 * offending field with `aria-invalid`, and the panel shakes once.
 */

import type { ContentIndex } from "../../engine/types";
import type { Screen } from "../shell";
import { audio } from "../../audio/audio";
import { currentAccount, signIn, signOut, signUp } from "../../auth/account";
import { forgetCloudLink, stopAutoSync } from "../../save/cloudSaves";
import { activeDeck } from "../../save/profile";
import { ONLINE, onlineAvailable } from "../../config";
import { paintLeaderPortrait, paintVenue } from "../art/leaderPortrait";
import { icon } from "../art/uiIcons";
import { motionEnabled, stagger } from "../motion";

export interface SignInCallbacks {
  onBack: () => void;
  /** Fired once a session exists — the caller decides where that leads. */
  onSignedIn: () => void;
}

export function createSignInScreen(content: ContentIndex, callbacks: SignInCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen signin-screen";

  const account = currentAccount();
  const deck = activeDeck();
  const leaderCard = deck ? content.leaders[deck.leaderCardId] : undefined;

  root.innerHTML = `
    <div class="signin-room" aria-hidden="true"></div>
    <div class="signin-vignette" aria-hidden="true"></div>
    <aside class="signin-portrait" id="signin-portrait" aria-hidden="true"></aside>

    <header class="screen-header">
      <button class="btn btn-ghost signin-back" id="signin-back">${icon("arrow-left")}<span>Back</span></button>
      <h1 class="title">${account ? "Your account" : "Sign in to play other people"}</h1>
    </header>

    <main class="signin-body">
      <section class="signin-stage mat-panel">
        <div class="signin-stage-wash" aria-hidden="true"></div>
        <div class="t-label">Why an account</div>
        <h2 class="signin-stage-title t-display">Two people, one game</h2>
        <ul class="signin-points">
          <li><span class="signin-point-mark">${icon("live")}</span><span><strong>Casual matches</strong> pair you with another player. The server has to know which two people are in a game.</span></li>
          <li><span class="signin-point-mark">${icon("chest")}</span><span><strong>Your save travels.</strong> Sign in on another device and your collection, decks and progress come with you.</span></li>
          <li><span class="signin-point-mark">${icon("eye")}</span><span><strong>Nothing is hidden from you.</strong> What gets uploaded is listed below, and the privacy page deletes all of it.</span></li>
        </ul>
      </section>

      <section class="signin-panel mat-panel">
        ${account ? signedInMarkup(account.email) : formMarkup()}
      </section>

      <details class="signin-note mat-panel">
        <summary class="signin-note-summary">
          <span class="signin-note-mark">${icon("chevron-right")}</span>
          <span>What an account is, and is not</span>
        </summary>
        <div class="signin-note-body">
          <p>
            It does two things: it lets two people be matched with each other, and it carries
            your save. Signing in on another device gives you your collection, your decks and
            your progress — that did not used to be true, and this page used to say so.
          </p>
          <p>
            <strong>What gets uploaded.</strong> Your collection, your decks and their names,
            your display name, your progress, your settings and your match history. It goes to
            this game's own server. It travels over HTTPS, but it is <strong>not</strong>
            encrypted against the server itself — whoever runs that server can read it, so a
            deck name is not a private place to write something. The privacy page has a button
            that deletes all of it, and deleting your account deletes it too.
          </p>
          <p>
            The first time this device and your account both have a save, you are asked which
            to keep. Nothing is merged and nothing is guessed, and the copy being replaced on
            this device is kept in the export on the privacy page.
          </p>
          <p>
            Your email and password go to Supabase, the service that hosts logins for this
            game. This game's own server never sees your password, and never stores your
            address: it reads a user id out of your sign-in token and nothing else.
          </p>
          <p>
            <strong>Your address is not verified.</strong> There is no confirmation email, so
            signing up is instant and nothing checks that the address belongs to you. It is
            used to sign you in and for nothing else — no mail is ever sent to it.
          </p>
        </div>
      </details>
    </main>`;

  /**
   * The room, and the person standing in it.
   *
   * The form used to be 452×318 in a 1600×900 viewport — 7.5% of the screen,
   * with 285px of empty on each side, 290 above and 240 below. The audit asked
   * for the leader lit on the left with the venue blurred behind and none of it
   * was built; what was there instead was a login card in a void, which is the
   * one screen in the front door a player has to trust before they type
   * anything into it.
   *
   * Two layers answer it. `.signin-room` is the venue at heavy blur across the
   * whole screen, so the composition has a place; the portrait is the player's
   * own leader at the left, unblurred and lit, so it has a subject. Both are
   * existing assets and neither is invented. With no deck yet — which is most
   * accounts arriving here — the portrait is simply absent and the room carries
   * it alone, and the grid collapses its column rather than leaving a hole.
   */
  const room = root.querySelector<HTMLElement>(".signin-room");
  if (room) {
    room.appendChild(paintVenue(deck?.leaderCardId ? leaderCard?.faction ?? "default" : "default", {
      /**
       * Nine hundred pixels, softened in the plate, stretched over the viewport.
       *
       * It was 1280 CSS pixels at a 2× backing store under `filter: blur(20px)`
       * — a 2560×1536 texture built from a 3840×2160 PNG and then blurred across
       * 1728×1008 of screen, inside the frame a transition starts in. The whole
       * point of a backdrop at this blur is that no pixel of it is resolvable,
       * and a picture nobody can resolve should not be stored at retina. The
       * same 900px bucket the queue asks for, so the two screens share one mip.
       */
      width: 900,
      aspect: 0.6,
      resolution: 1,
      softness: 10,
      /**
       * Bigger, brighter, and no longer a strip.
       *
       * At 960×595 behind a `dim: 0.42` and a 26px blur the venue was
       * effectively not on screen: 59.9% of this screen's 16px blocks measured
       * both dark and flat, the whole band x=500..1600 by y=620..810 was empty,
       * and the room the player is signing in to reach contributed nothing to
       * the composition. Every value here moved in the same direction, and the
       * disclosure below is what proves it worked.
       */
      bias: 0.05,
      scrim: 0.34,
      dim: 0.22,
      // Something in the room to survive the blur: the band y≈700–900 across the
      // full width — 22% of this frame — carried nothing but wash.
      rig: true,
      className: "signin-room-art",
    }));
  }

  const portraitHost = root.querySelector<HTMLElement>("#signin-portrait");
  if (portraitHost && leaderCard) {
    portraitHost.appendChild(
      paintLeaderPortrait(leaderCard, {
        /**
         * 460 at 1.8×, rather than 520 at 2×.
         *
         * `.signin-portrait` is `min(40vw, 560px)` wide, so a 1.6-megapixel
         * plate was being drawn for a box that can never exceed 1.1 megapixels
         * of device pixels — and it is drawn inside the frame the transition
         * starts in, where every megapixel is a dropped frame. This is the one
         * plate in the front door that is sharp and lit, so it keeps very nearly
         * all of its resolution and none of its slack.
         */
        width: 460,
        resolution: 1.8,
        aspect: 1.52,
        bias: 0.08,
        scrim: 0.5,
        /**
         * Feathered on all four sides, and bled off the left of the viewport
         * as well.
         *
         * Three edges used to feather and the fourth was a straight vertical
         * line 57px in from the screen edge with background on both sides of
         * it — measured at y=400, luminance went 32 at x=57 to 133 at x=60,
         * which is the one arrangement that guarantees the eye reads "cropped
         * photograph". `fadeLeft` did not exist when this was written. It does
         * now, and the element bleeds past x=0 as well, so there are two
         * independent reasons no boundary can appear there.
         */
        fadeTop: 0.14,
        fadeLeft: 0.2,
        fadeRight: 0.24,
        fadeBottom: 0.12,
        reflect: 0.1,
        className: "signin-portrait-art",
      })
    );
    root.classList.add("has-leader");
  }

  /**
   * Three pieces of furniture, in reading order, 55ms apart.
   *
   * The room and the person are not in this list: they belong to the place and
   * arrive with the screen. What cascades is the argument, then the form, then
   * the small print — which is also the order somebody reads them in, and the
   * order in which they matter.
   */
  stagger(root.querySelectorAll(".signin-stage, .signin-panel, .signin-note"), { step: 55, from: 40 });

  const panel = root.querySelector<HTMLElement>(".signin-panel");
  const status = root.querySelector<HTMLElement>("#signin-status");
  const statusText = root.querySelector<HTMLElement>("#signin-status-text");
  const form = root.querySelector<HTMLFormElement>("#signin-form");
  const emailInput = root.querySelector<HTMLInputElement>("#signin-email");
  const passwordInput = root.querySelector<HTMLInputElement>("#signin-password");
  const submitBtn = root.querySelector<HTMLButtonElement>("#signin-submit");
  const submitLabel = root.querySelector<HTMLElement>("#signin-submit-label");
  const toggleBtn = root.querySelector<HTMLButtonElement>("#signin-toggle");

  /** "Create an account" versus "sign in to one that exists" — same two fields. */
  let creating = false;

  /**
   * The error state, and the four things it changes rather than the one it did.
   *
   * Colour alone is forbidden by §9, and amber was the wrong colour anyway —
   * `--warning` is a caution, and "that password is wrong" is a failure. So:
   * `--danger`, a mark in front of the sentence, `aria-invalid` on both fields
   * (the service deliberately does not say which of the two was wrong, and
   * guessing would be worse than marking both), and a single shake of the
   * panel for anybody who is not reading the live region.
   */
  const say = (message: string, tone: "error" | "info" = "error"): void => {
    if (!status || !statusText) return;
    statusText.textContent = message;
    status.dataset.tone = tone;
    status.hidden = message.length === 0;

    const invalid = tone === "error" && message.length > 0;
    for (const field of [emailInput, passwordInput]) {
      if (!field) continue;
      if (invalid) field.setAttribute("aria-invalid", "true");
      else field.removeAttribute("aria-invalid");
    }
    if (invalid && panel && motionEnabled()) {
      panel.classList.remove("is-wrong");
      void panel.offsetWidth;
      panel.classList.add("is-wrong");
    }
  };

  const setMode = (next: boolean): void => {
    creating = next;
    if (submitLabel) submitLabel.textContent = creating ? "Create account" : "Sign in";
    if (toggleBtn) {
      toggleBtn.textContent = creating ? "I already have an account" : "Create an account instead";
    }
    if (passwordInput) {
      // Tells a password manager whether to offer a new password or a saved one.
      passwordInput.autocomplete = creating ? "new-password" : "current-password";
    }
    say("");
  };

  setMode(false);

  toggleBtn?.addEventListener("click", () => {
    audio.play("sfx.ui.click");
    setMode(!creating);
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });

  /**
   * Busy, and still lit.
   *
   * `disabled` was doing two jobs — stop a second submit, and say something is
   * happening — and it was bad at the second. The foundation's loading state
   * already blocks pointer events, veils the plate, flips the hero's ink and
   * runs a meter along the bottom edge, so all this has to do is name the state
   * and tell assistive technology.
   */
  const setBusy = (busy: boolean): void => {
    if (!submitBtn) return;
    submitBtn.dataset["state"] = busy ? "loading" : "";
    submitBtn.setAttribute("aria-busy", String(busy));
    if (!busy) delete submitBtn.dataset["state"];
  };

  const submit = async (): Promise<void> => {
    const email = emailInput?.value.trim() ?? "";
    const password = passwordInput?.value ?? "";

    // Checked here only so the player gets an answer instantly; the service
    // checks it properly, and its answer is the one that decides.
    if (!email || !password) return say("Both fields are needed.");
    if (creating && password.length < 10) {
      return say("Passwords need at least 10 characters. Length is what makes one hard to guess.");
    }
    if (!onlineAvailable()) {
      return say("This build has no server configured, so there is nothing to sign in to.");
    }

    setBusy(true);
    say(creating ? "Creating your account…" : "Signing in…", "info");

    const result = creating ? await signUp(email, password) : await signIn(email, password);
    setBusy(false);

    if (!result.ok) {
      // The service's own wording, not a guess at what it meant. "Invalid login
      // credentials" is more useful than a friendly sentence that hides which
      // of the two fields was wrong — because it does not claim to know.
      return say(result.message);
    }

    audio.play("sfx.ui.confirm");
    callbacks.onSignedIn();
  };

  root.querySelector("#signin-signout")?.addEventListener("click", () => {
    void (async () => {
      audio.play("sfx.ui.click");
      /**
       * Stop syncing and forget the agreement before clearing the session.
       *
       * The link file records which revision of each section this device last
       * agreed with the server, *for a particular account*. Left behind, the
       * next person to sign in on this browser would start with somebody else's
       * revisions — and a revision that matches by coincidence is a silent
       * overwrite waiting to happen. `forgetCloudLink` also stands in for
       * `signOut()` doing it itself, which it cannot: the save layer imports
       * the auth layer, so the auth layer cannot import the save layer back.
       */
      stopAutoSync();
      forgetCloudLink();
      await signOut();
      callbacks.onBack();
    })();
  });

  root.querySelector("#signin-back")?.addEventListener("click", () => {
    audio.play("sfx.ui.click");
    callbacks.onBack();
  });

  /**
   * Focused, but the screen does not move to do it.
   *
   * A plain `focus()` asks the browser to scroll the field into view, and on a
   * phone in landscape the sign-in body is a scroller that is a dozen pixels
   * taller than its box — so the browser scrolled it, and the first thing the
   * player saw at 844×390 was the EMAIL label sliced in half by the header. The
   * field is already on screen at every size this layout supports; what the
   * scroll was buying was nothing, and what it cost was a label.
   */
  queueMicrotask(() => emailInput?.focus({ preventScroll: true }));

  return { root };
}

function formMarkup(): string {
  return `
    <form id="signin-form" class="signin-form" novalidate>
      <label class="signin-field field-group">
        <span class="t-label">Email</span>
        <input class="field" id="signin-email" type="email" name="email" autocomplete="email" required
               inputmode="email" spellcheck="false" placeholder="you@example.com" />
      </label>
      <label class="signin-field field-group">
        <span class="t-label">Password</span>
        <input class="field" id="signin-password" type="password" name="password" autocomplete="current-password"
               required minlength="10" placeholder="At least 10 characters" />
      </label>
      <p class="signin-status" id="signin-status" role="status" aria-live="polite" hidden>
        <span class="signin-status-mark" aria-hidden="true">${icon("warning")}</span>
        <span id="signin-status-text"></span>
      </p>
      <div class="signin-actions">
        <button class="signin-submit mat-hero act" id="signin-submit" type="submit">
          <span id="signin-submit-label">Sign in</span>
        </button>
        <button class="signin-toggle act" id="signin-toggle" type="button">Create an account instead</button>
      </div>
    </form>`;
}

function signedInMarkup(email: string): string {
  return `
    <p class="signin-lead">Signed in as <strong>${escapeHtml(email || "an account with no address on it")}</strong>.</p>
    <p class="muted">
      Signed in at ${escapeHtml(new URL(ONLINE.supabaseUrl).host)}. Signing out clears the
      session from this device; it does not delete the account, and there is nothing on
      this page that can.
    </p>
    <div class="signin-actions">
      <button class="btn btn-ghost" id="signin-signout" type="button">Sign out</button>
    </div>`;
}

/**
 * The email comes back from the service, so it is not this game's text.
 *
 * Nothing else on this screen interpolates anything, and this one does because
 * it has to — an address is the one string here a stranger chose.
 */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
