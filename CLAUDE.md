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

### 全ペイン共通（フォーカス不問）
| キー | 動作 |
|---|---|
| `j` / `k` | フォーカス依存: Feeds ペイン→フィード移動 / それ以外→エントリー移動（自動既読） |
| `J` / `K` (= `S-j` / `S-k`) | 同上・ページ単位移動 |
| `n` | フィードカーソルを次へ |
| `p` | ピン留めトグル（LDR スタイル） |
| `Space` | 未読記事を順に読む（スクロール→次エントリー→次フィードと連鎖） |
| `b` | 逆方向ページ送り |
| `v` | 選択中の記事をブラウザで開く |
| `e` | 記事本文全文をサイトからフェッチして表示（再押しでフィードコンテンツに戻る） |
| `Tab` | Feeds ↔ Entries フォーカス切替 |
| `Shift+Tab` | Entries ↔ Feeds フォーカス切替 |
| `r` | 選択フィードをリロード |
| `R` (= `S-r`) | 全フィードをリロード |
| `?` | ヘルプ表示 |
| `q` / `C-c` | 終了 |

### 矢印キー（フォーカス依存）
| キー | Feeds ペイン | Entries ペイン | Content ペイン |
|---|---|---|---|
| `↓` / `↑` | フィードカーソル移動 | エントリーカーソル移動（自動既読） | コンテンツスクロール |

### Feeds ペイン（フォーカス時のみ）
| キー | 動作 |
|---|---|
| `Enter` | フィード選択・カテゴリ折りたたみ |
| `s` | ソート切替（未読数順 ↔ 最新記事順） |
| `H` (= `S-h`) | フィルター切替（active → unread → all） |
| `a` | カテゴリ割り当て |
| `C` (= `S-c`) | カテゴリマネージャーを開く |
| `d` | フィード削除（確認あり） |

### Entries ペイン（フォーカス時のみ）
| キー | 動作 |
|---|---|
| `Enter` | 選択記事を開く（自動既読） |
| `u` | 未読/既読トグル |
| `m` | フィード全件既読 |

## Space キーの動作フロー

```
どのペインでも:
  ├─ Content ペイン表示中
  │    ├─ 末端未達 → ページ単位でスクロール
  │    └─ 末端到達 → 次の未読エントリーへ
  │                  └─ なければ次の未読フィードの先頭未読へ
  └─ Feeds / Entries ペイン
       └─ 現フィードの先頭未読を開いて Content ペインへ
            └─ 未読なければ次の未読フィードへ
```

## FeedList の設計メモ

- `hideNoUnread = true` がデフォルト（起動時から未読なしフィードを非表示）
- `sortMode = 'latest'` がデフォルト（最新記事日時順）
- `refresh()` は `selectedIndex` を `items.length - 1` にクランプする（items 縮小時の範囲外防止）
- `n`/`j`/`k` ハンドラーは移動前に `refresh()` を呼んで最新の表示リストを使う

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
`feedPane.key()` / `entryPane.key()` は blessed の内部フォーカス状態に依存して発火しないことがある。
全ペイン共通のキー（`j`, `k`, `n`, `p`, `Space`, `o` など）は `screen.key()` で登録する。
ペイン固有のキー（`s`, `H`, `d` など）も `screen.key()` + `focus !== 'feed'` ガードで登録する。

### TypeScript 型エラー
`neo-blessed` の型定義が不完全なため `@types/neo-blessed` が存在しない。
`npx tsc --noEmit` で neo-blessed 関連の TS7016 エラーが出るのは想定内。

`getScrollPerc()` / `getScrollHeight()` など型定義にない blessed メソッドは
`as unknown as { ... }` でキャストして使う（`entry-view.ts`, `ui.ts` 参照）。

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
