# ladder — CLAUDE.md

## プロジェクト概要

fastladder へのオマージュとして作った CLI フィードリーダー。
TypeScript + neo-blessed による TUI、SQLite でローカル保存、MCP サーバー対応。

## 開発コマンド

```bash
npx tsx bin/ladder.ts            # 開発実行
npx tsx bin/ladder.ts ui         # TUI 起動
npx tsx bin/ladder.ts --help     # コマンド一覧
npx tsc --noEmit                 # 型チェック（neo-blessed 型不足の警告は既知）
npm run build                    # esbuild でバンドル
```

## アーキテクチャ

```
bin/ladder.ts          エントリーポイント・サブコマンド振り分け
src/
  db/
    schema.ts          openDb() / initSchema() — WAL, FTS5, トリガー
    queries.ts         Queries クラス — 型付き CRUD
  crawler/
    index.ts           crawlFeed() — ETag/304 対応、タイムアウト 10 秒
  commands/
    ui.ts              TUI 起動・全キーバインド管理
    add.ts             ladder add <url>
    fetch.ts           ladder fetch
    import-urls.ts     ladder import-urls <file>  (1行1URL形式)
    category.ts        ladder category add/list/rename
    feed.ts            ladder feed move
    opml.ts            ladder opml import/export
  ui/
    layout.ts          3ペインレイアウト (25% / 35% / 40%)
    feed-list.ts       左ペイン — FeedList クラス
    entry-list.ts      中央ペイン — EntryList クラス
    entry-view.ts      右ペイン — EntryView クラス
  mcp/
    server.ts          ladder mcp — stdio transport
```

## DB

- パス: `~/.config/ladder/ladder.db`
- WAL モード、外部キー有効
- `unread_count` はトリガーで自動管理（INSERT/UPDATE 時に更新）
- FTS5 仮想テーブル `entries_fts` もトリガーで自動同期

## TUI キーバインド

### グローバル
| キー | 動作 |
|---|---|
| `Tab` | 次のペインへ |
| `Shift+Tab` | 前のペインへ |
| `r` | 選択フィードをリロード |
| `R` (= `S-r`) | 全フィードをリロード |
| `?` | ヘルプ表示 |
| `q` | 終了 |

### Feeds ペイン
| キー | 動作 |
|---|---|
| `j/k` | カーソル移動（エントリーペインも連動更新） |
| `Enter` | フィード選択・カテゴリ折りたたみ |
| `s` | ソート切替（未読数順 ↔ 最新記事順） |
| `H` (= `S-h`) | 未読なしフィードを非表示トグル |
| `d` | フィード削除 |

### Entries ペイン
| キー | 動作 |
|---|---|
| `j/k` | 記事移動（自動既読） |
| `n/p` | 次/前の未読へ |
| `P` (= `S-p`) | ピン留めトグル |
| `u` | 未読/既読トグル |
| `m` | フィード全件既読 |
| `v` | ブラウザで開く |

## 既知の問題・注意事項

### neo-blessed のキーバインド
大文字キー（Shift+英字）は `'H'` ではなく **`'S-h'`** 形式で登録する必要がある。
neo-blessed が `shift+h` を `'key S-h'` として emit するため。

```typescript
// NG
screen.key(['H'], ...)
// OK
screen.key(['S-h'], ...)
```

### 要素レベル vs スクリーンレベルのキー
`feedPane.key()` は blessed の内部フォーカス状態に依存して発火しないことがある。
フィードペイン固有のキー（`s`, `H`, `d` など）も `screen.key()` + `focus !== 'feed'` ガードで登録する。

### TypeScript 型エラー
`neo-blessed` の型定義が不完全なため `@types/neo-blessed` が存在しない。
`npx tsc --noEmit` で neo-blessed 関連の TS7016 エラーが出るのは想定内。

### unread_count
`feeds.unread_count` はトリガーで管理されるキャッシュ値。
`getAllFeedsWithLatest()` クエリで `f.*` として取得しており、実測値と一致している。

## MCP サーバー

```bash
ladder mcp   # stdio transport で起動
```

Claude Desktop / Claude Code への登録:
```json
{
  "mcpServers": {
    "ladder": { "command": "ladder", "args": ["mcp"] }
  }
}
```

公開ツール: `list_feeds`, `list_entries`, `get_entry`, `search_entries`,
`get_pinned_entries`, `mark_as_read`, `fetch_now`
