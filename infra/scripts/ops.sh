#!/usr/bin/env bash
# Operator commands against the deployed API (AWS). Runs maintenance actions inside the
# Lambda function with your AWS credentials; nothing here is reachable over HTTP.
#
#   npm run ops -- stats                         データ件数を表示
#   npm run ops -- delete-test-data [prefix]     テストデータ（既定: タイトルが [smoke] で始まる）を削除
#   npm run ops -- delete-room <roomId>          ルーム（コミュニティ）を1つ削除
#   npm run ops -- delete-event <eventId>        イベントと配下のコミュニティを削除
#   npm run ops -- reset-all                     全データを削除（合言葉の入力が必要）
#
# 削除系は確認を求めます。--yes で確認を省略（reset-all の合言葉は省略不可）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TF="${ROOT}/infra/terraform"
CMD="${1:-}"
shift || true
YES=0
ARGS=()
for a in "$@"; do
  if [ "${a}" = "--yes" ]; then YES=1; else ARGS+=("${a}"); fi
done
ARG1="${ARGS[0]:-}"

usage() { sed -n '5,11p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
[ -n "${CMD}" ] || usage

command -v aws >/dev/null 2>&1 || { echo "aws コマンドがありません。npm run doctor を確認してください" >&2; exit 1; }
FN="$(terraform -chdir="${TF}" output -raw api_function_name 2>/dev/null)" || { echo "Terraform の出力が読めません（state がこの端末にありますか？）" >&2; exit 1; }
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"

confirm() {
  [ "${YES}" -eq 1 ] && return 0
  printf '%s [y/N] ' "$1"
  read -r ans
  [ "${ans}" = "y" ] || [ "${ans}" = "Y" ] || { echo "中止しました"; exit 1; }
}

invoke() {
  local payload="$1" out
  out="$(mktemp)"
  aws lambda invoke --function-name "${FN}" --cli-binary-format raw-in-base64-out \
    --payload "${payload}" "${out}" >/dev/null
  if grep -q '"errorMessage"' "${out}"; then
    echo "失敗しました:" >&2; cat "${out}" >&2; echo >&2; rm -f "${out}"; exit 1
  fi
  node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")), null, 2))' "${out}"
  rm -f "${out}"
}

echo "対象: アカウント ${ACCOUNT} / 関数 ${FN}"
case "${CMD}" in
  stats)
    invoke '{"action":"stats"}'
    ;;
  delete-test-data)
    PREFIX="${ARG1:-[smoke]}"
    confirm "タイトルが「${PREFIX}」で始まるルームとイベントを削除します。よろしいですか？"
    invoke "$(node -e 'console.log(JSON.stringify({action:"delete-test-data",prefix:process.argv[1]}))' "${PREFIX}")"
    ;;
  delete-room)
    [ -n "${ARG1}" ] || usage
    confirm "ルーム ${ARG1} を削除します（元に戻せません）。よろしいですか？"
    invoke "$(node -e 'console.log(JSON.stringify({action:"delete-room",roomId:process.argv[1]}))' "${ARG1}")"
    ;;
  delete-event)
    [ -n "${ARG1}" ] || usage
    confirm "イベント ${ARG1} と配下のコミュニティをすべて削除します（元に戻せません）。よろしいですか？"
    invoke "$(node -e 'console.log(JSON.stringify({action:"delete-event",eventId:process.argv[1]}))' "${ARG1}")"
    ;;
  reset-all)
    echo "現在のデータ件数:"
    invoke '{"action":"stats"}'
    echo "全てのルーム・イベント・回答を削除します。元に戻せません。"
    printf '実行する場合は DELETE ALL DATA と入力してください: '
    read -r phrase
    invoke "$(node -e 'console.log(JSON.stringify({action:"reset-all",confirm:process.argv[1]}))' "${phrase}")"
    ;;
  *)
    usage
    ;;
esac
