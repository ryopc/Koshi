# PandaStack 運用開始チェックリスト

このチェックリストで、koshi の PandaStack デプロイが正常に進行しているかを確認してください。

---

## ✅ ステップ 1：事前準備

- [ ] PandaStack アカウント作成済み（https://dashboard.pandastack.io）
- [ ] GitHub PAT 生成済み（Settings → Developer settings → Personal access tokens）
- [ ] PAT スコープ確認：`repo`, `workflow`, `write:packages`
- [ ] Node.js v20+ インストール済み（`node -v` で確認）
- [ ] npm/Git 動作確認済み（`npm -v`, `git --version`）

---

## ✅ ステップ 2：リポジトリ確認

- [ ] `ryopc/koshi` リポジトリが存在
- [ ] main ブランチが最新状態
- [ ] 以下ファイルが存在：
  - [ ] `package.json`
  - [ ] `Dockerfile`
  - [ ] `pandastack.json`
  - [ ] `bin/server.js` (Express エントリーポイント)
  - [ ] `src/db/schema.sql` (PostgreSQL スキーマ)
  - [ ] `.env.example`
  - [ ] `PANDASTACK_DEPLOYMENT.md` (このガイド)

---

## ✅ ステップ 3：ローカル動作確認

```bash
cd ~/projects/ryopc/koshi

# 依存関係インストール
npm ci

# 動作確認
npm test

# ローカル起動（development）
NODE_ENV=development npm start
# 出力: "Server running on http://localhost:3000"
```

- [ ] `npm ci` 成功
- [ ] `npm test` 成功（またはテストスキップ）
- [ ] ローカル起動成功、`http://localhost:3000/health` で ok レスポンス

---

## ✅ ステップ 4：PandaStack ダッシュボード設定

### プロジェクト作成

1. PandaStack Dashboard → https://dashboard.pandastack.io にログイン
2. **Create Project** → `ryopc/koshi` を選択
3. **Project name**: `koshi` または `koshi-api`
4. **Framework**: Express が自動検出
   - Build Command: `npm install && npm run build` (または `npm ci`)
   - Start Command: `npm start`
   - Port: `3000`
5. **Create** をクリック

- [ ] プロジェクト作成完了
- [ ] ダッシュボードでプロジェクト確認可能

### 環境変数設定

ダッシュボード → Settings → Environment Variables:

```bash
# ターミナルで JWT_SECRET を生成
openssl rand -base64 32
# 出力例: "abcdefg123456..."
```

- [ ] `NODE_ENV` = `production`
- [ ] `JWT_SECRET` = 生成した秘密鍵（32文字以上）
- [ ] `CORS_ORIGIN` = `https://koshi.pandastack.app`
- [ ] その他の環境変数（`.env.example` を参照）

### データベース設定

ダッシュボード → Database → **Add Database**:

- [ ] **Engine**: PostgreSQL 15
- [ ] **Database name**: `koshi_db`
- [ ] **User**: `koshi_user`
- [ ] **Create** → 自動生成完了
- [ ] `DATABASE_URL` が Environment Variables に自動追加される

確認：
```bash
# PandaStack ダッシュボードで DATABASE_URL を確認
# ローカルから接続テスト（オプション）
psql "$DATABASE_URL" -c "SELECT version();"
```

- [ ] PostgreSQL 接続成功

### Auto Deploy 設定

ダッシュボード → Settings → **Auto Deploy**:

- [ ] **Deploy on every push to main** ✓ チェック
- [ ] **Preview deployments on PR** ✓ チェック
- [ ] **Save** をクリック

---

## ✅ ステップ 5：初回デプロイ

### 方法 A：ダッシュボード経由（推奨）

1. ダッシュボード → プロジェクト `koshi` を開く
2. **Deploy** タブ
3. **Deploy Latest Commit** ボタンをクリック
4. ログをリアルタイム監視
5. ✅ **Deployed** と表示されたら完了

- [ ] デプロイ開始
- [ ] ビルド成功（ログで `Building image...` → `Pushing...`）
- [ ] デプロイ完了（ログで `✔ Deployed`）
- [ ] Live URL 取得（例: `https://koshi.pandastack.app`）

