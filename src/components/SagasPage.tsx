import { ArrowLeft, Library } from "lucide-react";
import type { Title } from "../lib/catalog";
import { sagaRuntime, type Saga } from "../lib/sagas";
import PosterCard from "./PosterCard";

interface SagasPageProps {
  sagas: Saga[] | null;
  failed: boolean;
  /** Open saga (from #/sagas/<id>), or null for the list. */
  openId: string | null;
  onOpenSaga: (id: string | null) => void;
  onOpen: (item: Title) => void;
  wantedIds: Set<number>;
  onToggleWatch: (item: Title) => void;
}

function Meta({ saga }: { saga: Saga }) {
  const runtime = sagaRuntime(saga.minutes);
  return (
    <p className="mf-saga__meta">
      <span className="mf-saga__count">{saga.films.length} films</span>
      {saga.from ? <span>{saga.from === saga.to ? saga.from : `${saga.from} - ${saga.to}`}</span> : null}
      {runtime ? <span>{runtime}</span> : null}
    </p>
  );
}

/**
 * « Sagas » : one card per saga, its posters fanned out, then the saga's own
 * page with every film in release order.
 */
export default function SagasPage({ sagas, failed, openId, onOpenSaga, onOpen, wantedIds, onToggleWatch }: SagasPageProps) {
  const open = openId && sagas ? sagas.find((saga) => saga.id === openId) ?? null : null;

  if (open) {
    return (
      <section className="mf-section mf-sagas">
        <button type="button" className="mf-sagas__back" onClick={() => onOpenSaga(null)}>
          <ArrowLeft size={16} /> Toutes les sagas
        </button>
        <div className="mf-sagas__head">
          <h1>{open.name}</h1>
          <Meta saga={open} />
        </div>
        <div className="mf-grid">
          {open.films.map((item) => (
            <PosterCard
              key={item.id}
              item={item}
              onOpen={onOpen}
              wanted={wantedIds.has(item.id)}
              onToggleWatch={onToggleWatch}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="mf-section mf-sagas">
      <div className="mf-sagas__head">
        <h1>
          <Library size={22} /> Sagas
        </h1>
        {sagas ? <p className="mf-sagas__sub">{sagas.length} sagas disponibles, des premiers films aux derniers.</p> : null}
      </div>

      {!sagas ? (
        failed ? (
          <div className="mf-panel mf-empty">
            <h3>Sagas indisponibles</h3>
            <p>La liste des sagas n'a pas pu être chargée. Réessaie dans un moment.</p>
          </div>
        ) : (
          <div className="mf-loading">
            <div className="mf-loader" aria-hidden="true" />
            <p>Chargement des sagas…</p>
          </div>
        )
      ) : (
        <ul className="mf-sagas__grid">
          {sagas.map((saga) => (
            <li key={saga.id}>
              <button type="button" className="mf-saga" onClick={() => onOpenSaga(saga.id)}>
                <span className={`mf-saga__stack mf-saga__stack--${Math.min(saga.films.length, 4)}`}>
                  {saga.films.slice(0, 4).map((item) => (
                    <img key={item.id} src={item.poster} alt="" loading="lazy" decoding="async" />
                  ))}
                </span>
                <strong className="mf-saga__name">{saga.name}</strong>
                <Meta saga={saga} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
