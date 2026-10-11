export type ManualTerm = { term: string; meaning: string; core_image: string; note: string };
export type ManualEntry = { english: string; japanese: string; note: string; origin: "daily" | "external"; sourceUrl: string; terms: ManualTerm[]; machineTranslation?: string | null };
export type CapturePayload = { p_original_text: string; p_machine_translation: string | null; p_translation: string; p_note: string; p_source_url: string | null; p_source_title: string; p_subreddit: string | null; p_terms: ManualTerm[] };
export type CaptureResult = { sentence_id: string; terms: Array<{ id: string; term: string; existing: boolean }>; details_appending?: boolean };

export function buildManualCapture(entry: ManualEntry): CapturePayload {
  const english = entry.english.trim();
  const japanese = entry.japanese.trim();
  if (!english) throw new Error("保存する英文を入力してください。");
  if (!japanese) throw new Error("日本語訳・言いたいことを入力してください。翻訳ボタンは使わなくても構いません。");
  const sourceUrl = entry.sourceUrl.trim();
  if (sourceUrl) {
    let url: URL;
    try { url = new URL(sourceUrl); } catch { throw new Error("参照URLは https:// または http:// から入力してください。"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("参照URLには、ログイン情報を含まない通常のWebページのURLを入力してください。");
  }
  const seen = new Set<string>();
  const terms: ManualTerm[] = [];
  for (const row of entry.terms) {
    const term = row.term.trim().replace(/\s+/g, " ");
    const meaning = row.meaning.trim();
    const coreImage = row.core_image.trim();
    const note = row.note.trim();
    if (!term && !meaning && !coreImage && !note) continue;
    if (!term) throw new Error("意味やメモを入力した行には、語句も入力してください。");
    if (!meaning) throw new Error(`「${term}」の意味を入力してください。`);
    const normalized = term.toLowerCase();
    if (seen.has(normalized)) throw new Error(`「${term}」が入力欄で重複しています。1行にまとめてください。`);
    seen.add(normalized);
    terms.push({ term, meaning, core_image: coreImage, note });
  }
  return {
    p_original_text: english,
    p_machine_translation: entry.machineTranslation || null,
    p_translation: japanese,
    p_note: entry.note.trim(),
    p_source_url: sourceUrl || null,
    p_source_title: entry.origin === "external" || sourceUrl ? "外部から入力" : "日常・自分用",
    p_subreddit: null,
    p_terms: terms,
  };
}

export function sentenceSourceLabel(sentence: { subreddit: string | null; source_title?: string | null; source_url?: string | null }) {
  if (sentence.subreddit) return sentence.subreddit;
  if (sentence.source_title === "外部から入力" || sentence.source_title === "日常・自分用" || sentence.source_title === "英作文") return sentence.source_title;
  if (sentence.source_url) {
    try {
      const host = new URL(sentence.source_url).hostname;
      if (/(^|\.)reddit\.com$/i.test(host)) return "Reddit";
      return host;
    } catch { /* Old records can have an incomplete source URL. */ }
  }
  return "手入力";
}
