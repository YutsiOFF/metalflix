import { useEffect, useState } from "react";
import { MetalCard } from "argentui";
import { Search, Zap } from "lucide-react";
import { checkTitle, type MoviezCheck } from "../lib/moviez";
import type { PlaySubject } from "./PlayerModal";

interface DirectLookupProps {
  id: number;
  onPlay: (subject: PlaySubject) => void;
}

/**
 * The Moviez API is addressed by TMDB id, so this turns a pasted id into a
 * playable card — the catalogue is curated, but any title can be opened here.
 */
export default function DirectLookup({ id, onPlay }: DirectLookupProps) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "missing" | "error"; data?: MoviezCheck }>({
    status: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    checkTitle(id, controller.signal)
      .then((data) => setState({ status: data.available ? "ready" : "missing", data }))
      .catch((error: unknown) => {
        if ((error as Error)?.name === "AbortError") return;
        setState({ status: "error" });
      });
    return () => controller.abort();
  }, [id]);

  const data = state.data;

  return (
    <MetalCard tone="gold" radius={18} sheen className="mf-lookup" halo>
      <div className="mf-lookup__body">
        <p className="mf-lookup__tag">
          <Search size={13} /> Recherche directe TMDB
        </p>
        {state.status === "loading" && <p className="mf-lookup__text">Interrogation de Moviez pour l'id {id}…</p>}
        {state.status === "missing" && (
          <p className="mf-lookup__text">
            L'id <strong>{id}</strong> n'est pas disponible sur Moviez.
          </p>
        )}
        {state.status === "error" && <p className="mf-lookup__text">Impossible de joindre l'API Moviez.</p>}
        {state.status === "ready" && data && (
          <>
            <h3 className="mf-lookup__title">{data.title}</h3>
            <p className="mf-lookup__text">
              {data.year ?? "—"} · {data.detectedType === "series" ? `série, ${data.seasons ?? 1} saison(s)` : "film"} ·
              langues : {(data.languages ?? []).join(", ").toUpperCase()}
            </p>
            <button
              type="button"
              className="mf-lookup__cta"
              onClick={() =>
                onPlay({
                  id: data.tmdb_id ?? id,
                  type: data.detectedType === "series" ? "series" : "movie",
                  title: data.title ?? `TMDB ${id}`,
                  seasons: data.seasons,
                  languages: data.languages,
                })
              }
            >
              <Zap size={15} /> Lire maintenant
            </button>
          </>
        )}
      </div>
      {data?.poster && state.status === "ready" ? (
        <img className="mf-lookup__poster" src={data.poster} alt="" aria-hidden="true" />
      ) : null}
    </MetalCard>
  );
}
