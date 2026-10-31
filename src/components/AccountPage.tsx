import { useMemo } from "react";
import { MetalButton, MetalCard, MetalText } from "argentui";
import { Bookmark, Clock, Download, Film, Sparkles, Trash2, Tv, User, X } from "lucide-react";
import type { Profile } from "../lib/accounts";
import {
  groupByCategory,
  relativeDate,
  type HistoryEntry,
  type Library,
  type LibraryItem,
} from "../lib/library";
import type { Category } from "../lib/catalog";
import { CATEGORY_LABEL } from "../lib/catalog";

interface AccountPageProps {
  profile: Profile | null;
  library: Library;
  onOpenTitle: (item: LibraryItem) => void;
  onToggleWatch: (item: LibraryItem) => void;
  onRemoveHistory: (id: number) => void;
  onClearHistory: () => void;
  onExport: () => void;
  onSignOut: () => void;
  onConnect: () => void;
}

const ICONS: Record<Category, React.ReactNode> = {
  film: <Film size={15} />,
  serie: <Tv size={15} />,
  anime: <Sparkles size={15} />,
};

export default function AccountPage({
  profile,
  library,
  onOpenTitle,
  onToggleWatch,
  onRemoveHistory,
  onClearHistory,
  onExport,
  onSignOut,
  onConnect,
}: AccountPageProps) {
  const history = useMemo(() => groupByCategory(library.history), [library.history]);
  const watchlist = useMemo(() => groupByCategory(library.watchlist), [library.watchlist]);

  if (!profile) {
    return (
      <section className="mf-account mf-account--empty">
        <MetalCard tone="silver" radius={20} sheen className="mf-account__cta">
          <User size={23} />
          <h1>Votre compte MetalFlix</h1>
          <p>
            Créez un profil gratuit pour retrouver votre historique de lecture et votre liste d'envies, classés par
            films, séries et animes.
          </p>
          <MetalButton tone="gold" size="lg" onClick={onConnect} halo>
            Créer un compte / se connecter
          </MetalButton>
        </MetalCard>
      </section>
    );
  }

  const stats: Array<{ category: Category; seen: number; wanted: number }> = (["film", "serie", "anime"] as Category[]).map(
    (category) => ({
      category,
      seen: history[category].length,
      wanted: watchlist[category].length,
    }),
  );

  return (
    <section className="mf-account">
      <header className="mf-account__head">
        <div className="mf-account__avatar" aria-hidden="true">
          {profile.name.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <MetalText as="h1" tone="silver" fontSize={44} fontWeight={800} speed={0.5} className="mf-account__title">
            {profile.name}
          </MetalText>
          <p className="mf-account__since">
            Profil local créé le{" "}
            {new Date(profile.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <div className="mf-account__actions">
          <MetalButton tone="gunmetal" size="sm" icon={<Download size={14} />} onClick={onExport}>
            Exporter
          </MetalButton>
          <MetalButton tone="gunmetal" size="sm" icon={<User size={14} />} onClick={onSignOut}>
            Déconnexion
          </MetalButton>
        </div>
      </header>

      <div className="mf-account__stats">
        {stats.map(({ category, seen, wanted }) => (
          <MetalCard key={category} tone={category === "anime" ? "amethyst" : category === "serie" ? "cobalt" : "silver"} radius={16} className="mf-stat-card">
            <span className="mf-stat-card__label">
              {ICONS[category]} {CATEGORY_LABEL[category]}
            </span>
            <strong>{seen}</strong>
            <span className="mf-stat-card__sub">vus · {wanted} en liste</span>
          </MetalCard>
        ))}
      </div>

      {(["watchlist", "history"] as const).map((section) => {
        const source = section === "watchlist" ? watchlist : history;
        const total = source.film.length + source.serie.length + source.anime.length;
        return (
          <MetalCard key={section} tone="gunmetal" radius={18} className="mf-library">
            <div className="mf-library__head">
              <h2>
                {section === "watchlist" ? <Bookmark size={16} /> : <Clock size={16} />}
                {section === "watchlist" ? "Ma watch list" : "Mon historique"}
                <span>{total}</span>
              </h2>
              {section === "history" && total > 0 ? (
                <button type="button" className="mf-more" onClick={onClearHistory}>
                  Vider l'historique
                </button>
              ) : null}
            </div>

            {total === 0 ? (
              <p className="mf-library__empty">
                {section === "watchlist"
                  ? "Ajoutez un titre avec le signet sur une affiche pour le retrouver ici."
                  : "Lancez un film ou une série : il apparaîtra ici automatiquement."}
              </p>
            ) : (
              (["film", "serie", "anime"] as Category[]).map((category) =>
                source[category].length ? (
                  <div className="mf-library__group" key={category}>
                    <h3>
                      {ICONS[category]} {CATEGORY_LABEL[category]}
                      <span>{source[category].length}</span>
                    </h3>
                    <ul className="mf-library__list">
                      {source[category].map((entry) => (
                        <li key={entry.id} className="mf-library__row">
                          <button type="button" className="mf-library__main" onClick={() => onOpenTitle(entry)}>
                            {entry.poster ? <img src={entry.poster} alt="" aria-hidden="true" /> : <span className="mf-library__noposter" />}
                            <span className="mf-library__text">
                              <strong>{entry.title}</strong>
                              <small>
                                {entry.year ?? "—"}
                                {"season" in entry && (entry as HistoryEntry).season
                                  ? ` · S${(entry as HistoryEntry).season}E${(entry as HistoryEntry).episode ?? 1}`
                                  : ""}
                                {" · "}
                                {relativeDate(entry.at)}
                              </small>
                            </span>
                          </button>
                          <div className="mf-library__tools">
                            {section === "watchlist" ? (
                              <button
                                type="button"
                                className="mf-icon-btn"
                                aria-label={`Retirer ${entry.title} de ma liste`}
                                onClick={() => onToggleWatch(entry)}
                              >
                                <X size={14} />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="mf-icon-btn"
                                aria-label={`Oublier ${entry.title}`}
                                onClick={() => onRemoveHistory(entry.id)}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )
            )}
          </MetalCard>
        );
      })}
    </section>
  );
}
