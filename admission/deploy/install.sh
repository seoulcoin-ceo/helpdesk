#!/usr/bin/env bash
# 입시나침반 우분투 서버 설치 스크립트 (Ubuntu 22.04 / 24.04)
#   사용법:  sudo EMAIL=you@example.com bash deploy/install.sh
#   - nginx 설치 및 isjung.com 사이트 설정
#   - Let's Encrypt HTTPS 인증서 발급 (자동 갱신 포함)
#   - 매월 1일 공시 데이터 자동 갱신 cron 등록
set -euo pipefail

DOMAIN="isjung.com"
WEBROOT="/var/www/${DOMAIN}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # admission/ 폴더

if [ "$(id -u)" -ne 0 ]; then echo "sudo 로 실행하세요."; exit 1; fi

echo "[1/5] 패키지 설치"
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx python3 rsync

echo "[2/5] 웹 파일 배포 → ${WEBROOT}"
mkdir -p "${WEBROOT}"
rsync -a --delete --exclude pipeline --exclude deploy --exclude README.md "${APP_DIR}/" "${WEBROOT}/"
chown -R www-data:www-data "${WEBROOT}"

echo "[3/5] nginx 설정"
cp "${APP_DIR}/deploy/nginx-${DOMAIN}.conf" "/etc/nginx/sites-available/${DOMAIN}"
ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full'
fi

echo "[4/5] HTTPS 인증서 (도메인 DNS 가 이 서버 IP 를 가리켜야 합니다)"
if [ -n "${EMAIL:-}" ]; then
  certbot --nginx -d "${DOMAIN}" -d "www.${DOMAIN}" --redirect --agree-tos -m "${EMAIL}" -n \
    || echo "!! 인증서 발급 실패: DNS 설정 확인 후 'sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}' 를 다시 실행하세요."
else
  echo "   EMAIL 미지정 → 건너뜀. 나중에 실행: sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
fi

echo "[5/5] 매월 데이터 자동 갱신 등록"
cat > /etc/cron.d/isjung-data <<CRON
# 매월 1일 04:17 공공데이터포털에서 최신 공시를 받아 재빌드
17 4 1 * * root bash ${APP_DIR}/deploy/update_data.sh >> /var/log/isjung-data.log 2>&1
CRON

echo "완료: http://${DOMAIN} (인증서 발급 시 https://${DOMAIN})"
