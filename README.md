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

Supabase未設定時は確認用データが表示されます。

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

Redditで英文を選択し、`Ctrl + Shift + Y` を押すと翻訳小窓が開きます。Chromeの拡張機能ショートカット画面からキーを変更できます。

翻訳はGoogle Cloud Translationを優先し、月450,000文字で停止します。Google翻訳へ接続できない場合は、Chrome内蔵翻訳へ自動で切り替わります。単語・熟語候補はまとめて翻訳し、通信回数を抑えています。
