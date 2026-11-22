# 입시나침반 (ipsi.isjung.com)

전국 대학 입시 정보를 **정부·공공기관 공식 공시 데이터만으로** 보여주는 사이트입니다.
추정 합격선이나 임의 가공 수치는 쓰지 않고, 모든 화면에 출처를 표시합니다.

## 제공 기능
| 메뉴 | 내용 | 데이터 |
|---|---|---|
| 4년제 대학 | 260개교 학과별 **2017~2026학년도(10개년)** 모집·지원·경쟁률·충원율 추이 | 교육부 대학알리미 |
| 대학 공식 원문 | 대학별 수시·정시 **입시결과(성적 컷)**, 모집요강, 전형 기본계획 PDF (2017~2028학년도) | 각 대학 발표 원문 (경남대입정보센터 수집) |
| 전문대학 | 130개교 학과·전형별(일반/일반고/특성화고 등) 모집·지원·경쟁률 (2024학년도) | 한국전문대학교육협의회 |
| 학과 찾기 | 같은 학과를 개설한 전국 대학 비교 | 대학알리미 |
| 성적 계산기 | 내신 평균등급(9·5등급제), 영어·한국사 절대평가 등급 | 계산식 |
| 검색 노출 페이지 (`/u/`) | 4년제 대학마다 네이버·구글이 읽을 수 있는 개별 페이지 260개 + sitemap.xml | 위 데이터로 자동 생성 |

