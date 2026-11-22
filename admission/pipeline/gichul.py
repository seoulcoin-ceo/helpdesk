#!/usr/bin/env python3
"""서울 고등학교 홈페이지 '평가 공개' 게시판의 지필평가 문항(기출) 수집 — 운영자 개인 참고용

  * 학교가 홈페이지에 스스로 공개한 자료만 받는다 (유료 족보 사이트 등은 대상 아님).
  * 받은 파일은 웹에서 접근할 수 없는 서버 폴더에만 저장하고, 사이트에 올리지 않는다.
  * robots.txt 를 지키고 요청 사이에 간격(기본 3초)을 둔다.

단계
  1) schools   NEIS 학교정보 API 로 서울 고등학교 목록(학교명·홈페이지)을 받는다
               (인증키: open.neis.go.kr 회원가입 → 인증키 신청, 무료)
  2) discover  각 학교 홈페이지에서 '평가/문항/기출/지필' 메뉴(게시판) 위치를 찾는다
  3) collect   찾은 게시판의 글에서 첨부파일(hwp·pdf 등)을 받는다. --dry-run 이면 목록만 보여 준다

사용 예 (sc-kdb)
  sudo python3 gichul.py schools --key 발급받은키
  sudo python3 gichul.py discover --limit 10
  sudo python3 gichul.py collect --limit 10 --dry-run
  sudo python3 gichul.py collect --limit 10
저장 위치: --out (기본 /mnt/backup/ipsi-gichul)
"""
import argparse, csv, hashlib, html, json, os, re, sys, time, urllib.parse, urllib.request, urllib.robotparser
from html.parser import HTMLParser

UA = "Mozilla/5.0 (compatible; ipsi-gichul/1.0; personal reference)"
KEYWORDS = ("평가 공개", "평가공개", "평가문항", "평가 문항", "문항공개", "문항 공개", "기출", "지필평가", "지필고사",
            "정기고사", "학업성적관리", "평가계획", "시험문제", "평가자료")
POST_WORDS = ("고사", "문항", "기출", "지필", "시험", "평가", "중간", "기말")
FILE_EXT = (".hwp", ".hwpx", ".pdf", ".zip", ".doc", ".docx", ".jpg", ".png")
DL_HINT = ("download", "filedown", "fileDown", "FileDown", "atchFile", "selectFileDownload", "file/down", "attach")
PAGE_MAX = 5          # 게시판마다 목록 몇 쪽까지 볼지
POST_MAX = 60         # 게시판마다 글 최대 몇 개
DELAY = 3.0


