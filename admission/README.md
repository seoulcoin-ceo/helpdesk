# 입시나침반 (isjung.com)

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

## 데이터 출처와 이용허락 (상업적 이용 가능 여부 확인 완료)
| 데이터 | 이용허락 |
|---|---|
| [교육부 대학알리미 신입생 충원 현황(대학·학과별)](https://www.data.go.kr/data/15163924/fileData.do) | 공공누리 제1유형 — **출처 표시 시 상업적 이용 가능** |
| [한국전문대학교육협의회 신입생 입시통계현황](https://www.data.go.kr/data/15068974/fileData.do) | 이용허락범위 제한 없음 |
| [경상남도교육청 경남대입정보센터 연도별 대학정보](https://www.data.go.kr/data/15135448/fileData.do) | 이용허락범위 제한 없음 (원문 PDF는 링크만 제공, 복제하지 않음) |

> ⚠️ **대학어디가(adiga.kr) 자료는 사용하지 않습니다.** 대교협 저작권정책상 수익 목적 이용은 사전 허락이 필요합니다.
> 대학별 성적 컷을 사이트 안에서 표·추천 형태로 직접 제공하려면 대교협과의 데이터 제휴(또는 각 대학 원문의 이용 허락)가 먼저 필요합니다.

## 폴더 구조
```
admission/
├── index.html, app.js, style.css   웹 화면 (빌드 불필요)
├── data/                           가공된 공시 데이터(JSON) — 저장소에 포함
├── pipeline/build_data.py          공공데이터 다운로드·가공 스크립트 (파이썬 표준 라이브러리만 사용)
└── deploy/                         우분투 서버 설치 스크립트, nginx 설정
```

## 우분투 서버에 설치 (isjung.com)

### 1. 도메인 연결 (도메인 구입처 관리화면)
| 호스트 | 타입 | 값 |
|---|---|---|
| `@` (isjung.com) | A | 서버 공인 IP |
| `www` | A | 서버 공인 IP |

`ping isjung.com` 결과가 서버 IP 로 나오면 다음 단계로 진행하세요. (반영까지 수 분~수 시간)

### 2. 서버에서 설치
**방법 A — 압축 파일(isjung-site.zip)로 설치** (GitHub 연결 전)
```bash
# 내 PC에서 서버로 업로드
scp isjung-site.zip 사용자@서버IP:/tmp/
# 서버에서
sudo apt-get install -y unzip
sudo mkdir -p /opt/isjung && sudo unzip -o /tmp/isjung-site.zip -d /opt/isjung
sudo EMAIL=본인이메일 bash /opt/isjung/admission/deploy/install.sh
```

**방법 B — GitHub에서 받아 설치**
```bash
# 우분투 버전 확인 (Ubuntu 22.04 / 24.04 권장)
cat /etc/os-release

sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/seoulcoin-ceo/helpdesk.git /opt/isjung
cd /opt/isjung && sudo git checkout claude/university-admission-info-site-eyllo8

sudo EMAIL=본인이메일 bash admission/deploy/install.sh
```
설치 스크립트가 하는 일:
1. nginx, certbot(무료 HTTPS 인증서) 설치
2. 웹 파일을 `/var/www/isjung.com` 에 배포 (pipeline·deploy 폴더는 외부 공개 안 함)
3. nginx 설정 (gzip 압축, 캐시, 보안 헤더, www → 루트 도메인 이동)
4. HTTPS 인증서 발급 및 자동 갱신
5. 매월 1일 새벽 공시 데이터 자동 갱신 등록 (`/etc/cron.d/isjung-data`, 로그 `/var/log/isjung-data.log`)

방화벽(AWS 보안그룹, 클라우드 방화벽 등)에서 **80, 443 포트**를 열어야 합니다.

### 3. 코드 업데이트 반영
```bash
cd /opt/isjung && sudo git pull && sudo bash admission/deploy/install.sh
```

### 4. 데이터 수동 갱신
```bash
sudo bash /opt/isjung/admission/deploy/update_data.sh
```
다운로드 → 가공 → 원문 링크 검사(404 등 없는 파일 제외) → 웹 반영 순서로 진행하며, 실패하면 기존 데이터를 유지합니다.

## 데이터 정의
- **경쟁률** = 정원내 지원자 ÷ 정원내 모집인원 (수시·정시 합산, 대학알리미 공시 정의)
- **신입생 충원율** = 정원내 입학자 ÷ 정원내 모집인원. 일부 대학은 모집단위와 입학자 공시 단위가 달라 입학자가 0으로 공시되며, 이 경우 ‘-’로 표시
- **원문 학년도**: 입시결과 PDF는 다음 해 봄에 게시되므로 PDF 표지를 확인해 학년도를 보정함 (게시연도−1)
- 4년제 데이터에는 교육대학·산업대학·사이버대학 등 대학알리미 ‘대학’ 공시 대상이 포함됨 (목록에서 종류로 구분)
