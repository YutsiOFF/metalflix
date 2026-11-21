import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { loadBackdrops } from "../lib/artwork";
import { topNote, type Title } from "../lib/catalog";

interface TopRailProps {
  /** Ten films, already ordered: the row reads them as a ranking. */
  items: Title[];
  onOpen: (item: Title) => void;
  /** Section heading; the films shelf is the default. */
  title?: string;
  /** Series stills are looked up in their own id space. */
  series?: boolean;
}

/**
 * « Top 10 des films aujourd'hui », right under the studio tiles.
 *
 * Wide stills rather than posters, because the rank behind each card only
 * exists to frame a 16:9 image. The stills come from the same backdrop lookup
 * the hero uses (a portrait poster cropped into a banner cuts faces in half);
 * a title without one falls back to its poster.
 *
 * Inside the card sits the original title, the way a film's own logo art does
 * on the service this row imitates; the French title is the caption below.
 * The section itself is washed with the first film's still, so the row opens on
 * a colour instead of a flat page.
 */
/**
 * TMDB serves every width from the same path. The cards ask for 780 (they are
 * ~430px wide, so that covers a retina screen) and the section background for
 * 1280: the band spans the whole page, and a small file stretched across it is
 * exactly what reads as pixelated.
 */
function sized(url: string, width: "w1280" | "w780"): string {
  // Posters arrive as /w500/ and backdrops as /original/, so both are rewritten.
  return url.replace(/\/t\/p\/(?:original|w\d+)\//, `/t/p/${width}/`);
}

export default function TopRail({ items, onOpen, title = "Top 10 des films aujourd'hui", series = false }: TopRailProps) {
  const [stills, setStills] = useState<Record<string, string>>({});
  const trackRef = useRef<HTMLOListElement>(null);
  const [edges, setEdges] = useState({ prev: false, next: false });

  /** Shows an arrow only while there is something to scroll to on that side. */
  function updateEdges() {
    const el = trackRef.current;
    if (!el) return;
    const next = {
      prev: el.scrollLeft > 8,
      next: el.scrollLeft + el.clientWidth < el.scrollWidth - 8,
    };
    setEdges((prev) => (prev.prev === next.prev && prev.next === next.next ? prev : next));
  }

  useEffect(() => {
    updateEdges();
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(el);
    return () => observer.disconnect();
  }, [items]);

  function page(direction: -1 | 1) {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  }

  useEffect(() => {
    if (!items.length) return;
    let alive = true;
    const merge = (map: Record<string, string>) =>
      setStills((known) => ({ ...known, ...map }));

    // The first film's backdrop is asked for on its own: it is the section's
    // background, and waiting for all ten left the band empty for a moment.
    loadBackdrops([items[0].id], series).then((map) => {
      if (alive) merge(map);
    });
    loadBackdrops(items.map((item) => item.id), series).then((map) => {
      if (alive) merge(map);
    });
    return () => {
      alive = false;
    };
  }, [items, series]);

  if (!items.length) return null;

  // Only a real backdrop goes behind the row. A portrait poster stretched over
  // a full-width band is what made the section look pixelated.
  const wash = stills[String(items[0].id)] || "";

  return (
    <section className={`mf-top${series ? " mf-top--series" : ""}`} aria-label={title}>
      {wash ? (
        <div
          className="mf-top__wash"
          style={{ backgroundImage: `url(${sized(wash, "w1280")})` }}
          aria-hidden="true"
        />
      ) : null}

      <div className="mf-top__head">
        <h2>{title}</h2>
        <span>Une sélection qui tourne chaque jour</span>
      </div>

      <div className="mf-top__frame">
      <button
        type="button"
        className="mf-top__arrow mf-top__arrow--prev"
        hidden={!edges.prev}
        onClick={() => page(-1)}
        aria-label={`Faire défiler ${title} vers la gauche`}
      >
        <ChevronLeft size={22} strokeWidth={2.4} />
      </button>

      <ol className="mf-top__track" ref={trackRef} onScroll={updateEdges}>
        {items.map((item, index) => {
          const still = stills[String(item.id)] || item.poster || "";
          const note = topNote(item.id);
          return (
            <li className="mf-top__item" key={item.id}>
              <span className="mf-top__rank" aria-hidden="true">
                {index + 1}
              </span>

              <div className="mf-top__body">
                <button
                  type="button"
                  className="mf-top__card"
                  onClick={() => onOpen(item)}
                  aria-label={`Lire ${item.title}${item.year ? ` (${item.year})` : ""}`}
                >
                  {still ? (
                    <img
                      src={sized(still, "w780")}
                      alt=""
                      loading={index < 3 ? "eager" : "lazy"}
                      decoding="async"
                    />
                  ) : (
                    <span className="mf-top__empty" aria-hidden="true" />
                  )}
                  <span className="mf-top__veil" aria-hidden="true" />
                  <strong className="mf-top__title">{item.alt || item.title}</strong>
                </button>

                <p className="mf-top__meta">
                  <span>{item.title}</span>
                  {note != null ? (
                    <small className="mf-top__note">{note.toFixed(1).replace(".", ",")}</small>
                  ) : null}
                  {item.year ? <small>{item.year}</small> : null}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        className="mf-top__arrow mf-top__arrow--next"
        hidden={!edges.next}
        onClick={() => page(1)}
        aria-label={`Faire défiler ${title} vers la droite`}
      >
        <ChevronRight size={22} strokeWidth={2.4} />
      </button>
      </div>
    </section>
  );
}
