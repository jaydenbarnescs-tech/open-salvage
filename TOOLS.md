# TOOLS.md — 利用可能なツールとインフラ

## MCP Proxy Server（mgc-pass-proxy.duckdns.org）
Oracle Cloud VM上で動作。以下のツールが使える：

### GitHub
- `github_read` / `github_write` — リポジトリの読み書き

### n8n ワークフロー自動化
- `n8n_list_workflows` / `n8n_get_workflow` / `n8n_create_workflow` / `n8n_update_workflow`
- `n8n_activate_workflow` / `n8n_deactivate_workflow`
- `n8n_list_executions` / `n8n_get_execution` / `n8n_list_credentials`
- `n8n_webhook_post`

### ElevenLabs 音声AI
- `elevenlabs_list_voices` / `elevenlabs_get_models` / `elevenlabs_text_to_speech`

### LINE Bot
- `line_send_message` / `line_get_profile` / `line_get_message_quota` / `line_get_followers`

### Notion
- `notion_page_read` / `notion_page_replace` / `notion_append_blocks`
- `notion_section_append` / `notion_section_patch`
- `notion_append_embed` / `notion_append_bookmark`
- `notion_cache_flush` / `notion_cache_evict` / `notion_queue_status`

### Web検索・クロール
- `serper_search` — Google検索
- `web_crawl` / `web_crawl_batch` — Webページクロール

### サーバー管理（Oracle VM）
- `server_exec` — シェルコマンド実行
- `server_read_file` / `server_write_file` / `server_list_dir`
- `server_service_status` / `server_service_restart`
- `server_docker_ps` / `server_docker_logs` / `server_docker_restart`

### Jayden's Mac ローカル
- `jayden_exec` / `jayden_read_file` / `jayden_write_file`

### Apify スクレイピング
- `apify_run_actor` / `apify_get_run` / `apify_get_dataset` / `apify_list_runs`
- `apify_instagram_profiles` / `apify_instagram_hashtag`
- `apify_tiktok_profiles` / `apify_tiktok_hashtag`
- `apify_youtube_channels` / `apify_youtube_search`
- `apify_twitter_profiles` / `apify_twitter_search`

### Google Slides
- `googleslides_create_presentation` / `googleslides_get_presentation`
- `googleslides_add_styled` / `googleslides_add_image_slide`
- `googleslides_upload_image` / `googleslides_set_theme`
- `googleslides_delete_slide` / `googleslides_batch_update`

### 画像生成（Gemini Nano Banana）
- `gemini_generate_image` — テキストプロンプトから画像生成（英語プロンプト推奨）
- 詳しい使い方は `skills/image-generation/SKILL.md` を参照
- モデル: `gemini-3.1-flash-image-preview`（デフォルト）
- プロンプトのコツ: Subject + Context + Style + Lighting + Technical anchor

### Instagram DM自動化（IGアウトリーチ）
- `ig_run_outreach` / `ig_status` / `ig_results` / `ig_command` / `ig_upload_script`

### Instagram（直接API）
- `instagram_login` / `instagram_profile` / `instagram_profiles_batch`
- `instagram_hashtag` / `instagram_hashtag_top`
- `instagram_user_search` / `instagram_keyword_search`
- `instagram_user_followers` / `instagram_user_following` / `instagram_user_medias`
- `instagram_explore` / `instagram_suggested_profiles`
- `instagram_location_search` / `instagram_location_medias` / `instagram_location_latlong`

## Claude Code CLI バックエンド（最強ツール）
`claude` CLIバックエンドを通じて、Jaydenの Mac 上の Claude Code に直接アクセスできる。
Claude Code は以下のコネクタに接続済み：

### Claude Code 経由でアクセスできるサービス
- **Notion（検索・読み書き）** — `notion-search`, `notion-fetch`, `notion-create-pages`, `notion-update-page` 等
- **Google Calendar** — `gcal_list_events`, `gcal_create_event`, `gcal_find_free_time` 等
- **Vercel** — デプロイ、プロジェクト管理、ログ確認
- **Supabase** — SQL実行、マイグレーション、Edge Functions
- **Slack（読み取り）** — チャンネル履歴、ユーザー検索
- **ビジネスエンリッチメント** — 会社・人物情報の検索・エンリッチ
- **Chrome自動化** — Webページ操作、スクリーンショット
- **画像生成** — Flux, Qwen Image（HuggingFace GPU利用時のみ）

### 使い方
Notion検索やGoogle Calendar確認など、MCP Proxyにないツールが必要な場合は **claude CLI バックエンド** を使う。
例：「claude CLI を使ってNotionで『RENPHO』を検索して」
例：「claude CLI を使って今週のカレンダーを確認して」

## インフラ
- **Oracle Cloud VM**: mgc-pass-proxy.duckdns.org (64.110.107.203)
- **Vercel**: 各プロジェクトのデプロイ先
- **Supabase**: データベース
- **n8n**: http://localhost:5678（VM上）
- **Slack**: MGCワークスペース接続済み
