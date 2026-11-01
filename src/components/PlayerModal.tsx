import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, BookmarkCheck, Check, ExternalLink, SkipForward, X } from "lucide-react";
import { LANG_LABEL, checkTitle, playerUrl, type MoviezLang } from "../lib/moviez";
import type { Category } from "../lib/catalog";

export interface PlaySubject {
  id: number;
  type: "movie" | "series";
  title: string;
  poster?: string;
  year?: number | null;
  category?: Category;
  seasons?: number | null;
  languages?: string[];
}

interface PlayerModalProps {
  subject: PlaySubject;
  onClose: () => void;
  wanted?: boolean;
  done?: boolean;
  onToggleWatch?: (subject: PlaySubject) => void;
  onToggleDone?: () => void;
  onWatched?: (subject: PlaySubject, season: number, episode: number) => void;
}

const PLAYABLE: MoviezLang[] = ["vf", "vo", "vostfr", "multi"];

export default function PlayerModal({
  subject,
  onClose,
  wanted = false,
  done = false,
  onToggleWatch,
  onToggleDone,
  onWatched,
}: PlayerModalProps) {
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [lang, setLang] = useState<MoviezLang>("vf");
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [live, setLive] = useState<{ seasons?: number; languages?: string[] }>({});

  // Keep the callback in a ref: App re-creates it on each render, and a new
  // dependency would re-record the same watch in a loop.
  const watchedRef = useRef(onWatched);
  watchedRef.current = onWatched;
  // `subject` is a fresh object on every App render, so recording keyed off it
  // fed setState → render → record → setState. The signature guard stops that.
  const recordedRef = useRef("");

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    checkTitle(subject.id, controller.signal)
      .then((data) => {
        if (!data.available) {
          setStatus("unavailable");
          return;
        }
        setLive({ seasons: data.seasons, languages: data.languages });
        const langs = (data.languages ?? []).filter((l): l is MoviezLang => PLAYABLE.includes(l as MoviezLang));
        setLang(langs.includes("vf") ? "vf" : langs[0] ?? "vf");
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if ((error as Error)?.name === "AbortError") return;
        setStatus("error");
      });
    return () => controller.abort();
  }, [subject.id]);

  useEffect(() => {
    if (status !== "ready") return;
    const signature = `${subject.id}:${season}:${episode}`;
    if (recordedRef.current === signature) return;
    recordedRef.current = signature;
    watchedRef.current?.(subject, season, episode);
  }, [status, season, episode, subject.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const languages = useMemo(() => {
    const list = (live.languages ?? subject.languages ?? []).filter((l): l is MoviezLang =>
      PLAYABLE.includes(l as MoviezLang),
    );
    return list.length ? list : (["vf"] as MoviezLang[]);
  }, [live.languages, subject.languages]);

  const seasonCount = live.seasons ?? subject.seasons ?? 1;
  const seasons = Math.max(1, Math.min(seasonCount || 1, 60));
  const src = playerUrl({ id: subject.id, type: subject.type, lang, season, episode });

  return (
    <div className="mf-modal" role="dialog" aria-modal="true" aria-label={`Lecteur — ${subject.title}`}>
      <button type="button" className="mf-modal__backdrop" aria-label="Fermer" onClick={onClose} />
      <div className="mf-modal__panel">
        <header className="mf-modal__head">
          <div>
            <h2 className="mf-modal__title">{subject.title}</h2>
            <p className="mf-modal__sub">
              <span>TMDB {subject.id}</span>
              <span className="mf-dot" />
              <span>{subject.type === "series" ? "Série" : "Film"}</span>
              <span className="mf-dot" />
              <span>Lecteur Moviez</span>
            </p>
          </div>
          <div className="mf-modal__head-actions">
            <a className="mf-link mf-link--icon" href={src} target="_blank" rel="noreferrer noopener">
              <ExternalLink size={14} /> Nouvel onglet
            </a>
            {onToggleDone ? (
              <button
                type="button"
                className={`mf-btn mf-btn--sm${done ? " is-on" : ""}`}
                aria-pressed={done}
                onClick={onToggleDone}
              >
                <Check size={15} /> {done ? "Terminé" : "J'ai terminé"}
              </button>
            ) : null}
            {onToggleWatch ? (
              <button
                type="button"
                className={`mf-btn mf-btn--sm${wanted ? " is-on" : ""}`}
                aria-pressed={wanted}
                onClick={() => onToggleWatch(subject)}
              >
                {wanted ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
                {wanted ? "Dans ma liste" : "Ma liste"}
              </button>
            ) : null}
            <button type="button" className="mf-btn mf-btn--sm" onClick={onClose}>
              <X size={15} /> Fermer
            </button>
          </div>
        </header>

        <div className="mf-player">
          {status === "loading" && (
            <div className="mf-player__state">
              <div className="mf-loader" aria-hidden="true" />
              <p>Vérification de la disponibilité…</p>
            </div>
          )}
          {status === "unavailable" && (
            <div className="mf-player__state">
              <h3>Titre indisponible</h3>
              <p>Moviez ne sert pas encore ce titre. Essayez un autre film ou une autre langue.</p>
            </div>
          )}
          {status === "error" && (
            <div className="mf-player__state">
              <h3>Lecteur injoignable</h3>
              <p>L'API Moviez n'a pas répondu. Réessayez dans un instant.</p>
            </div>
          )}
          {status === "ready" && (
            /*
             * The player page loads its own ad tag (cdn.fozekikikiminu.com) and
             * every documented entry point carries it, so the frame is
             * sandboxed without allow-popups or allow-top-navigation: the ad
             * network can no longer open a tab, swap an ad under our feet or
             * navigate away from the film. Playback itself is untouched, and
             * the frame still cannot reach our origin's storage.
             */
            <iframe
              key={src}
              className="mf-player__frame"
              src={src}
              title={`Lecteur ${subject.title}`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-orientation-lock"
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              referrerPolicy="no-referrer"
            />
          )}
        </div>

        <footer className="mf-modal__controls">
          {subject.type === "series" && (
            <label className="mf-field">
              <span>Saison</span>
              <select value={season} onChange={(event) => setSeason(Number(event.target.value))}>
                {Array.from({ length: seasons }, (_, i) => i + 1).map((value) => (
                  <option key={value} value={value}>
                    Saison {value}
                  </option>
                ))}
              </select>
            </label>
          )}
          {subject.type === "series" && (
            <label className="mf-field">
              <span>Épisode</span>
              <select value={episode} onChange={(event) => setEpisode(Number(event.target.value))}>
                {Array.from({ length: 30 }, (_, i) => i + 1).map((value) => (
                  <option key={value} value={value}>
                    Épisode {value}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="mf-field">
            <span>Langue</span>
            <select value={lang} onChange={(event) => setLang(event.target.value as MoviezLang)}>
              {languages.map((value) => (
                <option key={value} value={value}>
                  {LANG_LABEL[value] ?? value.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          {subject.type === "series" && (
            <button type="button" className="mf-btn mf-btn--sm" onClick={() => setEpisode((value) => value + 1)}>
              <SkipForward size={15} /> Épisode suivant
            </button>
          )}
          <div className="mf-modal__langs">
            {languages.map((value) => (
              <span key={value} className={`mf-chip${value === lang ? " is-active" : ""}`}>
                {LANG_LABEL[value] ?? value.toUpperCase()}
              </span>
            ))}
          </div>
        </footer>
      </div>
    </div>
  );
}
