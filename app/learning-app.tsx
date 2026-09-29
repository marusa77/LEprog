"use client";

import { useEffect, useMemo, useState } from "react";
import { captureSessionFromUrl, consumeReturnTab, getStoredSession, getSupabaseConfiguration, loadLearningData, saveSupabaseConfiguration, signInWithGoogle, signOut, submitReview, updateSentence, updateVocabularyItem } from "./supabase-browser";

type Tab = "today" | "words" | "sentences" | "settings";
type LearningStatus = "unlearned" | "learning" | "mastered";
type Word = { id: string; term: string; meaning: string; note: string; status: LearningStatus; occurrences: number; dueLabel: string; example: string; translation: string };
type Sentence = { id: string; source: string; translation: string; note: string; community: string; savedAt: string; terms: string[] };

const statusLabels: Record<LearningStatus, string> = { unlearned: "未学習", learning: "学習中", mastered: "覚えた" };

function getInitialTab(): Tab {
  if (typeof window === "undefined") return "today";
  const requestedTab = new URLSearchParams(window.location.search).get("tab") || consumeReturnTab();
  return requestedTab === "words" || requestedTab === "sentences" || requestedTab === "settings" ? requestedTab : "today";
}

export function LearningApp() {
  const [tab, setTab] = useState<Tab>(getInitialTab);
  const [words, setWords] = useState<Word[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [filter, setFilter] = useState<LearningStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [sentenceItems, setSentenceItems] = useState<Sentence[]>([]);
  const [usage, setUsage] = useState({ cloudCharacters: 0, aiUsd: 0 });
  const [connection, setConnection] = useState<"setup" | "checking" | "signedout" | "live" | "error">("checking");
  const [connectionError, setConnectionError] = useState("");
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  const [editingSentence, setEditingSentence] = useState<Sentence | null>(null);

  useEffect(() => {
    async function initializeCloudData() {
      await Promise.resolve();
      if (!getSupabaseConfiguration()) { setConnection("setup"); return; }
      const session = captureSessionFromUrl() || getStoredSession();
      if (!session) { setConnection("signedout"); return; }
      try {
        const { vocabulary, savedSentences, links, usage: currentUsage } = await loadLearningData();
        const sentenceById = new Map(savedSentences.map((sentence) => [sentence.id, sentence]));
        const vocabularyById = new Map(vocabulary.map((word) => [word.id, word]));
        setWords(vocabulary.map((word) => {
          const exampleLink = links.find((link) => link.vocabulary_id === word.id);
          const exampleSentence = exampleLink ? sentenceById.get(exampleLink.sentence_id) : undefined;
          return { id: word.id, term: word.term, meaning: word.meaning, note: word.note, status: word.status, occurrences: word.occurrence_count, dueLabel: formatDueLabel(word.next_review_at), example: exampleSentence?.original_text || "", translation: exampleSentence?.translation || "" };
        }));
        setSentenceItems(savedSentences.map((sentence) => ({
          id: sentence.id,
          source: sentence.original_text,
          translation: sentence.translation,
          note: sentence.note,
          community: sentence.subreddit || "Reddit",
          savedAt: new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(new Date(sentence.created_at)),
          terms: links.filter((link) => link.sentence_id === sentence.id).map((link) => vocabularyById.get(link.vocabulary_id)?.term || link.selected_text),
        })));
        setUsage({ cloudCharacters: currentUsage.cloud_translation_characters, aiUsd: Number(currentUsage.ai_estimated_usd) || 0 });
        setConnection("live");
      } catch (error) { setConnectionError(error instanceof Error ? error.message : "接続できませんでした"); setConnection("error"); }
    }
    void initializeCloudData();
  }, []);
  const reviewQueue = useMemo(() => words.filter((word) => word.dueLabel === "今日" || word.status === "unlearned"), [words]);
  const reviewWord = reviewQueue[0];
  const filteredWords = words.filter((word) => {
    const needle = query.trim().toLowerCase();
    return (filter === "all" || word.status === filter) && (!needle || `${word.term} ${word.meaning}`.toLowerCase().includes(needle));
  });

  async function answerReview(result: "forgot" | "uncertain" | "remembered") {
    if (!reviewWord) return;
    try {
      const response = await submitReview(reviewWord.id, result);
      setWords((current) => current.map((word) => word.id === reviewWord.id ? { ...word, status: response.status, dueLabel: formatDueLabel(response.next_review_at) } : word));
      setCompleted((count) => count + 1);
      setRevealed(false);
    } catch (error) { setConnectionError(error instanceof Error ? error.message : "復習結果を保存できませんでした"); }
  }

  async function saveWordEdit(changes: { meaning: string; note: string; status: LearningStatus }) {
    if (!editingWord) return;
    const updated = await updateVocabularyItem(editingWord.id, changes);
    setWords((current) => current.map((word) => word.id === editingWord.id ? { ...word, meaning: updated.meaning, note: updated.note, status: updated.status } : word));
    setEditingWord(null);
  }

  async function saveSentenceEdit(changes: { translation: string; note: string }) {
    if (!editingSentence) return;
    const updated = await updateSentence(editingSentence.id, changes);
    setSentenceItems((current) => current.map((sentence) => sentence.id === editingSentence.id ? { ...sentence, translation: updated.translation, note: updated.note } : sentence));
    setWords((current) => current.map((word) => word.example === editingSentence.source ? { ...word, translation: updated.translation } : word));
    setEditingSentence(null);
  }

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    const url = new URL(window.location.href);
    if (nextTab === "today") url.searchParams.delete("tab");
    else url.searchParams.set("tab", nextTab);
    history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  if (connection === "checking") return <LoginGate checking />;
  if (connection === "setup") return <SetupGate onComplete={() => setConnection("signedout")} />;
  if (connection === "signedout") return <LoginGate />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => selectTab("today")} aria-label="ホームへ"><span className="brand-mark">P</span><span><strong>PhraseNest</strong><small>Reddit English Notes</small></span></button>
        <div className={`sync-state ${connection}`}><span /> {connection === "live" ? "Supabaseと同期済み" : connection === "error" ? "接続エラー" : "デモデータ"}</div>
      </header>
      <div className="workspace">
        <aside className="sidebar" aria-label="メインメニュー">
          <nav>
            <NavButton active={tab === "today"} label="今日の復習" count={reviewQueue.length} icon="◎" onClick={() => selectTab("today")} />
            <NavButton active={tab === "words"} label="単語・熟語" count={words.length} icon="A" onClick={() => selectTab("words")} />
            <NavButton active={tab === "sentences"} label="保存した英文" count={sentenceItems.length} icon="¶" onClick={() => selectTab("sentences")} />
          </nav>
          <button className={`nav-button ${tab === "settings" ? "active" : ""}`} type="button" onClick={() => selectTab("settings")}><span className="nav-icon">⚙</span><span>設定</span></button>
        </aside>
        <section className="content">
          {tab === "today" && <TodayView words={words} reviewWord={reviewWord} revealed={revealed} completed={completed} remaining={Math.max(0, reviewQueue.length - completed)} onReveal={() => setRevealed(true)} onAnswer={answerReview} />}
          {tab === "words" && <WordsView words={filteredWords} filter={filter} query={query} onFilter={setFilter} onQuery={setQuery} onEdit={setEditingWord} />}
          {tab === "sentences" && <SentencesView sentences={sentenceItems} onEdit={setEditingSentence} />}
          {tab === "settings" && <SettingsView connection={connection} error={connectionError} usage={usage} />}
        </section>
      </div>
      <nav className="mobile-nav" aria-label="モバイルメニュー">
        <NavButton active={tab === "today"} label="復習" icon="◎" onClick={() => selectTab("today")} />
        <NavButton active={tab === "words"} label="語句" icon="A" onClick={() => selectTab("words")} />
        <NavButton active={tab === "sentences"} label="英文" icon="¶" onClick={() => selectTab("sentences")} />
        <NavButton active={tab === "settings"} label="設定" icon="⚙" onClick={() => selectTab("settings")} />
      </nav>
      {editingWord && <WordEditor key={editingWord.id} word={editingWord} onClose={() => setEditingWord(null)} onSave={saveWordEdit} />}
      {editingSentence && <SentenceEditor key={editingSentence.id} sentence={editingSentence} onClose={() => setEditingSentence(null)} onSave={saveSentenceEdit} />}
    </main>
  );
}

