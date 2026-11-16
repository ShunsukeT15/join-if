#!/usr/bin/env bash
# Checks that this machine can deploy, without changing anything.
#   npm run doctor
# Exit code 0 = ready. Messages are in Japanese for the operator.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TF="${ROOT}/infra/terraform"
fail=0
ok()   { printf '  OK    %s\n' "$1"; }
ng()   { printf '  NG    %s\n' "$1"; [ -n "${2:-}" ] && printf '        → %s\n' "$2"; fail=1; }
warn() { printf '  注意  %s\n' "$1"; [ -n "${2:-}" ] && printf '        → %s\n' "$2"; }

ver_ge() { # ver_ge 1.17.2 1.6  → true if $1 >= $2
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$2" ]
}

echo "== ツール"
if command -v node >/dev/null 2>&1; then
  v="$(node -v | sed 's/^v//')"
  if ver_ge "${v}" 22.0.0; then ok "Node.js ${v}"; else ng "Node.js ${v}（22 以上が必要）" "nvm install 24 など"; fi
else
  ng "Node.js が見つかりません" "https://nodejs.org/ または nvm で 24 をインストール"
fi
command -v npm >/dev/null 2>&1 && ok "npm $(npm -v)" || ng "npm が見つかりません"

if command -v terraform >/dev/null 2>&1; then
  v="$(terraform -version | head -1 | sed -E 's/^Terraform v([0-9.]+).*/\1/')"
  if ver_ge "${v}" 1.6.0; then ok "Terraform ${v}"; else ng "Terraform ${v}（1.6 以上が必要）" "brew upgrade hashicorp/tap/terraform"; fi
else
  ng "Terraform が見つかりません" "brew tap hashicorp/tap && brew install hashicorp/tap/terraform"
fi

if command -v aws >/dev/null 2>&1; then
  ok "$(aws --version 2>&1 | cut -d' ' -f1)"
else
  if ls /usr/local/Cellar/awscli/*/bin/aws /opt/homebrew/Cellar/awscli/*/bin/aws >/dev/null 2>&1; then
    ng "aws コマンドが PATH にありません（Homebrew にはインストール済み）" "brew link awscli"
  else
    ng "AWS CLI が見つかりません" "brew install awscli"
  fi
fi

echo "== 依存パッケージ"
if [ -d "${ROOT}/node_modules" ]; then ok "node_modules あり"; else ng "node_modules がありません" "npm ci"; fi

echo "== AWS 認証"
ACCOUNT=""
if command -v aws >/dev/null 2>&1; then
  if ACCOUNT="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)"; then
    ok "アカウント ${ACCOUNT}（$(aws sts get-caller-identity --query Arn --output text | sed 's/.*://')）"
    region="$(aws configure get region 2>/dev/null || true)"
    [ -n "${region}" ] && ok "既定リージョン ${region}" || warn "既定リージョン未設定（Terraform は ap-northeast-1 を使用）"
  else
    ng "AWS の認証に失敗しました" "aws configure（または AWS_PROFILE を設定）"
    ACCOUNT=""
  fi
else
  warn "aws コマンドがないため認証を確認できません"
fi

echo "== Terraform"
if [ -d "${TF}/.terraform" ]; then ok "terraform init 済み"; else warn "未初期化（デプロイ時に自動で init します）"; fi
if [ -f "${TF}/terraform.tfstate" ]; then
  # The web bucket name ends with the account id; deploying with another account would create a second environment.
  deployed="$(terraform -chdir="${TF}" output -raw web_bucket 2>/dev/null | sed -E 's/.*-([0-9]{12})$/\1/')"
  if [ -n "${deployed}" ] && [ -n "${ACCOUNT}" ]; then
    if [ "${deployed}" = "${ACCOUNT}" ]; then ok "state のアカウント（${deployed}）と認証中のアカウントが一致"
    else ng "state はアカウント ${deployed} のものですが、認証中は ${ACCOUNT} です" "正しいプロファイルに切り替える（export AWS_PROFILE=...）"; fi
  fi
  ok "state あり（$(terraform -chdir="${TF}" state list 2>/dev/null | wc -l | tr -d ' ') リソース）"
else
  warn "state がありません（初回デプロイ、または別の端末で管理中）" "既存環境がある場合は state を復元してから実行"
fi

echo
if [ "${fail}" -eq 0 ]; then echo "準備OK。npm run release でデプロイできます。"; else echo "NG の項目を直してから再実行してください。"; fi
exit "${fail}"
