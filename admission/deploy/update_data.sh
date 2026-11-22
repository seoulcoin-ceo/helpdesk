#!/usr/bin/env bash
# 공시 데이터 갱신: 다운로드 → 가공 → 원문 링크 검사 → 검색용 페이지 → 웹 반영
# 실패하면 기존 데이터를 그대로 둡니다.
set -euo pipefail
DOMAIN="${DOMAIN:-ipsi.isjung.com}"
WEBROOT="/var/www/${DOMAIN}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "== $(date '+%F %T') 데이터 갱신 시작"
cd "${APP_DIR}/pipeline"
python3 build_data.py --check-links
# 대학 발표 입시결과 PDF → 표 추출 (최근 2개 학년도, 원문 대조 통과 표만)
/opt/ipsi-venv/bin/python extract_results.py --jobs 4 || echo "!! 입결 추출 실패 - 기존 입결 데이터 유지"
SITE_URL="https://${DOMAIN}" python3 build_pages.py
rsync -a --delete "${APP_DIR}/data/" "${WEBROOT}/data/"
rsync -a --delete "${APP_DIR}/u/" "${WEBROOT}/u/"
cp "${APP_DIR}/sitemap.xml" "${APP_DIR}/robots.txt" "${WEBROOT}/"
chown -R www-data:www-data "${WEBROOT}"
echo "== $(date '+%F %T') 완료"
