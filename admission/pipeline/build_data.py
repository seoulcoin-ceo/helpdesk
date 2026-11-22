#!/usr/bin/env python3
"""입시나침반 데이터 빌드 스크립트

공식 공공데이터만 내려받아 웹에서 쓰는 JSON으로 가공합니다.
  1) 교육부 대학알리미 '신입생 충원 현황(대학·학과별)'  2011~현재, 4년제  [공공누리 1유형: 출처표시]
  2) 한국전문대학교육협의회 '신입생 입시통계현황'                전문대학      [이용허락 제한 없음]
  3) 경상남도교육청 경남대입정보센터 '연도별 대학정보'            대학 공식 입시결과·모집요강 원문 링크 [이용허락 제한 없음]

사용법 (우분투):
  python3 build_data.py              # 다운로드 + 가공
  python3 build_data.py --offline    # 이미 받은 raw/ 파일로 가공만
  python3 build_data.py --check-links  # 원문 PDF 링크가 실제 열리는지 검사 (시간 소요)
표준 라이브러리만 사용합니다.
"""
import argparse, csv, io, json, os, re, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
OUT = os.path.join(HERE, "..", "data")
YEARS = 10  # 최근 10개 학년도

SOURCES = {
    "univ": {"pk": "15163924", "dpk": "uddi:a850d2f9-33fc-491b-943c-a7d34b9151c4", "file": "univ_chungwon.csv", "enc": "utf-8-sig",
             "name": "교육부 대학알리미 신입생 충원 현황(대학·학과별)", "url": "https://www.data.go.kr/data/15163924/fileData.do", "license": "공공누리 제1유형(출처표시)"},
    "college": {"pk": "15068974", "dpk": "uddi:976ad25f-ea82-4465-b346-c5f660914783", "file": "college_ipsi.csv", "enc": "cp949",
                "name": "한국전문대학교육협의회 신입생 입시통계현황", "url": "https://www.data.go.kr/data/15068974/fileData.do", "license": "이용허락범위 제한 없음"},
    "links": {"pk": "15135448", "dpk": "uddi:2258a71d-5093-4fa0-8f0d-eff097f80313", "file": "gne_univ_docs.csv", "enc": "utf-8-sig",
              "name": "경상남도교육청 경남대입정보센터 연도별 대학정보", "url": "https://www.data.go.kr/data/15135448/fileData.do", "license": "이용허락범위 제한 없음"},
    # 대학이 공공데이터포털에 직접 개방한 입시결과 (합격자 성적 포함)
    "jbnu": {"pk": "15156696", "dpk": "uddi:f8fda4ca-d9f6-4428-b100-ff882eb325a8", "file": "jbnu_ipsi.csv", "enc": "cp949",
             "name": "전북대학교 입시정보(수시·정시·편입학)", "url": "https://www.data.go.kr/data/15156696/fileData.do", "license": "이용허락범위 제한 없음"},
    "koreatech": {"pk": "3074241", "dpk": "uddi:a022d647-7aa7-4c54-8dfd-e7fefb34b1ee", "file": "koreatech_ipsi.csv", "enc": "cp949",
                  "name": "한국기술교육대학교 입시현황", "url": "https://www.data.go.kr/data/3074241/fileData.do", "license": "이용허락범위 제한 없음"},
}
DOC_BASE = "https://jinhak.gne.go.kr"
UA = {"User-Agent": "Mozilla/5.0 (ipsi-compass data builder)"}


