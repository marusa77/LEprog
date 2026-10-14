import { buildManualCapture, type CaptureResult, type ManualEntry } from "./manual-entry-data";
import { activityRange, type ActivitySentence, type ActivityReview } from "./learning-activity";
import { buildWritingCapture, type WritingEntry } from "./writing-practice-data";
import { isReviewPreference, type ReviewPreference, type SentenceStudyMetadata } from "./sentence-study-data";

export type BrowserSession = { access_token: string; refresh_token: string; expires_at: number; user?: { email?: string } };
export type VocabularyRow = { id: string; term: string; meaning: string; core_image: string; note: string; status: "unlearned" | "learning" | "mastered"; occurrence_count: number; next_review_at: string; created_at: string; updated_at: string; organization_checked_at: string | null };
export type SentenceRow = { id: string; original_text: string; translation: string; note: string; subreddit: string | null; source_title: string | null; source_url: string | null; created_at: string; updated_at: string; organization_checked_at: string | null; review_preference?: ReviewPreference; last_reviewed_at?: string | null; sentence_review_count?: number };
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

async function restPaged<T>(path: string, pageSize = 500): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const separator = path.includes("?") ? "&" : "?";
    const page = await rest<T[]>(`${path}${separator}limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function loadLearningData() {
  const month = new Date();
  const monthStart = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-01`;
  const [vocabulary, savedSentences, links, usageRows] = await Promise.all([
    restPaged<VocabularyRow>("/rest/v1/vocabulary_items?select=*&order=next_review_at.asc"),
    restPaged<SentenceRow>("/rest/v1/sentences?select=*&order=created_at.desc,id.desc"),
    restPaged<SentenceVocabularyRow>("/rest/v1/sentence_vocabulary?select=sentence_id,vocabulary_id,selected_text"),
    rest<MonthlyUsageRow[]>(`/rest/v1/monthly_usage?select=cloud_translation_characters,ai_estimated_usd&month=eq.${monthStart}&limit=1`),
  ]);
  return { vocabulary, savedSentences, links, usage: usageRows[0] || { cloud_translation_characters: 0, ai_estimated_usd: 0 } };
}

export async function submitReview(id: string, result: "forgot" | "uncertain" | "remembered") {
  return rest<{ status: "unlearned" | "learning" | "mastered"; next_review_at: string; interval_days: number }>("/rest/v1/rpc/record_review", { method: "POST", body: JSON.stringify({ p_vocabulary_id: id, p_result: result }) });
}

function sentenceStudyError(error: unknown): never {
  if (error instanceof Error && /PGRST202|PGRST204|42703|Could not find.*(?:function|column)|does not exist/i.test(error.message)) {
    throw new Error("英文の復習記録の準備が必要です。Supabaseで0005_sentence_study.sqlを実行してから、ページを再読み込みしてください。");
  }
  throw error;
}

export async function updateSentenceReviewPreference(id: string, preference: ReviewPreference): Promise<SentenceStudyMetadata> {
  if (!id || !isReviewPreference(preference)) throw new Error("英文と復習の出やすさを確認してください。");
  try {
    const rows = await rest<SentenceStudyMetadata[]>(`/rest/v1/sentences?id=eq.${encodeURIComponent(id)}&select=id,review_preference,last_reviewed_at,sentence_review_count`, {
      method:"PATCH", headers:{ Prefer:"return=representation" }, body:JSON.stringify({ review_preference:preference }),
    });
    if (!rows[0]) throw new Error("復習の出やすさを保存できませんでした。");
    return rows[0];
  } catch (error) { return sentenceStudyError(error); }
}

export async function submitSentenceReview(id: string, reviewId: string): Promise<SentenceStudyMetadata> {
  if (!id || !reviewId) throw new Error("復習する英文を確認してください。");
  try {
    return await rest<SentenceStudyMetadata>("/rest/v1/rpc/record_sentence_review", {
      method:"POST", body:JSON.stringify({ p_sentence_id:id, p_review_id:reviewId }),
    });
  } catch (error) { return sentenceStudyError(error); }
}

