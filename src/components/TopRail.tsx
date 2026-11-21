import { useEffect, useState } from "react";
import { loadBackdrops } from "../lib/artwork";
import { topNote, type Title } from "../lib/catalog";

interface TopRailProps {
  /** Ten films, already ordered: the row reads them as a ranking. */
  items: Title[];
  onOpen: (item: Title) => void;
}

/**
 * « Top 10 des films aujourd'hui », right under the studio tiles.
 *
 * Wide stills rather than posters, because the rank behind each card only
 * exists to frame a 16:9 image. The stills come from the same backdrop lookup
 * the hero uses (a portrait poster cropped into a banner cuts faces in half);
 * a title without one falls back to its poster.
 *
 * Inside the card sits the original title, the way a film's own logo art does
 * on the service this row imitates; the French title is the caption below.
 * The section itself is washed with the first film's still, so the row opens on
 * a colour instead of a flat page.
 */
/**
 * TMDB serves every width from the same path. The cards ask for 780 (they are
 * ~430px wide, so that covers a retina screen) and the section background for
 * 1280: the band spans the whole page, and a small file stretched across it is
 * exactly what reads as pixelated.
 */
function sized(url: string, width: "w1280" | "w780"): string {
  // Posters arrive as /w500/ and backdrops as /original/, so both are rewritten.
  return url.replace(/\/t\/p\/(?:original|w\d+)\//, `/t/p/${width}/`);
}

export default function TopRail({ items, onOpen }: TopRailProps) {
  const [stills, setStills] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!items.length) return;
    let alive = true;
    const merge = (map: Record<string, string>) =>
      setStills((known) => ({ ...known, ...map }));

    // The first film's backdrop is asked for on its own: it is the section's
    // background, and waiting for all ten left the band empty for a moment.
    loadBackdrops([items[0].id]).then((map) => {
      if (alive) merge(map);
    });
    loadBackdrops(items.map((item) => item.id)).then((map) => {
      if (alive) merge(map);
    });
    return () => {
      alive = false;
    };
  }, [items]);

  if (!items.length) return null;

  // Only a real backdrop goes behind the row. A portrait poster stretched over
  // a full-width band is what made the section look pixelated.
  const wash = stills[String(items[0].id)] || "";

  return (
    <section className="mf-top" aria-label="Top 10 des films aujourd'hui">
      {wash ? (
        <div
          className="mf-top__wash"
          style={{ backgroundImage: `url(${sized(wash, "w1280")})` }}
          aria-hidden="true"
        />
      ) : null}

      <div className="mf-top__head">
        <h2>Top 10 des films aujourd'hui</h2>
        <span>Une sélection qui tourne chaque jour</span>
      </div>

      <ol className="mf-top__track">
        {items.map((item, index) => {
          const still = stills[String(item.id)] || item.poster || "";
          const note = topNote(item.id);
          return (
            <li className="mf-top__item" key={item.id}>
              <span className="mf-top__rank" aria-hidden="true">
                {index + 1}
              </span>

              <div className="mf-top__body">
                <button
                  type="button"
                  className="mf-top__card"
                  onClick={() => onOpen(item)}
                  aria-label={`Lire ${item.title}${item.year ? ` (${item.year})` : ""}`}
                >
                  {still ? (
                    <img
                      src={sized(still, "w780")}
                      alt=""
                      loading={index < 3 ? "eager" : "lazy"}
                      decoding="async"
                    />
                  ) : (
                    <span className="mf-top__empty" aria-hidden="true" />
                  )}
                  <span className="mf-top__veil" aria-hidden="true" />
                  <strong className="mf-top__title">{item.alt || item.title}</strong>
                </button>

                <p className="mf-top__meta">
                  <span>{item.title}</span>
                  {note != null ? (
                    <small className="mf-top__note">{note.toFixed(1).replace(".", ",")}</small>
                  ) : null}
                  {item.year ? <small>{item.year}</small> : null}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
