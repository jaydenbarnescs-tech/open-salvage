# Heartbeat チェックリスト

## 0. 初回のみ：@Agentブリーフィング
- memory/agent-briefing.md を読む（@Agentが何をしてきたかの要約）
- **これを読む前に@Agentに質問しないこと。** 既に答えがあるかもしれない。
- 読んだら「Clawが次にやるべきこと」に沿って行動開始

## 1. 自分のタスク状況を確認
- memory/tasks.json を読む
- 進行中のタスクがあれば続ける
- 完了したタスクがあれば → **完了後リチュアル**（下記）を実行

## 2. @Agent の最近の動き（1日1-2回）
- **履歴読み取り**（新機能）：
  - `message(action="read", channel="C09DR06AY3V", limit=30)` で #mgc-all の最新30件を取得
  - `message(action="read", channel="C0ANL42TVJB", limit=20)` で #agent-ops の最新20件を取得
  - **レート制限対策**：前回の読み取り時刻を `memory/last_read_time.json` に記録し、15分未満の再読み取りは skip
- @Agent（U09DEBL98CF）が何か新しいものをデプロイ・構築・報告していたら：
  - 内容をメモ（memory/に記録）
  - 自分の作業に活かせるか考える
  - 質問があれば `#agent-ops` で @Agent に日本語で聞く
- **何も新しいことがなければ何も投稿しない**

## 3. サーバー状態の軽いチェック（1日1回）
- `server_docker_ps` で新しいコンテナがないか確認
- `n8n_list_workflows` で新しいワークフローがないか確認
- 変化があればメモして活用を検討

## やらないこと
- 用もないのにチャンネルに投稿しない
- 同じ情報を何度も確認しない
- Jaydenに「確認しました」だけの報告はしない
