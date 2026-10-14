export type ReviewPreference = "less" | "normal" | "more";
export type SentenceOrder = "recent" | "random" | "study";
export type SentenceStudyMetadata = { id: string; review_preference: ReviewPreference; last_reviewed_at: string | null; sentence_review_count: number };
export type StudySentence = {
  id: string; source: string; translation: string; note: string; community: string; sourceUrl: string | null;
  savedAt: string; terms: string[]; createdAt: string; updatedAt: string; organizationCheckedAt: string | null;
  reviewPreference: ReviewPreference; lastReviewedAt: string | null; reviewCount: number; reviewReady: boolean;
};

export const reviewPreferenceLabels: Record<ReviewPreference, string> = { less: "少なめ", normal: "通常", more: "多め" };

export function isReviewPreference(value: unknown): value is ReviewPreference {
  return value === "less" || value === "normal" || value === "more";
}

export function sentenceStudyWeight(sentence: Pick<StudySentence, "lastReviewedAt" | "reviewPreference">, now = Date.now()): number {
  const reviewedAt = sentence.lastReviewedAt ? Date.parse(sentence.lastReviewedAt) : NaN;
  // A save/edit date is NOT evidence that the user has read the sentence again.
  const days = Number.isFinite(reviewedAt) ? Math.max(0, (now - reviewedAt) / 86_400_000) : null;
  const ageWeight = days === null ? 6 : 0.25 + Math.min(days / 7, 5.75);
  const preferenceWeight = sentence.reviewPreference === "more" ? 2 : sentence.reviewPreference === "less" ? 0.35 : 1;
  return ageWeight * preferenceWeight;
}

export function orderStudySentences<T extends Pick<StudySentence, "id" | "createdAt" | "lastReviewedAt" | "reviewPreference">>(
  sentences: T[], mode: SentenceOrder, random = Math.random, now = Date.now(),
): T[] {
  const unique = [...new Map(sentences.map(sentence => [sentence.id, sentence])).values()];
  if (mode === "recent") return unique.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || a.id.localeCompare(b.id));
  const draw = () => Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, random()));
  if (mode === "random") {
    for (let i = unique.length - 1; i > 0; i--) { const j = Math.floor(draw() * (i + 1)); [unique[i], unique[j]] = [unique[j], unique[i]]; }
    return unique;
  }
  const weights = unique.map(sentence => sentenceStudyWeight(sentence, now));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  // Blend weighted selection with equal opportunity; even "less" never has zero probability.
  // Exponential keys produce a weighted order without repeating a sentence in the round.
  return unique.map((sentence, index) => ({ sentence, key: -Math.log(draw()) / (0.25 / unique.length + 0.75 * weights[index] / total) }))
    .sort((a, b) => a.key - b.key || a.sentence.id.localeCompare(b.sentence.id)).map(item => item.sentence);
}

export function retainSentenceOrder<T extends { id: string }>(sentences: T[], ids: string[]): T[] {
  const byId = new Map(sentences.map(sentence => [sentence.id, sentence]));
  const result: T[] = [];
  for (const id of ids) { const sentence = byId.get(id); if (sentence) { result.push(sentence); byId.delete(id); } }
  // Changes to notes or weights must not move the sentence that is currently being read.
  return [...result, ...byId.values()];
}

export function sentenceStudySummary(sentence: Pick<StudySentence, "lastReviewedAt" | "reviewCount">): string {
  if (!sentence.lastReviewedAt || !Number.isFinite(Date.parse(sentence.lastReviewedAt))) return "まだ復習していません";
  const date = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month:"short", day:"numeric" }).format(new Date(sentence.lastReviewedAt));
  return `復習 ${sentence.reviewCount}回 · 最後 ${date}`;
}
