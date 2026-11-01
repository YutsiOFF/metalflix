import { useEffect, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import type { Category } from "../lib/catalog";
import type { HistoryEntry } from "../lib/library";
import { loadBackdrops } from "../lib/artwork";

interface ResumeRailProps {
  items: HistoryEntry[];
  onResume: (entry: HistoryEntry) => void;
  onDismiss: (id: number) => void;
}

const KIND: Record<Category, string> = { film: "FILM", serie: "SÉRIE", anime: "ANIME" };

/**
 * Wide 16:9 cards instead of posters: what a viewer recognises here is the
 * still they left off on, plus the episode and how far they got. The percentage
 * comes from the player page through the proxy (see `PlayerModal`); the bar is
 * simply hidden when nothing was reported yet.
 */
export default function ResumeRail({ items, onResume, onDismiss }: ResumeRailProps) {
  const [stills, setStills] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!items.length) return;
    let alive = true;
    loadBackdrops(items.map((item) => item.id)).then((map) => {
      if (alive) setStills(map);
    });
    return () => {
      alive = false;
    };
  }, [items]);

  if (!items.length) return null;

  return (
    <section className="mf-section mf-section--resume" aria-label="Reprendre votre visionnage">
      <div className="mf-section__head">
        <h2>
          <RotateCcw size={16} /> Reprendre votre visionnage
        </h2>
        <span>{items.length}</span>
      </div>

      <div className="mf-resume">
        {items.map((entry) => {
          const still = stills[String(entry.id)] || entry.poster || "";
          const where = entry.season
            ? `S${entry.season} · Épisode ${entry.episode ?? 1}`
            : `Film · ${entry.year ?? "—"}`;
          const percent = Math.round((entry.progress ?? 0) * 100);

          return (
            <article className="mf-resume__card" key={entry.id}>
              <button
                type="button"
                className="mf-resume__open"
                onClick={() => onResume(entry)}
                aria-label={`Reprendre ${entry.title} — ${where}`}
              >
                {still ? (
                  <img src={still} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="mf-resume__empty" aria-hidden="true" />
                )}
                <span className={`mf-resume__kind mf-resume__kind--${entry.category}`}>{KIND[entry.category]}</span>
                <span className="mf-resume__play" aria-hidden="true">
                  <Play size={20} strokeWidth={2.4} />
                </span>
                <span className="mf-resume__veil" aria-hidden="true" />
                <span className="mf-resume__text">
                  <strong title={entry.title}>{entry.title}</strong>
                  <small>
                    <Play size={10} /> {where}
                  </small>
                </span>
                <span className="mf-resume__bar" aria-hidden="true">
                  {percent > 0 ? <span style={{ width: `${percent}%` }} /> : null}
                </span>
              </button>

              <button
                type="button"
                className="mf-resume__dismiss"
                aria-label={`Retirer ${entry.title} de la liste`}
                title="Ne plus proposer"
                onClick={() => onDismiss(entry.id)}
              >
                ×
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
