#!/usr/bin/env python3
"""학과별 미달(신입생 미충원) 예측 — 여러 방법을 같은 조건으로 백테스트하고, 다음 학년도 위험 학과를 분류한다.

미달 정의: 그 학년도 신입생 충원율(정원내 입학자 ÷ 정원내 모집인원) 100% 미만 (대학알리미 공시)
입력: data/index.json, data/univ/*.json (10개년 학과별 모집·지원·경쟁률·입학자·충원율)
       data/stats/funding_restricted.csv (선택: 교육부 재정지원제한대학 명단 — 있으면 변수로 사용)
출력: data/risk.json (사이트 '미달 위험' 화면용)

방법
  R-fill   작년 충원율 100% 미만이면 미달 예상            (경험칙)
  R-rate   작년 경쟁률 3:1 미만이면 미달 예상              (경험칙: 수시 6회+정시 3회 복수지원)
  R-mix    R-fill 이거나, 비수도권이면서 경쟁률 4:1 미만    (경험칙)
  LR       로지스틱 회귀 (학과·대학의 최근 충원율·경쟁률·추세·지역·규모 등)
백테스트: 학년도 t 를 예측할 때 t-1 까지의 자료만 사용
사용: python3 undersub.py
"""
import glob, json, math, os, csv
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
CAPITAL = ("서울", "경기", "인천")
SKIP_KIND = ("사이버대학(대학)", "방송통신대학", "각종학교(대학)")


def load():
    idx = json.load(open(os.path.join(DATA, "index.json"), encoding="utf-8"))
    restricted = set()
    fn = os.path.join(DATA, "stats", "funding_restricted.csv")
    if os.path.exists(fn):
        for r in csv.DictReader(open(fn, encoding="utf-8-sig")):
            restricted.add(r["대학명"].strip())
    univs = []
    for u in idx["univ"]:
        d = json.load(open(os.path.join(DATA, "univ", u["code"] + ".json"), encoding="utf-8"))
        if d["kind"] in SKIP_KIND:
            continue
        # 대학 전체 연도별 합계
        tot = {}
        for x in d["departments"]:
            for y, v in x["y"].items():
                t = tot.setdefault(int(y), [0, 0, 0])
                t[0] += v[1] or 0; t[1] += v[2] or 0; t[2] += v[4] or 0
        d["_tot"] = {y: {"rec": t[0], "app": t[1], "ent": t[2],
                         "rate": t[1] / t[0] if t[0] else None,
                         "fill": t[2] / t[0] * 100 if t[0] and t[2] else None} for y, t in tot.items()}
        d["_restricted"] = any(n in d["name"] for n in restricted) if restricted else False
        univs.append(d)
    return idx, univs, bool(restricted)


def dept_year(x, y):
    v = x["y"].get(str(y))
    if not v or not v[1]:
        return None
    return {"rec": v[1], "app": v[2] or 0, "rate": v[3] if v[3] is not None else (v[2] or 0) / v[1],
            "ent": v[4] or 0, "fill": v[5] if (v[5] is not None and v[4]) else None}


def features(u, x, t):
    """학년도 t 를 예측하기 위한 변수 (t-1 이전 자료만)"""
    p = dept_year(x, t - 1)
    if not p or p["fill"] is None:
        return None
    p3 = [dept_year(x, t - k) for k in (1, 2, 3)]
    miss = sum(1 for q in p3 if q and q["fill"] is not None and q["fill"] < 100)
    r3 = dept_year(x, t - 3)
    ut = u["_tot"].get(t - 1) or {}
    lr = lambda r: math.log((r or 0) + 0.2)
    return {
        "fill": min(p["fill"], 130) / 100,
        "lrate": lr(p["rate"]),
        "trend": (lr(p["rate"]) - lr(r3["rate"])) if r3 else 0.0,
        "miss3": miss / 3,
        "ufill": min(ut.get("fill") or 100, 130) / 100,
        "ulrate": lr(ut.get("rate")),
        "capital": 1.0 if any(c in (u["region"] or "") for c in CAPITAL) else 0.0,
        "lrec": math.log(p["rec"] + 1),
        "restricted": 1.0 if u["_restricted"] else 0.0,
        "_rate": p["rate"], "_fill": p["fill"],
    }


RELIGION = ("신학", "선학", "목회", "선교", "불교", "승가", "기독교", "교회", "성서", "사목", "원불교", "종교")


