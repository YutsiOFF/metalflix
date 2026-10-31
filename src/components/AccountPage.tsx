import { useMemo } from "react";
import { Bookmark, Check, Clock, Download, Film, Sparkles, Trash2, Tv, User, X } from "lucide-react";
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
  onToggleDone: (id: number) => void;
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

/**
 * Static panels only: this page is read while scrolling a list, and the liquid
 * shader moved under the text the whole time.
 */
export default function AccountPage({
  profile,
  library,
  onOpenTitle,
  onToggleWatch,
  onToggleDone,
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
        <div className="mf-panel mf-account__cta">
          <User size={23} />
          <h1>Votre compte MetalFlix</h1>
          <p>
            Créez un profil gratuit pour retrouver votre historique de lecture et votre liste d'envies, classés par
            films, séries et animes.
          </p>
          <button type="button" className="mf-btn mf-btn--primary" onClick={onConnect}>
            Créer un compte / se connecter
          </button>
        </div>
      </section>
    );
  }

  const stats: Array<{ category: Category; seen: number; finished: number; wanted: number }> = (
    ["film", "serie", "anime"] as Category[]
  ).map((category) => ({
    category,
    seen: history[category].length,
    finished: history[category].filter((entry) => (entry as HistoryEntry).done).length,
    wanted: watchlist[category].length,
  }));

  return (
    <section className="mf-account">
      <header className="mf-account__head">
        <div className="mf-account__avatar" aria-hidden="true">
          {profile.name.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h1 className="mf-account__name">{profile.name}</h1>
          <p className="mf-account__since">
            Profil local créé le{" "}
            {new Date(profile.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <div className="mf-account__actions">
          <button type="button" className="mf-btn mf-btn--sm" onClick={onExport}>
            <Download size={14} /> Exporter
          </button>
          <button type="button" className="mf-btn mf-btn--sm" onClick={onSignOut}>
            <User size={14} /> Déconnexion
          </button>
        </div>
      </header>

      <div className="mf-account__stats">
        {stats.map(({ category, seen, finished, wanted }) => (
          <div className="mf-stat-card" key={category}>
            <span className="mf-stat-card__label">
              {ICONS[category]} {CATEGORY_LABEL[category]}
            </span>
            <strong>{seen}</strong>
            <span className="mf-stat-card__sub">
              {finished} terminé{finished > 1 ? "s" : ""} · {wanted} en liste
            </span>
          </div>
        ))}
      </div>

      {(["watchlist", "history"] as const).map((section) => {
        const source = section === "watchlist" ? watchlist : history;
        const total = source.film.length + source.serie.length + source.anime.length;
        const remaining =
          section === "history"
            ? source.film.length +
              source.serie.length +
              source.anime.length -
              [...source.film, ...source.serie, ...source.anime].filter((entry) => (entry as HistoryEntry).done).length
            : 0;
        return (
          <section className="mf-panel mf-library" key={section}>
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

            {section === "history" && remaining > 0 ? (
              <p className="mf-library__hint">
                {remaining} titre{remaining > 1 ? "s" : ""} commencé{remaining > 1 ? "s" : ""} mais pas terminé
                {remaining > 1 ? "s" : ""} — appuyez sur ✓ pour marquer comme vu.
              </p>
            ) : null}

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
                      {source[category].map((entry) => {
                        const finished = Boolean((entry as HistoryEntry).done);
                        return (
                          <li key={entry.id} className="mf-library__row">
                            <button type="button" className="mf-library__main" onClick={() => onOpenTitle(entry)}>
                              {entry.poster ? (
                                <img src={entry.poster} alt="" aria-hidden="true" />
                              ) : (
                                <span className="mf-library__noposter" />
                              )}
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
                                <>
                                  <span className={`mf-status ${finished ? "mf-status--done" : "mf-status--open"}`}>
                                    {finished ? "Terminé" : "En cours"}
                                  </span>
                                  <button
                                    type="button"
                                    className={`mf-icon-btn${finished ? " is-on" : ""}`}
                                    aria-pressed={finished}
                                    aria-label={finished ? `Marquer ${entry.title} comme non terminé` : `Marquer ${entry.title} comme terminé`}
                                    title={finished ? "Marquer comme non terminé" : "Marquer comme terminé"}
                                    onClick={() => onToggleDone(entry.id)}
                                  >
                                    <Check size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    className="mf-icon-btn"
                                    aria-label={`Oublier ${entry.title}`}
                                    onClick={() => onRemoveHistory(entry.id)}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null,
              )
            )}
          </section>
        );
      })}
    </section>
  );
}
