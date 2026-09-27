"use client";

import { useEffect, useMemo, useState } from "react";
import { captureSessionFromUrl, getStoredSession, loadLearningData, signInWithGoogle, signOut, submitReview, supabaseConfigured } from "./supabase-browser";

type Tab = "today" | "words" | "sentences" | "settings";
type LearningStatus = "unlearned" | "learning" | "mastered";
type Word = { id: string; term: string; meaning: string; note: string; status: LearningStatus; occurrences: number; dueLabel: string; example: string; translation: string };
type Sentence = { id: string; source: string; translation: string; note: string; community: string; savedAt: string; terms: string[] };

const initialWords: Word[] = [
  { id: "w1", term: "on the fence", meaning: "決めかねている、迷っている", note: "二つの選択肢の間で、まだ決断できていない状態。", status: "learning", occurrences: 4, dueLabel: "今日", example: "I'm still on the fence about it.", translation: "それについては、まだ決めかねています。" },
  { id: "w2", term: "turn out", meaning: "結果的に〜になる、判明する", note: "予想していなかった結果を伝えるときによく使う。", status: "learning", occurrences: 7, dueLabel: "今日", example: "It turned out better than I expected.", translation: "思っていたより良い結果になりました。" },
  { id: "w3", term: "across the country", meaning: "国の反対側へ、全国にわたって", note: "文脈によって移動と広がりの両方を表す。", status: "unlearned", occurrences: 1, dueLabel: "今日", example: "I'd have to move across the country.", translation: "国の反対側へ引っ越さなければなりません。" },
  { id: "w4", term: "make sense", meaning: "意味が通る、納得できる", note: "説明を理解したときにも使える。", status: "mastered", occurrences: 9, dueLabel: "12日後", example: "That explanation finally makes sense.", translation: "その説明でようやく納得できました。" },
  { id: "w5", term: "go out of one's way", meaning: "わざわざ〜する", note: "誰かのために特別な手間をかけるニュアンス。", status: "learning", occurrences: 3, dueLabel: "明日", example: "She went out of her way to help me.", translation: "彼女はわざわざ私を助けてくれました。" },
];

const demoSentences: Sentence[] = [
  { id: "s1", source: "I'm still on the fence about it because I'd have to move across the country.", translation: "国の反対側へ引っ越さなければならないので、まだ決めかねています。", note: "転職について迷っている人のコメント。on the fence は直訳しない。", community: "r/AskReddit", savedAt: "今日 20:14", terms: ["on the fence", "across the country"] },
  { id: "s2", source: "It turned out better than I expected, but the first week was rough.", translation: "思っていたより良い結果になりましたが、最初の一週間は大変でした。", note: "turn out は会話で頻出。", community: "r/CasualConversation", savedAt: "昨日", terms: ["turn out"] },
  { id: "s3", source: "She went out of her way to make sure everyone felt welcome.", translation: "彼女はみんなが歓迎されていると感じられるよう、わざわざ気を配りました。", note: "人の親切について話す表現。", community: "r/AskReddit", savedAt: "3日前", terms: ["go out of one's way"] },
];

const statusLabels: Record<LearningStatus, string> = { unlearned: "未学習", learning: "学習中", mastered: "覚えた" };

