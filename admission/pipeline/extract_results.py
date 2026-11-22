#!/usr/bin/env python3
"""대학 공식 입시결과 PDF → 표 데이터 추출

원칙 (신뢰도)
  * 표의 칸 값은 원문 글자 그대로 옮긴다. 계산·보정·해석하지 않는다.
  * 추출된 모든 칸 값이 원문 해당 페이지 텍스트에 실제로 존재하는지 대조하고,
    하나라도 없으면 그 표는 버린다 (글자 깨짐·칸 밀림 방지).
  * 이미지(스캔) PDF 처럼 글자를 읽을 수 없는 원문은 추출하지 않고 원문 링크만 남긴다.
  * 모든 표에 원문 PDF 쪽 번호를 남겨 바로 대조할 수 있게 한다.

입력: data/univ/{code}.json 의 documents (build_data.py 결과)
출력: data/ipsi/{code}.json, data/ipsi_index.json
사용: python3 extract_results.py [--years 2025 2026] [--jobs 3]
필요: pip install pdfplumber
"""
import argparse, hashlib, json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

import pdfplumber

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
CACHE = os.path.join(HERE, "raw", "pdf")
OUT = os.path.join(DATA, "ipsi")
KINDS = {"susiResult": "수시", "jungsiResult": "정시"}
NUM = re.compile(r"^[-+]?\d[\d,]*(\.\d+)?%?$|^[-–—·]$|^\d+(\.\d+)?\s*[:：]\s*1$")
HEAD_HINT = ("모집단위", "학과", "학부", "전공", "계열", "구분", "단과")
VALUE_HINT = ("컷", "CUT", "cut", "등급", "백분위", "평균", "경쟁", "충원", "점수", "환산", "합격", "최저", "최고", "지원", "모집")


def clean(c):
    if c is None:
        return None
    s = str(c).replace(" ", " ")
    # 세로쓰기(한 글자씩 줄바꿈)는 붙이고, 일반 줄바꿈은 공백으로
    lines = [x.strip() for x in s.split("\n") if x.strip()]
    if lines and all(len(x) <= 2 for x in lines):
        s = "".join(lines)
    else:
        s = " ".join(lines)
    return re.sub(r"\s+", " ", s).strip()


def squash(s):
    return re.sub(r"\s+", "", s or "")


def is_num(s):
    return bool(s) and bool(NUM.match(s.replace(" ", "")))


CACHE_ONLY = False


def fetch(url):
    os.makedirs(CACHE, exist_ok=True)
    fn = os.path.join(CACHE, hashlib.md5(url.encode()).hexdigest() + ".pdf")
    if os.path.exists(fn) and os.path.getsize(fn) > 0:
        return fn
    if CACHE_ONLY:
        return None
    for i in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (ipsi-compass)"})
            with urllib.request.urlopen(req, timeout=180) as r:
                body = r.read()
            if body[:4] != b"%PDF":
                return None
            with open(fn, "wb") as f:
                f.write(body)
            return fn
        except urllib.error.HTTPError:
            return None
        except Exception:
            time.sleep(3 * (i + 1))
    return None


def col_ranges(tb, h, nrows, ncol):
    """데이터 행의 실제 칸 좌표로 각 열의 x 범위를 구한다."""
    xs = [None] * ncol
    for i in range(h, nrows):
        cells = tb.rows[i].cells
        for k in range(min(ncol, len(cells))):
            if xs[k] is None and cells[k]:
                xs[k] = (cells[k][0], cells[k][2])
    return xs


