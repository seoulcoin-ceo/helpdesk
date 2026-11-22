"""입시나침반 회원 API (ipsi.isjung.com/api)

- 일반 회원가입(이메일+비밀번호) / 카카오·네이버 간편 로그인
- 회원별 성적·관심 대학 저장(기기 간 동기화), 합격·불합격 결과 제보, 학부모-자녀 계정 연결
- 저장소: SQLite (기본 /var/lib/ipsi/ipsi.db), 비밀번호: scrypt, 세션: HttpOnly 쿠키(토큰은 해시만 저장)

실행: uvicorn app:app --host 127.0.0.1 --port 8501   (nginx 가 /api/ 를 여기로 전달)
설정(환경변수, /etc/ipsi/api.env):
  IPSI_DB, SITE_URL, COOKIE_SECURE(1/0),
  KAKAO_CLIENT_ID, KAKAO_CLIENT_SECRET, NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
"""
import hashlib, hmac, json, os, re, secrets, sqlite3, threading, time, urllib.parse, urllib.request
from contextlib import contextmanager

from fastapi import Body, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse

DB = os.environ.get("IPSI_DB", "/var/lib/ipsi/ipsi.db")
SITE = os.environ.get("SITE_URL", "https://ipsi.isjung.com").rstrip("/")
SECURE = os.environ.get("COOKIE_SECURE", "1") == "1"
COOKIE = "ipsi_s"
SESSION_DAYS = 30
MAX_DATA = 300_000  # 성적·관심목록 JSON 최대 크기(바이트)
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")
PROVIDERS = {
    "kakao": {
        "auth": "https://kauth.kakao.com/oauth/authorize",
        "token": "https://kauth.kakao.com/oauth/token",
        "me": "https://kapi.kakao.com/v2/user/me",
    },
    "naver": {
        "auth": "https://nid.naver.com/oauth2.0/authorize",
        "token": "https://nid.naver.com/oauth2.0/token",
        "me": "https://openapi.naver.com/v1/nid/me",
    },
}

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
_lock = threading.RLock()  # public() 이 db() 안에서 다시 db() 를 부르므로 재진입 가능해야 함

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE, pw TEXT, name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'student', created INTEGER NOT NULL,
  consent_at INTEGER, report_consent INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS identities(provider TEXT, sub TEXT, user_id INTEGER NOT NULL,
  PRIMARY KEY(provider, sub));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS userdata(user_id INTEGER PRIMARY KEY, json TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, created INTEGER NOT NULL,
  year INTEGER, track TEXT, univ_code TEXT, univ_name TEXT, dept TEXT, jeonhyeong TEXT,
  result TEXT, note TEXT, snapshot TEXT);
CREATE TABLE IF NOT EXISTS links(id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, parent_id INTEGER NOT NULL,
  created INTEGER NOT NULL, UNIQUE(student_id, parent_id));
