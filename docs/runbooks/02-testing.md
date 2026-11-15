# 02. テストとビルド

## 一括実行（CI と同じ）

```bash
npm run typecheck   # 全パッケージの型チェック
npm test            # API と画面のテスト
npm run build       # 画面のビルド（apps/web/dist）
```

GitHub Actions（`.github/workflows/ci.yml`）が push / PR ごとに同じ3つを実行します。

## テストの内訳

| 場所 | 内容 |
| --- | --- |
| `apps/api/test/domain` | 集計（仕様 6.4 の例、全探索との 1 万ケース照合、100人で1秒以内）、回答の検証ルール |
| `apps/api/test/application` | ユースケース（インメモリDB）、トークンの暗号・ハッシュ |
| `apps/api/test/persistence` | 同じユースケースを Postgres（PGlite）で実行、DB 制約、Postgres 回数制限 |
| `apps/api/test/http` | 秘匿性、権限マトリクス（全API自動）、改竄、招待URL、同時実行、回数制限、通しシナリオ、Lambda ハンドラ |
| `apps/web/test` | 画面（招待・回答・作成）、API クライアント、表示文言 |

Postgres のテストは PGlite（プロセス内で動く Postgres）を使うので、DB のインストールは不要です。

## 個別に実行

```bash
npm test -w @himitsu/api                         # API のみ
npm test -w @himitsu/web                         # 画面のみ
cd apps/api && npx vitest run test/http          # ディレクトリ指定
cd apps/api && npx vitest run -t "authorization" # テスト名で絞り込み
```

## Lambda 用バンドルの作成

```bash
npm run build:lambda -w @himitsu/api   # apps/api/dist/lambda/{index.mjs, migrations/}
```

通常はデプロイスクリプトが自動で実行します。
