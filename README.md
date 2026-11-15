# ひみつ出欠（join-if）

誰が何と答えたかを招待側に見せずに、「Aさんが来るなら行く」のような条件付きの参加意向を集め、
条件を守りつつ参加者が最大になる組み合わせを出す出欠確認サービスです。

- 仕様: [specs/条件付き出欠アンケート「ひみつ出欠」設計書.md](specs/条件付き出欠アンケート「ひみつ出欠」設計書.md)
- 実装計画: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)
- 進捗表: [docs/PROGRESS.md](docs/PROGRESS.md)

## 構成

```text
apps/api          API サーバー（Hono / Node.js）— Clean Architecture
  src/domain          集計(solver)・検証ルール（フレームワーク非依存）
  src/application     ユースケース・共通認可・ポート(interface)
  src/infrastructure  DB(memory / postgres)・暗号・回数制限の実装
  src/presentation    HTTP（ルート定義テーブル）
apps/web          画面（Vite + React SPA）
packages/contracts  API の型（web と api で共有）
```

DB は `DATA_STORE` で切り替えます（`memory` / `postgres`）。Postgres 実装は Supabase にもそのまま接続できます。

## ローカルで動かす

Node.js 24 以上。

```bash
npm install

# API（インメモリDB）
cd apps/api
cp .env.example .env
npm run dev                # http://localhost:8787
# インメモリDBでは TOKEN_ENC_KEY が空なら一時的な鍵を自動生成します。
# Postgres を使うときは npm run gen-key の出力を .env の TOKEN_ENC_KEY に設定してください（必須）。

# 画面（別ターミナル）
cd apps/web
npm run dev                # http://localhost:5173 （/api は 8787 にプロキシ）
```

## テスト

```bash
npm test          # API 160件 + 画面 15件
npm run typecheck
npm run build
```

- 集計: 仕様 6.4 の計算例、全探索との 1 万ケース照合、100人で 1 秒以内
- 秘匿性: 管理用・他メンバーの応答に回答内容が含まれない／「行かない」と「条件不成立」の応答が完全一致
- 権限: ルート定義テーブルの全 API × 不正トークン（なし・別種類・別ルーム・別ルームの memberId）を自動で検査
- 改竄・招待URL（410／同時有効化／再発行）・締め切りとの同時実行・回数制限
- 同じユースケーステストを memory と Postgres(PGlite) の両方で実行（アダプタ契約テスト）

## Postgres / Supabase を使う

```bash
cd apps/api
# .env に DATA_STORE=postgres と DATABASE_URL を設定
npm run migrate
npm run dev
```

マイグレーションは RLS の有効化と、Supabase の `anon` / `authenticated` からの `REVOKE ALL` を含みます。
API は service_role 相当（テーブル所有者）の接続文字列で接続してください。ブラウザには DB のキーを一切渡しません。

自動削除は API プロセス内のタイマーで行います。サーバーレスで常駐プロセスがない場合は
`apps/api/src/infrastructure/persistence/postgres/supabase/purge_cron.sql` を Supabase で実行してください。

## AWS へのデプロイ（Terraform）

CloudFront + S3 + Lambda + RDS PostgreSQL 構成。手順は [docs/DEPLOY_AWS.md](docs/DEPLOY_AWS.md)、費用は [docs/AWS_COST_ESTIMATE.md](docs/AWS_COST_ESTIMATE.md)（約 21 USD/月）。

```bash
infra/scripts/deploy.sh
```

## その他のホスティング

| 層 | 例 | 設定 |
| --- | --- | --- |
| 画面 | Vercel / Cloudflare Pages / Netlify（静的） | `npm run build -w @himitsu/web` → `apps/web/dist`。SPA なので全パスを `index.html` にリライト。`VITE_API_BASE_URL` に API のオリジン |
| API | Fly.io / Render / Cloud Run など Node が動く環境 | `npm start -w @himitsu/api`。`TOKEN_ENC_KEY`・`DATA_STORE=postgres`・`DATABASE_URL`・`CORS_ORIGINS`（画面のオリジン）・プロキシ配下なら `TRUST_PROXY=true` |
| DB | Supabase（開発用と本番用で別プロジェクト） | `npm run migrate` |

静的ホスティング側でも `Referrer-Policy: no-referrer` を付けてください（`index.html` にも meta を入れています）。
ビルド時に CSP の meta を自動で付与します。

回数制限はプロセス内メモリで数えるため、API を複数台にする場合は `RateLimiter` の共有ストア実装（Redis など）を追加してください。
