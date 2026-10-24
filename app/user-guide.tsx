"use client";

import type { Tab } from "./navigation";

export function UserGuideView({ onSelect }: { onSelect: (tab: Tab) => void }) {
  return <article className="user-guide" aria-labelledby="guide-heading">
    <div className="page-heading"><h1 id="guide-heading">使い方</h1></div>
    <ol className="guide-start">
      <li><h2>英文を見つける</h2><p>Chromeで英文を選択し、<kbd>Ctrl + Shift + Y</kbd>。翻訳と保存の小窓が開きます。Reddit以外の通常のWebページでも使えます。</p><p>自分で書く場合は「入力して保存」へ。英文と日本語訳を入力するか、翻訳ボタンを使います。</p><button className="plain-action" type="button" onClick={() => onSelect("capture")}>入力して保存へ</button></li>
      <li><h2>覚えたい内容を残す</h2><p>訳を直し、保存したい語句にチェックして「英文と語句を保存」。コアイメージや自分用のメモも残せます。</p><p>文法や表現の比較は「入力して保存 → 知識ノート」へ。例文なしで書けます。</p></li>
      <li><h2>読み返して復習する</h2><p>「今日の復習」で語句の意味を思い出し、答えを見て回答します。英文は「保存内容 → 英文」から。ランダムに並べたり、5・10・20件ずつ復習できます。</p><p>メモやノートは「保存内容 → 学習メモ」で確認できます。</p><div className="guide-actions"><button className="plain-action" type="button" onClick={() => onSelect("today")}>今日の復習へ</button><button className="plain-action" type="button" onClick={() => onSelect("sentences")}>保存した英文へ</button></div></li>
    </ol>
    <section className="guide-details" aria-labelledby="guide-details-heading"><h2 id="guide-details-heading">詳しく知りたいとき</h2>
      <details><summary>小窓で語句を追加・コピーする</summary><p>小窓の英文で単語をダブルクリック、熟語をドラッグして「選択した語句を追加」。入力欄から手動でも追加できます。</p><p>「英文をコピー」は英文だけ、「質問文をコピー」は意味やコアイメージを質問する文もコピーします。ChatGPTなどへ自分で貼り付けて使います。</p><p>角をドラッグすると小窓のサイズを変更できます。メニューの「サイズをリセット」で元に戻せます。</p></details>
      <details><summary>保存・追記・編集の違い</summary><p>保存ボタンで確定します。自動保存ではありません。小窓で保存後に変更して再保存すると、別の英文記録になります。保存済みの英文を直すときは、一覧の「編集」を使ってください。</p><p>登録済みの語句は重複させず、登場回数を増やします。「追記」は元の説明の下に区切って追加し、「編集」は既存の説明を書き換えます。</p><p>「入力して保存」では、保存に成功すると入力欄が空になります。失敗した場合は入力が残るので、再試行できます。</p></details>
      <details><summary>復習の順番と記録</summary><p>語句は回答に応じて次の復習を予定します。「忘れた」は明日、「あいまい」は3日後、「覚えていた」は7日後です。</p><p>英文の「復習シャッフル」は、読み返していないものや「多め」にしたものを優先します。「少なめ」も時々出ます。「読み直した」を押すたびに記録するので、最後まで終える必要はありません。スキップは記録しません。</p><p>英文の復習やノートの「読み返した」では、語句の学習状態・復習予定は変わりません。</p></details>
      <details><summary>学習カレンダーに含まれること</summary><p>英文・語句・ノート・英作文の保存や追記、語句の回答、英文の「読み直した」、メモやノートの「読み返した」を記録します。同じ対象の同じ行動は日本時間で1日1件。保存と復習は別々に数えます。</p><p>翻訳で調べた日は「調べもの」を1日1件記録します。画面を開くだけ、コピー、スキップ、目印の変更は含みません。過去の記録は日時が残っている分だけ反映します。</p></details>
      <details><summary>翻訳と外部AIの使い分け</summary><p>通常はGoogle翻訳を使い、アプリでは月450,000文字で停止します。拡張機能では利用できる場合にChromeの端末内翻訳へ切り替えられます。手入力の訳でも保存できます。</p><p>英作文では、表現を1〜3個選び、お題に沿って自分の英文を書きます。「作文と指示文をコピー」で外部AIへ貼り付け、返ってきた添削をアプリへ戻して保存します。お題作成用の指示文もコピーできます。</p><p>コピーするだけではAIへ送信されません。貼り付け先のサービスの利用条件が適用されます。AIの回答は間違うこともあるため、内容を確認して保存してください。</p><button className="plain-action" type="button" onClick={() => onSelect("writing")}>英作文の練習へ</button></details>
      <details><summary>メモ・熟語をまとめて整理する</summary><p>「メニュー → Codex整理」で未整理分を書き出し、JSONファイルと依頼文をCodexへ渡します。返ってきた整理結果JSONを読み込み、候補ごとに採用するか選んで完了します。書き出した元のJSONは結果として読み込めません。</p><p>書き出しだけでは元のメモは変更されません。長い文章は省略し、必要な分だけ送ります。トークンの目安は確定した消費量ではありません。</p><button className="plain-action" type="button" onClick={() => onSelect("organize")}>Codex整理へ</button></details>
      <details><summary>スマホで見る・小窓を開けないとき</summary><p>スマホは公開ページから同じGoogleアカウントでログインすると、保存内容を見て復習できます。ホーム画面やブックマークに追加しておくと便利です。</p><p>Chromeの設定ページなど、拡張機能を使えないページでは小窓を開けません。通常のWebページを開くか、「入力して保存」を使ってください。ショートカットはChromeの拡張機能の設定で変更できます。</p></details>
    </section>
  </article>;
}