function TodayView({ words, reviewWord, revealed, completed, remaining, onReveal, onAnswer }: { words: Word[]; reviewWord?: Word; revealed: boolean; completed: number; remaining: number; onReveal: () => void; onAnswer: (result: "forgot" | "uncertain" | "remembered") => void }) {
  return <><PageHeading eyebrow="TODAY'S REVIEW" title="今日の復習" description="よく出会う表現から、少しずつ覚えましょう。" extra={<div className="progress-chip"><strong>{completed}</strong><span>今日の回答</span></div>} />
    <div className="review-grid"><article className="review-card">{reviewWord ? <><div className="card-meta"><span className={`status ${reviewWord.status}`}>{statusLabels[reviewWord.status]}</span><span>{reviewWord.occurrences}回見つけました</span></div><div className="prompt-area"><p className="prompt-label">この表現の意味は？</p><h2>{reviewWord.term}</h2></div>{!revealed ? <button className="primary-button reveal-button" type="button" onClick={onReveal}>答えを見る</button> : <div className="answer-panel"><h3>{reviewWord.meaning}</h3><p>{reviewWord.note}</p><blockquote><strong>{reviewWord.example}</strong><span>{reviewWord.translation}</span></blockquote><div className="answer-buttons"><AnswerButton kind="forgot" title="忘れた" sub="明日もう一度" onClick={() => onAnswer("forgot")} /><AnswerButton kind="uncertain" title="あいまい" sub="3日後" onClick={() => onAnswer("uncertain")} /><AnswerButton kind="remembered" title="覚えていた" sub="7日後" onClick={() => onAnswer("remembered")} /></div></div>}</> : <div className="empty-state"><h2>今日の復習は完了です</h2><p>また明日、少しずつ続けましょう。</p></div>}</article>
      <aside className="today-summary"><h3>今日の予定</h3><div className="ring" style={{ "--progress": `${Math.min(100, completed * 20)}%` } as React.CSSProperties}><span><strong>{remaining}</strong>語</span></div><SummaryRow kind="new" label="未学習" value={words.filter((w) => w.status === "unlearned").length} /><SummaryRow kind="learning" label="学習中" value={words.filter((w) => w.status === "learning").length} /><SummaryRow kind="mastered" label="覚えた" value={words.filter((w) => w.status === "mastered").length} /></aside></div></>;
}

