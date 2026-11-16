#!/usr/bin/env bash
# One-time AWS account settings for this project (changes account settings; run once).
#
#   npm run setup:aws                                  # コスト配分タグ Project を有効化
#   npm run setup:aws -- --budget-email you@example.com  # 予算アラートの通知先も設定（次の release で作成）
#   npm run setup:aws -- --budget-email you@example.com --budget-usd 15  # 予算額も指定
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TFVARS="${ROOT}/infra/terraform/terraform.tfvars"
EMAIL=""
BUDGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --budget-email) EMAIL="${2:-}"; shift 2 ;;
    --budget-usd) BUDGET="${2:-}"; shift 2 ;;
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
  grep -vE '^(budget_alert_email|monthly_budget_usd)' "${TFVARS}" > "${TFVARS}.tmp" || true
  printf 'budget_alert_email = "%s"\n' "${EMAIL}" >> "${TFVARS}.tmp"
  [ -n "${BUDGET}" ] && printf 'monthly_budget_usd = %s\n' "${BUDGET}" >> "${TFVARS}.tmp"
  mv "${TFVARS}.tmp" "${TFVARS}"
  echo "設定しました。次の npm run release で予算アラートが作成されます。"
  echo "通知は購読確認なしで届きます（迷惑メールフォルダも確認してください）。"
fi
