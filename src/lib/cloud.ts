/**
 * Cloud accounts and sync, on Supabase's free tier (no SDK, plain fetch).
 *
 * Visitors keep the same form as before — a name and a password. Behind it the
 * name becomes a private e-mail-shaped login (nobody types or receives an
 * e-mail), and the library (history, positions, watchlist) lives in one JSON
 * row per account, protected by row-level security: a signed-in user can only
 * read and write their own row.
 *
 * Until SUPABASE_URL and SUPABASE_ANON_KEY are filled in, everything stays on
 * the device exactly as before.
 */

/** Filled in once, from the Supabase project's Settings → API page. */
export const SUPABASE_URL = "https://zexijakukodhutedcfyi.supabase.co";
/** The *publishable* key: made to sit in a public site, the table's policies guard the data. Never the secret key. */
export const SUPABASE_ANON_KEY = "sb_publishable_xu6ZBmDedeVVQtHF2j0QTA__TTRZFcE";

const SESSION_KEY = "metalflix.cloud.session.v1";
const LOGIN_DOMAIN = "metalflix-sync.app";

export interface CloudSession {
  accessToken: string;
  refreshToken: string;
  /** ms since epoch */
  expiresAt: number;
  userId: string;
  name: string;
}

export function cloudEnabled(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/** "Yutsi" and "yutsi " are the same account everywhere. */
function loginFor(name: string): string {
  const slug = name
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "profil"}@${LOGIN_DOMAIN}`;
}

export function readSession(): CloudSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as CloudSession) : null;
  } catch {
    return null;
  }
}

function saveSession(session: CloudSession | null) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

export function clearSession() {
  saveSession(null);
}

interface AuthAnswer {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id: string; user_metadata?: { name?: string } };
  msg?: string;
  error_description?: string;
  error_code?: string;
  code?: number;
}

async function auth(path: string, body: unknown): Promise<AuthAnswer> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as AuthAnswer;
  if (!res.ok) {
    const code = data.error_code ?? "";
    if (code === "user_already_exists" || /already registered/i.test(data.msg ?? ""))
      throw new Error("Ce nom est déjà pris : connecte-toi plutôt.");
    if (code === "invalid_credentials" || /invalid login/i.test(data.error_description ?? data.msg ?? ""))
      throw new Error("Nom ou mot de passe incorrect.");
    if (code === "weak_password") throw new Error("Le mot de passe doit faire 6 caractères minimum.");
    throw new Error(data.msg || data.error_description || `Serveur de comptes : erreur ${res.status}`);
  }
  return data;
}

function toSession(data: AuthAnswer, name: string): CloudSession {
  if (!data.access_token || !data.refresh_token || !data.user) {
    throw new Error("Le serveur de comptes n'a pas ouvert de session.");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    userId: data.user.id,
    name: data.user.user_metadata?.name || name,
  };
}

export async function cloudSignUp(name: string, password: string): Promise<CloudSession> {
  const data = await auth("signup", { email: loginFor(name), password, data: { name: name.trim() } });
  const session = toSession(data, name.trim());
  saveSession(session);
  return session;
}

export async function cloudSignIn(name: string, password: string): Promise<CloudSession> {
  const data = await auth("token?grant_type=password", { email: loginFor(name), password });
  const session = toSession(data, name.trim());
  saveSession(session);
  return session;
}

/** A valid access token, refreshed when it is about to expire. */
async function token(): Promise<CloudSession | null> {
  const session = readSession();
  if (!session) return null;
  if (session.expiresAt - Date.now() > 60_000) return session;
  try {
    const data = await auth("token?grant_type=refresh_token", { refresh_token: session.refreshToken });
    const fresh = toSession(data, session.name);
    saveSession(fresh);
    return fresh;
  } catch {
    return null;
  }
}

export interface CloudDoc {
  history: unknown[];
  watchlist: unknown[];
  /** id → ms when it was removed, so a removal on one device sticks on the others. */
  removedHistory?: Record<string, number>;
  removedWatchlist?: Record<string, number>;
}

/** The account's row, or null when it has none yet. */
export async function pullDoc(): Promise<CloudDoc | null> {
  const session = await token();
  if (!session) throw new Error("no-session");
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/libraries?select=data&user_id=eq.${encodeURIComponent(session.userId)}`,
    { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${session.accessToken}` }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`pull ${res.status}`);
  const rows = (await res.json()) as { data: CloudDoc }[];
  return rows[0]?.data ?? null;
}

export async function pushDoc(doc: CloudDoc): Promise<void> {
  const session = await token();
  if (!session) throw new Error("no-session");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/libraries?on_conflict=user_id`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${session.accessToken}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ user_id: session.userId, data: doc, updated_at: new Date().toISOString() }),
    keepalive: true,
  });
  if (!res.ok) throw new Error(`push ${res.status}`);
}