function WordsView({ words, filter, query, onFilter, onQuery, onEdit }: { words: Word[]; filter: LearningStatus | "all"; query: string; onFilter: (value: LearningStatus | "all") => void; onQuery: (value: string) => void; onEdit: (word: Word) => void }) {
  return <><PageHeading eyebrow="VOCABULARY" title="単語・熟語" description="Redditで出会った回数と一緒に確認できます。" /><div className="toolbar"><input aria-label="語句を検索" placeholder="語句や意味を検索" value={query} onChange={(event) => onQuery(event.target.value)} /><div className="filter-group">{(["all", "unlearned", "learning", "mastered"] as const).map((value) => <button type="button" key={value} className={filter === value ? "selected" : ""} onClick={() => onFilter(value)}>{value === "all" ? "すべて" : statusLabels[value]}</button>)}</div></div>{words.length ? <div className="word-list">{words.map((word) => <article className="word-row" key={word.id}><div><div className="word-title"><h2>{word.term}</h2><span className={`status ${word.status}`}>{statusLabels[word.status]}</span></div><p>{word.meaning || "意味はまだありません"}</p><small>{word.note || "自分用メモはまだありません"}</small></div><div className="word-actions"><button className="edit-button" type="button" onClick={() => onEdit(word)}>編集</button><div className="word-stats"><strong>{word.occurrences}</strong><span>登場回数</span><em>{word.dueLabel}</em></div></div></article>)}</div> : <div className="list-empty"><h2>語句が見つかりません</h2><p>検索条件を変えるか、Redditから新しい語句を保存してください。</p></div>}</>;
}

