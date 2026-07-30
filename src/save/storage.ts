/**
 * Versioned localStorage persistence.
 *
 * Every store is wrapped in an envelope { version, data } and passed through a
 * migration chain on load, so player data survives schema changes. All writes
 * are debounced and failures are non-fatal — a full or blocked storage never
 * breaks the game, it just stops persisting.
 */

const PREFIX = "hypebound:";

export interface Envelope<T> {
  version: number;
  data: T;
}

export type Migration<T> = (data: unknown, fromVersion: number) => T;

export interface StoreOptions<T> {
  key: string;
  version: number;
  defaults: () => T;
  /**
   * Transform a payload written at an older version into this one's shape.
   *
   * Only needed for changes of *meaning* — a rename, a split, a unit change.
   * Additive changes need nothing: a payload of any version is carried forward
   * and back-filled from `defaults()` at every depth, so a new field arrives
   * with its default rather than as `undefined`.
   */
  migrate?: Migration<T>;
}

const memoryFallback = new Map<string, string>();
let storageAvailable: boolean | null = null;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Back-fill a saved payload from the defaults, at every depth.
 *
 * This used to be `{ ...defaults(), ...saved }` — one level — and the cost of
 * that shows up as a comment on **twelve** separate fields of `PlayerProfile`:
 *
 * > *"NOTE: the save store merges defaults shallowly, so a field added inside
 * > this object will not be back-filled on an existing save. Read it
 * > defensively or bump the store version."*
 *
 * Reading it defensively works and has been done everywhere, but it is a rule
 * a person has to remember on every future field, and forgetting it produces an
 * `undefined` that reads as a zero, an empty list or a crash depending on where
 * it lands. Filling deeply removes the rule instead of restating it.
 *
 * Three things it deliberately does **not** do:
 *
 * - **It never merges arrays.** A saved list is the list. Element-wise merging
 *   would resurrect deleted history and invent entries nobody earned.
 * - **It never overwrites a saved value with a default**, including `null`.
 *   `hypeWave.pass: null` means "no live pass", not "not set", and a merge that
 *   could not tell those apart would hand out a season somebody never played.
 * - **It does not fill *inside* map values.** `banners.state` and `collection`
 *   default to `{}`, so there is no template to fill a per-banner or per-card
 *   entry from — those stay defensively read, and honestly so.
 */
export function fillDefaults<T>(defaults: T, saved: unknown): T {
  if (saved === undefined) return defaults;
  if (!isPlainObject(defaults) || !isPlainObject(saved)) return saved as T;

  const out: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(saved)) {
    out[key] = key in defaults ? fillDefaults((defaults as Record<string, unknown>)[key], value) : value;
  }
  return out as T;
}

function available(): boolean {
  if (storageAvailable !== null) return storageAvailable;
  try {
    const probe = `${PREFIX}__probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  return storageAvailable;
}

function readRaw(key: string): string | null {
  if (!available()) return memoryFallback.get(key) ?? null;
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  if (!available()) {
    memoryFallback.set(key, value);
    return;
  }
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // quota exceeded or private mode — degrade to memory for this session
    memoryFallback.set(key, value);
  }
}

export class Store<T extends object> {
  private cache: T;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(data: T) => void>();

  constructor(private readonly options: StoreOptions<T>) {
    this.cache = this.load();
  }

  private load(): T {
    const raw = readRaw(this.options.key);
    if (!raw) return this.options.defaults();

    try {
      const parsed = JSON.parse(raw) as Envelope<unknown>;
      if (typeof parsed !== "object" || parsed === null || typeof parsed.version !== "number") {
        return this.options.defaults();
      }
      if (parsed.version === this.options.version) {
        return fillDefaults(this.options.defaults(), parsed.data);
      }
      /**
       * A version mismatch carries the payload forward; it does not throw it
       * away.
       *
       * This branch used to return `defaults()` for any store without a
       * `migrate`, which made **bumping a version a whole-save wipe** — the
       * profile store was version 1 with no migration, so the day somebody
       * bumped it, every account would silently have lost its collection, its
       * decks, its Mastery and its cosmetics. The bug would have been in a line
       * nobody touched, triggered by a line somebody did.
       *
       * Carrying forward is safe because of the two lines around it: a store's
       * `migrate` handles anything whose *meaning* changed, and `fillDefaults`
       * supplies anything new at every depth. A field a reader does not
       * recognise is inert; a save that has been deleted is gone.
       */
      const migrated = this.options.migrate ? this.options.migrate(parsed.data, parsed.version) : parsed.data;
      return fillDefaults(this.options.defaults(), migrated);
    } catch {
      return this.options.defaults();
    }
  }

  get(): T {
    return this.cache;
  }

  /**
   * A fresh copy of this store's defaults.
   *
   * Exposed for cloud saves, which need to tell "this browser has never been
   * played on" from "this browser has a save". That distinction decides whether
   * signing in silently downloads the account's save or stops to ask which copy
   * to keep — and offering that choice to somebody whose local save is an empty
   * collection is a trap with a polite label on it.
   */
  defaults(): T {
    return this.options.defaults();
  }

  /** The envelope version this store writes. */
  version(): number {
    return this.options.version;
  }

  set(patch: Partial<T>): T {
    this.cache = { ...this.cache, ...patch };
    this.scheduleWrite();
    for (const listener of this.listeners) listener(this.cache);
    return this.cache;
  }

  replace(data: T): T {
    this.cache = data;
    this.scheduleWrite();
    for (const listener of this.listeners) listener(this.cache);
    return this.cache;
  }

  update(mutator: (draft: T) => void): T {
    const draft = structuredClone(this.cache);
    mutator(draft);
    return this.replace(draft);
  }

  subscribe(listener: (data: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): T {
    return this.replace(this.options.defaults());
  }

  /** Force an immediate write (called before navigation away / unload). */
  flush(): void {
    if (this.writeTimer !== null) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    const envelope: Envelope<T> = { version: this.options.version, data: this.cache };
    writeRaw(this.options.key, JSON.stringify(envelope));
  }

  private scheduleWrite(): void {
    if (this.writeTimer !== null) clearTimeout(this.writeTimer);
    // the global setTimeout, not window.setTimeout: readRaw/writeRaw already
    // fall back to memory outside a browser, and this was the only thing left
    // stopping the save layer from working headlessly (tests, and any future
    // server-side use of the same store)
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.flush();
    }, 250);
  }
}

const registry: Store<never>[] = [];

export function createStore<T extends object>(options: StoreOptions<T>): Store<T> {
  const store = new Store(options);
  registry.push(store as unknown as Store<never>);
  return store;
}

/** Persist everything immediately — wired to pagehide/visibilitychange. */
export function flushAllStores(): void {
  for (const store of registry) store.flush();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushAllStores);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAllStores();
  });
}
