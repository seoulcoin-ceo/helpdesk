#!/usr/bin/env python3
"""대학 공식 입시결과 표(data/ipsi) → 학과별 '내신 등급 합격선' 표준화 (유료 기능 '내신으로 갈 수 있는 대학' 용)

표마다 열 이름이 제각각이라 다음 순서로 합격선 열을 고른다 (같은 표·학년도 안에서):
  70%cut > 80%cut > 최종등록자 평균 > 평균 > 50%cut > 최종등록자 최저
등급 값은 1.00~9.00 사이 숫자만 받는다. 수능·백분위·환산점수 열은 제외한다.
출력: api/cuts.json (웹에 공개되지 않는 API 폴더 — 유료 회원에게만 API 로 제공)
"""
import glob, json, os, re, time

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
OUT = os.path.join(HERE, "..", "api", "cuts.json")
UNIT = ("모집단위", "학과", "학부", "전공")
SKIP = ("수능", "백분위", "환산", "점수", "표준편차", "경쟁", "인원", "순위", "충원", "예비", "지원", "모집인", "입학자", "추합")
PRI = [("70%", 1), ("80%", 2), ("최종등록", 3), ("평균", 4), ("50%", 5)]
NUM = re.compile(r"^\d(\.\d{1,3})?$")


def col_labels(t):
    n = t.get("ncol") or max((c[1] + c[2] for line in t["head"] for c in line), default=0)
    labels = [""] * n
    for line in t["head"]:
        for name, col, span, _ in line:
            for k in range(col, min(col + span, n)):
                labels[k] = (labels[k] + " " + str(name)).strip()
    rows = t["rows"]
    # 첫 행이 하위 머리글(평균·80% 등)인 경우
    if rows and sum(1 for c in rows[0] if c and not re.match(r"^[\d.,:%\-]+$", c)) >= 2 and sum(1 for c in rows[0] if c and NUM.match(c)) == 0:
        for k, c in enumerate(rows[0][:n]):
            if c:
                labels[k] = (labels[k] + " " + c).strip()
        rows = rows[1:]
    return labels, rows


def pick_cut(labels):
    best = None
    for k, lab in enumerate(labels):
        l = lab.replace(" ", "")
        if any(s in l for s in SKIP) and not ("등급" in l and "환산" not in l):
            continue
        if "최고" in l:
            continue
        rank = None
        for key, r in PRI:
            if key in l:
                rank = r if not (key == "평균" and "최초" in l) else 6
                break
        if rank is None and "최저" in l and "최종" in l:
            rank = 7
        if rank is None:
            continue
        # 여러 학년도 열이 있으면 최신 학년도 우선
        y = re.findall(r"20\d\d", lab)
        yr = int(y[0]) if y else 0
        cand = (rank, -yr, k)
        if best is None or cand < best:
            best = cand
    return best


def track_of(text):
    t = text.replace(" ", "")
    if "종합" in t:
        return "종합"
    if any(k in t for k in ("교과", "학업성적", "지역균형", "학교장", "일반학생", "고교추천", "학생부우수", "일반전형")):
        return "교과"
    if "인재" in t or "서류" in t:
        return "종합"
    return "기타"


def main():
    idx = {u["code"]: u for u in json.load(open(os.path.join(DATA, "index.json"), encoding="utf-8"))["univ"]}
    out, seen = [], set()
    for f in glob.glob(os.path.join(DATA, "ipsi", "*.json")):
        code = os.path.splitext(os.path.basename(f))[0]
        u = idx.get(code, {})
        for doc in json.load(open(f, encoding="utf-8")):
            if "수시" not in doc.get("season", ""):
                continue
            for t in doc["tables"]:
                labels, rows = col_labels(t)
                ucol = next((k for k, l in enumerate(labels) if any(x in l for x in UNIT)), None)
                pc = pick_cut(labels)
                if ucol is None or not pc:
                    continue
                rank, negy, ccol = pc
                tcol = next((k for k, l in enumerate(labels) if "전형" in l), None)
                ylab = re.findall(r"20\d\d", labels[ccol])
                year = int(ylab[0]) if ylab else doc["year"]
                for r in rows:
                    if len(r) <= max(ucol, ccol):
                        continue
                    dept = (r[ucol] or "").strip()
                    val = (r[ccol] or "").replace(" ", "")
                    if not dept or not NUM.match(val) or any(x in dept for x in ("계", "합계", "평균", "전체")) and len(dept) <= 3:
                        continue
                    v = float(val)
                    if not 1.0 <= v <= 9.0:
                        continue
                    jh = (r[tcol] if tcol is not None and tcol < len(r) else "") or t.get("title", "")
                    key = (code, year, dept, jh, round(v, 2))
                    if key in seen:
                        continue
                    seen.add(key)
                    out.append({"u": code, "un": u.get("name", code), "rg": u.get("region", ""), "y": year, "d": dept,
                                "j": (jh or "")[:60], "tr": track_of(jh + " " + t.get("title", "")), "c": round(v, 2),
                                "ct": labels[ccol][-30:], "pg": t.get("page"), "src": doc["url"]})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({"built": time.strftime("%Y-%m-%d"), "scale": 9, "rows": out}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    univs = {r["u"] for r in out}
    from collections import Counter
    print(f"합격선 {len(out):,}건 / 대학 {len(univs)}곳 · 전형 {dict(Counter(r['tr'] for r in out))} · 학년도 {dict(Counter(r['y'] for r in out))}")
    for r in out[:6]:
        print("  예:", r["un"], r["y"], r["tr"], r["d"], r["c"], "(", r["ct"], ")")
    print("→", OUT)


if __name__ == "__main__":
    main()