def tags_of(x):
    t = []
    if any(k in x["name"] for k in RELIGION) or x.get("mid") in ("종교학", "신학"):
        t.append("종교")   # 성직자 양성 등: 신앙·추천 요건이 있을 수 있음
    if "예체능" in (x.get("field") or ""):
        t.append("예체능")  # 실기 시험이 있는 경우가 많음
    if (x.get("dn") or "") not in ("", "주간"):
        t.append(x["dn"])
    return t


FEATS = ["fill", "lrate", "trend", "miss3", "ufill", "ulrate", "capital", "lrec", "restricted"]


def dataset(univs, years):
    rows = []
    for u in univs:
        for x in u["departments"]:
            for t in years:
                f = features(u, x, t)
                if not f:
                    continue
                cur = dept_year(x, t)
                y = None if (not cur or cur["fill"] is None) else (1 if cur["fill"] < 100 else 0)
                rows.append((u, x, t, f, y))
    return rows


def fit_lr(X, y, l2=1.0, iters=600, lr=0.5):
    mu, sd = X.mean(0), X.std(0) + 1e-9
    Z = (X - mu) / sd
    Z = np.hstack([Z, np.ones((len(Z), 1))])
    w = np.zeros(Z.shape[1])
    for _ in range(iters):
        p = 1 / (1 + np.exp(-Z @ w))
        g = Z.T @ (p - y) / len(y) + l2 * np.r_[w[:-1], 0] / len(y)
        w -= lr * g
    return lambda Xn: 1 / (1 + np.exp(-(np.hstack([(Xn - mu) / sd, np.ones((len(Xn), 1))]) @ w))), (w, mu, sd)


def auc(p, y):
    order = np.argsort(p)
    ranks = np.empty(len(p)); ranks[order] = np.arange(1, len(p) + 1)
    pos = y == 1
    n1, n0 = pos.sum(), (~pos).sum()
    return (ranks[pos].sum() - n1 * (n1 + 1) / 2) / (n1 * n0) if n1 and n0 else float("nan")


def prf(pred, y):
    tp = int((pred & (y == 1)).sum()); fp = int((pred & (y == 0)).sum()); fn = int((~pred & (y == 1)).sum())
    p = tp / (tp + fp) if tp + fp else 0; r = tp / (tp + fn) if tp + fn else 0
    return p, r, (2 * p * r / (p + r) if p + r else 0)


