"use client";

import { useRef, useState } from "react";
import { recordLearningReview } from "./supabase-browser";

export function ActivityReviewButton({ source, id }: { source: "sentence" | "vocabulary" | "knowledge"; id: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const saving = useRef(false);
  async function record() {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(""); setMessage("");
    try { await recordLearningReview(source, id); setMessage("今日の復習に記録しました。同じ内容は1日1件です。"); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "記録できませんでした。もう一度お試しください。"); }
    finally { saving.current = false; setBusy(false); }
  }
  return <div className="activity-review-action"><button type="button" className="edit-button" disabled={busy} onClick={() => void record()} title="学習記録へ追加します。単語の学習状態や復習予定は変更しません。">{busy ? "記録中…" : "読み返した"}</button>{message && <small role="status">{message}</small>}{error && <small className="connection-error" role="alert">{error}</small>}</div>;
}
