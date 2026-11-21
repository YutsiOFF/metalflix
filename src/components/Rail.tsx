import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Title } from "../lib/catalog";
import PosterCard from "./PosterCard";

interface RailProps {
  head: string;
  icon?: ReactNode;
  total?: number;
  items: Title[];
  /** Nouveautés rows carry the big posters; every other row stays compact. */
  large?: boolean;
  onOpen: (item: Title) => void;
  wantedIds: Set<number>;
  onToggleWatch: (item: Title) => void;
  onSeeAll?: () => void;
}

/**
 * One horizontal row of posters, the way a streaming catalogue reads: a screen
 * of titles off to the right, an arrow that slides exactly one screen at a
 * time, and the native scrollbar kept as the fallback for a trackpad.
 */
export default function Rail({ head, icon, total, items, large = false, onOpen, wantedIds, onToggleWatch, onSeeAll }: RailProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const [edges, setEdges] = useState({ prev: false, next: false });

  /** Reads the track and flips the arrow flags; state only changes when they do. */
  function updateEdges() {
    const el = trackRef.current;
    if (!el) return;
    const next = {
      prev: el.scrollLeft > 8,
      next: el.scrollLeft + el.clientWidth < el.scrollWidth - 8,
    };
    setEdges((prev) => (prev.prev === next.prev && prev.next === next.next ? prev : next));
  }

  /** Scroll events fire far faster than a frame: one update per frame is enough. */
  function onScroll() {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      updateEdges();
    });
  }

  useEffect(() => {
    updateEdges();
    const el = trackRef.current;
    if (!el) return;
    // ResizeObserver is missing on older TV browsers: fall back to window resize.
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateEdges);
      return () => window.removeEventListener("resize", updateEdges);
    }
    const observer = new ResizeObserver(updateEdges);
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [items]);

  const cards = useMemo(
    () =>
      items.map((item) => (
        <PosterCard
          key={item.id}
          item={item}
          onOpen={onOpen}
          wanted={wantedIds.has(item.id)}
          onToggleWatch={onToggleWatch}
        />
      )),
    [items, onOpen, onToggleWatch, wantedIds],
  );

  if (!items.length) return null;

  function page(direction: -1 | 1) {
    const el = trackRef.current;
    if (!el) return;
    // Instant rather than smooth: an animated scroll can be starved by the
    // poster rendering and then look like the arrow does nothing.
    el.scrollTo({ left: el.scrollLeft + direction * el.clientWidth * 0.82, behavior: "instant" });
    updateEdges();
  }

  return (
    <section className="mf-row" aria-label={head}>
      <div className="mf-row__head">
        <h2>
          {icon}
          {head}
          {typeof total === "number" ? <small>{total.toLocaleString("fr-FR")}</small> : null}
        </h2>
        {onSeeAll ? (
          <button type="button" className="mf-more" onClick={onSeeAll}>
            Tout voir →
          </button>
        ) : null}
      </div>

      <div className="mf-row__frame">
        <button
          type="button"
          className="mf-row__arrow mf-row__arrow--prev"
          hidden={!edges.prev}
          onClick={() => page(-1)}
          aria-label={`Faire défiler ${head} vers la gauche`}
        >
          <ChevronLeft size={22} strokeWidth={2.4} />
        </button>

        <div className={`mf-rail mf-row__track${large ? " mf-row__track--large" : ""}`} ref={trackRef} onScroll={onScroll}>
          {cards}
        </div>

        <button
          type="button"
          className="mf-row__arrow mf-row__arrow--next"
          hidden={!edges.next}
          onClick={() => page(1)}
          aria-label={`Faire défiler ${head} vers la droite`}
        >
          <ChevronRight size={22} strokeWidth={2.4} />
        </button>
      </div>
    </section>
  );
}