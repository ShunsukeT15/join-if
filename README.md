# Join if

誰が何と答えたかを招待側に見せずに、「Aさんが来るなら行く」のような条件付きの参加意向を集め、
条件を守りつつ参加者が最大になる組み合わせを出す出欠確認サービスです。

本番（AWS）: https://d19vqsq3pf9lsr.cloudfront.net

## クイックスタート（ローカル）

Node.js 22 以上（推奨 24）。

```bash
npm install
cp apps/api/.env.example apps/api/.env
npm run dev:api     # ターミナル1: API  http://localhost:8787
npm run dev:web     # ターミナル2: 画面 http://localhost:5173
```

## デプロイ（AWS）

```bash
npm run doctor     # 点検
npm run release    # テスト → デプロイ → 動作確認
```

## ドキュメント

すべての手順書は [docs/README.md](docs/README.md) から辿れます。

| やりたいこと | 手順書 |
| --- | --- |
| ローカルで動かす | [01-local-development](docs/runbooks/01-local-development.md) |
| テスト・ビルド | [02-testing](docs/runbooks/02-testing.md) |
| AWS の初回準備 | [03-aws-prerequisites](docs/runbooks/03-aws-prerequisites.md) |
| AWS にデプロイ・更新・ロールバック | [04-aws-deploy](docs/runbooks/04-aws-deploy.md) |
| デプロイ後の動作確認 | [05-verification](docs/runbooks/05-verification.md) |
| ログ・障害対応・環境の削除 | [06-operations](docs/runbooks/06-operations.md) |
| 環境変数・Terraform 変数 | [env-reference](docs/runbooks/env-reference.md) |
| 費用 | [AWS_COST_ESTIMATE](docs/AWS_COST_ESTIMATE.md)（約 21 USD/月） |

## 開発ルール

AI エージェント・開発者向けのルール（秘匿性の不変条件、層の依存方向、マイグレーション、デプロイの注意など）は [AGENTS.md](AGENTS.md) にまとめています。

## 構成

```text
apps/api            API サーバー（Hono / Node.js）— Clean Architecture
  src/domain            集計(solver)・検証ルール（フレームワーク非依存）
  src/application       ユースケース・共通認可・ポート(interface)
  src/infrastructure    DB(memory / postgres)・暗号・回数制限の実装
  src/presentation      HTTP（ルート定義テーブル）
  src/main.ts           Node サーバーとして起動
  src/lambda.ts         AWS Lambda として起動
apps/web            画面（Vite + React SPA）
packages/contracts  API の型（web と api で共有）
infra/terraform     AWS（CloudFront + S3 + Lambda + RDS）
infra/scripts       デプロイ・スモークテスト
```

DB は `DATA_STORE`（`memory` / `postgres`）、回数制限は `RATE_LIMIT`（`memory` / `postgres`）で切り替えます。
