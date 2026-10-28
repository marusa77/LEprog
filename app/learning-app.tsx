"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { appendVocabularyDetails, applyOrganizationResult, captureSessionFromUrl, consumeReturnTab, getStoredSession, getSupabaseConfiguration, loadLearningData, saveSupabaseConfiguration, signInWithGoogle, signOut, submitReview, updateSentence, updateVocabularyItem } from "./supabase-browser";
import { buildOrganizationExport, countPendingOrganizationItems, exportPresets, OrganizationResult, OrganizationSuggestion, parseOrganizationResult } from "./organization";
import { ManualEntryView } from "./manual-entry";
import { ActivityCalendar } from "./activity-calendar";
import { WritingPracticeView } from "./writing-practice";
import { SentenceLibraryView } from "./sentence-study";
import { KnowledgeNotesView } from "./knowledge-notes";
import { KnowledgeNoteEntryView } from "./knowledge-note-entry";
import { ActivityReviewButton } from "./activity-review-button";
import { UserGuideView } from "./user-guide";
import { initializeSupabaseConfiguration, verifyAppAccess } from "./supabase-browser";
import type { KnowledgeNote } from "./knowledge-notes-data";
import { isReviewPreference, type SentenceStudyMetadata, type StudySentence } from "./sentence-study-data";
import { sentenceSourceLabel } from "./manual-entry-data";
import { isSavedTab, primaryTab, resolveTab, savedTabStorageKey, type SavedTab, type Tab } from "./navigation";

type LearningStatus = "unlearned" | "learning" | "mastered";
type Word = { id: string; term: string; meaning: string; coreImage: string; note: string; status: LearningStatus; occurrences: number; dueLabel: string; example: string; translation: string; createdAt: string; updatedAt: string; organizationCheckedAt: string | null };
type Sentence = StudySentence;

const statusLabels: Record<LearningStatus, string> = { unlearned: "未学習", learning: "学習中", mastered: "覚えた" };

function getInitialTab(): Tab {
  if (typeof window === "undefined") return "today";
  const requestedTab = new URLSearchParams(window.location.search).get("tab") || consumeReturnTab();
  let lastSaved: string | null = null;
  try { lastSaved = localStorage.getItem(savedTabStorageKey); } catch { /* Optional device preference. */ }
  return resolveTab(requestedTab, lastSaved);
}

