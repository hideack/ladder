# ladder

CLI で動く RSS/Atom フィードリーダー。[fastladder](https://github.com/fastladder/fastladder) へのオマージュ。

- ターミナル上の 3 ペイン TUI で記事を読む
- SQLite にローカル保存（`~/.config/ladder/ladder.db`）
- MCP サーバーモードで AI エージェントからも参照可能

## 必要環境

- Node.js 20 以上

## インストール

```bash
git clone https://github.com/your/ladder.git
cd ladder
npm install
npm run build          # esbuild でバンドル → bin/ladder.js 生成
```

開発時は `npx tsx bin/ladder.ts` で直接実行できます。

## 使い方

### フィードを追加する

```bash
ladder add https://example.com/feed.xml
```

### 記事を取得する

```bash
ladder fetch              # 全フィードを取得
ladder fetch --feed 3     # フィード ID 3 のみ取得
```

cron での定期実行例（30 分ごと）:

```bash
*/30 * * * * /usr/local/bin/ladder fetch >> ~/.config/ladder/fetch.log 2>&1
```

### TUI を起動する

```bash
ladder ui
```

### OPML

```bash
ladder opml import subscriptions.opml   # インポート
ladder opml export                      # stdout へエクスポート
ladder opml export out.opml             # ファイルへエクスポート
```

### カテゴリ管理

```bash
ladder category add "Tech"
ladder category add "Tech/Frontend"     # スラッシュでネスト（1 段階）
ladder category list
ladder category rename "Tech" "Technology"
```

### フィード操作

```bash
ladder feed move 3 "Tech"              # フィード ID 3 をカテゴリへ移動
ladder feed move 3 --uncategorize      # カテゴリ解除
```

### 古い記事を削除する

```bash
ladder purge              # 既読記事を 90 日以上前のものを削除（デフォルト）
ladder purge --days 30
```

## TUI キーバインド

### 全ペイン共通

| キー | 動作 |
|---|---|
| `n` / `p` | フィードカーソルを次 / 前へ |
| `j` / `k` | エントリーカーソルを次 / 前へ（自動既読） |
| `Space` | 未読記事を順に読む（スクロール → 次エントリー → 次フィード） |
| `Shift+Space` | 逆方向ページ送り |
| `o` | 選択中の記事をブラウザで開く |
| `/` | タイトル・本文を全文検索 |
| `r` | 選択フィードをリロード |
| `R` | 全フィードをリロード |
| `Tab` / `Shift+Tab` | ペインのフォーカスを切り替え |
| `?` | ヘルプを表示 |
| `q` | 終了 |

### Feeds ペイン

| キー | 動作 |
|---|---|
| `↓` / `↑` | フィード・カテゴリを移動 |
| `Enter` | フィード選択 / カテゴリ折りたたみ |
| `s` | ソート切替（未読数順 ↔ 最新記事順） |
| `H` | 未読なしフィードを非表示トグル |
| `d` | フィード購読解除（確認あり） |

### Entries ペイン

| キー | 動作 |
|---|---|
| `↓` / `↑` | 記事を移動（自動既読） |
| `P` | ピン留めトグル |
| `u` | 未読 / 既読トグル |
| `m` | フィード全件を既読にする |
| `v` | ブラウザで開く |

## MCP サーバー

Claude Desktop や Claude Code から ladder のフィード・記事を参照できます。

```bash
ladder mcp   # stdio transport で起動
```

設定例（`~/.config/claude/claude_desktop_config.json`）:

```json
{
  "mcpServers": {
    "ladder": {
      "command": "ladder",
      "args": ["mcp"]
    }
  }
}
```

利用可能なツール:

| ツール | 概要 |
|---|---|
| `list_feeds` | 購読中フィード一覧 |
| `list_entries` | 記事一覧（フィード・未読・ピン絞り込み対応） |
| `get_entry` | 記事詳細（本文を含む） |
| `search_entries` | 全文検索（SQLite FTS5） |
| `get_pinned_entries` | ピン済み記事一覧 |
| `mark_as_read` | 記事 / フィードを既読にする |
| `fetch_now` | 即時クロール |

## 技術スタック

| 項目 | 採用 |
|---|---|
| 言語 | TypeScript (Node.js 20+) |
| TUI | neo-blessed |
| DB | SQLite (better-sqlite3、WAL モード、FTS5) |
| CLI | commander |
| RSS パーサー | rss-parser |
| MCP | @modelcontextprotocol/sdk |

## ライセンス

MIT
