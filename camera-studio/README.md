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

## Discordへの出力

OBS StudioのWindows版をインストールしてください。本アプリはpyvirtualcam経由でOBSの仮想カメラへ直接書き込むため、OBSで映像を取り込む操作は不要です。OBS側の「仮想カメラを開始」は使用せず、停止した状態にしてください。

1. 初回に .\.venv\Scripts\python.exe setup_models.py を実行し、Googleの公式モデルを取得します。
2. 本アプリで「開始」を押し、プレビューで映像を確認します。
3. 「仮想カメラへ出力」にチェックを入れます。
4. Discordの音声・ビデオ設定で OBS Virtual Camera を選びます。音声入力は普段のマイクを選びます。

AI処理はPC内で実行し、外部AI APIは使いません。初回モデル取得時だけダウンロード通信を行います。
背景のblurはぼかし、imageは画像への置換、範囲のmosaic/blur/grayはモザイク/ぼかし/白黒、顔のglasses/mosaic/cartoonは眼鏡/モザイク/漫画風です。
背景画像はローカルのファイルパスだけを保存します。ファイルを移動した場合は選び直してください。
指先が未検出なら範囲加工は行いません。固定は有効な四角形が見えているときに押してください。顔未検出の箇所にも顔加工は適用されません。
加工エラー時の出力は黒い映像になります。AIの検出精度は実際の照明や姿勢で確認してください。

参考: [MediaPipe](https://developers.google.com/edge/mediapipe/solutions/guide)、[pyvirtualcam](https://github.com/letmaik/pyvirtualcam)。

## このPCでの補助設定

既存のPython 3.14.7ではTcl/Tkスクリプトが不足していたため、公式パッケージからアプリ内の.runtimeに補っています。このPCでは設定済みです。同じ起動エラーが別環境で発生する場合は python setup_ui.py を実行してください。Python 3.14のWindows x64用です。

## 検証

~~~powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -c "import runpy; runpy.run_path('tests/ui_smoke.py', run_name='__main__')"
~~~

画像処理・保存失敗・四角形外の保持・モデル初期化の自動テストと、カメラを使わない画面操作テストを用意しています。Brio実機の認識精度、Discord受信側の映像と音声同期、通話中の遅延は実機確認が必要です。