export function LearningApp() {
  const [tab, setTab] = useState<Tab>(getInitialTab);
  const [lastSavedTab, setLastSavedTab] = useState<SavedTab>("sentences");
  const [words, setWords] = useState<Word[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [filter, setFilter] = useState<LearningStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [largeText, setLargeText] = useState(false);
  const [sentenceItems, setSentenceItems] = useState<Sentence[]>([]);
  const [usage, setUsage] = useState({ cloudCharacters: 0, aiUsd: 0 });
  const [connection, setConnection] = useState<"setup" | "checking" | "signedout" | "live" | "error" | "denied">("checking");
  const [connectionError, setConnectionError] = useState("");
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  const [appendingWord, setAppendingWord] = useState<Word | null>(null);
  const [editingSentence, setEditingSentence] = useState<Sentence | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [activityVersion, setActivityVersion] = useState(0);
  const [knowledgeNoteCount, setKnowledgeNoteCount] = useState(0);
  const [entryKind, setEntryKind] = useState<"english" | "knowledge">("english");
  const [savedKnowledgeNote, setSavedKnowledgeNote] = useState<KnowledgeNote | null>(null);
  const [openKnowledgeNote, setOpenKnowledgeNote] = useState<KnowledgeNote | null>(null);
  const reviewSaving = useRef(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(savedTabStorageKey);
      if (isSavedTab(stored)) setLastSavedTab(stored);
    } catch { /* Navigation works without browser storage. */ }
  }, []);

  useEffect(() => {
    if (!isSavedTab(tab)) return;
    setLastSavedTab(tab);
    try { localStorage.setItem(savedTabStorageKey, tab); } catch { /* Optional device preference. */ }
  }, [tab]);

  useEffect(() => {
    Promise.resolve().then(() => {
      try { setLargeText(localStorage.getItem("phraseNestLargeText") === "true"); } catch { /* Display preference is optional. */ }
    });
    async function initializeCloudData() {
      await initializeSupabaseConfiguration();
      if (!getSupabaseConfiguration()) { setConnection("setup"); return; }
      const session = captureSessionFromUrl() || getStoredSession();
      if (!session) { setConnection("signedout"); return; }
      try {
        if (!await verifyAppAccess()) { setConnectionError("このアカウントには利用許可がありません。許可されたGoogleアカウントでログインしてください。"); setConnection("denied"); return; }
      } catch (error) { setConnectionError(error instanceof Error ? error.message : "利用許可を確認できませんでした。"); setConnection("denied"); return; }
      try {
        const { vocabulary, savedSentences, links, usage: currentUsage } = await loadLearningData();
        const sentenceById = new Map(savedSentences.map((sentence) => [sentence.id, sentence]));
        const vocabularyById = new Map(vocabulary.map((word) => [word.id, word]));
        setWords(vocabulary.map((word) => {
          const exampleLink = links.find((link) => link.vocabulary_id === word.id);
          const exampleSentence = exampleLink ? sentenceById.get(exampleLink.sentence_id) : undefined;
          return { id: word.id, term: word.term, meaning: word.meaning, coreImage: word.core_image || "", note: word.note, status: word.status, occurrences: word.occurrence_count, dueLabel: formatDueLabel(word.next_review_at), example: exampleSentence?.original_text || "", translation: exampleSentence?.translation || "", createdAt: word.created_at, updatedAt: word.updated_at, organizationCheckedAt: word.organization_checked_at };
        }));
        setSentenceItems(savedSentences.map((sentence) => ({
          id: sentence.id,
          source: sentence.original_text,
          translation: sentence.translation,
          note: sentence.note,
          community: sentenceSourceLabel(sentence),
          sourceUrl: sentence.source_url,
          savedAt: new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric" }).format(new Date(sentence.created_at)),
          createdAt: sentence.created_at,
          terms: links.filter((link) => link.sentence_id === sentence.id).map((link) => vocabularyById.get(link.vocabulary_id)?.term || link.selected_text),
          updatedAt: sentence.updated_at,
          organizationCheckedAt: sentence.organization_checked_at,
          reviewPreference: isReviewPreference(sentence.review_preference) ? sentence.review_preference : "normal",
          lastReviewedAt: sentence.last_reviewed_at || null,
          reviewCount: sentence.sentence_review_count || 0,
          reviewReady: isReviewPreference(sentence.review_preference) && "last_reviewed_at" in sentence && typeof sentence.sentence_review_count === "number",
        })));
        setUsage({ cloudCharacters: currentUsage.cloud_translation_characters, aiUsd: Number(currentUsage.ai_estimated_usd) || 0 });
        setConnection("live");
      } catch (error) { setConnectionError(error instanceof Error ? error.message : "接続できませんでした"); setConnection("error"); }
    }
    void initializeCloudData();
  }, [reloadVersion]);
  const reviewQueue = useMemo(() => words.filter((word) => word.dueLabel === "今日" || word.status === "unlearned"), [words]);
  const reviewWord = reviewQueue[0];
  const filteredWords = words.filter((word) => {
    const needle = query.trim().toLowerCase();
    return (filter === "all" || word.status === filter) && (!needle || `${word.term} ${word.meaning} ${word.coreImage} ${word.note}`.toLowerCase().includes(needle));
  });

  async function answerReview(result: "forgot" | "uncertain" | "remembered") {
    if (!reviewWord || reviewSaving.current) return;
    reviewSaving.current = true;
    try {
      const response = await submitReview(reviewWord.id, result);
      setWords((current) => current.map((word) => word.id === reviewWord.id ? { ...word, status: response.status, dueLabel: formatDueLabel(response.next_review_at) } : word));
      setCompleted((count) => count + 1);
      setRevealed(false);
      setActivityVersion((version) => version + 1);
    } catch (error) { setConnectionError(error instanceof Error ? error.message : "復習結果を保存できませんでした"); }
    finally { reviewSaving.current = false; }
  }

  async function saveWordEdit(changes: { meaning: string; core_image: string; note: string; status: LearningStatus }) {
    if (!editingWord) return;
    const updated = await updateVocabularyItem(editingWord.id, changes);
    setWords((current) => current.map((word) => word.id === editingWord.id ? { ...word, meaning: updated.meaning, coreImage: updated.core_image, note: updated.note, status: updated.status, updatedAt: updated.updated_at, organizationCheckedAt: updated.organization_checked_at } : word));
    setEditingWord(null);
  }

  async function appendWordDetails(additions: { meaning: string; core_image: string; note: string }) {
    if (!appendingWord) return;
    const updated = await appendVocabularyDetails(appendingWord.id, additions);
    setWords((current) => current.map((word) => word.id === appendingWord.id ? { ...word, meaning: updated.meaning, coreImage: updated.core_image, note: updated.note, updatedAt: updated.updated_at, organizationCheckedAt: updated.organization_checked_at } : word));
    setAppendingWord(null);
  }

  async function saveSentenceEdit(changes: { translation: string; note: string }) {
    if (!editingSentence) return;
    const updated = await updateSentence(editingSentence.id, changes);
    setSentenceItems((current) => current.map((sentence) => sentence.id === editingSentence.id ? { ...sentence, translation: updated.translation, note: updated.note, updatedAt: updated.updated_at, organizationCheckedAt: updated.organization_checked_at } : sentence));
    setWords((current) => current.map((word) => word.example === editingSentence.source ? { ...word, translation: updated.translation } : word));
    setEditingSentence(null);
  }

  function saveSentenceStudyMetadata(metadata: SentenceStudyMetadata) {
    setActivityVersion(version => version + 1);
    setSentenceItems(current => current.map(sentence => sentence.id === metadata.id ? {
      ...sentence, reviewPreference:metadata.review_preference, lastReviewedAt:metadata.last_reviewed_at, reviewCount:metadata.sentence_review_count,
    } : sentence));
  }

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    setSearchQuery("");
    const url = new URL(window.location.href);
    if (nextTab === "today") url.searchParams.delete("tab");
    else url.searchParams.set("tab", nextTab);
    history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  function createKnowledgeNote() {
    setEntryKind("knowledge"); selectTab("capture");
  }

  function recordCreatedKnowledgeNote(note: KnowledgeNote) {
    setSavedKnowledgeNote(note); setKnowledgeNoteCount(count => count + 1);
  }

  function openSavedKnowledgeNote(note: KnowledgeNote) {
    // A fresh request also reopens the same saved note after other navigation.
    setOpenKnowledgeNote({ ...note }); selectTab("notes");
  }

  if (connection === "checking") return <LoginGate checking />;
  if (connection === "setup") return <SetupGate onComplete={() => setConnection("signedout")} />;
  if (connection === "signedout") return <LoginGate />;
  if (connection === "denied") return <main className="login-shell"><div className="login-card"><span className="login-mark">P</span><h1>利用許可の確認</h1><p role="alert">{connectionError}</p><button className="primary-button" type="button" onClick={() => setReloadVersion(value => value + 1)}>再確認</button><button className="plain-action" type="button" onClick={signOut}>別のアカウントでログイン</button></div></main>;

  const noteCount = knowledgeNoteCount + words.filter((word) => word.coreImage).length + words.filter((word) => word.note).length + sentenceItems.filter((sentence) => sentence.note).length;
  const organizationCount = countPendingOrganizationItems(words, sentenceItems);

  return (
    <main className={`app-shell ${largeText ? "large-text" : ""}`}>
      <header className="topbar">
        <button className="brand" type="button" onClick={() => selectTab("today")} aria-label="ホームへ"><span className="brand-mark">P</span><span><strong>PhraseNest</strong></span></button>
        <div className="topbar-actions"><button className="guide-link" type="button" aria-current={tab === "help" ? "page" : undefined} onClick={() => selectTab("help")}>使い方</button><button className="text-size-button" type="button" aria-pressed={largeText} onClick={() => {
          const next = !largeText; setLargeText(next);
          try { localStorage.setItem("phraseNestLargeText", String(next)); } catch { /* Display preference is optional. */ }
        }}>文字 {largeText ? "標準に戻す" : "大きめ"}</button><div className={`sync-state ${connection}`}><span /> {connection === "live" ? "同期済み" : connection === "error" ? "接続エラー" : "デモデータ"}</div></div>
      </header>
      <div className="workspace">
        <aside className="sidebar" aria-label="メインメニュー">
          <nav>
            <PrimaryNavigation tab={tab} onSelect={selectTab} lastSavedTab={lastSavedTab} />
          </nav>
        </aside>
        <section className="content">
          {(tab === "organize" || tab === "settings" || tab === "writing" || tab === "help") && <button className="menu-back" type="button" onClick={() => selectTab("menu")}>メニューに戻る</button>}
          <div hidden={tab !== "capture"}><PageHeading title="入力して保存" /><EntryKindNavigation value={entryKind} onSelect={setEntryKind} /></div>
          <div className="manual-entry-panel" hidden={tab !== "capture" || entryKind !== "english"}><ManualEntryView showHeading={false} onSaved={() => setReloadVersion((version) => version + 1)} onOpenLibrary={() => selectTab("sentences")} onTranslation={(monthlyCharacters) => setUsage((current) => ({ ...current, cloudCharacters: monthlyCharacters }))} /></div>
          <div className="knowledge-entry-panel" hidden={tab !== "capture" || entryKind !== "knowledge"}><KnowledgeNoteEntryView onSaved={recordCreatedKnowledgeNote} onOpenSaved={openSavedKnowledgeNote} /></div>
          <div className="writing-entry-panel" hidden={tab !== "writing"}><WritingPracticeView words={words} sentences={sentenceItems} onSaved={() => setReloadVersion((version) => version + 1)} onOpenLibrary={() => selectTab("sentences")} onEditSentence={(id) => setEditingSentence(sentenceItems.find(sentence => sentence.id === id) || null)} /></div>
          {isSavedTab(tab) && <SavedContentNavigation tab={tab} onSelect={selectTab} counts={{ sentences: sentenceItems.length, words: words.length, notes: noteCount }} />}
          {(tab === "today" || tab === "sentences" || tab === "words") && <div className="library-search"><label htmlFor="library-search" className="sr-only">保存内容を検索</label><div><input id="library-search" type="search" placeholder="英文・語句・メモを検索" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />{searchQuery && <button type="button" onClick={() => setSearchQuery("")}>検索をクリア</button>}</div></div>}
          <div hidden={tab !== "sentences" || Boolean(searchQuery.trim())}><SentenceLibraryView active={tab === "sentences" && !searchQuery.trim()} sentences={sentenceItems} onEdit={setEditingSentence} onStudyUpdated={saveSentenceStudyMetadata} /></div>
          <div hidden={tab !== "notes"}><NotesView active={tab === "notes"} words={words} sentences={sentenceItems} onEditWord={setEditingWord} onEditSentence={setEditingSentence} onKnowledgeCountChange={setKnowledgeNoteCount} onCreateKnowledgeNote={createKnowledgeNote} savedKnowledgeNote={savedKnowledgeNote} openNoteRequest={openKnowledgeNote} /></div>
          {tab !== "capture" && tab !== "writing" && <>
          {searchQuery.trim() ? <SearchView words={words} sentences={sentenceItems} query={searchQuery} onEditWord={setEditingWord} onEditSentence={setEditingSentence} /> : <>
            {tab === "today" && <><ActivityCalendar refreshVersion={reloadVersion + activityVersion} /><TodayView words={words} reviewWord={reviewWord} revealed={revealed} completed={completed} remaining={reviewQueue.length} onReveal={() => setRevealed(true)} onAnswer={answerReview} /></>}
            {tab === "words" && <WordsView words={filteredWords} filter={filter} query={query} onFilter={setFilter} onQuery={setQuery} onEdit={setEditingWord} onAppend={setAppendingWord} />}
            {tab === "organize" && <OrganizationView words={words} sentences={sentenceItems} />}
            {tab === "settings" && <SettingsView connection={connection} error={connectionError} usage={usage} />}
            {tab === "menu" && <MenuView pendingCount={organizationCount} onSelect={selectTab} />}
            {tab === "help" && <UserGuideView onSelect={selectTab} />}
          </>}</>}
        </section>
      </div>
      <nav className="mobile-nav" aria-label="モバイルメニュー">
        <PrimaryNavigation tab={tab} onSelect={selectTab} lastSavedTab={lastSavedTab} mobile />
      </nav>
      {editingWord && <WordEditor key={editingWord.id} word={editingWord} onClose={() => setEditingWord(null)} onSave={saveWordEdit} />}
      {appendingWord && <WordAppendDialog key={appendingWord.id} word={appendingWord} onClose={() => setAppendingWord(null)} onSave={appendWordDetails} />}
      {editingSentence && <SentenceEditor key={editingSentence.id} sentence={editingSentence} onClose={() => setEditingSentence(null)} onSave={saveSentenceEdit} />}
    </main>
  );
}