CREATE TABLE IF NOT EXISTS link_codes(code TEXT PRIMARY KEY, student_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_states(state TEXT PRIMARY KEY, provider TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_fail(key TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL);
"""


def now():
    return int(time.time())


@contextmanager
def db():
    os.makedirs(os.path.dirname(DB) or ".", exist_ok=True)
    with _lock:
        c = sqlite3.connect(DB)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys=ON")
        try:
            yield c
            c.commit()
        finally:
            c.close()


with db() as _c:
    _c.executescript(SCHEMA)


def h(token):
    return hashlib.sha256(token.encode()).hexdigest()


def hash_pw(pw):
    salt = secrets.token_bytes(16)
    d = hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return "scrypt$" + salt.hex() + "$" + d.hex()


def check_pw(pw, stored):
    try:
        _, salt, d = stored.split("$")
        x = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2 ** 14, r=8, p=1, dklen=32)
        return hmac.compare_digest(x.hex(), d)
    except Exception:
        return False


def err(status, msg):
    raise HTTPException(status, msg)


@app.exception_handler(HTTPException)
def _he(_req, e):
    return JSONResponse({"error": e.detail}, status_code=e.status_code)


# ---------- 공통: CSRF·세션 ----------
@app.middleware("http")
async def csrf(request: Request, call_next):
    # 상태를 바꾸는 요청은 사이트 화면(app.js)이 붙이는 헤더가 있어야 한다 (다른 사이트의 폼 전송 차단)
    if request.method in ("POST", "PUT", "DELETE") and request.headers.get("x-ipsi") != "1":
        return JSONResponse({"error": "잘못된 요청입니다."}, status_code=403)
    resp = await call_next(request)
    resp.headers["Cache-Control"] = "no-store"
    return resp


def new_session(resp, user_id):
    token = secrets.token_urlsafe(32)
    with db() as c:
        c.execute("DELETE FROM sessions WHERE expires<?", (now(),))
        c.execute("INSERT INTO sessions VALUES(?,?,?)", (h(token), user_id, now() + SESSION_DAYS * 86400))
    resp.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, secure=SECURE, samesite="lax", path="/")


def user_of(request, need_consent=True):
    t = request.cookies.get(COOKIE)
    if not t:
        err(401, "로그인이 필요합니다.")
    with db() as c:
        u = c.execute("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
                      (h(t), now())).fetchone()
    if not u:
        err(401, "로그인이 필요합니다.")
    if need_consent and not u["consent_at"]:
        err(403, "약관 동의가 필요합니다.")
    return u


def public(u):
    with db() as c:
        prov = [r["provider"] for r in c.execute("SELECT provider FROM identities WHERE user_id=?", (u["id"],))]
    return {"id": u["id"], "email": u["email"], "name": u["name"], "role": u["role"], "providers": prov,
            "needConsent": not u["consent_at"], "reportConsent": bool(u["report_consent"])}


def consent_ok(b):
    return b.get("agreeTerms") is True and b.get("agreePrivacy") is True and b.get("age14") is True


# ---------- 회원가입·로그인 ----------
@app.post("/api/auth/signup")
def signup(resp: Response, b: dict = Body(...)):
    email = str(b.get("email", "")).strip().lower()
    pw = str(b.get("password", ""))
    name = str(b.get("name", "")).strip()[:30]
    role = b.get("role") if b.get("role") in ("student", "parent") else "student"
    if not EMAIL_RE.match(email):
        err(400, "이메일 형식을 확인하세요.")
    if len(pw) < 8 or len(pw) > 128 or pw.isdigit() or pw.isalpha():
        err(400, "비밀번호는 8자 이상, 영문과 숫자를 함께 쓰세요.")
    if not consent_ok(b):
        err(400, "필수 약관에 동의하고 만 14세 이상인지 확인해 주세요.")
    with db() as c:
        if c.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
            err(409, "이미 가입된 이메일입니다.")
        cur = c.execute("INSERT INTO users(email,pw,name,role,created,consent_at,report_consent) VALUES(?,?,?,?,?,?,?)",
                        (email, hash_pw(pw), name, role, now(), now(), 1 if b.get("reportConsent") else 0))
        uid = cur.lastrowid
    new_session(resp, uid)
    with db() as c:
        return public(c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone())


@app.post("/api/auth/login")
def login(request: Request, resp: Response, b: dict = Body(...)):
    email = str(b.get("email", "")).strip().lower()
    key = "e:" + email
    with db() as c:
        f = c.execute("SELECT * FROM login_fail WHERE key=?", (key,)).fetchone()
        if f and f["n"] >= 5 and f["until"] > now():
            err(429, "로그인 시도가 너무 많습니다. 10분 뒤 다시 시도하세요.")
        u = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        bad = not u or not u["pw"] or not check_pw(str(b.get("password", "")), u["pw"])
        if bad:  # 실패 횟수는 저장(commit)된 뒤에 오류를 돌려줘야 한다
            n = (f["n"] if f and f["until"] > now() else 0) + 1
            c.execute("INSERT OR REPLACE INTO login_fail VALUES(?,?,?)", (key, n, now() + 600))
        else:
            c.execute("DELETE FROM login_fail WHERE key=?", (key,))
    if bad:
        err(401, "이메일 또는 비밀번호가 맞지 않습니다.")
    new_session(resp, u["id"])
    return public(u)


@app.post("/api/auth/logout")
def logout(request: Request, resp: Response):
    t = request.cookies.get(COOKIE)
    if t:
        with db() as c:
            c.execute("DELETE FROM sessions WHERE token=?", (h(t),))
    resp.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    return public(user_of(request, need_consent=False))


@app.post("/api/me/consent")
def me_consent(request: Request, b: dict = Body(...)):
    u = user_of(request, need_consent=False)
    if not consent_ok(b):
        err(400, "필수 약관에 동의하고 만 14세 이상인지 확인해 주세요.")
    role = b.get("role") if b.get("role") in ("student", "parent") else u["role"]
    name = str(b.get("name", u["name"]) or "").strip()[:30]
    with db() as c:
        c.execute("UPDATE users SET consent_at=?, report_consent=?, role=?, name=? WHERE id=?",
                  (now(), 1 if b.get("reportConsent") else 0, role, name, u["id"]))
        return public(c.execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone())


@app.put("/api/me")
def me_update(request: Request, b: dict = Body(...)):
    u = user_of(request)
    sets, vals = [], []
    if "name" in b:
        sets.append("name=?"); vals.append(str(b["name"]).strip()[:30])
    if b.get("role") in ("student", "parent"):
        sets.append("role=?"); vals.append(b["role"])
    if "reportConsent" in b:
        sets.append("report_consent=?"); vals.append(1 if b["reportConsent"] else 0)
    if "newPassword" in b:
        pw = str(b["newPassword"])
        if u["pw"] and not check_pw(str(b.get("password", "")), u["pw"]):
            err(400, "현재 비밀번호가 맞지 않습니다.")
        if len(pw) < 8 or pw.isdigit() or pw.isalpha():
            err(400, "비밀번호는 8자 이상, 영문과 숫자를 함께 쓰세요.")
        sets.append("pw=?"); vals.append(hash_pw(pw))
    if sets:
        with db() as c:
            c.execute("UPDATE users SET " + ",".join(sets) + " WHERE id=?", (*vals, u["id"]))
    with db() as c:
        return public(c.execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone())


@app.delete("/api/me")
def me_delete(request: Request, resp: Response):
    """회원 탈퇴: 회원의 모든 데이터를 즉시 삭제한다"""
    u = user_of(request, need_consent=False)
    with db() as c:
        for sql in ("DELETE FROM sessions WHERE user_id=?", "DELETE FROM identities WHERE user_id=?",
                    "DELETE FROM userdata WHERE user_id=?", "DELETE FROM reports WHERE user_id=?",
                    "DELETE FROM links WHERE student_id=? OR parent_id=?", "DELETE FROM link_codes WHERE student_id=?",
                    "DELETE FROM users WHERE id=?"):
            c.execute(sql, (u["id"],) * sql.count("?"))
    resp.delete_cookie(COOKIE, path="/")
    return {"ok": True}


# ---------- 간편 로그인 (카카오·네이버) ----------
def cfg(p):
    cid = os.environ.get(p.upper() + "_CLIENT_ID", "")
    sec = os.environ.get(p.upper() + "_CLIENT_SECRET", "")
    return cid, sec


@app.get("/api/auth/providers")
def providers():
    return {p: bool(cfg(p)[0]) for p in PROVIDERS}


def http_json(url, data=None, headers=None):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode() if data else None,
                                 headers=headers or {})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


@app.get("/api/auth/{p}/start")
def oauth_start(p: str):
    if p not in PROVIDERS or not cfg(p)[0]:
        err(404, "지원하지 않는 로그인입니다.")
    state = secrets.token_urlsafe(24)
    with db() as c:
        c.execute("DELETE FROM oauth_states WHERE expires<?", (now(),))
        c.execute("INSERT INTO oauth_states VALUES(?,?,?)", (state, p, now() + 600))
    q = {"response_type": "code", "client_id": cfg(p)[0], "redirect_uri": f"{SITE}/api/auth/{p}/callback", "state": state}
    return RedirectResponse(PROVIDERS[p]["auth"] + "?" + urllib.parse.urlencode(q))


@app.get("/api/auth/{p}/callback")
def oauth_callback(p: str, code: str = "", state: str = "", error: str = ""):
    fail = lambda m: RedirectResponse(f"{SITE}/#/login?error=" + urllib.parse.quote(m))
    if p not in PROVIDERS or error or not code:
        return fail("로그인이 취소되었습니다.")
    with db() as c:
        ok = c.execute("SELECT 1 FROM oauth_states WHERE state=? AND provider=? AND expires>?", (state, p, now())).fetchone()
        c.execute("DELETE FROM oauth_states WHERE state=?", (state,))
    if not ok:
        return fail("로그인 시간이 지났습니다. 다시 시도하세요.")
    cid, sec = cfg(p)
    try:
        data = {"grant_type": "authorization_code", "client_id": cid, "redirect_uri": f"{SITE}/api/auth/{p}/callback", "code": code}
        if sec:
            data["client_secret"] = sec
        if p == "naver":
            data["state"] = state
        tok = http_json(PROVIDERS[p]["token"], data)
        info = http_json(PROVIDERS[p]["me"], headers={"Authorization": "Bearer " + tok["access_token"]})
        if p == "kakao":
            sub = str(info["id"])
            acc = info.get("kakao_account") or {}
            email = acc.get("email") if acc.get("is_email_verified") else None
            name = (acc.get("profile") or {}).get("nickname") or (info.get("properties") or {}).get("nickname") or ""
        else:
            r = info["response"]
            sub, email, name = str(r["id"]), r.get("email"), r.get("name") or r.get("nickname") or ""
    except Exception:
        return fail("간편 로그인에 실패했습니다. 잠시 뒤 다시 시도하세요.")
    with db() as c:
        row = c.execute("SELECT user_id FROM identities WHERE provider=? AND sub=?", (p, sub)).fetchone()
        if row:
            uid = row["user_id"]
        else:
            # 새 회원. 이메일이 같은 기존 계정이 있어도 자동으로 합치지 않는다(남의 계정 탈취 방지)
            em = email.lower() if email and not c.execute("SELECT 1 FROM users WHERE email=?", (email.lower(),)).fetchone() else None
            uid = c.execute("INSERT INTO users(email,name,created) VALUES(?,?,?)", (em, name[:30], now())).lastrowid
            c.execute("INSERT INTO identities VALUES(?,?,?)", (p, sub, uid))
    resp = RedirectResponse(f"{SITE}/#/account")
    new_session(resp, uid)
    return resp


# ---------- 성적·관심 대학 동기화 ----------
@app.get("/api/data")
def data_get(request: Request):
    u = user_of(request)
    with db() as c:
        r = c.execute("SELECT json, updated FROM userdata WHERE user_id=?", (u["id"],)).fetchone()
    return {"data": json.loads(r["json"]) if r else None, "updated": r["updated"] if r else None}


@app.put("/api/data")
async def data_put(request: Request):
    u = user_of(request)
    raw = await request.body()
    if len(raw) > MAX_DATA:
        err(413, "저장할 수 있는 크기를 넘었습니다.")
    try:
        d = json.loads(raw)
        assert isinstance(d, dict)
    except Exception:
        err(400, "잘못된 데이터입니다.")
    t = now()
    with db() as c:
        c.execute("INSERT OR REPLACE INTO userdata VALUES(?,?,?)", (u["id"], json.dumps(d, ensure_ascii=False), t))
    return {"ok": True, "updated": t}


# ---------- 합격·불합격 결과 제보 ----------
RESULTS = ("최초합격", "추가합격", "예비번호 대기", "불합격", "1단계 합격", "1단계 불합격", "등록 포기")
TRACKS = ("수시 교과", "수시 종합", "수시 논술", "수시 실기", "수시 기타", "정시 가군", "정시 나군", "정시 다군")


@app.get("/api/reports")
def reports_list(request: Request):
    u = user_of(request)
    with db() as c:
        rows = c.execute("SELECT * FROM reports WHERE user_id=? ORDER BY id DESC", (u["id"],)).fetchall()
    return [{k: (json.loads(r[k]) if k == "snapshot" and r[k] else r[k]) for k in r.keys() if k != "user_id"} for r in rows]


@app.post("/api/reports")
def reports_add(request: Request, b: dict = Body(...)):
    u = user_of(request)
    if not u["report_consent"]:
        err(403, "결과 제보에 동의해야 저장할 수 있습니다(내 계정에서 변경).")
    if b.get("result") not in RESULTS or b.get("track") not in TRACKS:
        err(400, "전형과 결과를 선택하세요.")
    y = b.get("year")
    if not isinstance(y, int) or not 2015 <= y <= 2040:
        err(400, "학년도를 확인하세요.")
    snap = b.get("snapshot")
    snap = json.dumps(snap, ensure_ascii=False) if isinstance(snap, dict) else None
    if snap and len(snap) > 50_000:
        err(413, "성적 정보가 너무 큽니다.")
    with db() as c:
        n = c.execute("SELECT COUNT(*) FROM reports WHERE user_id=?", (u["id"],)).fetchone()[0]
        if n >= 60:
            err(400, "결과는 최대 60건까지 등록할 수 있습니다.")
        rid = c.execute("INSERT INTO reports(user_id,created,year,track,univ_code,univ_name,dept,jeonhyeong,result,note,snapshot) "
                        "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                        (u["id"], now(), y, b["track"], str(b.get("univCode", ""))[:20], str(b.get("univName", ""))[:60],
                         str(b.get("dept", ""))[:60], str(b.get("jeonhyeong", ""))[:60], b["result"],
                         str(b.get("note", ""))[:200], snap)).lastrowid
    return {"id": rid}


@app.delete("/api/reports/{rid}")
def reports_del(rid: int, request: Request):
    u = user_of(request)
    with db() as c:
        c.execute("DELETE FROM reports WHERE id=? AND user_id=?", (rid, u["id"]))
    return {"ok": True}


# ---------- 학부모-자녀 연결 ----------
@app.post("/api/link/code")
def link_code(request: Request):
    """학생이 만든 6자리 코드를 학부모가 24시간 안에 입력하면 연결된다"""
    u = user_of(request)
    if u["role"] != "student":
        err(400, "학생 계정에서 만들 수 있습니다.")
    code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
    with db() as c:
        c.execute("DELETE FROM link_codes WHERE student_id=? OR expires<?", (u["id"], now()))
        c.execute("INSERT INTO link_codes VALUES(?,?,?)", (code, u["id"], now() + 86400))
    return {"code": code, "expires": now() + 86400}


@app.post("/api/link/accept")
def link_accept(request: Request, b: dict = Body(...)):
    u = user_of(request)
    if u["role"] != "parent":
        err(400, "학부모 계정에서 입력하세요.")
    code = str(b.get("code", "")).strip().upper()
    with db() as c:
        r = c.execute("SELECT student_id FROM link_codes WHERE code=? AND expires>?", (code, now())).fetchone()
        if not r:
            err(400, "코드가 맞지 않거나 시간이 지났습니다.")
        c.execute("INSERT OR IGNORE INTO links(student_id,parent_id,created) VALUES(?,?,?)", (r["student_id"], u["id"], now()))
        c.execute("DELETE FROM link_codes WHERE code=?", (code,))
    return {"ok": True}


@app.get("/api/link")
def link_list(request: Request):
    u = user_of(request)
    with db() as c:
        if u["role"] == "parent":
            rows = c.execute("SELECT l.id, u.id uid, u.name, u.email FROM links l JOIN users u ON u.id=l.student_id WHERE l.parent_id=?", (u["id"],))
        else:
            rows = c.execute("SELECT l.id, u.id uid, u.name, u.email FROM links l JOIN users u ON u.id=l.parent_id WHERE l.student_id=?", (u["id"],))
        return [dict(r) for r in rows]


@app.delete("/api/link/{lid}")
def link_del(lid: int, request: Request):
    u = user_of(request)
    with db() as c:
        c.execute("DELETE FROM links WHERE id=? AND (student_id=? OR parent_id=?)", (lid, u["id"], u["id"]))
    return {"ok": True}


@app.get("/api/children/{sid}")
def child_view(sid: int, request: Request):
    """학부모가 연결된 자녀의 성적·관심 대학·제보 결과를 읽기 전용으로 본다"""
    u = user_of(request)
    with db() as c:
        if not c.execute("SELECT 1 FROM links WHERE student_id=? AND parent_id=?", (sid, u["id"])).fetchone():
            err(404, "연결된 자녀가 아닙니다.")
        s = c.execute("SELECT name, email FROM users WHERE id=?", (sid,)).fetchone()
        d = c.execute("SELECT json, updated FROM userdata WHERE user_id=?", (sid,)).fetchone()
        reps = c.execute("SELECT year,track,univ_name,dept,jeonhyeong,result FROM reports WHERE user_id=? ORDER BY id DESC", (sid,)).fetchall()
    return {"name": s["name"], "email": s["email"], "data": json.loads(d["json"]) if d else None,
            "updated": d["updated"] if d else None, "reports": [dict(r) for r in reps]}


@app.get("/api/health")
def health():
    return {"ok": True}