### 方法 B：GitHub Push 経由（自動）

```bash
cd ~/projects/ryopc/koshi

# コード変更（簡単なテスト）
echo "# koshi deployed at $(date)" >> README.md

# コミット
git add README.md
git commit -m "chore: test deployment trigger"

# main にプッシュ
git push origin main

# → PandaStack が自動検出・ビルド・デプロイ
```

- [ ] Git push 実行
- [ ] PandaStack が自動デプロイ開始（ダッシュボード監視）
- [ ] デプロイ完了

---

## ✅ ステップ 6：本番環境の確認

### ヘルスチェック

```bash
curl https://koshi.pandastack.app/health
# 応答例: {"status":"ok","version":"0.2.0"}
```

- [ ] HTTP 200 OK
- [ ] JSON レスポンス取得

### API テスト

```bash
# ユーザー登録テスト
curl -X POST https://koshi.pandastack.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","publicKey":"test_key"}'
```

- [ ] HTTP 200/201 レスポンス
- [ ] `userId` と `token` を取得

### WebSocket テスト

```bash
# Node.js でテスト
node -e "
const ws = new (require('ws'))('wss://koshi.pandastack.app/ws?token=test');
ws.on('open', () => console.log('✓ Connected'));
ws.on('error', (e) => console.error('✗ Error', e.message));
setTimeout(() => process.exit(0), 3000);
"
```

- [ ] WebSocket 接続確認

### ログ確認

ダッシュボード → **Logs** タブ:

- [ ] リアルタイムログが表示される
- [ ] エラーが無い、または想定範囲内
- [ ] request/response ログが記録されている

---

## ✅ ステップ 7：日常運用体制確認

### ダッシュボード監視設定

- [ ] **Monitoring** タブで uptime 確認できる
- [ ] **Deployments** タブで過去のデプロイ履歴確認可能
- [ ] **Database** タブでバックアップ状態確認

### バックアップ確認

- [ ] 自動バックアップが有効（PandaStack デフォルト 7 日間）
- [ ] ダッシュボード → Database → Backups で確認

### セキュリティ確認

- [ ] HTTPS/TLS が自動適用（PandaStack デフォルト）
- [ ] Environment variables が安全に保管されている（表示不可）
- [ ] rate limiting が有効

---

## ✅ ステップ 8：Next Steps

運用開始後、以下のタスクを完了してください：

- [ ] **Phase 1 機能テスト完了**
  - [ ] ユーザー登録・ログイン
  - [ ] ポスト作成・フィード取得
  - [ ] フォロー機能
  - [ ] DM 送受信

- [ ] **npm publish（オプション）**
  ```bash
  npm login
  npm publish  # @ryopc/koshi@0.2.0
  ```

- [ ] **ドメイン設定（オプション）**
  - PandaStack → Custom Domains で `api.koshi.dev` 等を設定

- [ ] **Slack/Discord 通知設定**
  - ダッシュボード → Integrations でアラート設定

- [ ] **Phase 2 開発開始**
  - Likes, Comments, Notifications, Search 等

---

## 🆘 トラブルシューティング

### デプロイが失敗する場合

**ダッシュボード → Deployments**:

1. エラーログを確認
2. 一般的なエラー：
   - `npm install failed` → package.json 確認、依存関係更新
   - `build failed` → ローカルで `npm run build` 実行して確認
   - `DATABASE_URL not set` → Environment Variables 確認

### 本番で動作しない場合

**確認項目**:

1. `curl https://koshi.pandastack.app/health` でレスポンス確認
2. ダッシュボード → Logs でエラー確認
3. Database 接続確認：`psql $DATABASE_URL -c "SELECT 1;"`
4. WebSocket URL 確認：`wss://` （http ではなく https）

---

## 📞 サポート

- **PandaStack ドキュメント**: https://docs.pandastack.io
- **GitHub Issues**: https://github.com/ryopc/koshi/issues
- **kai への相談**: いつでもお気軽に！

---

**チェックリスト完了時点で、koshi は本番運用可能です。🎉**

完了日時：_____________

確認者：_____________