export function EntryKindNavigation({ value, onSelect }: { value: "english" | "knowledge"; onSelect: (value: "english" | "knowledge") => void }) {
  return <div className="filter-group entry-kind-nav" role="group" aria-label="入力する内容">
    <button type="button" className={value === "english" ? "selected" : ""} aria-pressed={value === "english"} onClick={() => onSelect("english")}>英文・訳</button>
    <button type="button" className={value === "knowledge" ? "selected" : ""} aria-pressed={value === "knowledge"} onClick={() => onSelect("knowledge")}>知識ノート</button>
  </div>;
}

export function PrimaryNavigation({ tab, lastSavedTab, onSelect, mobile = false }: { tab: Tab; lastSavedTab: SavedTab; onSelect: (tab: Tab) => void; mobile?: boolean }) {
  const active = primaryTab(tab);
  return <>
    <NavButton active={active === "capture"} label={mobile ? "入力" : "入力して保存"} icon="＋" onClick={() => onSelect("capture")} />
    <NavButton active={active === "today"} label="今日の復習" icon="◎" onClick={() => onSelect("today")} />
    <NavButton active={active === "library"} label="保存内容" icon="▤" onClick={() => onSelect(lastSavedTab)} />
    <NavButton active={active === "menu"} label="メニュー" icon="☰" onClick={() => onSelect("menu")} />
  </>;
}