def main():
    idx, univs, has_restricted = load()
    y0, y1 = idx["meta"]["univYears"]
    all_rows = dataset(univs, range(y0 + 1, y1 + 2))
    labeled = [r for r in all_rows if r[4] is not None]
    print(f"학과-연도 사례 {len(labeled):,}건 (미달 {sum(r[4] for r in labeled):,}건)" + ("" if has_restricted else " · 재정지원제한 명단 없음(변수 제외)"))

    rules = {
        "R-fill": lambda f: f["_fill"] < 100,
        "R-rate": lambda f: f["_rate"] < 3,
        "R-mix": lambda f: f["_fill"] < 100 or (f["capital"] == 0 and f["_rate"] < 4),
    }
    res = {k: [] for k in list(rules) + ["LR(0.5)", "LR(최적)"]}
    aucs = []
    bt_years = list(range(y0 + 3, y1 + 1))
    thr_best = []
    for t in bt_years:
        tr = [r for r in labeled if r[2] < t]
        te = [r for r in labeled if r[2] == t]
        if not tr or not te:
            continue
        yt = np.array([r[4] for r in te])
        for k, fn in rules.items():
            res[k].append(prf(np.array([fn(r[3]) for r in te]), yt))
        X = np.array([[r[3][k] for k in FEATS] for r in tr]); Y = np.array([r[4] for r in tr], float)
        model, _ = fit_lr(X, Y)
        # 임계값은 학습 기간 안에서 F1 이 가장 높은 값으로 정한다 (시험 연도는 보지 않음)
        ptr = model(X)
        thr = max(np.arange(0.2, 0.71, 0.05), key=lambda h: prf(ptr >= h, Y.astype(int))[2])
        thr_best.append(thr)
        p = model(np.array([[r[3][k] for k in FEATS] for r in te]))
        res["LR(0.5)"].append(prf(p >= 0.5, yt))
        res["LR(최적)"].append(prf(p >= thr, yt))
        aucs.append(auc(p, yt))

    print(f"\n=== 백테스트 {bt_years[0]}~{bt_years[-1]}학년도 (각 연도를 그 전 자료로만 예측) ===")
    print(f"{'방법':10s} {'정밀도':>6s} {'재현율':>6s} {'F1':>6s}   (정밀도: 미달 예상 중 실제 미달 비율 / 재현율: 실제 미달 중 맞힌 비율)")
    summary = {}
    for k, v in res.items():
        if not v:
            continue
        m = np.mean(v, axis=0)
        summary[k] = {"precision": round(float(m[0]), 3), "recall": round(float(m[1]), 3), "f1": round(float(m[2]), 3)}
        print(f"{k:10s} {m[0]*100:5.1f}% {m[1]*100:5.1f}% {m[2]*100:5.1f}%")
    print(f"LR 판별력 AUC 평균 {np.nanmean(aucs):.3f} (0.5=무작위, 1=완벽)")

    # 최종 모델: 전체 자료로 학습, 다음 학년도(y1+1) 예측
    X = np.array([[r[3][k] for k in FEATS] for r in labeled]); Y = np.array([r[4] for r in labeled], float)
    model, (w, mu, sd) = fit_lr(X, Y)
    thr = float(np.median(thr_best)) if thr_best else 0.5
    print("\n변수 영향(표준화 계수, +면 미달 위험 증가): " + ", ".join(f"{k} {w[i]:+.2f}" for i, k in enumerate(FEATS)))
    nxt = y1 + 1
    fut = [r for r in all_rows if r[2] == nxt]
    p = model(np.array([[r[3][k] for k in FEATS] for r in fut])) if fut else []
    out_u = {}
    for (u, x, t, f, _), pr in zip(fut, p):
        level = "높음" if pr >= max(thr, 0.5) else ("보통" if pr >= thr else "낮음")
        ou = out_u.setdefault(u["code"], {"code": u["code"], "name": u["name"], "campus": u.get("campus", ""), "region": u["region"],
                                          "kind": u["kind"], "restricted": u["_restricted"],
                                          "fill": round((u["_tot"].get(y1) or {}).get("fill") or 0, 1),
                                          "rate": round((u["_tot"].get(y1) or {}).get("rate") or 0, 2),
                                          "fillTrend": [round((u["_tot"].get(y) or {}).get("fill") or 0, 1) for y in range(y1 - 4, y1 + 1)],
                                          "depts": []})
        if level != "낮음":
            ou["depts"].append({"name": x["name"], "dn": x.get("dn", ""), "field": x.get("field", ""), "p": round(float(pr), 3), "level": level,
                                "fill": f["_fill"], "rate": round(f["_rate"], 2), "rec": dept_year(x, y1)["rec"],
                                "tags": tags_of(x)})
    ul = []
    for ou in out_u.values():
        ou["depts"].sort(key=lambda d: -d["p"])
        n_all = sum(1 for (u, *_r) in fut if u["code"] == ou["code"])
        ou["nDepts"] = n_all
        ou["nHigh"] = sum(1 for d in ou["depts"] if d["level"] == "높음")
        ou["shareHigh"] = round(ou["nHigh"] / n_all, 3) if n_all else 0
        ou["religious"] = bool(ou["depts"]) and all("종교" in d["tags"] for d in ou["depts"])
        ou["level"] = "높음" if (ou["shareHigh"] >= 0.3 or (ou["fill"] and ou["fill"] < 95)) else ("보통" if ou["nHigh"] or ou["depts"] else "낮음")
        ul.append(ou)
    ul.sort(key=lambda o: (-{"높음": 2, "보통": 1, "낮음": 0}[o["level"]], -o["shareHigh"], o["fill"] or 0))
    out = {"built": __import__("time").strftime("%Y-%m-%d"), "baseYear": y1, "predictYear": nxt, "threshold": round(thr, 3),
           "backtest": {"years": [bt_years[0], bt_years[-1]], "methods": summary, "auc": round(float(np.nanmean(aucs)), 3)},
           "features": {k: round(float(w[i]), 3) for i, k in enumerate(FEATS)}, "usedRestricted": has_restricted,
           "univ": [o for o in ul if o["level"] != "낮음"]}
    json.dump(out, open(os.path.join(DATA, "risk.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    hi = [o for o in ul if o["level"] == "높음"]
    print(f"\n{nxt}학년도 예측: 미달 위험 높음 대학 {len(hi)}곳, 위험 학과(높음) {sum(o['nHigh'] for o in ul)}개 / 보통 이상 {sum(len(o['depts']) for o in ul)}개")
    print("위험 높은 대학 예: " + ", ".join(f"{o['name']}({o['region']}, 충원율 {o['fill']}%, 위험학과 {o['nHigh']}/{o['nDepts']})" for o in hi[:12]))
    print("→ data/risk.json")


if __name__ == "__main__":
    main()
