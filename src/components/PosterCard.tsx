import { Bookmark, BookmarkCheck, Play } from "lucide-react";
import type { Title } from "../lib/catalog";

interface PosterCardProps {
  item: Title;
  onOpen: (item: Title) => void;
  wanted?: boolean;
  onToggleWatch?: (item: Title) => void;
}

/**
 * Grid tiles use Argent's *CSS* chrome rim rather than a WebGL surface: the
 * catalogue renders hundreds of posters, and one shader canvas per tile blows
 * past the browser's ~16-context cap.
 */
export default function PosterCard({ item, onOpen, wanted = false, onToggleWatch }: PosterCardProps) {
  const tone = item.anime ? "amethyst" : item.type === "series" ? "cobalt" : "silver";

  return (
    <article className={`mf-card mf-card--${tone}`}>
      <button type="button" className="mf-card__open" onClick={() => onOpen(item)} aria-label={`Lire ${item.title}`}>
        <div className="mf-card__inner">
          <div className="mf-card__poster">
            <img src={item.poster} alt={`Affiche de ${item.title}`} loading="lazy" decoding="async" />
            <span className="mf-card__play" aria-hidden="true">
              <Play size={22} strokeWidth={2.4} />
            </span>
          </div>
          <div className="mf-card__body">
            <h3 className="mf-card__title" title={item.title}>
              {item.title}
            </h3>
            <p className="mf-card__meta">{item.year || "—"}</p>
          </div>
        </div>
      </button>

      {onToggleWatch ? (
        <button
          type="button"
          className={`mf-card__watch${wanted ? " is-on" : ""}`}
          aria-pressed={wanted}
          aria-label={wanted ? `Retirer ${item.title} de ma liste` : `Ajouter ${item.title} à ma liste`}
          title={wanted ? "Dans ma liste" : "Ajouter à ma liste"}
          onClick={() => onToggleWatch(item)}
        >
          {wanted ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
        </button>
      ) : null}

      {item.anime ? (
        <span className="mf-card__badge mf-card__badge--amethyst">ANIME</span>
      ) : item.type === "series" ? (
        <span className="mf-card__badge mf-card__badge--cobalt">SÉRIE</span>
      ) : null}
    </article>
  );
}
