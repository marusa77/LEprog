export type ActivitySentence = { id: string; created_at: string };
export type ActivityReview = { vocabulary_id: string; reviewed_at: string };
export type ActivitySource = "sentence" | "vocabulary" | "knowledge" | "phrase" | "translation";
export type ActivityEvent = { kind: "save" | "review" | "lookup"; source: ActivitySource; subject_key: string; occurred_at: string };
export type ActivityData = { sentences: ActivitySentence[]; reviews: ActivityReview[]; events?: ActivityEvent[]; notice?: string };
export type ActivityDay = { date: string; saves: number; reviews: number; lookups: number; sentenceReviews: number; wordReviews: number; noteReviews: number; total: number; level: number; future: boolean };

const japanDateFormatter = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });

export function japanDateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : japanDateFormatter.format(date);
}

export function shiftDateKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function activityRange(today: string) {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  const start = shiftDateKey(today, -mondayOffset - 49);
  return {
    start,
    end: shiftDateKey(start, 56),
    from: new Date(`${start}T00:00:00+09:00`).toISOString(),
    until: new Date(`${shiftDateKey(today, 1)}T00:00:00+09:00`).toISOString(),
  };
}

export function activityLevel(total: number): number {
  return total <= 0 ? 0 : total === 1 ? 1 : total <= 4 ? 2 : total <= 9 ? 3 : 4;
}

export function buildActivityDays(today: string, sentences: ActivitySentence[], reviews: ActivityReview[], events: ActivityEvent[] = []): ActivityDay[] {
  const { start } = activityRange(today);
  const savesByDay = new Map<string, Set<string>>();
  const reviewsByDay = new Map<string, Set<string>>();
  const lookupsByDay = new Map<string, Set<string>>();
  for (const sentence of sentences) {
    const key = japanDateKey(sentence.created_at);
    if (!key || !sentence.id) continue;
    const ids = savesByDay.get(key) || new Set<string>();
    ids.add(`sentence:${sentence.id}`);
    savesByDay.set(key, ids);
  }
  for (const review of reviews) {
    const key = japanDateKey(review.reviewed_at);
    if (!key || !review.vocabulary_id) continue;
    const ids = reviewsByDay.get(key) || new Set<string>();
    ids.add(`vocabulary:${review.vocabulary_id}`);
    reviewsByDay.set(key, ids);
  }
  for (const event of events) {
    const key = japanDateKey(event.occurred_at);
    if (!key || !event.subject_key || !["sentence", "vocabulary", "knowledge", "phrase", "translation"].includes(event.source)) continue;
    const map = event.kind === "save" ? savesByDay : event.kind === "review" ? reviewsByDay : event.kind === "lookup" ? lookupsByDay : null;
    if (!map || (event.kind === "lookup") !== (event.source === "translation") || (event.kind === "review" && event.source === "phrase")) continue;
    const ids = map.get(key) || new Set<string>();
    ids.add(`${event.source}:${event.kind === "lookup" ? "daily" : event.subject_key}`);
    map.set(key, ids);
  }
  return Array.from({ length: 56 }, (_, index) => {
    const date = shiftDateKey(start, index);
    const future = date > today;
    const saves = future ? 0 : savesByDay.get(date)?.size || 0;
    const reviewCount = future ? 0 : reviewsByDay.get(date)?.size || 0;
    const lookups = future ? 0 : lookupsByDay.get(date)?.size || 0;
    const reviewed = future ? [] : Array.from(reviewsByDay.get(date) || []);
    const sentenceReviews = reviewed.filter(id => id.startsWith("sentence:")).length;
    const wordReviews = reviewed.filter(id => id.startsWith("vocabulary:")).length;
    const noteReviews = reviewed.filter(id => id.startsWith("knowledge:")).length;
    const total = saves + reviewCount + lookups;
    return { date, saves, reviews: reviewCount, lookups, sentenceReviews, wordReviews, noteReviews, total, level: activityLevel(total), future };
  });
}

export function activityDayLabel(day: ActivityDay): string {
  const [year, month, date] = day.date.split("-");
  return `${year}年${Number(month)}月${Number(date)}日：保存・追記 ${day.saves}件・復習 ${day.reviews}件（英文 ${day.sentenceReviews}件・語句 ${day.wordReviews}件・ノート ${day.noteReviews}件）・調べもの ${day.lookups}件`;
}
