# 03. AWS 環境の事前準備（初回のみ）

デプロイの前に一度だけ行う作業です。

## チェックリスト

- [ ] AWS CLI v2 をインストールし、デプロイ用の認証情報を設定した
- [ ] Terraform 1.6 以上をインストールした
- [ ] デプロイ先のアカウント・リージョン（既定 `ap-northeast-1`）を確認した
- [ ] （推奨）予算アラートのメールアドレスを `terraform.tfvars` に設定した
- [ ] （推奨）コスト配分タグ `Project` を有効化した
- [ ] （チーム運用時）Terraform state の保存先を決めた

## まとめて実行する場合

```bash
npm run doctor                                        # 足りないものと直し方が表示される
npm run setup:aws -- --budget-email you@example.com   # コスト配分タグの有効化 + 予算アラートの通知先（初回のみ）
```

`setup:aws` は AWS アカウントの設定（コスト配分タグ）を変更します。メールアドレスは `terraform.tfvars`（Git 管理外）に書き込まれ、次の `npm run release` で予算アラートが作成されます。**AWS から届く購読確認メールの承認だけは手作業**です。

以下は個別に行う場合の手順です。

## 1. ツールのインストール

```bash
# macOS（Homebrew）
brew install awscli
brew tap hashicorp/tap && brew install hashicorp/tap/terraform

aws --version        # aws-cli/2.x
terraform -version   # Terraform v1.6 以上
```

## 2. AWS の認証情報

デプロイには、VPC・RDS・Lambda・IAM ロール・CloudFront・S3・EventBridge・Budgets を作成できる権限が必要です
（現在の環境は `AdministratorAccess` を持つ IAM ユーザーで実施）。

```bash
aws configure                     # または aws configure --profile himitsu
aws sts get-caller-identity       # デプロイ先のアカウントIDを必ず確認
```

プロファイルを分けた場合は、以降のコマンドの前に `export AWS_PROFILE=himitsu` を実行します。

> 同じアカウントで他のプロジェクトも動いている場合でも、このプロジェクトのリソースはすべて `himitsu-prod-*` という名前と
> タグ `Project=himitsu-shukketsu` で区別されます。`terraform plan` で既存リソースの変更・削除が 0 件であることを確認してから適用してください。

## 3. Terraform の変数（任意）

```bash
cd infra/terraform
cp example.tfvars terraform.tfvars   # Git には入りません
```

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `budget_alert_email` | `""` | 設定すると月額予算アラート（80%超過の予測でメール）を作成 |
| `monthly_budget_usd` | `40` | 予算額 |
| `db_deletion_protection` | `true` | RDS の削除保護。環境を消すときだけ `false` |
| `env` | `prod` | リソース名に入る環境名。別環境を作るなら変更（state も分ける） |

その他は [env-reference.md](./env-reference.md#terraform-の変数)。

予算アラートを設定すると、AWS から購読確認メールが届くので承認してください。

## 4. コスト配分タグの有効化（推奨）

このプロジェクト分の費用だけを Cost Explorer や予算で絞り込めるようにします。初回デプロイでタグ付きリソースができた後に実行します（反映まで最大24時間）。

```bash
aws ce update-cost-allocation-tags-status \
  --cost-allocation-tags-status TagKey=Project,Status=Active
```

## 5. Terraform state について

state には **DB パスワード・トークン暗号鍵・オリジン検証用の秘密値が平文で入ります**。

- 既定ではローカルの `infra/terraform/terraform.tfstate`（`.gitignore` 済み）。**この端末以外ではデプロイできず、紛失すると Terraform で管理できなくなります。** 定期的に安全な場所へバックアップしてください。
- 複数人・複数端末で運用する場合は、暗号化・バージョニングを有効にした S3 バケットに移します（`infra/terraform/versions.tf` の `backend "s3"` のコメントを外し、`terraform init -migrate-state`）。

## 6. 無料利用枠の確認

RDS の無料枠はアカウント作成時期で異なります。Billing コンソールの「無料利用枠」で確認してください。
費用の詳細は [AWS_COST_ESTIMATE.md](../AWS_COST_ESTIMATE.md)。
