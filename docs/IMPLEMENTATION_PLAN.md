# 実装計画書 — ひみつ出欠

元仕様: [specs/条件付き出欠アンケート「ひみつ出欠」設計書.md](../specs/条件付き出欠アンケート「ひみつ出欠」設計書.md)
進捗表: [PROGRESS.md](./PROGRESS.md)

## 1. 方針

仕様書の要件（秘匿性・権限・集計の正しさ）はそのまま守りつつ、以下の追加要求に合わせて構成を変える。

- **フロントとサーバーを分離する**（仕様書は Next.js 一体型 → 本計画では SPA と API サーバーに分離）
- **各層を置き換え可能にする**（DB・暗号・回数制限・HTTP フレームワーク・画面の API クライアント）

### 仕様書からの変更点

| 仕様書 | 本計画 | 理由 |
| --- | --- | --- |
| Next.js（App Router）で画面と API を一体化 | 画面: Vite + React SPA / API: Hono（Node.js） | フロントとサーバーの分離。どちらも単独でデプロイ可能 |
| 集計は PostgreSQL 関数 `close_room` | 集計はサーバーのドメイン層（TypeScript）で実行。DB には結果だけ書く | DB を置き換え可能にするため。**集計はサーバー内で行い、回答をブラウザに送らない原則は維持** |
| PL/pgSQL 版と TS 版の一致テスト | TS 版を全探索（12人以下）と 1 万ケース照合 | 集計ロジックが 1 実装になったため |
| 書き込みはDB関数にまとめてトランザクション化 | アプリケーション層の `UnitOfWork.withRoomLock()` でトランザクション＋ルームロック | DB 非依存にするため。Postgres 実装では `SELECT ... FOR UPDATE` |
| `pg_cron` で自動削除 | API プロセス内のスケジューラで `PurgeExpiredRooms` を定期実行（Supabase では pg_cron 用 SQL も同梱） | DB 非依存 |
| `server-only` によるキー混入防止 | フロントとサーバーが別パッケージなので、フロントには DB コードが物理的に存在しない | 構成上不要になる |

## 2. アーキテクチャ

```text
┌─────────────── apps/web (Vite + React SPA) ───────────────┐
│ pages/ ─→ hooks/ ─→ api/ApiClient (interface)              │
│                         └─ HttpApiClient (fetch 実装)       │
│ lib/tokenStore (localStorage, 失敗時は無効化)               │
└───────────────────────────┬───────────────────────────────┘
                            │ HTTPS / JSON
                            │ X-Admin-Token / X-Invite-Token / X-Member-Token
┌───────────────────────────▼──────── apps/api ─────────────┐
│ presentation/http  (Hono)                                  │
│   routes 定義テーブル → 共通認可 → zod(strict) → use case    │
│   エラー変換 / 回数制限ミドルウェア / セキュリティヘッダー     │
│ application                                                │
│   use cases (CreateRoom, ClaimInvite, SaveAnswer, CloseRoom…)│
│   authorize() … 全APIで共通の認可処理                        │
│   ports: UnitOfWork / Repositories / TokenService /          │
│          Clock / RateLimiter / IdGenerator                   │
│ domain                                                       │
│   solver（集計）/ 回答の検証ルール / エラー型 / 定数          │
│ infrastructure (adapters)                                    │
│   persistence/memory     … 開発・テスト用                     │
│   persistence/postgres   … Postgres / Supabase（pg ドライバ） │
│   crypto/nodeTokenService … 乱数・SHA-256・AES-256-GCM        │
│   rateLimit/memory       … 固定ウィンドウ                     │
│ main.ts (composition root) … 環境変数で実装を選ぶ             │
└────────────────────────────────────────────────────────────┘
packages/contracts … API のリクエスト/レスポンス型（web と api で共有）
```

依存の向き: `presentation → application → domain`、`infrastructure → application(ports)`。
domain / application は Hono・pg・Node の crypto に依存しない。

### 置き換えポイント

| 層 | ポート（interface） | 実装 | 切り替え |
| --- | --- | --- | --- |
| DB | `UnitOfWork`（中に各 Repository） | memory / postgres | `DATA_STORE` |
| トークン | `TokenService` | Node crypto | composition root |
| 回数制限 | `RateLimiter` | memory（将来 Redis） | composition root |
| 時刻 | `Clock` | system / テスト用固定 | テスト |
| HTTP | use case は Hono 非依存 | Hono | `presentation` だけ差し替え |
| 画面の通信 | `ApiClient` | fetch 実装 / テスト用モック | `ApiProvider` |

### トランザクションとロック

`UnitOfWork.withRoomLock(roomId, fn)` … ルーム単位で直列化して `fn(tx)` を実行する。
- memory: ルームIDごとの Promise チェーン（ミューテックス）。失敗時はスナップショットに巻き戻す
- postgres: `BEGIN` → `SELECT ... FROM rooms WHERE id=$1 FOR UPDATE` → `fn` → `COMMIT`（例外で `ROLLBACK`）

変更と操作記録（audit_events）は同じ `tx` で書くので、片方だけ残ることはない。

## 3. リポジトリ構成

