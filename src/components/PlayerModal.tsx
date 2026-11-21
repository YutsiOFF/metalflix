import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Cast,
  Check,
  Film,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  API_BASE,
  LANG_LABEL,
  NoStreamError,
  PLAYER_PROXY,
  loadEpisodes,
  type EpisodeIndex,
  animeSamaInfoUrl,
  animeSamaPlayerUrl,
  checkTitle,
  playerUrl,
  resolveStream,
  type MoviezLang,
  type MoviezStream,
} from "../lib/moviez";
import {
  castReady,
  castStream,
  isCasting,
  onCastChange,
  setCastMuted,
  setCastVolume,
  prepareCast,
  stopCasting,
} from "../lib/cast";
import { loadDetails, type TitleDetails } from "../lib/details";
import Dropdown from "./Dropdown";
import { loadBackdrops } from "../lib/artwork";
import { GENRE_LABEL, type Category, type GenreKey } from "../lib/catalog";

export interface PlaySubject {
  id: number;
  type: "movie" | "series";
  title: string;
  poster?: string;
  year?: number | null;
  category?: Category;
  /** True for the anime shelf; drives which version opens first. */
  anime?: boolean;
  seasons?: number | null;
  languages?: string[];
  genres?: GenreKey[];
  /** Anime-Sama titles carry a slug instead of a TMDB id. */
  source?: "moviez" | "animesama";
  slug?: string;
}

interface PlayerModalProps {
  subject: PlaySubject;
  onClose: () => void;
  /**
   * Set when the viewer resumes from the resume rail: start on that episode, at
   * the position they had reached (a 0–1 ratio, resolved against the duration
   * when the stream reports it).
   */
  initial?: { season: number; episode: number; progress?: number };
  wanted?: boolean;
  done?: boolean;
  onToggleWatch?: (subject: PlaySubject) => void;
  onToggleDone?: () => void;
  onWatched?: (subject: PlaySubject, season: number, episode: number) => void;
  onProgress?: (update: { season: number; episode: number; ratio: number }) => void;
}

const PLAYABLE: MoviezLang[] = ["vf", "vo", "vostfr", "multi"];

/**
 * Which version opens by default. Anime are Japanese first: Moviez advertises
 * a French version for almost all of them, so trusting that label put "VF" on
 * episodes playing in Japanese. Films and series keep French as the default.
 */
function preferredLang(anime?: boolean): MoviezLang {
  return anime ? "vo" : "vf";
}

/**
 * iOS has no Google Cast in any browser: its picker is AirPlay, which reaches
 * Apple TV and recent Samsung/LG/Sony sets.
 */
const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** "Margot Robbie" → "MR": we have no actor portraits, only names. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((part) => /^[\p{L}\p{N}]/u.test(part))
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

