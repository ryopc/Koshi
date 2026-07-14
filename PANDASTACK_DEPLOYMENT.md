# PandaStack 運用ガイド – koshi 本番環境構築

game_ryo様のための、**PandaStack での koshi 本番環境構築・運用マニュアル**です。

---

## 📋 **目次**

1. [事前準備](#事前準備)
2. [リポジトリの確認・構成](#リポジトリの確認構成)
3. [PandaStack ダッシュボード設定](#pandastackダッシュボード設定)
4. [デプロイ手順](#デプロイ手順)
5. [本番環境の確認](#本番環境の確認)
6. [日常運用](#日常運用)
7. [トラブルシューティング](#トラブルシューティング)

---

## 事前準備

### 必要な準備物

- [x] GitHub アカウント（@game_ryo / @ryotagtagtag-wq）
- [x] PandaStack アカウント（https://dashboard.pandastack.io で登録）
- [x] npm/Node.js v20+（ローカルテスト用）
- [x] GitHub Personal Access Token（PAT）– `repo` + `workflow` スコープ

### PandaStack アカウント作成

1. https://dashboard.pandastack.io にアクセス
2. **Sign up** → GitHub でログイン
3. OAuth で ryopc / ryotagtagtag-wq 組織を認可
4. ダッシュボードに到達 ✓

### PAT の作成（GitHub Actions CI/CD 用）

```bash
# GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
# スコープ: repo, workflow, write:packages
# 生成後、コピーして安全に保管
export GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
```

---

## リポジトリの確認・構成

### ryopc/koshi の構造確認

freebuff で生成された koshi が以下の構成で存在することを確認してください：

```
ryopc/koshi/
├── bin/
│   ├── cli.js                  # CLI エントリーポイント
│   └── server.js               # Express サーバー（PandaStack で起動）
├── src/
│   ├── api/
│   │   ├── auth.js             # 認証エンドポイント
│   │   ├── users.js            # ユーザー管理
│   │   ├── posts.js            # ポスト管理
│   │   └── dms.js              # DM 管理
│   ├── db/
│   │   ├── schema.sql          # PostgreSQL スキーマ
│   │   └── migrations/         # マイグレーション
│   ├── auth/
│   │   ├── jwt.js              # JWT トークン処理
│   │   └── ed25519.js          # Ed25519 署名検証
│   └── ws/
│       └── handlers.js         # WebSocket イベント
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions (PandaStack Deploy)
├── Dockerfile                  # コンテナイメージ定義
├── pandastack.json             # PandaStack デプロイ設定
├── package.json                # 依存関係
├── package-lock.json
├── .env.example                # 環境変数テンプレート
├── README.md                   # プロジェクト説明
└── DEPLOYMENT.md               # このファイル
```

### 確認コマンド

```bash
cd ~/projects/ryopc/koshi  # または適切なディレクトリ

# ファイル構成確認
ls -la
find . -type f -name "*.js" | head -20

# package.json 確認
cat package.json | grep -A 20 '"scripts"'

# Dockerfile 確認
cat Dockerfile

# pandastack.json 確認
cat pandastack.json
```

---

## PandaStack ダッシュボード設定

### ステップ 1：新規プロジェクト作成

1. **PandaStack ダッシュボード** → https://dashboard.pandastack.io
2. **Create Project** ボタンをクリック
3. **Select repository** → `ryopc/koshi` を選択
4. **Project name** → `koshi` (または `koshi-api`)
5. **Framework detection** → Express が自動検出されるはず
   - **Build Command**: `npm install && npm run build` (または `npm ci`)
   - **Start Command**: `npm start`
   - **Port**: `3000`
6. **Create project** をクリック

### ステップ 2：環境変数設定

PandaStack ダッシュボード → Settings → Environment Variables

以下を追加：

```
JWT_SECRET=your_random_secret_key_here_min_32_chars
NODE_ENV=production
DATABASE_URL=postgresql://...  # PandaStack が自動生成
```

**JWT_SECRET の生成例：**
```bash
# ターミナルで
openssl rand -base64 32
# または
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

コピーして PandaStack に貼り付け。

### ステップ 3：データベース設定

1. **Database** タブ → **Add Database**
2. **Engine**: PostgreSQL 15 (推奨)
3. **Database name**: `koshi_db`
4. **User**: `koshi_user`
5. **Create** をクリック

PandaStack が自動的に `DATABASE_URL` 環境変数を生成 → Express に自動 wire in

### ステップ 4：デプロイ トリガー設定

**Settings** → **Auto Deploy**

- [x] Deploy on every push to `main` branch
- [x] Preview deployments on PR

保存。

---

## デプロイ手順

### 方法 A：PandaStack ダッシュボード経由（手動）

1. ダッシュボード → プロジェクト `koshi` を開く
2. **Deploy** タブ
3. **Deploy Latest Commit** ボタン → 自動ビルド・デプロイ開始
4. ログをリアルタイム監視
5. ✅ **Deployed** となったら完了

### 方法 B：GitHub Push 経由（自動）

```bash
cd ~/projects/ryopc/koshi

# コード変更・コミット
echo "update: add new feature" > CHANGELOG.md
git add CHANGELOG.md
git commit -m "chore: update changelog"

# main にプッシュ
git push origin main

# → PandaStack が自動検出・ビルド・デプロイ
# ダッシュボードでリアルタイム監視
```

### 方法 C：CLI 経由

```bash
# PandaStack CLI をインストール
npm install -g @pandastack/cli

# ログイン
pandastack login

# デプロイ
cd ~/projects/ryopc/koshi
pandastack deploy --prod

# 出力例:
# › Linking to GitHub repo...
# › Detecting framework: Express ✓
# › Building container image...
# › Pushing to GKE (us-central1)...
# ✔ Deployed in 28s — live at koshi.pandastack.app
```

---

## 本番環境の確認

### デプロイ完了後

1. **ダッシュボード → Deployments** で最新デプロイ確認
2. **Live URL** をクリック
   - 例: `https://koshi.pandastack.app`
3. ブラウザで以下をテスト：

#### API ヘルスチェック

```bash
curl https://koshi.pandastack.app/health
# 応答例: { "status": "ok", "version": "0.2.0" }
```

#### WebSocket 接続テスト

```bash
# Node.js
node -e "
const ws = new (require('ws'))('wss://koshi.pandastack.app/ws?token=test');
ws.on('open', () => console.log('✓ Connected'));
ws.on('error', (e) => console.error('✗ Error', e.message));
"
```

#### ユーザー登録テスト

```bash
curl -X POST https://koshi.pandastack.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "publicKey": "your_ed25519_public_key_here"
  }'

# 応答例:
# {
#   "userId": "550e8400-e29b-41d4-a716-446655440000",
#   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
# }
```

#### PostgreSQL 接続確認

```bash
# PandaStack ダッシュボード → Database → Connection String をコピー
# ローカルから接続テスト
psql "postgresql://koshi_user:password@db.pandastack.io/koshi_db" -c "SELECT version();"
```

---

## 日常運用

### 定期的なタスク

#### 日次

- [ ] ダッシュボード → **Monitoring** で uptime 確認（99.9% 以上）
- [ ] エラーログ確認：**Logs** タブ
- [ ] データベース バックアップ確認（自動、7日間保持）

#### 週次

```bash
# ローカルで動作確認
cd ~/projects/ryopc/koshi
npm test
npm run dev  # or npm start
curl http://localhost:3000/health
```

#### 月次

- [ ] セキュリティアップデート確認
- [ ] 依存関係更新：`npm audit`
- [ ] ディスク使用量確認（Database）

### コードの更新・デプロイ

```bash
# 新機能ブランチで開発
git checkout -b feature/add-reactions

# コミット
git add src/api/reactions.js
git commit -m "feat: add post reactions endpoint"

# main にマージ
git checkout main
git merge feature/add-reactions

# プッシュ → PandaStack 自動デプロイ
git push origin main

# ✅ ダッシュボードで deployment monitoring
```

### ロールバック

デプロイ後に問題が発生した場合：

1. **ダッシュボード → Deployments**
2. 前回の安定版をクリック
3. **Rollback** ボタン
4. 即座に戻す ✓

---

## トラブルシューティング

### デプロイが失敗する

**エラー**: `npm install failed` / `build failed`

**原因**: 依存関係が outdated または 互換性エラー

**対策**:
```bash
# ローカルで test
npm ci  # 厳密なインストール
npm run build
npm test

# 問題を修正後、再度プッシュ
git add package-lock.json
git commit -m "fix: update dependencies"
git push origin main
```

### PostgreSQL 接続エラー

**エラー**: `ECONNREFUSED` / `Database connection failed`

**原因**: `DATABASE_URL` が未設定 または 接続タイムアウト

**対策**:
```bash
# ダッシュボード → Settings → Environment Variables で確認
# DATABASE_URL が存在するか

# ローカルテスト
psql $DATABASE_URL -c "SELECT 1;"  # Connection test
```

### WebSocket が接続できない

**エラー**: `wss://koshi.pandastack.app/ws: 403 Forbidden`

**原因**: JWT トークン無効 または パス間違い

**対策**:
```bash
# 有効なトークンを取得
curl -X POST https://koshi.pandastack.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser", "signature": "..."}'

# レスポンスの token を使用
# wss://koshi.pandastack.app/ws?token={token}
```

### ログが見当たらない

**確認方法**:
1. **ダッシュボード → Logs** タブ
2. **Time range** を調整（過去 24h / 7d など）
3. **Search** で キーワード検索

リアルタイム監視：
```bash
pandastack logs koshi --follow
```

---

## まとめ

| タスク | 頻度 | 実行者 |
|--------|------|--------|
| デプロイ（main push） | 随時 | game_ryo |
| uptime 監視 | 日次 | automated |
| セキュリティ更新 | 月次 | game_ryo |
| ロールバック | 必要時 | game_ryo |
| バックアップ確認 | 月次 | automated |

---

## 次のステップ

- [ ] 本番デプロイ完了
- [ ] ドメイン設定（例：`api.koshi.dev`）– PandaStack → Custom Domains
- [ ] Monitoring + Alerting 設定（Slack 通知等）
- [ ] CLI クライアント（`kb` コマンド）の npm publish
- [ ] Phase 2 機能開発開始（likes, comments など）

---

**執事 kai より**

game_ryo様、PandaStack での運用体制が整いました。ダッシュボード一つで、スケーラビリティ・信頼性・セキュリティすべてが備わっております。

ご不明な点やご指示があれば、いつでもお申し付けください。🙇‍♂️✨
