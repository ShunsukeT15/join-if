# エージェント向けルール（ひみつ出欠）

このリポジトリで作業する AI エージェント（Claude Code ほか）と開発者のための共通ルールです。
迷ったら「秘匿性」「集計の正しさ」を最優先にしてください。このサービスの核です。

## 1. コミュニケーション

- **回答・説明・コミットメッセージ以外の文章はすべて日本語で書く。** ユーザーへの返答、ドキュメント、コード内の UI 文言は日本語。
- コード中の識別子とコメント、コミットメッセージは英語でよい（既存に合わせる）。
- 推測で断定しない。確認できていないこと（実機確認していない、未検証の手順など）はそう書く。

## 2. プロジェクトの前提

- 仕様の元資料: `specs/条件付き出欠アンケート「ひみつ出欠」設計書.md`（**ユーザーの文書。直接編集しない**）
- 仕様からの変更は `docs/IMPLEMENTATION_PLAN.md` の「仕様書からの変更点」と「変更履歴」に記録する
- 進捗は `docs/PROGRESS.md` で管理する。**作業の区切りごとに状態（✅/🚧/⬜/⏸）と作業ログを更新する**
- 手順書は `docs/runbooks/`、入口は `docs/README.md`

## 3. コマンド

| 目的 | コマンド |
| --- | --- |
| 依存のインストール | `npm install` |
| ローカル起動 | `npm run dev:api`（:8787）と `npm run dev:web`（:5173） |
| 型チェック | `npm run typecheck` |
| テスト | `npm test` |
| ビルド | `npm run build` |
| スモークテスト | `npm run smoke -- <URL>` |
| AWS デプロイ | `infra/scripts/deploy.sh` |

**コミット前に `npm run typecheck` と `npm test` を必ず通す。** 失敗したままコミットしない。

## 4. アーキテクチャのルール

```text
apps/api/src
  domain/          集計・検証ルール。フレームワーク・Node API・DB に依存しない
  application/     ユースケース・共通認可・ポート(interface)。Hono/pg に依存しない
  infrastructure/  ポートの実装（memory / postgres / crypto / rateLimit）
  presentation/    HTTP（Hono）。routes.ts のルート定義テーブル
  container.ts     実装の選択はここだけ（composition root）
apps/web           SPA。画面は ApiClient interface にだけ依存する
packages/contracts API の型（web と api で共有）。ランタイム依存を持たない
```

- 依存の向きは `presentation → application → domain`、`infrastructure → application(ports)`。逆向きの import を作らない。
- 新しい実装（DB・回数制限など）はポートを実装し、`container.ts` で選択する。ユースケース側に分岐を書かない。
- 永続化アダプタを追加・変更したら、`test/support/useCaseSuite.ts`（アダプタ契約テスト）をその実装でも実行する。
- API を追加するときは `presentation/http/routes.ts` のテーブルに登録する。個別にルートを書かない（権限テストが自動で対象にする）。
- API の型を変えたら `packages/contracts` を更新し、web と api の両方を直す。

## 5. 秘匿性・セキュリティの不変条件（破ってはいけない）

1. **個別の回答内容（choice・条件・updatedAt・saveCount・claimedAt）は本人にしか返さない。** 管理用 API・他メンバーの応答に含めない。
2. **「行かない」と「条件が合わず不参加」を、画面でも API でも区別しない。** 結果に理由を含めない。
3. **全 API は共通の認可（`application/authorize.ts`）を通す。** 失敗はすべて 404（存在しない場合と区別しない）。
4. **書き込む対象はトークンで決める。** リクエスト本文の memberId などを信用しない。
5. **サーバーが決める値（日時・状態・結果・操作記録）は受け取らない。** 入力スキーマは `z.strictObject` で未定義の項目を 422 にする。
6. **書き込みは `uow.withRoomLock()` の中で行い、操作記録（audit）も同じトランザクションで書く。**
7. トークンは推測できない乱数。サーバーにはハッシュ（招待のみ暗号文も）しか保存しない。専用トークンは保存しない。
8. トークンは URL の `#` 以降に置き、ヘッダーで送る。ログ・URL パラメータ・エラーメッセージにトークンや回答を出さない。
9. 名前・メッセージは常にテキストとして表示する（`dangerouslySetInnerHTML` を使わない）。
10. ブラウザに DB の接続情報やキーを渡さない。

