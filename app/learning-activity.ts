export type ActivitySentence = { id: string; created_at: string };
export type ActivityReview = { vocabulary_id: string; reviewed_at: string };
export type ActivityDay = { date: string; saves: number; reviews: number; total: number; level: number; future: boolean };

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

export function buildActivityDays(today: string, sentences: ActivitySentence[], reviews: ActivityReview[]): ActivityDay[] {
  const { start } = activityRange(today);
  const savesByDay = new Map<string, Set<string>>();
  const reviewsByDay = new Map<string, Set<string>>();
  for (const sentence of sentences) {
    const key = japanDateKey(sentence.created_at);
    if (!key || !sentence.id) continue;
    const ids = savesByDay.get(key) || new Set<string>();
    ids.add(sentence.id);
    savesByDay.set(key, ids);
  }
  for (const review of reviews) {
    const key = japanDateKey(review.reviewed_at);
    if (!key || !review.vocabulary_id) continue;
    const ids = reviewsByDay.get(key) || new Set<string>();
    ids.add(review.vocabulary_id);
    reviewsByDay.set(key, ids);
  }
  return Array.from({ length: 56 }, (_, index) => {
    const date = shiftDateKey(start, index);
    const future = date > today;
    const saves = future ? 0 : savesByDay.get(date)?.size || 0;
    const reviewCount = future ? 0 : reviewsByDay.get(date)?.size || 0;
    const total = saves + reviewCount;
    return { date, saves, reviews: reviewCount, total, level: activityLevel(total), future };
  });
}

export function activityDayLabel(day: ActivityDay): string {
  const [year, month, date] = day.date.split("-");
  return `${year}年${Number(month)}月${Number(date)}日：英文の保存 ${day.saves}件・復習 ${day.reviews}語`;
}