export async function loadLearningActivity(today: string) {
  const range = activityRange(today);
  // Read only timestamps/IDs in the visible range, through the existing user-specific policies.
  // Sequential requests also avoid introducing parallel login refreshes here.
  const sentences = await restPaged<ActivitySentence>(`/rest/v1/sentences?select=id,created_at&created_at=gte.${encodeURIComponent(range.from)}&created_at=lt.${encodeURIComponent(range.until)}&order=created_at.asc,id.asc`);
  const reviews = await restPaged<ActivityReview>(`/rest/v1/review_logs?select=vocabulary_id,reviewed_at&reviewed_at=gte.${encodeURIComponent(range.from)}&reviewed_at=lt.${encodeURIComponent(range.until)}&order=reviewed_at.asc,id.asc`);
  return { sentences, reviews };
}

export async function saveManualEntry(entry: ManualEntry) {
  const payload = buildManualCapture(entry);
  return rest<CaptureResult>("/rest/v1/rpc/save_capture", { method: "POST", body: JSON.stringify(payload) });
}

export async function saveWritingEntry(entry: WritingEntry, sentenceId: string | null = null): Promise<CaptureResult> {
  const payload = buildWritingCapture(entry);
  if (!sentenceId) return rest<CaptureResult>("/rest/v1/rpc/save_capture", { method: "POST", body: JSON.stringify(payload) });
  // Keep the original composition and vocabulary untouched when adding feedback later.
  const rows = await rest<SentenceRow[]>(`/rest/v1/sentences?id=eq.${encodeURIComponent(sentenceId)}&source_title=eq.${encodeURIComponent("英作文")}&select=id`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ translation: payload.p_translation, note: payload.p_note, updated_at: new Date().toISOString() }),
  });
  if (!rows[0]?.id) throw new Error("英作文を更新できませんでした。入力内容は残しています。");
  return { sentence_id: rows[0].id, terms: [] };
}

export async function translateManualText(text: string, source: "en" | "ja", target: "en" | "ja") {
  if (source === target) throw new Error("英語と日本語のどちらに翻訳するか選んでください。");
  const trimmed = text.trim();
  if (!trimmed) throw new Error(source === "en" ? "翻訳する英文を入力してください。" : "英語にしたい日本語を入力してください。");
  if (trimmed.length > 5000) throw new Error("翻訳は一度に5,000文字までです。短く分けてください。");
  const result = await rest<{ translation: string; translations?: string[]; monthlyCharacters: number; monthlyLimit: number }>("/functions/v1/translate", { method: "POST", body: JSON.stringify({ texts: [trimmed], source, target }) });
  if (typeof result.translation !== "string" || !result.translation.trim()) throw new Error("翻訳結果を取得できませんでした。入力内容は残しています。");
  return result;
}

export async function updateVocabularyItem(id: string, changes: { meaning: string; core_image: string; note: string; status: "unlearned" | "learning" | "mastered" }) {
  const rows = await rest<VocabularyRow[]>(`/rest/v1/vocabulary_items?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...changes, updated_at: new Date().toISOString() }),
  });
  if (!rows[0]) throw new Error("語句を更新できませんでした");
  return rows[0];
}

export async function appendVocabularyDetails(id: string, additions: { meaning: string; core_image: string; note: string }) {
  const meaning = additions.meaning.trim(), coreImage = additions.core_image.trim(), note = additions.note.trim();
  if (!id || (!meaning && !coreImage && !note)) throw new Error("追記する意味・コアイメージ・メモのいずれかを入力してください。");
  try {
    return await rest<VocabularyRow>("/rest/v1/rpc/append_vocabulary_details", {
      method: "POST",
      body: JSON.stringify({ p_vocabulary_id: id, p_meaning: meaning, p_core_image: coreImage, p_note: note }),
    });
  } catch (error) {
    if (error instanceof Error && /PGRST202|Could not find the function/i.test(error.message)) throw new Error("追記機能の準備が必要です。Supabaseで0004_append_vocabulary_details.sqlを実行してください。入力内容は残しています。");
    throw error;
  }
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

export async function applyOrganizationResult(
  processedSources: Array<{ kind: "vocabulary" | "sentence"; id: string }>,
  suggestions: Array<Record<string, unknown>>,
) {
  return rest<{ applied: number; processed: number }>("/rest/v1/rpc/apply_organization_result", {
    method: "POST",
    body: JSON.stringify({ p_processed_sources: processedSources, p_suggestions: suggestions }),
  });
}
