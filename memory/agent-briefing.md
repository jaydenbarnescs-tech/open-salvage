# @Agent（Tomodachi）ブリーフィング — 2026-04-05時点

Clawが@Agentに質問する前に、まずこのファイルを読むこと。
@Agentが何をしてきたかを把握した上で、具体的な質問をする。

## @Agentの基本情報
- 名前：Tomodachi（友達）
- Slack ID：U09DEBL98CF
- 運用者：松尾心夢（CEO）
- プラットフォーム：OpenClaw（Clawと同じ）
- モデル：primary=`gemini-3-flash-preview`（現在稼働中）
- ローカルLLM：Ollama + gemma4 (9.6GB) / gemma2:2b (1.6GB) インストール済み（未稼働、必要に応じて有効化可能）
- 特徴：バックエンドインフラ構築に強い。自分でcronジョブやスキルをセットアップしている。

## @Agentがやってきたこと（確認済み）

### 1. 開発案件管理システム（#mgc-contract-development）
- Google スプレッドシート「MGC 開発案件管理」を作成
  - URL: https://docs.google.com/spreadsheets/d/1yfCnVm5sTfcB9WeBPguNQWrByRRoPykqinblqDPIpaw/edit
- スキル定義とcronジョブで定期進捗確認を自動化
- 案件リスト：ハマノホテルズ、TCS、プラスT、コマツ、マツオカ建機、ソフィア、レンテック、日本駐車場、堺周商店、AIネイティブ商社CS
- 各案件に担当者（木村、宮内、koko、小平、バーンズ、湯田）をアサイン

### 2. Google Stitch 2.0 + Claude Code MCPワークフロー（#mgc-inventor-product）
- AIアプリのデザイン品質を上げるワークフローを構築
- Stitch 2.0でスクショ/Dribbble画像→デザインバリアント生成
- design.mdファイルが核心（Claude Codeが毎回参照）
- MCP連携でHTML/CSSを直接渡せる
- フロントエンドスライド生成スキル（frontend-slides）もインストール済み

### 3. Ollama/gemma4 インストール（#mgc-inventor-product / 2026-04-08確認）
- ローカルLLM gemma4（9.6GB）と gemma2:2b (1.6GB) をインストール済み
- 現在は稼働していない（設定で有効化可能）
- 用途案：機密情報のローカル処理、シンプルな定型タスク専用
- 懸念点：リソース消費（Mac miniのメモリ・GPU/Metal）、精度（gemini-3-flashより劣る）
- 結論：特定タスク専用のサブエージェントとして有効化する分には、コスト削減 + プライバシー保護のメリットあり

### 4. AI x EC/CS戦略（#mgc-operator-sales）
- Voice AI x カスタマーサクセス/CSのバズ情報収集
- AIネイティブ商社のCS自動化ロードマップ作成
- チャットbot一元化の提案（マルチテナントSaaS型アーキテクチャ）
- Medvi参考：AI+外部委託で競合の1/1000の人員で同等スケール達成

### 5. OpenAgentsプラットフォーム調査（#mgc-all）
- 複数AIエージェント統合管理プラットフォーム
- Claude Code、OpenClaw、Codex、Cursorなどを1つのURLで管理
- マルチエージェント協調（@メンション）機能

### 6. ボット間通信PoC（#mgc-all）
- Vanessa（Claw）と@Agentの間でSlack経由のボット間通信を成功
- allowBots=true設定で実現
- タスクハンドオフ自動化・情報共有効率化が可能に

## @Agentの活動チャンネル
| チャンネル | 内容 |
|---|---|
| #mgc-all | 全体連絡、ボット間通信 |
| #mgc-inventor-product | プロダクト開発、Stitch、gemma4 |
| #mgc-operator-sales | CS自動化、chatbot戦略 |
| #mgc-contract-development | 受託開発案件管理 |

## Clawが次にやるべきこと
1. このブリーフィングを読んだ上で、#agent-opsで@Agentに挨拶（既に知り合い）
2. 開発案件管理スプレッドシートの内容を確認し、自分が担当できる案件を把握
3. n8nワークフローとDockerコンテナを確認し、@Agentが立てたサービスを把握
4. Google Stitch + MCP連携ワークフローを理解し、受託開発で活用できないか検討
5. @Agentに「最近新しく構築したもの」を聞く（ただし上記を理解した上で）
