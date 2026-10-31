import { useEffect, useMemo, useRef, useState } from "react";
import { MetalBadge, MetalButton, MetalProgress } from "argentui";
import { Bookmark, BookmarkCheck, ExternalLink, SkipForward, X } from "lucide-react";
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
  onToggleWatch?: (subject: PlaySubject) => void;
  onWatched?: (subject: PlaySubject, season: number, episode: number) => void;
}

const PLAYABLE: MoviezLang[] = ["vf", "vo", "vostfr", "multi"];

export default function PlayerModal({ subject, onClose, wanted = false, onToggleWatch, onWatched }: PlayerModalProps) {
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const [lang, setLang] = useState<MoviezLang>("vf");
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [live, setLive] = useState<{ seasons?: number; languages?: string[] }>({});

  // Keep the callback in a ref: App re-creates it on each render, and a new
  // dependency would re-record the same watch in a loop.
  const watchedRef = useRef(onWatched);
  watchedRef.current = onWatched;

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
    watchedRef.current?.(subject, season, episode);
  }, [status, season, episode, subject]);

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
            {onToggleWatch ? (
              <MetalButton
                tone={wanted ? "gold" : "silver"}
                size="sm"
                radius={999}
                icon={wanted ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
                onClick={() => onToggleWatch(subject)}
              >
                {wanted ? "Dans ma liste" : "Ma liste"}
              </MetalButton>
            ) : null}
            <MetalButton tone="gunmetal" size="sm" radius={999} onClick={onClose} icon={<X size={15} />}>
              Fermer
            </MetalButton>
          </div>
        </header>

        <div className="mf-player">
          {status === "loading" && (
            <div className="mf-player__state">
              <MetalProgress tone="silver" />
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
            <iframe
              key={src}
              className="mf-player__frame"
              src={src}
              title={`Lecteur ${subject.title}`}
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
            <MetalButton
              tone="silver"
              size="sm"
              icon={<SkipForward size={15} />}
              onClick={() => setEpisode((value) => value + 1)}
            >
              Épisode suivant
            </MetalButton>
          )}
          <div className="mf-modal__langs">
            {languages.map((value) => (
              <MetalBadge key={value} tone={value === lang ? "gold" : "gunmetal"}>
                {LANG_LABEL[value] ?? value.toUpperCase()}
              </MetalBadge>
            ))}
          </div>
        </footer>
      </div>
    </div>
  );
}
