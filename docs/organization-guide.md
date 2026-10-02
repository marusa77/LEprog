# PhraseNest 定期整理ガイド

PhraseNestが書き出した `phrasenest-organization-export-v1` のJSONだけを対象に整理する。

## 目的

1. `vocabulary` の自由メモにコアイメージの説明が含まれる場合、短いコアイメージ候補を作る。
2. `sentence` から、学習価値のある熟語・句動詞・会話の定型表現を見つける。
3. すでに `saved_terms` にある語句、または `extension/common-expressions.js` と `extension/conversation-patterns.js` に登録済みの表現は候補にしない。

## トークンを増やさないための決まり

- JSONに含まれるデータ以外を読み込まない。ただし登録済み表現との機械的な照合に上記2ファイルを使ってよい。
- 1つのsourceにつき候補は最大3件。
- コアイメージは日本語160文字以内、理由は120文字以内。
- 熟語は元の英文に実際に連続して登場する2語以上のまとまりを優先する。
- 単なる自由な単語の組み合わせや固有名詞は追加しない。
- 情報が足りない場合は推測せず、候補を作らない。
- 元のメモ、訳、コアイメージは変更しない。候補だけを出力する。
- 説明文は返さず、結果JSONファイルだけを作る。

## 出力形式

```json
{
  "schema": "phrasenest-organization-result-v1",
  "export_id": "入力と同じexport_id",
  "processed_sources": [
    { "kind": "sentence", "id": "確認したsourceのid" }
  ],
  "suggestions": [
    {
      "id": "重複しない短いid",
      "type": "phrase",
      "source_id": "sourceのid",
      "sentence_id": "英文のid",
      "term": "英文中の熟語",
      "meaning": "短い日本語の意味",
      "proposed_core_image": "必要な場合のみ",
      "note": "必要な場合のみ",
      "reason": "候補にした理由",
      "confidence": "high"
    },
    {
      "id": "重複しない短いid",
      "type": "core_image",
      "source_id": "sourceのid",
      "vocabulary_id": "語句のid",
      "proposed_core_image": "整理したコアイメージ",
      "reason": "元メモのどこを整理したか",
      "confidence": "medium"
    }
  ]
}
```

`processed_sources` には、候補が見つからなかったものも含め、実際に確認した全sourceを入れる。