export function SavedContentNavigation({ tab, onSelect, counts }: { tab: SavedTab; onSelect: (tab: Tab) => void; counts: Record<SavedTab, number> }) {
  return <nav className="saved-content-nav" aria-label="保存内容の種類">
    {([['sentences', '英文'], ['words', '単語・熟語'], ['notes', '学習メモ']] as const).map(([value, label]) => <button type="button" key={value} className={tab === value ? "active" : ""} aria-current={tab === value ? "page" : undefined} onClick={() => onSelect(value)}><span>{label}</span><small>{counts[value]}</small></button>)}
  </nav>;
}

export function MenuView({ pendingCount, onSelect }: { pendingCount: number; onSelect: (tab: Tab) => void }) {
  return <><PageHeading title="メニュー" /><div className="menu-options">
    <button type="button" className="menu-option" onClick={() => onSelect("writing")}><span className="menu-option-icon" aria-hidden="true">✎</span><span><strong>英作文の練習</strong></span></button>
    <button type="button" className="menu-option" onClick={() => onSelect("organize")}><span className="menu-option-icon" aria-hidden="true">◇</span><span><strong>Codex整理</strong><span>メモや熟語の整理・結果の読み込み</span></span><small>未整理 {pendingCount}件</small></button>
    <button type="button" className="menu-option" onClick={() => onSelect("settings")}><span className="menu-option-icon" aria-hidden="true">⚙</span><span><strong>設定</strong><span>接続情報・翻訳の使用量・ログイン</span></span></button>
    <button type="button" className="menu-option" onClick={() => onSelect("help")}><span className="menu-option-icon" aria-hidden="true">?</span><span><strong>使い方</strong></span></button>
  </div></>;
}

function TodayView({ words, reviewWord, revealed, completed, remaining, onReveal, onAnswer }: { words: Word[]; reviewWord?: Word; revealed: boolean; completed: number; remaining: number; onReveal: () => void; onAnswer: (result: "forgot" | "uncertain" | "remembered") => void }) {
  return <><PageHeading title="今日の復習" extra={<div className="progress-chip"><strong>{completed}</strong><span>今回の回答</span></div>} />
    <div className="review-grid"><article className="review-card">{reviewWord ? <><div className="card-meta"><span className={`status ${reviewWord.status}`}>{statusLabels[reviewWord.status]}</span><span>{reviewWord.occurrences}回見つけました</span></div><div className="prompt-area"><p className="prompt-label">この表現の意味は？</p><h2>{reviewWord.term}</h2></div>{!revealed ? <button className="primary-button reveal-button" type="button" onClick={onReveal}>答えを見る</button> : <div className="answer-panel"><h3>{reviewWord.meaning}</h3>{reviewWord.coreImage && <div className="review-core-image"><span>コアイメージ</span><p>{reviewWord.coreImage}</p></div>}{reviewWord.note && <p>{reviewWord.note}</p>}<blockquote><strong>{reviewWord.example}</strong><span>{reviewWord.translation}</span></blockquote><div className="answer-buttons"><AnswerButton kind="forgot" title="忘れた" sub="明日もう一度" onClick={() => onAnswer("forgot")} /><AnswerButton kind="uncertain" title="あいまい" sub="3日後" onClick={() => onAnswer("uncertain")} /><AnswerButton kind="remembered" title="覚えていた" sub="7日後" onClick={() => onAnswer("remembered")} /></div></div>}</> : <div className="empty-state"><h2>今日の復習は完了です</h2><p>また明日、少しずつ続けましょう。</p></div>}</article>
      <aside className="today-summary"><h3>今日の予定</h3><div className="ring" style={{ "--progress": `${Math.min(100, completed * 20)}%` } as React.CSSProperties}><span><strong>{remaining}</strong>語</span></div><SummaryRow kind="new" label="未学習" value={words.filter((w) => w.status === "unlearned").length} /><SummaryRow kind="learning" label="学習中" value={words.filter((w) => w.status === "learning").length} /><SummaryRow kind="mastered" label="覚えた" value={words.filter((w) => w.status === "mastered").length} /></aside></div></>;
}

