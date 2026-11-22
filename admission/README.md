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

## 우분투 서버에 설치 — ipsi.isjung.com (사내 서버 192.168.0.7)

입시 사이트는 **ipsi.isjung.com** 으로 엽니다. 기존 **isjung.com(서울전자 업무시스템)은 건드리지 않습니다.**
isjung.com 은 Cloudflare 를 거치므로 HTTPS 는 Cloudflare 가 처리하고, 서버는 사내망에서 80 포트만 엽니다.

### 1. 서버(192.168.0.7)에서 설치
```bash
cat /etc/os-release            # Ubuntu 인지 확인
sudo apt-get update && sudo apt-get install -y git
sudo git clone -b claude/university-admission-info-site-eyllo8 https://github.com/seoulcoin-ceo/helpdesk.git /opt/ipsi
sudo bash /opt/ipsi/admission/deploy/install.sh
```
확인 (같은 사내망 PC 에서): `curl -H "Host: ipsi.isjung.com" http://192.168.0.7/` → HTML 이 나오면 정상.

### 2. Cloudflare 에서 주소 연결
isjung.com 이 어떻게 연결돼 있는지에 따라 하나를 고르세요.

**A. Cloudflare 터널(cloudflared)을 쓰는 경우 — 사내 서버라면 대부분 이 방식**
1. Cloudflare 대시보드 → Zero Trust → Networks → Tunnels → isjung.com 에 쓰는 터널 선택 → *Public Hostname* → **Add a public hostname**
2. Subdomain `ipsi`, Domain `isjung.com`, Service Type `HTTP`, URL `192.168.0.7:80` → 저장
3. 1~2분 뒤 https://ipsi.isjung.com 접속

**B. 공유기 포트포워딩 + DNS(A 레코드)를 쓰는 경우**
80/443 포트가 이미 업무시스템 서버(예: 192.168.0.10)로 가고 있으므로, 그 서버의 웹서버(nginx 등)에
`ipsi.isjung.com` 요청을 `http://192.168.0.7` 로 넘기는 설정을 추가하고, Cloudflare DNS 에
`ipsi` CNAME `isjung.com` (프록시 켬) 레코드를 추가합니다.

### 3. 업데이트 · 데이터 갱신
```bash
cd /opt/ipsi && sudo git pull && sudo bash admission/deploy/install.sh   # 코드 업데이트
sudo bash /opt/ipsi/admission/deploy/update_data.sh                      # 데이터 수동 갱신
```
매월 1일 새벽 자동 갱신이 등록됩니다(`/etc/cron.d/ipsi-data`, 로그 `/var/log/ipsi-data.log`).
서버는 data.go.kr, jinhak.gne.go.kr 에 나가는 인터넷 연결이 필요합니다.

## 데이터 정의
- **경쟁률** = 정원내 지원자 ÷ 정원내 모집인원 (수시·정시 합산, 대학알리미 공시 정의)
- **신입생 충원율** = 정원내 입학자 ÷ 정원내 모집인원. 일부 대학은 모집단위와 입학자 공시 단위가 달라 입학자가 0으로 공시되며, 이 경우 ‘-’로 표시
- **원문 학년도**: 입시결과 PDF는 다음 해 봄에 게시되므로 PDF 표지를 확인해 학년도를 보정함 (게시연도−1)
- 4년제 데이터에는 교육대학·산업대학·사이버대학 등 대학알리미 ‘대학’ 공시 대상이 포함됨 (목록에서 종류로 구분)

## 검색 노출 (네이버·구글) — 수익화 핵심
설치 후 아래 두 곳에 사이트를 등록하고 `https://ipsi.isjung.com/sitemap.xml` 을 제출하세요.
- 네이버 서치어드바이저: https://searchadvisor.naver.com (소유 확인용 HTML 파일을 받아 `/var/www/isjung.com/` 에 올리면 됩니다)
- 구글 서치 콘솔: https://search.google.com/search-console

대학별 페이지 제목 예: “광운대학교 학과별 경쟁률 10년 추이·입시결과 | 입시나침반”