```text
/apps
  /api
    /src
      /domain           solver.ts, answerRules.ts, errors.ts, constants.ts, types.ts
      /application
        /ports          UnitOfWork, repositories, TokenService, Clock, RateLimiter
        /usecases       各ユースケース
        authorize.ts    共通認可
      /infrastructure
        /persistence/memory
        /persistence/postgres  (+ migrations/*.sql)
        /crypto
        /rateLimit
      /presentation/http  app.ts, routes.ts, schemas.ts, errors.ts, middleware
      main.ts / container.ts
    /test               unit / http / persistence(契約テスト)
  /web
    /src  api/ pages/ components/ lib/ styles/
/packages
  /contracts            API DTO 型
/docs                   本計画書・進捗表・運用メモ
/specs                  元仕様
```

## 4. フェーズ別の作業

### フェーズ 0: 基盤
- npm workspaces、TypeScript（strict）、Vitest、共通 tsconfig
- GitHub Actions（型チェック・テスト・ビルド）
- `.gitignore`、README（起動方法）

### フェーズ 1: ドメインと集計
- 型定義（Room / Member / Answer / Result / AuditEvent）
- `solve()`：仕様 6.2 の不動点反復
- 回答の検証ルール（5.4・7.3：自分を選ばない、N の範囲、M の範囲、同ルームのみ、条件最低1つ）
- テスト：6.4 の計算例、全探索（12人以下）との 1 万ケース照合、100人で 1 秒以内

### フェーズ 2: アプリケーション層とインメモリ実装
- ポート定義、`authorize()`（8.6 の 1〜3）
- ユースケース 11 本（8.1 に対応）＋ `PurgeExpiredRooms`
  - CreateRoom / GetAdminView / UpdateSettings / AddMember / RemoveMember / ReissueInvite / CloseRoom / ReopenRoom / ClaimInvite / GetMemberView / SaveAnswer
- 状態チェック（8.6 の 4）、上限 100 人、名前重複、`conditionNotice`、`saveCount`
- トークン（256bit 乱数・SHA-256・AES-256-GCM）
- インメモリ永続化

### フェーズ 3: HTTP API
- ルート定義テーブル（認可種別を宣言）→ 共通処理で認可・検証
- zod `.strict()` で未定義項目は 422
- エラー変換（404/409/410/422/429）、`Referrer-Policy: no-referrer`、CORS（許可オリジンを環境変数で）
- 回数制限（8.5）
- テスト
  - 秘匿性：管理用・他メンバーの応答に他人の choice/条件/updatedAt/saveCount が含まれない
  - 「行かない」と「条件が合わず不参加」で応答が完全一致
  - 権限：ルート定義テーブルの全 API × {なし, 別種類, 別ルーム, 別ルームの memberId} → 拒否＆データ不変（API を足すと自動で対象）
  - 改竄：本文に memberId/updatedAt/status/attending → 422 かつ不変
  - 招待：2回目 410、同時有効化で成功 1 件、再発行後は旧専用トークン 404・回答削除
  - 締め切りと回答保存の同時実行

### フェーズ 4: Postgres 実装
- マイグレーション SQL（5 テーブル、CHECK、一意制約、ON DELETE CASCADE、100人トリガー、RLS 有効化、anon/authenticated の REVOKE）
- Postgres 用 Repository / UnitOfWork（`FOR UPDATE`）
- マイグレーション実行スクリプト
- 契約テスト：同じテストスイートを memory と postgres（PGlite）の両方で実行
- Supabase 向け pg_cron SQL（任意）

### フェーズ 5: 画面
- デザイン: 調整さん/walica 風。白基調・1 カラム・カード・大きめのボタン、スマホ優先
- トップ（作成フォーム → 管理用URL保存案内）
- 管理（設定編集、メンバー追加/削除/再発行確認、招待URL・案内文コピー、回答状況、締め切り確認（未回答数）、再開、結果）
- 招待（有効化 → 専用URL保存 → 回答画面へ / 使用済み案内 / 保存済みなら移動）
- 回答（3択、条件入力（人物・N、人数・M）、注意書き常時表示、更新日時・保存回数・有効化日時、条件見直し通知、結果）
- エラー画面、通信エラー表示
- 名前・メッセージは常にテキスト表示（React の既定エスケープ、`dangerouslySetInnerHTML` 不使用）

### フェーズ 6: 仕上げ
- 通しテスト（API レベルのシナリオテスト。ブラウザ E2E は環境が整えば Playwright）
- ブラウザでの動作確認
- 利用規約・プライバシーポリシーの雛形ページ
- デプロイ手順（API: 任意の Node ホスト / Web: 静的ホスティング / DB: Supabase）

## 5. 完了の判定

| フェーズ | 条件 |
| --- | --- |
| 0 | `npm test` と `npm run typecheck` が通る。CI 定義がある |
| 1 | 計算例テストと全探索 1 万ケース照合が全て一致 |
| 2 | ユースケースの単体テストが通る |
| 3 | 秘匿性・権限・改竄・招待URL・同時実行テストが全て通る |
| 4 | 同じ契約テストが memory / postgres 両方で通る |
| 5 | 全画面がスマホ幅で操作でき、作成→招待→回答→締切→結果が通る |
| 6 | 通しテストが通り、起動手順どおりに動く |

## 6. 未決事項の扱い（MVP）

仕様書 11 章のとおり。#3 回数制限はポート化してまずインメモリ実装（単一インスタンス前提）。複数インスタンス時は Redis 等の実装を追加する。
