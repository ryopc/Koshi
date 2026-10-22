# AGENTS.md

このワークスペースで作業する AI エージェント向けの共通ガイダンスです。

## 共通指示

* 回答や解説、エージェントの思考プロセス、出力するコメントはすべて必ず**日本語**で記述してください。
* 日本語での指示に対して英語で返答してはいけません。

## プロジェクト概要

**Koshi** - ターミナルネイティブな分散型 SNS
- サーバーレス P2P メッシュ（SQLite + hyperswarm）
- ed25519 署名による投稿認証
- CLI/TUI での操作を前提とした設計
- v6: AI エージェントフレンドリーなプラットフォーム機能追加

## 主要コマンド

```bash
# 開発
npm run dev:cli          # nodemon で CLI 開発
npm run server:dev       # ローカルサーバー開発

# テスト・チェック
npm run lint             # ESLint 実行
npm run test             # Jest 実行

# ビルド
npm run build            # ビルドスクリプト実行

# 仕様検証
node scripts/check-spec-parity.mjs     # OpenAPI 仕様とルートの整合性
node scripts/check-schema-valid.mjs    # JSON スキーマ検証
node scripts/check-agent-card.mjs      # A2A Agent Card 検証
```

## 開発フロー

1. 機能追加・修正
2. `npm run lint` でリント
3. `node scripts/check-spec-parity.mjs` 等で仕様整合性確認
4. 必要に応じてローカルサーバー起動して手動テスト
   ```bash
   PORT=3001 node src/local/server-standalone.js &
   kb --local feed --json
   ```
5. コミット・プッシュ

## 重要なファイル

| ファイル | 役割 |
|---------|------|
| `bin/cli.js` | CLI エントリーポイント（コマンドディスパッチ） |
| `bin/kb-mcp.js` | MCP サーバー（stdio トランスポート） |
| `src/cli/args.js` | コマンドライン引数解析 |
| `src/cli/output.js` | 出力モード制御（JSON/人間可読） |
| `src/cli/exit.js` | 終了コード管理 |
| `src/api/` | REST API 実装 |
| `src/local/` | サーバーレスモード実装 |
| `src/mcp/` | MCP サーバー実装（ツール・リソース・プロンプト） |
| `src/spec/` | OpenAPI/JSON Schema 定義 |
| `src/db/` | データベーススキーマ・マイグレーション |

## CLI 設計原則

1. **グローバルフラグ優先**: `--json`、`--local`、`--quiet` 等はメインで先に解析
2. **コマンドコンテキスト**: `commandContext = { global }` を全コマンドに渡す
3. **JSON モード**: `--json` 時は `ok()`/`fail()` で構造化出力
4. **終了コード**: `ExitCode` 列挙で意味ある終了コードを返す
5. **ヘルプ自動生成**: `handleHelp()` で `--help` 表示

## MCP サーバー

```bash
kb mcp    # stdio トランスポートで起動
```

利用可能ツール（13個）:
- `get_feed`, `create_post`, `get_post`
- `send_dm`, `get_dms`, `mark_dm_read`
- `get_profile`, `edit_profile`, `search_users`
- `get_agent_card`, `list_agents`
- `subscribe_events`, `get_event_stream`

## 環境変数

| 変数 | 説明 |
|-----|------|
| `KOSHI_API_URL` | API ベース URL（サーバー URL 上書き） |
| `KOSHI_WS_URL` | WebSocket URL |
| `LOG_LEVEL` | debug/info/warn/error |

## 設定ファイル

`~/.config/koshi/config.json` にアカウント情報保存:
- アカウントごとの ed25519 鍵ペア
- JWT トークン
- アクティブアカウント

## 既知の制約

- バイナリファイル生成ツール（wasm 等）は使用不可
- WebAssembly 必要な依存関係は避ける
- SQLite 依存のためネイティブビルド必要（`better-sqlite3`）
- P2P モードは hyperswarm/DHT 使用（NAT 越え自動）