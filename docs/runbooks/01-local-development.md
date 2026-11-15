# 01. ローカル開発環境

## 前提

| ツール | バージョン | 確認コマンド |
| --- | --- | --- |
| Node.js | 22 以上（推奨 24。`.nvmrc` あり） | `node -v` |
| npm | 10 以上 | `npm -v` |
| Git | — | `git --version` |

Docker やローカルの PostgreSQL は不要です（既定はインメモリDB）。

## 初回セットアップ

```bash
git clone <repo> join-if && cd join-if
npm install                       # 全ワークスペース（api / web / contracts）を一括インストール
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env   # 任意。既定のままでよい
```

`apps/api/.env` はインメモリDBなら編集不要です（`TOKEN_ENC_KEY` が空なら起動時に一時鍵を自動生成）。

## 起動

ターミナルを2つ使います。

```bash
# ターミナル1: API  → http://localhost:8787
npm run dev:api

# ターミナル2: 画面 → http://localhost:5173 （/api/* は 8787 にプロキシ）
npm run dev:web
```

ブラウザで http://localhost:5173 を開きます。

起動できたかの確認:

```bash
curl -s http://localhost:8787/healthz          # {"ok":true}
npm run smoke -- http://localhost:8787         # ALL CHECKS PASSED
```

> インメモリDBは API を再起動するとデータが消えます。作ったルームの URL も無効になります。

## ローカルで PostgreSQL を使う（任意）

本番と同じ Postgres 実装で確認したい場合。

```bash
# 例: Homebrew
brew install postgresql@17 && brew services start postgresql@17
createdb himitsu
```

`apps/api/.env` を変更:

```dotenv
DATA_STORE=postgres
DATABASE_URL=postgres://localhost:5432/himitsu
TOKEN_ENC_KEY=<npm run gen-key -w @himitsu/api の出力>   # postgres では必須
RATE_LIMIT=postgres     # 任意。memory のままでもよい
```

```bash
npm run migrate -w @himitsu/api    # テーブル作成（何度実行しても安全）
npm run dev:api
```

> `TOKEN_ENC_KEY` は一度決めたら変えないでください。変えると、保存済みの未使用招待URLが管理画面で表示できなくなります。

## よくあるエラー

| 症状 | 原因と対処 |
| --- | --- |
| `TOKEN_ENC_KEY is required with DATA_STORE=postgres` | Postgres 利用時は鍵が必須。`npm run gen-key -w @himitsu/api` の出力を `.env` に設定 |
| `DATABASE_URL is required when DATA_STORE=postgres` | `.env` に接続文字列を設定 |
| 画面で「通信できませんでした」 | API が起動していない。ターミナル1を確認 |
| `EADDRINUSE: 8787` / `5173` | 前回のプロセスが残っている。`lsof -i :8787` で確認して終了 |
| 画面で 429（アクセスが集中） | 回数制限。開発中は `.env` に `RATE_LIMIT=off` |

環境変数の一覧は [env-reference.md](./env-reference.md)。
