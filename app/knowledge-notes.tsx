"use client";

import { useEffect, useRef, useState } from "react";
import { loadKnowledgeNotes, saveKnowledgeNote, setKnowledgeNoteReviewFlag } from "./supabase-browser";
import { filterKnowledgeNotes, knowledgeNoteDraftChanged, knowledgeNoteTemplates, mergeKnowledgeNote, type KnowledgeNote, type KnowledgeNoteDraft } from "./knowledge-notes-data";
import { renderKnowledgeNoteEditor } from "./knowledge-note-editor";

const dateLabel = (value: string) => new Intl.DateTimeFormat("ja-JP", { year:"numeric", month:"short", day:"numeric", timeZone:"Asia/Tokyo" }).format(new Date(value));

export function KnowledgeNotesView({ active = true, onCountChange, onCreateNote, savedNote, openNoteRequest }: {
  active?: boolean; onCountChange?: (count: number) => void; onCreateNote: () => void;
  savedNote?: KnowledgeNote | null; openNoteRequest?: KnowledgeNote | null;
}) {
  const [notes, setNotes] = useState<KnowledgeNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<KnowledgeNoteDraft | null>(null);
  const [templateId, setTemplateId] = useState(knowledgeNoteTemplates[0].id);
  const [busy, setBusy] = useState(false);
  const loadingRef = useRef(false);
  const savingRef = useRef(false);
  const mounted = useRef(false);
  const latestSaved = useRef<KnowledgeNote | null>(null);
  const handledOpenRequest = useRef<KnowledgeNote | null>(null);
  const dirty = knowledgeNoteDraftChanged(draft);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    latestSaved.current = savedNote || null;
    if (savedNote) setNotes(current => mergeKnowledgeNote(current, savedNote));
  }, [savedNote]);
  useEffect(() => {
    if (!openNoteRequest || handledOpenRequest.current === openNoteRequest) return;
    // A saved-note shortcut must not discard a different note still being edited.
    if (draft) { setError("編集中のノートが残っています。保存またはキャンセルすると、選んだノートを開きます。"); return; }
    handledOpenRequest.current = openNoteRequest;
    setNotes(current => mergeKnowledgeNote(current, openNoteRequest));
    setOpenedId(openNoteRequest.id); setError(""); setMessage("");
  }, [openNoteRequest, draft]);
  useEffect(() => { if (active && !loaded) void reload(); }, [active, loaded]);
  useEffect(() => { if (loaded) onCountChange?.(notes.length); }, [notes, loaded, onCountChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty || savingRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function reload() {
    if (loadingRef.current || savingRef.current) return;
    loadingRef.current = true; setLoading(true); setError("");
    try { const rows = await loadKnowledgeNotes(); if (mounted.current) { setNotes(latestSaved.current ? mergeKnowledgeNote(rows, latestSaved.current) : rows); setLoaded(true); } }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "知識ノートを読み込めませんでした。再読み込みでお試しください。"); }
    finally { loadingRef.current = false; if (mounted.current) setLoading(false); }
  }

  function edit(note: KnowledgeNote) {
    setDraft({ id:note.id, title:note.title, body:note.body, needs_review:note.needs_review, expectedUpdatedAt:note.updated_at,
      original:{ title:note.title, body:note.body, needs_review:note.needs_review } });
    setError(""); setMessage("");
  }

  function cancel() {
    if (savingRef.current || (dirty && !window.confirm("未保存の入力があります。変更を破棄して戻りますか？"))) return;
    setDraft(null); setError("");
  }

  function replaceSaved(note: KnowledgeNote) {
    setNotes(current => mergeKnowledgeNote(current, note));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || savingRef.current) return;
    savingRef.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const saved = await saveKnowledgeNote(draft.id, draft, draft.expectedUpdatedAt);
      if (!mounted.current) return;
      replaceSaved(saved); setOpenedId(saved.id); setDraft(null); setMessage("知識ノートを保存しました。");
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "保存できませんでした。入力内容は残しています。"); }
    finally { savingRef.current = false; if (mounted.current) setBusy(false); }
  }

  async function toggleFlag(note: KnowledgeNote) {
    if (savingRef.current || loadingRef.current) return;
    savingRef.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const saved = await setKnowledgeNoteReviewFlag(note, !note.needs_review);
      if (mounted.current) { replaceSaved(saved); setMessage(saved.needs_review ? "あとで確認する目印を付けました。" : "確認の目印を外しました。"); }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "目印を変更できませんでした。前の状態を残しています。"); }
    finally { savingRef.current = false; if (mounted.current) setBusy(false); }
  }

  // Stay mounted across app navigation so unsaved drafts and the current note survive.
  if (!active) return null;
  const opened = notes.find(note => note.id === openedId);
  const visible = filterKnowledgeNotes(notes, query, reviewOnly);

  return <section className="knowledge-notes" aria-label="知識ノート">
    {error && <div className="manual-feedback error" role="alert"><p>{error}</p>{!draft && openedId && <button type="button" className="edit-button" disabled={loading || busy} onClick={() => void reload()}>再読み込み</button>}</div>}
    {message && <p className="manual-feedback" role="status">{message}</p>}
    {draft ? renderKnowledgeNoteEditor({ draft, dirty, busy, templateId, onDraftChange:setDraft, onTemplateChange:setTemplateId, onSubmit:save, onCancel:cancel }) : opened ? <article className="knowledge-reader">
      <div className="knowledge-actions"><button type="button" className="edit-button" disabled={busy} onClick={() => { setOpenedId(null); setMessage(""); }}>ノート一覧に戻る</button><button type="button" className="edit-button" disabled={busy} onClick={() => edit(opened)}>ノートを編集</button></div>
      <h2>{opened.title}</h2><div className="knowledge-meta"><time dateTime={opened.updated_at}>更新：{dateLabel(opened.updated_at)}</time><button type="button" className="knowledge-bookmark" aria-pressed={opened.needs_review} disabled={busy || loading} onClick={() => void toggleFlag(opened)}>{opened.needs_review ? "確認の目印を外す" : "あとで確認する"}</button></div>
      <p className="knowledge-body">{opened.body}</p>
    </article> : <>
      <div className="knowledge-heading"><div><h2>知識ノート</h2><p>例文なしで、文法・使い分け・調べものをまとめられます。</p></div><button type="button" className="primary-button" disabled={busy} onClick={onCreateNote}>ノートを書く</button></div>
      <div className="toolbar knowledge-toolbar"><input type="search" aria-label="知識ノートを検索" placeholder="タイトル・本文を検索" value={query} onChange={event => setQuery(event.target.value)} /><div className="filter-group"><button type="button" className={!reviewOnly ? "selected" : ""} aria-pressed={!reviewOnly} onClick={() => setReviewOnly(false)}>すべて {notes.length}</button><button type="button" className={reviewOnly ? "selected" : ""} aria-pressed={reviewOnly} onClick={() => setReviewOnly(true)}>あとで確認 {notes.filter(note => note.needs_review).length}</button></div><button type="button" className="edit-button" disabled={loading || busy} onClick={() => void reload()}>再読み込み</button></div>
      {loading && <p className="knowledge-help" role="status">知識ノートを読み込んでいます…</p>}
      {visible.length ? <div className="note-list">{visible.map(note => <article className="note-card knowledge-card" key={note.id}>
        <div className="note-card-heading"><h3><button type="button" className="knowledge-title" onClick={() => { setOpenedId(note.id); setMessage(""); }}>{note.title}</button></h3><button type="button" className="knowledge-bookmark" aria-label={`${note.title}をあとで確認する`} aria-pressed={note.needs_review} disabled={busy || loading} onClick={() => void toggleFlag(note)}>{note.needs_review ? "確認待ち" : "あとで確認"}</button></div>
        <p className="knowledge-preview">{note.body}</p><div className="knowledge-meta"><time dateTime={note.updated_at}>更新：{dateLabel(note.updated_at)}</time><button type="button" className="edit-button" onClick={() => { setOpenedId(note.id); setMessage(""); }}>ノートを読む</button></div>
      </article>)}</div> : loaded && !loading && <div className="list-empty"><h3>{query.trim() || reviewOnly ? "条件に合う知識ノートがありません" : "知識ノートはまだありません"}</h3><p>{query.trim() || reviewOnly ? "検索や絞り込みを変えてください。" : "「ノートを書く」から、タイトルと本文だけで保存できます。"}</p></div>}
    </>}
  </section>;
}
