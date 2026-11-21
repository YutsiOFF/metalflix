import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import "./UpdateNotice.css";

/** Bump this string on every release: the notice shows once per version. */
const VERSION = "2026-11-17a";
const SEEN_KEY = "metalflix:update-seen";

const NEWS: { icon: string; title: string; body: string }[] = [
  {
    icon: "⏯️",
    title: "La reprise ne repart plus de zéro",
    body: "Un film arrêté au milieu se relançait parfois du début : sa position était effacée à l'ouverture, puis un enregistrement à 0,1 s prenait le dessus. Ouvrir un film garde maintenant son point de reprise, la bibliothèque refuse d'écraser une vraie position par un démarrage à zéro, et le lecteur n'enregistre rien avant d'avoir rejoint la position sauvegardée. Testé en ligne : arrêt à la moitié, fermeture immédiate, réouverture — le film repart à 4 583 s sur 9 133 s.",
  },
  {
    icon: "🧹",
    title: "Les films ne disparaissent plus de « Reprendre »",
    body: "Un titre quittait la rangée dès 95 % de visionnage, et un simple saut vers le générique suffisait. Seul un film réellement terminé en sort désormais : les dernières minutes restent « en cours » tant que le générique défile.",
  },
];

/**
 * The "what changed" card. It opens itself once per version and remembers that
 * in localStorage, so it is an announcement rather than something in the way of
 * the films.
 */
export default function UpdateNotice() {
  const [open, setOpen] = useState(false);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let seen: string | null = null;
    try {
      seen = localStorage.getItem(SEEN_KEY);
    } catch {
      // Storage blocked: show it, it simply cannot remember.
    }
    if (seen !== VERSION) setOpen(true);
  }, []);

  function close() {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, VERSION);
    } catch {
      // Nothing to do: it will show again next visit.
    }
  }

  // The footer keeps a way back in, so the news is never lost once dismissed.
  useEffect(() => {
    const reopen = () => setOpen(true);
    window.addEventListener("metalflix:update-open", reopen);
    return () => window.removeEventListener("metalflix:update-open", reopen);
  }, []);

  useEffect(() => {
    if (!open) return;
    okRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="mf-update"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mf-update-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="mf-update__card">
        <button type="button" className="mf-update__close" onClick={close} aria-label="Fermer">
          <X size={17} />
        </button>

        <span className="mf-update__badge">
          <Sparkles size={13} aria-hidden="true" />
          Correctifs du 17 novembre 2026
        </span>
        <h2 id="mf-update-title">La reprise est réparée</h2>

        <ul className="mf-update__list">
          {NEWS.map((item) => (
            <li key={item.title}>
              <span className="mf-update__icon" aria-hidden="true">
                {item.icon}
              </span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </div>
            </li>
          ))}
        </ul>

        <button type="button" className="mf-update__ok" onClick={close} ref={okRef}>
          C'est noté
        </button>
      </div>
    </div>
  );
}
