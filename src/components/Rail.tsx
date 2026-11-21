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
  /** The arrow glide in flight, if any (see page()). */
  const glide = useRef<{ frame: number; target: number } | null>(null);
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

  /**
   * One screen to the side, as a glide. The browser's own smooth scroll could
   * be starved by poster decoding and then jumped; this drives scrollLeft
   * frame by frame with an ease-out, and a second click mid-glide simply
   * extends the target instead of restarting from a jolt.
   */
  function page(direction: -1 | 1) {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const base = glide.current ? glide.current.target : el.scrollLeft;
    const target = Math.max(0, Math.min(max, base + direction * el.clientWidth * 0.82));
    if (glide.current) cancelAnimationFrame(glide.current.frame);

    const from = el.scrollLeft;
    const distance = target - from;
    const duration = 520;
    const started = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      el.scrollLeft = from + distance * ease(t);
      if (t < 1) {
        glide.current = { frame: requestAnimationFrame(step), target };
      } else {
        glide.current = null;
        updateEdges();
      }
    };
    glide.current = { frame: requestAnimationFrame(step), target };
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