function SentencesView({ sentences, onEdit }: { sentences: Sentence[]; onEdit: (sentence: Sentence) => void }) {
  return <><PageHeading eyebrow="SAVED SENTENCES" title="保存した英文" description="元の文脈と、自分の説明を一緒に残します。" />{sentences.length ? <div className="sentence-list">{sentences.map((sentence) => <article className="sentence-card" key={sentence.id}><div className="sentence-meta"><span>{sentence.community}</span><div><time>{sentence.savedAt}</time><button className="edit-button" type="button" onClick={() => onEdit(sentence)}>編集</button></div></div><h2>{sentence.source}</h2><p className="translation">{sentence.translation || "訳はまだありません"}</p>{sentence.note && <p className="personal-note">メモ：{sentence.note}</p>}<div className="term-tags">{sentence.terms.map((term) => <span key={term}>{term}</span>)}</div></article>)}</div> : <div className="list-empty"><h2>保存した英文はまだありません</h2><p>Redditで英文を選択し、Chrome拡張機能から保存してください。</p></div>}</>;
}

function WordEditor({ word, onClose, onSave }: { word: Word; onClose: () => void; onSave: (changes: { meaning: string; note: string; status: LearningStatus }) => Promise<void> }) {
  const [meaning, setMeaning] = useState(word.meaning);
  const [note, setNote] = useState(word.note);
  const [status, setStatus] = useState(word.status);
  return <EditDialog title={`${word.term} を編集`} onClose={onClose} onSubmit={() => onSave({ meaning: meaning.trim(), note: note.trim(), status })}><label>意味<input value={meaning} onChange={(event) => setMeaning(event.target.value)} placeholder="日本語の意味" /></label><label>自分用メモ<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="使い方や覚え方など" rows={4} /></label><label>学習状態<select value={status} onChange={(event) => setStatus(event.target.value as LearningStatus)}><option value="unlearned">未学習</option><option value="learning">学習中</option><option value="mastered">覚えた</option></select></label></EditDialog>;
}

function SentenceEditor({ sentence, onClose, onSave }: { sentence: Sentence; onClose: () => void; onSave: (changes: { translation: string; note: string }) => Promise<void> }) {
  const [translation, setTranslation] = useState(sentence.translation);
  const [note, setNote] = useState(sentence.note);
  return <EditDialog title="英文の訳とメモを編集" onClose={onClose} onSubmit={() => onSave({ translation: translation.trim(), note: note.trim() })}><div className="source-preview"><span>元の英文</span><p>{sentence.source}</p></div><label>自分で直した訳<textarea value={translation} onChange={(event) => setTranslation(event.target.value)} placeholder="英文全体の訳" rows={4} /></label><label>自分用メモ<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="気づいた点や補足説明など" rows={4} /></label></EditDialog>;
}

function EditDialog({ title, children, onClose, onSubmit }: { title: string; children: React.ReactNode; onClose: () => void; onSubmit: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try { await onSubmit(); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "変更を保存できませんでした"); setSaving(false); }
  }
  return <div className="dialog-backdrop" role="presentation"><form className="edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-dialog-title" onSubmit={submit}><div className="dialog-heading"><h2 id="edit-dialog-title">{title}</h2><button type="button" aria-label="閉じる" onClick={onClose}>×</button></div><div className="dialog-fields">{children}</div>{error && <p className="connection-error">{error}</p>}<div className="dialog-actions"><button className="plain-action" type="button" onClick={onClose} disabled={saving}>キャンセル</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "保存中…" : "変更を保存"}</button></div></form></div>;
}

function SettingsView({ connection, error, usage }: { connection: string; error: string; usage: { cloudCharacters: number; aiUsd: number } }) {
  return <><PageHeading eyebrow="SETTINGS" title="設定" description="料金が予想外に増えないよう、利用方法を確認できます。" /><div className="settings-grid"><section className="setting-card"><div className="setting-heading"><div><span className="setting-icon">¥</span><div><h2>高品質・ほぼ無料モード</h2><p>Google翻訳を優先します。</p></div></div><span className="mode-badge">使用中</span></div><ul><li>通常翻訳：Google翻訳を使用</li><li>利用上限：月450,000文字で停止</li><li>代替翻訳：Google翻訳を使えない場合はChrome内蔵翻訳</li><li>AI解説：ボタンを押した場合のみ</li></ul></section><section className="setting-card"><h2>今月の使用状況</h2><Usage label="Google翻訳" current={usage.cloudCharacters.toLocaleString()} max="450,000文字" ratio={usage.cloudCharacters / 450000} /><Usage label="AI解説の推定料金" current={`$${usage.aiUsd.toFixed(3)}`} max="$1.00" ratio={usage.aiUsd} /></section><section className="setting-card full"><h2>Chrome拡張機能</h2><div className="shortcut-row"><div><p>Redditで英文を選択して呼び出します。</p><small>ショートカットはChromeの設定から変更できます。</small></div><kbd>Ctrl</kbd><b>＋</b><kbd>Shift</kbd><b>＋</b><kbd>Y</kbd></div></section><section className="setting-card full"><h2>クラウド接続</h2><p>{connection === "live" ? "Supabaseに接続し、PCとスマホで同じ記録を利用しています。" : "Supabaseとの接続を確認してください。"}</p>{error && <p className="connection-error">{error}</p>}{connection === "live" && <button className="plain-action" type="button" onClick={signOut}>ログアウト</button>}</section></div></>;
}

