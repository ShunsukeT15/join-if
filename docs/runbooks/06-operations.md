# 06. 運用

## ログを見る

アプリはルート名とエラー種別だけを出力し、回答内容・トークンはログに出しません。

```bash
aws logs tail /aws/lambda/himitsu-prod-api --follow           # リアルタイム
aws logs tail /aws/lambda/himitsu-prod-api --since 1h --filter-pattern '"failed"'
```

| ログ | 意味 |
| --- | --- |
| `[api] POST /api/rooms failed: ...` | 想定外のエラー（利用者には 500）。原因調査が必要 |
| `[purge] {"rooms":N,"rateLimits":M}` | 日次の自動削除の結果 |
| `Task timed out after 15.00 seconds` | DB 接続不可などで応答できない。RDS の状態を確認 |

## 状態の確認

```bash
aws rds describe-db-instances --db-instance-identifier himitsu-prod-db \
  --query 'DBInstances[0].DBInstanceStatus' --output text          # available
aws lambda get-function --function-name himitsu-prod-api \
  --query 'Configuration.[State,LastUpdateStatus]' --output text   # Active Successful
```

## 定期処理

| 処理 | タイミング | 手動実行 |
| --- | --- | --- |
| 期限切れルームの削除（締切90日後 / 未締切1年後）と回数制限カウンタの掃除 | 毎日 03:17 JST（EventBridge） | 下記 |
| RDS の自動バックアップ（7日保持） | 毎日 03:00〜03:30 JST | — |
| RDS のマイナーバージョン更新 | 日曜 04:00〜04:30 JST | — |

```bash
aws lambda invoke --function-name himitsu-prod-api --cli-binary-format raw-in-base64-out \
  --payload '{"action":"purge"}' /dev/stdout
```

## データベースへのアクセス

RDS はプライベートサブネットにあり、インターネットからは接続できません（設計どおり）。
運用者は仕様 9.1 のとおり**障害対応以外では本番データを開きません**。

どうしても SQL を実行する必要がある場合の選択肢（いずれも一時的に用意して、終わったら削除する）:

- AWS CloudShell の VPC 環境を `himitsu-prod-vpc` に作成し、`himitsu-prod-lambda` セキュリティグループを付けて `psql` で接続
- 接続情報は `terraform -chdir=infra/terraform state show aws_db_instance.main` と Lambda の環境変数 `DATABASE_URL`

## 秘密情報

| 値 | 保管場所 | 変更してよいか |
| --- | --- | --- |
| トークン暗号鍵 `TOKEN_ENC_KEY` | Terraform state / Lambda 環境変数 | **変更しない**。変えると未使用の招待URLが管理画面に出せなくなる |
| DB パスワード | Terraform state / Lambda 環境変数 | 変更可（下記） |
| オリジン検証ヘッダーの値 | Terraform state / Lambda 環境変数 / CloudFront | 変更可（下記） |

```bash
cd infra/terraform
# DB パスワードの変更（RDS と Lambda の両方が更新される。数十秒エラーになり得る）
terraform apply -replace=random_password.db
# オリジン検証値の変更（CloudFront の反映まで数分 404 になり得る）
terraform apply -replace=random_password.origin_verify
```

## 障害対応の目安

| 症状 | 確認すること |
| --- | --- |
| 画面が開かない | CloudFront の状態、S3 に `index.html` があるか（`aws s3 ls s3://himitsu-prod-web-<ID>/`） |
| 画面は開くが「エラーが発生しました」 | Lambda のログ。`Task timed out` なら RDS の状態 |
| 全員に 429 が出る | 回数制限。同じ接続元から大量アクセスがないかログを確認 |
| 「ページが見つかりません」と問い合わせ | 招待URLの再発行・メンバー削除・ルームの自動削除のいずれか。管理側で再発行してもらう |
| 費用が想定より高い | Cost Explorer でタグ `Project=himitsu-shukketsu` を絞り込み。RDS 以外が増えていないか |

## DB の復元（障害時）

RDS の自動バックアップから、指定日時の状態を **別インスタンスとして** 復元できます（元のインスタンスはそのまま残ります）。

```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier himitsu-prod-db \
  --target-db-instance-identifier himitsu-prod-db-restored \
  --restore-time 2026-11-20T03:00:00Z \
  --db-subnet-group-name himitsu-prod-db \
  --vpc-security-group-ids <himitsu-prod-db の SG ID> \
  --no-publicly-accessible
```

復元したインスタンスへの切り替えは Terraform の管理対象の入れ替えを伴うため、実施前に手順を検証してください
（復元先のエンドポイントを確認し、データを確認した上で、Terraform 側に取り込むか元のインスタンスへ戻す）。

## 環境の削除

```bash
cd infra/terraform
terraform apply   -var db_deletion_protection=false   # 削除保護を外す
terraform destroy -var db_deletion_protection=false   # 最終スナップショット himitsu-prod-db-final が残る
```

最終スナップショットにはストレージ料金（約 0.095 USD/GB-月）がかかります。不要なら RDS コンソールから削除してください。
Terraform で作成した全リソース（ロググループ・S3 の中身を含む）が削除されます。