export default function PlayerModal({
  subject,
  onClose,
  initial,
  wanted = false,
  done = false,
  onToggleWatch,
  onToggleDone,
  onWatched,
  onProgress,
}: PlayerModalProps) {
  /**
   * The sheet comes first — trailer, plot, cast, then "Lecture" — because that
   * is the moment where a title gets picked or dropped. Resuming from the rail
   * skips it: the viewer already chose this film and wants their episode.
   */
  const [stage, setStage] = useState<"detail" | "play">(initial ? "play" : "detail");
  const [season, setSeason] = useState(initial?.season ?? 1);
  const [episode, setEpisode] = useState(initial?.episode ?? 1);
  const [lang, setLang] = useState<MoviezLang>("vf");
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [live, setLive] = useState<{ seasons?: number; languages?: string[] }>({});
  const [asSeasons, setAsSeasons] = useState<{ saison: string; versions: string[] }[]>([]);
  /** Real episode list from Moviez (series only); null until it answers. */
  const [episodeIndex, setEpisodeIndex] = useState<EpisodeIndex | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [details, setDetails] = useState<TitleDetails | null>(null);
  const [backdrop, setBackdrop] = useState("");
  /** The trailer only plays when asked for, in its own layer (see sheet). */
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [checkTick, setCheckTick] = useState(0);
  // Signed HLS URL for the title being played; null while it is being fetched.
  const [source, setSource] = useState<MoviezStream | null>(null);
  const [sourceFail, setSourceFail] = useState(false);
  // True when the failure is not an outage: the source holds no file (yet).
  const [noStream, setNoStream] = useState(false);
  // Safari on iOS refuses a sounding autoplay without a gesture: the viewer
  // gets one button to start the film instead of a frozen first frame.
  const [blocked, setBlocked] = useState(false);
  // Mirrors the <video> element for our own control bar.
  /** True until the media is really AT the saved position: recording before
   *  that would overwrite a good position with the start of the file. */
  const pendingSeek = useRef(false);
  /** Set once playback has genuinely caught up with the saved position. */
  const caughtUp = useRef(false);
  /** The second the playback has to reach before a position may be recorded. */
  const resumeTarget = useRef<number | null>(null);
  const [play, setPlay] = useState({
    playing: false,
    current: 0,
    duration: 0,
    buffered: 0,
    muted: false,
    volume: 1,
    stalled: false,
  });
  // The bar fades out while the film runs and comes back on any movement.
  const [awake, setAwake] = useState(true);
  const sleepRef = useRef<number | null>(null);
  const ios = useMemo(isIOS, []);
  /** Name of the television playing this title, null when nothing is cast. */
  const [castDevice, setCastDevice] = useState<string | null>(null);
  /** iPhone/iPad: the cast button opens a small choice (AirPlay or Chromecast). */
  const [castMenu, setCastMenu] = useState(false);
  const [castCopied, setCastCopied] = useState(false);
  /** Set when the VLC link went nowhere: VLC is not installed on this iPhone. */
  const [vlcMissing, setVlcMissing] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const isSama = subject.source === "animesama" && Boolean(subject.slug);
  const isAnime = subject.anime ?? subject.category === "anime";

  // Keep the callback in a ref: App re-creates it on each render, and a new
  // dependency would re-record the same watch in a loop.
  const watchedRef = useRef(onWatched);
  watchedRef.current = onWatched;
  // `subject` is a fresh object on every App render, so recording keyed off it
  // fed setState → render → record → setState. The signature guard stops that.
  const recordedRef = useRef("");
  const progressRef = useRef(onProgress);
  progressRef.current = onProgress;

  /**
   * A stream that dies mid-film is usually not the title: our relay signs a
   * fresh playlist on every call, and those signatures expire. Asking again and
   * putting the viewer back at the same second repairs it — two attempts per
   * playback, then the error panel takes over.
   */
  const [reviving, setReviving] = useState(false);
  const reviveTries = useRef(0);
  /** The second the new playlist has to restart from. */
  const reviveAt = useRef<number | null>(null);
  const revive = () => {
    if (reviveTries.current >= 2) {
      setReviving(false);
      setSourceFail(true);
      return;
    }
    reviveTries.current += 1;
    const at = videoRef.current?.currentTime ?? 0;
    reviveAt.current = Number.isFinite(at) && at > 5 ? at : null;
    setReviving(true);
    setSource(null);
    setCheckTick((value) => value + 1);
  };

  // Each new episode or version gets its own two attempts.
  useEffect(() => {
    reviveTries.current = 0;
    reviveAt.current = null;
  }, [subject.id, season, episode, lang]);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    // Anime-Sama has no availability endpoint: the season list is the check.
    if (isSama) {
      fetch(animeSamaInfoUrl(subject.slug ?? ""), { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((data: { seasons?: { saison: string; versions: string[] }[] }) => {
          const seasons = data.seasons ?? [];
          setAsSeasons(seasons);
          setLang((seasons[0]?.versions?.[0] as MoviezLang) ?? "vostfr");
          setStatus(seasons.length ? "ready" : "unavailable");
        })
        .catch((error: unknown) => {
          if ((error as Error)?.name === "AbortError") return;
          setStatus("error");
        });
      return () => controller.abort();
    }
    checkTitle(subject.id, controller.signal)
      .then((data) => {
        if (!data.available) {
          setStatus("unavailable");
          return;
        }
        setLive({ seasons: data.seasons, languages: data.languages });
        const langs = (data.languages ?? []).filter((l): l is MoviezLang => PLAYABLE.includes(l as MoviezLang));
        // Moviez tags nearly every anime "vf" even when the only cut it serves
        // is the Japanese one with subtitles, so a French label was sitting on
        // Japanese audio. For anime the subtitled version wins when it exists;
        // the switch still offers VF for the titles that really have it.
        const preferred = preferredLang(isAnime);
        // Anime always play the original: the advertised list is what lied.
        setLang(isAnime ? "vo" : langs.includes(preferred) ? preferred : langs[0] ?? preferred);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if ((error as Error)?.name === "AbortError") return;
        setStatus("error");
      });
    return () => controller.abort();
  }, [isSama, subject.id, subject.slug]);

  useEffect(() => {
    setEpisodeIndex(null);
    if (subject.type !== "series" || isSama) return;
    let alive = true;
    loadEpisodes(subject.id)
      .then((index) => {
        if (alive && index.size) setEpisodeIndex(index);
      })
      .catch(() => {
        // No list: the old season/episode counters stay as the fallback.
      });
    return () => {
      alive = false;
    };
  }, [isSama, subject.id, subject.type]);

  // The sheet's text and trailer load in the background: the hero is already
  // worth looking at while they arrive.
  useEffect(() => {
    let alive = true;
    loadDetails({
      id: subject.id,
      title: subject.title,
      series: subject.type === "series",
      skipWiki: isSama,
    }).then((data) => {
      if (alive) setDetails(data);
    });
    // Anime-Sama ids are not TMDB ids: there is no backdrop to read.
    if (isSama) return () => {
      alive = false;
    };
    loadBackdrops([subject.id], subject.type === "series").then((map) => {
      if (alive) setBackdrop(map[String(subject.id)] ?? "");
    });
    return () => {
      alive = false;
    };
  }, [isSama, subject.id, subject.title, subject.type]);

  useEffect(() => {
    if (status !== "ready" || stage !== "play") return;
    const signature = `${subject.id}:${season}:${episode}`;
    if (recordedRef.current === signature) return;
    recordedRef.current = signature;
    watchedRef.current?.(subject, season, episode);
  }, [status, stage, season, episode, subject.id]);

  /**
   * Playback resolution: one relay call per playback, then the video streams
   * from Moviez's CDN. Anime-Sama keeps its own proxied page.
   *
   * Anime are played in `vo` and never in the "versions" the API advertises:
   * on Dragon Ball DAIMA, `vostfr` and `vf` hand back the very same file, and
   * that file is the unsubtitled one — the labels are shifted, and no French
   * audio exists at all. One honest version beats a menu that lies.
   */
  useEffect(() => {
    if (isSama || stage !== "play" || status !== "ready") return;
    const controller = new AbortController();
    const target = {
      id: subject.id,
      type: subject.type,
      season,
      episode,
      signal: controller.signal,
    };
    const wanted: MoviezLang = isAnime ? "vo" : lang;
    setSource(null);
    setSourceFail(false);
    setNoStream(false);
    setBlocked(false);
    resolveStream({ ...target, lang: wanted })
      .then((data) => {
        setReviving(false);
        setSource(data);
      })
      .catch((error: unknown) => {
        if ((error as Error)?.name === "AbortError") return;
        // No file at all is not an outage: asking again returns the same void.
        if (error instanceof NoStreamError) {
          setReviving(false);
          setNoStream(true);
          setSourceFail(true);
          return;
        }
        // A title or two only answers to `vostfr`; retry once before giving up.
        if (isAnime && wanted === "vo") {
          resolveStream({ ...target, lang: "vostfr" })
            .then((data) => {
              setReviving(false);
              setSource(data);
            })
            .catch(() => {
              setReviving(false);
              setSourceFail(true);
            });
          return;
        }
        // A signature that expired between the check and the handshake looks
        // exactly like a dead title: one silent re-ask tells them apart.
        if (reviveTries.current < 1) {
          revive();
          return;
        }
        setReviving(false);
        setSourceFail(true);
      });
    return () => controller.abort();
  }, [isAnime, isSama, stage, status, subject.id, subject.type, lang, season, episode, checkTick]);

  // The Cast SDK downloads and initializes while the film loads, so clicking
  // the Cast button opens Chrome's device list straight away. Doing it on the
  // click instead spends the user gesture Chrome requires, and nothing appears.
  useEffect(() => {
    if (ios || isSama || !source) return;
    void prepareCast();
  }, [ios, isSama, source]);

  useEffect(
    () =>
      onCastChange((device) => {
        setCastDevice(device);
        if (device) videoRef.current?.pause();
      }),
    [],
  );

  /**
   * The URL a television is given: the same playlist, through our Worker. A TV
   * (Chromecast receiver, Apple TV) asks the CDN from its own origin and
   * without our Referer, which the host answers with a refusal or its promo
   * reel; the Worker asks with Moviez's headers and adds open CORS.
   */
  const castUrl = source
    ? PLAYER_PROXY
      ? `${PLAYER_PROXY}/hls?u=${encodeURIComponent(source.hls)}`
      : source.hls
    : "";

  // AirPlay (Safari): when the picture leaves for an Apple TV, swap the element
  // onto the relayed URL at the same second, for the same reason as above.
  useEffect(() => {
    const video = videoRef.current as
      | (HTMLVideoElement & { webkitCurrentPlaybackTargetIsWireless?: boolean })
      | null;
    if (!video || !castUrl || !PLAYER_PROXY) return;
    const onTarget = () => {
      if (!video.webkitCurrentPlaybackTargetIsWireless) return;
      if (!video.src || video.src === castUrl || video.src.startsWith("blob:")) return;
      const at = video.currentTime;
      video.src = castUrl;
      const resume = () => {
        video.removeEventListener("loadedmetadata", resume);
        try {
          video.currentTime = at;
        } catch {
          // Not seekable yet: the TV starts at the beginning.
        }
        video.play().catch(() => {});
      };
      video.addEventListener("loadedmetadata", resume);
    };
    video.addEventListener("webkitcurrentplaybacktargetiswirelesschanged", onTarget);
    return () => video.removeEventListener("webkitcurrentplaybacktargetiswirelesschanged", onTarget);
  }, [castUrl]);

  /** Safari plays HLS itself; every other browser gets hls.js feeding the same
   *  video element, so the player and its controls are ours on every platform. */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source) return;
    let alive = true;
    let stop = () => {};
    // One revive per URL: a second error means the new URL is broken too.
    let dead = false;
    const reviveOnce = () => {
      if (dead) return;
      dead = true;
      revive();
    };

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = source.hls;
      video.play().catch(() => setBlocked(true));
      // Safari's own HLS stack reports an expired signature as a media error.
      video.addEventListener("error", reviveOnce);
      return () => {
        video.removeEventListener("error", reviveOnce);
        video.removeAttribute("src");
        video.load();
      };
    }

    import("hls.js")
      .then(({ default: Hls, FetchLoader }) => {
        if (!alive) return;
        if (!Hls.isSupported()) {
          setSourceFail(true);
          return;
        }
        let networkRetries = 0;
        const hls = new Hls({
          maxBufferLength: 40,
          // hls.js defaults to XHR, which ignores fetchSetup below.
          loader: FetchLoader,
          // uqload hotlink-protects its playlists: a foreign Referer earns a
          // promo reel instead of the film, and the browser caches that 302, so
          // every later attempt replays the promo. No referrer and no cache get
          // the real stream every time.
          fetchSetup: (context: { url: string }, init: RequestInit) =>
            new Request(context.url, { ...init, cache: "no-store", referrerPolicy: "no-referrer" }),
        });
        hls.loadSource(source.hls);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => setBlocked(true)));
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          // A stalled load or a broken frame is recoverable; a hostile playlist
          // is not, and then the embed is the only way left.
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            // One stalled segment deserves a plain retry; a signature that
            // expired answers 403 however often startLoad asks, so the URL is
            // what needs renewing.
            networkRetries += 1;
            if (networkRetries <= 2) {
              hls.startLoad();
              return;
            }
            reviveOnce();
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
            return;
          }
          setSourceFail(true);
        });
        stop = () => hls.destroy();
      })
      .catch(() => {
        if (alive) setSourceFail(true);
      });

    return () => {
      alive = false;
      stop();
    };
  }, [source]);

  // Resume where the viewer had stopped. The rail only stores a 0–1 ratio, so
  // the position is resolved once the stream announces its duration — the time
  // is unknown before that, and seeking early would be dropped.
  useEffect(() => {
    const video = videoRef.current;
    const ratio = initial?.progress ?? 0;
    if (!video || !source || ratio <= 0.01 || ratio >= 0.95) return;
    pendingSeek.current = true;
    caughtUp.current = false;
    resumeTarget.current = null;
    let applied = false;
    const seek = () => {
      if (applied || !Number.isFinite(video.duration) || video.duration <= 0) return;
      applied = true;
      const target = Math.max(0, Math.min(video.duration - 5, ratio * video.duration));
      resumeTarget.current = target;
      video.currentTime = target;
      // Still pending: the seek only counts once the media actually gets there.
    };
    seek();
    const events = ["loadedmetadata", "durationchange", "canplay"];
    events.forEach((type) => video.addEventListener(type, seek));
    return () => events.forEach((type) => video.removeEventListener(type, seek));
  }, [source, initial?.progress]);

  // Back to the same second after a regeneration: the new playlist is a
  // different file pointer, so playback would otherwise restart at 0:00.
  useEffect(() => {
    const video = videoRef.current;
    const target = reviveAt.current;
    if (!video || !source || target === null) return;
    reviveAt.current = null;
    pendingSeek.current = true;
    let applied = false;
    const seek = () => {
      if (applied || !Number.isFinite(video.duration) || video.duration <= 0) return;
      applied = true;
      video.currentTime = Math.min(target, video.duration - 5);
      video.play().catch(() => setBlocked(true));
    };
    const done = () => {
      pendingSeek.current = false;
      caughtUp.current = true;
    };
    seek();
    ["loadedmetadata", "canplay"].forEach((type) => video.addEventListener(type, seek));
    video.addEventListener("seeked", done);
    // A seek the element never confirms must not silence progress recording.
    const guard = window.setTimeout(done, 8000);
    return () => {
      ["loadedmetadata", "canplay"].forEach((type) => video.removeEventListener(type, seek));
      video.removeEventListener("seeked", done);
      window.clearTimeout(guard);
    };
  }, [source]);

  // Position now comes from our own video element, which is what fills the
  // "Reprendre votre visionnage" rail.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source) return;
    let last = 0;
    // Read from the props, not from the seek effect's refs: a first timeupdate
    // can arrive before that effect has run, and a 0.16 s reading overwrote a
    // real position.
    const wanted = (initial?.progress ?? 0) > 0.01 && (initial?.progress ?? 0) < 0.95;
    const onTime = () => {
      if (!caughtUp.current && wanted) {
        let target = resumeTarget.current;
        if (target === null && Number.isFinite(video.duration) && video.duration > 0) {
          // The seek effect missed the element (it mounted a tick later): the
          // jump is applied here, where the duration is finally known.
          target = Math.max(0, Math.min(video.duration - 5, (initial?.progress ?? 0) * video.duration));
          resumeTarget.current = target;
          video.currentTime = target;
          return;
        }
        if (target === null || video.currentTime < target - 8) return;
        caughtUp.current = true;
        pendingSeek.current = false;
      }
      if (pendingSeek.current) return;
      const now = Date.now();
      if (now - last < 5000) return;
      if (!video.duration || !Number.isFinite(video.duration)) return;
      last = now;
      // Only a film that really ended counts as finished: a seek into the
      // credits used to report 95 % and silently drop the title from
      // "Reprendre". The last 6 % stays "en cours" until the credits roll.
      const reached = Math.min(1, Math.max(0, video.currentTime / video.duration));
      const ratio = video.ended ? 1 : Math.min(0.94, reached);
      progressRef.current?.({ season, episode, ratio });
    };
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [source, season, episode, initial?.progress]);

  // The control bar reads the element, it never owns the truth: play, pause,
  // seeking inside the browser's own menus and AirPlay all show up here.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !source) return;
    const sync = () =>
      setPlay({
        playing: !video.paused && !video.ended,
        current: video.currentTime,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        buffered: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0,
        muted: video.muted || video.volume === 0,
        volume: video.muted ? 0 : video.volume,
        stalled: false,
      });
    const stall = () => setPlay((state) => ({ ...state, stalled: true }));
    const watched = ["timeupdate", "durationchange", "play", "pause", "ended", "volumechange", "progress"];
    watched.forEach((type) => video.addEventListener(type, sync));
    ["waiting", "seeking"].forEach((type) => video.addEventListener(type, stall));
    ["playing", "canplay", "seeked"].forEach((type) => video.addEventListener(type, sync));
    sync();
    return () => {
      watched.forEach((type) => video.removeEventListener(type, sync));
      ["waiting", "seeking"].forEach((type) => video.removeEventListener(type, stall));
      ["playing", "canplay", "seeked"].forEach((type) => video.removeEventListener(type, sync));
    };
  }, [source]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // A sheet scrolled down to the cast must not hand its scroll position to the
  // player: the stage swap starts at the top.
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
  }, [stage]);

  // Fullscreen applies to our own player box, not to the embed's own button: the
  // frame then gets the whole screen, so a phone held sideways plays sideways
  // instead of keeping a portrait box in the middle of the screen.
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Safari's own video fullscreen (the iPhone route) reports through its own
  // events, so the icon flips back when the viewer leaves it.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const enter = () => setFullscreen(true);
    const leave = () => setFullscreen(false);
    video.addEventListener("webkitbeginfullscreen", enter);
    video.addEventListener("webkitendfullscreen", leave);
    return () => {
      video.removeEventListener("webkitbeginfullscreen", enter);
      video.removeEventListener("webkitendfullscreen", leave);
    };
  }, [source]);

  // iPhone Safari exposes no element fullscreen at all (`fullscreenEnabled` is
  // false there), yet the <video> can still go fullscreen through WebKit. Keying
  // the button off document.fullscreenEnabled alone hid it on every iPhone.
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  useEffect(() => {
    setNativeFullscreen(
      typeof HTMLVideoElement !== "undefined" &&
        typeof (
          HTMLVideoElement.prototype as { webkitEnterFullscreen?: () => void }
        ).webkitEnterFullscreen === "function",
    );
  }, []);

  const canFullscreen =
    typeof document !== "undefined" &&
    (Boolean(document.fullscreenEnabled) || nativeFullscreen);

  const toggleFullscreen = async () => {
    const element = playerRef.current;
    const video = videoRef.current as
      | (HTMLVideoElement & {
          webkitEnterFullscreen?: () => void;
          webkitSupportsFullscreen?: boolean;
        })
      | null;
    if (!element) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (document.fullscreenEnabled) {
        await element.requestFullscreen();
        return;
      }
    } catch {
      // Fall through to the video's own fullscreen below.
    }
    // iPhone: our box cannot go fullscreen, so the film does it itself, in
    // Safari's player, from the exact second it was at.
    if (video?.webkitEnterFullscreen && video.webkitSupportsFullscreen !== false) {
      video.webkitEnterFullscreen();
      setFullscreen(true);
    }
  };

  /** Any movement wakes the bar; it fades again a few seconds later. */
  const wake = () => {
    setAwake(true);
    if (sleepRef.current) window.clearTimeout(sleepRef.current);
    sleepRef.current = window.setTimeout(() => setAwake(false), 3000);
  };

  useEffect(
    () => () => {
      if (sleepRef.current) window.clearTimeout(sleepRef.current);
    },
    [],
  );

  /** The play button always toggles, even when the bar had faded out. */
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => setBlocked(true));
    else video.pause();
    wake();
  };

  const onSurface = () => {
    const video = videoRef.current;
    if (!video) return;
    // A tap on a sleeping player only brings the controls back.
    if (!awake) {
      wake();
      return;
    }
    if (video.paused) video.play().catch(() => setBlocked(true));
    else video.pause();
    wake();
  };

  const skip = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const end = Number.isFinite(video.duration) ? video.duration - 0.4 : video.currentTime + delta;
    video.currentTime = Math.max(0, Math.min(end, video.currentTime + delta));
    wake();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const audible = !video.muted && video.volume > 0;
    // Coming back from zero: unmuting at 0 would still be silent.
    video.muted = audible;
    if (!audible && video.volume === 0) video.volume = 0.6;
    // A cast television plays instead of the local element: the bar has to
    // carry the order to the device, or the button does nothing at all.
    if (isCasting()) setCastMuted(audible);
    wake();
  };

  const setVolume = (value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = value;
    video.muted = value === 0;
    if (isCasting()) setCastVolume(value);
    wake();
  };

  /**
   * Casting, everywhere.
   *
   * Safari (iPhone, iPad, Mac) exposes AirPlay on the element; Chrome, Edge and
   * Android go through the Remote Playback API, which lists Chromecast and
   * Android TV devices. When neither is available — a browser with no device,
   * or a Firefox — the sheet explains the app route instead of a dead button.
   */
  const startCast = () => {
    const video = videoRef.current as (HTMLVideoElement & {
      webkitShowPlaybackTargetPicker?: () => void;
      remote?: { prompt?: () => Promise<void> };
    }) | null;
    if (!video || !source) return;

    // Already on a TV: the same button stops it and the film carries on here.
    if (castDevice) {
      const at = video.currentTime;
      stopCasting();
      setCastDevice(null);
      video.currentTime = at;
      video.play().catch(() => setBlocked(true));
      return;
    }

    // Chrome / Edge (computer) and Chrome on Android: Google Cast. The call
    // opens the device list right away, inside this click.
    if (!ios && castReady()) {
      const subtitles =
        subject.type === "series"
          ? `${API_BASE}/vtt/${subject.id}?lang=fr&s=${season}&e=${episode}`
          : `${API_BASE}/vtt/${subject.id}?lang=fr`;
      void castStream(castUrl, {
        title: subject.type === "series" ? `${subject.title} — S${season} É${episode}` : subject.title,
        poster: still || subject.poster || undefined,
        startAt: video.currentTime,
        subtitles: lang === "vostfr" || isAnime ? subtitles : undefined,
      }).then((ok) => {
        if (ok) video.pause();
      });
      return;
    }

    // iPhone / iPad: Apple keeps Google Cast out of every iOS browser, so the
    // button offers both routes — AirPlay here, Chromecast through VLC.
    if (ios) {
      setCastCopied(false);
      setVlcMissing(false);
      setCastMenu(true);
      return;
    }

    // Safari on Mac: the AirPlay list, on the playing element.
    if (typeof video.webkitShowPlaybackTargetPicker === "function") {
      try {
        video.webkitShowPlaybackTargetPicker();
        return;
      } catch {
        // Fall through to the standard API.
      }
    }
    // Any other browser that implements the Remote Playback API.
    video.remote?.prompt?.().catch(() => {});
  };

  /** iOS → AirPlay picker (Apple TV, AirPlay TVs). */
  const openAirPlay = () => {
    setCastMenu(false);
    const video = videoRef.current as (HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void }) | null;
    try {
      video?.webkitShowPlaybackTargetPicker?.();
    } catch {
      // No AirPlay on this device.
    }
  };

  /**
   * iOS → Chromecast. No iOS browser can talk to a Chromecast, but VLC can:
   * it opens the relayed stream and its cast button sends it to the TV.
   */
  const vlcLink = castUrl
    ? `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(castUrl)}&x-success=${encodeURIComponent(
        typeof window !== "undefined" ? window.location.href : "",
      )}`
    : "";

  /**
   * Safari cannot tell whether an app is installed: it just tries the link.
   * If VLC opens, the page goes to the background within a moment; if the
   * page is still on screen after that, VLC is missing and we say so (Safari
   * has then shown its own "adresse non valide" notice).
   */
  const openInVlc = () => {
    videoRef.current?.pause();
    let left = false;
    const onHide = () => {
      if (document.hidden) left = true;
    };
    document.addEventListener("visibilitychange", onHide);
    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", onHide);
      if (left) {
        setCastMenu(false);
        return;
      }
      setVlcMissing(true);
    }, 1800);
    window.location.href = vlcLink;
  };

  const copyStream = async () => {
    try {
      await navigator.clipboard.writeText(castUrl);
      setCastCopied(true);
    } catch {
      window.prompt("Lien du flux à coller dans une app de cast :", castUrl);
    }
  };

  /** "2:07" or "1:42:58" — the sheet already prints durations this way. */
  const clock = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return "0:00";
    const total = Math.floor(value);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, "0");
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
  };

  // The player page lives on the proxy origin and reports its position through
  // postMessage (see proxy/worker.js): a cross-origin frame has no other way to
  // tell the viewer's position back to us.
  useEffect(() => {
    if (!PLAYER_PROXY) return;
    let origin = "";
    try {
      origin = new URL(PLAYER_PROXY).origin;
    } catch {
      return;
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      const data = event.data as { source?: string; type?: string; path?: string; ratio?: number } | null;
      if (!data || data.source !== "metalflix-player" || data.type !== "progress") return;
      if (typeof data.ratio !== "number" || !Number.isFinite(data.ratio)) return;
      const match = /^\/p\/(?:serie\/(\d+)\/(\d+)\/(\d+)|(\d+))/.exec(data.path ?? "");
      if (!match) return;
      const id = Number(match[4] ?? match[1]);
      if (id !== subject.id) return;
      progressRef.current?.({
        season: match[2] ? Number(match[2]) : 1,
        episode: match[3] ? Number(match[3]) : 1,
        ratio: Math.min(1, Math.max(0, data.ratio)),
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [subject.id]);

  const languages = useMemo(() => {
    if (isSama) {
      const versions = asSeasons[season - 1]?.versions ?? asSeasons[0]?.versions ?? [];
      return (versions.length ? versions : ["vostfr"]) as MoviezLang[];
    }
    // Anime only have the Japanese cut, whatever the API claims.
    if (isAnime) return ["vo"] as MoviezLang[];
    const list = (live.languages ?? subject.languages ?? []).filter((l): l is MoviezLang =>
      PLAYABLE.includes(l as MoviezLang),
    );
    return list.length ? list : ([preferredLang(isAnime)] as MoviezLang[]);
  }, [asSeasons, isAnime, isSama, live.languages, season, subject.languages]);

  const seasonCount = isSama ? asSeasons.length || 1 : live.seasons ?? subject.seasons ?? 1;
  const seasons = Math.max(1, Math.min(seasonCount || 1, 60));

  /**
   * Seasons and episodes that really exist. With Moviez's list, an episode
   * that has not aired (no file yet) is simply absent; episodes are filtered
   * to the chosen version when that version has any in the season.
   */
  const seasonList = useMemo(() => {
    if (episodeIndex?.size) return [...episodeIndex.keys()].sort((a, b) => a - b);
    return Array.from({ length: seasons }, (_, i) => i + 1);
  }, [episodeIndex, seasons]);

  const episodesOf = (target: number): number[] => {
    const bySeason = episodeIndex?.get(target);
    if (!bySeason) return episodeIndex?.size ? [] : Array.from({ length: 30 }, (_, i) => i + 1);
    const wanted = lang === "vo" ? ["vo", "vostfr"] : [lang];
    const all = [...bySeason.keys()].sort((a, b) => a - b);
    const inLang = all.filter((value) => {
      const versions = bySeason.get(value);
      return !versions?.size || wanted.some((version) => versions.has(version));
    });
    return inLang.length ? inLang : all;
  };
  const episodeList = episodesOf(season);

  /** The episode after this one: next in the season, else the next season's first. */
  const nextEpisode = useMemo(() => {
    if (subject.type !== "series") return null;
    const later = episodeList.find((value) => value > episode);
    if (later) return { season, episode: later };
    const nextSeason = seasonList.find((value) => value > season);
    if (!nextSeason) return episodeIndex?.size ? null : { season, episode: episode + 1 };
    const first = episodesOf(nextSeason)[0];
    return first ? { season: nextSeason, episode: first } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode, episodeIndex, episodeList.join(","), lang, season, seasonList, subject.type]);

  // Keep the choice on something that exists once the real list is known (or
  // after a language switch): a resumed S2E5 stays, a phantom E24 does not.
  useEffect(() => {
    if (!episodeIndex?.size || subject.type !== "series") return;
    if (!seasonList.includes(season)) {
      setSeason(seasonList[0]);
      return;
    }
    if (episodeList.length && !episodeList.includes(episode)) setEpisode(episodeList[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeIndex, season, episode, lang]);

  const goNext = () => {
    if (!nextEpisode) return;
    setSeason(nextEpisode.season);
    setEpisode(nextEpisode.episode);
  };
  const currentSeason = asSeasons[season - 1];
  const src = isSama
    ? animeSamaPlayerUrl({
        slug: subject.slug ?? "",
        saison: currentSeason?.saison ?? "saison1",
        version: lang,
        episode,
      })
    : playerUrl({ id: subject.id, type: subject.type, lang, season, episode });

  const kind = subject.category === "anime" ? "Anime" : subject.type === "series" ? "Série" : "Film";
  const trailer = details?.trailer ?? "";
  // No trailer playing behind the sheet any more (YouTube slipped its ads in
  // there): the backdrop drifts instead, and the trailer opens on demand.
  const trailerSrc = trailer
    ? `https://www.youtube-nocookie.com/embed/${trailer}?autoplay=1&modestbranding=1&rel=0&playsinline=1&iv_load_policy=3`
    : "";
  const still = backdrop || (subject.poster ? subject.poster.replace("/w500/", "/original/") : "");

  // The player page lives on metered hosting: when its daily allowance is
  // spent, the platform answers with an English 429 page and there is nothing
  // inside the frame to read. One cheap call to the proxy's health route tells
  // us first, so the viewer gets a French explanation instead of that page.
  useEffect(() => {
    // Only Anime-Sama still plays through the proxy; Moviez pages play on their
    // own origin, so there is no allowance to run out of.
    if (!PLAYER_PROXY || !isSama) {
      setReachable(null);
      return;
    }
    let alive = true;
    setReachable(null);
    fetch(`${PLAYER_PROXY}/health`, { cache: "no-store" })
      .then((res) => {
        if (alive) setReachable(res.ok);
      })
      .catch(() => {
        if (alive) setReachable(false);
      });
    return () => {
      alive = false;
    };
  }, [src, checkTick, isSama]);

  const genreNames = (subject.genres ?? []).slice(0, 3).map((key) => GENRE_LABEL[key]);

  const sheet = (
    <div className="mf-detail">
      <div className="mf-detail__hero">
        {still ? <img className="mf-detail__still" src={still} alt="" decoding="async" /> : null}
        <div className="mf-detail__shade" aria-hidden="true" />

        <button type="button" className="mf-detail__close" onClick={onClose} aria-label="Fermer">
          <X size={18} />
        </button>

        <div className="mf-detail__headline">
          <div className="mf-detail__tags">
            <span className="mf-detail__tag mf-detail__tag--kind">{kind}</span>
            {subject.year ? <span className="mf-detail__tag">{subject.year}</span> : null}
            {details?.runtime ? <span className="mf-detail__tag">{details.runtime}</span> : null}
            {genreNames.map((name) => (
              <span key={name} className="mf-detail__genre">
                {name}
              </span>
            ))}
          </div>
          <h2 className="mf-detail__title">{subject.title}</h2>
          <div className="mf-detail__actions">
            <button
              type="button"
              className="mf-btn mf-btn--primary mf-detail__play"
              onClick={() => setStage("play")}
              disabled={status === "unavailable"}
            >
              <Play size={19} strokeWidth={2.4} />
              {status === "unavailable" ? "Indisponible" : initial ? "Reprendre" : "Lecture"}
            </button>
            {trailerSrc ? (
              <button type="button" className="mf-btn mf-detail__ghost" onClick={() => setTrailerOpen(true)}>
                <Film size={17} /> Bande-annonce
              </button>
            ) : null}
            {onToggleWatch ? (
              <button
                type="button"
                className={`mf-detail__round${wanted ? " is-on" : ""}`}
                aria-pressed={wanted}
                onClick={() => onToggleWatch(subject)}
                title={wanted ? "Retirer de ma liste" : "Ajouter à ma liste"}
                aria-label={wanted ? "Retirer de ma liste" : "Ajouter à ma liste"}
              >
                {wanted ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
              </button>
            ) : null}
            {onToggleDone ? (
              <button
                type="button"
                className={`mf-detail__round${done ? " is-on" : ""}`}
                aria-pressed={done}
                onClick={onToggleDone}
                title={done ? "Marquer comme non vu" : "Marquer comme vu"}
                aria-label={done ? "Marquer comme non vu" : "Marquer comme vu"}
              >
                <Check size={18} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mf-detail__body">
        <div className="mf-detail__main">
          <section>
            <h3 className="mf-detail__h3">Synopsis</h3>
            {details ? (
              details.plot ? (
                <p className="mf-detail__plot">{details.plot}</p>
              ) : (
                <p className="mf-detail__plot mf-detail__plot--empty">
                  Aucun synopsis publié pour ce titre. Il reste disponible dans le lecteur.
                </p>
              )
            ) : (
              <div className="mf-skeleton" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            )}
          </section>

          {details?.credits.length ? (
            <section className="mf-detail__cast">
              <h3 className="mf-detail__h3">Casting</h3>
              <ul className="mf-castrow">
                {details.credits.map((credit) => (
                  <li key={`${credit.name}:${credit.role}`} className="mf-person">
                    <span className="mf-person__face">
                      {credit.photo ? (
                        <img src={credit.photo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                      ) : (
                        <span aria-hidden="true">{initials(credit.name)}</span>
                      )}
                    </span>
                    <strong className="mf-person__name">{credit.name}</strong>
                    {credit.role ? <span className="mf-person__role">{credit.role}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="mf-detail__side">
          <dl>
            {details?.director ? (
              <div>
                <dt>Réalisation</dt>
                <dd>{details.director}</dd>
              </div>
            ) : null}
            {subject.genres?.length ? (
              <div>
                <dt>Genres</dt>
                <dd>{subject.genres.map((key) => GENRE_LABEL[key]).join(", ")}</dd>
              </div>
            ) : null}
            {subject.year ? (
              <div>
                <dt>Année</dt>
                <dd>{subject.year}</dd>
              </div>
            ) : null}
            {details?.runtime ? (
              <div>
                <dt>Durée</dt>
                <dd>{details.runtime}</dd>
              </div>
            ) : null}
            <div>
              <dt>Source</dt>
              <dd>{isSama ? "Anime-Sama" : "Moviez"}</dd>
            </div>
          </dl>
        </aside>
      </div>

      {trailerOpen && trailerSrc ? (
        <div className="mf-trailer" role="dialog" aria-label={`Bande-annonce de ${subject.title}`}>
          <button type="button" className="mf-trailer__backdrop" aria-label="Fermer" onClick={() => setTrailerOpen(false)} />
          <div className="mf-trailer__box">
            <button
              type="button"
              className="mf-trailer__close"
              onClick={() => setTrailerOpen(false)}
              aria-label="Fermer la bande-annonce"
            >
              <X size={18} />
            </button>
            <iframe
              src={trailerSrc}
              title={`Bande-annonce de ${subject.title}`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        </div>
      ) : null}
    </div>
  );

  const player = (
    <div className="mf-play">
      <header className="mf-play__head">
        <button
          type="button"
          className="mf-play__back"
          onClick={() => setStage("detail")}
          aria-label="Retour à la fiche"
          title="Retour à la fiche"
        >
          <ArrowLeft size={18} />
        </button>

        <div className="mf-play__id">
          <p className="mf-play__eyebrow">
            {kind}
            {subject.year ? ` · ${subject.year}` : ""} · {isSama ? "Anime-Sama" : "Moviez"}
          </p>
          <h2 className="mf-play__title">{subject.title}</h2>
          <p className="mf-play__now">
            <span className="mf-play__live" aria-hidden="true" />
            {subject.type === "series" ? `Saison ${season} · Épisode ${episode}` : "Film complet"}
            <span className="mf-dot" />
            {LANG_LABEL[lang] ?? lang.toUpperCase()}
          </p>
        </div>

        <div className="mf-play__tools">
          {canFullscreen ? (
            <button
              type="button"
              className="mf-play__tool"
              onClick={toggleFullscreen}
              aria-pressed={fullscreen}
              title={fullscreen ? "Réduire" : "Plein écran"}
            >
              {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              <span>{fullscreen ? "Réduire" : "Plein écran"}</span>
            </button>
          ) : null}
          {onToggleWatch ? (
            <button
              type="button"
              className={`mf-play__tool${wanted ? " is-on" : ""}`}
              aria-pressed={wanted}
              onClick={() => onToggleWatch(subject)}
              title={wanted ? "Retirer de ma liste" : "Ajouter à ma liste"}
            >
              {wanted ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
              <span>{wanted ? "Dans ma liste" : "Ma liste"}</span>
            </button>
          ) : null}
          {onToggleDone ? (
            <button
              type="button"
              className={`mf-play__tool${done ? " is-on" : ""}`}
              aria-pressed={done}
              onClick={onToggleDone}
              title={done ? "Marquer comme non vu" : "Marquer comme vu"}
            >
              <Check size={16} />
              <span>{done ? "Vu" : "J'ai terminé"}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="mf-play__tool mf-play__tool--close"
            onClick={onClose}
            title="Fermer"
            aria-label="Fermer"
          >
            <X size={16} />
            <span>Fermer</span>
          </button>
        </div>
      </header>

      <div className="mf-player" ref={playerRef} onPointerMove={wake} onTouchStart={wake}>
        {status === "loading" && (
          <div className="mf-player__state">
            <div className="mf-loader" aria-hidden="true" />
            <p>Vérification de la disponibilité…</p>
          </div>
        )}
        {status === "unavailable" && (
          <div className="mf-player__state">
            <h3>Titre indisponible</h3>
            <p>Moviez ne sert pas encore ce titre. Essayez un autre film ou une autre langue.</p>
          </div>
        )}
        {status === "error" && (
          <div className="mf-player__state">
            <h3>Lecteur injoignable</h3>
            <p>Le lecteur n'a pas répondu. Réessayez dans un instant.</p>
          </div>
        )}
        {status === "ready" && reachable !== false && !isSama && !source && !sourceFail ? (
          <div className="mf-player__state">
            <div className="mf-loader" aria-hidden="true" />
            <p>{reviving ? "Reconnexion au flux…" : "Préparation du flux…"}</p>
          </div>
        ) : null}
        {/* Played here, on our own page: the signed playlist and its segments
            come straight from Moviez's CDN, which allows our origin. */}
        {source && !sourceFail ? (
          <video
            ref={videoRef}
            className="mf-player__video"
            poster={still || undefined}
            playsInline
            autoPlay
            preload="metadata"
            crossOrigin="anonymous"
            x-webkit-airplay="allow"
            title={`Lecteur ${subject.title}`}
            onClick={onSurface}
            onPlay={() => setBlocked(false)}
          />
        ) : null}
        {/* Our own bar, in the site's colours: the native chrome is the one
            thing that made the player look like somebody else's. */}
        {source && !sourceFail ? (
          <div className={`mf-skin${awake || !play.playing ? "" : " is-idle"}`}>
            {play.stalled ? <div className="mf-skin__spin" aria-hidden="true" /> : null}
            <div className="mf-skin__bar">
              <button
                type="button"
                className="mf-skin__btn mf-skin__btn--play"
                onClick={togglePlay}
                aria-label={play.playing ? "Pause" : "Lecture"}
              >
                {play.playing ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <span className="mf-skin__time">{clock(play.current)}</span>
              <input
                type="range"
                className="mf-skin__range"
                min={0}
                max={play.duration || 0}
                step={0.1}
                value={Math.min(play.current, play.duration || 0)}
                style={
                  {
                    "--mf-fill": `${play.duration ? Math.min(100, (play.current / play.duration) * 100) : 0}%`,
                    "--mf-buf": `${play.duration ? Math.min(100, (play.buffered / play.duration) * 100) : 0}%`,
                  } as CSSProperties
                }
                onChange={(event) => {
                  const video = videoRef.current;
                  if (video) video.currentTime = Number(event.target.value);
                  wake();
                }}
                aria-label="Avancement de la lecture"
              />
              <span className="mf-skin__time mf-skin__time--total">{clock(play.duration)}</span>
              {/* The two skips sit together, either side of the play button. */}
              <div className="mf-skin__skips">
                <button
                  type="button"
                  className="mf-skin__btn"
                  onClick={() => skip(-10)}
                  aria-label="Reculer de 10 secondes"
                  title="Reculer de 10 secondes"
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  type="button"
                  className="mf-skin__btn"
                  onClick={() => skip(10)}
                  aria-label="Avancer de 10 secondes"
                  title="Avancer de 10 secondes"
                >
                  <RotateCw size={16} />
                </button>
              </div>
              <div className="mf-skin__vol">
                <button
                  type="button"
                  className="mf-skin__btn"
                  onClick={toggleMute}
                  aria-label={play.muted ? "Activer le son" : "Couper le son"}
                  title={play.muted ? "Activer le son" : "Couper le son"}
                >
                  {play.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
                </button>
                {/* iOS ignores a media element's volume (hardware keys only),
                    so the fader is only offered where it actually works. */}
                {ios ? null : (
                  <input
                    type="range"
                    className="mf-skin__volume"
                    min={0}
                    max={1}
                    step={0.05}
                    value={play.muted ? 0 : play.volume}
                    style={
                      { "--mf-fill": `${Math.round((play.muted ? 0 : play.volume) * 100)}%` } as CSSProperties
                    }
                    onChange={(event) => setVolume(Number(event.target.value))}
                    aria-label="Volume"
                  />
                )}
              </div>
              <button
                type="button"
                className={`mf-skin__btn mf-skin__btn--cast${castDevice ? " is-on" : ""}`}
                onClick={startCast}
                aria-label={castDevice ? `Arrêter la lecture sur ${castDevice}` : "Caster sur la télévision"}
                title={castDevice ? `Arrêter la lecture sur ${castDevice}` : "Caster sur la télévision (Chromecast, AirPlay)"}
              >
                <Cast size={17} />
              </button>
              {canFullscreen ? (
                <button
                  type="button"
                  className="mf-skin__btn mf-skin__btn--fs"
                  onClick={toggleFullscreen}
                  aria-label={fullscreen ? "Réduire" : "Plein écran"}
                  title={fullscreen ? "Réduire" : "Plein écran"}
                >
                  {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {/* « Épisode suivant » sur l'image : il apparaît avec les commandes
            (souris qui bouge, doigt qui touche l'écran) et reste affiché sur
            la dernière minute et le générique de fin. */}
        {subject.type === "series" && nextEpisode && ((source && !sourceFail) || isSama) ? (
          <button
            type="button"
            className={`mf-player__next${
              isSama ||
              awake ||
              !play.playing ||
              (play.duration > 0 && play.duration - play.current < 90)
                ? " is-visible"
                : ""
            }${play.duration > 0 && play.duration - play.current < 90 ? " is-ending" : ""}`}
            onClick={goNext}
          >
            <SkipForward size={18} />
            <span>
              Épisode suivant
              <small>
                S{nextEpisode.season} · É{nextEpisode.episode}
              </small>
            </span>
          </button>
        ) : null}
        {castMenu && source && !sourceFail ? (
          <div className="mf-castmenu" role="dialog" aria-label="Caster sur la télévision">
            <button
              type="button"
              className="mf-castmenu__close"
              onClick={() => setCastMenu(false)}
              aria-label="Fermer"
            >
              <X size={18} />
            </button>
            <h3>Caster sur la télé</h3>
            <button type="button" className="mf-castmenu__opt" onClick={openAirPlay}>
              <Cast size={22} />
              <span>
                <strong>AirPlay</strong>
                <small>Apple TV, télé Samsung / LG / Sony compatibles</small>
              </span>
            </button>
            <button type="button" className="mf-castmenu__opt" onClick={openInVlc}>
              <Cast size={22} />
              <span>
                <strong>Chromecast</strong>
                <small>S'ouvre dans l'app VLC : touche l'icône cast en haut, choisis ta Chromecast</small>
              </span>
            </button>
            {vlcMissing ? (
              <div className="mf-castmenu__missing" role="alert">
                <p>
                  VLC n'est pas installé sur cet iPhone. Apple bloque le Chromecast dans Safari : c'est l'app VLC
                  (gratuite) qui fait le lien avec la télé.
                </p>
                <a
                  className="mf-btn mf-btn--primary"
                  href="https://apps.apple.com/app/vlc-media-player/id650377962"
                  target="_blank"
                  rel="noreferrer"
                >
                  Installer VLC
                </a>
              </div>
            ) : null}
            <p className="mf-castmenu__note">
              Pas encore VLC ?{" "}
              <a href="https://apps.apple.com/app/vlc-media-player/id650377962" target="_blank" rel="noreferrer">
                L'installer (gratuit)
              </a>{" "}
              ·{" "}
              <button type="button" onClick={copyStream}>
                {castCopied ? "Lien copié ✓" : "Copier le lien du flux"}
              </button>
            </p>
          </div>
        ) : null}
        {castDevice && source && !sourceFail ? (
          <div className="mf-player__casting" role="status">
            <Cast size={34} strokeWidth={1.6} />
            <p>
              Lecture sur <strong>{castDevice}</strong>
            </p>
            <button type="button" className="mf-btn" onClick={startCast}>
              Reprendre ici
            </button>
          </div>
        ) : null}
        {blocked && source && !sourceFail ? (
          <button
            type="button"
            className="mf-player__launch"
            onClick={() => {
              videoRef.current?.play().catch(() => {});
              setBlocked(false);
            }}
          >
            <Play size={22} strokeWidth={2.4} />
            Lancer la lecture
          </button>
        ) : null}
        {/* Anime-Sama only: that page is our own, served by the Worker. A film
            never falls back to a foreign player — the site keeps its own. */}
        {status === "ready" && reachable !== false && isSama ? (
          <iframe
            key={src}
            ref={frameRef}
            className="mf-player__frame"
            src={src}
            title={`Lecteur ${subject.title}`}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-presentation allow-orientation-lock"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture; remote-playback"
            allowFullScreen
            referrerPolicy="no-referrer"
          />
        ) : null}
        {status === "ready" && reachable !== false && sourceFail && !isSama ? (
          <div className="mf-player__state">
            <h3>{noStream ? "Aucun fichier pour ce titre" : "Source indisponible"}</h3>
            <p>
              {noStream
                ? "La source ne propose aucun fichier pour ce titre : ce n'est pas une panne passagère, réessayer n'y changera rien pour le moment."
                : "Le flux n'a pas pu être récupéré à l'instant. Réessaie dans un moment."}
            </p>
            {noStream ? null : (
              <button
                type="button"
                className="mf-btn"
                onClick={() => {
                  reviveTries.current = 0;
                  reviveAt.current = null;
                  setSourceFail(false);
                  setCheckTick((value) => value + 1);
                }}
              >
                Réessayer
              </button>
            )}
          </div>
        ) : null}
        {status === "ready" && reachable === false ? (
          <div className="mf-player__state">
            <h3>Lecteur indisponible pour le moment</h3>
            <p>
              L'hébergement du lecteur a atteint sa limite de la journée. La lecture revient d'elle-même après la
              remise à zéro, vers 00:00 UTC — le catalogue reste utilisable en attendant.
            </p>
            <button type="button" className="mf-btn" onClick={() => setCheckTick((value) => value + 1)}>
              Réessayer
            </button>
          </div>
        ) : null}
      </div>

      <footer className="mf-play__bar">
        {/* Same drawn menus as the header filters: the native pickers drew a
            grey Windows list with a blue bar over the film. */}
        {subject.type === "series" && (
          <div className="mf-play__pick">
            <Dropdown
              label="Saison"
              value={String(season)}
              options={seasonList.map((value) => ({ value: String(value), label: `Saison ${value}` }))}
              onChange={(value) => {
                const next = Number(value);
                setSeason(next);
                setEpisode(episodesOf(next)[0] ?? 1);
              }}
            />
          </div>
        )}
        {subject.type === "series" && (
          <div className="mf-play__pick">
            <Dropdown
              label="Épisode"
              value={String(episode)}
              options={episodeList.map((value) => ({ value: String(value), label: `Épisode ${value}` }))}
              onChange={(value) => setEpisode(Number(value))}
            />
          </div>
        )}
        <div className="mf-play__pick">
          <Dropdown
            label="Langue"
            value={lang}
            options={languages.map((value) => ({ value, label: LANG_LABEL[value] ?? value.toUpperCase() }))}
            onChange={(value) => setLang(value as MoviezLang)}
          />
        </div>

        {subject.type === "series" && nextEpisode ? (
          <button type="button" className="mf-btn mf-play__next" onClick={goNext}>
            <SkipForward size={16} /> Épisode suivant
          </button>
        ) : null}

        <p className="mf-play__hint">
          {isSama ? "Flux Anime-Sama" : "Lecteur MetalFlix"}
          <span className="mf-dot" />
          {status === "loading"
            ? "Connexion…"
            : status === "ready" && reachable !== false
              ? "Lecture prête"
              : "Indisponible"}
        </p>
      </footer>
    </div>
  );

  return (
    <div className="mf-modal" role="dialog" aria-modal="true" aria-label={`${subject.title} — fiche et lecteur`}>
      <button type="button" className="mf-modal__backdrop" aria-label="Fermer" onClick={onClose} />
      <div
        ref={panelRef}
        className={`mf-modal__panel${stage === "detail" ? " mf-modal__panel--detail" : " mf-modal__panel--play"}`}
      >
        {stage === "detail" ? sheet : player}
      </div>
    </div>
  );
}
