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
 */

import type { Screen } from "../shell";
import { audio } from "../../audio/audio";
import { currentAccount, signIn, signOut, signUp } from "../../auth/account";
import { forgetCloudLink, stopAutoSync } from "../../save/cloudSaves";
import { ONLINE, onlineAvailable } from "../../config";

export interface SignInCallbacks {
  onBack: () => void;
  /** Fired once a session exists — the caller decides where that leads. */
  onSignedIn: () => void;
}

export function createSignInScreen(callbacks: SignInCallbacks): Screen {
  const root = document.createElement("div");
  root.className = "screen signin-screen";

  const account = currentAccount();

  root.innerHTML = `
    <div class="ambient-bg"></div>
    <header class="screen-header">
      <button class="btn btn-ghost" id="signin-back">← Back</button>
      <h1 class="title">${account ? "Your account" : "Sign in to play other people"}</h1>
    </header>

    <main class="signin-body">
      <section class="panel panel-chrome signin-panel">
        ${account ? signedInMarkup(account.email) : formMarkup()}
      </section>

      <section class="panel panel-chrome signin-note">
        <h3 class="profile-section-title">What an account is, and is not</h3>
        <p class="muted">
          It does two things: it lets two people be matched with each other, and it carries
          your save. Signing in on another device gives you your collection, your decks and
          your progress — that did not used to be true, and this page used to say so.
        </p>
        <p class="muted">
          <strong>What gets uploaded.</strong> Your collection, your decks and their names,
          your display name, your progress, your settings and your match history. It goes to
          this game's own server. It travels over HTTPS, but it is <strong>not</strong>
          encrypted against the server itself — whoever runs that server can read it, so a
          deck name is not a private place to write something. The privacy page has a button
          that deletes all of it, and deleting your account deletes it too.
        </p>
        <p class="muted">
          The first time this device and your account both have a save, you are asked which
          to keep. Nothing is merged and nothing is guessed, and the copy being replaced on
          this device is kept in the export on the privacy page.
        </p>
        <p class="muted">
          Your email and password go to Supabase, the service that hosts logins for this
          game. This game's own server never sees your password, and never stores your
          address: it reads a user id out of your sign-in token and nothing else.
        </p>
        <p class="muted">
          <strong>Your address is not verified.</strong> There is no confirmation email, so
          signing up is instant and nothing checks that the address belongs to you. It is
          used to sign you in and for nothing else — no mail is ever sent to it.
        </p>
      </section>
    </main>`;

  const status = root.querySelector<HTMLElement>("#signin-status");
  const form = root.querySelector<HTMLFormElement>("#signin-form");
  const emailInput = root.querySelector<HTMLInputElement>("#signin-email");
  const passwordInput = root.querySelector<HTMLInputElement>("#signin-password");
  const submitBtn = root.querySelector<HTMLButtonElement>("#signin-submit");
  const toggleBtn = root.querySelector<HTMLButtonElement>("#signin-toggle");

  /** "Create an account" versus "sign in to one that exists" — same two fields. */
  let creating = false;

  const say = (message: string, tone: "error" | "info" = "error"): void => {
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
    status.hidden = message.length === 0;
  };

  const setMode = (next: boolean): void => {
    creating = next;
    if (submitBtn) submitBtn.textContent = creating ? "Create account" : "Sign in";
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

    if (submitBtn) submitBtn.disabled = true;
    say(creating ? "Creating your account…" : "Signing in…", "info");

    const result = creating ? await signUp(email, password) : await signIn(email, password);
    if (submitBtn) submitBtn.disabled = false;

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

  queueMicrotask(() => emailInput?.focus());

  return { root };
}

function formMarkup(): string {
  return `
    <p class="muted signin-lead">
      Casual matches pair you with another player. That needs an account so the server
      knows which two people are in a game.
    </p>
    <form id="signin-form" class="signin-form" novalidate>
      <label class="signin-field">
        <span>Email</span>
        <input id="signin-email" type="email" name="email" autocomplete="email" required
               inputmode="email" spellcheck="false" />
      </label>
      <label class="signin-field">
        <span>Password</span>
        <input id="signin-password" type="password" name="password" autocomplete="current-password"
               required minlength="10" />
      </label>
      <p class="signin-status" id="signin-status" role="status" aria-live="polite" hidden></p>
      <div class="signin-actions">
        <button class="btn btn-primary" id="signin-submit" type="submit">Sign in</button>
        <button class="btn btn-ghost" id="signin-toggle" type="button">Create an account instead</button>
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