これらに関わる変更をしたら、`apps/api/test/http/security.test.ts` が通ることを確認し、必要ならテストを追加する。

## 6. 集計ロジックのルール

- 条件付き回答は「パターンの OR」。1パターン＝「選んだ人のうち N 人以上」AND「自分以外 M 人以上」。最大 5 パターン。
- **条件は単調（参加者が増えて成立しなくなることがない）でなければならない。** 「X が来るなら行かない」のような否定条件を追加すると、最大の組み合わせが一意でなくなり集計方法が成り立たない。追加する場合はユーザーと仕様を決めてから。
- `domain/solver.ts` を変えたら、`test/domain/solver.test.ts` の全探索照合（1万ケース、最大の一意性も確認）を通す。
- 未回答は不参加。削除されたメンバーは「来ない人」として扱う。

## 7. データベースのルール

- スキーマ変更は `apps/api/src/infrastructure/persistence/postgres/migrations/NNN_*.sql` を**追加**する。適用済みのファイルは編集しない。
- マイグレーションは既存データを移行する（例: 003 は旧形式の回答を1パターンに変換）。移行のテストを書く。
- DB 側の制約・トリガー（100人上限、同ルーム制約など）はアプリの検証と二重にする。どちらか片方だけにしない。
- 新しいテーブルには RLS を有効化し、`anon` / `authenticated` から `REVOKE` する（001 の書き方に合わせる）。
- マイグレーションは前進のみ。列の削除・変更は、旧コードとの互換性とロールバック手順を考えてから。

## 8. インフラ・デプロイのルール（AWS）

- インフラは `infra/terraform` の Terraform だけで変更する。AWS コンソールで手動変更しない（次の apply で戻る／差分になる）。
- **`random_bytes.token_enc_key` を作り直さない（taint / replace 禁止）。** 未使用の招待URLが表示できなくなる。
- `terraform apply` の前に `plan` を確認し、**既存リソースの変更・削除が意図どおりか**を見る。同じアカウントに他プロジェクトのリソースがある。
- Terraform state（`infra/terraform/terraform.tfstate`）には秘密情報が平文で入る。Git に入れない・外部に送らない。
- 本番へのデプロイ・リソースの作成削除・費用が発生する操作は、**ユーザーの明示的な指示があるときだけ**行う。
- デプロイ後は `npm run smoke -- "$(terraform -chdir=infra/terraform output -raw site_url)"` で確認する。
- 本番データは障害対応以外で見ない（仕様 9.1）。動作確認は新しいテスト用ルームで行う。

## 9. Git のルール

- 意味のある単位でこまめにコミットする（ユーザーの方針）。push はユーザーの指示があるときだけ。
- コミットメッセージは英語で、`feat(api): ...` / `fix(web): ...` / `docs: ...` / `feat(infra): ...` の形式。
- `.env`・`*.tfstate`・`*.tfvars`・ビルド成果物をコミットしない（`.gitignore` 済み。`git status` で確認）。

## 10. ドキュメントのルール

- 手順・設定・運用が変わったら、同じ変更で `docs/runbooks/` と `docs/runbooks/env-reference.md` を更新する。
- 新しい環境変数を追加したら `.env.example` と `env-reference.md` の両方に書く。
- 費用に影響する構成変更をしたら `docs/AWS_COST_ESTIMATE.md` を更新する。
- 手順書に書くコマンドは、可能な範囲で実際に実行して確認してから書く。未検証ならそう明記する。
