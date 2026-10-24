"use client";

import { useRef, useState } from "react";
import { submitSentenceReview, updateSentenceReviewPreference } from "./supabase-browser";
import { SentenceNote } from "./sentence-note";
import { orderStudySentences, retainSentenceOrder, reviewPreferenceLabels, sentenceStudySummary, type ReviewPreference, type SentenceOrder, type SentenceStudyMetadata, type StudySentence } from "./sentence-study-data";

type Round = { ids: string[]; index: number; completed: number; skipped: number };

export function SentenceLibraryView({ sentences, onEdit, onStudyUpdated, active = true }: {
  sentences: StudySentence[]; onEdit: (sentence: StudySentence) => void; onStudyUpdated: (metadata: SentenceStudyMetadata) => void; active?: boolean;
}) {
  const [sort, setSort] = useState<SentenceOrder>("recent");
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [roundSize, setRoundSize] = useState(10);
  const [round, setRound] = useState<Round | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const busy = useRef(false);
  const reviewTokens = useRef(new Map<string, string>());
  // Keep hooks mounted across app navigation, without rendering hundreds of hidden cards.
  if (!active) return null;
  const ready = sentences.length > 0 && sentences.every(sentence => sentence.reviewReady);
  const ordered = sort === "recent" ? orderStudySentences(sentences, "recent") : retainSentenceOrder(sentences, orderIds);
  const current = round ? sentences.find(sentence => sentence.id === round.ids[round.index]) : undefined;
  const finished = Boolean(round && round.index >= round.ids.length);

  function shuffle(mode = sort) {
    setSort(mode);
    setOrderIds(orderStudySentences(sentences, mode).map(sentence => sentence.id));
  }

  function startRound() {
    if (busy.current || !ready) return;
    reviewTokens.current.clear();
    setRound({ ids:orderStudySentences(sentences, "study").slice(0, roundSize).map(sentence => sentence.id), index:0, completed:0, skipped:0 });
    setRevealed(false); setMessage(""); setError("");
  }

  async function changePreference(sentence: StudySentence, preference: ReviewPreference) {
    if (busy.current || !sentence.reviewReady || preference === sentence.reviewPreference) return;
    busy.current = true; setBusyId(sentence.id); setError(""); setMessage("");
    try {
      onStudyUpdated(await updateSentenceReviewPreference(sentence.id, preference));
      setMessage(`出やすさを「${reviewPreferenceLabels[preference]}」に保存しました。次のシャッフルから反映します。`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "設定を保存できませんでした。変更前の設定を残しています。"); }
    finally { busy.current = false; setBusyId(null); }
  }

  async function markRead(sentence = current, advanceRound = true) {
    if (!sentence || (advanceRound && !round) || busy.current || !sentence.reviewReady) return;
    busy.current = true; setBusyId(sentence.id); setError(""); setMessage("");
    try {
      let token = reviewTokens.current.get(sentence.id);
      if (!token) { token = crypto.randomUUID(); reviewTokens.current.set(sentence.id, token); }
      onStudyUpdated(await submitSentenceReview(sentence.id, token));
      reviewTokens.current.delete(sentence.id);
      if (advanceRound) {
        setRound(previous => previous ? { ...previous, index:previous.index + 1, completed:previous.completed + 1 } : previous);
        setRevealed(false);
      } else setMessage("この英文の復習を記録しました。学習カレンダーでは同じ英文は1日1件です。");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "復習を記録できませんでした。英文を残しています。もう一度お試しください。"); }
    finally { busy.current = false; setBusyId(null); }
  }

  function skip() {
    if (busy.current || !round) return;
    // After a failed request it may already have reached the server. Require retry,
    // rather than silently treating an ambiguous save as an unrecorded skip.
    if (current && reviewTokens.current.has(current.id)) { setError("記録が届いたか確認するため、先に「読み直した」をもう一度押してください。同じ操作は二重に数えません。"); return; }
    setRound(previous => previous ? { ...previous, index:previous.index + 1, skipped:previous.skipped + 1 } : previous);
    setRevealed(false); setError(""); setMessage("");
  }

  const preferenceControl = (sentence: StudySentence) => <label className="sentence-preference">復習の出やすさ
    <select aria-label={`${sentence.source}の復習の出やすさ`} value={sentence.reviewPreference} disabled={!sentence.reviewReady || busyId !== null}
      onChange={event => void changePreference(sentence, event.target.value as ReviewPreference)}>
      <option value="less">少なめ</option><option value="normal">通常</option><option value="more">多め</option>
    </select>
  </label>;

  const details = (sentence: StudySentence, previewNote = false) => <>
    <p className="translation">{sentence.translation || "訳はまだありません"}</p>
    {sentence.note && (previewNote ? <SentenceNote note={sentence.note} /> : <p className="personal-note">メモ：{sentence.note}</p>)}
    <div className="term-tags">{sentence.terms.map(term => <span key={term}>{term}</span>)}</div>
    {sentence.sourceUrl && /^https?:\/\//i.test(sentence.sourceUrl) && <p className="sentence-origin-link"><a href={sentence.sourceUrl} target="_blank" rel="noopener noreferrer">元のページを開く</a></p>}
  </>;

  return <>
    <div className="page-heading"><div><span className="eyebrow">SAVED SENTENCES</span><h1>保存した英文</h1><p>探すときは最新順、学ぶときは復習シャッフル。</p></div></div>
    {!sentences.length ? <div className="list-empty"><h2>保存した英文はまだありません</h2><p>「入力して保存」またはChrome拡張機能から登録できます。</p></div> : <>
      {!ready && <p className="sentence-study-notice" role="status">英文の復習記録を有効にするには、SupabaseのSQL Editorで「0005_sentence_study.sql」を実行して、このページを再読み込みしてください。最新順とランダムは今までどおり使えます。</p>}
      <div className="sentence-study-controls">
        <label>並び順 <select aria-label="英文の並び順" value={sort} disabled={busyId !== null} onChange={event => shuffle(event.target.value as SentenceOrder)}>
          <option value="recent">最新順</option><option value="random">ランダム</option><option value="study" disabled={!ready}>復習シャッフル</option>
        </select></label>
        {sort !== "recent" && <button type="button" className="edit-button" disabled={busyId !== null} onClick={() => shuffle()}>もう一度シャッフル</button>}
        {!round && <div className="sentence-round-start"><label>復習する件数 <select aria-label="英文の復習件数" value={roundSize} onChange={event => setRoundSize(Number(event.target.value))}>
          <option value={5}>5件</option><option value={10}>10件</option><option value={20}>20件</option>
        </select></label><button type="button" className="primary-button" disabled={!ready || busyId !== null} onClick={startRound}>英文を{Math.min(roundSize, sentences.length)}件復習</button></div>}
      </div>
      <p className="sentence-study-help">多め＝繰り返し読みたい · 少なめ＝理解できる／似た英文を十分読んだ。少なめも時々出ます。設定の変更や編集では、現在の並び順は動きません。</p>
      {message && <p className="sentence-study-message" role="status">{message}</p>}
      {error && <p className="sentence-study-error" role="alert">{error}</p>}
      {round ? <section className="sentence-round" aria-label="英文の復習">
        <div className="sentence-round-heading"><span>{finished ? "今回の復習を終了しました" : `${round.index + 1} / ${round.ids.length}件`}</span>
          <button type="button" className="edit-button" disabled={busyId !== null} onClick={() => { setRound(null); setError(""); setMessage(""); }}>一覧に戻る</button>
        </div>
        {finished ? <div className="sentence-round-complete"><h2>{round.completed}件の英文を読み直しました</h2><p>スキップ：{round.skipped}件。スキップした英文は復習回数に含めません。</p><button type="button" className="primary-button" onClick={startRound}>続けて復習する</button></div>
          : current ? <article className="sentence-card" key={current.id}>
            <div className="sentence-meta"><span>{current.community}</span><button className="edit-button" type="button" disabled={busyId !== null} onClick={() => onEdit(current)}>編集</button></div>
            <h2>{current.source}</h2>
            <button type="button" className="edit-button" onClick={() => setRevealed(!revealed)}>{revealed ? "訳・メモを隠す" : "訳・メモを見る"}</button>
            {revealed && details(current)}
            <div className="sentence-study-footer">{preferenceControl(current)}<small>{sentenceStudySummary(current)}</small></div>
            <div className="sentence-round-actions"><button type="button" className="primary-button" disabled={busyId !== null} onClick={() => void markRead()}>{busyId === current.id ? "保存中…" : "読み直した"}</button>
              <button type="button" className="edit-button" disabled={busyId !== null} onClick={skip}>今回はスキップ</button></div>
            <p className="sentence-study-help">「読み直した」を押したときだけ記録します。単語の学習状態は変わりません。</p>
          </article> : <div className="list-empty"><p>この英文は現在の保存内容にありません。</p><button className="edit-button" type="button" onClick={skip}>次へ</button></div>}
      </section> : <div className="sentence-list">{ordered.map(sentence => <article className="sentence-card" key={sentence.id}>
        <div className="sentence-meta"><span>{sentence.community}</span><div><time>{sentence.savedAt}</time><button className="edit-button" type="button" disabled={busyId !== null} onClick={() => onEdit(sentence)}>編集</button></div></div>
        <h2>{sentence.source}</h2>{details(sentence, true)}
        <div className="sentence-study-footer">{preferenceControl(sentence)}{sentence.reviewReady && <><small>{sentenceStudySummary(sentence)}</small><button type="button" className="edit-button" disabled={busyId !== null} onClick={() => void markRead(sentence, false)}>{busyId === sentence.id ? "記録中…" : "読み直した"}</button></>}</div>
      </article>)}</div>}
    </>}
  </>;
}
