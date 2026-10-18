"use client";

import type { FormEvent } from "react";
import { appendKnowledgeTemplate, knowledgeNoteLimits, knowledgeNoteTemplates, type KnowledgeNoteDraft } from "./knowledge-notes-data";

type EditorProps = {
  draft: KnowledgeNoteDraft; dirty: boolean; busy: boolean; templateId: string; clearLabel?: string;
  onDraftChange: (draft: KnowledgeNoteDraft) => void; onTemplateChange: (id: string) => void;
  onSubmit: (event: FormEvent) => void; onCancel: () => void;
};

// Shared markup for the one creation form and the existing-note editor.
// Drafts remain owned by their screens, so navigation never swaps their content.
export function renderKnowledgeNoteEditor({ draft, dirty, busy, templateId, clearLabel = "キャンセル", onDraftChange, onTemplateChange, onSubmit, onCancel }: EditorProps) {
  return <form className="knowledge-editor" onSubmit={onSubmit}>
      <div className="knowledge-heading"><h2>{draft.expectedUpdatedAt ? "知識ノートを編集" : "知識ノートを書く"}</h2><span className="knowledge-draft-state" role="status">{busy ? "保存中…" : dirty ? "未保存の変更があります" : draft.original ? "保存内容から変更なし" : "未保存のノートです"}</span></div>
      <fieldset disabled={busy}>
        <label>タイトル<input autoFocus={Boolean(draft.original)} value={draft.title} onChange={event => onDraftChange({ ...draft, title:event.target.value })} placeholder="例：used to の使い分け" maxLength={knowledgeNoteLimits.title} required /></label>
        <div className="knowledge-template"><label>ひな形（任意）<select value={templateId} onChange={event => onTemplateChange(event.target.value)}>{knowledgeNoteTemplates.map(template => <option key={template.id} value={template.id}>{template.label}</option>)}</select></label>
          <button type="button" className="edit-button" onClick={() => onDraftChange({ ...draft, body:appendKnowledgeTemplate(draft.body, templateId) })}>ひな形を本文に追加</button><small>入力済みの内容は消さず、末尾に追加します。見出しは自由に変更・削除できます。</small></div>
        <label>本文<textarea value={draft.body} onChange={event => onDraftChange({ ...draft, body:event.target.value })} rows={16} placeholder="日本語だけでもOK。文法の整理、表現の比較、調べたことなどを自由に記録できます。例文は必須ではありません。" maxLength={knowledgeNoteLimits.body} required /></label>
        <label className="knowledge-flag"><input type="checkbox" checked={draft.needs_review} onChange={event => onDraftChange({ ...draft, needs_review:event.target.checked })} />あとで確認する</label>
      </fieldset>
      <p className="knowledge-help">保存ボタンで保存します。画面を切り替えても入力は残りますが、ページの再読み込みで未保存の入力は失われます。AI・翻訳APIは使いません。</p>
      <div className="knowledge-actions"><button type="button" className="plain-action" disabled={busy} onClick={onCancel}>{clearLabel}</button><button type="submit" className="primary-button" disabled={busy || !draft.title.trim() || !draft.body.trim() || !dirty}>{busy ? "保存中…" : "ノートを保存"}</button></div>
    </form>;
}
