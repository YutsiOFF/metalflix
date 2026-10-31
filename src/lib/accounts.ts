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
    id: crypto.randomUUID(),
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