class Links(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links, self._a, self._t = [], None, []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            a = dict(attrs)
            self._a, self._t = a, [a.get("title") or ""]

    def handle_data(self, d):
        if self._a is not None:
            self._t.append(d)

    def handle_endtag(self, tag):
        if tag == "a" and self._a is not None:
            self.links.append((self._a.get("href") or "", self._a.get("onclick") or "", re.sub(r"\s+", " ", " ".join(self._t)).strip()))
            self._a = None


class Client:
    def __init__(self, delay):
        self.delay, self.last, self.robots = delay, 0.0, {}

    def allowed(self, url):
        p = urllib.parse.urlsplit(url)
        base = f"{p.scheme}://{p.netloc}"
        if base not in self.robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                req = urllib.request.Request(base + "/robots.txt", headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=15) as r:
                    rp.parse(r.read().decode("utf-8", "replace").splitlines())
            except Exception:
                rp.parse([])  # robots.txt 가 없으면 허용
            self.robots[base] = rp
        return self.robots[base].can_fetch(UA, url)

    def get(self, url, binary=False):
        if not self.allowed(url):
            raise PermissionError("robots.txt 가 막은 주소")
        wait = self.delay - (time.time() - self.last)
        if wait > 0:
            time.sleep(wait)
        self.last = time.time()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ko"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data, final, ctype, cd = r.read(), r.geturl(), r.headers.get("Content-Type", ""), r.headers.get("Content-Disposition", "")
        if binary:
            return data, final, ctype, cd
        m = re.search(r"charset=([\w-]+)", ctype) or re.search(rb'charset=["\']?([\w-]+)', data[:3000])
        enc = (m.group(1).decode() if isinstance(m.group(1), bytes) else m.group(1)) if m else "utf-8"
        try:
            return data.decode(enc, "replace"), final
        except LookupError:
            return data.decode("utf-8", "replace"), final


def links_of(page_html, base):
    p = Links()
    p.feed(page_html)
    out = []
    for href, onclick, text in p.links:
        if href and not href.startswith(("javascript", "#", "mailto")):
            out.append((urllib.parse.urljoin(base, html.unescape(href)), text, onclick))
        elif onclick or href.startswith("javascript"):
            out.append(("", text, onclick or href))
    return out


def read_csv(fn):
    with open(fn, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def write_csv(fn, rows, fields):
    with open(fn, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


# ---------- 1) 학교 목록 ----------
def cmd_schools(a):
    rows, page = [], 1
    while True:
        q = {"KEY": a.key, "Type": "json", "pIndex": page, "pSize": 1000, "ATPT_OFCDC_SC_CODE": "B10", "SCHUL_KND_SC_NM": "고등학교"}
        url = "https://open.neis.go.kr/hub/schoolInfo?" + urllib.parse.urlencode(q)
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
            j = json.loads(r.read().decode())
        if "schoolInfo" not in j:
            print("NEIS 응답:", json.dumps(j, ensure_ascii=False)[:300]); break
        part = j["schoolInfo"][1]["row"]
        for x in part:
            rows.append({"학교명": x["SCHUL_NM"], "학교코드": x["SD_SCHUL_CODE"], "설립": x.get("FOND_SC_NM", ""),
                         "구분": x.get("HS_SC_NM", ""), "주소": x.get("ORG_RDNMA", ""), "홈페이지": (x.get("HMPG_ADRES") or "").strip()})
        if len(part) < 1000:
            break
        page += 1
    for r in rows:
        h = r["홈페이지"]
        if h and not h.startswith("http"):
            r["홈페이지"] = "http://" + h
    write_csv(os.path.join(a.out, "schools.csv"), rows, ["학교명", "학교코드", "설립", "구분", "주소", "홈페이지"])
    print(f"서울 고등학교 {len(rows)}곳 (홈페이지 있음 {sum(1 for r in rows if r['홈페이지'])}곳) → {a.out}/schools.csv")


def pick_schools(a):
    rows = read_csv(os.path.join(a.out, "schools.csv"))
    if a.school:
        rows = [r for r in rows if any(s in r["학교명"] for s in a.school)]
    if a.gu:
        rows = [r for r in rows if any(g in r["주소"] for g in a.gu)]
    rows = [r for r in rows if r["홈페이지"]]
    return rows[: a.limit] if a.limit else rows


# ---------- 2) 게시판 찾기 ----------
def cmd_discover(a):
    c = Client(a.delay)
    found = []
    for s in pick_schools(a):
        try:
            page, final = c.get(s["홈페이지"])
        except Exception as e:
            print(f"[{s['학교명']}] 홈페이지 접속 실패: {e}")
            found.append({"학교명": s["학교명"], "메뉴": "", "주소": "", "상태": f"접속 실패 {e}"[:80]})
            continue
        cands = {}
        for url, text, onclick in links_of(page, final):
            if any(k in text for k in KEYWORDS) and url and urllib.parse.urlsplit(url).netloc == urllib.parse.urlsplit(final).netloc:
                cands.setdefault(url, text)
        print(f"[{s['학교명']}] {final} — 후보 메뉴 {len(cands)}개" + ("".join(f"\n    · {t} → {u}" for u, t in cands.items())))
        if not cands:
            found.append({"학교명": s["학교명"], "메뉴": "", "주소": final, "상태": "메뉴 못 찾음(수동 확인)"})
        for u, t in cands.items():
            found.append({"학교명": s["학교명"], "메뉴": t, "주소": u, "상태": "후보"})
    fn = os.path.join(a.out, "boards.csv")
    write_csv(fn, found, ["학교명", "메뉴", "주소", "상태"])
    print(f"\n→ {fn}  (잘못 잡힌 메뉴는 상태를 '제외'로 바꾸거나 줄을 지우고, 못 찾은 학교는 게시판 주소를 직접 넣으면 collect 가 그대로 씁니다)")


# ---------- 3) 첨부파일 받기 ----------
def is_file_link(url, text):
    low = (url + " " + text).lower()
    return any(low.split("?")[0].endswith(e) for e in FILE_EXT) or any(e in text.lower() for e in FILE_EXT) or any(h.lower() in low for h in DL_HINT)


def safe(name):
    return re.sub(r'[\\/:*?"<>|\s]+', "_", name).strip("_")[:120] or "file"


def filename_of(cd, url, text):
    m = re.search(r"filename\*=UTF-8''([^;]+)", cd) or re.search(r'filename="?([^";]+)', cd)
    if m:
        raw = urllib.parse.unquote(m.group(1))
        try:
            raw = raw.encode("latin-1").decode("utf-8")
        except Exception:
            try:
                raw = raw.encode("latin-1").decode("cp949")
            except Exception:
                pass
        return safe(raw)
    t = text.strip()
    if any(t.lower().endswith(e) for e in FILE_EXT):
        return safe(t)
    return safe(os.path.basename(urllib.parse.urlsplit(url).path) or hashlib.md5(url.encode()).hexdigest()[:10])


def cmd_collect(a):
    c = Client(a.delay)
    boards = [b for b in read_csv(os.path.join(a.out, "boards.csv")) if b["상태"] in ("후보", "확인") and b["주소"]]
    if a.school:
        boards = [b for b in boards if any(s in b["학교명"] for s in a.school)]
    schools = list(dict.fromkeys(b["학교명"] for b in boards))
    if a.limit:
        schools = schools[: a.limit]
    log_fn = os.path.join(a.out, "files.csv")
    done = {r["원본주소"] for r in read_csv(log_fn)} if os.path.exists(log_fn) else set()
    log = read_csv(log_fn) if os.path.exists(log_fn) else []
    total_new = 0
    for school in schools:
        for b in [x for x in boards if x["학교명"] == school]:
            print(f"\n[{school}] {b['메뉴']} {b['주소']}")
            seen_posts, list_pages, page_url = set(), 0, b["주소"]
            queue = [page_url]
            while queue and list_pages < PAGE_MAX and len(seen_posts) < POST_MAX:
                url = queue.pop(0)
                try:
                    page, final = c.get(url)
                except Exception as e:
                    print(f"   목록 접속 실패: {e}"); break
                list_pages += 1
                links = links_of(page, final)
                # 게시판 목록 화면에 바로 첨부가 붙은 경우
                posts = []
                for u, t, _ in links:
                    if not u:
                        continue
                    if is_file_link(u, t):
                        posts.append(("", u, t))
                    elif any(w in t for w in POST_WORDS) and len(t) >= 6 and u != final and u not in seen_posts:
                        posts.append((t, u, ""))
                # 다음 쪽 (숫자 2~PAGE_MAX)
                for u, t, _ in links:
                    if u and t.strip() in {str(n) for n in range(2, PAGE_MAX + 1)} and u not in queue and u != final:
                        queue.append(u)
                for title, u, ftext in posts:
                    files = []
                    if title == "":
                        files = [(u, ftext, "(목록 첨부)")]
                    else:
                        if u in seen_posts or len(seen_posts) >= POST_MAX:
                            continue
                        seen_posts.add(u)
                        try:
                            ph, pf = c.get(u)
                        except Exception as e:
                            print(f"   글 접속 실패 {title}: {e}"); continue
                        files = [(fu, ft, title) for fu, ft, _ in links_of(ph, pf) if fu and is_file_link(fu, ft)]
                    for fu, ft, ptitle in files:
                        if fu in done:
                            continue
                        if a.dry_run:
                            print(f"   (받을 예정) {ptitle} — {ft or fu}")
                            done.add(fu); total_new += 1
                            continue
                        try:
                            data, ffinal, ctype, cd = c.get(fu, binary=True)
                        except Exception as e:
                            print(f"   파일 실패 {ft}: {e}"); continue
                        if "text/html" in ctype and len(data) < 200_000:
                            continue  # 파일이 아니라 화면
                        d = os.path.join(a.out, "files", safe(school))
                        os.makedirs(d, exist_ok=True)
                        name = filename_of(cd, ffinal, ft)
                        fn = os.path.join(d, name)
                        if os.path.exists(fn):
                            fn = os.path.join(d, hashlib.md5(fu.encode()).hexdigest()[:6] + "_" + name)
                        with open(fn, "wb") as f:
                            f.write(data)
                        done.add(fu); total_new += 1
                        log.append({"학교명": school, "글제목": ptitle, "파일": os.path.relpath(fn, a.out), "크기": len(data),
                                    "원본주소": fu, "게시판": b["주소"], "받은날짜": time.strftime("%Y-%m-%d %H:%M")})
                        print(f"   받음: {name} ({len(data)//1024}KB)")
            if not a.dry_run:
                write_csv(log_fn, log, ["학교명", "글제목", "파일", "크기", "원본주소", "게시판", "받은날짜"])
    print(f"\n{'받을 예정' if a.dry_run else '새로 받은'} 파일 {total_new}개" + ("" if a.dry_run else f" → {a.out}/files, 목록 {log_fn}"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="/mnt/backup/ipsi-gichul")
    ap.add_argument("--delay", type=float, default=DELAY, help="요청 간격(초)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("schools"); s.add_argument("--key", required=True)
    for name in ("discover", "collect"):
        p = sub.add_parser(name)
        p.add_argument("--limit", type=int, default=0, help="앞에서부터 몇 학교만")
        p.add_argument("--school", nargs="*", help="학교명 일부 (예: 휘문 숙명)")
        p.add_argument("--gu", nargs="*", help="주소에 들어간 구 (예: 강남구 서초구)")
        if name == "collect":
            p.add_argument("--dry-run", action="store_true", help="받지 않고 목록만 보기")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    os.chmod(a.out, 0o750)
    {"schools": cmd_schools, "discover": cmd_discover, "collect": cmd_collect}[a.cmd](a)


if __name__ == "__main__":
    main()
