#!/usr/bin/env python3
"""수능 지원자 수 예측 — 여러 방법을 같은 조건으로 백테스트해 오차를 비교한다.

데이터: data/stats/suneung_applicants.csv (평가원 원서접수 결과), data/stats/births.csv (통계청 출생아 수)
가정: 출생연도 Y 학생(빠른년생 제외)은 Y+19 학년도 수능을 재학생으로 본다. (예: 2007년생 → 2026학년도)

방법
  재학생  S-naive   작년 재학생 그대로
          S-pop1    출생아 × 작년 '재학생/출생아' 비율        (인구 기반)
          S-pop3    출생아 × 최근 3년 평균 비율               (인구 기반)
          S-popT    출생아 × 최근 5년 비율 추세(선형)          (인구 기반)
  졸업생  G-naive   작년 졸업생 그대로
          G-r1      작년 재학생 × 작년 '졸업생/전년 재학생' 비율 (재수 전환율)
          G-r3      최근 3년 평균 전환율
          G-rT      최근 5년 전환율 추세
  검정고시 E-naive / E-T(최근 3년 추세)
  총 지원자 = 각 조합의 합, 앙상블 = 방법별 예측의 평균

백테스트: 예측 학년도 직전까지의 데이터만 써서 예측하고 실제와 비교 (MAPE = 평균 절대 오차율)
사용: python3 forecast_applicants.py [--from 2022] [--ahead 2031]
"""
import argparse, csv, itertools, os

HERE = os.path.dirname(os.path.abspath(__file__))
STATS = os.path.join(HERE, "..", "data", "stats")


