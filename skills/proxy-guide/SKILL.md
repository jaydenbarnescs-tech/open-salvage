# スキル：MCP Proxy ガイド

## 目的
mgc-pass-proxy（Oracle Cloud VM上）を通じてアクセスできる全ツールの使い方ガイド。
ツールの使い方がわからないとき、このスキルを参照する。

## プロキシ情報
- **URL:** `https://mgc-pass-proxy.duckdns.org`
- **IP:** `64.110.107.203`（/etc/hostsで名前解決）
- **MCP接続:** `mcp-remote` 経由で `https://mgc-pass-proxy.duckdns.org/mcp`

---

## ツール一覧と使い方

### 1. GitHub（github_read / github_write）
リポジトリの読み書き。

```
github_read: owner, repo, path, branch（オプション）
github_write: owner, repo, path, content, message, branch
```

**よくある使い方：**
- コードの確認：`github_read` で owner="AgriciDaniel", repo="xxx", path="src/index.ts"
- ファイル更新：`github_write` でcontent（Base64不要、そのままテキスト）

### 2. n8n ワークフロー自動化
VMのポート5678で動作。

| ツール | 用途 |
|--------|------|
| `n8n_list_workflows` | 全ワークフロー一覧 |
| `n8n_get_workflow` | ID指定で詳細取得 |
| `n8n_create_workflow` | 新規作成（JSON形式） |
| `n8n_update_workflow` | 既存ワークフロー更新 |
| `n8n_activate_workflow` | 有効化 |
| `n8n_deactivate_workflow` | 無効化 |
| `n8n_list_executions` | 実行履歴 |
| `n8n_get_execution` | 実行詳細 |
| `n8n_list_credentials` | 保存済み認証情報 |
| `n8n_webhook_post` | Webhook発火 |

### 3. ElevenLabs 音声AI
テキストから音声を生成。

| ツール | 用途 |
|--------|------|
| `elevenlabs_list_voices` | 利用可能な音声一覧 |
| `elevenlabs_get_models` | 利用可能なモデル一覧 |
| `elevenlabs_text_to_speech` | テキスト→音声生成 |

### 4. LINE Bot
LINE公式アカウントからメッセージ送信。

| ツール | 用途 |
|--------|------|
| `line_send_message` | メッセージ送信（userId必要） |
| `line_get_profile` | ユーザープロフィール取得 |
| `line_get_message_quota` | 残りメッセージ数 |
| `line_get_followers` | フォロワー一覧 |

### 5. Notion（Proxyバージョン）
ページの読み書き、ブロック追加。

| ツール | 用途 |
|--------|------|
| `notion_page_read` | ページ内容読み取り（pageId必要） |
| `notion_page_replace` | ページ全体を置換 |
| `notion_append_blocks` | ブロック追記 |
| `notion_section_append` | セクション末尾に追記 |
| `notion_section_patch` | セクション内容を更新 |
| `notion_append_embed` | 埋め込みコンテンツ追加 |
| `notion_append_bookmark` | ブックマーク追加 |
| `notion_cache_flush` | キャッシュクリア |
| `notion_cache_evict` | 特定キャッシュ削除 |
| `notion_queue_status` | 処理キュー状態確認 |

### 6. Web検索・クロール

| ツール | 用途 |
|--------|------|
| `serper_search` | Google検索（query必要） |
| `web_crawl` | Webページ取得（url必要） |
| `web_crawl_batch` | 複数URL一括クロール |

### 7. サーバー管理（Oracle VM直接操作）

| ツール | 用途 |
|--------|------|
| `server_exec` | シェルコマンド実行 |
| `server_read_file` | ファイル読み取り |
| `server_write_file` | ファイル書き込み |
| `server_list_dir` | ディレクトリ一覧 |
| `server_service_status` | systemdサービス状態確認 |
| `server_service_restart` | サービス再起動 |
| `server_docker_ps` | Dockerコンテナ一覧 |
| `server_docker_logs` | Dockerログ取得 |
| `server_docker_restart` | Dockerコンテナ再起動 |

### 8. Jayden's Mac ローカル操作

| ツール | 用途 |
|--------|------|
| `jayden_exec` | Mac上でコマンド実行 |
| `jayden_read_file` | Macのファイル読み取り |
| `jayden_write_file` | Macにファイル書き込み |

### 9. Apify スクレイピング

| ツール | 用途 |
|--------|------|
| `apify_run_actor` | Actor実行 |
| `apify_get_run` | 実行状態確認 |
| `apify_get_dataset` | データセット取得 |
| `apify_list_runs` | 実行履歴 |
| `apify_instagram_profiles` | Instagramプロフィール取得 |
| `apify_instagram_hashtag` | ハッシュタグ投稿取得 |
| `apify_tiktok_profiles` | TikTokプロフィール |
| `apify_tiktok_hashtag` | TikTokハッシュタグ |
| `apify_youtube_channels` | YouTubeチャンネル |
| `apify_youtube_search` | YouTube検索 |
| `apify_twitter_profiles` | Twitterプロフィール |
| `apify_twitter_search` | Twitter検索 |

### 10. Google Slides

| ツール | 用途 |
|--------|------|
| `googleslides_create_presentation` | 新規プレゼン作成 |
| `googleslides_get_presentation` | 既存プレゼン取得 |
| `googleslides_add_styled` | スタイル付きスライド追加 |
| `googleslides_add_image_slide` | 画像スライド追加 |
| `googleslides_upload_image` | 画像アップロード |
| `googleslides_set_theme` | テーマ設定 |
| `googleslides_delete_slide` | スライド削除 |
| `googleslides_batch_update` | バッチ更新 |

### 11. Instagram（直接API）

| ツール | 用途 |
|--------|------|
| `instagram_login` | ログイン |
| `instagram_profile` | プロフィール取得 |
| `instagram_profiles_batch` | 複数プロフィール一括取得 |
| `instagram_hashtag` / `instagram_hashtag_top` | ハッシュタグ検索 |
| `instagram_user_search` / `instagram_keyword_search` | ユーザー検索 |
| `instagram_user_followers` / `instagram_user_following` | フォロー関係 |
| `instagram_user_medias` | ユーザーの投稿一覧 |
| `instagram_explore` | Explore取得 |
| `instagram_suggested_profiles` | おすすめプロフィール |
| `instagram_location_search` / `instagram_location_medias` | 場所検索 |

### 12. 画像生成（Gemini Nano Banana）

| ツール | 用途 |
|--------|------|
| `gemini_generate_image` | テキスト→画像生成 |

**詳細は `skills/image-generation/SKILL.md` を参照。**

---

## Instagram DM自動化（IGアウトリーチ）

| ツール | 用途 |
|--------|------|
| `ig_run_outreach` | DM一括送信実行 |
| `ig_status` | 実行状態確認 |
| `ig_results` | 結果取得 |
| `ig_command` | コマンド送信 |
| `ig_upload_script` | スクリプトアップロード |

---

## トラブルシューティング

### プロキシが応答しない場合
1. `server_service_status` で `github-proxy` サービスを確認
2. ダメなら `server_service_restart` で再起動
3. OAuth tokenの期限切れの可能性 → `/home/ubuntu/.claude/.credentials.json` を確認

### レート制限
- Claudeモデル：Haiku → Sonnetの順で試す
- Gemini画像生成：無料枠は約5-15 RPM
- 429エラーが出たら少し待ってリトライ

### ホスト解決
Jaydenのネットワークでは DuckDNS が解決しないため、`/etc/hosts` に手動エントリあり：
```
64.110.107.203 mgc-pass-proxy.duckdns.org
```