export function LearningApp() {
  const [tab, setTab] = useState<Tab>("today");
  const [words, setWords] = useState(initialWords);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [filter, setFilter] = useState<LearningStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [sentenceItems, setSentenceItems] = useState(demoSentences);
  const [connection, setConnection] = useState<"demo" | "checking" | "signedout" | "live" | "error">(supabaseConfigured ? "checking" : "demo");
  const [connectionError, setConnectionError] = useState("");

  useEffect(() => {
    if (!supabaseConfigured) return;
    async function initializeCloudData() {
      await Promise.resolve();
      const session = captureSessionFromUrl() || getStoredSession();
      if (!session) { setConnection("signedout"); return; }
      try {
        const { vocabulary, savedSentences } = await loadLearningData();
        const now = Date.now();
        setWords(vocabulary.map((word) => ({ id: word.id, term: word.term, meaning: word.meaning, note: word.note, status: word.status, occurrences: word.occurrence_count, dueLabel: new Date(word.next_review_at).getTime() <= now ? "今日" : `${Math.max(1, Math.ceil((new Date(word.next_review_at).getTime() - now) / 86400000))}日後`, example: "", translation: "" })));
        setSentenceItems(savedSentences.map((sentence) => ({ id: sentence.id, source: sentence.original_text, translation: sentence.translation, note: sentence.note, community: sentence.subreddit || "Reddit", savedAt: new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(new Date(sentence.created_at)), terms: [] })));
        setConnection("live");
      } catch (error) { setConnectionError(error instanceof Error ? error.message : "接続できませんでした"); setConnection("error"); }
    }
    void initializeCloudData();
  }, []);
  const reviewQueue = useMemo(() => words.filter((word) => word.dueLabel === "今日" || word.status === "unlearned"), [words]);
  const reviewWord = reviewQueue[reviewIndex % Math.max(reviewQueue.length, 1)];
  const filteredWords = words.filter((word) => {
    const needle = query.trim().toLowerCase();
    return (filter === "all" || word.status === filter) && (!needle || `${word.term} ${word.meaning}`.toLowerCase().includes(needle));
  });

  function answerReview(result: "forgot" | "uncertain" | "remembered") {
    if (!reviewWord) return;
    if (connection === "live") submitReview(reviewWord.id, result).catch((error) => setConnectionError(error.message));
    setWords((current) => current.map((word) => {
      if (word.id !== reviewWord.id) return word;
      if (result === "forgot") return { ...word, status: "learning", dueLabel: "明日" };
      if (result === "uncertain") return { ...word, status: "learning", dueLabel: "3日後" };
      return { ...word, status: word.status === "learning" ? "mastered" : "learning", dueLabel: "7日後" };
    }));
    setCompleted((count) => count + 1);
    setReviewIndex((index) => index + 1);
    setRevealed(false);
  }

  if (connection === "checking") return <LoginGate checking />;
  if (connection === "signedout") return <LoginGate />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => setTab("today")} aria-label="ホームへ"><span className="brand-mark">P</span><span><strong>PhraseNest</strong><small>Reddit English Notes</small></span></button>
        <div className={`sync-state ${connection}`}><span /> {connection === "live" ? "Supabaseと同期済み" : connection === "error" ? "接続エラー" : "デモデータ"}</div>
      </header>
      <div className="workspace">
        <aside className="sidebar" aria-label="メインメニュー">
          <nav>
            <NavButton active={tab === "today"} label="今日の復習" count={reviewQueue.length} icon="◎" onClick={() => setTab("today")} />
            <NavButton active={tab === "words"} label="単語・熟語" count={words.length} icon="A" onClick={() => setTab("words")} />
            <NavButton active={tab === "sentences"} label="保存した英文" count={sentenceItems.length} icon="¶" onClick={() => setTab("sentences")} />
          </nav>
          <button className={`nav-button ${tab === "settings" ? "active" : ""}`} type="button" onClick={() => setTab("settings")}><span className="nav-icon">⚙</span><span>設定</span></button>
        </aside>
        <section className="content">
          {tab === "today" && <TodayView words={words} reviewWord={reviewWord} revealed={revealed} completed={completed} remaining={Math.max(0, reviewQueue.length - completed)} onReveal={() => setRevealed(true)} onAnswer={answerReview} />}
          {tab === "words" && <WordsView words={filteredWords} filter={filter} query={query} onFilter={setFilter} onQuery={setQuery} />}
          {tab === "sentences" && <SentencesView sentences={sentenceItems} />}
          {tab === "settings" && <SettingsView connection={connection} error={connectionError} />}
        </section>
      </div>
      <nav className="mobile-nav" aria-label="モバイルメニュー">
        <NavButton active={tab === "today"} label="復習" icon="◎" onClick={() => setTab("today")} />
        <NavButton active={tab === "words"} label="語句" icon="A" onClick={() => setTab("words")} />
        <NavButton active={tab === "sentences"} label="英文" icon="¶" onClick={() => setTab("sentences")} />
        <NavButton active={tab === "settings"} label="設定" icon="⚙" onClick={() => setTab("settings")} />
      </nav>
    </main>
  );
}

