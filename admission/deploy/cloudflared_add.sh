#!/usr/bin/env bash
# Cloudflare 터널에 ipsi.isjung.com → http://localhost:8500 등록
#   사용: sudo bash /opt/ipsi/admission/deploy/cloudflared_add.sh
#   1) /etc/cloudflared/config.yml 백업  2) ingress 에 한 줄 추가(이미 있으면 건너뜀)
#   3) 설정 검증(실패 시 백업으로 자동 복구)  4) DNS 연결(cloudflared tunnel route dns)
#   5) 터널 재시작  6) https 접속 확인
set -euo pipefail
DOMAIN="${DOMAIN:-ipsi.isjung.com}"
PORT="${PORT:-8500}"
CONFIG="${CONFIG:-/etc/cloudflared/config.yml}"
SERVICE="${SERVICE:-cloudflared}"

if [ "$(id -u)" -ne 0 ]; then echo "sudo 로 실행하세요."; exit 1; fi
[ -f "${CONFIG}" ] || { echo "설정 파일이 없습니다: ${CONFIG}"; exit 1; }
command -v cloudflared >/dev/null || { echo "cloudflared 가 설치되어 있지 않습니다."; exit 1; }

code=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Forwarded-Proto: https" "http://localhost:${PORT}/" || true)
[ "${code}" = "200" ] || { echo "localhost:${PORT} 응답이 ${code} 입니다. install.sh 를 먼저 실행하세요."; exit 1; }

BACKUP="${CONFIG}.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "${CONFIG}" "${BACKUP}"
echo "[1/5] 백업: ${BACKUP}"

echo "[2/5] ingress 추가"
python3 - "${CONFIG}" "${DOMAIN}" "${PORT}" <<'PY'
import re, sys
path, domain, port = sys.argv[1:4]
lines = open(path, encoding="utf-8").read().split("\n")
if any(re.search(r"hostname:\s*['\"]?" + re.escape(domain) + r"['\"]?\s*$", l) for l in lines):
    print("   이미 등록되어 있어 건너뜀"); sys.exit(0)
# 마지막 catch-all 규칙(hostname 없는 '- service:') 바로 앞에 넣는다
idx = None
for i, l in enumerate(lines):
    if re.match(r"^\s*-\s*service\s*:", l):
        idx = i
if idx is None:
    sys.exit("ingress 의 마지막 규칙(- service: http_status:404)을 찾지 못했습니다. 수동으로 추가하세요.")
indent = re.match(r"^(\s*)-", lines[idx]).group(1)
new = [f"{indent}- hostname: {domain}", f"{indent}  service: http://localhost:{port}"]
lines[idx:idx] = new
open(path, "w", encoding="utf-8").write("\n".join(lines))
print("   추가:", " / ".join(x.strip() for x in new))
PY

echo "[3/5] 설정 검증"
if ! cloudflared tunnel --config "${CONFIG}" ingress validate; then
  cp -p "${BACKUP}" "${CONFIG}"; echo "!! 검증 실패 → 백업으로 복구했습니다."; exit 1
fi
cloudflared tunnel --config "${CONFIG}" ingress rule "https://${DOMAIN}/" || true

echo "[4/5] DNS 연결"
TUNNEL=$(awk -F: '/^tunnel:/{gsub(/[ "\x27]/,"",$2); print $2}' "${CONFIG}")
[ -n "${TUNNEL}" ] || { echo "config.yml 에서 tunnel: 값을 찾지 못했습니다."; exit 1; }
cloudflared tunnel route dns "${TUNNEL}" "${DOMAIN}" || echo "   (이미 연결돼 있거나 권한 문제 — 메시지를 확인하세요)"

echo "[5/5] 터널 재시작"
systemctl restart "${SERVICE}"
sleep 5
systemctl --no-pager --lines=5 status "${SERVICE}" || true

echo
for i in 1 2 3 4 5 6; do
  c=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}/" || true)
  [ "${c}" = "200" ] && { echo "접속 확인: https://${DOMAIN}/ → 200 OK"; exit 0; }
  echo "   대기 중… (${c})"; sleep 10
done
echo "!! 아직 https://${DOMAIN}/ 가 200 이 아닙니다. DNS 반영(최대 수 분) 후 다시 확인하세요. 복구: sudo cp -p ${BACKUP} ${CONFIG} && sudo systemctl restart ${SERVICE}"
