# PhraseNest

Redditで選択した英文をその場で翻訳し、英文・訳・単語・熟語をSupabaseへ保存して復習する個人向け英語学習アプリです。

## 構成

- `app/`: PC・スマホ対応の復習ページ
- `extension/`: Redditで動くChrome拡張機能
- `supabase/migrations/`: 保存データ、重複判定、復習処理
- `supabase/functions/`: クラウド翻訳と任意のAI解説

## ローカルで復習ページを確認

```powershell
npm install
npm run dev
```

Supabase未設定時は初回接続画面が表示されます。

初回は画面上でProject URLとPublishable keyを入力できます。Googleログイン前に、画面に表示されるローカルURL（例：`http://localhost:3000/`）をSupabaseのAuthentication > URL Configuration > Redirect URLsへ追加してください。

## Supabaseを接続

1. Supabaseで新しいプロジェクトを作成します。
2. SQL Editorで `supabase/migrations/0001_initial_schema.sql` を実行します。
3. Authentication > ProvidersでGoogleを有効にします。
4. `.env.example` を `.env.local` としてコピーし、Project URLとPublishable keyを設定します。
5. Google Cloud Translationを有効にし、Edge FunctionのSecretに `GOOGLE_TRANSLATE_API_KEY` を設定します。
6. AI解説を使う場合だけ `OPENAI_API_KEY` を設定します。
7. `translate` と `explain` のEdge Functionをデプロイします。

秘密鍵やOpenAI APIキーを `.env.local` やChrome拡張機能へ入れないでください。

## Chrome拡張機能を追加

1. Chromeで `chrome://extensions` を開きます。
2. デベロッパーモードをオンにします。
3. 「パッケージ化されていない拡張機能を読み込む」から `extension` フォルダーを選びます。
4. 自動で開く設定画面にSupabaseのProject URLとPublishable keyを入力します。
5. 表示された拡張機能用リダイレクトURLを、Supabaseの許可済みRedirect URLへ追加します。
6. Googleで一度ログインします。

別のPCでも同じ手順で利用できます。現在はChromeウェブストア未公開のため、GitHubからプロジェクトをダウンロードし、その中の `extension` フォルダーを読み込んでください。パッケージ化されていない拡張機能のIDはPCごとに変わる場合があるため、新しいPCの設定画面に表示されたリダイレクトURLもSupabaseへ追加します。Project URLとPublishable keyは元のPCと同じものを使い、同じGoogleアカウントでログインします。

Redditで英文を選択し、`Ctrl + Shift + Y` を押すと翻訳小窓が開きます。Chromeの拡張機能ショートカット画面からキーを変更できます。

英文を選択していない場合も、`Ctrl + Shift + Y` でメニューを開けます。Chrome右上のPhraseNestアイコンからは、Reddit以外のページでも保存した英文・単語帳・学習メモ・復習へ直接移動できます。

翻訳小窓の「ワイド」で英文と訳を左右に並べられます。幅のモード・文字サイズ・小窓の位置は、このPCのChromeに記憶します。復習ページには保存内容全体の検索と文字サイズ切り替え、単語帳にはメモあり・登場回数の絞り込みと並び替えがあります。

小窓の四隅をドラッグすると、幅と高さを調整できます。通常の最小サイズは400×400pxで、小さな画面では画面内に収まる大きさを優先します。幅が狭いときは縦並びにし、内容は小窓内でスクロールできます。「サイズをリセット」で標準幅・自動の高さ・右上の位置に戻します（訳・メモ・文字サイズは変えません）。サイズもこのPCのChromeに記憶します。角の操作部分をTabキーで選び、矢印キーで10pxずつ、Shift＋矢印キーで40pxずつ調整することもできます。

訳やメモは自動保存ではありません。小窓には「未保存」「保存済み」「保存後の変更あり」を表示します。変更せずに同じ保存ボタンを連続で押すことは防いでいますが、保存後に編集して小窓から再保存すると、従来どおり別の英文記録が追加されます。既存の記録を修正する場合は、上部の「保存内容」からその記録の「編集」を使ってください。

改修後は `chrome://extensions` のPhraseNestで再読み込みボタンを押し、Redditのページも再読み込みしてください。

## 自分で英文と訳を入力して保存

復習ページやChromeのPhraseNestメニューの「入力して保存」を開きます。PC・スマホで使えます。英文と日本語訳を自分で入力・貼り付けすれば、翻訳を使わずに保存できます。使う場面のメモ、入手元、任意の参照URLも残せます。

「英語を日本語に翻訳」「日本語を英語に翻訳」を押したときだけ、Google翻訳を使います。既存の月450,000文字の上限と共通で、保存ボタンでは翻訳もAIも呼びません。上限到達・翻訳エラー時も、自分で訳を入力して保存できます。

単語・熟語の意味は手入力です。「語句を追加」で必要なものだけ登録できます。英文全体を1つのフレーズとして追加しても構いません。語句の重複判定・登場回数・復習は従来の仕組みを使い、既存の意味やメモを上書きしません。既存データを使うため、追加のSQL実行は不要です。

入力は画面を切り替えても保持しますが、自動保存ではなく、ページの再読み込みをまたぐ下書き保存はしません。保存後は連続登録を防ぎ、「続けて新しく入力」から次の記録を追加します。保存済みの内容は英文一覧・単語帳の「編集」で修正します。

翻訳はGoogle Cloud Translationを優先し、月450,000文字で停止します。Google翻訳へ接続できない場合は、Chrome内蔵翻訳へ自動で切り替わります。単語・熟語候補はまとめて翻訳し、通信回数を抑えています。よく使われる句動詞・熟語・会話表現は拡張機能内の一覧と照合し、`figure out`、`figured out` のような活用形も候補にします。
