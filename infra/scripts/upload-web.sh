#!/usr/bin/env bash
# Uploads the built SPA (apps/web/dist) to S3 and invalidates CloudFront.
# Used by deploy.sh (manual) and .github/workflows/deploy-web.yml (CI/CD).
#   infra/scripts/upload-web.sh <bucket> <distribution-id>
set -euo pipefail

BUCKET="${1:?usage: upload-web.sh <bucket> <distribution-id>}"
DIST="${2:?usage: upload-web.sh <bucket> <distribution-id>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WEB="${ROOT}/apps/web/dist"

[ -f "${WEB}/index.html" ] || { echo "error: ${WEB}/index.html がありません。先に npm run build -w @himitsu/web を実行してください" >&2; exit 1; }

echo "==> Uploading web to s3://${BUCKET}"
# Hashed assets first (long cache), then index.html and the rest (no-cache), so a
# new index.html never points at assets that are not uploaded yet.
aws s3 sync "${WEB}/assets" "s3://${BUCKET}/assets" \
  --cache-control "public, max-age=31536000, immutable" >/dev/null
aws s3 sync "${WEB}" "s3://${BUCKET}" --delete --exclude "assets/*" \
  --cache-control "no-cache" >/dev/null
# Remove assets no longer referenced by the new build.
aws s3 sync "${WEB}/assets" "s3://${BUCKET}/assets" --delete \
  --cache-control "public, max-age=31536000, immutable" >/dev/null

echo "==> Invalidating CloudFront"
aws cloudfront create-invalidation --distribution-id "${DIST}" --paths "/index.html" "/" >/dev/null
echo "==> Web uploaded"