def build_head(tb, raw, h, ncol, xs):
    """원문 머리글을 병합칸(colspan/rowspan)까지 그대로 재현한다.
    반환: (머리글 행 목록 [[text, colspan, rowspan], ...], 열별 평면 이름)"""
    # 행의 세로 범위: 행 윗변 ~ 그 행에서 가장 낮은 칸의 아랫변 (세로 병합칸에 늘어나지 않도록)
    ys = []
    for i in range(h):
        bs = [c[3] for c in tb.rows[i].cells if c]
        ys.append((tb.rows[i].bbox[1], min(bs) if bs else tb.rows[i].bbox[3]))
    head, flat = [], [[] for _ in range(ncol)]
    for i in range(h):
        row = []
        cells = tb.rows[i].cells
        for j in range(min(ncol, len(cells))):
            box = cells[j]
            if not box:
                continue
            cols = [k for k in range(ncol) if xs[k] and box[0] - 1 <= (xs[k][0] + xs[k][1]) / 2 <= box[2] + 1]
            rows = [r for r in range(h) if box[1] - 1 <= (ys[r][0] + ys[r][1]) / 2 <= box[3] + 1]
            if not cols or not rows:
                return None, None
            t = clean(raw[i][j]) or ""
            row.append([t, cols[0], len(cols), len(rows)])
            for k in cols:
                if t and (not flat[k] or flat[k][-1] != t):
                    flat[k].append(t)
        head.append(row)
    return head, [" ".join(f) for f in flat]


def table_ok(cols, body, page_text):
    if len(body) < 2 or len(cols) < 3:
        return False
    head = " ".join(cols)
    if not any(h in head for h in VALUE_HINT):
        return False
    cells = [c for r in body for c in r if c]
    if not cells:
        return False
    if sum(1 for c in cells if is_num(c)) / len(cells) < 0.3:
        return False
    flat = squash(page_text)
    # 원문 대조: 모든 칸 값(공백 제거)이 페이지 텍스트에 있어야 한다
    for c in cells + [c for c in cols if c]:
        for piece in c.split(" "):
            if piece and squash(piece) not in flat:
                return False
    return True


HEAD_RE = re.compile(r"^(\d{1,2}[.)]|[가-하][.)]|[①-⑳]|[□■○●◎▶◆◇]|\[|<|【|Ⅰ|Ⅱ|Ⅲ|Ⅳ|Ⅴ|Ⅵ|Ⅶ|Ⅷ|Ⅸ|Ⅹ)")


def is_heading(l):
    if not l or l[0] in "*※-·" or len(l) > 80:
        return False
    digits = sum(ch.isdigit() for ch in l)
    return digits / max(1, len(l)) < 0.25


def title_above(page, bbox, prev_bottom):
    """표 바로 위(이전 표 아래 ~ 이 표 위)의 소제목 줄을 찾는다. 상위 절 제목(1. 2. …)이 있으면 앞에 붙인다."""
    try:
        t = page.crop((0, max(0, prev_bottom), page.width, bbox[1])).extract_text() or ""
        full = page.crop((0, 0, page.width, bbox[1])).extract_text() or ""
    except Exception:
        return ""
    near = [l.strip() for l in t.split("\n") if is_heading(l.strip())]
    allh = [l.strip() for l in full.split("\n") if is_heading(l.strip()) and HEAD_RE.match(l.strip())]
    title = near[-1] if near else ""
    if title and re.match(r"^[가-하][.)]", title):
        sec = [l for l in allh if re.match(r"^\d{1,2}[.)]", l)]
        if sec and sec[-1] not in title:
            title = sec[-1] + " · " + title
    if not title and allh:
        title = allh[-1]
    return title[:120]


