import { Play } from "lucide-react";
import type { Title } from "../lib/catalog";
import { LANG_LABEL } from "../lib/moviez";

interface PosterCardProps {
  item: Title;
  onOpen: (item: Title) => void;
}

/**
 * Grid tiles use Argent's *CSS* chrome rim rather than a WebGL surface: the
 * catalogue renders ~185 posters at once, and one shader canvas per tile blows
 * past the browser's ~16-context cap. The live liquid metal is reserved for the
 * hero, the controls and the player.
 */
export default function PosterCard({ item, onOpen }: PosterCardProps) {
  const tone = item.anime ? "amethyst" : item.type === "series" ? "cobalt" : "silver";

  return (
    <article
      className={`mf-card mf-card--${tone}`}
      role="button"
      tabIndex={0}
      aria-label={`Lire ${item.title}`}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(item);
        }
      }}
    >
      <div className="mf-card__inner">
        <div className="mf-card__poster">
          <img src={item.poster} alt={`Affiche de ${item.title}`} loading="lazy" decoding="async" />
          <span className="mf-card__play" aria-hidden="true">
            <Play size={22} strokeWidth={2.4} />
          </span>
          <div className="mf-card__langs">
            {item.languages.slice(0, 2).map((lang) => (
              <span key={lang} className="mf-chip mf-chip--tiny">
                {LANG_LABEL[lang] ?? lang.toUpperCase()}
              </span>
            ))}
          </div>
        </div>
        <div className="mf-card__body">
          <h3 className="mf-card__title" title={item.title}>
            {item.title}
          </h3>
          <p className="mf-card__meta">
            {item.year ?? "—"}
            {item.type === "series" && item.seasons ? ` · ${item.seasons} saison${item.seasons > 1 ? "s" : ""}` : ""}
          </p>
        </div>
      </div>
      {item.anime ? (
        <span className="mf-card__badge mf-card__badge--amethyst">ANIME</span>
      ) : item.type === "series" ? (
        <span className="mf-card__badge mf-card__badge--cobalt">SÉRIE</span>
      ) : null}
    </article>
  );
}
