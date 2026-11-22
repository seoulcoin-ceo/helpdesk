#!/usr/bin/env python3
"""입결 사례 수 집계 — 예측 모델(통계·CBR·경험칙)에 쓸 수 있는 '사례'가 얼마나 확보됐는지 센다.

사례 1건 = (대학, 학년도, 수시/정시, 표 제목(전형), 모집단위 행) 중 성적 값(등급·백분위·점수 등)이 하나 이상 있는 행.

입력: data/ipsi/*.json, data/ipsi_index.json (extract_results.py 결과)
출력: 화면 요약 + data/ipsi_coverage.json
사용: python3 coverage_report.py
"""
import collections, glob, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
UNIT = ("모집단위", "학과", "학부", "전공")
SCORE = ("등급", "백분위", "환산", "점수", "컷", "CUT", "cut", "평균", "최저", "최고", "70%", "80%", "50%")
NUM = re.compile(r"^\d{1,4}(\.\d+)?$")


def head_names(t):
    names = []
    for line in t.get("head", []):
        for cell in line:
            names.append(str(cell[0]))
    return names


def cases(t):
    names = head_names(t)
    joined = " ".join(names)
    if not any(u in joined for u in UNIT):
        return 0, False
    has_score = any(s in joined for s in SCORE)
    n = 0
    for r in t.get("rows", []):
        vals = [c for c in r if c and NUM.match(c.replace(",", ""))]
        # 모집인원·지원인원만 있는 행이 아니라 성적 값이 있을 법한 행: 소수점 값이 있거나 숫자 칸이 3개 이상
        if any("." in v for v in vals) or len(vals) >= 3:
            n += 1
    return n, has_score


def main():
    idx = {u["code"]: u for u in json.load(open(os.path.join(DATA, "index.json"), encoding="utf-8"))["univ"]}
    by_year = collections.Counter()
    by_year_score = collections.Counter()
    univ_years = collections.defaultdict(set)
    status = collections.Counter()
    per_univ = {}
    seen = set()  # 여러 캠퍼스에 같은 원문이 등록된 경우 한 번만 센다
    for f in glob.glob(os.path.join(DATA, "ipsi", "*.json")):
        code = os.path.splitext(os.path.basename(f))[0]
        total = 0
        for doc in json.load(open(f, encoding="utf-8")):
            if doc.get("url") in seen:
                continue
            seen.add(doc.get("url"))
            status[(doc["year"], doc.get("status"))] += 1
            for t in doc.get("tables", []):
                n, sc = cases(t)
                if not n:
                    continue
                key = (doc["year"], doc.get("season", ""))
                by_year[key] += n
                if sc:
                    by_year_score[key] += n
                    univ_years[code].add(doc["year"])
                total += n
        if total:
            per_univ[code] = total

    years = sorted({y for y, _ in by_year} | {y for y, _ in status})
    print("=== 학년도별 처리 상태 (PDF 수) ===")
    for y in years:
        st = {s: c for (yy, s), c in status.items() if yy == y}
        print(f"{y}: " + ", ".join(f"{k} {v}" for k, v in sorted(st.items(), key=lambda x: str(x[0]))))
    print("\n=== 학년도·수시/정시별 사례 수 (성적 열이 있는 표의 모집단위 행) ===")
    for k in sorted(by_year_score):
        print(f"{k[0]} {k[1]:6s} {by_year_score[k]:>7,}")
    tot = sum(by_year_score.values())
    multi = {c: ys for c, ys in univ_years.items() if len(ys) >= 3}
    print(f"\n총 사례: {tot:,}건 / 대학 {len(univ_years)}곳")
    print(f"3개 학년도 이상 이어지는 대학 (연도별 변화 분석 가능): {len(multi)}곳")
    top = sorted(per_univ.items(), key=lambda x: -x[1])[:15]
    print("\n사례가 많은 대학: " + ", ".join(f"{idx.get(c, {}).get('name', c)} {n}" for c, n in top))
    out = {
        "total_cases": tot,
        "univ_with_cases": len(univ_years),
        "univ_3plus_years": len(multi),
        "by_year": {f"{k[0]} {k[1]}": v for k, v in sorted(by_year_score.items())},
        "status": {f"{y} {s}": c for (y, s), c in sorted(status.items(), key=lambda x: (x[0][0], str(x[0][1])))},
        "per_univ": {idx.get(c, {}).get("name", c): {"cases": n, "years": sorted(univ_years.get(c, []))} for c, n in sorted(per_univ.items(), key=lambda x: -x[1])},
    }
    json.dump(out, open(os.path.join(DATA, "ipsi_coverage.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("\n저장: data/ipsi_coverage.json")


if __name__ == "__main__":
    main()
