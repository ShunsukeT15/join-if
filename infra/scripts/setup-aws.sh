#!/usr/bin/env bash
# One-time AWS account settings for this project (changes account settings; run once).
#
#   npm run setup:aws                                  # コスト配分タグ Project を有効化
#   npm run setup:aws -- --budget-email you@example.com  # 予算アラートの通知先も設定（次の release で作成）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TFVARS="${ROOT}/infra/terraform/terraform.tfvars"
EMAIL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --budget-email) EMAIL="${2:-}"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

command -v aws >/dev/null 2>&1 || { echo "aws コマンドがありません。npm run doctor を確認してください" >&2; exit 1; }
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "対象アカウント: ${ACCOUNT}"

echo "==> コスト配分タグ Project を有効化"
if aws ce update-cost-allocation-tags-status \
     --cost-allocation-tags-status TagKey=Project,Status=Active >/dev/null 2>&1; then
  echo "有効化しました（Cost Explorer への反映は最大24時間）"
else
  echo "注意: 有効化できませんでした。タグ付きリソースの作成から24時間以内はタグが表示されないことがあります。後で再実行してください。"
fi

if [ -n "${EMAIL}" ]; then
  echo "==> 予算アラートの通知先を terraform.tfvars に設定"
  touch "${TFVARS}"
  grep -v '^budget_alert_email' "${TFVARS}" > "${TFVARS}.tmp" || true
  printf 'budget_alert_email = "%s"\n' "${EMAIL}" >> "${TFVARS}.tmp"
  mv "${TFVARS}.tmp" "${TFVARS}"
  echo "設定しました。次の npm run release で予算アラートが作成されます。"
  echo "作成後に AWS から届く購読確認メールを承認してください。"
fi
