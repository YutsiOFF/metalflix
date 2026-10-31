import { MetalBadge, MetalCard } from "argentui";
import { Play } from "lucide-react";
import type { Title } from "../lib/catalog";
import { LANG_LABEL } from "../lib/moviez";

interface PosterCardProps {
  item: Title;
  onOpen: (item: Title) => void;
}

export default function PosterCard({ item, onOpen }: PosterCardProps) {
  return (
    <MetalCard
      as="article"
      role="button"
      tabIndex={0}
      tone={item.anime ? "amethyst" : item.type === "series" ? "cobalt" : "silver"}
      radius={16}
      borderWidth={1.5}
      sheen
      revealOnHover
      className="mf-card"
      aria-label={`Lire ${item.title}`}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(item);
        }
      }}
    >
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
      {item.anime ? (
        <MetalBadge tone="amethyst" className="mf-card__badge">
          ANIME
        </MetalBadge>
      ) : item.type === "series" ? (
        <MetalBadge tone="cobalt" className="mf-card__badge">
          SÉRIE
        </MetalBadge>
      ) : null}
    </MetalCard>
  );
}