## 데이터 출처와 이용허락 (상업적 이용 가능 여부 확인 완료)
| 데이터 | 이용허락 |
|---|---|
| [교육부 대학알리미 신입생 충원 현황(대학·학과별)](https://www.data.go.kr/data/15163924/fileData.do) | 공공누리 제1유형 — **출처 표시 시 상업적 이용 가능** |
| [한국전문대학교육협의회 신입생 입시통계현황](https://www.data.go.kr/data/15068974/fileData.do) | 이용허락범위 제한 없음 |
| [경상남도교육청 경남대입정보센터 연도별 대학정보](https://www.data.go.kr/data/15135448/fileData.do) | 이용허락범위 제한 없음 (원문 PDF는 링크만 제공, 복제하지 않음) |
| [전북대학교 입시정보(수시·정시·편입학)](https://www.data.go.kr/data/15156696/fileData.do) — 모집단위별 학생부·수능 평균등급 | 이용허락범위 제한 없음 |
| [한국기술교육대학교 입시현황](https://www.data.go.kr/data/3074241/fileData.do) — 정시 입학성적 2014~2024 | 이용허락범위 제한 없음 |

> 대학이 공공데이터포털에 **직접 개방한 입결**은 원자료 그대로 해당 대학 페이지에 표로 보여줍니다(현재 전북대·한국기술교육대).
> 다른 대학이 개방하면 `pipeline/build_data.py` 의 `SOURCES` 와 `build_results()` 에 추가하면 됩니다.

> ⚠️ **대학어디가(adiga.kr) 자료는 사용하지 않습니다.** 대교협 저작권정책상 수익 목적 이용은 사전 허락이 필요합니다.
> 대학별 성적 컷을 사이트 안에서 표·추천 형태로 직접 제공하려면 대교협과의 데이터 제휴(또는 각 대학 원문의 이용 허락)가 먼저 필요합니다.

## 폴더 구조
```
admission/
├── index.html, app.js, style.css   웹 화면 (빌드 불필요)
├── data/                           가공된 공시 데이터(JSON) — 저장소에 포함
├── u/, sitemap.xml, robots.txt     검색엔진용 대학별 정적 페이지 (build_pages.py 로 생성)
├── pipeline/build_data.py          공공데이터 다운로드·가공 스크립트 (파이썬 표준 라이브러리만 사용)
├── pipeline/build_pages.py         검색엔진용 페이지 생성
└── deploy/                         우분투 서버 설치 스크립트, nginx 설정
```

## 우분투 서버(sc-kdb)에 설치 — https://ipsi.isjung.com

| 항목 | 값 |
|---|---|
| 서버 | sc-kdb (우분투). IP 는 바뀔 수 있으므로 **localhost** 기준으로 연결 |
| 포트 | **8500** (127.0.0.1 에서만 응답). **80 포트는 기존 kdb 사이트용이라 사용하지 않음** |
| 외부 공개 | Cloudflare 터널 `/etc/cloudflared/config.yml` 에 `ipsi.isjung.com → http://localhost:8500` |
| HTTPS | Cloudflare 가 처리. http 로 들어오면 https 로 이동(301) + HSTS |

### 1. 사이트 설치 (8500 포트)
```bash
sudo apt-get update && sudo apt-get install -y git
sudo git clone -b claude/university-admission-info-site-eyllo8 https://github.com/seoulcoin-ceo/helpdesk.git /opt/ipsi
sudo bash /opt/ipsi/admission/deploy/install.sh
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8500/      # 200 이면 정상
```
- nginx 를 새로 설치하는 경우 설치 중 자동 시작과 기본(80) 사이트를 막아 kdb 사이트와 충돌하지 않습니다.
- 이미 nginx 가 있으면 다른 사이트 설정은 건드리지 않고 입시 사이트 파일만 추가합니다.
- 방화벽(ufw)은 변경하지 않습니다.

### 2. Cloudflare 터널 연결 (config.yml)
```bash
sudo bash /opt/ipsi/admission/deploy/cloudflared_add.sh
```
1. `/etc/cloudflared/config.yml` 백업 (`config.yml.bak-날짜시각`)
2. ingress 마지막 404 규칙 앞에 `- hostname: ipsi.isjung.com / service: http://localhost:8500` 추가 (이미 있으면 건너뜀)
3. `cloudflared tunnel ingress validate` 로 검증 — 실패하면 백업으로 자동 복구
4. `cloudflared tunnel route dns <터널> ipsi.isjung.com` 로 DNS 연결
5. `systemctl restart cloudflared` 후 https://ipsi.isjung.com 응답 확인

되돌리기: `sudo cp -p /etc/cloudflared/config.yml.bak-<날짜시각> /etc/cloudflared/config.yml && sudo systemctl restart cloudflared`

권장 (Cloudflare 대시보드 → SSL/TLS → Edge Certificates): *Always Use HTTPS* 켬, *Minimum TLS Version* 1.2

### 3. 업데이트 · 데이터 갱신
```bash
cd /opt/ipsi && sudo git pull && sudo bash admission/deploy/install.sh   # 코드 업데이트 (8500 포트 유지)
sudo bash /opt/ipsi/admission/deploy/update_data.sh                      # 데이터 수동 갱신
```
매월 1일 새벽 자동 갱신이 등록됩니다(`/etc/cron.d/ipsi-data`, 로그 `/var/log/ipsi-data.log`).
서버는 data.go.kr, jinhak.gne.go.kr 에 나가는 인터넷 연결이 필요합니다.

### 4. 회원 로그인 (카카오·네이버·이메일)
`install.sh` 가 회원 API(`127.0.0.1:8501`, systemd `ipsi-api`)와 DB(`/var/lib/ipsi/ipsi.db`)를 설치하고, nginx 가 `/api/` 를 전달합니다. 이메일 가입은 바로 동작합니다.

간편 로그인을 켜려면 개발자 사이트에 앱을 등록하고 `/etc/ipsi/api.env` 에 키를 넣은 뒤 `sudo systemctl restart ipsi-api`:
- 카카오: developers.kakao.com → 내 애플리케이션 → 앱 추가 → 플랫폼 Web 사이트 도메인 `https://ipsi.isjung.com` → 카카오 로그인 활성화, Redirect URI `https://ipsi.isjung.com/api/auth/kakao/callback` → 동의항목: 닉네임(필수), 카카오계정(이메일)(선택) → `KAKAO_CLIENT_ID`(REST API 키), 보안 탭 Client Secret 사용 시 `KAKAO_CLIENT_SECRET`
- 네이버: developers.naver.com → Application 등록 → 네이버 로그인, 제공 정보: 회원이름·이메일 → 서비스 URL `https://ipsi.isjung.com`, Callback URL `https://ipsi.isjung.com/api/auth/naver/callback` → `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`

DB 백업: `sudo sqlite3 /var/lib/ipsi/ipsi.db ".backup /mnt/backup/ipsi/ipsi-$(date +%F).db"` (매일 cron 등록 권장)
**운영 전 필수**: 이용약관·개인정보 처리방침(`#/terms`, `#/privacy`)의 운영자명·보호책임자·시행일을 실제 정보로 채우세요 (`app.js` 의 `OPERATOR`, `OFFICER`).

## 데이터 정의
- **경쟁률** = 정원내 지원자 ÷ 정원내 모집인원 (수시·정시 합산, 대학알리미 공시 정의)
- **신입생 충원율** = 정원내 입학자 ÷ 정원내 모집인원. 일부 대학은 모집단위와 입학자 공시 단위가 달라 입학자가 0으로 공시되며, 이 경우 ‘-’로 표시
- **원문 학년도**: 입시결과 PDF는 다음 해 봄에 게시되므로 PDF 표지를 확인해 학년도를 보정함 (게시연도−1)
- 4년제 데이터에는 교육대학·산업대학·사이버대학 등 대학알리미 ‘대학’ 공시 대상이 포함됨 (목록에서 종류로 구분)

## 검색 노출 (네이버·구글) — 수익화 핵심
설치 후 아래 두 곳에 사이트를 등록하고 `https://ipsi.isjung.com/sitemap.xml` 을 제출하세요.
- 네이버 서치어드바이저: https://searchadvisor.naver.com (소유 확인용 HTML 파일을 받아 `/var/www/ipsi.isjung.com/` 에 올리면 됩니다)
- 구글 서치 콘솔: https://search.google.com/search-console

대학별 페이지 제목 예: “광운대학교 학과별 경쟁률 10년 추이·입시결과 | 입시나침반”