function WordsView({ words, filter, query, onFilter, onQuery, onEdit, onAppend }: { words: Word[]; filter: LearningStatus | "all"; query: string; onFilter: (value: LearningStatus | "all") => void; onQuery: (value: string) => void; onEdit: (word: Word) => void; onAppend: (word: Word) => void }) {
  const [quickFilter, setQuickFilter] = useState<"all" | "notes" | "frequent">("all");
  const [sort, setSort] = useState<"review" | "recent" | "frequent">("review");
  const visibleWords = words.filter((word) => quickFilter === "all" || (quickFilter === "notes" ? Boolean(word.note.trim() || word.coreImage.trim()) : word.occurrences >= 3));
  if (sort === "recent") visibleWords.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (sort === "frequent") visibleWords.sort((a, b) => b.occurrences - a.occurrences);
  return <><PageHeading title="単語・熟語" />
    <div className="toolbar"><input aria-label="語句を検索" placeholder="語句・意味・メモを検索" value={query} onChange={(event) => onQuery(event.target.value)} /><div className="filter-group">{(["all", "unlearned", "learning", "mastered"] as const).map((value) => <button type="button" key={value} className={filter === value ? "selected" : ""} onClick={() => onFilter(value)}>{value === "all" ? "すべて" : statusLabels[value]}</button>)}</div></div>
    <div className="library-controls"><div className="filter-group">{(["all", "notes", "frequent"] as const).map((value) => <button key={value} type="button" className={quickFilter === value ? "selected" : ""} onClick={() => setQuickFilter(value)}>{value === "all" ? "すべての語句" : value === "notes" ? "メモあり" : "よく出会う（3回以上）"}</button>)}</div><label>並び順 <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="review">復習の順番</option><option value="recent">最新順</option><option value="frequent">登場回数順</option></select></label></div>
    {visibleWords.length ? <div className="word-list">{visibleWords.map((word) => <article className="word-row" key={word.id}><div><div className="word-title"><h2>{word.term}</h2><span className={`status ${word.status}`}>{statusLabels[word.status]}</span></div><p>{word.meaning || "意味はまだありません"}</p>{word.coreImage && <div className="word-core-image"><span>コアイメージ</span>{word.coreImage}</div>}{word.note && <small>{word.note}</small>}</div><div className="word-actions"><div className="word-edit-actions"><button className="edit-button" type="button" onClick={() => onAppend(word)}>追記</button><button className="edit-button" type="button" onClick={() => onEdit(word)}>編集</button></div><div className="word-stats"><strong>{word.occurrences}</strong><span>登場回数</span><em>{word.dueLabel}</em></div></div></article>)}</div> : <div className="list-empty"><h2>語句が見つかりません</h2><p>検索条件を変えるか、「入力して保存」から追加してください。</p></div>}
  </>;
}

function SearchView({ words, sentences, query, onEditWord, onEditSentence }: { words: Word[]; sentences: Sentence[]; query: string; onEditWord: (word: Word) => void; onEditSentence: (sentence: Sentence) => void }) {
  const needle = query.trim().toLowerCase();
  const matchingWords = words.filter((word) => `${word.term} ${word.meaning} ${word.coreImage} ${word.note}`.toLowerCase().includes(needle));
  const matchingSentences = sentences.filter((sentence) => `${sentence.source} ${sentence.translation} ${sentence.note} ${sentence.terms.join(" ")}`.toLowerCase().includes(needle));
  return <><PageHeading title="検索結果" description={`「${query.trim()}」：語句 ${matchingWords.length}件・英文 ${matchingSentences.length}件`} />
    {!!matchingWords.length && <section className="search-section"><h2>単語・熟語・語句メモ</h2><div className="note-list">{matchingWords.map((word) => <article className="note-card" key={word.id}><div className="note-card-heading"><h3>{word.term}</h3><button className="edit-button" type="button" onClick={() => onEditWord(word)}>編集</button></div><p className="note-body">{word.meaning}</p>{word.coreImage && <div className="word-core-image"><span>コアイメージ</span>{word.coreImage}</div>}{word.note && <p className="note-body">{word.note}</p>}</article>)}</div></section>}
    {!!matchingSentences.length && <section className="search-section"><h2>英文・英文メモ</h2><div className="sentence-list">{matchingSentences.map((sentence) => <article className="sentence-card" key={sentence.id}><div className="sentence-meta"><span>{sentence.community}</span><button className="edit-button" type="button" onClick={() => onEditSentence(sentence)}>編集</button></div><h3>{sentence.source}</h3><p className="translation">{sentence.translation}</p>{sentence.note && <p className="personal-note">{sentence.note}</p>}</article>)}</div></section>}
    {!matchingWords.length && !matchingSentences.length && <div className="list-empty"><h2>保存内容が見つかりません</h2><p>短い語句や日本語の意味でも検索できます。</p></div>}
  </>;
}

type NoteFilter = "all" | "core" | "word" | "sentence";

export function NotesView({ words, sentences, onEditWord, onEditSentence, active = true, onKnowledgeCountChange, onCreateKnowledgeNote, savedKnowledgeNote, openNoteRequest }: {
  words: Word[]; sentences: Sentence[]; onEditWord: (word: Word) => void; onEditSentence: (sentence: Sentence) => void;
  active?: boolean; onKnowledgeCountChange?: (count: number) => void; onCreateKnowledgeNote: () => void;
  savedKnowledgeNote?: KnowledgeNote | null; openNoteRequest?: KnowledgeNote | null;
}) {
  const [section, setSection] = useState<"knowledge" | "attached">("knowledge");
  useEffect(() => { if (openNoteRequest) setSection("knowledge"); }, [openNoteRequest]);
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [query, setQuery] = useState("");
  const notes = [
    ...words.filter((word) => word.coreImage).map((word) => ({ id: `core-${word.id}`, sourceId:word.id, kind: "core" as const, label: "コアイメージ", title: word.term, body: word.coreImage, context: word.meaning, edit: () => onEditWord(word) })),
    ...words.filter((word) => word.note).map((word) => ({ id: `word-${word.id}`, sourceId:word.id, kind: "word" as const, label: "語句メモ", title: word.term, body: word.note, context: word.meaning, edit: () => onEditWord(word) })),
    ...sentences.filter((sentence) => sentence.note).map((sentence) => ({ id: `sentence-${sentence.id}`, sourceId:sentence.id, kind: "sentence" as const, label: "英文メモ", title: sentence.source, body: sentence.note, context: sentence.translation, edit: () => onEditSentence(sentence) })),
  ];
  const needle = query.trim().toLowerCase();
  const visibleNotes = notes.filter((note) => (filter === "all" || note.kind === filter) && (!needle || `${note.title} ${note.body} ${note.context}`.toLowerCase().includes(needle)));
  const labels: Record<NoteFilter, string> = { all: "すべて", core: "コアイメージ", word: "語句メモ", sentence: "英文メモ" };
  return <><PageHeading title="学習メモ" />
    <div className="filter-group notes-sections" role="group" aria-label="学習メモの種類">
      <button type="button" className={section === "knowledge" ? "selected" : ""} aria-pressed={section === "knowledge"} onClick={() => setSection("knowledge")}>知識ノート</button>
      <button type="button" className={section === "attached" ? "selected" : ""} aria-pressed={section === "attached"} onClick={() => setSection("attached")}>英文・語句のメモ</button>
    </div>
    <KnowledgeNotesView active={active && section === "knowledge"} onCountChange={onKnowledgeCountChange} onCreateNote={onCreateKnowledgeNote} savedNote={savedKnowledgeNote} openNoteRequest={openNoteRequest} />
    {active && section === "attached" && <><div className="toolbar"><input aria-label="学習メモを検索" placeholder="語句・英文・メモ本文を検索" value={query} onChange={(event) => setQuery(event.target.value)} /><div className="filter-group">{(["all", "core", "word", "sentence"] as const).map((value) => <button type="button" key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{labels[value]}</button>)}</div></div>{visibleNotes.length ? <div className="note-list">{visibleNotes.map((note) => <article className={`note-card ${note.kind}`} key={note.id}><div className="note-card-heading"><div><span>{note.label}</span><h2>{note.title}</h2></div><button className="edit-button" type="button" onClick={note.edit}>編集</button></div><p className="note-body">{note.body}</p>{note.context && <p className="note-context">{note.context}</p>}<ActivityReviewButton source={note.kind === "sentence" ? "sentence" : "vocabulary"} id={note.sourceId} /></article>)}</div> : <div className="list-empty"><h2>表示できるメモがありません</h2><p>絞り込みを変えるか、語句や英文にメモを追加してください。</p></div>}</>}
  </>;
}

