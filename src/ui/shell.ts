/**
 * Screen router and app shell.
 *
 * Screens are registered by id and mounted into #app one at a time. Navigation
 * is hash-based so the browser back button works and a reload returns you to
 * the same place. Each screen owns its own DOM and disposes cleanly.
 */

export interface Screen {
  root: HTMLElement;
  dispose?: () => void;
  /** called when the screen becomes visible again after a child screen closes */
  resume?: () => void;
}

export type ScreenFactory = (params: URLSearchParams) => Screen | Promise<Screen>;

export class Shell {
  private readonly host: HTMLElement;
  private readonly routes = new Map<string, ScreenFactory>();
  private current: { id: string; key: string; screen: Screen } | null = null;
  private navigating = false;
  private fallback = "lobby";

  constructor(host: HTMLElement) {
    this.host = host;
    window.addEventListener("hashchange", () => void this.handleHash());
  }

  register(id: string, factory: ScreenFactory): this {
    this.routes.set(id, factory);
    return this;
  }

  setFallback(id: string): this {
    this.fallback = id;
    return this;
  }

  /** Navigate by pushing a hash; the hashchange handler does the mounting. */
  navigate(id: string, params: Record<string, string> = {}): void {
    const query = new URLSearchParams(params).toString();
    const hash = query ? `#${id}?${query}` : `#${id}`;
    if (window.location.hash === hash) {
      void this.handleHash();
      return;
    }
    window.location.hash = hash;
  }

  back(): void {
    window.history.back();
  }

  async start(): Promise<void> {
    if (!window.location.hash) {
      this.navigate(this.fallback);
      return;
    }
    await this.handleHash();
  }

  private parseHash(): { id: string; params: URLSearchParams } {
    const raw = window.location.hash.replace(/^#/, "");
    const [id, query] = raw.split("?");
    return { id: id || this.fallback, params: new URLSearchParams(query ?? "") };
  }

  private async handleHash(): Promise<void> {
    if (this.navigating) return;
    const { id, params } = this.parseHash();

    const factory = this.routes.get(id);
    if (!factory) {
      this.navigate(this.fallback);
      return;
    }
    /**
     * Compare the WHOLE route, params included. Comparing only the id meant
     * #tutorial -> #tutorial?stage=2 was treated as "already here" and never
     * remounted, so the tutorial could never advance past the stage it opened
     * on. Any route that carries state in its params (tutorial stage, deck
     * builder slot) has the same hazard.
     */
    const key = window.location.hash.replace(/^#/, "");
    if (this.current?.key === key) return;

    this.navigating = true;
    try {
      const outgoing = this.current;
      const screen = await factory(params);

      // fade the old screen out, then mount the new one
      if (outgoing) {
        outgoing.screen.root.classList.add("screen-out");
        window.setTimeout(() => {
          outgoing.screen.dispose?.();
          outgoing.screen.root.remove();
        }, 200);
      }

      this.host.appendChild(screen.root);
      this.current = { id, key, screen };
    } catch (error) {
      console.error(`Failed to mount screen "${id}":`, error);
      this.showError(id, error);
    } finally {
      this.navigating = false;
    }
  }

  private showError(id: string, error: unknown): void {
    const node = document.createElement("div");
    node.className = "screen error-screen";
    node.innerHTML = `
      <div class="ambient-bg"></div>
      <div class="panel panel-chrome error-panel">
        <div class="eyebrow">Something broke</div>
        <h2 class="title">Could not open “${id}”</h2>
        <pre class="error-detail">${error instanceof Error ? error.message : String(error)}</pre>
        <button class="btn btn-primary" id="error-home">Back to Lobby</button>
      </div>`;
    this.host.appendChild(node);
    node.querySelector("#error-home")?.addEventListener("click", () => {
      node.remove();
      this.navigate(this.fallback);
    });
  }
}

/** Landscape enforcement for mobile — the game is landscape-only by design. */
export function watchOrientation(): void {
  const overlay = document.getElementById("rotate-overlay");
  if (!overlay) return;

  const update = (): void => {
    const portrait = window.innerHeight > window.innerWidth;
    const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 820;
    overlay.hidden = !(portrait && smallScreen);
  };

  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", () => window.setTimeout(update, 120));
  update();
}
