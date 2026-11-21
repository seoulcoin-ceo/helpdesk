#!/usr/bin/env bash
# 공시 데이터 갱신: 다운로드 → 가공 → 원문 링크 검사 → 웹 루트 반영
# 실패하면 기존 데이터를 그대로 둡니다.
set -euo pipefail
DOMAIN="isjung.com"
WEBROOT="/var/www/${DOMAIN}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "== $(date '+%F %T') 데이터 갱신 시작"
cd "${APP_DIR}/pipeline"
python3 build_data.py --check-links
python3 build_pages.py
rsync -a --delete "${APP_DIR}/data/" "${WEBROOT}/data/"
rsync -a --delete "${APP_DIR}/u/" "${WEBROOT}/u/"
cp "${APP_DIR}/sitemap.xml" "${APP_DIR}/robots.txt" "${WEBROOT}/"
chown -R www-data:www-data "${WEBROOT}"
echo "== $(date '+%F %T') 완료"
