# Slack チャンネル・ユーザーID一覧

## メッセージ送信時の書式
**重要：target にはチャンネルIDをそのまま使う。`channel:` プレフィックスは不要。**
例：`target: "C09DR06AY3V"` （#mgc-all に送信）

## 参加済みチャンネル（✅）
| チャンネル名 | target（そのままコピー） |
|---|---|
| #mgc-all | `C09DR06AY3V` |
| #mgc-sales-documents | `C0AMUL34Z7B` |
| #mgc-inventor-product | `C0AQDNMCWUF` |
| #mgc-broker-sales | `C0AQNQE38DR` |
| #mgc-broker-marketing | `C0AQV6A7G6N` |
| #mgc-operator-sales | `C0AQV6AD8US` |
| #mgc-mtg-memo | `C0AQZ5ACH8U` |
| #mgc-operator-product | `C0ARPEFL7G8` |

## 要参加チャンネル（Jaydenが /invite @Claw する予定）
| チャンネル名 | ID | 用途 | 優先度 |
|---|---|---|---|
| #agent-ops | C0ANL42TVJB | @Agentとのメイン会話場所 | **最優先** |
| #mgc-alex | C0AP92X0AJ1 | Alex (Chief of Staff AI) | 高 |
| #mgc-sam | C0APCF4JY6N | Sam (Sales Agent) | 高 |
| #mgc-nina | C0AP92Z94DT | Nina (Influencer Scout) | 高 |
| #mgc-rex | C0AP92Y1KEH | Rex (Buyer Relations) | 高 |
| #mgc-mia | C0APG329E2Y | Mia (Market Research) | 中 |
| #mgc-rio | C0APAD4QQQ6 | Rio (Strategy) | 中 |
| #mgc-leo | C0AP63R4FMH | Leo (Localization) | 中 |
| #mgc-bob | C0APRCAV59P | Bob (Marketing) | 中 |
| #mgc-kai | C0ANX20TK8X | Kai (Nurturing) | 中 |
| #mgc-zoe | C0APRCAUNGH | Zoe (Analytics) | 中 |
| #mgc-trading-hq | C0APCF58W2E | 商社HQ | 中 |

## 未参加チャンネル（必要なら /invite @Claw で招待してもらう）
| チャンネル名 | ID | 用途 |
|---|---|---|
| #ソーシャル | C09DR06B7FV | ソーシャル |
| #zp-アイデア | C09SU0CDV0X | アイデア |
| #zp-メモ | C09SYB9JV2L | メモ |
| #sales-is | C0AN9F3LNHJ | 営業IS |

## ユーザー
| ユーザー | ID | 備考 |
|---|---|---|
| Jayden (バーンズ) | U0AM9DC9SJW | VPoG。英語/日本語OK |
| 松尾心夢 (CEO) | U09DR063A59 | **必ず日本語で返答** |
| Agent (@n8n) | U09DEBL98CF | 松尾のボット。**必ず日本語で返答** |
| Claude | U0AN3CTNMT4 | Claude bot |
| MGC | U0ANX7XUEQG | MGC bot |
| 日報シンクロくん | U0AMRAB835K | 日報bot |
| Superman | U0A7MKB54G3 | bot |

## 新しいチャンネルを見つける方法
未知のチャンネルにメッセージを送る必要がある場合は、jayden_exec ツールで以下を実行：
```bash
curl -s https://slack.com/api/conversations.list \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -d "types=public_channel,private_channel&limit=100" | python3 -c "import sys,json; [print(f'#{c[\"name\"]:30s} {c[\"id\"]}  member={c.get(\"is_member\",False)}') for c in json.load(sys.stdin).get('channels',[])]"
```

## 注意事項
- 参加済みチャンネルにのみメッセージ送信可能
- 未参加チャンネルに送りたい場合は、Jaydenに /invite を依頼
- DMは `target: "<ユーザーID>"` でOK（例：`target: "U0AM9DC9SJW"`）
