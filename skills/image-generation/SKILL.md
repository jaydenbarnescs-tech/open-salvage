# スキル：画像生成（Nano Banana via MCP Proxy）

## 目的
MGC ProxyサーバーのGemini画像生成ツールを使って、AIで画像を作成する。

## トリガー
- 「画像を作って」「写真を生成して」「イラストを描いて」
- 「image」「generate」「picture」「photo」
- 何かのビジュアルアセットが必要な場面

## 使用ツール
MCPプロキシ経由で `gemini_generate_image` を呼ぶ。

### gemini_generate_image
テキストプロンプトから画像を生成する。

**パラメータ：**
| パラメータ | 型 | 必須 | 説明 |
|-----------|------|------|------|
| `prompt` | string | Yes | 画像の説明（英語推奨） |

**戻り値：** 画像データ + ファイルパス

## プロンプト構築ルール（重要）

### 5要素フォーマット
良いプロンプトには以下の5要素を含める：

1. **Subject（主題）** — 何を描くか
2. **Context（文脈）** — どこで、どんな状況か
3. **Style（スタイル）** — 写真風、イラスト風、水彩風など
4. **Lighting（照明）** — 自然光、スタジオ照明、ゴールデンアワーなど
5. **Technical anchor（技術的権威）** — カメラ名やレンズ名で品質を暗示する

### 例
```
A Japanese ceramic tea cup on a weathered wooden table,
soft morning light filtering through shoji screens,
documentary photography style,
shot on Hasselblad X2D with 80mm f/1.9 lens
```

### 禁止ワード（絶対に使わない）
これらのキーワードはGeminiの出力品質を劣化させる：
- ❌ "8K", "ultra-realistic", "masterpiece", "high resolution"
- ❌ "best quality", "hyper-detailed", "photorealistic"

代わりに「prestigious context anchors」を使う：
- ✅ "shot on Hasselblad", "Vogue editorial", "National Geographic"
- ✅ "Michelin-starred plating", "Apple product launch"

### ドメイン別テンプレート

**商品撮影：**
```
[商品] centered on [表面], [背景], commercial product photography,
softbox lighting with subtle rim light, shot on Phase One IQ4 150MP
```

**食べ物：**
```
[料理] on [器], [周りの小物], Michelin-starred restaurant presentation,
dramatic side lighting, shot on Canon R5 with 100mm macro
```

**ポートレート風：**
```
[人物の説明], [場所・シーン], editorial portrait style,
[照明の種類], shot on Sony A1 with 85mm f/1.4 GM
```

## モデル情報
- **デフォルト：** `gemini-3.1-flash-image-preview`（Nano Banana 2）
- **予備：** `gemini-2.5-flash-image`（旧モデル、無料枠）
- **使用禁止：** `gemini-3-pro-image-preview`（2026年3月9日にシャットダウン済み）

## 制約事項
- 1回のAPI呼び出しで生成できるのは **1枚だけ**
- ネガティブプロンプトのパラメータは存在しない。プロンプト内で言い換える
- `imageSize` は大文字必須："1K", "2K", "4K"（小文字だと無視される）
- レート制限：無料枠は約5-15 RPM

## 処理フロー
1. ユーザーのリクエストを受け取る
2. 日本語の場合は英語のプロンプトに変換する
3. 5要素フォーマットでプロンプトを構築する
4. `gemini_generate_image` を呼ぶ
5. 結果をSlackに返す（ファイルパスまたは画像）

## エラー対応
| エラー | 原因 | 対処 |
|--------|------|------|
| HTTP 429 | レート制限 | 少し待ってリトライ |
| IMAGE_SAFETY | コンテンツポリシー違反 | プロンプトを安全に言い換えて1回だけリトライ |
| 空のレスポンス | responseModalities設定ミス | "IMAGE" が含まれているか確認 |
