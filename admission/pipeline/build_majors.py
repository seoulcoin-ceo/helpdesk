#!/usr/bin/env python3
"""학과 정보 만들기

1) 공시 통계 (인증키 불필요): 대학마다 다른 학과 이름(경영학과·경영학부·경영학전공 …)을 묶어
   학과별 개설 대학, 전국 모집·지원·경쟁률·충원율 10개년 추이, 미달 비율을 만든다.
2) 커리어넷 학과정보 (선택, 인증키 필요): 학과 개요·흥미·적성·주요 교과목·진출 직업·관련 자격·고교 관련 과목.
   커리어넷(career.go.kr) 회원가입 → Open API 신청·승인 → 인증키
   python3 build_majors.py --careernet-key 인증키

출력: data/majors/index.json, data/majors/{id}.json (+ careernet 원자료 data/majors/careernet/{seq}.json)
"""
import argparse, collections, glob, hashlib, json, os, re, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
OUT = os.path.join(DATA, "majors")
SKIP_KIND = ("사이버대학(대학)", "방송통신대학", "각종학교(대학)")
CN = "https://www.career.go.kr/cnet/openapi/getOpenApi"


def base_name(n):
    s = re.sub(r"\(.*?\)|\[.*?\]", "", n).strip()
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"(학과|학부|전공|과|계열|트랙)$", "", s)
    s = re.sub(r"학$", "", s) if len(s) > 2 else s   # 경영학 → 경영
    return s or n


def mid_id(key):
    return hashlib.md5(key.encode()).hexdigest()[:10]


def build_stats():
    idx = json.load(open(os.path.join(DATA, "index.json"), encoding="utf-8"))
    y0, y1 = idx["meta"]["univYears"]
    years = [str(y) for y in range(y0, y1 + 1)]
    groups = collections.defaultdict(lambda: {"names": collections.Counter(), "fields": collections.Counter(), "mids": collections.Counter(),
                                              "series": {y: [0, 0, 0, 0] for y in years}, "univ": []})
    for u in idx["univ"]:
        d = json.load(open(os.path.join(DATA, "univ", u["code"] + ".json"), encoding="utf-8"))
        if d["kind"] in SKIP_KIND:
            continue
        for x in d["departments"]:
            g = groups[base_name(x["name"])]
            g["names"][x["name"]] += 1
            g["fields"][x.get("field") or ""] += 1
            g["mids"][x.get("mid") or ""] += 1
            for y in years:
                v = x["y"].get(y)
                if v and v[1]:
                    s = g["series"][y]
                    s[0] += v[1]; s[1] += v[2] or 0; s[2] += v[4] or 0; s[3] += 1
            v = x["y"].get(str(y1))
            if v and v[1]:
                g["univ"].append({"code": d["code"], "univ": d["name"] + (" (" + d["campus"] + ")" if d.get("campus") and d["campus"] != "본교" else ""),
                                  "region": d["region"], "dept": x["name"], "dn": x.get("dn", ""), "rec": v[1], "rate": v[3],
                                  "fill": v[5] if (v[5] is not None and v[4]) else None})
    os.makedirs(OUT, exist_ok=True)
    index = []
    for key, g in groups.items():
        if not g["univ"]:
            continue  # 최근 학년도에 없는(폐지) 학과
        mid = mid_id(key)
        series = [{"y": int(y), "rec": s[0], "app": s[1], "rate": round(s[1] / s[0], 2) if s[0] else None,
                   "fill": round(s[2] / s[0] * 100, 1) if s[0] and s[2] else None, "n": s[3]} for y, s in g["series"].items()]
        fills = [u["fill"] for u in g["univ"] if u["fill"] is not None]
        last = series[-1]
        item = {"id": mid, "key": key, "name": g["names"].most_common(1)[0][0], "aliases": [n for n, _ in g["names"].most_common(12)],
                "field": g["fields"].most_common(1)[0][0], "mid": g["mids"].most_common(1)[0][0],
                "nUniv": len(g["univ"]), "rec": last["rec"], "rate": last["rate"],
                "underShare": round(sum(1 for f in fills if f < 100) / len(fills), 3) if fills else None}
        index.append(item)
        detail = dict(item, series=series, univ=sorted(g["univ"], key=lambda u: -(u["rate"] or 0)), baseYear=y1)
        json.dump(detail, open(os.path.join(OUT, mid + ".json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    index.sort(key=lambda i: -i["rec"])
    return index, y1


def cn_get(key, **q):
    q.update({"apiKey": key, "svcType": "api", "svcCode": "MAJOR" if "majorSeq" not in q else "MAJOR_VIEW", "contentType": "json"})
    with urllib.request.urlopen(urllib.request.Request(CN + "?" + urllib.parse.urlencode(q), headers={"User-Agent": "ipsi-compass"}), timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def careernet(index, key):
    """커리어넷 대학 학과 목록 → 우리 학과와 이름으로 연결 → 학과별 상세 받기"""
    os.makedirs(os.path.join(OUT, "careernet"), exist_ok=True)
    items, page = [], 1
    while True:
        j = cn_get(key, gubun="univ_list", thisPage=page, perPage=500)
        c = (j.get("dataSearch") or {}).get("content") or []
        if not c:
            if page == 1:
                print("커리어넷 응답:", json.dumps(j, ensure_ascii=False)[:300])
            break
        items += c
        if len(c) < 500:
            break
        page += 1
        time.sleep(0.5)
    print(f"커리어넷 학과 {len(items)}개")
    # 커리어넷 학과마다 '세부 학과명(facilName)' 목록이 있다 → 우리 학과 기준명과 맞춘다
    by_base = {}
    for it in items:
        names = [it.get("mClass", "")] + [n.strip() for n in str(it.get("facilName", "")).split(",")]
        for n in names:
            if n:
                by_base.setdefault(base_name(n), it)
    linked = 0
    for m in index:
        it = by_base.get(m["key"]) or next((by_base[base_name(a)] for a in m["aliases"] if base_name(a) in by_base), None)
        if not it:
            continue
        seq = str(it.get("majorSeq"))
        fn = os.path.join(OUT, "careernet", seq + ".json")
        if not os.path.exists(fn):
            try:
                v = cn_get(key, gubun="univ_list", majorSeq=seq)
                json.dump(v, open(fn, "w", encoding="utf-8"), ensure_ascii=False)
                time.sleep(0.4)
            except Exception as e:
                print("  상세 실패", seq, e)
                continue
        m["cn"] = seq
        linked += 1
    print(f"우리 학과 {len(index)}개 중 {linked}개를 커리어넷 학과정보와 연결")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--careernet-key", default=os.environ.get("CAREERNET_KEY", ""))
    a = ap.parse_args()
    index, y1 = build_stats()
    if a.careernet_key:
        careernet(index, a.careernet_key)
    else:
        # 이전에 받아 둔 커리어넷 연결 정보는 유지
        old = os.path.join(OUT, "index.json")
        if os.path.exists(old):
            prev = {m["id"]: m.get("cn") for m in json.load(open(old, encoding="utf-8"))["majors"]}
            for m in index:
                if prev.get(m["id"]):
                    m["cn"] = prev[m["id"]]
    json.dump({"built": time.strftime("%Y-%m-%d"), "baseYear": y1, "majors": index}, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"학과 {len(index)}개 → data/majors/ (커리어넷 연결 {sum(1 for m in index if m.get('cn'))}개)")


if __name__ == "__main__":
    main()
