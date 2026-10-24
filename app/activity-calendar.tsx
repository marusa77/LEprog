"use client";

import { useEffect, useMemo, useState } from "react";
import { loadLearningActivity } from "./supabase-browser";
import { activityDayLabel, buildActivityDays, japanDateKey, type ActivityData } from "./learning-activity";

export function ActivityCalendar({ refreshVersion = 0 }: { refreshVersion?: number }) {
  const [today, setToday] = useState(() => japanDateKey(new Date()));
  const [selected, setSelected] = useState(today);
  const [data, setData] = useState<ActivityData>({ sentences: [], reviews: [] });
  const [status, setStatus] = useState<"loading" | "refreshing" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const updateDate = () => setToday(japanDateKey(new Date()));
    const refresh = () => { if (document.visibilityState !== "hidden") { updateDate(); setRetry((value) => value + 1); } };
    const timer = window.setInterval(updateDate, 60000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); };
  }, []);

  useEffect(() => {
    let active = true;
    setStatus((current) => current === "ready" || current === "refreshing" ? "refreshing" : "loading");
    loadLearningActivity(today).then((result) => {
      if (!active) return;
      setData(result);
      setStatus("ready");
    }).catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, [today, refreshVersion, retry]);

  const days = useMemo(() => buildActivityDays(today, data.sentences, data.reviews, data.events), [today, data]);
  const selectedDay = days.find((day) => day.date === selected && !day.future) || days.find((day) => day.date === today)!;
  const activeDays = days.filter((day) => day.total > 0).length;

  return <section className="activity-calendar" aria-labelledby="activity-heading" aria-busy={status === "loading" || status === "refreshing"}>
    <div className="activity-heading"><div><h2 id="activity-heading">学習の記録</h2><p>読む日も、復習する日も。最近8週間</p></div>{(status === "ready" || status === "refreshing") && <span className="activity-days-count">英語に触れた日 <strong>{activeDays}</strong>日</span>}</div>
    {status === "error" ? <div className="activity-message" role="status">学習記録を読み込めませんでした。保存・復習はそのまま使えます。<button type="button" className="edit-button" onClick={() => setRetry((value) => value + 1)}>再読み込み</button></div> : status === "loading" ? <p className="activity-message" role="status">学習記録を読み込んでいます…</p> : <>
      {data.notice && <p className="activity-help" role="status">{data.notice}</p>}
      <div className="activity-chart">
        <div className="activity-weekdays" aria-hidden="true">{["月", "火", "水", "木", "金", "土", "日"].map((label) => <span key={label}>{label}</span>)}</div>
        <div className="activity-weeks">{Array.from({ length: 8 }, (_, week) => <div className="activity-week" key={week}><span className="activity-week-label" aria-hidden="true">{Number(days[week * 7].date.slice(5, 7))}/{Number(days[week * 7].date.slice(8))}</span>{days.slice(week * 7, week * 7 + 7).map((day) => <button key={day.date} type="button" className={`activity-cell level-${day.level}${day.future ? " future" : ""}${day.date === today ? " today" : ""}`} disabled={day.future} aria-label={activityDayLabel(day)} title={activityDayLabel(day)} aria-pressed={day.date === selectedDay.date} aria-current={day.date === today ? "date" : undefined} onClick={() => setSelected(day.date)} />)}</div>)}</div>
      </div>
      <div className="activity-footer"><span>日本時間・日付を押すと内訳を表示</span><div className="activity-legend" aria-label="色の濃さ：0件、1件、2〜4件、5〜9件、10件以上"><span>少</span>{[0, 1, 2, 3, 4].map((level) => <i key={level} className={`activity-cell level-${level}`} aria-hidden="true" />)}<span>多</span></div></div>
      <div className="activity-detail" aria-live="polite"><time dateTime={selectedDay.date}>{selectedDay.date === today ? "今日" : `${Number(selectedDay.date.slice(5, 7))}月${Number(selectedDay.date.slice(8))}日`}</time><span>保存・追記 <strong>{selectedDay.saves}</strong>件</span><span>復習 <strong>{selectedDay.reviews}</strong>件</span><span>調べもの <strong>{selectedDay.lookups}</strong>件</span><small>復習の内訳：英文 {selectedDay.sentenceReviews}件・語句 {selectedDay.wordReviews}件・ノート {selectedDay.noteReviews}件</small>{selectedDay.total === 0 && <small>少し英語に触れるだけでも、一歩になります。</small>}</div>
    </>}
    <details className="activity-help"><summary>何が記録される？</summary><p>英文・語句・知識ノートの保存、意味・コアイメージ・メモの追記や修正、英作文の保存・添削の追記を数えます。復習は単語の回答（「忘れた」も含む）、英文の「読み直した」、メモやノートの「読み返した」が対象です。同じ対象の同じ行動は日本時間で1日1件。保存と復習は別に数えます。翻訳で調べた日は「調べもの」を1日1件追加し、候補語の自動翻訳では水増ししません。画面移動だけ、スキップ、目印・出やすさの変更、コピーだけは対象外です。過去の保存・復習は残っている履歴から復元し、履歴のない過去の編集・読み返し・翻訳は推測しません。色の濃さは英語力の点数ではなく、英語に触れた記録です。</p></details>
  </section>;
}