def extract(fn):
    out, text_chars, last_sec = [], 0, ""
    with pdfplumber.open(fn) as pdf:
        for pno, page in enumerate(pdf.pages, 1):
            ptxt = page.extract_text() or ""
            text_chars += len(ptxt.strip())
            if not ptxt.strip():
                continue
            prev_bottom = 0
            for tb in sorted(page.find_tables(), key=lambda x: x.bbox[1]):
                pb, prev_bottom = prev_bottom, tb.bbox[3]
                raw = tb.extract()
                if len(raw) != len(tb.rows) or len(raw) < 3:
                    continue
                ncol = max(len(r) for r in raw)
                rows = [[clean(c) for c in r] + [None] * (ncol - len(r)) for r in raw]
                h = None
                for i, r in enumerate(rows):
                    vals = [c for c in r if c]
                    if vals and sum(1 for c in vals if is_num(c)) >= max(2, len(vals) // 2):
                        h = i
                        break
                if not h:
                    continue
                xs = col_ranges(tb, h, len(rows), ncol)
                if any(x is None for x in xs):
                    # 데이터 행에서 좌표를 못 찾은 열이 있으면 구조를 보장할 수 없음
                    continue
                head, cols = build_head(tb, raw, h, ncol, xs)
                if head is None:
                    continue
                body = [r for r in rows[h:] if any(r)]
                # 첫 열(모집단위 등)의 세로 병합칸은 위 값을 이어받음
                prev = None
                for r in body:
                    if r[0] is None and prev:
                        r[0] = prev
                    prev = r[0]
                if not table_ok(cols, body, ptxt):
                    continue
                title = title_above(page, tb.bbox, pb)
                if re.match(r"^\d{1,2}[.)]", title):
                    last_sec = title.split(" · ")[0]
                elif title and re.match(r"^[가-하][.)]", title) and last_sec:
                    title = last_sec + " · " + title
                if not title and out:
                    title = re.sub(r" \(계속\)$", "", out[-1]["title"]) + " (계속)"
                out.append({"page": pno, "title": title, "head": head, "ncol": ncol,
                            "rows": [[c if c is not None else "" for c in r] for r in body]})
    return out, text_chars


def work(job):
    code, d = job
    url = d["url"]
    fn = fetch(url)
    if not fn:
        return code, (None if CACHE_ONLY else dict(d, status="download_failed", tables=[]))
    try:
        tables, chars = extract(fn)
    except Exception as e:
        return code, dict(d, status="parse_error", error=str(e)[:200], tables=[])
    if not fn and CACHE_ONLY:
        return code, None
    status = "ok" if tables else ("image_pdf" if chars < 50 else "no_valid_table")
    return code, dict(d, status=status, tables=tables)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", nargs="*", type=int, default=None, help="추출할 학년도 (기본: 최근 2개 학년도)")
    ap.add_argument("--jobs", type=int, default=3)
    ap.add_argument("--cache-only", action="store_true", help="이미 받은 PDF만 처리")
    a = ap.parse_args()
    global CACHE_ONLY
    CACHE_ONLY = a.cache_only
    idx = json.load(open(os.path.join(DATA, "index.json"), encoding="utf-8"))
    jobs = []
    all_years = set()
    details = {}
    for u in idx["univ"]:
        d = json.load(open(os.path.join(DATA, "univ", f"{u['code']}.json"), encoding="utf-8"))
        details[u["code"]] = d
        for e in d.get("documents", []):
            for k in KINDS:
                if e.get(k):
                    all_years.add(e["year"])
    years = set(a.years) if a.years else set(sorted(all_years)[-3:-1] if len(all_years) > 2 else all_years)
    for code, d in details.items():
        if d["kind"] in ("사이버대학(대학)", "방송통신대학"):
            continue
        for e in d.get("documents", []):
            for k, label in KINDS.items():
                if e.get(k) and e["year"] in years:
                    jobs.append((code, {"year": e["year"], "season": label, "campus": e.get("campus", ""), "url": e[k]}))
    print(f"원문 {len(jobs)}개 처리 (학년도 {sorted(years)})")
    os.makedirs(OUT, exist_ok=True)
    res = {}
    with ThreadPoolExecutor(a.jobs) as ex:
        for i, (code, r) in enumerate(ex.map(work, jobs), 1):
            if r is None:
                continue
            res.setdefault(code, []).append(r)
            if i % 25 == 0:
                print(f"  {i}/{len(jobs)}")
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))
    summary, stat = {}, {}
    for code, docs in res.items():
        docs.sort(key=lambda x: (-x["year"], x["season"], x["campus"]))
        for x in docs:
            stat[x["status"]] = stat.get(x["status"], 0) + 1
        if any(x["tables"] for x in docs):
            with open(os.path.join(OUT, f"{code}.json"), "w", encoding="utf-8") as f:
                json.dump(docs, f, ensure_ascii=False, separators=(",", ":"))
            summary[code] = sum(len(x["tables"]) for x in docs)
    with open(os.path.join(DATA, "ipsi_index.json"), "w", encoding="utf-8") as f:
        json.dump({"years": sorted(years), "built": time.strftime("%Y-%m-%d"), "tables": summary, "status": stat}, f, ensure_ascii=False)
    print("결과:", stat, f"/ 표 추출 대학 {len(summary)}곳, 표 {sum(summary.values())}개")


if __name__ == "__main__":
    sys.exit(main())