function TodayView({ words, reviewWord, revealed, completed, remaining, onReveal, onAnswer }: { words: Word[]; reviewWord?: Word; revealed: boolean; completed: number; remaining: number; onReveal: () => void; onAnswer: (result: "forgot" | "uncertain" | "remembered") => void }) {
  return <><PageHeading eyebrow="TODAY'S REVIEW" title="今日の復習" description="よく出会う表現から、少しずつ覚えましょう。" extra={<div className="progress-chip"><strong>{completed}</strong><span>今日の回答</span></div>} />
    <div className="review-grid"><article className="review-card">{reviewWord ? <><div className="card-meta"><span className={`status ${reviewWord.status}`}>{statusLabels[reviewWord.status]}</span><span>{reviewWord.occurrences}回見つけました</span></div><div className="prompt-area"><p className="prompt-label">この表現の意味は？</p><h2>{reviewWord.term}</h2></div>{!revealed ? <button className="primary-button reveal-button" type="button" onClick={onReveal}>答えを見る</button> : <div className="answer-panel"><h3>{reviewWord.meaning}</h3><p>{reviewWord.note}</p><blockquote><strong>{reviewWord.example}</strong><span>{reviewWord.translation}</span></blockquote><div className="answer-buttons"><AnswerButton kind="forgot" title="忘れた" sub="明日もう一度" onClick={() => onAnswer("forgot")} /><AnswerButton kind="uncertain" title="あいまい" sub="3日後" onClick={() => onAnswer("uncertain")} /><AnswerButton kind="remembered" title="覚えていた" sub="7日後" onClick={() => onAnswer("remembered")} /></div></div>}</> : <div className="empty-state"><h2>今日の復習は完了です</h2><p>また明日、少しずつ続けましょう。</p></div>}</article>
      <aside className="today-summary"><h3>今日の予定</h3><div className="ring" style={{ "--progress": `${Math.min(100, completed * 20)}%` } as React.CSSProperties}><span><strong>{remaining}</strong>語</span></div><SummaryRow kind="new" label="未学習" value={words.filter((w) => w.status === "unlearned").length} /><SummaryRow kind="learning" label="学習中" value={words.filter((w) => w.status === "learning").length} /><SummaryRow kind="mastered" label="覚えた" value={words.filter((w) => w.status === "mastered").length} /></aside></div></>;
}

function WordsView({ words, filter, query, onFilter, onQuery }: { words: Word[]; filter: LearningStatus | "all"; query: string; onFilter: (value: LearningStatus | "all") => void; onQuery: (value: string) => void }) {
  return <><PageHeading eyebrow="VOCABULARY" title="単語・熟語" description="Redditで出会った回数と一緒に確認できます。" /><div className="toolbar"><input aria-label="語句を検索" placeholder="語句や意味を検索" value={query} onChange={(event) => onQuery(event.target.value)} /><div className="filter-group">{(["all", "unlearned", "learning", "mastered"] as const).map((value) => <button type="button" key={value} className={filter === value ? "selected" : ""} onClick={() => onFilter(value)}>{value === "all" ? "すべて" : statusLabels[value]}</button>)}</div></div><div className="word-list">{words.map((word) => <article className="word-row" key={word.id}><div><div className="word-title"><h2>{word.term}</h2><span className={`status ${word.status}`}>{statusLabels[word.status]}</span></div><p>{word.meaning}</p><small>{word.note}</small></div><div className="word-stats"><strong>{word.occurrences}</strong><span>登場回数</span><em>{word.dueLabel}</em></div></article>)}</div></>;
}

