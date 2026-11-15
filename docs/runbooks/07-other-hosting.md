# 07. AWS 以外で動かす場合（参考）

API・画面・DB はそれぞれ独立しているので、AWS 以外の組み合わせでも動きます。

| 層 | 例 | 設定 |
| --- | --- | --- |
| 画面 | Vercel / Cloudflare Pages / Netlify（静的） | `npm run build -w @himitsu/web` → `apps/web/dist`。SPA なので全パスを `index.html` にリライト。API が別オリジンなら `VITE_API_BASE_URL` に API のオリジン |
| API | Fly.io / Render / Cloud Run など Node が動く環境 | `npm start -w @himitsu/api`。`DATA_STORE=postgres`・`DATABASE_URL`・`TOKEN_ENC_KEY`・`CORS_ORIGINS`（画面のオリジン）・プロキシ配下なら `TRUST_PROXY=true` |
| DB | Supabase（開発用と本番用で別プロジェクト） | `npm run migrate -w @himitsu/api` |

注意点:

- 静的ホスティング側で `Referrer-Policy: no-referrer` を付けてください（`index.html` にも meta あり。CSP の meta はビルド時に自動付与）。
- API を複数台で動かすときは `RATE_LIMIT=postgres` にして、回数制限を全台で共有してください。
- Supabase の場合、マイグレーションで RLS の有効化と `anon` / `authenticated` からの `REVOKE ALL` が適用されます。API はテーブル所有者（service_role 相当）の接続文字列で接続し、ブラウザには Supabase のキーを渡しません。
- 常駐プロセスがない（サーバーレス）環境では、自動削除を `apps/api/src/infrastructure/persistence/postgres/supabase/purge_cron.sql`（pg_cron）で実行してください。
- 設定値は [env-reference.md](./env-reference.md)。
