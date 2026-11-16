# ドキュメント一覧

AI エージェントや開発者が守るルールは [AGENTS.md](../AGENTS.md)（Claude Code 向けの補足は [CLAUDE.md](../CLAUDE.md)）。

## 手順書（runbooks）

上から順に読めば、ゼロから本番運用までたどり着けるように並べています。

| # | 手順書 | 対象 | いつ使う |
| --- | --- | --- | --- |
| 01 | [ローカル開発環境](runbooks/01-local-development.md) | 開発者 | 初めて手元で動かすとき |
| 02 | [テストとビルド](runbooks/02-testing.md) | 開発者 | 変更をコミット・デプロイする前 |
| 03 | [AWS 環境の事前準備](runbooks/03-aws-prerequisites.md) | 運用者 | 初回デプロイの前に一度だけ |
| 04 | [AWS へのデプロイ](runbooks/04-aws-deploy.md) | 運用者 | 初回・更新・ロールバック |
| 05 | [動作確認](runbooks/05-verification.md) | 運用者 | デプロイの直後 |
| 06 | [運用](runbooks/06-operations.md) | 運用者 | ログ確認、障害対応、秘密情報の変更、環境の削除 |
| 07 | [AWS 以外で動かす場合](runbooks/07-other-hosting.md) | 運用者 | Supabase・他ホスティングを使うとき |
| — | [環境変数・設定一覧](runbooks/env-reference.md) | 両方 | 設定値を調べるとき |

## 最短手順

```bash
# ローカル
npm install && cp apps/api/.env.example apps/api/.env
npm run dev:api & npm run dev:web

# AWS
npm run doctor          # 点検（足りないものと直し方を表示）
npm run release         # テスト → デプロイ → スモークテスト
```

## 設計・計画

| ドキュメント | 内容 |
| --- | --- |
| [仕様書](../specs/条件付き出欠アンケート「ひみつ出欠」設計書.md) | 要件・画面・API・データ設計の元資料 |
| [実装計画](IMPLEMENTATION_PLAN.md) | アーキテクチャ、仕様からの変更点、フェーズ |
| [進捗表](PROGRESS.md) | フェーズごとの状況と作業ログ |
| [AWS コスト試算](AWS_COST_ESTIMATE.md) | 月額の内訳、規模別の目安、節約案 |
