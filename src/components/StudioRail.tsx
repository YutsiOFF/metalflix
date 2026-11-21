import type { PlatformKey } from "../lib/catalog";
import appletvLogo from "../assets/studios/appletv.svg";
import disneyLogo from "../assets/studios/disney.svg";
import netflixLogo from "../assets/studios/netflix.svg";
import paramountLogo from "../assets/studios/paramount.svg";
import primeLogo from "../assets/studios/prime.svg";

interface StudioRailProps {
  /** Only the services that actually carry something, with their title count. */
  counts: { key: PlatformKey; label: string; count: number }[];
  active: PlatformKey | "all";
  onPick: (key: PlatformKey) => void;
}

/**
 * The brand wordmarks, shipped as SVG. Drawing them in CSS was close for
 * Paramount and wrong for Disney+ and TV+; the real marks read instantly, and
 * each tile keeps its own background so the row looks like the services rather
 * than a set of cards. Every mark is white on its brand colour, except Netflix,
 * whose red is the one colour that reads on black.
 */
const LOGO: Record<PlatformKey, string | null> = {
  netflix: netflixLogo,
  prime: primeLogo,
  disney: disneyLogo,
  paramount: paramountLogo,
  // The Commons file for Canal+ is a filled plate, not a bare wordmark: forced
  // white it becomes a white rectangle. This one is still drawn.
  canal: null,
  appletv: appletvLogo,
};

/** The "Plateformes & studios" row: one brand tile per service carrying titles. */
export default function StudioRail({ counts, active, onPick }: StudioRailProps) {
  if (!counts.length) return null;

  return (
    <section className="mf-studios" aria-label="Plateformes et studios">
      <div className="mf-studios__head">
        <h2>Plateformes &amp; studios</h2>
        <span className="mf-studios__hint">Filtrer le catalogue</span>
      </div>

      <div className="mf-studios__track">
        {counts.map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            className={`mf-studio mf-studio--${key}${active === key ? " is-active" : ""}`}
            onClick={() => onPick(key)}
            aria-pressed={active === key || undefined}
            aria-label={`${label} — ${count.toLocaleString("fr-FR")} titres`}
          >
            {LOGO[key] ? (
              <img
                className="mf-studio__logo"
                src={LOGO[key] ?? ""}
                alt=""
                aria-hidden="true"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="mf-studio__word" aria-hidden="true">
                CANAL+
              </span>
            )}
            <span className="mf-studio__meta">{count.toLocaleString("fr-FR")} titres</span>
          </button>
        ))}
      </div>
    </section>
  );
}
