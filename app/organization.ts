export type OrganizationSource = {
  kind: "vocabulary" | "sentence";
  id: string;
  updated_at: string;
  term?: string;
  meaning?: string;
  core_image?: string;
  note?: string;
  original_text?: string;
  translation?: string;
  saved_terms?: string[];
};

export type OrganizationSuggestion = {
  id: string;
  type: "core_image" | "phrase";
  source_id: string;
  vocabulary_id?: string;
  sentence_id?: string;
  term?: string;
  meaning?: string;
  proposed_core_image?: string;
  note?: string;
  reason: string;
  confidence: "high" | "medium" | "low";
};

export type OrganizationResult = {
  schema: "phrasenest-organization-result-v1";
  export_id: string;
  processed_sources: Array<{ kind: "vocabulary" | "sentence"; id: string }>;
  suggestions: OrganizationSuggestion[];
};

type ExportWord = {
  id: string;
  term: string;
  meaning: string;
  coreImage: string;
  note: string;
  example: string;
  translation: string;
  updatedAt: string;
  organizationCheckedAt: string | null;
};

type ExportSentence = {
  id: string;
  source: string;
  translation: string;
  note: string;
  terms: string[];
  updatedAt: string;
  organizationCheckedAt: string | null;
};

export type ExportPreset = { label: string; maxItems: number; maxCharacters: number };

export const exportPresets: ExportPreset[] = [
  { label: "少なめ", maxItems: 20, maxCharacters: 8000 },
  { label: "標準", maxItems: 50, maxCharacters: 20000 },
  { label: "多め", maxItems: 100, maxCharacters: 40000 },
];

function isPending(updatedAt: string, checkedAt: string | null) {
  return !checkedAt || new Date(updatedAt).getTime() > new Date(checkedAt).getTime();
}

export function countPendingOrganizationItems(words: ExportWord[], sentences: ExportSentence[]) {
  return sentences.filter((sentence) => isPending(sentence.updatedAt, sentence.organizationCheckedAt)).length
    + words.filter((word) => word.note && isPending(word.updatedAt, word.organizationCheckedAt)).length;
}

function clip(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}…（省略）`;
}

export function buildOrganizationExport(words: ExportWord[], sentences: ExportSentence[], preset: ExportPreset) {
  const candidates: OrganizationSource[] = [
    ...sentences.filter((sentence) => isPending(sentence.updatedAt, sentence.organizationCheckedAt)).map((sentence) => ({
      kind: "sentence" as const,
      id: sentence.id,
      updated_at: sentence.updatedAt,
      original_text: clip(sentence.source, 1800),
      translation: clip(sentence.translation, 1200),
      note: clip(sentence.note, 2000),
      saved_terms: sentence.terms.slice(0, 20),
    })),
    ...words.filter((word) => word.note && isPending(word.updatedAt, word.organizationCheckedAt)).map((word) => ({
      kind: "vocabulary" as const,
      id: word.id,
      updated_at: word.updatedAt,
      term: clip(word.term, 200),
      meaning: clip(word.meaning, 800),
      core_image: clip(word.coreImage, 1200),
      note: clip(word.note, 2000),
      original_text: clip(word.example, 1200),
      translation: clip(word.translation, 800),
    })),
  ].sort((left, right) => new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime());

  const selected: OrganizationSource[] = [];
  let characterCount = 0;
  for (const candidate of candidates) {
    const nextCharacters = JSON.stringify(candidate).length;
    if (selected.length >= preset.maxItems) break;
    if (selected.length && characterCount + nextCharacters > preset.maxCharacters) break;
    selected.push(candidate);
    characterCount += nextCharacters;
  }

  const exportId = `pn-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const payload = {
    schema: "phrasenest-organization-export-v1",
    export_id: exportId,
    created_at: new Date().toISOString(),
    limits: { max_items: preset.maxItems, max_characters: preset.maxCharacters },
    instructions: {
      guide: "docs/organization-guide.md",
      preserve_original_notes: true,
      maximum_suggestions_per_source: 3,
      output_schema: "phrasenest-organization-result-v1",
    },
    sources: selected,
  };
  const serialized = JSON.stringify(payload, null, 2);
  return { payload, serialized, itemCount: selected.length, characterCount: serialized.length, estimatedTokens: Math.ceil(serialized.length / 2) };
}

export function parseOrganizationResult(text: string): OrganizationResult {
  if (text.length > 1_000_000) throw new Error("整理結果のファイルが大きすぎます");
  const value = JSON.parse(text) as Partial<OrganizationResult>;
  if (value.schema !== "phrasenest-organization-result-v1" || !value.export_id) throw new Error("PhraseNestの整理結果ファイルではありません");
  if (!Array.isArray(value.processed_sources) || !Array.isArray(value.suggestions)) throw new Error("整理結果の形式が正しくありません");
  if (value.processed_sources.length > 200 || value.suggestions.length > 300) throw new Error("一度に読み込める件数を超えています");
  for (const source of value.processed_sources) {
    if (!source?.id || (source.kind !== "vocabulary" && source.kind !== "sentence")) throw new Error("整理対象の情報が正しくありません");
  }
  for (const suggestion of value.suggestions) {
    if (!suggestion?.id || !suggestion.source_id || !suggestion.reason || !["core_image", "phrase"].includes(suggestion.type)) throw new Error("整理候補の情報が正しくありません");
    if (!["high", "medium", "low"].includes(suggestion.confidence)) throw new Error("整理候補の確信度が正しくありません");
    if (suggestion.type === "core_image" && (!suggestion.vocabulary_id || !suggestion.proposed_core_image || suggestion.proposed_core_image.length > 2000)) throw new Error("コアイメージ候補の形式が正しくありません");
    if (suggestion.type === "phrase" && (!suggestion.sentence_id || !suggestion.term || suggestion.term.length > 200)) throw new Error("熟語候補の形式が正しくありません");
  }
  return value as OrganizationResult;
}
