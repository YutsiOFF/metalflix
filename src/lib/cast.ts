/**
 * Chromecast, through castjs (github.com/castjs/castjs, MIT, < 10 kB).
 *
 * The library wraps the Google Cast SDK and loads `cast_sender.js` itself. The
 * site only keeps what it needs around it: loading it once per page, asking the
 * device list, and proving a session exists before claiming a cast worked.
 */

const LIB = "https://cdnjs.cloudflare.com/ajax/libs/castjs/7.0.3/cast.min.js";

interface CastjsSubtitles {
  label: string;
  src: string;
  subtype?: "SUBTITLES" | "CAPTIONS";
  active?: boolean;
}

interface CastjsOptions {
  title?: string;
  description?: string;
  poster?: string;
  time?: number;
  paused?: boolean;
  subtitles?: CastjsSubtitles[];
}

interface CastjsInstance {
  available?: boolean | (() => boolean);
  connected?(): boolean;
  cast(url: string, options?: CastjsOptions): Promise<unknown> | void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  /** Setter when given a value, current volume otherwise. */
  volume?(value?: number): unknown;
  /** Setter when given a flag, current state otherwise. */
  muted?(value?: boolean): unknown;
}

type CastjsConstructor = new (options?: Record<string, unknown>) => CastjsInstance;

type FrameworkContext = {
  getCurrentSession?: () => unknown;
  getSessionState?: () => unknown;
  requestSession?: () => Promise<unknown>;
};

let instance: CastjsInstance | null = null;
let loading: Promise<boolean> | null = null;

/**
 * castjs declares `class Castjs` at the top level of a classic script: the name
 * lives in the global scope but is *not* a property of `window`, so a module has
 * to reach it through a global evaluation.
 */
function lookup(): CastjsConstructor | undefined {
  const scope = window as unknown as { Castjs?: CastjsConstructor };
  if (scope.Castjs) return scope.Castjs;
  try {
    return new Function("return typeof Castjs !== 'undefined' ? Castjs : undefined")() as
      | CastjsConstructor
      | undefined;
  } catch {
    return undefined;
  }
}

function context(): FrameworkContext | undefined {
  const framework = (
    window as unknown as { cast?: { framework?: { CastContext?: { getInstance?: () => unknown } } } }
  ).cast?.framework?.CastContext;
  return framework?.getInstance?.() as FrameworkContext | undefined;
}

/** Is a television actually playing something right now? */
function sessionAlive(cjs: CastjsInstance): boolean {
  try {
    if (cjs.connected?.()) return true;
  } catch {
    // Not connected: fall through to the framework itself.
  }
  try {
    const live = context();
    if (!live?.getCurrentSession?.()) return false;
    // A session left in IDLE means the television was stopped: Chrome still
    // remembers it, but nothing is casting.
    const state = String(live.getSessionState?.() ?? "");
    if (!state) return true;
    return state === "SESSION_STARTED" || state === "SESSION_STARTING" || state === "SESSION_RESUMED";
  } catch {
    return false;
  }
}

/** A fresh library object, on a session that is not the dead one. */
function create(): CastjsInstance | null {
  const Library = lookup();
  if (!Library) return null;
  try {
    const cjs = new Library();
    // Stopping the cast must clear the object, or the next request never
    // reaches Chrome's picker again.
    cjs.on("disconnect", () => {
      instance = null;
    });
    return cjs;
  } catch {
    return null;
  }
}

/** Loads castjs once; it brings the Google Cast SDK with it. */
export function prepareCast(): Promise<boolean> {
  if (instance) return Promise.resolve(true);
  if (loading) return loading;

  loading = new Promise<boolean>((resolve) => {
    if (typeof window === "undefined" || !window.isSecureContext) {
      resolve(false);
      return;
    }
    const build = () => {
      instance = create();
      resolve(Boolean(instance));
    };

    if (lookup()) {
      build();
      return;
    }
    const script = document.createElement("script");
    script.src = LIB;
    script.async = true;
    script.onload = build;
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
    window.setTimeout(() => (lookup() ? build() : resolve(false)), 8000);
  });
  return loading;
}

export function castReady(): boolean {
  return Boolean(instance);
}

/** True while a television is actually playing: the local bar then drives it. */
export function isCasting(): boolean {
  return instance ? sessionAlive(instance) : false;
}

/** Volume and mute reach the television, not the paused local video. */
export function setCastVolume(value: number): void {
  try {
    instance?.volume?.(Math.min(1, Math.max(0, value)));
  } catch {
    // No session any more: nothing to send.
  }
}

export function setCastMuted(value: boolean): void {
  try {
    instance?.muted?.(value);
  } catch {
    // No session any more: nothing to send.
  }
}

/**
 * Second attempt, straight on the Cast framework: castjs can give up before the
 * browser has shown anything, and the picker is the same either way.
 */
export async function openCastPicker(): Promise<boolean> {
  try {
    const live = context();
    if (!live?.requestSession) return false;
    await Promise.race([
      live.requestSession(),
      new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("cast-timeout")), 15000)),
    ]);
    return instance ? sessionAlive(instance) : false;
  } catch {
    return false;
  }
}

interface CastRequest {
  title: string;
  poster?: string;
  startAt?: number;
  /** Moviez's own subtitle endpoint; only sent when it answered. */
  subtitles?: string;
}

async function hasSubtitles(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return false;
    return (await response.text()).startsWith("WEBVTT");
  } catch {
    return false;
  }
}

/** Opens Chrome's device list and sends the signed playlist. */
export async function castStream(url: string, options: CastRequest): Promise<boolean> {
  if (!instance) await prepareCast();
  if (!instance) return false;

  // After a cast is stopped the old object sits on a dead session; a new one
  // asks Chrome for the device list again.
  if (!sessionAlive(instance)) instance = create() ?? instance;
  const cjs = instance;
  if (!cjs) return false;

  const tracks: CastjsSubtitles[] = [];
  if (options.subtitles && (await hasSubtitles(options.subtitles))) {
    tracks.push({ label: "Français", src: options.subtitles, subtype: "SUBTITLES", active: true });
  }

  try {
    await Promise.race([
      Promise.resolve(
        cjs.cast(url, {
          title: options.title,
          description: "MetalFlix",
          poster: options.poster,
          time: Math.max(0, options.startAt ?? 0),
          paused: false,
          subtitles: tracks,
        }),
      ),
      new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("cast-timeout")), 15000)),
    ]);
    // castjs resolves even when no device answered: only a session proves it.
    for (let tryCount = 0; tryCount < 12; tryCount += 1) {
      if (sessionAlive(cjs)) return true;
      await new Promise((done) => window.setTimeout(done, 500));
    }
    return false;
  } catch {
    return sessionAlive(cjs);
  }
}
