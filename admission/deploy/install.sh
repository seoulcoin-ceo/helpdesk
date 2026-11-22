#!/usr/bin/env bash
# 입시나침반 우분투 서버 설치
#   사용:  sudo bash /opt/ipsi/admission/deploy/install.sh
#
#   * 80 포트는 기존 사이트가 쓰므로 건드리지 않는다.
#   * 입시 사이트는 127.0.0.1:8500 에서만 응답 (사내망에 노출 안 됨).
#   * 외부 공개는 Cloudflare 터널: https://ipsi.isjung.com → http://localhost:8500
#     (deploy/cloudflared_add.sh 로 등록, HTTPS 는 Cloudflare 가 처리)
#   * 방화벽(ufw)·다른 nginx 사이트는 변경하지 않는다.
#   옵션: DOMAIN=ipsi.isjung.com  PORT=8500  BIND=127.0.0.1
set -euo pipefail

DOMAIN="${DOMAIN:-ipsi.isjung.com}"
PORT="${PORT:-8500}"
BIND="${BIND:-127.0.0.1}"
WEBROOT="/var/www/${DOMAIN}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # admission/ 폴더

if [ "$(id -u)" -ne 0 ]; then echo "sudo 로 실행하세요."; exit 1; fi

echo "[0/5] 포트 ${PORT} 확인"
if ss -ltnp 2>/dev/null | grep -q ":${PORT} " && ! ss -ltnp 2>/dev/null | grep ":${PORT} " | grep -q nginx; then
  echo "!! 포트 ${PORT} 를 다른 프로그램이 쓰고 있습니다:"; ss -ltnp | grep ":${PORT} "; exit 1
fi

echo "[1/5] 패키지 설치"
apt-get update -y
FRESH_NGINX=0
if ! dpkg -s nginx >/dev/null 2>&1; then
  FRESH_NGINX=1
  # 새로 설치하는 nginx 가 80 포트(기존 사이트)를 잡지 않도록 설치 중 자동 시작을 막는다
  printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d; chmod +x /usr/sbin/policy-rc.d
fi
apt-get install -y nginx python3 python3-venv rsync || { rm -f /usr/sbin/policy-rc.d; exit 1; }
rm -f /usr/sbin/policy-rc.d
if [ "${FRESH_NGINX}" = "1" ]; then
  rm -f /etc/nginx/sites-enabled/default   # 새로 깐 nginx 의 기본 80 포트 사이트만 끔 (기존 설정은 건드리지 않음)
fi
[ -x /opt/ipsi-venv/bin/python ] || python3 -m venv /opt/ipsi-venv
/opt/ipsi-venv/bin/pip install -q --upgrade pdfplumber   # 입결 PDF 표 추출용

echo "[2/5] 검색용 페이지 생성 (주소: https://${DOMAIN})"
SITE_URL="https://${DOMAIN}" python3 "${APP_DIR}/pipeline/build_pages.py"

echo "[3/5] 웹 파일 배포 → ${WEBROOT}"
mkdir -p "${WEBROOT}"
rsync -a --delete --exclude pipeline --exclude deploy --exclude README.md --exclude .gitignore "${APP_DIR}/" "${WEBROOT}/"
chown -R www-data:www-data "${WEBROOT}"

echo "[4/5] nginx 설정 (${BIND}:${PORT})"
sed -e "s/__DOMAIN__/${DOMAIN}/g" -e "s/__LISTEN__/${BIND}:${PORT}/" "${APP_DIR}/deploy/nginx-site.conf" > "/etc/nginx/sites-available/${DOMAIN}"
ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
nginx -t
systemctl enable nginx
if systemctl is-active --quiet nginx; then systemctl reload nginx; else systemctl start nginx; fi

echo "[5/5] 매월 데이터 자동 갱신 등록"
cat > /etc/cron.d/ipsi-data <<CRON
# 매월 1일 04:17 공공데이터포털에서 최신 공시를 받아 재빌드
17 4 1 * * root DOMAIN=${DOMAIN} bash ${APP_DIR}/deploy/update_data.sh >> /var/log/ipsi-data.log 2>&1
CRON

code=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Forwarded-Proto: https" "http://localhost:${PORT}/" || true)
echo
echo "완료: http://localhost:${PORT}/ 응답 ${code} (200 이면 정상)"
echo "다음: sudo bash ${APP_DIR}/deploy/cloudflared_add.sh   # Cloudflare 터널에 ${DOMAIN} 연결"
