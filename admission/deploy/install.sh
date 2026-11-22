#!/usr/bin/env bash
# 입시나침반 우분투 서버 설치 (Ubuntu 22.04 / 24.04)
#   기본 주소: ipsi.isjung.com  (기존 isjung.com 업무시스템은 건드리지 않음)
#
#   방문자는 항상 HTTPS 로만 접속됩니다(http 요청은 https 로 이동).
#   A) Cloudflare 터널(권장, 사내 서버):  sudo bash deploy/install.sh
#   B) Cloudflare 프록시 + 포트포워딩:   Cloudflare 원본 인증서(Origin Certificate)를 서버에 저장한 뒤
#        sudo TLS_CERT=/etc/ssl/cloudflare/ipsi.pem TLS_KEY=/etc/ssl/cloudflare/ipsi.key bash deploy/install.sh
#   C) Cloudflare 없이 직접 노출:         sudo CERTBOT=1 EMAIL=you@example.com bash deploy/install.sh
#   다른 주소로 설치:  sudo DOMAIN=example.com bash deploy/install.sh
set -euo pipefail

DOMAIN="${DOMAIN:-ipsi.isjung.com}"
WEBROOT="/var/www/${DOMAIN}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # admission/ 폴더

if [ "$(id -u)" -ne 0 ]; then echo "sudo 로 실행하세요."; exit 1; fi

echo "[1/5] 패키지 설치"
apt-get update -y
apt-get install -y nginx python3 python3-venv rsync
# 입결 PDF 표 추출용 파이썬 환경
[ -x /opt/ipsi-venv/bin/python ] || python3 -m venv /opt/ipsi-venv
/opt/ipsi-venv/bin/pip install -q --upgrade pdfplumber
[ "${CERTBOT:-0}" = "1" ] && apt-get install -y certbot python3-certbot-nginx

echo "[2/5] 검색용 페이지 생성 (주소: https://${DOMAIN})"
SITE_URL="https://${DOMAIN}" python3 "${APP_DIR}/pipeline/build_pages.py"

echo "[3/5] 웹 파일 배포 → ${WEBROOT}"
mkdir -p "${WEBROOT}"
rsync -a --delete --exclude pipeline --exclude deploy --exclude README.md --exclude .gitignore "${APP_DIR}/" "${WEBROOT}/"
chown -R www-data:www-data "${WEBROOT}"

echo "[4/5] nginx 설정"
TLS_LINES=""
if [ -n "${TLS_CERT:-}" ]; then
  [ -f "${TLS_CERT}" ] && [ -f "${TLS_KEY:?TLS_KEY 를 지정하세요}" ] || { echo "인증서 파일이 없습니다: ${TLS_CERT} / ${TLS_KEY}"; exit 1; }
  TLS_LINES="listen 443 ssl http2; listen [::]:443 ssl http2; ssl_certificate ${TLS_CERT}; ssl_certificate_key ${TLS_KEY}; ssl_protocols TLSv1.2 TLSv1.3;"
  if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 'Nginx Full'; fi
fi
sed -e "s/__DOMAIN__/${DOMAIN}/g" -e "s|#__TLS_LISTEN__|${TLS_LINES}|" "${APP_DIR}/deploy/nginx-site.conf" > "/etc/nginx/sites-available/${DOMAIN}"
ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
nginx -t
systemctl enable --now nginx
systemctl reload nginx
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 'Nginx HTTP'; fi
if [ "${CERTBOT:-0}" = "1" ]; then
  certbot --nginx -d "${DOMAIN}" --redirect --agree-tos -m "${EMAIL:?EMAIL 을 지정하세요}" -n
fi

echo "[5/5] 매월 데이터 자동 갱신 등록"
cat > /etc/cron.d/ipsi-data <<CRON
# 매월 1일 04:17 공공데이터포털에서 최신 공시를 받아 재빌드
17 4 1 * * root DOMAIN=${DOMAIN} bash ${APP_DIR}/deploy/update_data.sh >> /var/log/ipsi-data.log 2>&1
CRON

IP=$(hostname -I | awk '{print $1}')
echo
echo "완료. 사내망 확인: curl -H 'Host: ${DOMAIN}' http://${IP}/"
echo "다음: Cloudflare 에서 ${DOMAIN} → http://${IP}:80 연결 (README 참고)"
