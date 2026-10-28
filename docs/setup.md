# 導入・設定ガイド

PhraseNestは、PC版Chromeの拡張機能、復習用のWeb画面、Supabaseの保存先を組み合わせて使います。自分のSupabaseプロジェクトとWeb画面の実行・公開環境を用意してください。

## 1. Supabaseを準備する

新しいSupabaseプロジェクトを作成し、SQL Editorで次のファイルを番号順に実行します。

| SQL | 追加される仕組み |
| --- | --- |
| [0001](../supabase/migrations/0001_initial_schema.sql) | 基本の保存データ、利用者別アクセス制限、語句の復習・利用量管理 |
| [0002](../supabase/migrations/0002_core_image_notes.sql) | コアイメージの保存 |
| [0003](../supabase/migrations/0003_organization_workflow.sql) | 未整理管理・整理候補の反映 |
| [0004](../supabase/migrations/0004_append_vocabulary_details.sql) | 語句の説明の追記 |
| [0005](../supabase/migrations/0005_sentence_study.sql) | 英文の出やすさ・復習履歴 |
| [0006](../supabase/migrations/0006_knowledge_notes.sql) | 英文とは独立した知識ノート・あとで確認する目印 |
| [0007](../supabase/migrations/0007_learning_activity.sql) | 保存・追記・英文／語句／ノートの復習・翻訳の学習記録 |
| [0008](../supabase/migrations/0008_private_app_access.sql) | 許可アカウントだけにデータ操作と翻訳・AIの利用を制限 |

既存のプロジェクトでは、未実行の追加SQLだけを実行してください。0001は新規作成用なので、既存テーブルに実行し直さないでください。コードの更新だけではSupabaseのSQLは実行されません。

SupabaseのAuthenticationでGoogleログインを有効にし、Google側の認証設定も行います。URL ConfigurationのRedirect URLsには、ログイン後に戻るWeb画面と拡張機能のURLを許可します。

0008は初回Googleログインで自分のユーザーを作った後に実行します。Authenticationのユーザーが1人なら、そのユーザーを許可します。複数いる場合はSQL内の`v_owner_id uuid := null`を自分のUser UIDに置き換えてください。ユーザーを特定できない場合は全体を取り消し、既存データや権限を変更しません。再実行で未許可ユーザーが自動追加されることはありません。

許可一覧は`phrasenest_private.allowed_users`にあり、通常の利用者から変更できません。追加・解除は管理者がSQL Editorで行います。新規ログイン画面を出せることと、アプリのデータ・翻訳を使えることは別です。

## 2. Web画面を動かす

Node.js 22.13以降を用意し、このリポジトリのフォルダーで実行します。

```powershell
npm install
npm run dev
```

表示されたローカルURLを開き、初回接続画面にSupabaseのProject URLとPublishable keyを入力します。Googleログイン前に、このローカルURLもSupabaseのRedirect URLsへ追加してください。

接続情報は初回画面の代わりに、[.env.example](../.env.example)を参考に`.env.local`へ設定することもできます。入力するのは次の公開用の2項目だけです。

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

`.env.local`はGitHubへ送らない設定です。Google翻訳・AIの秘密キーを`NEXT_PUBLIC_`で始まる項目へ設定しないでください。

スマホから利用する場合は、Web画面をHTTPSで公開し、その公開URLをSupabaseのRedirect URLsに追加します。公開の手順は利用するホスティング環境に従ってください。同じSupabaseとGoogleアカウントを使うことで、PC・スマホから同じ記録を確認できます。

公開先の実行時設定に`PHRASE_NEST_SUPABASE_URL`と`PHRASE_NEST_SUPABASE_PUBLISHABLE_KEY`を登録すると、Web画面が接続先を自動設定します。別PCでの貼り付けは不要です。この方式では0008による許可確認が必須です。`/api/public-config`は公開用の2項目と確認フラグだけを返し、翻訳用キーやログイン情報は返しません。既存の端末が別のSupabaseを使っている場合は、勝手に切り替えません。

## 3. 翻訳サービスを設定する

翻訳を使う場合はGoogle Cloud Translationを有効にし、SupabaseのEdge FunctionのSecretに`GOOGLE_TRANSLATE_API_KEY`を設定して、`translate`をデプロイします。

API経由のAI解説を使う場合だけ、サーバー側の`OPENAI_API_KEY`、利用可能なモデル、`explain`のデプロイを設定します。手動で英文・訳を保存するだけなら、翻訳APIは必要ありません。

Secretの実値は、GitHub・Web画面・Chrome拡張機能に入れないでください。詳しくは[キーと保存データの扱い](security.md)を参照してください。

## 4. Chrome拡張機能を読み込む

1. このリポジトリをダウンロードまたは取得します。
2. Chromeの`chrome://extensions`を開き、デベロッパーモードをオンにします。
3. 「パッケージ化されていない拡張機能を読み込む」で`extension`フォルダーを選びます。
4. 設定画面に、Web画面と同じSupabaseのProject URLとPublishable keyを入力します。
5. 設定画面に表示される拡張機能用Redirect URLをSupabaseで許可し、Googleでログインします。

設定画面の「接続設定（開発者向け）」で、自分の復習ページのURLも指定します。リポジトリの拡張機能には個人の接続先を含めていません。

### 別PCでも使う設定済みパッケージ

一度だけ`.env.local`に自分の公開用接続情報2項目と`PHRASE_NEST_REVIEW_URL`を設定し、次を実行します。

```powershell
npm run extension:package
```

`outputs/phrasenest-extension.zip`を解凍して読み込むと、Googleログインだけで接続できます。`outputs/extension-setup.txt`にある戻り先URLをSupabaseで一度だけ許可してください。同じZIPを別PCでも使うとIDが固定され、PCごとの戻り先追加が不要になります。設定済みパッケージは0008による許可確認を必須にします。

`.phrase-nest/extension-identity.json`に公開の拡張機能ID用キーを保持します。再作成時はこのファイルを残してください。署名用秘密鍵は保存せず、翻訳用キー・管理用キー・ログイントークンもZIPへ含めません。設定ファイルと`outputs`はGit管理対象外です。配布するZIPには接続先とPublishable keyが入るため、接続先を秘密にする目的には使えません。

Chromeウェブストアには未公開です。ソースの`extension`をそのまま読み込む場合は従来の手動設定が必要です。最初に設定済み版へ移る際はIDが変わり、再ログインが必要になることがあります。通常は端末ごとにログインを保持しますが、期限切れなどで再ログインが必要です。

## 更新と動作確認

- Web画面の更新と拡張機能の更新は別です。拡張機能を更新したら、`chrome://extensions`で再読み込みし、利用中のページも再読み込みしてください。
- SQLが未実行の場合は、追記や英文の復習記録に準備の案内が表示されます。従来の一覧・最新順・ランダム・編集は引き続き使えます。
- Googleログイン、保存、別端末からの閲覧、利用者ごとのアクセス制限を、実際の環境で確認してください。

```powershell
npm test
```

ビルドと自動テストを実行します。外部サービスへの接続やSQLの適用状態は別途確認してください。
