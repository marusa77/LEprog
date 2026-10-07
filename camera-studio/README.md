# Camera Studio

Brio 100の映像を加工してDiscordへ渡すWindows向けPythonアプリ。
既存のPhraseNestとは独立したフォルダーです。

## 起動

このフォルダーでPowerShellを開き、次を実行してください。

~~~powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
~~~

開始ボタンで撮影を始めます。カメラ番号0が別のカメラなら1などに変更してください。
カメラなしの操作確認は app.py --demo を使用できます。
Ctrl+1〜5はこのアプリが選択されているときだけ反応します。
設定はローカルのsettings.jsonに保存します。保存ボタンで明示的に保存し、失敗時は画面の設定を保持します。

## 初版の仮仕様

- デフォルト、色味補正、背景ぼかし/画像置換、指先四角形、AI顔スタンプの5モード。
- 四角形は両手の親指・人差し指の4点の凸包。範囲の固定/解除が可能。
- 顔加工はローカルAIの顔検出と眼鏡スタンプ/顔モザイク/漫画風フィルター。生成AIによる描き直しや顔の輪郭変形は未実装。
- 1モードずつ選択。効果の同時組み合わせ、Discord操作中のグローバルキーは今後の拡張。
- 表示する処理時間はアプリ内の値。Discordの受信側までの遅延ではありません。

## 開発ブランチ

feature/camera-foundation を起点に、feature/camera-studio を統合先として使います。
各機能は専用ブランチでコミットし、統合先にマージします。既存のmainへはマージしません。
