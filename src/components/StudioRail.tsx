import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PlatformKey } from "../lib/catalog";
import appletvLogo from "../assets/studios/appletv.svg";
import disneyLogo from "../assets/studios/disney.svg";
import netflixLogo from "../assets/studios/netflix.svg";
import paramountLogo from "../assets/studios/paramount.svg";
import primeLogo from "../assets/studios/prime.svg";

interface StudioRailProps {
  /** Only the services that actually carry something, with their title count. */
  counts: { key: string; label: string; count: number }[];
  /** A service key, a studio key (marvel, dc) or "all". */
  active: string;
  onPick: (key: string) => void;
}

/**
 * The brand wordmarks, shipped as SVG. Drawing them in CSS was close for
 * Paramount and wrong for Disney+ and TV+; the real marks read instantly, and
 * each tile keeps its own background so the row looks like the services rather
 * than a set of cards. Every mark is white on its brand colour, except Netflix,
 * whose red is the one colour that reads on black.
 */
const LOGO: Partial<Record<PlatformKey | string, string | null>> = {
  netflix: netflixLogo,
  prime: primeLogo,
  disney: disneyLogo,
  paramount: paramountLogo,
  // The Commons file for Canal+ is a filled plate, not a bare wordmark: forced
  // white it becomes a white rectangle. This one is still drawn.
  canal: null,
  appletv: appletvLogo,
};

/** The "Plateformes & studios" row: one brand tile per service carrying titles. */
/** Marks drawn in CSS: the Marvel red block and the DC roundel. */
function Wordmark({ studio }: { studio: string }) {
  if (studio === "marvel") return <span className="mf-studio__marvel">MARVEL</span>;
  if (studio === "dc") return <span className="mf-studio__dc">DC</span>;
  return (
    <span className="mf-studio__word" aria-hidden="true">
      CANAL+
    </span>
  );
}

export default function StudioRail({ counts, active, onPick }: StudioRailProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const glide = useRef<{ frame: number; target: number } | null>(null);
  const [edges, setEdges] = useState({ prev: false, next: false });

  function updateEdges() {
    const el = trackRef.current;
    if (!el) return;
    const next = { prev: el.scrollLeft > 8, next: el.scrollLeft + el.clientWidth < el.scrollWidth - 8 };
    setEdges((prev) => (prev.prev === next.prev && prev.next === next.next ? prev : next));
  }

  useEffect(() => {
    updateEdges();
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(el);
    return () => observer.disconnect();
  }, [counts]);

  /** Same eased glide as the other rows. */
  function page(direction: -1 | 1) {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const base = glide.current ? glide.current.target : el.scrollLeft;
    const target = Math.max(0, Math.min(max, base + direction * el.clientWidth * 0.8));
    if (glide.current) cancelAnimationFrame(glide.current.frame);
    const from = el.scrollLeft;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / 520);
      el.scrollLeft = from + (target - from) * (1 - Math.pow(1 - t, 3));
      if (t < 1) glide.current = { frame: requestAnimationFrame(step), target };
      else {
        glide.current = null;
        updateEdges();
      }
    };
    glide.current = { frame: requestAnimationFrame(step), target };
  }

  if (!counts.length) return null;

  return (
    <section className="mf-studios" aria-label="Plateformes et studios">
      <div className="mf-studios__head">
        <h2>Plateformes &amp; studios</h2>
        <span className="mf-studios__hint">Filtrer le catalogue</span>
      </div>

      <div className="mf-studios__frame">
      <button
        type="button"
        className="mf-top__arrow mf-top__arrow--prev mf-studios__arrow"
        hidden={!edges.prev}
        onClick={() => page(-1)}
        aria-label="Plateformes et studios précédents"
      >
        <ChevronLeft size={22} strokeWidth={2.4} />
      </button>
      <div className="mf-studios__track" ref={trackRef} onScroll={updateEdges}>
        {counts.map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            className={`mf-studio mf-studio--${key}${active === key ? " is-active" : ""}`}
            onClick={() => onPick(key)}
            aria-pressed={active === key || undefined}
            aria-label={`${label} — ${count.toLocaleString("fr-FR")} titres`}
          >
            {LOGO[key] ? (
              <img
                className="mf-studio__logo"
                src={LOGO[key] ?? ""}
                alt=""
                aria-hidden="true"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <Wordmark studio={key} />
            )}
            <span className="mf-studio__meta">{count.toLocaleString("fr-FR")} titres</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="mf-top__arrow mf-top__arrow--next mf-studios__arrow"
        hidden={!edges.next}
        onClick={() => page(1)}
        aria-label="Plateformes et studios suivants"
      >
        <ChevronRight size={22} strokeWidth={2.4} />
      </button>
      </div>
    </section>
  );
}
