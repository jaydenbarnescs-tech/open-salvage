# Notion ページID一覧

Notionツール（`mgc-proxy__notion_page_read` 等）を使うときはこのページIDを使う。

## Master Backlogs（毎週月曜確認）
| ページ | ID |
|---|---|
| 🏪 Pillar 1 — 商社モデル / AI SaaS | `336460af-17d7-8133-8948-f271e71026c6` |
| 🔧 Pillar 2 — 受託開発 | `336460af-17d7-815c-b124-c655f2059617` |
| 🤖 Pillar 3 — 社内AI / インフラ | `336460af-17d7-8137-94b7-ee7155b1fa80` |

## 会社情報
| ページ | ID |
|---|---|
| About MGC | `330460af-17d7-8189-9cd4-e01baee12752` |
| MGC とは | `32e460af-17d7-8014-bb15-cde9ffbb733d` |
| MGC Kickoff | `322460af-17d7-8026-adac-d3f54e2b1676` |
| MGC Agent Ecosystem コンセプト設計書 | `32f460af-17d7-8170-876d-e80e368806a0` |

## クライアント・プロジェクト
| ページ | ID |
|---|---|
| RENPHO x MGC — AIインフルエンサー戦略 | `32e460af-17d7-8116-9ab0-daa9956d827f` |
| インフルエンサー精度企画書 | `333460af-17d7-8197-9f4c-c0b80110c13f` |
| Strategy — MGC Creator Outreach | `338460af-17d7-815b-9d56-ef3a933b3a47` |

## 使い方
```
# ページを読む
mgc-proxy__notion_page_read(id: "336460af-17d7-8133-8948-f271e71026c6")

# ページに追記
mgc-proxy__notion_append_blocks(page_id: "...", content: "...")

# セクションを編集
mgc-proxy__notion_section_patch(page_id: "...", heading: "...", content: "...")
```
