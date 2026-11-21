/**
 * Local accounts for MetalFlix.
 *
 * The site is static (GitHub Pages), so there is no server to hold users: an
 * account here is a profile on this browser, with the password stretched by
 * PBKDF2-SHA256 (WebCrypto) and only the salt + hash stored. Nothing leaves the
 * device, nothing costs anything, and the profile can be exported as JSON.
 */

export interface Profile {
  id: string;
  name: string;
  createdAt: number;
  password: { salt: string; hash: string; iterations: number };
}

const ACCOUNTS_KEY = "metalflix.accounts.v1";
const SESSION_KEY = "metalflix.session.v1";
const ITERATIONS = 150_000;

const enc = new TextEncoder();

function readAccounts(): Profile[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Profile[]) : [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts: Profile[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function stretch(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return toBase64(bits);
}

export function listProfiles(): Profile[] {
  return readAccounts().sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export function currentProfileId(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** `crypto.randomUUID` arrived in Chrome 92 — not on most smart TVs. */
function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function signUp(name: string, password: string): Promise<Profile> {
  const clean = normalizeName(name);
  if (clean.length < 2) throw new Error("Choisissez un nom d'au moins 2 caractères.");
  if (password.length < 6) throw new Error("Le mot de passe doit faire 6 caractères minimum.");
  const accounts = readAccounts();
  if (accounts.some((a) => a.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error("Ce nom est déjà pris sur cet appareil.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const profile: Profile = {
    id: newId(),
    name: clean,
    createdAt: Date.now(),
    password: { salt: toBase64(salt), hash: await stretch(password, salt, ITERATIONS), iterations: ITERATIONS },
  };
  accounts.push(profile);
  writeAccounts(accounts);
  localStorage.setItem(SESSION_KEY, profile.id);
  return profile;
}

export async function signIn(name: string, password: string): Promise<Profile> {
  const clean = normalizeName(name).toLowerCase();
  const profile = readAccounts().find((a) => a.name.toLowerCase() === clean);
  if (!profile) throw new Error("Aucun compte de ce nom sur cet appareil.");
  // A profile left by the short-lived online accounts has no local password:
  // the first sign-in here sets it, so nobody is locked out of their history.
  if (!profile.password.hash) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    profile.password = { salt: toBase64(salt), hash: await stretch(password, salt, ITERATIONS), iterations: ITERATIONS };
    writeAccounts(readAccounts().map((a) => (a.id === profile.id ? profile : a)));
    localStorage.setItem(SESSION_KEY, profile.id);
    return profile;
  }
  const hash = await stretch(password, fromBase64(profile.password.salt), profile.password.iterations ?? ITERATIONS);
  if (hash !== profile.password.hash) throw new Error("Mot de passe incorrect.");
  localStorage.setItem(SESSION_KEY, profile.id);
  return profile;
}

export function signOut() {
  localStorage.removeItem(SESSION_KEY);
}

export function deleteProfile(id: string) {
  writeAccounts(readAccounts().filter((a) => a.id !== id));
  localStorage.removeItem(`metalflix.library.${id}`);
  if (currentProfileId() === id) signOut();
}
