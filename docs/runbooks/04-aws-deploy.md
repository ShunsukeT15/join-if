# 04. AWS へのデプロイ

## 構成

```text
ブラウザ ──HTTPS──▶ CloudFront（1つのドメイン）
                     ├─ /*      → S3（SPA。非公開バケット、OAC）
                     │            CloudFront Function で拡張子なしのパスを /index.html に
                     └─ /api/*  → Lambda Function URL（AWS_IAM 認証、CloudFront OAC で署名）
                                   + X-Origin-Verify ヘッダー（二重チェック）
                                   │
                         ┌──────── VPC（プライベートサブネットのみ、NAT なし）────────┐
                         │  Lambda (Node.js, arm64) ──TLS(証明書検証)──▶ RDS PostgreSQL │
                         └────────────────────────────────────────────────────────────┘
EventBridge（毎日 03:17 JST）→ Lambda { action: "purge" }（期限切れルームと回数制限の掃除）
```

| リソース | 名前 |
| --- | --- |
| CloudFront | コメント `himitsu-prod web + api` |
| S3 | `himitsu-prod-web-<アカウントID>` |
| Lambda | `himitsu-prod-api` |
| RDS | `himitsu-prod-db`（PostgreSQL 17, db.t4g.micro） |
| ロググループ | `/aws/lambda/himitsu-prod-api`（14日保持） |

## コマンドの早見表

| コマンド | 内容 | AWS を変更するか |
| --- | --- | --- |
| `npm run doctor` | ツール・AWS 認証・デプロイ先アカウントの点検 | しない |
| `npm run release -- --plan` | 点検 → 型チェック → テスト → 変更内容の確認 | しない |
| `npm run release` | 点検 → 型チェック → テスト → デプロイ（plan を見て yes）→ スモークテスト | する |
| `npm run release -- --yes` | 上と同じで、確認なしで適用 | する |
| `infra/scripts/deploy.sh` | デプロイ部分のみ（テスト・スモークテストなし） | する |

通常は **`npm run release` の1コマンド** で足ります。

## 初回デプロイ

前提: [03-aws-prerequisites.md](./03-aws-prerequisites.md) が完了していること。所要時間は 20〜35 分（RDS の作成が大半）。

```bash
npm ci
npm run release      # plan が表示されるので内容を確認して yes
```

`npm run release` は、点検・型チェック・テストを通してから `deploy.sh` を実行し、最後にスモークテストで確認します。`deploy.sh` が行うこと:

1. API を Lambda 用にバンドル（`apps/api/dist/lambda`）
2. `terraform apply`
3. DB マイグレーション（Lambda を `{"action":"migrate"}` で起動）
4. 画面をビルドして S3 にアップロード（`assets/` は長期キャッシュ、`index.html` はキャッシュなし）
5. CloudFront のキャッシュ削除

最後に `==> Done: https://xxxx.cloudfront.net` と表示されたら完了です。続けて [05-verification.md](./05-verification.md) で動作確認します。

> **初回の `plan` で必ず確認すること**: `Plan: N to add, 0 to change, 0 to destroy.`（既存リソースへの変更・削除が 0 件）

### 途中で止まった場合（共通）

スクリプトは開始前に必要なコマンドと AWS 認証を確認しますが、それ以降に失敗すると **Lambda だけ新しく、マイグレーション・画面は古い** 状態になり得ます（新しいコードが新しいテーブル構造を前提にしていると、保存などが失敗する）。
原因を直して **同じコマンドをもう一度実行** すれば、残りの手順（マイグレーション・画面のアップロード）が実行されて揃います。

### 初回デプロイで途中失敗した場合

途中で失敗しても、作成済みのリソースは state に記録されています。原因を直して **同じコマンドを再実行** すれば続きから作成されます（作り直しにはなりません）。

## 更新デプロイ

コードやインフラ定義を変更したら、同じコマンドを実行します。

```bash
git pull
npm ci
npm run release
```

- Lambda は zip の内容が変わったときだけ更新されます。
- マイグレーションは未適用のものだけ実行されます（適用済みはスキップ）。
- 画面の変更は CloudFront のキャッシュ削除後、数分以内に反映されます。

変更内容の確認だけしたい場合（AWS は変更しない）:

```bash
npm run release -- --plan
```

## ロールバック

アプリの不具合で前のバージョンに戻す場合:

```bash
git checkout <前のコミット>
npm run release
git checkout main
```

> **注意**: DB マイグレーションは前進のみです。新しいマイグレーションで追加したテーブルや列は、コードを戻しても残ります
> （現在のマイグレーションは追加のみなので、古いコードでも動作します）。列の削除・変更を含むマイグレーションを追加するときは、戻せる手順を先に用意してください。

## デプロイに関するエラー

| 症状 | 原因と対処 |
| --- | --- |
| `error: 'aws' not found in PATH` | AWS CLI が見つからない。Homebrew で入れている場合はリンクが外れていることがある → `brew link awscli` |
| `ExpiredToken` / `InvalidClientTokenId` | AWS 認証情報の期限切れ・誤り。`aws sts get-caller-identity` で確認 |
| `Error acquiring the state lock` | 別の terraform が実行中、または異常終了。実行中でないことを確認して `terraform force-unlock <ID>` |
| マイグレーションで `migration failed` | 表示された `errorMessage` を確認。ログは [06-operations.md](./06-operations.md#ログを見る) |
| 画面が古いまま | CloudFront の反映待ち（数分）。ブラウザのキャッシュも削除 |
| API が `403` を返す | CloudFront と Lambda の権限設定が未反映。数分待って再試行、続く場合は `terraform apply` を再実行 |
| `InvalidArgument: ... x-amz-content-sha256 that is not allowed` | オリジンリクエストポリシーにこのヘッダーを入れてはいけない（CloudFront が自動処理）。現行の定義では解消済み |
