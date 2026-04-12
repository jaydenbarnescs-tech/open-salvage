# スキル：リード登録

## 目的
商談相手の情報をSlackに貼ると、構造化してmemory/leads.jsonに保存する。

## トリガー
「このリードを登録して」+ 相手の情報

## 処理フロー
1. 入力テキストから以下を抽出する：
   - 名前
   - 会社名
   - 業種
   - 課題・ニーズ
   - 連絡先（メール / 電話 / その他）
2. memory/leads.jsonに追記する（重複チェックあり）
3. Slackに「✅ 登録完了」と要約を返す

## 出力フォーマット（Slack返信）
```
✅ リード登録完了

👤 名前：〇〇
🏢 会社：〇〇株式会社
🏭 業種：〇〇
📋 課題：〇〇
📧 連絡先：〇〇

登録日：YYYY-MM-DD
```

## データ構造（leads.json）
```json
{
  "name": "",
  "company": "",
  "industry": "",
  "challenge": "",
  "contact": "",
  "registered_at": "",
  "source": "slack"
}
```
