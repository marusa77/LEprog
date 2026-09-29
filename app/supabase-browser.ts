export type BrowserSession = { access_token: string; refresh_token: string; expires_at: number; user?: { email?: string } };
export type VocabularyRow = { id: string; term: string; meaning: string; note: string; status: "unlearned" | "learning" | "mastered"; occurrence_count: number; next_review_at: string };
export type SentenceRow = { id: string; original_text: string; translation: string; note: string; subreddit: string | null; created_at: string };
export type SentenceVocabularyRow = { sentence_id: string; vocabulary_id: string; selected_text: string };
export type MonthlyUsageRow = { cloud_translation_characters: number; ai_estimated_usd: number | string };
export type SupabaseConfiguration = { projectUrl: string; publishableKey: string };

const envProjectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") || "";
const envPublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const sessionStorageKey = "phrase-nest-web-session";
const configStorageKey = "phrase-nest-web-config";
const returnTabStorageKey = "phrase-nest-web-return-tab";

export function getSupabaseConfiguration(): SupabaseConfiguration | null {
  if (typeof window !== "undefined") {
    try {
      const stored = JSON.parse(localStorage.getItem(configStorageKey) || "null") as SupabaseConfiguration | null;
      if (stored?.projectUrl && stored.publishableKey) return stored;
    } catch { /* Use build-time configuration instead. */ }
  }
  if (envProjectUrl && envPublishableKey && !envProjectUrl.includes("YOUR_PROJECT")) {
    return { projectUrl: envProjectUrl, publishableKey: envPublishableKey };
  }
  return null;
}

export async function saveSupabaseConfiguration(projectUrl: string, publishableKey: string) {
  const normalizedUrl = projectUrl.trim().replace(/\/$/, "");
  const normalizedKey = publishableKey.trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(normalizedUrl)) throw new Error("Project URLの形式を確認してください");
  if (!normalizedKey.startsWith("sb_publishable_") && !normalizedKey.startsWith("eyJ")) throw new Error("Publishable keyを確認してください");
  const response = await fetch(`${normalizedUrl}/auth/v1/settings`, { headers: { apikey: normalizedKey } });
  if (response.status === 401 || response.status === 403) throw new Error("Publishable keyが正しくありません");
  if (!response.ok) throw new Error("Supabaseへ接続できませんでした");
  localStorage.setItem(configStorageKey, JSON.stringify({ projectUrl: normalizedUrl, publishableKey: normalizedKey }));
}

export function captureSessionFromUrl(): BrowserSession | null {
  if (typeof window === "undefined" || !window.location.hash.includes("access_token")) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return null;
  const session = { access_token: accessToken, refresh_token: refreshToken, expires_at: Math.floor(Date.now() / 1000) + Number(params.get("expires_in") || 3600) };
  localStorage.setItem(sessionStorageKey, JSON.stringify(session));
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return session;
}

export function getStoredSession(): BrowserSession | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(sessionStorageKey) || "null"); } catch { return null; }
}

export function signInWithGoogle() {
  const config = getSupabaseConfiguration();
  if (!config) throw new Error("Supabaseの接続設定が必要です");
  const requestedTab = new URLSearchParams(window.location.search).get("tab");
  if (requestedTab) localStorage.setItem(returnTabStorageKey, requestedTab);
  const redirect = `${window.location.origin}${window.location.pathname}`;
  window.location.href = `${config.projectUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}`;
}

export function consumeReturnTab() {
  const value = localStorage.getItem(returnTabStorageKey);
  localStorage.removeItem(returnTabStorageKey);
  return value;
}

export function signOut() {
  localStorage.removeItem(sessionStorageKey);
  window.location.reload();
}

async function currentSession() {
  const config = getSupabaseConfiguration();
  if (!config) throw new Error("Supabaseの接続設定が必要です");
  const session = getStoredSession();
  if (!session?.refresh_token) throw new Error("ログインが必要です");
  if (session.expires_at * 1000 > Date.now() + 60000) return session;
  const response = await fetch(`${config.projectUrl}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: config.publishableKey, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
  const refreshed = await response.json();
  if (!response.ok) { localStorage.removeItem(sessionStorageKey); throw new Error("ログインの有効期限が切れました"); }
  localStorage.setItem(sessionStorageKey, JSON.stringify(refreshed));
  return refreshed as BrowserSession;
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = getSupabaseConfiguration();
  if (!config) throw new Error("Supabaseの接続設定が必要です");
  const session = await currentSession();
  const response = await fetch(`${config.projectUrl}${path}`, { ...init, headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || result.error || "データを取得できませんでした");
  return result as T;
}

export async function loadLearningData() {
  const month = new Date();
  const monthStart = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-01`;
  const [vocabulary, savedSentences, links, usageRows] = await Promise.all([
    rest<VocabularyRow[]>("/rest/v1/vocabulary_items?select=*&order=next_review_at.asc"),
    rest<SentenceRow[]>("/rest/v1/sentences?select=*&order=created_at.desc&limit=100"),
    rest<SentenceVocabularyRow[]>("/rest/v1/sentence_vocabulary?select=sentence_id,vocabulary_id,selected_text"),
    rest<MonthlyUsageRow[]>(`/rest/v1/monthly_usage?select=cloud_translation_characters,ai_estimated_usd&month=eq.${monthStart}&limit=1`),
  ]);
  return { vocabulary, savedSentences, links, usage: usageRows[0] || { cloud_translation_characters: 0, ai_estimated_usd: 0 } };
}

export async function submitReview(id: string, result: "forgot" | "uncertain" | "remembered") {
  return rest<{ status: "unlearned" | "learning" | "mastered"; next_review_at: string; interval_days: number }>("/rest/v1/rpc/record_review", { method: "POST", body: JSON.stringify({ p_vocabulary_id: id, p_result: result }) });
}

export async function updateVocabularyItem(id: string, changes: { meaning: string; note: string; status: "unlearned" | "learning" | "mastered" }) {
  const rows = await rest<VocabularyRow[]>(`/rest/v1/vocabulary_items?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...changes, updated_at: new Date().toISOString() }),
  });
  if (!rows[0]) throw new Error("語句を更新できませんでした");
  return rows[0];
}

export async function updateSentence(id: string, changes: { translation: string; note: string }) {
  const rows = await rest<SentenceRow[]>(`/rest/v1/sentences?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...changes, updated_at: new Date().toISOString() }),
  });
  if (!rows[0]) throw new Error("英文を更新できませんでした");
  return rows[0];
}
