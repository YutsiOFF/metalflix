import { useEffect, useState } from "react";
import { MetalButton } from "argentui";
import { LogIn, ShieldCheck, UserPlus, X } from "lucide-react";
import { listProfiles, signIn, signUp, type Profile } from "../lib/accounts";

interface AccountModalProps {
  onClose: () => void;
  onAuthenticated: (profile: Profile) => void;
}

export default function AccountModal({ onClose, onAuthenticated }: AccountModalProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const profiles = listProfiles();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const profile = mode === "signup" ? await signUp(name, password) : await signIn(name, password);
      onAuthenticated(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mf-modal mf-modal--auth" role="dialog" aria-modal="true" aria-label="Compte MetalFlix">
      <button type="button" className="mf-modal__backdrop" aria-label="Fermer" onClick={onClose} />
      <div className="mf-auth">
        <header className="mf-auth__head">
          <div>
            <h2>{mode === "signup" ? "Créer un compte" : "Se connecter"}</h2>
            <p>Gratuit, sans serveur : votre profil et votre historique restent sur cet appareil.</p>
          </div>
          <MetalButton tone="gunmetal" size="sm" radius={999} icon={<X size={15} />} onClick={onClose}>
            Fermer
          </MetalButton>
        </header>

        <div className="mf-auth__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signin"}
            className={`mf-chip mf-chip--button${mode === "signin" ? " is-active" : ""}`}
            onClick={() => {
              setMode("signin");
              setError(null);
            }}
          >
            <LogIn size={13} /> Connexion
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            className={`mf-chip mf-chip--button${mode === "signup" ? " is-active" : ""}`}
            onClick={() => {
              setMode("signup");
              setError(null);
            }}
          >
            <UserPlus size={13} /> Inscription
          </button>
        </div>

        <form className="mf-auth__form" onSubmit={submit}>
          <label className="mf-field">
            <span>Nom du profil</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="username"
              placeholder="Kyllian"
              required
            />
          </label>
          <label className="mf-field">
            <span>Mot de passe</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder="6 caractères minimum"
              required
            />
          </label>

          {error ? <p className="mf-auth__error">{error}</p> : null}

          <MetalButton tone="gold" size="lg" type="submit" disabled={busy} halo>
            {busy ? "Un instant…" : mode === "signup" ? "Créer mon compte" : "Entrer"}
          </MetalButton>
        </form>

        {profiles.length > 0 ? (
          <div className="mf-auth__profiles">
            <p>Profils sur cet appareil</p>
            <div>
              {profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  className="mf-chip mf-chip--button"
                  onClick={() => {
                    setMode("signin");
                    setName(profile.name);
                    setPassword("");
                  }}
                >
                  {profile.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <p className="mf-auth__note">
          <ShieldCheck size={14} /> Mot de passe salé et étiré (PBKDF2-SHA256, 150 000 tours) dans le stockage local du
          navigateur. Aucune donnée n'est envoyée sur un serveur.
        </p>
      </div>
    </div>
  );
}
