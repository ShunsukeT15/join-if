# AWS へのデプロイ

Terraform: [`infra/terraform`](../infra/terraform) / デプロイスクリプト: [`infra/scripts/deploy.sh`](../infra/scripts/deploy.sh)
コスト試算: [AWS_COST_ESTIMATE.md](./AWS_COST_ESTIMATE.md)

## 構成

```text
ブラウザ ──HTTPS──▶ CloudFront（1つのドメイン）
                     ├─ /*      → S3（SPA。非公開バケット、OAC）
                     │            CloudFront Function で拡張子なしのパスを /index.html に
                     └─ /api/*  → Lambda Function URL（AWS_IAM 認証、CloudFront OAC で署名）
                                   + X-Origin-Verify ヘッダー（二重チェック）
                                   │
                         ┌──────── VPC（プライベートサブネットのみ、NAT なし）────────┐
                         │  Lambda (Node.js, arm64) ──TLS(検証あり)──▶ RDS PostgreSQL │
                         └──────────────────────────────────────────────────────────┘
EventBridge（毎日 03:17 JST）→ Lambda { action: "purge" }（期限切れルームと回数制限の掃除）
```

| 仕様上の要件 | AWS での実現 |
| --- | --- |
| ブラウザに DB のキーを渡さない | DB はプライベートサブネットのみ。ブラウザは CloudFront 経由の API しか触れない |
| トークンは `#` 以降・Referrer を残さない | CloudFront のレスポンスヘッダーポリシーで `Referrer-Policy: no-referrer`、CSP、HSTS |
| 回数制限（接続元ごと） | `CloudFront-Viewer-Address`（偽装不可）を接続元とし、Postgres で全 Lambda 共通に数える |
| 自動削除 | EventBridge の日次スケジュール |
| RLS / REVOKE | マイグレーションに含む（RDS では anon ロールがないため REVOKE はスキップされる） |
| ログに回答・トークンを残さない | アプリはルート名とエラー種別のみ出力。RDS は `log_statement=none` |

## 初回デプロイ

前提: AWS CLI（認証済み）、Terraform 1.6+、Node.js 24。

```bash
npm ci
infra/scripts/deploy.sh            # 内容を確認して yes
# または infra/scripts/deploy.sh -auto-approve
```

スクリプトの流れ: API を Lambda 用にバンドル → `terraform apply` → マイグレーション実行（Lambda を `{"action":"migrate"}` で起動）→ SPA をビルドして S3 にアップロード → CloudFront のキャッシュ削除。
最後に表示される `https://xxxx.cloudfront.net` が公開 URL です。

## 更新

コードを変えたら同じく `infra/scripts/deploy.sh` を実行します。Lambda のコードは zip のハッシュが変わったときだけ更新されます。

## 秘密情報と Terraform state

- DB パスワード・トークン暗号鍵・オリジン検証ヘッダーは Terraform が生成し、Lambda の環境変数（KMS で暗号化）に入ります。
- これらは **Terraform state に平文で入ります**。`infra/terraform/terraform.tfstate` は Git に入れず（.gitignore 済み）、共有する場合は暗号化した S3 バックエンドに移してください（`versions.tf` にコメントあり）。
- **トークン暗号鍵（`random_bytes.token_enc_key`）を作り直すと、未使用の招待URLが管理画面で表示できなくなります。** taint / replace しないでください。

## 運用

```bash
# ログ（回答内容・トークンは出ません）
aws logs tail /aws/lambda/himitsu-prod-api --follow

# 手動で自動削除を実行
aws lambda invoke --function-name himitsu-prod-api --cli-binary-format raw-in-base64-out \
  --payload '{"action":"purge"}' /dev/stdout
```

## 削除（環境ごと消す）

RDS は削除保護が有効です。

```bash
cd infra/terraform
terraform apply -var db_deletion_protection=false   # 保護を外す
terraform destroy -var db_deletion_protection=false # 最終スナップショット himitsu-prod-db-final が残る
```

最終スナップショットはストレージ料金（約 0.095 USD/GB-月）がかかるため、不要なら RDS コンソールから削除してください。

## 今後の改善候補

- 独自ドメイン（Route 53 + ACM（us-east-1）を CloudFront に設定）
- Terraform state の S3 バックエンド化
- アプリ用の DB ユーザーを管理ユーザーと分ける（最小権限）
- CloudWatch アラーム（Lambda エラー率、RDS の CPU / 空き容量）
