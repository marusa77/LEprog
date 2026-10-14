# キーと保存データの扱い

## 公開できる情報と秘密情報

| 種類 | 扱い |
| --- | --- |
| SupabaseのProject URL・Publishable key（旧anon key） | ブラウザーで利用する公開用の情報。RLSと適切な権限設定を必ず併用します。 |
| Google翻訳・AIのAPIキー | 秘密情報。SupabaseのEdge FunctionのSecretなど、サーバー側にだけ設定します。 |
| SupabaseのSecret key・service_role key | 秘密情報。利用者別のアクセス制限を迂回できるため、ブラウザーやリポジトリへ入れません。 |
| ログイン後のアクセストークン・更新用トークン | 秘密情報。GitHub、スクリーンショット、他サービスへの質問文などへ含めません。 |

Publishable keyは、データを無制限に読めるパスワードではありません。ただし、公開用キーであることだけでは安全は保証されません。RLS（利用者ごとに読める行を制限する仕組み）と、そのルールが実環境で正しく有効になっている必要があります。[Supabase公式の説明](https://supabase.com/docs/guides/database/secure-data)

秘密キーを隠すことと、サービスの利用者・費用を制限することは別です。公開する環境では、誰がログインできるか、誰が翻訳を実行できるか、サービス側の料金上限・監視設定も確認してください。利用者ごとのアプリ内上限だけでは、サービス全体の請求上限にはなりません。

## 保存と外部送信

保存した英文・訳・メモはSupabaseへ送ります。このリポジトリのSQLでは、ログインした利用者ごとに記録へのアクセスを制限します。導入後は、別のアカウントから他人の記録が見えないことも確認してください。

Google翻訳を使うときは、翻訳対象の英文・語句などをGoogleへ送ります。API解説を有効にして呼び出したときは、対象の英文・表現などを設定したAIサービスへ送ります。

「コピー」だけでは外部AIへ送信しません。貼り付けた内容は送信先サービスに渡るため、個人情報や秘密情報が入っていないか確認してください。整理用のJSONにも学習内容が含まれます。

## リポジトリへ含めないもの

`.env.local`などの環境設定、秘密鍵、端末用の設定ファイル、学習内容の書き出しJSONは公開しないでください。`.env.example`にはダミー値だけを置きます。

`.gitignore`は未追跡ファイルの追加を防ぐための設定です。すでにコミットしたファイルや過去の履歴を消すものではありません。送信前はファイル一覧と差分を確認してください。

GitHubのコミット履歴には作者名・メールアドレスも残ります。メールを公開したくない場合は、今後のコミットにGitHubが提供する`noreply`アドレスを使う方法があります。設定の変更だけでは過去の履歴は変わりません。[GitHub公式のメール設定](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address)

## 秘密情報を公開してしまった場合

まず、そのキーやトークンを無効化・再発行します。ファイルを削除するだけでは、すでに見られたキーの悪用は止められません。[GitHub公式の対処手順](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)

必要に応じてGit履歴や公開済みのコピーも確認します。履歴の書き換えは他の開発環境へ影響するため、通常のREADME更新とは分けて対応してください。

GitHubのSecret scanningも、公開済みのキーを見つけるための確認手段です。検出対象には限りがあり、警告がないことだけで安全とは断定できません。[GitHub公式の説明](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning)
