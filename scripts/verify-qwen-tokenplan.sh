#!/bin/bash
# 验证阿里云百炼 Token Plan 个人版(国内)用量 API
# 来源: 复刻 CodexBar (steipete/CodexBar) 的 AlibabaTokenPlanUsageFetcher
#
# 用法:
#   1. 用 Chrome 登录 https://bailian.console.aliyun.com/cn-beijing?tab=plan#/efm/subscription/token-plan/personal
#   2. F12 -> Network -> 刷新页面 -> 找到请求 .../tokenplan/personal/api/v2/usage
#   3. 复制该请求 Request Headers 里 Cookie: 的整段值
#   4. 运行:  COOKIE='<粘贴的cookie>' ./scripts/verify-qwen-tokenplan.sh
#
# 只做只读用量查询, 不产生任何调用/计费。

set -euo pipefail

COOKIE="${COOKIE:-}"
if [ -z "$COOKIE" ]; then
  echo "错误: 请先设置 COOKIE 环境变量" >&2
  echo '用法: COOKIE='"'"'<你的cookie>'"'"' ./scripts/verify-qwen-tokenplan.sh' >&2
  exit 1
fi

HOST="https://bailian-cs.console.aliyun.com/data/api.json"
API="zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage"
DASHBOARD="https://bailian.console.aliyun.com"
FE_URL="$DASHBOARD/cn-beijing?tab=plan#/efm/subscription/token-plan/personal"
TRACE_ID="verify-$(uuidgen | tr 'A-Z' 'a-z')"

params=$(cat <<JSON
{
  "Api": "$API",
  "V": "1.0",
  "Data": {
    "cornerstoneParam": {
      "feTraceId": "$TRACE_ID",
      "feURL": "$FE_URL",
      "protocol": "V2",
      "console": "ONE_CONSOLE",
      "productCode": "p_efm",
      "switchUserType": 3,
      "domain": "bailian.console.aliyun.com",
      "consoleSite": "BAILIAN_ALIYUN",
      "userNickName": "",
      "userPrincipalName": "",
      "xsp_lang": "en-US"
    }
  }
}
JSON
)

ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$params")

body="product=sfm_bailian&action=BroadScopeAspnGateway&region=cn-beijing&language=en-US&params=${ENCODED}"

echo ">>> POST $HOST?action=BroadScopeAspnGateway&product=sfm_bailian&api=$API&_v=undefined"
echo ">>> curl -i (响应头+正文, 见下)"
echo

curl -sS -i -X POST "$HOST?action=BroadScopeAspnGateway&product=sfm_bailian&api=${API}&_v=undefined" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Accept: application/json, text/plain, */*" \
  -H "Cookie: ${COOKIE}" \
  -H "X-Requested-With: XMLHttpRequest" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  -H "Origin: $DASHBOARD" \
  -H "Referer: $FE_URL" \
  --data-raw "$body"

echo
echo
echo ">>> 期望: 若通, 响应里能看到 per5HourPercentage / per1WeekPercentage / per5HourResetTime / per1WeekResetTime"
echo ">>> 若 401/NotLogined/Workspace.NotAuthorised, 表示 cookie 缺 sec_token 或已过期"