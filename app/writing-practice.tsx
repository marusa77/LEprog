"use client";

import { useEffect, useRef, useState } from "react";
import { saveWritingEntry } from "./supabase-browser";
import { buildWritingPrompt, chooseWritingWords, writingTopics, type WritingWord } from "./writing-practice-data";

type WritingRecord = { id: string; source: string; translation: string; note: string; community: string; savedAt: string };

export function WritingPracticeView({ words, sentences, onSaved, onOpenLibrary, onEditSentence }: { words: WritingWord[]; sentences: WritingRecord[]; onSaved: () => void; onOpenLibrary: () => void; onEditSentence: (id: string) => void }) {
  const [selected, setSelected] = useState<WritingWord[]>([]);
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState(writingTopics[0]);
  const [english, setEnglish] = useState("");
  const [japanese, setJapanese] = useState("");
  const [feedback, setFeedback] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const saving = useRef(false);
  const initialized = useRef(false);
  const copyInput = useRef<HTMLTextAreaElement>(null);
  const topicCopyInput = useRef<HTMLTextAreaElement>(null);
  const entry = { topic, words: selected, english, japanese, feedback };
  const snapshot = JSON.stringify(entry);
  const dirty = Boolean(english || japanese || feedback) && snapshot !== savedSnapshot;
  const needle = query.trim().toLowerCase();
  const matches = words.filter(word => !needle || `${word.term} ${word.meaning} ${word.coreImage}`.toLowerCase().includes(needle));
  const records = sentences.filter(sentence => sentence.community === "英作文");

  useEffect(() => {
    if (!initialized.current && words.length) { initialized.current = true; setSelected(chooseWritingWords(words)); }
  }, [words]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function toggleWord(word: WritingWord) {
    if (saving.current || savedId) return;
    setMessage(""); setError("");
    if (selected.some(item => item.id === word.id)) setSelected(selected.filter(item => item.id !== word.id));
    else if (selected.length < 3) setSelected([...selected, word]);
    else setError("表現は3個までです。選んだ表現を1つ外してから追加してください。");
  }

  async function copy(purpose: "topic" | "feedback") {
    if (purpose === "feedback" && !english.trim()) { setError("先に自分の作文を書いてください。"); return; }
    const text = buildWritingPrompt(entry, purpose);
    setError("");
    try {
      await navigator.clipboard.writeText(text);
      setMessage(purpose === "topic" ? "お題作成用の指示文をコピーしました。AIのお題を下の欄に貼り付けてください。" : "作文を含む添削用の指示文をコピーしました。ChatGPTなどに貼り付けてください。");
    } catch {
      const input = purpose === "topic" ? topicCopyInput.current : copyInput.current;
      if (input) { input.closest("details")?.setAttribute("open", ""); input.focus(); input.select(); }
      setError("自動コピーできませんでした。指示文を選択しました。Ctrl+C、または長押しでコピーしてください。");
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current || !english.trim() || !selected.length || snapshot === savedSnapshot) return;
    saving.current = true; setBusy(true); setMessage(""); setError("");
    try {
      const result = await saveWritingEntry(entry, savedId);
      setSavedId(result.sentence_id); setSavedSnapshot(snapshot);
      setMessage(feedback.trim() ? "作文と添削を保存しました。" : "作文を保存しました。後から添削も追加できます。");
      onSaved();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "保存できませんでした。入力内容は残しています。"); }
    finally { saving.current = false; setBusy(false); }
  }

  function startNext() {
    if (saving.current || (dirty && !window.confirm("未保存の作文・添削があります。消して次の練習を始めますか？"))) return;
    setEnglish(""); setJapanese(""); setFeedback(""); setSavedId(null); setSavedSnapshot(""); setQuery(""); setError(""); setMessage("");
    setSelected(chooseWritingWords(words, Math.random));
    setTopic(writingTopics[Math.floor(Math.random() * writingTopics.length)]);
  }

  return <>
    <div className="page-heading"><h1>英作文の練習</h1></div>
    <form className="writing-practice" onSubmit={save}>
      <fieldset disabled={busy} className="manual-fields">
        <section className="writing-card"><div className="writing-card-heading"><h2><span>1</span> 表現とお題を選ぶ</h2><button type="button" className="plain-action" disabled={Boolean(savedId) || !words.length} onClick={() => setSelected(chooseWritingWords(words, Math.random))}>表現を選び直す</button></div>
          <p className="manual-help">表現を1〜3個選び、1つ以上使って書きます。</p>
          <div className="writing-selected">{selected.map(word => <article key={word.id}><div><strong>{word.term}</strong><button type="button" className="edit-button" disabled={Boolean(savedId)} onClick={() => toggleWord(word)} aria-label={`${word.term}を選択から外す`}>外す</button></div><p>{word.meaning}</p>{word.coreImage && <details><summary>自分のコアイメージ</summary><p className="writing-preserve">{word.coreImage}</p></details>}</article>)}</div>
          {!words.length ? <p className="manual-help">まず「入力して保存」や拡張機能で、単語・熟語を保存してください。</p> : <details className="writing-picker"><summary>自分で表現を選ぶ（{selected.length}/3）</summary><input type="search" aria-label="作文に使う表現を検索" value={query} onChange={event => setQuery(event.target.value)} placeholder="語句・意味・コアイメージで検索" disabled={Boolean(savedId)} /><div className="writing-word-list">{matches.slice(0, 30).map(word => <button type="button" key={word.id} aria-pressed={selected.some(item => item.id === word.id)} disabled={Boolean(savedId)} onClick={() => toggleWord(word)}><strong>{word.term}</strong><span>{word.meaning}</span></button>)}</div>{matches.length > 30 && <p className="manual-help">最初の30件を表示しています。検索すると他の表現も選べます。</p>}{!matches.length && <p>一致する表現がありません。</p>}</details>}
          <label htmlFor="writing-topic-choice">用意したお題<select id="writing-topic-choice" disabled={Boolean(savedId)} value={writingTopics.includes(topic) ? topic : "custom"} onChange={event => setTopic(event.target.value === "custom" ? "" : event.target.value)}>{writingTopics.map(value => <option key={value} value={value}>{value}</option>)}<option value="custom">自分で入力・AIのお題を貼り付け</option></select></label>
          <label htmlFor="writing-topic">今回のお題<textarea id="writing-topic" rows={3} maxLength={1000} value={topic} disabled={Boolean(savedId)} onChange={event => setTopic(event.target.value)} required /></label>
          <details className="writing-ai-topic"><summary>AIにお題を頼む</summary><p className="manual-help">指示文を外部AIへ貼り付け、返ってきたお題を上の欄に入れてください。</p><textarea ref={topicCopyInput} aria-label="お題作成用のAIへの指示文" value={buildWritingPrompt(entry, "topic")} readOnly rows={6} /><button type="button" className="plain-action" disabled={!selected.length || Boolean(savedId)} onClick={() => void copy("topic")}>お題作成用の指示文をコピー</button></details>
        </section>
        <section className="writing-card"><h2><span>2</span> 自分の英語で書く</h2><label htmlFor="writing-english">元の作文<textarea id="writing-english" value={english} readOnly={Boolean(savedId)} onChange={event => setEnglish(event.target.value)} rows={7} maxLength={4000} placeholder="間違えても大丈夫。まずは自分の言葉で2〜4文書いてみましょう。" required /></label>{savedId && <p className="manual-help">元の作文は保存後に固定します。修正文は下の添削欄に残せます。別の作文は「次の練習を始める」から。</p>}<label htmlFor="writing-japanese">日本語訳・伝えたかったこと（任意）<textarea id="writing-japanese" value={japanese} onChange={event => setJapanese(event.target.value)} rows={3} maxLength={2000} placeholder="意図を添えると、外部AIが勝手に意味を変えるのを防ぎやすくなります。" /></label></section>
        <section className="writing-card"><div className="writing-card-heading"><h2><span>3</span> 外部AIに添削を頼む</h2><button type="button" className="plain-action" disabled={!selected.length || !english.trim() || !topic.trim()} onClick={() => void copy("feedback")}>作文と指示文をコピー</button></div><p className="manual-help">ChatGPTなどに貼り付けてください。利用枠は貼り付け先のサービスに準じます。</p><details className="writing-prompt"><summary>コピーする内容を確認</summary><p className="manual-help">選んだ表現だけを含め、意味は各250文字・コアイメージは各600文字までに絞ります。</p><textarea ref={copyInput} aria-label="添削用のAIへの指示文と作文" value={buildWritingPrompt(entry, "feedback")} readOnly rows={12} /></details></section>
        <section className="writing-card"><h2><span>4</span> 添削・解説を貼り付ける</h2><label htmlFor="writing-feedback">添削・修正文・自分の気付き（任意）<textarea id="writing-feedback" value={feedback} onChange={event => setFeedback(event.target.value)} rows={9} maxLength={20000} placeholder="AIの回答や自分の気付きを貼り付け" /></label><details className="inline-help"><summary>添削の保存について</summary><p>添削前でも作文だけ保存できます。AIの指摘は誤ることもあるため、確認してから保存してください。点数は作文への目安です。</p></details></section>
      </fieldset>
      {error && <p className="manual-feedback error" role="alert">{error}</p>}{message && <p className="manual-feedback" role="status">{message}</p>}
      <div className="manual-save-bar"><span>{busy ? "保存中…" : dirty ? "未保存の入力・変更があります" : savedId ? "クラウド保存済み" : "入力待ち"}</span><div><button type="button" className="plain-action" disabled={busy} onClick={startNext}>次の練習を始める</button><button type="submit" className="primary-button" disabled={busy || !english.trim() || !topic.trim() || !selected.length || snapshot === savedSnapshot}>{busy ? "保存中…" : savedId ? "添削・メモの変更を保存" : "作文・添削を保存"}</button></div></div>
    </form>
    <section className="writing-history"><div className="writing-card-heading"><h2>これまでの英作文 <small>{records.length}件</small></h2><button className="plain-action" type="button" onClick={onOpenLibrary}>保存した英文をすべて見る</button></div>{records.slice(0, 10).map(record => <article className="writing-card" key={record.id}><div className="writing-card-heading"><time>{record.savedAt}</time>{record.id === savedId ? <small>上の入力欄で添削を追加できます</small> : <button className="edit-button" type="button" onClick={() => onEditSentence(record.id)}>訳・添削メモを編集</button>}</div><p className="writing-preserve">{record.source}</p>{record.translation && <p className="writing-preserve">{record.translation}</p>}<details><summary>お題・表現・添削を読む</summary><p className="writing-preserve">{record.note}</p></details></article>)}{!records.length && <p className="manual-help">保存した作文はここにも表示します。PCとスマホから同じ内容を振り返れます。</p>}</section>
  </>;
}
