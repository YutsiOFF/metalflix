import { useEffect, useRef, useState, type CSSProperties, type FocusEvent } from "react";
import { ChevronLeft, ChevronRight, Play, Sparkles } from "lucide-react";
import type { Title } from "../lib/catalog";
import { GENRE_LABEL } from "../lib/catalog";
import { loadBackdrops } from "../lib/artwork";
import { loadSynopses } from "../lib/synopsis";

interface HeroProps {
  items: Title[];
  onPlay: (item: Title) => void;
}

const ROTATE_MS = 9000;

/** Moviez only stores w500 posters; the untouched file is the sharp one. */
const fullSize = (poster: string) => poster.replace("/w500/", "/original/");

/**
 * One title at a time, full width behind the headline, with the film's real
 * 16:9 backdrop when Moviez's viewer page exposes it — a portrait poster
 * cropped into a banner cuts faces in half. The image fades out towards the
 * bottom so the hero melts into the page instead of ending on a hard edge.
 *
 * The dots sit in the middle of the hero and the active one fills over the same
 * interval as the rotation, so the change is expected instead of sudden.
 */
export default function Hero({ items, onPlay }: HeroProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [backdrops, setBackdrops] = useState<Record<string, string>>({});
  const [synopses, setSynopses] = useState<Record<number, string>>({});
  const count = items.length;

  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  // A hidden tab stops the clock too, so the bar and the slide stay together.
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  /**
   * One timeout per slide, restarted whenever the slide changes and resumed
   * (not restarted) after a pause. The old setInterval ignored dot clicks and
   * restarted on every hover, so the red bar could finish while the slide
   * stayed put. The bar's CSS animation pauses on the same flag.
   */
  const elapsed = useRef(0);
  const shownIndex = useRef(index);
  const stopped = paused || hidden;
  useEffect(() => {
    if (shownIndex.current !== index) {
      shownIndex.current = index;
      elapsed.current = 0;
    }
    if (stopped || count < 2) return;
    const started = Date.now();
    const timer = window.setTimeout(
      () => setIndex((value) => (value + 1) % count),
      Math.max(0, ROTATE_MS - elapsed.current),
    );
    return () => {
      window.clearTimeout(timer);
      elapsed.current += Date.now() - started;
    };
  }, [index, stopped, count]);

  // Keyboard focus pauses; a mouse click on a dot or « Lecture » must not
  // leave the carousel frozen until something else is clicked.
  function onFocusIn(event: FocusEvent<HTMLElement>) {
    try {
      if ((event.target as HTMLElement).matches(":focus-visible")) setPaused(true);
    } catch {
      // Old TV browsers without :focus-visible: never pause on focus.
    }
  }

  useEffect(() => {
    if (!items.length) return;
    let alive = true;
    // Series stills come from their own id space (see loadBackdrops).
    const films = items.filter((entry) => entry.type !== "series").map((entry) => entry.id);
    const shows = items.filter((entry) => entry.type === "series").map((entry) => entry.id);
    Promise.all([loadBackdrops(films), loadBackdrops(shows, true)]).then(([a, b]) => {
      if (alive) setBackdrops({ ...a, ...b });
    });
    loadSynopses(items.map((entry) => ({ id: entry.id, series: entry.type === "series" }))).then((map) => {
      if (alive) setSynopses(map);
    });
    return () => {
      alive = false;
    };
  }, [items]);

  const item = items[index] ?? items[0];
  if (!item) return null;

  const go = (delta: number) => setIndex((value) => (value + delta + count) % count);
  const kind = item.category === "anime" ? "ANIME" : item.type === "series" ? "SÉRIE" : "FILM";
  const synopsis = synopses[item.id];

  return (
    <section
      className="mf-hero"
      aria-roledescription="carrousel"
      aria-label="À la une"
      style={{ "--mf-rotate": `${ROTATE_MS}ms` } as CSSProperties}
      onFocusCapture={onFocusIn}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="mf-hero__stills" aria-hidden="true">
        {items.map((entry, position) => (
          <img
            key={entry.id}
            className={`mf-hero__still${position === index ? " is-active" : ""}`}
            src={backdrops[String(entry.id)] || fullSize(entry.poster)}
            alt=""
            decoding="async"
            loading={position < 2 ? "eager" : "lazy"}
          />
        ))}
      </div>
      <div className="mf-hero__veil" aria-hidden="true" />

      <div className="mf-hero__inner" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <p className="mf-eyebrow">
          <Sparkles size={14} /> À la une aujourd'hui
        </p>
        <h1 className="mf-hero__title">{item.title}</h1>
        <div className="mf-hero__meta">
          <span className="mf-chip">{kind}</span>
          <span className="mf-hero__year">{item.year || "—"}</span>
          {item.genres.length ? (
            <span className="mf-hero__genres">{item.genres.slice(0, 2).map((key) => GENRE_LABEL[key]).join(" · ")}</span>
          ) : null}
        </div>
        {synopsis ? <p className="mf-hero__synopsis">{synopsis}</p> : null}
        <div className="mf-hero__actions">
          <button type="button" className="mf-btn mf-btn--primary" onClick={() => onPlay(item)}>
            <Play size={17} strokeWidth={2.4} /> Lecture
          </button>
        </div>
      </div>

      {count > 1 ? (
        <div
          className={`mf-hero__nav${stopped ? " is-paused" : ""}`}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <button type="button" className="mf-hero__arrow" aria-label="Titre précédent" onClick={() => go(-1)}>
            <ChevronLeft size={16} />
          </button>
          <div className="mf-hero__dots">
            {items.map((entry, position) => (
              <button
                key={entry.id}
                type="button"
                className={position === index ? "is-active" : ""}
                aria-label={`Voir ${entry.title}`}
                aria-current={position === index ? "true" : undefined}
                onClick={() => setIndex(position)}
              >
                <span className="mf-hero__fill" />
              </button>
            ))}
          </div>
          <button type="button" className="mf-hero__arrow" aria-label="Titre suivant" onClick={() => go(1)}>
            <ChevronRight size={16} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
