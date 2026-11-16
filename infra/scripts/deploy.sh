#!/usr/bin/env bash
# Builds and deploys Join if to AWS:
#   1. bundle the API for Lambda   2. terraform apply   3. run DB migrations
#   4. build the SPA and upload to S3   5. invalidate CloudFront
# Usage: infra/scripts/deploy.sh [--auto-approve]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TF="${ROOT}/infra/terraform"
APPROVE="${1:-}"

# Preflight: fail before changing anything, so a deploy never stops halfway
# (e.g. new Lambda code live but migrations not yet applied).
"${ROOT}/infra/scripts/doctor.sh" >/dev/null || {
  echo "error: 事前チェックに失敗しました。npm run doctor で詳細を確認してください" >&2
  exit 1
}

echo "==> Building API bundle"
npm run build:lambda -w @himitsu/api --prefix "${ROOT}" >/dev/null

echo "==> terraform apply"
terraform -chdir="${TF}" init -input=false >/dev/null
terraform -chdir="${TF}" apply -input=false ${APPROVE}

out() { terraform -chdir="${TF}" output -raw "$1"; }
FN="$(out api_function_name)"
BUCKET="$(out web_bucket)"
DIST="$(out cloudfront_distribution_id)"
URL="$(out site_url)"

echo "==> Waiting for Lambda to be ready"
aws lambda wait function-updated-v2 --function-name "${FN}"

echo "==> Running DB migrations"
RESULT_FILE="$(mktemp)"
aws lambda invoke --function-name "${FN}" --cli-binary-format raw-in-base64-out \
  --payload '{"action":"migrate"}' "${RESULT_FILE}" >/dev/null
cat "${RESULT_FILE}"; echo
if grep -q errorMessage "${RESULT_FILE}"; then echo "migration failed" >&2; exit 1; fi
rm -f "${RESULT_FILE}"

echo "==> Building web"
VITE_API_BASE_URL="" npm run build -w @himitsu/web --prefix "${ROOT}" >/dev/null

echo "==> Uploading web to s3://${BUCKET}"
WEB="${ROOT}/apps/web/dist"
aws s3 sync "${WEB}/assets" "s3://${BUCKET}/assets" --delete \
  --cache-control "public, max-age=31536000, immutable" >/dev/null
aws s3 sync "${WEB}" "s3://${BUCKET}" --delete --exclude "assets/*" \
  --cache-control "no-cache" >/dev/null

echo "==> Invalidating CloudFront"
aws cloudfront create-invalidation --distribution-id "${DIST}" --paths "/index.html" "/" >/dev/null

echo "==> Done: ${URL}"
