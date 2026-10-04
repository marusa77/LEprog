"use client";

import { useEffect, useRef, useState } from "react";
import { saveManualEntry, translateManualText } from "./supabase-browser";
import type { CaptureResult, ManualTerm } from "./manual-entry-data";

export function ManualEntryView({ onSaved, onOpenLibrary, onTranslation }: { onSaved: () => void; onOpenLibrary: () => void; onTranslation: (monthlyCharacters: number) => void }) {
  const [english, setEnglish] = useState("");
  const [japanese, setJapanese] = useState("");
  const [note, setNote] = useState("");
  const [origin, setOrigin] = useState<"daily" | "external">("daily");
  const [sourceUrl, setSourceUrl] = useState("");
  const [terms, setTerms] = useState<Array<ManualTerm & { key: number }>>([]);
  const nextKey = useRef(0);
  const operation = useRef(false);
  const englishInput = useRef<HTMLTextAreaElement>(null);
  const focusAfterSave = useRef(false);
  const [busy, setBusy] = useState<"en-ja" | "ja-en" | "save" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastSaved, setLastSaved] = useState<CaptureResult | null>(null);
  const [machineTranslation, setMachineTranslation] = useState<string | null>(null);
  const hasInput = Boolean(english || japanese || note || sourceUrl || terms.some((row) => row.term || row.meaning || row.core_image || row.note));

  useEffect(() => {
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      if (hasInput) { event.preventDefault(); event.returnValue = ""; }
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasInput]);

  useEffect(() => {
    if (busy || !focusAfterSave.current) return;
    focusAfterSave.current = false;
    const input = englishInput.current;
    if (!input || !input.getClientRects().length) return;
    input.focus({ preventScroll: true });
    input.scrollIntoView({ block: "center" });
  }, [busy]);

  function editTerm(key: number, field: keyof ManualTerm, value: string) {
    setTerms((current) => current.map((row) => row.key === key ? { ...row, [field]: value } : row));
  }

  async function translate(source: "en" | "ja") {
    if (operation.current) return;
    const input = source === "en" ? english : japanese;
    if (!input.trim()) { setError(source === "en" ? "翻訳する英文を入力してください。" : "英語にしたい日本語を入力してください。"); return; }
    const destination = source === "en" ? japanese : english;
    if (destination.trim() && !window.confirm(`入力済みの${source === "en" ? "日本語" : "英文"}を翻訳結果で置き換えますか？`)) return;
    operation.current = true; setBusy(source === "en" ? "en-ja" : "ja-en"); setError(""); setMessage("");
    try {
      const result = await translateManualText(input, source, source === "en" ? "ja" : "en");
      if (source === "en") { setJapanese(result.translation); setMachineTranslation(result.translation); }
      else { setEnglish(result.translation); setMachineTranslation(null); }
      onTranslation(result.monthlyCharacters);
      setMessage(`翻訳しました。自由に編集してから保存できます。今月 ${result.monthlyCharacters.toLocaleString()}/${result.monthlyLimit.toLocaleString()}文字`);
    } catch (translationError) { setError(translationError instanceof Error ? translationError.message : "翻訳できませんでした。訳を自分で入力して保存することもできます。"); }
    finally { operation.current = false; setBusy(null); }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (operation.current || !english.trim() || !japanese.trim()) return;
    operation.current = true; setBusy("save"); setError(""); setMessage("");
    try {
      const result = await saveManualEntry({ english, japanese, note, origin, sourceUrl, terms, machineTranslation });
      resetInputs();
      setLastSaved(result);
      focusAfterSave.current = true;
      onSaved();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "保存できませんでした。入力内容は残しています。"); }
    finally { operation.current = false; setBusy(null); }
  }

  function resetInputs() {
    setEnglish(""); setJapanese(""); setNote(""); setOrigin("daily"); setSourceUrl(""); setTerms([]); setMachineTranslation(null);
  }

  function clear() {
    if (operation.current || (hasInput && !window.confirm("未保存の入力内容を消して、新しく入力しますか？"))) return;
    resetInputs(); setLastSaved(null); setMessage(""); setError("");
  }

  const duplicateCount = lastSaved?.terms.filter((term) => term.existing).length || 0;

  return <>
    <div className="page-heading"><div><p className="eyebrow">ADD YOUR ENGLISH</p><h1>入力して保存</h1><p>他サイトの英文や、日常で使いたい英語を登録できます。</p></div></div>
    {lastSaved && <div className="manual-feedback" role="status"><span>直前の英文を保存しました。次の文を入力できます。{duplicateCount > 0 && `登録済みの語句 ${duplicateCount}件は登場回数を増やしました。既存の意味やメモは上書きしていません。`}</span><button className="plain-action" type="button" onClick={onOpenLibrary}>保存した英文を見る</button></div>}
    <form className="manual-entry" onSubmit={save}>
      <fieldset disabled={Boolean(busy)} className="manual-fields">
        <div className="manual-language-grid">
          <div className="manual-language-card"><label htmlFor="manual-english">英文</label><textarea id="manual-english" ref={englishInput} value={english} onChange={(event) => { setEnglish(event.target.value); setMachineTranslation(null); }} rows={6} placeholder="例：Please draw one slip. または他サイトの英文を貼り付け" required /><button className="plain-action" type="button" disabled={!english.trim() || Boolean(busy)} onClick={() => void translate("en")}>{busy === "en-ja" ? "翻訳中…" : "英語を日本語に翻訳"}</button></div>
          <div className="manual-language-card"><label htmlFor="manual-japanese">日本語訳・言いたいこと</label><textarea id="manual-japanese" value={japanese} onChange={(event) => setJapanese(event.target.value)} rows={6} placeholder="例：1枚引いてください。自分で用意した訳を貼り付けてもOK" required /><button className="plain-action" type="button" disabled={!japanese.trim() || Boolean(busy)} onClick={() => void translate("ja")}>{busy === "ja-en" ? "翻訳中…" : "日本語を英語に翻訳"}</button></div>
        </div>
        <p className="manual-help">両方を自分で入力すれば、そのまま保存できます。Google翻訳は上のボタンを押したときだけ使い、月45万文字の枠に含まれます。単語の意味も自動では翻訳しません。</p>
        <section className="manual-section"><label htmlFor="manual-note">使う場面・自分用メモ</label><textarea id="manual-note" value={note} onChange={(event) => setNote(event.target.value)} rows={4} placeholder="例：箱に入った紙のくじを、お客さんに引いてもらう場面" />
          <div className="manual-origin"><label>入手元<select value={origin} onChange={(event) => setOrigin(event.target.value as typeof origin)}><option value="daily">日常・自分用</option><option value="external">他サイト・外部</option></select></label><label>参照URL（任意）<input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…" /></label></div>
        </section>
        <section className="manual-section"><div className="manual-section-heading"><div><h2>単語・熟語も登録する</h2><p>必要なものだけ追加してください。英文全体を1つのフレーズとして入力しても構いません。</p></div><button className="plain-action" type="button" onClick={() => setTerms((current) => [...current, { key: nextKey.current++, term: "", meaning: "", core_image: "", note: "" }])}>語句を追加</button></div>
          <div className="manual-terms">{terms.map((row) => <article className="manual-term" key={row.key}><div className="manual-term-grid"><label>単語・熟語・フレーズ<input value={row.term} onChange={(event) => editTerm(row.key, "term", event.target.value)} placeholder="例：draw lots" /></label><label>意味<input value={row.meaning} onChange={(event) => editTerm(row.key, "meaning", event.target.value)} placeholder="例：くじを引く" /></label><button className="edit-button" type="button" onClick={() => setTerms((current) => current.filter((item) => item.key !== row.key))} aria-label={`${row.term || "この語句"}を入力欄から削除`}>削除</button></div><details><summary>コアイメージ・語句メモ</summary><label>コアイメージ<textarea value={row.core_image} onChange={(event) => editTerm(row.key, "core_image", event.target.value)} rows={3} /></label><label>語句メモ<textarea value={row.note} onChange={(event) => editTerm(row.key, "note", event.target.value)} rows={3} /></label></details></article>)}</div>
        </section>
      </fieldset>
      {error && <p className="manual-feedback error" role="alert">{error}</p>}
      {message && <p className="manual-feedback" role="status">{message}</p>}
      <div className="manual-save-bar"><span>{busy === "save" ? "保存中…" : hasInput ? "未保存の入力があります" : "入力待ち"}</span><div><button className="plain-action" type="button" disabled={Boolean(busy) || !hasInput} onClick={clear}>入力をクリア</button><button className="primary-button" type="submit" disabled={Boolean(busy) || !english.trim() || !japanese.trim()}>{busy === "save" ? "保存中…" : "英文と語句を保存"}</button></div></div>
      {lastSaved && <p className="manual-help">保存済みの内容を直す場合は「保存した英文」や「単語・熟語」の編集を使ってください。</p>}
    </form>
  </>;
}
