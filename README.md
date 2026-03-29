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

### Podcast エピソードをダウンロードする

```bash
ladder podcast download --days 7       # 直近 7 日分をダウンロード
ladder podcast download --count 10     # 最新 10 話をダウンロード
ladder podcast download --feed 3       # フィード ID 3 のみ
ladder podcast download --feed 3 --days 30 --dir ~/Downloads/podcasts
```

保存先のデフォルトは `~/.config/ladder/podcasts/`。既にダウンロード済みのファイルはスキップされます（冪等）。

TUI から個別にダウンロードするには、エントリーを選択して `Shift+D` を押します。`enclosure_url` が未取得の場合はフィードを自動再フェッチしてからダウンロードします。

### 古い記事を削除する

```bash
ladder purge              # 既読記事を 90 日以上前のものを削除（デフォルト）
ladder purge --days 30
```

## TUI キーバインド

### 全ペイン共通

| キー | 動作 |
|---|---|
| `j` / `k` | フォーカス依存: Feeds ペイン→フィード移動 / それ以外→エントリー移動（自動既読） |
| `J` / `K` | 同上・ページ単位移動 |
| `n` | フィードカーソルを次へ（どのペインからでも） |
| `p` | ピン留めトグル |
| `Space` | 未読記事を順に読む（スクロール → 次エントリー → 次フィード） |
| `b` | 逆方向ページ送り |
| `v` | 選択中の記事をブラウザで開く |
| `e` | 記事全文をサイトからフェッチして表示（再押しで元に戻す） |
| `E` | AI 要約 / 日本語翻訳（再押しで元に戻す） |
| `Shift+D` | Podcast MP3 をダウンロード（`enclosure_url` 未取得時は自動フェッチ） |
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
| `H` | フィルター切替（active → unread → all） |
| `a` | カテゴリ割り当て |
| `C` | カテゴリマネージャーを開く |
| `d` | フィード購読解除（確認あり） |

### Entries ペイン

| キー | 動作 |
|---|---|
| `↓` / `↑` | 記事を移動（自動既読） |
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
