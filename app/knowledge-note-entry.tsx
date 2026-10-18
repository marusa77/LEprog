"use client";

import { useEffect, useRef, useState } from "react";
import { saveKnowledgeNote } from "./supabase-browser";
import { knowledgeNoteDraftChanged, knowledgeNoteTemplates, type KnowledgeNote, type KnowledgeNoteDraft } from "./knowledge-notes-data";
import { renderKnowledgeNoteEditor } from "./knowledge-note-editor";

const emptyDraft = (): KnowledgeNoteDraft => ({ id:"", title:"", body:"", needs_review:false, expectedUpdatedAt:null, original:null });

export function KnowledgeNoteEntryView({ onSaved, onOpenSaved }: { onSaved: (note: KnowledgeNote) => void; onOpenSaved: (note: KnowledgeNote) => void }) {
  const [draft, setDraft] = useState<KnowledgeNoteDraft>(emptyDraft);
  const [templateId, setTemplateId] = useState(knowledgeNoteTemplates[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastSaved, setLastSaved] = useState<KnowledgeNote | null>(null);
  const saving = useRef(false);
  const pendingId = useRef<string | null>(null);
  const mounted = useRef(false);
  const dirty = knowledgeNoteDraftChanged(draft);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || saving.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current || !draft.title.trim() || !draft.body.trim()) return;
    saving.current = true; setBusy(true); setError("");
    try {
      // Keep the same ID across a failed request; allocate a new one only after success.
      pendingId.current ||= crypto.randomUUID();
      const note = await saveKnowledgeNote(pendingId.current, draft, null);
      if (!mounted.current) return;
      pendingId.current = null; setDraft(emptyDraft()); setLastSaved(note); onSaved(note);
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "保存できませんでした。入力内容は残しています。"); }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  }

  function clear() {
    if (saving.current || (dirty && !window.confirm("未保存の入力を消しますか？"))) return;
    // Explicitly clearing starts a different note; an ordinary retry keeps its ID.
    pendingId.current = null; setDraft(emptyDraft()); setError("");
  }

  return <section className="knowledge-note-entry" aria-label="知識ノートの入力">
    {lastSaved && <div className="manual-feedback" role="status"><p>「{lastSaved.title}」を保存しました。続けて新しいノートを書けます。</p><button type="button" className="plain-action" onClick={() => onOpenSaved(lastSaved)}>保存したノートを見る</button></div>}
    {error && <p className="manual-feedback error" role="alert">{error}</p>}
    {renderKnowledgeNoteEditor({ draft, dirty, busy, templateId, clearLabel:"入力をクリア", onDraftChange:setDraft, onTemplateChange:setTemplateId, onSubmit:save, onCancel:clear })}
  </section>;
}
