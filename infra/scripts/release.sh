#!/usr/bin/env bash
# One command from checks to a verified deploy.
#
#   npm run release                 # 点検 → 型チェック → テスト → デプロイ（plan を見て yes）→ スモークテスト
#   npm run release -- --yes        # 確認なしで適用
#   npm run release -- --plan       # 変更内容の確認だけ（AWS には何も変更しない）
#   npm run release -- --skip-tests # テストを省略（非推奨）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TF="${ROOT}/infra/terraform"
YES=""; PLAN_ONLY=0; SKIP_TESTS=0
for arg in "$@"; do
  case "${arg}" in
    --yes) YES="-auto-approve" ;;
    --plan) PLAN_ONLY=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    *) echo "unknown option: ${arg}" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

step "1/5 環境の点検"
"${ROOT}/infra/scripts/doctor.sh"

cd "${ROOT}"
if [ "${SKIP_TESTS}" -eq 0 ]; then
  step "2/5 型チェック"
  npm run typecheck --silent
  step "3/5 テスト"
  npm test --silent
else
  step "2-3/5 テストを省略"
fi

if [ "${PLAN_ONLY}" -eq 1 ]; then
  step "4/5 変更内容の確認（plan のみ。AWS には何も変更しません）"
  npm run build:lambda -w @himitsu/api --silent >/dev/null
  terraform -chdir="${TF}" init -input=false >/dev/null
  terraform -chdir="${TF}" plan -input=false
  echo
  echo "plan のみ実行しました。適用するには: npm run release"
  exit 0
fi

step "4/5 デプロイ"
"${ROOT}/infra/scripts/deploy.sh" ${YES}

step "5/5 デプロイ後の確認（スモークテスト）"
URL="$(terraform -chdir="${TF}" output -raw site_url)"
node "${ROOT}/infra/scripts/smoke-test.mjs" "${URL}"

echo
echo "完了: ${URL}"