function SetupGate({ onComplete }: { onComplete: () => void }) {
  const [projectUrl, setProjectUrl] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setMessage("");
    try { await saveSupabaseConfiguration(projectUrl, publishableKey); onComplete(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "接続情報を保存できませんでした"); }
    finally { setSaving(false); }
  }
  return <main className="login-shell"><form className="login-card setup-card" onSubmit={save}><span className="login-mark">P</span><p className="eyebrow">FIRST SETUP</p><h1>Supabaseを接続</h1><p>Chrome拡張機能に入力したものと同じ公開用の接続情報を入力します。</p><label>Project URL<input type="url" value={projectUrl} onChange={(event) => setProjectUrl(event.target.value)} placeholder="https://xxxxx.supabase.co" required /></label><label>Publishable key<input type="password" value={publishableKey} onChange={(event) => setPublishableKey(event.target.value)} placeholder="sb_publishable_..." required /></label>{message && <p className="connection-error">{message}</p>}<button type="submit" className="primary-button" disabled={saving}>{saving ? "接続を確認中…" : "接続情報を保存"}</button><small>Secret keyやデータベースのパスワードは入力しないでください。</small></form></main>;
}

function LoginGate({ checking = false }: { checking?: boolean }) {
  const [error, setError] = useState("");
  const redirectUrl = typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`;
  function startLogin() {
    try { signInWithGoogle(); }
    catch (loginError) { setError(loginError instanceof Error ? loginError.message : "ログインを開始できませんでした"); }
  }
  return <main className="login-shell"><div className="login-card"><span className="login-mark">P</span><p className="eyebrow">PHRASENEST</p><h1>{checking ? "保存内容を読み込んでいます" : "学習記録を開く"}</h1><p>{checking ? "少しだけお待ちください。" : "一度ログインすれば、通常は次回から入力せずに利用できます。"}</p>{error && <p className="connection-error">{error}</p>}{!checking && <><button type="button" className="primary-button" onClick={startLogin}>Googleでログイン</button><small className="redirect-hint">SupabaseのRedirect URLsに登録：<code>{redirectUrl}</code></small></>}</div></main>;
}

function PageHeading({ eyebrow, title, description, extra }: { eyebrow: string; title: string; description: string; extra?: React.ReactNode }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{extra}</div>; }
function NavButton({ active, label, count, icon, onClick }: { active: boolean; label: string; count?: number; icon: string; onClick: () => void }) { return <button className={`nav-button ${active ? "active" : ""}`} type="button" onClick={onClick}><span className="nav-icon">{icon}</span><span>{label}</span>{typeof count === "number" && <small>{count}</small>}</button>; }
function AnswerButton({ kind, title, sub, onClick }: { kind: string; title: string; sub: string; onClick: () => void }) { return <button type="button" className={`answer ${kind}`} onClick={onClick}><strong>{title}</strong><small>{sub}</small></button>; }
function SummaryRow({ kind, label, value }: { kind: string; label: string; value: number }) { return <div className="summary-row"><span className={`dot ${kind}`} />{label}<strong>{value}</strong></div>; }
function Usage({ label, current, max, ratio }: { label: string; current: string; max: string; ratio: number }) { return <div className="usage"><div><span>{label}</span><strong>{current} <small>/ {max}</small></strong></div><div className="usage-bar"><span style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} /></div></div>; }

function formatDueLabel(value: string) {
  const difference = new Date(value).getTime() - Date.now();
  if (difference <= 0) return "今日";
  const days = Math.max(1, Math.ceil(difference / 86400000));
  return days === 1 ? "明日" : `${days}日後`;
}