type SuggestionDecision = "pending" | "accepted" | "rejected";

function OrganizationView({ words, sentences }: { words: Word[]; sentences: Sentence[] }) {
  const [presetIndex, setPresetIndex] = useState(1);
  const [result, setResult] = useState<OrganizationResult | null>(null);
  const [decisions, setDecisions] = useState<Record<string, SuggestionDecision>>({});
  const [message, setMessage] = useState("");
  const [applying, setApplying] = useState(false);
  const exportData = useMemo(() => buildOrganizationExport(words, sentences, exportPresets[presetIndex]), [words, sentences, presetIndex]);
  const pendingCount = useMemo(() => countPendingOrganizationItems(words, sentences), [words, sentences]);
  const undecidedCount = result?.suggestions.filter((suggestion) => (decisions[suggestion.id] || "pending") === "pending").length || 0;

  function downloadExport() {
    if (!exportData.itemCount) return;
    const blob = new Blob([exportData.serialized], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${exportData.payload.export_id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("整理用ファイルを保存しました。依頼文と一緒にCodexへ渡してください。");
  }

  async function copyRequest() {
    try {
      await navigator.clipboard.writeText("PhraseNestの整理をお願いします。添付したJSONと docs/organization-guide.md に従い、元のメモを変更せず、結果JSONを作成してください。");
      setMessage("Codexへの依頼文をコピーしました。");
    } catch { setMessage("コピーできませんでした。『PhraseNestの整理をお願いします』とCodexへ伝えてください。"); }
  }

  async function importResult(file?: File) {
    if (!file) return;
    try {
      const parsed = parseOrganizationResult(await file.text());
      setResult(parsed);
      setDecisions(Object.fromEntries(parsed.suggestions.map((suggestion) => [suggestion.id, "pending"])));
      setMessage(`${parsed.suggestions.length}件の整理候補を読み込みました。内容を確認してください。`);
    } catch (error) {
      setResult(null);
      setMessage(error instanceof Error ? error.message : "整理結果を読み込めませんでした");
    }
  }

  async function finishOrganization() {
    if (!result || undecidedCount) return;
    setApplying(true);
    setMessage("");
    try {
      const accepted = result.suggestions.filter((suggestion) => decisions[suggestion.id] === "accepted");
      await applyOrganizationResult(result.processed_sources, accepted as unknown as Array<Record<string, unknown>>);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "整理結果を保存できませんでした");
      setApplying(false);
    }
  }

  return <>
    <PageHeading title="定期整理" extra={<div className="progress-chip organizer-pending"><strong>{pendingCount}</strong><span>未整理</span></div>} />
    <div className="organizer-steps">
      <section className="organizer-card">
        <span className="step-number">1</span><div><h2>未整理分を書き出す</h2></div>
        <div className="organizer-controls"><label>一度に処理する量<select value={presetIndex} onChange={(event) => setPresetIndex(Number(event.target.value))}>{exportPresets.map((preset, index) => <option value={index} key={preset.label}>{preset.label}：最大{preset.maxItems}件</option>)}</select></label><div className="token-estimate"><strong>{pendingCount}</strong><span>件が未整理</span><strong>{exportData.itemCount}</strong><span>件を今回書き出し</span><strong>約{exportData.estimatedTokens.toLocaleString()}</strong><span>トークン以下の目安</span></div></div>
        <div className="organizer-actions"><button className="primary-button" type="button" onClick={downloadExport} disabled={!exportData.itemCount}>整理用JSONを保存</button><button className="plain-action" type="button" onClick={copyRequest}>依頼文をコピー</button></div>
        {!exportData.itemCount && <p className="organizer-done">現在、未整理のデータはありません。</p>}
      </section>
      <section className="organizer-card">
        <span className="step-number">2</span><div><h2>Codexの結果を読み込む</h2><p>書き出した元のJSONではなく、整理後の結果を選んでください。</p></div>
        <label className="file-button">整理結果JSONを選ぶ<input type="file" accept="application/json,.json" onChange={(event) => void importResult(event.target.files?.[0])} /></label>
      </section>
    </div>
    {message && <p className="organizer-message" role="status">{message}</p>}
    {result && <section className="suggestion-section"><div className="suggestion-heading"><h2>整理候補を確認</h2><span>{undecidedCount}件 未確認</span></div>{result.suggestions.length ? <div className="suggestion-list">{result.suggestions.map((suggestion) => <SuggestionCard key={suggestion.id} suggestion={suggestion} decision={decisions[suggestion.id] || "pending"} words={words} sentences={sentences} onDecision={(decision) => setDecisions((current) => ({ ...current, [suggestion.id]: decision }))} />)}</div> : <div className="list-empty"><h2>追加候補はありませんでした</h2><p>確認済みとして完了すると、同じデータを次回もう一度送らずに済みます。</p></div>}<div className="organizer-finish"><p>採用しない候補があっても、元のメモは残ります。</p><button className="primary-button" type="button" disabled={applying || undecidedCount > 0} onClick={() => void finishOrganization()}>{applying ? "保存中…" : "確認した内容で整理を完了"}</button></div></section>}
  </>;
}

function SuggestionCard({ suggestion, decision, words, sentences, onDecision }: { suggestion: OrganizationSuggestion; decision: SuggestionDecision; words: Word[]; sentences: Sentence[]; onDecision: (decision: SuggestionDecision) => void }) {
  const word = words.find((item) => item.id === suggestion.vocabulary_id);
  const sentence = sentences.find((item) => item.id === suggestion.sentence_id);
  const confidenceLabel = { high: "確信度 高", medium: "確信度 中", low: "要確認" }[suggestion.confidence];
  return <article className={`suggestion-card ${decision}`}><div className="suggestion-meta"><span>{suggestion.type === "core_image" ? "コアイメージ" : "新しい熟語"}</span><em>{confidenceLabel}</em></div><h3>{suggestion.type === "core_image" ? word?.term || "語句" : suggestion.term}</h3>{suggestion.type === "core_image" ? <div className="suggestion-compare"><div><small>現在</small><p>{word?.coreImage || "未登録"}</p></div><div><small>整理候補</small><p>{suggestion.proposed_core_image}</p></div></div> : <><p className="suggestion-value">{suggestion.meaning || "意味は未入力"}</p>{suggestion.proposed_core_image && <div className="suggested-core-image"><small>コアイメージ候補</small><p>{suggestion.proposed_core_image}</p></div>}{suggestion.note && <p className="suggested-note">補足：{suggestion.note}</p>}{sentence && <blockquote>{sentence.source}</blockquote>}</>}<p className="suggestion-reason">理由：{suggestion.reason}</p><div className="suggestion-actions"><button type="button" className={decision === "rejected" ? "selected reject" : ""} onClick={() => onDecision("rejected")}>使わない</button><button type="button" className={decision === "accepted" ? "selected accept" : ""} onClick={() => onDecision("accepted")}>採用する</button></div></article>;
}

export function WordAppendDialog({ word, onClose, onSave }: { word: Pick<Word, "term">; onClose: () => void; onSave: (additions: { meaning: string; core_image: string; note: string }) => Promise<void> }) {
  const [meaning, setMeaning] = useState("");
  const [coreImage, setCoreImage] = useState("");
  const [note, setNote] = useState("");
  return <EditDialog title={`${word.term} に説明を追記`} dirty={Boolean(meaning.trim() || coreImage.trim() || note.trim())} submitLabel="追記を保存" onClose={onClose} onSubmit={() => onSave({ meaning, core_image: coreImage, note })}>
    <p className="append-help">元の説明を残し、区切り線の下に追加します。</p>
    <label>追加の意味<textarea value={meaning} onChange={(event) => setMeaning(event.target.value)} rows={3} /></label>
    <label>追加のコアイメージ<textarea value={coreImage} onChange={(event) => setCoreImage(event.target.value)} rows={5} /></label>
    <label>追加のメモ<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} /></label>
  </EditDialog>;
}

