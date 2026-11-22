#!/usr/bin/env python3
"""검색엔진(네이버·구글)용 4년제 대학별 정적 페이지 생성

data/ 의 공시 JSON(build_data.py 결과)을 읽어 다음을 만든다.
  u/index.html          지역별 4년제 대학 목록
  u/{학교코드}.html      대학별 10개년 경쟁률·학과별 경쟁률·공식 원문 링크
  sitemap.xml, robots.txt
자바스크립트 없이도 모든 수치가 보이도록 서버에서 미리 그린 HTML이다.
"""
import html, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "u")
SITE = os.environ.get("SITE_URL", "https://isjung.com").rstrip("/")
DOC_KINDS = [("susiResult", "수시 입시결과"), ("jungsiResult", "정시 입시결과"), ("susiGuide", "수시 모집요강"),
             ("jungsiGuide", "정시 모집요강"), ("plan", "전형 기본계획")]


def e(s):
    return html.escape("" if s is None else str(s), quote=True)


def rate(v):
    return "-" if v is None else f"{v:.1f}"


def num(v):
    return "-" if v is None else f"{v:,}"


def layout(title, desc, canonical, body, jsonld=None):
    ld = f'<script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>' if jsonld else ""
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}" />
<link rel="canonical" href="{e(canonical)}" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="ko_KR" />
<meta property="og:site_name" content="입시나침반" />
<meta property="og:title" content="{e(title)}" />
<meta property="og:description" content="{e(desc)}" />
<meta property="og:url" content="{e(canonical)}" />
<link rel="stylesheet" href="/style.css?v=3" />
{ld}
</head>
<body>
<header class="site-header"><div class="container nav-wrap">
<a class="brand" href="/"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="14"/><path d="M16 6l4 10-4 10-4-10z"/></svg></span>
<span><strong>입시나침반</strong><small>공식 공시 데이터로 보는 대학 입시</small></span></a>
<nav class="site-nav static-nav" aria-label="주요 메뉴"><a href="/u/">4년제 대학</a><a href="/#/dept">학과 찾기</a><a href="/#/guide">입시 가이드</a><a href="/#/data">데이터 출처</a></nav>
</div></header>
<main class="container section">
{body}
</main>
<footer class="site-footer"><div class="container"><p><strong>입시나침반</strong></p>
<p class="muted">모든 수치는 교육부 대학알리미 공시와 각 대학이 발표한 공식 자료를 그대로 사용하며, 임의로 추정한 합격선은 제공하지 않습니다. 최종 지원 전에는 반드시 해당 대학 입학처의 최신 모집요강을 확인하세요.</p></div></footer>
</body>
</html>
"""


def univ_page(d, meta):
    y0, y1 = meta["univYears"]
    years = [str(y) for y in range(y0, y1 + 1)]
    name = d["name"] + (f"({d['campus']})" if d.get("campus") and d["campus"] != "본교" else "")
    depts = d["departments"]
    tot = []
    for y in years:
        r = sum(x["y"][y][1] for x in depts if y in x["y"])
        a = sum(x["y"][y][2] for x in depts if y in x["y"])
        tot.append((y, r, a, round(a / r, 1) if r else None))

    cur = [x for x in depts if x["last"] == d["lastYear"]]
    cur.sort(key=lambda x: (x["college"] or "", x["name"]))
    ly = str(d["lastYear"])
    top = sorted(cur, key=lambda x: -(x["y"][ly][3] or 0))[:3]

    desc = (f"{name} {y0}~{y1}학년도 {len(years)}개년 학과별 경쟁률·모집인원·충원율과 대학 공식 수시·정시 입시결과 원문. "
            f"{d['lastYear']}학년도 정원내 모집 {num(d['recruit'])}명, 경쟁률 {rate(d['rate'])}:1. 교육부 대학알리미 공시 기준.")
    b = [f'<p class="crumb"><a href="/u/">4년제 대학</a> › {e(d["region"])}</p>',
         f'<div class="detail-head"><div><h1>{e(name)} 학과별 경쟁률·입시결과</h1>',
         f'<p class="muted">{e(" · ".join(x for x in [d["region"], d["found"], d["kind"], d.get("area")] if x))}'
         + (f' · <a href="{e(d["homepage"])}" rel="noopener" target="_blank">대학 홈페이지</a>' if d.get("homepage") else "") + "</p></div>",
         '<div class="kpis">',
         f'<div class="kpi"><span>{d["lastYear"]} 정원내 모집</span><strong>{num(d["recruit"])}명</strong></div>',
         f'<div class="kpi"><span>경쟁률</span><strong>{rate(d["rate"])} : 1</strong></div>',
         f'<div class="kpi"><span>신입생 충원율</span><strong>{"-" if d["fill"] is None else str(d["fill"]) + "%"}</strong></div>',
         f'<div class="kpi"><span>모집 학과</span><strong>{d["depts"]}개</strong></div></div></div>',
         '<div class="card"><h2>요약</h2><p>' +
         e(f"{name}의 {d['lastYear']}학년도 정원내 모집인원은 {num(d['recruit'])}명, 지원자 기준 경쟁률은 {rate(d['rate'])}:1입니다. ") +
         (e("경쟁률이 가장 높은 학과는 " + ", ".join(f"{x['name']}({rate(x['y'][ly][3])}:1)" for x in top) + "입니다. ") if top else "") +
         e("경쟁률은 수시·정시를 합산한 정원내 지원자 ÷ 정원내 모집인원입니다.") + "</p>"
         f'<p><a class="btn btn-primary" href="/#/univ/{e(d["code"])}">학과별 그래프로 자세히 보기</a></p></div>',

         f'<div class="card"><h2>대학 전체 경쟁률 추이 ({y0}~{y1}학년도)</h2><div class="table-wrap"><table class="data-table compact"><thead><tr><th>학년도</th>'
         + "".join(f'<th class="num">{y}</th>' for y in years) + "</tr></thead><tbody>"
         + "<tr><th>정원내 모집</th>" + "".join(f'<td class="num">{num(r) if r else "-"}</td>' for _, r, _, _ in tot) + "</tr>"
         + "<tr><th>정원내 지원</th>" + "".join(f'<td class="num">{num(a) if a else "-"}</td>' for _, _, a, _ in tot) + "</tr>"
         + "<tr><th>경쟁률</th>" + "".join(f'<td class="num"><b>{rate(v)}</b></td>' for _, _, _, v in tot) + "</tr>"
         + '</tbody></table></div><p class="source">출처: 교육부 대학알리미 「신입생 충원 현황(대학·학과별)」, 학과 합계</p></div>',

         f'<div class="card"><h2>학과별 경쟁률 {len(years)}개년 추이</h2><p class="muted small">{d["lastYear"]}학년도 모집 학과 기준. 학과 신설·개편 시 이전 연도는 “-”로 표시됩니다.</p>'
         '<div class="table-wrap"><table class="data-table compact"><thead><tr><th>단과대학</th><th>학과</th>'
         f'<th class="num">{d["lastYear"]} 모집</th><th class="num">{d["lastYear"]} 지원</th>'
         + "".join(f'<th class="num">{y[2:]}년</th>' for y in years) + "</tr></thead><tbody>"]
    for x in cur:
        v = x["y"][ly]
        label = x["name"] + (" (야간)" if x["dn"] == "야간" else "") + (f" ({x['feat']})" if x["feat"] and x["feat"] != "일반과정" else "")
        b.append(f"<tr><td>{e(x['college'])}</td><td><b>{e(label)}</b></td><td class=\"num\">{num(v[1])}</td><td class=\"num\">{num(v[2])}</td>"
                 + "".join(f'<td class="num">{rate(x["y"][y][3]) if y in x["y"] else "-"}</td>' for y in years) + "</tr>")
    b.append('</tbody></table></div><p class="source">출처: 교육부 대학알리미 「신입생 충원 현황(대학·학과별)」 (공공누리 제1유형)</p></div>')

    for r in d.get("resultData") or []:
        b.append(f'<div class="card"><h2>{e(r["title"])} <span class="tag tag-c">대학 공개 원자료</span></h2><p class="muted small">{e(r["note"])}</p>')
        for t in r["tables"]:
            b.append(f'<h3>{e(t["title"])}</h3><div class="table-wrap"><table class="data-table compact"><thead><tr>'
                     + "".join(f'<th{" class=\"num\"" if j else ""}>{e(c)}</th>' for j, c in enumerate(t["cols"])) + "</tr></thead><tbody>"
                     + "".join("<tr>" + "".join(f'<td class="num">{e(v)}</td>' if j else f"<td><b>{e(v)}</b></td>" for j, v in enumerate(row)) + "</tr>" for row in t["rows"])
                     + "</tbody></table></div>")
        b.append(f'<p class="source">출처: <a href="{e(r["url"])}" rel="noopener" target="_blank">{e(r["source"])}</a> (공공데이터포털, {e(r["license"])})</p></div>')

    docs = d.get("documents") or []
    b.append('<div class="card"><h2>대학 공식 입시결과·모집요강 원문</h2><p class="muted">대학이 직접 발표한 PDF입니다. '
             "입시결과에는 학생부 등급·수능 백분위 등 합격자 성적(50%·70% 컷 등)이 대학별 기준으로 실려 있습니다.</p>")
    if docs:
        campuses = []
        for x in docs:
            if x["campus"] not in campuses:
                campuses.append(x["campus"])
        for c in campuses:
            if len(campuses) > 1:
                b.append(f"<h3>{e(c or '본교')}</h3>")
            b.append('<div class="table-wrap"><table class="data-table docs"><thead><tr><th>학년도</th>'
                     + "".join(f"<th>{k[1]}</th>" for k in DOC_KINDS) + "</tr></thead><tbody>")
            for x in docs:
                if x["campus"] != c:
                    continue
                b.append(f"<tr><td><b>{x['year']}</b></td>" + "".join(
                    f'<td><a class="doc-link" href="{e(x[k])}" target="_blank" rel="noopener">{x["year"]} {t} PDF</a></td>' if x.get(k)
                    else '<td><span class="muted">-</span></td>' for k, t in DOC_KINDS) + "</tr>")
            b.append("</tbody></table></div>")
        b.append('<p class="source">출처: 각 대학 발표 원문 · 경상남도교육청 경남대입정보센터 수집 (공공데이터포털)</p>')
    else:
        b.append('<p class="empty">수집된 원문 자료가 없습니다. 대학 입학처 홈페이지에서 확인하세요.</p>')
    b.append("</div>")
    b.append(f'<p class="muted small">데이터 기준일 {e(meta["built"])} · 교육부 대학알리미 공시 {y0}~{y1}학년도</p>')

    canonical = f"{SITE}/u/{d['code']}.html"
    ld = {"@context": "https://schema.org", "@type": "CollegeOrUniversity", "name": d["name"], "url": d.get("homepage") or canonical,
          "address": {"@type": "PostalAddress", "addressRegion": d["region"], "addressCountry": "KR"}}
    title = f"{name} 학과별 경쟁률 {len(years)}년 추이·입시결과 | 입시나침반"
    return layout(title, desc, canonical, "\n".join(b), ld)


REMOTE = ("사이버대학(대학)", "방송통신대학")


def index_page(univs, meta):
    remote = sorted([u for u in univs if u["kind"] in REMOTE], key=lambda x: x["name"])
    univs = [u for u in univs if u["kind"] not in REMOTE]
    regions = {}
    for u in univs:
        regions.setdefault(u["region"], []).append(u)
    order = ["서울", "경기", "인천", "강원", "대전", "세종", "충북", "충남", "광주", "전북", "전남", "대구", "경북", "부산", "울산", "경남", "제주"]
    keys = [r for r in order if r in regions] + sorted(r for r in regions if r not in order)
    b = [f"<h1>전국 4년제 대학 경쟁률·입시결과</h1><p class=\"muted\">교육부 대학알리미 공시 기준 {meta['univYears'][0]}~{meta['univYears'][1]}학년도. "
         "대학을 누르면 학과별 10개년 경쟁률과 대학 공식 입시결과 원문을 볼 수 있습니다.</p>"]
    for r in keys:
        lst = sorted(regions[r], key=lambda x: x["name"])
        b.append(f'<div class="card"><h2>{e(r)} <small class="muted">{len(lst)}개교</small></h2><div class="table-wrap"><table class="data-table compact">'
                 f'<thead><tr><th>대학</th><th>종류</th><th class="num">{meta["univYears"][1]} 정원내 모집</th><th class="num">경쟁률</th></tr></thead><tbody>')
        for u in lst:
            nm = u["name"] + (f"({u['campus']})" if u.get("campus") and u["campus"] != "본교" else "")
            b.append(f'<tr><td><a href="/u/{e(u["code"])}.html"><b>{e(nm)}</b></a></td><td>{e(u["kind"])}</td>'
                     f'<td class="num">{num(u["recruit"])}</td><td class="num">{rate(u["rate"])}</td></tr>')
        b.append("</tbody></table></div></div>")
    if remote:
        b.append(f'<div class="card"><h2>원격대학 (사이버대학·방송통신대학) <small class="muted">{len(remote)}개교</small></h2>'
                 '<p class="muted small">수능·내신 위주 선발이 아닌 원격 교육기관으로, 일반 대학과 분리해 표시합니다.</p><div class="table-wrap"><table class="data-table compact">'
                 f'<thead><tr><th>대학</th><th>지역</th><th class="num">{meta["univYears"][1]} 정원내 모집</th><th class="num">경쟁률</th></tr></thead><tbody>')
        for u in remote:
            b.append(f'<tr><td><a href="/u/{e(u["code"])}.html"><b>{e(u["name"])}</b></a></td><td>{e(u["region"])}</td>'
                     f'<td class="num">{num(u["recruit"])}</td><td class="num">{rate(u["rate"])}</td></tr>')
        b.append("</tbody></table></div></div>")
    b.append('<p class="source">출처: 교육부 대학알리미 「신입생 충원 현황(대학·학과별)」 (공공누리 제1유형)</p>')
    desc = f"전국 4년제 대학 {len(univs)}곳의 지역별 경쟁률·모집인원과 학과별 10개년 추이, 대학 공식 입시결과 원문. 교육부 대학알리미 공시 기준."
    return layout("전국 4년제 대학 경쟁률·입시결과 모음 | 입시나침반", desc, f"{SITE}/u/", "\n".join(b))


def main():
    idx = json.load(open(os.path.join(DATA, "index.json"), encoding="utf-8"))
    meta = idx["meta"]
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))
    univs = idx["univ"]
    for u in univs:
        d = json.load(open(os.path.join(DATA, "univ", f"{u['code']}.json"), encoding="utf-8"))
        with open(os.path.join(OUT, f"{u['code']}.html"), "w", encoding="utf-8") as f:
            f.write(univ_page(d, meta))
    with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as f:
        f.write(index_page(univs, meta))
    urls = [f"{SITE}/", f"{SITE}/u/"] + [f"{SITE}/u/{u['code']}.html" for u in univs]
    with open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        for u in urls:
            f.write(f"  <url><loc>{e(u)}</loc><lastmod>{meta['built']}</lastmod></url>\n")
        f.write("</urlset>\n")
    with open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8") as f:
        f.write(f"User-agent: *\nAllow: /\nDisallow: /data/\nSitemap: {SITE}/sitemap.xml\n")
    print(f"정적 페이지 {len(univs) + 1}개, sitemap URL {len(urls)}개 생성")


if __name__ == "__main__":
    sys.exit(main())
