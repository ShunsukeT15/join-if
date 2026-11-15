# 05. 動作確認

デプロイ後（またはローカル起動後）に行う確認です。

## 1. 自動スモークテスト（約10秒）

```bash
# AWS
npm run smoke -- "$(terraform -chdir=infra/terraform output -raw site_url)"
# ローカル（API に直接）
npm run smoke -- http://localhost:8787
```

`ALL CHECKS PASSED` で成功（終了コード 0）。確認している内容:

| 確認項目 | 期待値 |
| --- | --- |
| API に到達できる | 未定義パスで 404 の JSON |
| ルーム作成 | 201、`Referrer-Policy: no-referrer` |
| メンバー追加・招待URLの有効化 | 201 / 200 |
| 招待URLの2回目 | 410（使用済み） |
| 回答保存（条件付き・行く） | 200、保存回数 1 |
| 管理画面・他メンバーの応答に回答内容がない | `choice` を含まない |
| 締め切り | 2人とも参加 |
| 締め切り後の保存 | 409 |
| 誤った管理トークン | 404 |
| 定義にない項目 | 422 |
| SPA の直リンク | `index.html`（AWS のみ） |

> スモークテストは `[smoke] <日時>` という名前のルームを1つ作って締め切ります。締め切りから90日で自動削除されます。

## 2. 画面の手動確認（初回・大きな変更時）

スマートフォンでの確認を推奨します（iPhone Safari / Android Chrome / LINE 内ブラウザ）。

### 招待側
- [ ] トップでルームを作成すると「管理用URLを必ず保存してください」と URL が表示される
- [ ] メンバーを追加すると「案内文をコピー」「URLのみ」が表示され、コピーできる
- [ ] イベント情報を編集・保存できる

### メンバー
- [ ] 招待URLを開くと回答画面に切り替わり、「あなた専用の回答用URLを発行しました」が表示される
- [ ] 同じブラウザで招待URLを開き直すと、回答画面に移動する
- [ ] 別のブラウザ（またはシークレットウィンドウ）で同じ招待URLを開くと「このURLは使用済みです」が表示される
- [ ] 「条件付きで行く」で人を選ぶと「〇〇さんが来るなら行く」と要約が出て、保存できる
- [ ] 保存後に「回答済み（最終更新：…、保存 1 回）」「このURLは … に有効化されました」が表示される
- [ ] LINE 内ブラウザで有効化した後、回答用URLをコピーして Safari / Chrome で開ける

### 招待側（続き）
- [ ] 管理画面でメンバーが「回答済み」「招待URL 使用済み」になる。回答内容は表示されない
- [ ] 再発行を押すと確認ダイアログに「この人の回答は削除され…」が表示され、実行後は古い回答用URLが「ページが見つかりません」になる
- [ ] 締め切ると未回答の人数が確認ダイアログに出て、実行後に参加・不参加の結果が全員の画面に出る
- [ ] 受付を再開すると結果が消え、回答は残っている

## 3. インフラの確認（AWS、初回のみ）

```bash
cd infra/terraform

# Lambda の URL を直接叩いても拒否される（403）
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$(aws lambda get-function-url-config \
  --function-name himitsu-prod-api --query FunctionUrl --output text)api/rooms"

# RDS が外部に公開されていない・暗号化されている（False / True）
aws rds describe-db-instances --db-instance-identifier himitsu-prod-db \
  --query 'DBInstances[0].[PubliclyAccessible,StorageEncrypted]' --output text

# セキュリティヘッダー
curl -sI "$(terraform output -raw site_url)/" | grep -iE 'referrer-policy|strict-transport|content-security'

# 設定と実環境に差分がない
terraform plan -detailed-exitcode    # "No changes." なら OK
```