function WordEditor({ word, onClose, onSave }: { word: Word; onClose: () => void; onSave: (changes: { meaning: string; core_image: string; note: string; status: LearningStatus }) => Promise<void> }) {
  const [meaning, setMeaning] = useState(word.meaning);
  const [coreImage, setCoreImage] = useState(word.coreImage);
  const [note, setNote] = useState(word.note);
  const [status, setStatus] = useState(word.status);
  return <EditDialog title={`${word.term} を編集`} dirty={meaning !== word.meaning || coreImage !== word.coreImage || note !== word.note || status !== word.status} onClose={onClose} onSubmit={() => onSave({ meaning: meaning.trim(), core_image: coreImage.trim(), note: note.trim(), status })}><p className="append-help">既存の内容を書き換えます。説明を残して追加する場合は「追記」を使ってください。</p><label>意味<textarea value={meaning} onChange={(event) => setMeaning(event.target.value)} placeholder="日本語の意味" rows={4} /></label><label>コアイメージ<textarea value={coreImage} onChange={(event) => setCoreImage(event.target.value)} placeholder="表現の中心となる感覚やイメージ" rows={5} /></label><label>自由メモ<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="使い分け、文法、自分なりの覚え方など" rows={4} /></label><label>学習状態<select value={status} onChange={(event) => setStatus(event.target.value as LearningStatus)}><option value="unlearned">未学習</option><option value="learning">学習中</option><option value="mastered">覚えた</option></select></label></EditDialog>;
}

function SentenceEditor({ sentence, onClose, onSave }: { sentence: Sentence; onClose: () => void; onSave: (changes: { translation: string; note: string }) => Promise<void> }) {
  const [translation, setTranslation] = useState(sentence.translation);
  const [note, setNote] = useState(sentence.note);
  return <EditDialog title="英文の訳とメモを編集" dirty={translation !== sentence.translation || note !== sentence.note} onClose={onClose} onSubmit={() => onSave({ translation: translation.trim(), note: note.trim() })}><div className="source-preview"><span>元の英文</span><p>{sentence.source}</p></div><label>自分で直した訳<textarea value={translation} onChange={(event) => setTranslation(event.target.value)} placeholder="英文全体の訳" rows={4} /></label><label>自分用メモ<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="気づいた点や補足説明など" rows={4} /></label></EditDialog>;
}

