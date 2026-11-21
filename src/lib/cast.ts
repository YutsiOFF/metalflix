/**
 * Chromecast / Android TV / Google TV, straight on Google's Cast framework.
 *
 * Works in Chrome and Edge on a computer, and in Chrome on Android. (iPhone and
 * Safari have no Google Cast at all: they use AirPlay, see PlayerModal.)
 *
 * Two rules make it work where the castjs wrapper used to fail silently:
 *  1. The device list is opened by `requestSession()` called *inside* the click,
 *     before anything is awaited — Chrome only shows the picker on a gesture.
 *  2. The television is handed the playlist through our Worker (/hls), which
 *     sends Moviez's own Referer and `access-control-allow-origin: *`. The
 *     Default Media Receiver runs on gstatic.com: given the raw CDN URL it gets
 *     either a CORS refusal or the host's promo reel, and stays on its logo.
 */

const SDK = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

/* Minimal typings for the parts of the Cast SDK we touch. */
interface CastSessionLike {
  getCastDevice?(): { friendlyName?: string } | undefined;
  loadMedia(request: unknown): Promise<unknown>;
  setVolume?(value: number): Promise<unknown>;
  setMute?(value: boolean): Promise<unknown>;
}

interface CastContextLike {
  setOptions(options: Record<string, unknown>): void;
  requestSession(): Promise<unknown>;
  getCurrentSession(): CastSessionLike | null;
  getSessionState?(): string;
  addEventListener(type: string, listener: (event: { sessionState?: string }) => void): void;
  endCurrentSession?(stop: boolean): void;
}

type CastObject = Record<string, unknown>;

type ChromeCast = {
  media: {
    DEFAULT_MEDIA_RECEIVER_APP_ID: string;
    MediaInfo: new (contentId: string, contentType: string) => CastObject;
    GenericMediaMetadata: new () => CastObject;
    LoadRequest: new (info: unknown) => CastObject;
    Track: new (id: number, type: string) => CastObject;
    StreamType: { BUFFERED: string };
    TrackType: { TEXT: string };
    TextTrackType: { SUBTITLES: string };
    HlsSegmentFormat?: { TS: string };
  };
  Image: new (url: string) => unknown;
  AutoJoinPolicy: { ORIGIN_SCOPED: string };
};

type CastWindow = Window & {
  __onGCastApiAvailable?: (available: boolean) => void;
  cast?: {
    framework?: {
      CastContext: { getInstance(): CastContextLike };
      CastContextEventType: { SESSION_STATE_CHANGED: string };
    };
  };
  chrome?: { cast?: ChromeCast };
};

let ready = false;
let loading: Promise<boolean> | null = null;
const listeners = new Set<(device: string | null) => void>();

function framework() {
  return (window as CastWindow).cast?.framework;
}

function chromeCast(): ChromeCast | undefined {
  return (window as CastWindow).chrome?.cast;
}

function context(): CastContextLike | null {
  try {
    return framework()?.CastContext.getInstance() ?? null;
  } catch {
    return null;
  }
}

function deviceName(): string | null {
  const session = context()?.getCurrentSession();
  if (!session) return null;
  return session.getCastDevice?.()?.friendlyName || "la télévision";
}

function notify() {
  const name = isCasting() ? deviceName() : null;
  listeners.forEach((listener) => listener(name));
}

/** Loads the Cast SDK once, early (when a film starts), so the click is instant. */
export function prepareCast(): Promise<boolean> {
  if (ready) return Promise.resolve(true);
  if (loading) return loading;

  loading = new Promise<boolean>((resolve) => {
    if (typeof window === "undefined" || !window.isSecureContext) {
      resolve(false);
      return;
    }
    const win = window as CastWindow;
    const init = () => {
      const fw = framework();
      const cc = chromeCast();
      const live = context();
      if (!fw || !cc || !live) {
        resolve(false);
        return;
      }
      try {
        live.setOptions({
          receiverApplicationId: cc.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: cc.AutoJoinPolicy.ORIGIN_SCOPED,
        });
        live.addEventListener(fw.CastContextEventType.SESSION_STATE_CHANGED, notify);
        ready = true;
        resolve(true);
      } catch {
        resolve(false);
      }
    };

    if (framework() && chromeCast()?.media) {
      init();
      return;
    }
    win.__onGCastApiAvailable = (available) => (available ? init() : resolve(false));
    const script = document.createElement("script");
    script.src = SDK;
    script.async = true;
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
    // Firefox, Safari: the SDK loads but never reports a Cast-capable browser.
    window.setTimeout(() => resolve(ready), 10000);
  });
  return loading;
}

export function castReady(): boolean {
  return ready;
}

/** True while a television holds a session started from this site. */
export function isCasting(): boolean {
  const live = context();
  if (!ready || !live?.getCurrentSession()) return false;
  const state = String(live.getSessionState?.() ?? "SESSION_STARTED");
  return state === "SESSION_STARTED" || state === "SESSION_RESUMED";
}

/** Called with the device name when a cast starts, and with null when it ends. */
export function onCastChange(listener: (device: string | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setCastVolume(value: number): void {
  try {
    void context()?.getCurrentSession()?.setVolume?.(Math.min(1, Math.max(0, value)));
  } catch {
    // No session any more: nothing to send.
  }
}

export function setCastMuted(value: boolean): void {
  try {
    void context()?.getCurrentSession()?.setMute?.(value);
  } catch {
    // No session any more: nothing to send.
  }
}

/** Ends the cast and stops the television. */
export function stopCasting(): void {
  try {
    context()?.endCurrentSession?.(true);
  } catch {
    // Already gone.
  }
}

interface CastRequest {
  title: string;
  poster?: string;
  startAt?: number;
  /** Moviez's own subtitle endpoint; only attached when it really answers. */
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

/**
 * Opens the device list (synchronously, inside the click) and, once a
 * television is picked, sends it the playlist. Resolves true when the
 * television accepted the media.
 */
export function castStream(url: string, options: CastRequest): Promise<boolean> {
  const live = context();
  const cc = chromeCast();
  if (!ready || !live || !cc) return Promise.resolve(false);

  // The picker must open now, while the click still counts as a gesture.
  const session = live.getCurrentSession() ? Promise.resolve() : live.requestSession();

  return session
    .then(async () => {
      const current = live.getCurrentSession();
      if (!current) return false;

      const info = new cc.media.MediaInfo(url, "application/x-mpegURL");
      info.streamType = cc.media.StreamType.BUFFERED;
      if (cc.media.HlsSegmentFormat) info.hlsSegmentFormat = cc.media.HlsSegmentFormat.TS;
      const metadata = new cc.media.GenericMediaMetadata();
      metadata.title = options.title;
      metadata.subtitle = "MetalFlix";
      if (options.poster) metadata.images = [new cc.Image(options.poster)];
      info.metadata = metadata;

      const request = new cc.media.LoadRequest(info);
      request.autoplay = true;
      request.currentTime = Math.max(0, options.startAt ?? 0);

      if (options.subtitles && (await hasSubtitles(options.subtitles))) {
        const track = new cc.media.Track(1, cc.media.TrackType.TEXT);
        track.trackContentId = options.subtitles;
        track.trackContentType = "text/vtt";
        track.subtype = cc.media.TextTrackType.SUBTITLES;
        track.name = "Français";
        track.language = "fr";
        info.tracks = [track];
        request.activeTrackIds = [1];
      }

      await current.loadMedia(request);
      notify();
      return true;
    })
    .catch(() => false);
}
