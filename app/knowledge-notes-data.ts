export type KnowledgeNote = {
  id: string; title: string; body: string; needs_review: boolean;
  created_at: string; updated_at: string;
};
export type KnowledgeNoteInput = Pick<KnowledgeNote, "title" | "body" | "needs_review">;
export const knowledgeNoteLimits = { title: 200, body: 50000 };

export const knowledgeNoteTemplates = [
  { id: "comparison", label: "使い分け", body: "【一言でまとめると】\n\n【パターンと使い分け】\n・\n・\n\n【間違えやすいところ】\n\n【例文（必要なら）】\n" },
  { id: "grammar", label: "文法の整理", body: "【一言でまとめると】\n\n【形・ルール】\n\n【使う場面】\n\n【間違えやすいところ】\n\n【例文（必要なら）】\n" },
  { id: "research", label: "調べもの", body: "【知りたかったこと】\n\n【調べて分かったこと】\n\n【自分なりの説明】\n\n【まだ確認したいこと】\n\n【参考にしたもの（任意）】\n" },
];

export function validateKnowledgeNote(input: KnowledgeNoteInput): KnowledgeNoteInput {
  const title = input.title.trim();
  if (!title) throw new Error("ノートのタイトルを入力してください。");
  if (!input.body.trim()) throw new Error("ノートの本文を入力してください。日本語だけでも保存できます。");
  if (Array.from(title).length > knowledgeNoteLimits.title) throw new Error("タイトルは200文字以内にしてください。");
  if (Array.from(input.body).length > knowledgeNoteLimits.body) throw new Error("本文は50,000文字以内にしてください。");
  if (typeof input.needs_review !== "boolean") throw new Error("確認の目印を確認してください。");
  // Preserve paragraphs, indentation and trailing newlines exactly as written.
  return { title, body: input.body, needs_review: input.needs_review };
}

export function appendKnowledgeTemplate(body: string, templateId: string) {
  const template = knowledgeNoteTemplates.find(item => item.id === templateId);
  if (!template) return body;
  return body ? `${body}${body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n"}${template.body}` : template.body;
}

export function filterKnowledgeNotes(notes: KnowledgeNote[], query: string, needsReviewOnly = false) {
  const needle = query.trim().toLocaleLowerCase();
  return notes.filter(note => (!needsReviewOnly || note.needs_review) &&
    (!needle || `${note.title}\n${note.body}`.toLocaleLowerCase().includes(needle)))
    .sort((first, second) => second.updated_at.localeCompare(first.updated_at) || first.id.localeCompare(second.id));
}