function EditDialog({ title, children, dirty, onClose, onSubmit, submitLabel = "変更を保存" }: { title: string; children: React.ReactNode; dirty: boolean; onClose: () => void; onSubmit: () => Promise<void>; submitLabel?: string }) {
  const [saving, setSaving] = useState(false);
  const operation = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    function warnBeforeLeaving(event: BeforeUnloadEvent) { if (dirty) { event.preventDefault(); event.returnValue = ""; } }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);
  function close() { if (!saving && (!dirty || window.confirm("変更はまだ保存されていません。編集を閉じますか？"))) onClose(); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (operation.current || !dirty) return;
    operation.current = true;
    setSaving(true); setError("");
    try { await onSubmit(); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "変更を保存できませんでした"); setSaving(false); }
    finally { operation.current = false; }
  }
  return <div className="dialog-backdrop" role="presentation"><form className="edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-dialog-title" onSubmit={submit}><div className="dialog-heading"><h2 id="edit-dialog-title">{title}</h2><button type="button" aria-label="閉じる" onClick={close} disabled={saving}>×</button></div><p className={`edit-save-state ${dirty ? "unsaved" : ""}`} role="status">{saving ? "保存中…" : dirty ? "未保存の変更があります" : "保存内容から変更なし"}</p><fieldset className="dialog-fields" disabled={saving}>{children}</fieldset>{error && <p className="connection-error">{error}</p>}<div className="dialog-actions"><button className="plain-action" type="button" onClick={close} disabled={saving}>キャンセル</button><button className="primary-button" type="submit" disabled={saving || !dirty}>{saving ? "保存中…" : submitLabel}</button></div></form></div>;
}

function SettingsView({ connection, error, usage }: { connection: string; error: string; usage: { cloudCharacters: number; aiUsd: number } }) {
  return <><PageHeading title="設定" /><div className="settings-grid">
    <section className="setting-card"><div className="setting-heading"><h2>翻訳</h2><span className="mode-badge">ほぼ無料モード</span></div><ul><li>Google翻訳：月450,000文字で停止</li><li>代替：Chrome内蔵翻訳（対応端末のみ）</li><li>AI解説：操作した場合のみ</li></ul></section>
    <section className="setting-card"><h2>今月の使用状況</h2><Usage label="Google翻訳" current={usage.cloudCharacters.toLocaleString()} max="450,000文字" ratio={usage.cloudCharacters / 450000} /><Usage label="AI解説の推定料金" current={`$${usage.aiUsd.toFixed(3)}`} max="$1.00" ratio={usage.aiUsd} /></section>
    <section className="setting-card full"><h2>Chrome拡張機能</h2><div className="shortcut-row"><div><p>英文を選択して開く</p><small>Chromeの拡張機能の設定から変更できます。</small></div><kbd>Ctrl</kbd><b>＋</b><kbd>Shift</kbd><b>＋</b><kbd>Y</kbd></div></section>
    <section className="setting-card full"><h2>クラウド接続</h2><p>{connection === "live" ? "接続済み" : "Supabaseとの接続を確認してください。"}</p>{error && <p className="connection-error">{error}</p>}{connection === "live" && <button className="plain-action" type="button" onClick={signOut}>ログアウト</button>}</section>
  </div></>;
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
  return <main className="login-shell"><form className="login-card setup-card" onSubmit={save}><span className="login-mark">P</span><h1>Supabaseを接続</h1><p>拡張機能と同じ公開用の接続情報を入力してください。</p><label>Project URL<input type="url" value={projectUrl} onChange={(event) => setProjectUrl(event.target.value)} placeholder="https://xxxxx.supabase.co" required /></label><label>Publishable key<input type="password" value={publishableKey} onChange={(event) => setPublishableKey(event.target.value)} placeholder="sb_publishable_..." required /></label>{message && <p className="connection-error">{message}</p>}<button type="submit" className="primary-button" disabled={saving}>{saving ? "接続を確認中…" : "接続情報を保存"}</button><small>Secret keyやデータベースのパスワードは入力しないでください。</small></form></main>;
}

function LoginGate({ checking = false }: { checking?: boolean }) {
  const [error, setError] = useState("");
  const redirectUrl = typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`;
  function startLogin() {
    try { signInWithGoogle(); }
    catch (loginError) { setError(loginError instanceof Error ? loginError.message : "ログインを開始できませんでした"); }
  }
  return <main className="login-shell"><div className="login-card"><span className="login-mark">P</span><h1>{checking ? "読み込み中…" : "PhraseNest"}</h1>{error && <p className="connection-error">{error}</p>}{!checking && <><button type="button" className="primary-button" onClick={startLogin}>Googleでログイン</button><details className="inline-help"><summary>初回のログイン設定</summary><small className="redirect-hint">SupabaseのRedirect URLsに登録：<code>{redirectUrl}</code></small></details></>}</div></main>;
}

function PageHeading({ title, description, extra }: { title: string; description?: string; extra?: React.ReactNode }) { return <div className="page-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{extra}</div>; }
function NavButton({ active, label, count, icon, onClick }: { active: boolean; label: string; count?: number; icon: string; onClick: () => void }) { return <button className={`nav-button ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} type="button" onClick={onClick}><span className="nav-icon" aria-hidden="true">{icon}</span><span>{label}</span>{typeof count === "number" && <small>{count}</small>}</button>; }
function AnswerButton({ kind, title, sub, onClick }: { kind: string; title: string; sub: string; onClick: () => void }) { return <button type="button" className={`answer ${kind}`} onClick={onClick}><strong>{title}</strong><small>{sub}</small></button>; }
function SummaryRow({ kind, label, value }: { kind: string; label: string; value: number }) { return <div className="summary-row"><span className={`dot ${kind}`} />{label}<strong>{value}</strong></div>; }
function Usage({ label, current, max, ratio }: { label: string; current: string; max: string; ratio: number }) { return <div className="usage"><div><span>{label}</span><strong>{current} <small>/ {max}</small></strong></div><div className="usage-bar"><span style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} /></div></div>; }

function formatDueLabel(value: string) {
  const difference = new Date(value).getTime() - Date.now();
  if (difference <= 0) return "今日";
  const days = Math.max(1, Math.ceil(difference / 86400000));
  return days === 1 ? "明日" : `${days}日後`;
}