def read(fn, key):
    out = {}
    with open(os.path.join(STATS, fn), encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out[int(r[key])] = {k: (int(v) if v.isdigit() else v) for k, v in r.items()}
    return out


A = read("suneung_applicants.csv", "학년도")
B = {y: r["출생아수"] for y, r in read("births.csv", "출생연도").items()}


def trend(pairs, x):
    """최소제곱 직선 추세로 x 에서의 값"""
    n = len(pairs)
    if n < 2:
        return pairs[-1][1]
    mx = sum(p[0] for p in pairs) / n
    my = sum(p[1] for p in pairs) / n
    sxx = sum((p[0] - mx) ** 2 for p in pairs)
    b = sum((p[0] - mx) * (p[1] - my) for p in pairs) / sxx if sxx else 0
    return my + b * (x - mx)


def hist(t, n):
    return [y for y in range(t - n, t) if y in A]


def S_ratio(y):
    return A[y]["재학생"] / B[y - 19] if (y in A and y - 19 in B) else None


def G_ratio(y):
    return A[y]["졸업생"] / A[y - 1]["재학생"] if (y in A and y - 1 in A) else None


def S_methods(t, S_prev):
    out = {"S-naive": S_prev}
    b = B.get(t - 19)
    if b:
        rs = [(y, S_ratio(y)) for y in hist(t, 5) if S_ratio(y)]
        if rs:
            out["S-pop1"] = b * rs[-1][1]
            out["S-pop3"] = b * sum(r for _, r in rs[-3:]) / len(rs[-3:])
            out["S-popT"] = b * trend(rs, t)
    return out


def G_methods(t, S_prev, G_prev):
    out = {"G-naive": G_prev}
    rs = [(y, G_ratio(y)) for y in hist(t, 5) if G_ratio(y)]
    if rs and S_prev:
        out["G-r1"] = S_prev * rs[-1][1]
        out["G-r3"] = S_prev * sum(r for _, r in rs[-3:]) / len(rs[-3:])
        out["G-rT"] = S_prev * trend(rs, t)
    return out


def E_methods(t, E_prev):
    es = [(y, A[y]["검정고시"]) for y in hist(t, 3)]
    return {"E-naive": E_prev, "E-T": trend(es, t)}


def predict(t, prev):
    """prev: 직전 학년도의 (재학생, 졸업생, 검정고시). 실제값 또는 앞선 예측값"""
    S = S_methods(t, prev[0])
    G = G_methods(t, prev[0], prev[1])
    E = E_methods(t, prev[2])
    return S, G, E


def ape(p, a):
    return abs(p - a) / a * 100


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", type=int, default=2022)
    ap.add_argument("--ahead", type=int, default=2031)
    a = ap.parse_args()
    last = max(A)
    errs = {}
    rows = []
    for t in range(a.start, last + 1):
        prev = (A[t - 1]["재학생"], A[t - 1]["졸업생"], A[t - 1]["검정고시"])
        S, G, E = predict(t, prev)
        act = A[t]
        for k, v in S.items():
            errs.setdefault(k, []).append(ape(v, act["재학생"]))
        for k, v in G.items():
            errs.setdefault(k, []).append(ape(v, act["졸업생"]))
        for k, v in E.items():
            errs.setdefault(k, []).append(ape(v, act["검정고시"]))
        for s, g, e in itertools.product(S, G, E):
            errs.setdefault(f"총({s}+{g}+{e})", []).append(ape(S[s] + G[g] + E[e], act["지원자"]))
        ens = sum(S.values()) / len(S) + sum(G.values()) / len(G) + sum(E.values()) / len(E)
        errs.setdefault("총(앙상블 평균)", []).append(ape(ens, act["지원자"]))
        rows.append((t, act["지원자"], ens))

    n = last - a.start + 1
    print(f"=== 백테스트 {a.start}~{last}학년도 ({n}개 연도, 직전 연도까지 데이터만 사용) ===")
    print("구성요소별 평균 절대 오차율(MAPE) / 최대 오차율")
    for k in sorted([k for k in errs if not k.startswith("총")], key=lambda k: (k[0], sum(errs[k]) / len(errs[k]))):
        v = errs[k]
        print(f"  {k:9s} MAPE {sum(v)/len(v):5.2f}%  최대 {max(v):5.2f}%  ({', '.join(f'{x:.1f}' for x in v)})")
    tot = sorted([k for k in errs if k.startswith("총")], key=lambda k: sum(errs[k]) / len(errs[k]))
    print("\n총 지원자 — 오차 작은 순 상위 8개 조합")
    for k in tot[:8]:
        v = errs[k]
        print(f"  {k:32s} MAPE {sum(v)/len(v):5.2f}%  최대 {max(v):5.2f}%")
    nv = errs["총(S-naive+G-naive+E-naive)"]
    print(f"  (비교: 작년 그대로 MAPE {sum(nv)/len(nv):.2f}%  최대 {max(nv):.2f}%)")
    # 미래(특히 2년 이상)는 출생아 변화를 반영해야 하므로 구성요소별로 가장 정확했던 방법을 조합한다
    pick = lambda p: min([k for k in errs if k.startswith(p)], key=lambda k: sum(errs[k]) / len(errs[k]))
    bs, bg, be = pick("S-pop"), pick("G-"), pick("E-")
    v = errs[f"총({bs}+{bg}+{be})"]
    print(f"\n=== 향후 예측 ({last + 1}~{a.ahead}학년도) — 구성요소별 최적 방법 {bs}+{bg}+{be} (백테스트 MAPE {sum(v)/len(v):.2f}%, 최대 {max(v):.2f}%) ===")
    prev = (A[last]["재학생"], A[last]["졸업생"], A[last]["검정고시"])
    for t in range(last + 1, a.ahead + 1):
        if t - 19 not in B:
            print(f"  {t}: 출생아 자료 없음 ({t-19}년생)")
            break
        S, G, E = predict(t, prev)
        s, g, e = S.get(bs, S["S-naive"]), G.get(bg, G["G-naive"]), E.get(be, E["E-naive"])
        print(f"  {t}학년도 ({t-19}년생 {B[t-19]:,}명): 지원자 약 {s+g+e:,.0f}명 = 재학생 {s:,.0f} + 졸업생 {g:,.0f} + 검정고시 {e:,.0f}")
        prev = (s, g, e)
        A[t] = {"지원자": s + g + e, "재학생": s, "졸업생": g, "검정고시": e, "검증": "예측"}
    print("\n주의: 1년 뒤보다 2년 이상 뒤 예측은 오차가 누적됩니다. 의대 정원·수능 제도 변경 같은 정책 변화는 반영되지 않습니다.")
    unv = [y for y, r in A.items() if str(r["검증"]).startswith("미검증")]
    unv = sorted(unv)
    if unv:
        print(f"데이터 검증 필요: 지원자 {unv}학년도, 출생아 수 전체 (평가원 보도자료·KOSIS 원문 대조 전)")


if __name__ == "__main__":
    main()