function SentencesView({ sentences }: { sentences: Sentence[] }) {
  return <><PageHeading eyebrow="SAVED SENTENCES" title="保存した英文" description="元の文脈と、自分の説明を一緒に残します。" /><div className="sentence-list">{sentences.map((sentence) => <article className="sentence-card" key={sentence.id}><div className="sentence-meta"><span>{sentence.community}</span><time>{sentence.savedAt}</time></div><h2>{sentence.source}</h2><p className="translation">{sentence.translation}</p>{sentence.note && <p className="personal-note">メモ：{sentence.note}</p>}<div className="term-tags">{sentence.terms.map((term) => <span key={term}>{term}</span>)}</div></article>)}</div></>;
}

function SettingsView({ connection, error }: { connection: string; error: string }) {
  return <><PageHeading eyebrow="SETTINGS" title="設定" description="料金が予想外に増えないよう、利用方法を確認できます。" /><div className="settings-grid"><section className="setting-card"><div className="setting-heading"><div><span className="setting-icon">¥</span><div><h2>高品質・ほぼ無料モード</h2><p>Google翻訳を優先します。</p></div></div><span className="mode-badge">使用中</span></div><ul><li>通常翻訳：Google翻訳を使用</li><li>利用上限：月450,000文字で停止</li><li>代替翻訳：Google翻訳を使えない場合はChrome内蔵翻訳</li><li>AI解説：ボタンを押した場合のみ</li></ul></section><section className="setting-card"><h2>今月の使用状況</h2><Usage label="Google翻訳" current="0" max="450,000文字" /><Usage label="AI解説の推定料金" current="$0.00" max="$1.00" /></section><section className="setting-card full"><h2>Chrome拡張機能</h2><div className="shortcut-row"><div><p>Redditで英文を選択して呼び出します。</p><small>ショートカットはChromeの設定から変更できます。</small></div><kbd>Ctrl</kbd><b>＋</b><kbd>Shift</kbd><b>＋</b><kbd>Y</kbd></div></section><section className="setting-card full"><h2>クラウド接続</h2><p>{connection === "live" ? "Supabaseに接続し、PCとスマホで同じ記録を利用しています。" : "現在は確認用のデモデータを表示しています。"}</p>{error && <p className="connection-error">{error}</p>}{connection === "live" && <button className="plain-action" type="button" onClick={signOut}>ログアウト</button>}</section></div></>;
}

function LoginGate({ checking = false }: { checking?: boolean }) {
  return <main className="login-shell"><div className="login-card"><span className="login-mark">P</span><p className="eyebrow">PHRASENEST</p><h1>{checking ? "保存内容を読み込んでいます" : "学習記録を開く"}</h1><p>{checking ? "少しだけお待ちください。" : "一度ログインすれば、通常は次回から入力せずに利用できます。"}</p>{!checking && <button type="button" className="primary-button" onClick={signInWithGoogle}>Googleでログイン</button>}</div></main>;
}

function PageHeading({ eyebrow, title, description, extra }: { eyebrow: string; title: string; description: string; extra?: React.ReactNode }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{extra}</div>; }
function NavButton({ active, label, count, icon, onClick }: { active: boolean; label: string; count?: number; icon: string; onClick: () => void }) { return <button className={`nav-button ${active ? "active" : ""}`} type="button" onClick={onClick}><span className="nav-icon">{icon}</span><span>{label}</span>{typeof count === "number" && <small>{count}</small>}</button>; }
function AnswerButton({ kind, title, sub, onClick }: { kind: string; title: string; sub: string; onClick: () => void }) { return <button type="button" className={`answer ${kind}`} onClick={onClick}><strong>{title}</strong><small>{sub}</small></button>; }
function SummaryRow({ kind, label, value }: { kind: string; label: string; value: number }) { return <div className="summary-row"><span className={`dot ${kind}`} />{label}<strong>{value}</strong></div>; }
function Usage({ label, current, max }: { label: string; current: string; max: string }) { return <div className="usage"><div><span>{label}</span><strong>{current} <small>/ {max}</small></strong></div><div className="usage-bar"><span /></div></div>; }
