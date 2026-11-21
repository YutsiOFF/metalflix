import { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";

/** What Chrome/Edge hand us before showing their own install prompt. */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** True once the app already runs from the home screen (or a browser tab). */
function alreadyInstalled(): boolean {
  const modes = ["standalone", "fullscreen", "minimal-ui"];
  if (modes.some((mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches)) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iOS never fires beforeinstallprompt: it only has the Share menu. */
function isAppleMobile(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export default function InstallButton() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(alreadyInstalled);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      // Keep the event: the browser requires prompt() to run from a click.
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  if (installed) return null;

  const install = async () => {
    if (!prompt) {
      setOpen((value) => !value);
      return;
    }
    setOpen(false);
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setPrompt(null);
  };

  return (
    <div className="mf-install" ref={box}>
      <button
        type="button"
        className="mf-account-btn mf-install__btn"
        onClick={install}
        aria-expanded={open}
        aria-label="Installer MetalFlix sur l'écran d'accueil"
        title="Installer MetalFlix sur l'écran d'accueil"
      >
        <Download size={15} />
        <span className="mf-install__label">Installer</span>
      </button>

      {open ? (
        <div className="mf-install__hint" role="dialog" aria-label="Installer MetalFlix">
          <button type="button" className="mf-install__close" onClick={() => setOpen(false)} aria-label="Fermer">
            <X size={13} />
          </button>
          {isAppleMobile() ? (
            <p>
              Dans Safari, touchez le bouton <strong>Partager</strong> (le carré avec la flèche), puis{" "}
              <strong>Sur l'écran d'accueil</strong>.
            </p>
          ) : (
            <p>
              Ouvrez le menu du navigateur (<strong>⋮</strong> ou <strong>…</strong>) puis{" "}
              <strong>Installer l'application</strong> — sur ordinateur comme sur téléphone.
            </p>
          )}
          <p className="mf-install__note">MetalFlix s'ouvre alors comme une application, sans barre d'adresse.</p>
        </div>
      ) : null}
    </div>
  );
}
