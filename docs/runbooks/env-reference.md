# 環境変数・設定一覧

## API（`apps/api/.env` / Lambda の環境変数）

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `PORT` | `8787` | ローカル起動時のポート（Lambda では未使用） |
| `DATA_STORE` | `memory` | `memory` または `postgres` |
| `DATABASE_URL` | — | `postgres` のとき必須。`postgres://user:pass@host:5432/db` |
| `DB_SSL` | 自動（Supabase のみ `require`） | `off` / `require`（暗号化のみ）/ `verify`（証明書も検証） |
| `DB_POOL_MAX` | `10` | DB 接続数の上限。Lambda では `2` |
| `TOKEN_ENC_KEY` | — | 招待トークン暗号化の鍵（32バイト base64）。`postgres` では必須。`npm run gen-key -w @himitsu/api` で生成。**一度決めたら変えない** |
| `RATE_LIMIT` | `memory` | `memory`（プロセス内）/ `postgres`（全インスタンス共有）/ `off`（開発用） |
| `CORS_ORIGINS` | `http://localhost:5173` | 画面と API が別オリジンのとき、画面のオリジンをカンマ区切りで。同一オリジンなら空 |
| `TRUST_PROXY` | `false` | `true` なら `X-Forwarded-For` を接続元として使う（ローカル起動時のみ） |
| `PURGE_INTERVAL_MS` | `21600000`（6時間） | ローカル起動時の自動削除の間隔（Lambda では EventBridge が実行） |
| `ORIGIN_VERIFY_SECRET` | — | 設定すると、`ORIGIN_VERIFY_HEADER` にこの値がないリクエストを 404 にする |
| `ORIGIN_VERIFY_HEADER` | `X-Origin-Verify` | 上記のヘッダー名 |
| `NODE_EXTRA_CA_CERTS` | — | Lambda では `/var/runtime/ca-cert.pem`（RDS の CA を信頼するため） |

AWS では Lambda の環境変数を Terraform（`infra/terraform/api.tf`）が設定します。手で変更しないでください（次の apply で戻ります）。

## 画面（`apps/web/.env`、ビルド時に埋め込み）

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | 空（同一オリジン） | API のオリジン。CloudFront 構成では空 |
| `VITE_DEV_API_PROXY` | `http://localhost:8787` | 開発サーバーが `/api` を転送する先 |

## Terraform の変数

`infra/terraform/terraform.tfvars`（Git 管理外）で上書きします。

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `region` | `ap-northeast-1` | リージョン |
| `env` | `prod` | リソース名の環境名 |
| `vpc_cidr` | `10.40.0.0/16` | VPC の CIDR |
| `db_instance_class` | `db.t4g.micro` | RDS のサイズ |
| `db_engine_version` | `17` | PostgreSQL のメジャーバージョン |
| `db_allocated_storage_gb` | `20` | RDS のストレージ |
| `db_backup_retention_days` | `7` | 自動バックアップの保持日数 |
| `db_deletion_protection` | `true` | RDS の削除保護 |
| `lambda_memory_mb` | `512` | Lambda のメモリ |
| `lambda_runtime` | `nodejs22.x` | Lambda のランタイム |
| `log_retention_days` | `14` | ログの保持日数 |
| `budget_alert_email` | `""` | 予算アラートの通知先（空なら作らない） |
| `monthly_budget_usd` | `40` | 月額予算 |
| `github_repository` | `ShunsukeT15/join-if` | 画面の自動デプロイを許可する GitHub リポジトリ |
| `github_oidc_repository` | `ShunsukeT15@84225335/join-if@1458620122` | GitHub の OIDC トークンに入るリポジトリの表記（`所有者@ID/リポジトリ@ID`）。ロールの引き受け条件に使う |
| `github_deploy_branch` | `main` | 自動デプロイを許可するブランチ |
| `create_github_oidc_provider` | `true` | アカウントに GitHub の OIDC プロバイダーがすでにある場合は `false` |
| `budget_alert_threshold_percent` | `100` | 予測・実績が予算のこの割合を超えたら通知 |

## Terraform の出力

```bash
terraform -chdir=infra/terraform output
```

| 出力 | 内容 |
| --- | --- |
| `site_url` | 公開 URL |
| `cloudfront_distribution_id` | キャッシュ削除などに使う ID |
| `web_bucket` | 画面ファイルの S3 バケット |
| `api_function_name` | Lambda 関数名 |
| `db_endpoint` | RDS のエンドポイント（VPC 内からのみ到達可能） |
| `github_web_deploy_role_arn` | GitHub Actions が引き受ける IAM ロール |
