export type SavedTab = "sentences" | "words" | "notes";
export type Tab = SavedTab | "today" | "organize" | "settings" | "capture" | "menu" | "writing";
export const savedTabStorageKey = "phraseNestLastSavedTab";

export function isSavedTab(tab: unknown): tab is SavedTab {
  return tab === "sentences" || tab === "words" || tab === "notes";
}

export function resolveTab(requested: string | null, lastSaved: unknown): Tab {
  if (requested === "library") return isSavedTab(lastSaved) ? lastSaved : "sentences";
  return isSavedTab(requested) || requested === "capture" || requested === "organize" || requested === "settings" || requested === "menu" || requested === "writing" ? requested : "today";
}

export function primaryTab(tab: Tab): "capture" | "today" | "library" | "menu" {
  if (isSavedTab(tab)) return "library";
  if (tab === "organize" || tab === "settings" || tab === "writing") return "menu";
  return tab;
}
