"use client";

import { useEffect, useRef, useState } from "react";
import { loadKnowledgeNotes, saveKnowledgeNote, setKnowledgeNoteReviewFlag } from "./supabase-browser";
import { appendKnowledgeTemplate, filterKnowledgeNotes, knowledgeNoteLimits, knowledgeNoteTemplates, type KnowledgeNote, type KnowledgeNoteInput } from "./knowledge-notes-data";

type Draft = KnowledgeNoteInput & { id: string; expectedUpdatedAt: string | null; original: KnowledgeNoteInput | null };
const dateLabel = (value: string) => new Intl.DateTimeFormat("ja-JP", { year:"numeric", month:"short", day:"numeric", timeZone:"Asia/Tokyo" }).format(new Date(value));

export function KnowledgeNotesView({ active = true, onCountChange }: { active?: boolean; onCountChange?: (count: number) => void }) {
  const [notes, setNotes] = useState<KnowledgeNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [templateId, setTemplateId] = useState(knowledgeNoteTemplates[0].id);
  const [busy, setBusy] = useState(false);
  const loadingRef = useRef(false);
  const savingRef = useRef(false);
  const mounted = useRef(false);
  const dirty = Boolean(draft && (draft.original
    ? draft.title !== draft.original.title || draft.body !== draft.original.body || draft.needs_review !== draft.original.needs_review
    : draft.title || draft.body || draft.needs_review));

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
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
    try { const rows = await loadKnowledgeNotes(); if (mounted.current) { setNotes(rows); setLoaded(true); } }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "知識ノートを読み込めませんでした。再読み込みでお試しください。"); }
    finally { loadingRef.current = false; if (mounted.current) setLoading(false); }
  }

  function beginNew() {
    if (savingRef.current || loadingRef.current) return;
    setDraft({ id:crypto.randomUUID(), title:"", body:"", needs_review:false, expectedUpdatedAt:null, original:null });
    setMessage(""); setError("");
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
    setNotes(current => [note, ...current.filter(item => item.id !== note.id)]);
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
    {draft ? <form className="knowledge-editor" onSubmit={save}>
      <div className="knowledge-heading"><h2>{draft.expectedUpdatedAt ? "知識ノートを編集" : "知識ノートを書く"}</h2><span className="knowledge-draft-state" role="status">{busy ? "保存中…" : dirty ? "未保存の変更があります" : draft.original ? "保存内容から変更なし" : "未保存のノートです"}</span></div>
      <fieldset disabled={busy}>
        <label>タイトル<input autoFocus value={draft.title} onChange={event => setDraft({ ...draft, title:event.target.value })} placeholder="例：used to の使い分け" maxLength={knowledgeNoteLimits.title} required /></label>
        <div className="knowledge-template"><label>ひな形（任意）<select value={templateId} onChange={event => setTemplateId(event.target.value)}>{knowledgeNoteTemplates.map(template => <option key={template.id} value={template.id}>{template.label}</option>)}</select></label>
          <button type="button" className="edit-button" onClick={() => setDraft({ ...draft, body:appendKnowledgeTemplate(draft.body, templateId) })}>ひな形を本文に追加</button><small>入力済みの内容は消さず、末尾に追加します。見出しは自由に変更・削除できます。</small></div>
        <label>本文<textarea value={draft.body} onChange={event => setDraft({ ...draft, body:event.target.value })} rows={16} placeholder="日本語だけでもOK。文法の整理、表現の比較、調べたことなどを自由に記録できます。例文は必須ではありません。" maxLength={knowledgeNoteLimits.body} required /></label>
        <label className="knowledge-flag"><input type="checkbox" checked={draft.needs_review} onChange={event => setDraft({ ...draft, needs_review:event.target.checked })} />あとで確認する</label>
      </fieldset>
      <p className="knowledge-help">保存ボタンで保存します。画面を切り替えても入力は残りますが、ページの再読み込みで未保存の入力は失われます。AI・翻訳APIは使いません。</p>
      <div className="knowledge-actions"><button type="button" className="plain-action" disabled={busy} onClick={cancel}>キャンセル</button><button type="submit" className="primary-button" disabled={busy || !draft.title.trim() || !draft.body.trim() || !dirty}>{busy ? "保存中…" : "ノートを保存"}</button></div>
    </form> : opened ? <article className="knowledge-reader">
      <div className="knowledge-actions"><button type="button" className="edit-button" disabled={busy} onClick={() => { setOpenedId(null); setMessage(""); }}>ノート一覧に戻る</button><button type="button" className="edit-button" disabled={busy} onClick={() => edit(opened)}>ノートを編集</button></div>
      <h2>{opened.title}</h2><div className="knowledge-meta"><time dateTime={opened.updated_at}>更新：{dateLabel(opened.updated_at)}</time><button type="button" className="knowledge-bookmark" aria-pressed={opened.needs_review} disabled={busy || loading} onClick={() => void toggleFlag(opened)}>{opened.needs_review ? "確認の目印を外す" : "あとで確認する"}</button></div>
      <p className="knowledge-body">{opened.body}</p>
    </article> : <>
      <div className="knowledge-heading"><div><h2>知識ノート</h2><p>例文なしで、文法・使い分け・調べものをまとめられます。</p></div><button type="button" className="primary-button" disabled={!loaded || loading || busy} onClick={beginNew}>ノートを書く</button></div>
      <div className="toolbar knowledge-toolbar"><input type="search" aria-label="知識ノートを検索" placeholder="タイトル・本文を検索" value={query} onChange={event => setQuery(event.target.value)} /><div className="filter-group"><button type="button" className={!reviewOnly ? "selected" : ""} aria-pressed={!reviewOnly} onClick={() => setReviewOnly(false)}>すべて {notes.length}</button><button type="button" className={reviewOnly ? "selected" : ""} aria-pressed={reviewOnly} onClick={() => setReviewOnly(true)}>あとで確認 {notes.filter(note => note.needs_review).length}</button></div><button type="button" className="edit-button" disabled={loading || busy} onClick={() => void reload()}>再読み込み</button></div>
      {loading && <p className="knowledge-help" role="status">知識ノートを読み込んでいます…</p>}
      {visible.length ? <div className="note-list">{visible.map(note => <article className="note-card knowledge-card" key={note.id}>
        <div className="note-card-heading"><h3><button type="button" className="knowledge-title" onClick={() => { setOpenedId(note.id); setMessage(""); }}>{note.title}</button></h3><button type="button" className="knowledge-bookmark" aria-label={`${note.title}をあとで確認する`} aria-pressed={note.needs_review} disabled={busy || loading} onClick={() => void toggleFlag(note)}>{note.needs_review ? "確認待ち" : "あとで確認"}</button></div>
        <p className="knowledge-preview">{note.body}</p><div className="knowledge-meta"><time dateTime={note.updated_at}>更新：{dateLabel(note.updated_at)}</time><button type="button" className="edit-button" onClick={() => { setOpenedId(note.id); setMessage(""); }}>ノートを読む</button></div>
      </article>)}</div> : loaded && !loading && <div className="list-empty"><h3>{query.trim() || reviewOnly ? "条件に合う知識ノートがありません" : "知識ノートはまだありません"}</h3><p>{query.trim() || reviewOnly ? "検索や絞り込みを変えてください。" : "「ノートを書く」から、タイトルと本文だけで保存できます。"}</p></div>}
    </>}
  </section>;
}