def http(url, data=None, timeout=600, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode() if data else None, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # 네트워크 일시 오류 재시도
            if i == tries - 1:
                raise
            print(f"  재시도 {i + 1}: {e}", file=sys.stderr)
            time.sleep(2 ** i * 2)


def current_detail_pk(s):
    """데이터셋이 갱신되면 파일 식별자(uddi)가 바뀔 수 있어 상세 페이지에서 최신 값을 읽는다."""
    try:
        page = http(s["url"], timeout=60).decode("utf-8", "ignore")
        m = re.search(r"fn_fileDataDown\('%s',\s*'(uddi:[0-9a-f-]+)'" % s["pk"], page)
        if m:
            return m.group(1)
    except Exception as e:
        print(f"  상세 페이지 조회 실패, 저장된 식별자 사용: {e}", file=sys.stderr)
    return s["dpk"]


def download(key):
    s = SOURCES[key]
    s["dpk"] = current_detail_pk(s)
    meta = json.loads(http("https://www.data.go.kr/tcs/dss/selectFileDataDownload.do", {
        "publicDataPk": s["pk"], "publicDataDetailPk": s["dpk"], "publicDataTyCode": "PR0051", "atchFileId": "", "fileDetailSn": "1"}))
    if not meta.get("status"):
        raise RuntimeError(f"{s['name']} 다운로드 정보 조회 실패")
    q = urllib.parse.urlencode({"atchFileId": meta["atchFileId"], "fileDetailSn": meta["fileDetailSn"], "dataNm": "x"})
    body = http("https://www.data.go.kr/cmm/cmm/fileDownload.do?" + q)
    with open(os.path.join(RAW, s["file"]), "wb") as f:
        f.write(body)
    info = meta.get("dataSetFileDetailInfo") or {}
    return {"dataNm": info.get("dataNm"), "bytes": len(body)}


def rows(key):
    s = SOURCES[key]
    with open(os.path.join(RAW, s["file"]), encoding=s["enc"], newline="") as f:
        return list(csv.DictReader(f))


def n(v):
    try:
        return float(str(v).replace(",", ""))
    except ValueError:
        return 0.0


def base_name(name):
    """'가천대학교(글로벌)' -> '가천대학교', 'KC대학교(서울)(구.그리스도대)' -> 'KC대학교'"""
    b = re.sub(r"\(.*?\)", "", name).strip()
    return re.sub(r"^국립", "", b)


def campus_label(name):
    m = re.findall(r"\(([^)]*)\)", name)
    m = [x for x in m if not x.startswith("구.")]
    return m[0] if m else ""


# ---------------- 원문 링크 (경남대입정보센터) ----------------
def build_doc_links(link_rows):
    """경남대입정보센터 자료의 '연도'는 센터 게시 연도이므로 학년도로 다시 맞춘다.
    (PDF 원문 확인 결과) 입시결과 = 연도-1 학년도, 모집요강 = 연도 학년도, 기본계획 = 파일명의 학년도"""
    cols = [("plan", "대입전형기본계획"), ("susiGuide", "수시 모집요강"), ("susiResult", "수시 입시결과"),
            ("jungsiGuide", "정시 모집요강"), ("jungsiResult", "정시 입시결과")]
    grouped, homepages = {}, {}
    for r in link_rows:
        if r.get("사용 여부") != "Y":
            continue
        b = base_name(r["이름"])
        if r.get("홈페이지"):
            homepages.setdefault(b, r["홈페이지"].strip())
        y = int(r["연도"]); campus = campus_label(r["이름"]); typ = r.get("대학 구분(간단)", "")
        for k, c in cols:
            p = (r.get(c) or "").strip()
            if not p:
                continue
            if k.endswith("Result"):
                gy = y - 1
            elif k == "plan":
                m = re.search(r"-0-(\d{4})\.\w+$", p)
                gy = int(m.group(1)) if m else y + 1
            else:
                gy = y
            e = grouped.setdefault((b, campus, typ, gy), {"year": gy, "campus": campus, "type": typ})
            e[k] = DOC_BASE + p
    docs = {}
    for (b, _, _, _), e in grouped.items():
        docs.setdefault(b, []).append(e)
    return docs, homepages


def check_links(docs, cache_path):
    cache = {}
    if os.path.exists(cache_path):
        cache = json.load(open(cache_path, encoding="utf-8"))
    urls = sorted({v for lst in docs.values() for e in lst for k, v in e.items() if isinstance(v, str) and v.startswith("http")})
    todo = [u for u in urls if cache.get(u) in (None, 0)]
    print(f"  링크 {len(urls)}개 중 {len(todo)}개 검사")

    def head(u):
        # HEAD를 막는 서버가 있어 첫 1바이트만 GET으로 확인
        for i in range(3):
            try:
                req = urllib.request.Request(u, headers=dict(UA, Range="bytes=0-0"))
                with urllib.request.urlopen(req, timeout=30) as r:
                    return u, r.status
            except urllib.error.HTTPError as e:
                return u, e.code
            except Exception:
                time.sleep(2 * (i + 1))
        return u, 0  # 네트워크 오류: 판단 보류

    with ThreadPoolExecutor(4) as ex:
        for i, (u, st) in enumerate(ex.map(head, todo)):
            cache[u] = st
            if i % 500 == 0:
                json.dump(cache, open(cache_path, "w", encoding="utf-8"))
                print(f"    {i}/{len(todo)}")
    json.dump(cache, open(cache_path, "w", encoding="utf-8"))
    return cache


def apply_link_status(docs, status):
    if not status:
        return docs
    out = {}
    for b, lst in docs.items():
        kept = []
        for e in lst:
            # 404 등 서버가 '없음'으로 응답한 링크만 제외 (네트워크 오류 0 은 유지)
            e2 = {k: v for k, v in e.items() if not (isinstance(v, str) and v.startswith("http") and (status.get(v) or 0) >= 400)}
            if len(e2) > 3:
                kept.append(e2)
        if kept:
            out[b] = kept
    return out


def docs_for(docs, name, kind):
    """kind: '4년제' or '2/3년제'"""
    lst = [e for e in docs.get(base_name(name), []) if not e["type"] or e["type"] == kind]
    lst.sort(key=lambda e: (-e["year"], e["campus"]))
    return [{k: v for k, v in e.items() if k != "type"} for e in lst]


# ---------------- 대학 직접 공개 입결 ----------------
def _src(key):
    x = SOURCES[key]
    return {"source": x["name"], "url": x["url"], "license": x["license"]}


def build_results():
    """대학명 -> 결과 블록 목록. 원자료의 열 이름과 값을 바꾸지 않는다."""
    out = {}
    # 전북대학교: 최근 결과 연도의 수시·정시 (편입학 제외)
    try:
        r = rows("jbnu")
    except FileNotFoundError:
        r = []
    has = [x for x in r if any((x.get(c) or "").strip() for c in ("경쟁률", "학생부등급평균", "수능국어영역평균등급"))]
    if has:
        y = max(x["연도"] for x in has)
        cand = [("모집인원", 1), ("지원인원", 1), ("등록인원", 1), ("경쟁률", 1), ("학생부등급평균", 1), ("수능국어영역평균등급", 1),
                ("수능수학영역평균등급", 1), ("수능탐구영역평균등급", 1), ("수능영어영역평균등급", 1), ("수능한국사영역평균등급", 1), ("전형총점평균", 1)]
        groups = {}
        for x in has:
            if x["연도"] != y or x["모집시기"] == "편입학":
                continue
            groups.setdefault((x["모집시기"], x["전형유형"], x["전형명칭"]), []).append(x)
        order = {"수시모집": 0, "기간자율화": 1, "기간자율화.2차": 2, "정시모집": 3}
        tables = []
        tord = {"학생부교과": 0, "학생부종합": 1, "수능위주": 2, "실기실적": 3}
        main = lambda n: 0 if ("일반학생" in n and "예체능" not in n) or n == "큰사람" else 1
        for (season, typ, name), lst in sorted(groups.items(), key=lambda kv: (order.get(kv[0][0], 9), tord.get(kv[0][1], 9), main(kv[0][2]), kv[0][2])):
            cols = [c for c, _ in cand if any((x.get(c) or "").strip() for x in lst)]
            tables.append({"title": f"{season} · {typ} · {name}", "cols": ["모집단위"] + cols,
                           "rows": [[x["모집단위"]] + [(x.get(c) or "").strip() or "-" for c in cols] for x in lst],
                           "grade": cols.index("학생부등급평균") + 1 if "학생부등급평균" in cols else None})
        out["전북대학교"] = [dict(_src("jbnu"), title=f"{y}학년도 전북대학교 공개 입시결과", tables=tables,
                                  note="전북대학교가 공공데이터포털에 직접 공개한 원자료입니다. 등급·점수는 대학이 공개한 ‘평균’ 값이며 70% 컷이 아닙니다. "
                                       "산출 대상(최초합격자/최종등록자 등)은 원자료에 명시되어 있지 않으므로 전북대학교 입학처 발표 자료와 함께 확인하세요.")]
    # 한국기술교육대학교: 정시 입학성적 (원자료 표기 그대로)
    try:
        r = rows("koreatech")
    except FileNotFoundError:
        r = []
    if r:
        cols = list(r[0].keys())
        out["한국기술교육대학교"] = [dict(_src("koreatech"), title="한국기술교육대학교 정시 신입생 입학성적", tables=[{
            "title": "정시 입학성적 (원자료 열 이름 그대로)", "cols": cols, "rows": [[(x.get(c) or "").strip() or "-" for c in cols] for x in r], "grade": None}],
            note="한국기술교육대학교가 공개한 ‘정시 신입생 입학성적’ 원자료입니다(대학 설명: 학부(과)별 백분율). "
                 "산출 방식(평균/컷, 반영 영역)은 원자료에 명시되어 있지 않아 대학 입학처 확인이 필요합니다.")]
    return out


# ---------------- 4년제 ----------------
def build_univ(raw, docs, homepages, results=None):
    results = results or {}
    years = sorted({int(r["기준연도"]) for r in raw})[-YEARS:]
    y0 = years[0]
    schools = {}
    for r in raw:
        y = int(r["기준연도"])
        if y < y0:
            continue
        code = r["학교코드"]
        s = schools.setdefault(code, {"code": code, "depts": {}})
        # 최신 연도 정보로 학교 메타 갱신
        if y >= s.get("_y", 0):
            s.update(_y=y, name=r["학교명"], campus=r["본분교명"], kind=r["학교종류"], found=r["설립구분"],
                     region=r["지역"], area=r["소재지유형"], status=r["학교상태"])
        key = (r["학과명"], r["주야간구분"], r["학과특성"])
        d = s["depts"].setdefault(key, {"years": {}})
        if y >= d.get("_y", 0):
            d.update(_y=y, college=r["단과대학"], field=r["표준분류_대계열"], mid=r["표준분류_중계열"])
        recruit = n(r["모집인원_정원내"])
        apply_ = n(r["지원자_정원내"])
        enroll = n(r["입학자_정원내_남자"]) + n(r["입학자_정원내_여자"])
        if recruit <= 0 and apply_ <= 0:
            continue
        prev = d["years"].get(y)
        if prev:  # 동일 키 중복 행 합산
            recruit += prev[1]; apply_ += prev[2]; enroll += prev[4]; quota = prev[0] + n(r["입학정원수"])
        else:
            quota = n(r["입학정원수"])
        rate = round(apply_ / recruit, 1) if recruit else None
        # 일부 대학은 모집단위와 입학자 공시 단위가 달라 입학자가 0으로 공시됨 -> 충원율 미표시
        fill = round(enroll / recruit * 100, 1) if recruit and enroll else None
        d["years"][y] = [int(quota), int(recruit), int(apply_), rate, int(enroll), fill]

    index = []
    os.makedirs(os.path.join(OUT, "univ"), exist_ok=True)
    for f in os.listdir(os.path.join(OUT, "univ")):
        os.remove(os.path.join(OUT, "univ", f))
    dept_index = []
    for code, s in schools.items():
        depts = []
        for (name, dn, feat), d in s["depts"].items():
            if not d["years"]:
                continue
            depts.append({"name": name, "dn": dn, "feat": feat, "college": d["college"], "field": d["field"], "mid": d["mid"],
                          "last": max(d["years"]), "y": {str(k): v for k, v in sorted(d["years"].items())}})
        if not depts:
            continue
        depts.sort(key=lambda x: (x["college"], x["name"]))
        last_year = max(x["last"] for x in depts)
        cur = [x for x in depts if x["last"] == last_year]
        rec = sum(x["y"][str(last_year)][1] for x in cur)
        app = sum(x["y"][str(last_year)][2] for x in cur)
        ent = sum(x["y"][str(last_year)][4] for x in cur)
        meta = {"code": code, "name": s["name"], "campus": s["campus"], "kind": s["kind"], "found": s["found"],
                "region": s["region"], "area": s["area"], "lastYear": last_year, "recruit": rec,
                "rate": round(app / rec, 1) if rec else None, "fill": round(ent / rec * 100, 1) if rec and ent else None,
                "depts": len(cur), "docs": bool(docs_for(docs, s["name"], "4년제")),
                "results": bool(results.get(s["name"]) and s["campus"] == "본교")}
        index.append(meta)
        detail = dict(meta, homepage=homepages.get(base_name(s["name"]), ""), departments=depts, documents=docs_for(docs, s["name"], "4년제"),
                      resultData=results.get(s["name"], []) if meta["results"] else [])
        with open(os.path.join(OUT, "univ", f"{code}.json"), "w", encoding="utf-8") as f:
            json.dump(detail, f, ensure_ascii=False, separators=(",", ":"))
        for x in cur:
            v = x["y"][str(last_year)]
            dept_index.append([x["name"], code, x["field"], v[1], v[3]])
    index.sort(key=lambda x: x["name"])
    return index, dept_index, years


# ---------------- 전문대학 ----------------
def build_college(raw, docs, homepages):
    groups = [("일반전형", "일반전형"), ("일반고", "특별전형일반고등 졸업자"), ("특성화고", "특별전형특성화고등 졸업자"),
              ("연계교", "21학년도 이후 특별전형협약을 통한 연계교"), ("고른기회", "21학년도 이후 특별전형고른기회"),
              ("특기자", "특별전형특기자"), ("추천자", "특별전형추천자"), ("대학자체", "특별전형대학자체기준")]
    schools = {}
    for r in raw:
        total_r = n(r["정원내 전체 모집인원"]); total_a = n(r["정원내 전체 지원인원"]); total_e = n(r["정원내 전체 등록인원"])
        if total_r <= 0:
            continue
        s = schools.setdefault(r["대학명"], {"name": r["대학명"], "region": r["지역"], "found": r["설립"], "depts": []})
        by = {}
        for label, prefix in groups:
            col = lambda k: r.get(f"{prefix} {k}", r.get(f"{prefix}{k}", 0))
            rr, aa, ee = n(col("모집인원")), n(col("지원인원")), n(col("등록인원"))
            if rr > 0:
                by[label] = [int(rr), int(aa), round(aa / rr, 1), int(ee)]
        s["depts"].append({"name": r["모집단위"], "dn": r["주야"], "field": r["계열"], "mid": r["중분류"], "years": r["학제"],
                           "quota": int(n(r["입학정원"])), "recruit": int(total_r), "apply": int(total_a),
                           "rate": round(total_a / total_r, 1), "enroll": int(total_e),
                           "fill": round(total_e / total_r * 100, 1), "by": by})
    index = []
    os.makedirs(os.path.join(OUT, "college"), exist_ok=True)
    for f in os.listdir(os.path.join(OUT, "college")):
        os.remove(os.path.join(OUT, "college", f))
    for name, s in sorted(schools.items()):
        cid = re.sub(r"[^0-9A-Za-z가-힣]", "", name)  # 데이터 갱신에도 바뀌지 않는 고정 주소
        rec = sum(d["recruit"] for d in s["depts"]); app = sum(d["apply"] for d in s["depts"]); ent = sum(d["enroll"] for d in s["depts"])
        meta = {"code": cid, "name": name, "region": s["region"], "found": s["found"], "recruit": rec,
                "rate": round(app / rec, 1) if rec else None, "fill": round(ent / rec * 100, 1) if rec else None,
                "depts": len(s["depts"]), "docs": bool(docs_for(docs, name, "2/3년제"))}
        index.append(meta)
        s["depts"].sort(key=lambda d: (d["field"], d["name"]))
        detail = dict(meta, homepage=homepages.get(base_name(name), ""), departments=s["depts"], documents=docs_for(docs, name, "2/3년제"))
        with open(os.path.join(OUT, "college", f"{cid}.json"), "w", encoding="utf-8") as f:
            json.dump(detail, f, ensure_ascii=False, separators=(",", ":"))
    return index


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="다운로드 없이 raw/ 파일로 가공")
    ap.add_argument("--check-links", action="store_true", help="원문 PDF 링크 생존 검사 후 죽은 링크 제외")
    a = ap.parse_args()
    os.makedirs(RAW, exist_ok=True); os.makedirs(OUT, exist_ok=True)

    fetched = {}
    if not a.offline:
        for k in SOURCES:
            print(f"다운로드: {SOURCES[k]['name']}")
            fetched[k] = download(k)
    print("가공 중…")
    docs, homepages = build_doc_links(rows("links"))
    status_path = os.path.join(RAW, "linkcheck.json")
    if a.check_links:
        check_links(docs, status_path)
    status = json.load(open(status_path, encoding="utf-8")) if os.path.exists(status_path) else None
    docs = apply_link_status(docs, status)

    univ_index, dept_index, years = build_univ(rows("univ"), docs, homepages, build_results())
    college_index = build_college(rows("college"), docs, homepages)
    meta = {
        "built": time.strftime("%Y-%m-%d"),
        "univYears": [years[0], years[-1]],
        "collegeYear": 2024,
        "linksChecked": bool(status),
        "sources": [{k2: SOURCES[k][k2] for k2 in ("name", "url", "license")} | ({"file": fetched[k]["dataNm"]} if k in fetched else {}) for k in SOURCES],
    }
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "univ": univ_index, "college": college_index}, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUT, "depts.json"), "w", encoding="utf-8") as f:
        json.dump(dept_index, f, ensure_ascii=False, separators=(",", ":"))
    print(f"완료: 4년제 {len(univ_index)}개교({years[0]}~{years[-1]}학년도), 전문대학 {len(college_index)}개교, 학과 {len(dept_index)}개")


if __name__ == "__main__":
    main()
