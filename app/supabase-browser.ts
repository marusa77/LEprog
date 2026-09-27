export type BrowserSession = { access_token: string; refresh_token: string; expires_at: number; user?: { email?: string } };
export type VocabularyRow = { id: string; term: string; meaning: string; note: string; status: "unlearned" | "learning" | "mastered"; occurrence_count: number; next_review_at: string };
export type SentenceRow = { id: string; original_text: string; translation: string; note: string; subreddit: string | null; created_at: string };

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") || "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const storageKey = "phrase-nest-web-session";

export const supabaseConfigured = Boolean(projectUrl && publishableKey && !projectUrl.includes("YOUR_PROJECT"));

export function captureSessionFromUrl(): BrowserSession | null {
  if (typeof window === "undefined" || !window.location.hash.includes("access_token")) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return null;
  const session = { access_token: accessToken, refresh_token: refreshToken, expires_at: Math.floor(Date.now() / 1000) + Number(params.get("expires_in") || 3600) };
  localStorage.setItem(storageKey, JSON.stringify(session));
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return session;
}

export function getStoredSession(): BrowserSession | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(storageKey) || "null"); } catch { return null; }
}

export function signInWithGoogle() {
  const redirect = `${window.location.origin}${window.location.pathname}`;
  window.location.href = `${projectUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}`;
}

export function signOut() {
  localStorage.removeItem(storageKey);
  window.location.reload();
}

async function currentSession() {
  const session = getStoredSession();
  if (!session?.refresh_token) throw new Error("ログインが必要です");
  if (session.expires_at * 1000 > Date.now() + 60000) return session;
  const response = await fetch(`${projectUrl}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: publishableKey, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
  const refreshed = await response.json();
  if (!response.ok) { localStorage.removeItem(storageKey); throw new Error("ログインの有効期限が切れました"); }
  localStorage.setItem(storageKey, JSON.stringify(refreshed));
  return refreshed as BrowserSession;
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await currentSession();
  const response = await fetch(`${projectUrl}${path}`, { ...init, headers: { apikey: publishableKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || result.error || "データを取得できませんでした");
  return result as T;
}

export async function loadLearningData() {
  const [vocabulary, savedSentences] = await Promise.all([
    rest<VocabularyRow[]>("/rest/v1/vocabulary_items?select=*&order=next_review_at.asc"),
    rest<SentenceRow[]>("/rest/v1/sentences?select=*&order=created_at.desc&limit=100"),
  ]);
  return { vocabulary, savedSentences };
}

export async function submitReview(id: string, result: "forgot" | "uncertain" | "remembered") {
  return rest<{ status: string; next_review_at: string; interval_days: number }>("/rest/v1/rpc/record_review", { method: "POST", body: JSON.stringify({ p_vocabulary_id: id, p_result: result }) });
}
