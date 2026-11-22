(function () {
  "use strict";

  /* =========================================================
   * 입시나침반 — 공식 공시 데이터 뷰어
   * 데이터: data/index.json, data/depts.json, data/univ/{code}.json, data/college/{code}.json
   * (pipeline/build_data.py 로 생성)
   * ========================================================= */

  var view = document.getElementById("view");
  var IDX = null;          // index.json
  var DEPTS = null;        // depts.json (지연 로드)
  var cache = {};          // 상세 JSON 캐시
  var STORE = "ipsi-compass-v2";

  /* ---------- 유틸 ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function fmtInt(n) { return n == null ? "-" : Number(n).toLocaleString("ko-KR"); }
  function fmtRate(r) { return r == null ? "-" : Number(r).toFixed(1) + " : 1"; }
  function fmtPct(p) { return p == null ? "-" : Number(p).toFixed(1) + "%"; }
  function getJSON(url) {
    if (cache[url]) return Promise.resolve(cache[url]);
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(r.status + " " + url);
      return r.json();
    }).then(function (j) { cache[url] = j; return j; });
  }
  function load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } }
  function save(s, noSync) { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) { /* 무시 */ } if (!noSync) scheduleSync(); }
  function uniq(a) { return a.filter(function (v, i) { return v && a.indexOf(v) === i; }); }
  function sourceNote(text) { return '<p class="source">출처: ' + text + "</p>"; }
  var SRC_UNIV = "교육부 대학알리미 「신입생 충원 현황(대학·학과별)」 (공공데이터포털, 공공누리 제1유형)";
  var SRC_COLLEGE = "한국전문대학교육협의회 「신입생 입시통계현황」 (공공데이터포털)";
  var SRC_DOCS = "각 대학 발표 원문 · 경상남도교육청 경남대입정보센터 수집 (공공데이터포털)";

  /* ---------- 라우팅 ---------- */
  function route() {
    var h = location.hash.replace(/^#\/?/, "");
    var parts = h.split("?")[0].split("/").map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
    var q = new URLSearchParams(h.split("?")[1] || "");
    var navKey = parts[0] === "guide" && q.get("s") === "strategy" ? "strategy" : parts[0] === "college" || parts[0] === "dept" ? "univ" : parts[0] === "major" ? "careers" : parts[0];
    $all(".site-nav a").forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("data-nav") === navKey); });
    $(".site-nav").classList.remove("open");
    var p;
    switch (parts[0]) {
      case "univ": p = parts[1] ? pageUnivDetail(parts[1]) : pageUnivList(q); break;
      case "college": p = parts[1] ? pageCollegeDetail(parts[1]) : pageCollegeList(q); break;
      case "dept": p = pageDept(q); break;
      case "calc": p = pageCalc(); break;
      case "chance": p = pageChance(q); break;
      case "major": p = pageMajor(parts[1]); break;
      case "careers": p = pageCareers(q); break;
      case "my": p = pageMy(q); break;
      case "fit": p = pageFit(q); break;
      case "premium": p = pagePremium(); break;
      case "admin": p = pageAdmin(parts[1]); break;
      case "login": p = pageLogin(q); break;
      case "signup": p = pageSignup(); break;
      case "account": p = pageAccount(); break;
      case "child": p = pageChild(parts[1]); break;
      case "terms": p = pageTerms(); break;
      case "privacy": p = pagePrivacy(); break;
      case "guide": p = pageGuide(q); break;
      case "data": p = pageData(); break;
      default: p = pageHome();
    }
    Promise.resolve(p).catch(function (e) {
      view.innerHTML = '<div class="section"><h1>페이지를 불러오지 못했습니다</h1><p class="muted">' + esc(e.message) +
        '</p><a class="btn btn-primary" href="#/">홈으로</a></div>';
    });
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  $(".nav-toggle").addEventListener("click", function () {
    var open = $(".site-nav").classList.toggle("open");
    this.setAttribute("aria-expanded", String(open));
  });

  /* ---------- 차트 (SVG) ---------- */
  function lineChart(points, opt) {
    opt = opt || {};
    var pts = points.filter(function (p) { return p.v != null; });
    if (pts.length < 1) return '<p class="muted small">표시할 데이터가 없습니다.</p>';
    var W = 640, H = opt.h || 200, L = 40, R = 16, T = 24, B = 28;
    var vals = pts.map(function (p) { return p.v; });
    var hi = Math.max.apply(null, vals), lo = Math.min(0, Math.min.apply(null, vals));
    hi = hi === lo ? hi + 1 : hi * 1.15;
    var n = points.length;
    var x = function (i) { return n === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (n - 1); };
    var y = function (v) { return H - B - (v - lo) / (hi - lo) * (H - T - B); };
    var grid = [0, 0.5, 1].map(function (t) {
      var v = lo + (hi - lo) * t;
      return '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text class="tick" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v.toFixed(opt.digits == null ? 1 : opt.digits) + "</text>";
    }).join("");
    var path = "", started = false;
    points.forEach(function (p, i) {
      if (p.v == null) { started = false; return; }
      path += (started ? "L" : "M") + x(i).toFixed(1) + " " + y(p.v).toFixed(1) + " ";
      started = true;
    });
    var dots = points.map(function (p, i) {
      var lbl = '<text class="xl" x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(/^\d{4}$/.test(String(p.k)) ? String(p.k).slice(-2) : String(p.k)) + "</text>";
      if (p.v == null) return lbl;
      return lbl + '<circle class="pt" cx="' + x(i) + '" cy="' + y(p.v) + '" r="4"><title>' + p.k + "학년도 " + p.v + (opt.unit || "") + "</title></circle>" +
        (opt.labels !== false ? '<text class="vl" x="' + x(i) + '" y="' + (y(p.v) - 9) + '" text-anchor="middle">' + Number(p.v).toFixed(opt.digits == null ? 1 : opt.digits) + "</text>" : "");
    }).join("");
    return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(opt.label || "추이") + '">' + grid +
      '<path class="ln" d="' + path + '"/>' + dots + "</svg>";
  }
  function spark(values) {
    var v = values.filter(function (x) { return x != null; });
    if (v.length < 2) return "";
    var W = 90, H = 24, hi = Math.max.apply(null, v), lo = Math.min.apply(null, v);
    if (hi === lo) { hi += 1; lo -= 1; }
    var n = values.length, d = "", st = false;
    values.forEach(function (val, i) {
      if (val == null) { st = false; return; }
      d += (st ? "L" : "M") + (i * (W - 4) / (n - 1) + 2).toFixed(1) + " " + (H - 3 - (val - lo) / (hi - lo) * (H - 6)).toFixed(1) + " ";
      st = true;
    });
    return '<svg class="spark" viewBox="0 0 ' + W + " " + H + '" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  /* ---------- 홈 ---------- */
  function pageHome() {
    var m = IDX.meta;
    var u = IDX.univ.filter(function (x) { return x.kind === "대학교"; });
    var top = u.filter(function (x) { return x.lastYear === m.univYears[1] && x.recruit >= 1000; })
      .sort(function (a, b) { return b.rate - a.rate; }).slice(0, 10);
    view.innerHTML =
      '<section class="hero"><div class="hero-inner">' +
      '<p class="eyebrow">교육부·대교협·전문대교협 공식 공시 데이터</p>' +
      "<h1>추정치 말고,<br />공시된 숫자로 보는 대학 입시</h1>" +
      '<p class="lead">전국 4년제 대학 ' + IDX.univ.length + "곳의 학과별 " + m.univYears[0] + "~" + m.univYears[1] + "학년도 " +
      (m.univYears[1] - m.univYears[0] + 1) + "개년 모집·지원·경쟁률·충원율과 전문대학 " + IDX.college.length +
      "곳의 전형별 경쟁률, 각 대학이 직접 발표한 입시결과 원문을 한곳에 모았습니다.</p>" +
      '<form class="search-big" id="homeSearch" role="search">' +
      '<input type="search" name="q" placeholder="대학명 또는 학과명 (예: 연세대, 간호학과)" aria-label="대학 또는 학과 검색" autocomplete="off" />' +
      '<button class="btn btn-primary" type="submit">검색</button></form>' +
      '<div class="hero-stats">' +
      stat("4년제 대학", IDX.univ.length + "개교") + stat("학과 수(" + m.univYears[1] + ")", fmtInt(u.reduce(function (s, x) { return s + x.depts; }, 0)) + "개") +
      stat("공시 기간", (m.univYears[1] - m.univYears[0] + 1) + "개년") + stat("전문대학", IDX.college.length + "개교") +
      "</div></div></section>" +

      '<section class="section"><div class="grid-3">' +
      card("#/chance", "4년제 기회 찾기", "등급이 낮아도 갈 수 있는 4년제: 최근 미달이 이어져 합격 가능성이 높은 대학·학과를 10년 공시 자료로 예측.") +
      card("#/univ", "4년제 대학", "대학별·학과별 10개년 모집인원, 지원자, 경쟁률, 충원율 추이와 대학 공식 입시결과·모집요강 원문.") +
      card("#/college", "전문대학", "전문대학 학과별 일반전형·일반고·특성화고 등 전형별 모집·지원·경쟁률.") +
      card("#/dept", "학과 찾기·학과 정보", "가고 싶은 학과를 개설한 전국 대학을 경쟁률·모집인원 순으로 비교.") +
      card("#/calc", "내 성적", "내신·모의고사·수능 가채점/실채점·검정고시 성적 입력, 수능 최저 충족 확인, 시험별 등급 추이.") +
      card("#/guide", "입시 가이드", "수시·정시 구조, 공식 입시결과 읽는 법, 학년도별 체크포인트.") +
      card("#/data", "데이터 출처", "모든 수치의 원출처, 갱신일, 용어 정의를 투명하게 공개합니다.") +
      "</div></section>" +

      '<section class="section"><h2>' + m.univYears[1] + "학년도 경쟁률 상위 대학 <small class=\"muted\">(정원내 모집 1,000명 이상)</small></h2>" +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>순위</th><th>대학</th><th>지역</th><th class="num">정원내 모집</th><th class="num">경쟁률</th></tr></thead><tbody>' +
      top.map(function (x, i) {
        return '<tr class="link-row" data-href="#/univ/' + esc(x.code) + '"><td>' + (i + 1) + '</td><td><a href="#/univ/' + esc(x.code) + '">' + esc(x.name) +
          "</a>" + campusTag(x) + "</td><td>" + esc(x.region) + '</td><td class="num">' + fmtInt(x.recruit) + '</td><td class="num"><b>' + fmtRate(x.rate) + "</b></td></tr>";
      }).join("") + "</tbody></table></div>" + sourceNote(SRC_UNIV) + "</section>";

    $("#homeSearch").addEventListener("submit", function (e) {
      e.preventDefault();
      var q = this.q.value.trim();
      if (!q) return;
      var hitU = IDX.univ.concat(IDX.college).filter(function (x) { return x.name.indexOf(q) >= 0; });
      location.hash = hitU.length ? "#/univ?q=" + encodeURIComponent(q) : "#/dept?q=" + encodeURIComponent(q);
    });
    bindRows();
  }
  function stat(label, value) { return '<div class="hstat"><strong>' + esc(value) + "</strong><span>" + esc(label) + "</span></div>"; }
  function card(href, title, text) { return '<a class="card feature" href="' + href + '"><h3>' + esc(title) + "</h3><p>" + esc(text) + "</p></a>"; }
  function campusTag(x) { return x.campus && x.campus !== "본교" ? ' <span class="tag">' + esc(x.campus) + "</span>" : ""; }
  function bindRows() {
    $all(".link-row").forEach(function (tr) {
      tr.addEventListener("click", function (e) { if (e.target.tagName !== "A") location.hash = tr.getAttribute("data-href"); });
    });
  }

  /* ---------- 대학 목록 (4년제 / 전문대 공용) ---------- */
  var KIND_ORDER = ["대학교", "교육대학", "산업대학", "기술대학", "각종학교(대학)", "방송통신대학", "사이버대학(대학)"];
  function pageUnivList(q) { return listPage("univ", q); }
  function pageCollegeList(q) { return listPage("college", q); }

  function listPage(type, q) {
    var isU = type === "univ";
    var all = isU ? IDX.univ.concat(q.get("q") ? IDX.college.map(function (c) { return Object.assign({ _college: true }, c); }) : []) : IDX.college;
    var regions = uniq(all.map(function (x) { return x.region; })).sort();
    var st = {
      q: q.get("q") || "", region: "", found: "", kind: isU ? "대학교" : "", sort: "name"
    };
    view.innerHTML =
      '<section class="section"><div class="section-head"><h1>' + (isU ? "4년제 대학" : "전문대학") + "</h1><p>" +
      (isU ? IDX.meta.univYears[1] + "학년도 공시 기준 정원내 모집인원·경쟁률·충원율. 대학을 누르면 학과별 10개년 추이와 공식 입시결과 원문을 볼 수 있습니다."
        : IDX.meta.collegeYear + "학년도 전문대학 모집결과 기준. 대학을 누르면 학과·전형별 경쟁률을 볼 수 있습니다.") + "</p></div>" +
      '<div class="toolbar card">' +
      '<label>검색<input type="search" id="fQ" value="' + esc(st.q) + '" placeholder="대학명" /></label>' +
      '<label>지역<select id="fRegion"><option value="">전체</option>' + regions.map(function (r) { return "<option>" + esc(r) + "</option>"; }).join("") + "</select></label>" +
      '<label>설립<select id="fFound"><option value="">전체</option>' + uniq(all.map(function (x) { return x.found; })).sort().map(function (r) { return "<option>" + esc(r) + "</option>"; }).join("") + "</select></label>" +
      (isU ? '<label>학교 종류<select id="fKind"><option value="">전체</option>' + KIND_ORDER.map(function (k) { return "<option" + (k === st.kind ? " selected" : "") + ">" + esc(k) + "</option>"; }).join("") + "</select></label>" : "") +
      '<label>정렬<select id="fSort"><option value="name">이름순</option><option value="rate">경쟁률 높은순</option><option value="recruit">모집인원 많은순</option><option value="fill">충원율 높은순</option></select></label>' +
      "</div>" +
      '<p class="muted small" id="listCount"></p>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>대학</th><th>지역</th><th>설립</th>' + (isU ? "<th>종류</th>" : "") +
      '<th class="num">정원내 모집</th><th class="num">경쟁률</th><th class="num">충원율</th><th>입시결과 원문</th></tr></thead><tbody id="listBody"></tbody></table></div>' +
      sourceNote(isU ? SRC_UNIV : SRC_COLLEGE) + "</section>";

    function render() {
      var rows = all.filter(function (x) {
        return (!st.q || x.name.indexOf(st.q) >= 0) && (!st.region || x.region === st.region) &&
          (!st.found || x.found === st.found) && (!st.kind || x._college || x.kind === st.kind);
      });
      rows.sort(function (a, b) {
        if (st.sort === "name") return a.name.localeCompare(b.name, "ko");
        return (b[st.sort] || 0) - (a[st.sort] || 0);
      });
      $("#listCount").textContent = rows.length + "개 대학";
      $("#listBody").innerHTML = rows.map(function (x) {
        var href = (x._college || !isU ? "#/college/" : "#/univ/") + x.code;
        return '<tr class="link-row" data-href="' + esc(href) + '"><td><a href="' + esc(href) + '">' + esc(x.name) + "</a>" + campusTag(x) +
          (x._college ? ' <span class="tag tag-c">전문대</span>' : "") + (x.lastYear && x.lastYear < IDX.meta.univYears[1] ? ' <span class="tag tag-w">' + x.lastYear + "년까지 공시</span>" : "") +
          "</td><td>" + esc(x.region) + "</td><td>" + esc(x.found) + "</td>" + (isU ? "<td>" + esc(x.kind || "전문대학") + "</td>" : "") +
          '<td class="num">' + fmtInt(x.recruit) + '</td><td class="num"><b>' + fmtRate(x.rate) + '</b></td><td class="num">' + fmtPct(x.fill) + "</td><td>" +
          (x.docs ? '<span class="ok">있음</span>' : '<span class="muted">-</span>') + (x.results ? ' <span class="tag tag-c">입결 공개</span>' : "") + "</td></tr>";
      }).join("") || '<tr><td colspan="8" class="empty">조건에 맞는 대학이 없습니다.</td></tr>';
      bindRows();
    }
    $("#fQ").addEventListener("input", function () { st.q = this.value.trim(); render(); });
    $("#fRegion").addEventListener("change", function () { st.region = this.value; render(); });
    $("#fFound").addEventListener("change", function () { st.found = this.value; render(); });
    if (isU) $("#fKind").addEventListener("change", function () { st.kind = this.value; render(); });
    $("#fSort").addEventListener("change", function () { st.sort = this.value; render(); });
    if (st.q) st.kind = "";
    if (isU) $("#fKind").value = st.kind;
    render();
  }

  /* ---------- 공식 원문 자료 ---------- */
  var DOC_KINDS = [["susiResult", "수시 입시결과"], ["jungsiResult", "정시 입시결과"], ["susiGuide", "수시 모집요강"], ["jungsiGuide", "정시 모집요강"], ["plan", "전형 기본계획"]];
  function docsSection(d) {
    var docs = d.documents || [];
    var head = '<h2>대학 공식 발표 자료 (원문)</h2><p class="muted">대학이 직접 발표한 입시결과(합격자 성적 50%·70% 컷 등)와 모집요강 PDF입니다. ' +
      "성적 기준·산출 방식은 대학마다 다르므로 반드시 원문 각주를 함께 확인하세요.</p>";
    if (!docs.length) {
      return head + '<p class="empty">수집된 원문 자료가 없습니다.' + (d.homepage ? ' <a href="' + esc(d.homepage) + '" target="_blank" rel="noopener">대학 홈페이지</a>에서 확인하세요.' : "") + "</p>";
    }
    var campuses = uniq(docs.map(function (x) { return x.campus; }));
    var html = head;
    campuses.forEach(function (c) {
      var list = docs.filter(function (x) { return x.campus === c; });
      html += (campuses.length > 1 ? "<h3>" + esc(c || "본교") + "</h3>" : "") +
        '<div class="table-wrap"><table class="data-table docs"><thead><tr><th>학년도</th>' + DOC_KINDS.map(function (k) { return "<th>" + k[1] + "</th>"; }).join("") +
        "</tr></thead><tbody>" + list.map(function (x) {
          return "<tr><td><b>" + x.year + "</b></td>" + DOC_KINDS.map(function (k) {
            return "<td>" + (x[k[0]] ? '<a class="doc-link" href="' + esc(x[k[0]]) + '" target="_blank" rel="noopener">PDF</a>' : '<span class="muted">-</span>') + "</td>";
          }).join("") + "</tr>";
        }).join("") + "</tbody></table></div>";
    });
    return html + sourceNote(SRC_DOCS + (IDX.meta.linksChecked ? " · 링크 접속 확인 " + esc(IDX.meta.built) : ""));
  }

  /* ---------- 4년제 상세 ---------- */
  function pageUnivDetail(code) {
    view.innerHTML = '<p class="section">불러오는 중…</p>';
    return getJSON("data/univ/" + encodeURIComponent(code) + ".json").then(function (d) {
      var years = [];
      for (var y = IDX.meta.univYears[0]; y <= IDX.meta.univYears[1]; y++) years.push(String(y));
      var st = { q: "", field: "", showOld: false, sort: "college" };
      var fields = uniq(d.departments.map(function (x) { return x.field; })).sort();

      // 대학 전체 연도별 합계 (해당 연도 공시된 모든 학과 합)
      var tot = years.map(function (y) {
        var r = 0, a = 0;
        d.departments.forEach(function (x) { var v = x.y[y]; if (v) { r += v[1]; a += v[2]; } });
        return { k: y, r: r, a: a, v: r ? Math.round(a / r * 10) / 10 : null };
      });

      view.innerHTML =
        '<section class="section"><p class="crumb"><a href="#/univ">4년제 대학</a> ›</p>' +
        '<div class="detail-head"><div><h1>' + esc(d.name) + campusTag(d) + '</h1><p class="muted">' + esc([d.region, d.found, d.kind, d.area].filter(Boolean).join(" · ")) +
        (d.homepage ? ' · <a href="' + esc(d.homepage) + '" target="_blank" rel="noopener">홈페이지</a>' : "") + "</p></div>" +
        '<div class="kpis">' + kpi(d.lastYear + " 정원내 모집", fmtInt(d.recruit) + "명") + kpi("경쟁률", fmtRate(d.rate)) + kpi("신입생 충원율", fmtPct(d.fill)) + kpi("모집 학과", d.depts + "개") + "</div></div>" +
        '<div id="ipsiBox"></div>' +
        '<div class="card"><h2>대학 전체 경쟁률 추이</h2>' + lineChart(tot, { label: "대학 전체 경쟁률", unit: ":1" }) +
        '<div class="table-wrap"><table class="data-table compact"><thead><tr><th>학년도</th>' + tot.map(function (t) { return '<th class="num">' + t.k + "</th>"; }).join("") +
        "</tr></thead><tbody><tr><th>정원내 모집</th>" + tot.map(function (t) { return '<td class="num">' + (t.r ? fmtInt(t.r) : "-") + "</td>"; }).join("") +
        "</tr><tr><th>정원내 지원</th>" + tot.map(function (t) { return '<td class="num">' + (t.a ? fmtInt(t.a) : "-") + "</td>"; }).join("") +
        "</tr><tr><th>경쟁률</th>" + tot.map(function (t) { return '<td class="num"><b>' + (t.v == null ? "-" : t.v.toFixed(1)) + "</b></td>"; }).join("") +
        "</tr></tbody></table></div>" + sourceNote(SRC_UNIV + " · 학과 합계") + "</div>" +

        '<div class="card"><h2>학과별 10개년 추이</h2><p class="muted small">행을 누르면 연도별 상세가 펼쳐집니다. 경쟁률 = 정원내 지원자 ÷ 정원내 모집인원 (수시·정시 전체 합산).</p>' +
        '<div class="toolbar">' +
        '<label>학과 검색<input type="search" id="dQ" placeholder="예: 경영, 간호" /></label>' +
        '<label>계열<select id="dField"><option value="">전체</option>' + fields.map(function (f) { return "<option>" + esc(f) + "</option>"; }).join("") + "</select></label>" +
        '<label>정렬<select id="dSort"><option value="college">단과대학순</option><option value="rate">경쟁률 높은순</option><option value="recruit">모집인원 많은순</option></select></label>' +
        '<label class="check"><input type="checkbox" id="dOld" /> 폐지·개편 학과 포함</label></div>' +
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>단과대학</th><th>학과</th><th>계열</th><th class="num">모집</th><th class="num">지원</th><th class="num">경쟁률</th><th class="num">충원율</th><th>10년 추이</th></tr></thead>' +
        '<tbody id="deptBody"></tbody></table></div>' + sourceNote(SRC_UNIV) + "</div>" +

        resultSection(d) +
        '<div class="card">' + docsSection(d) + "</div></section>";

      bindResults();
      loadIpsi(d);
      favButton(d);
      var open = null;
      function render() {
        var rows = d.departments.filter(function (x) {
          return (st.showOld || x.last === d.lastYear) && (!st.q || x.name.indexOf(st.q) >= 0 || (x.college || "").indexOf(st.q) >= 0) && (!st.field || x.field === st.field);
        });
        rows.sort(function (a, b) {
          var va = a.y[String(a.last)], vb = b.y[String(b.last)];
          if (st.sort === "rate") return (vb[3] || 0) - (va[3] || 0);
          if (st.sort === "recruit") return vb[1] - va[1];
          return (a.college || "").localeCompare(b.college || "", "ko") || a.name.localeCompare(b.name, "ko");
        });
        $("#deptBody").innerHTML = rows.map(function (x) {
          var key = x.name + "|" + x.dn + "|" + x.feat;
          var v = x.y[String(x.last)];
          var html = '<tr class="exp-row' + (open === key ? " is-open" : "") + '" data-key="' + esc(key) + '"><td>' + esc(x.college) + "</td><td><b>" + esc(x.name) + "</b>" +
            (x.dn === "야간" ? ' <span class="tag">야간</span>' : "") + (x.feat && x.feat !== "일반과정" ? ' <span class="tag">' + esc(x.feat) + "</span>" : "") +
            (x.last !== d.lastYear ? ' <span class="tag tag-w">' + x.last + "년까지</span>" : "") + "</td><td>" + esc(x.field) +
            '</td><td class="num">' + fmtInt(v[1]) + '</td><td class="num">' + fmtInt(v[2]) + '</td><td class="num"><b>' + fmtRate(v[3]) +
            '</b></td><td class="num">' + fmtPct(v[5]) + "</td><td>" + spark(years.map(function (y) { return x.y[y] ? x.y[y][3] : null; })) + "</td></tr>";
          if (open === key) {
            html += '<tr class="exp-detail"><td colspan="8">' + lineChart(years.map(function (y) { return { k: y, v: x.y[y] ? x.y[y][3] : null }; }), { label: x.name + " 경쟁률", unit: ":1", h: 180 }) +
              '<div class="table-wrap"><table class="data-table compact"><thead><tr><th>학년도</th>' + years.map(function (y) { return '<th class="num">' + y + "</th>"; }).join("") + "</tr></thead><tbody>" +
              [["입학정원", 0, fmtInt], ["정원내 모집", 1, fmtInt], ["정원내 지원", 2, fmtInt], ["경쟁률", 3, function (n) { return n == null ? "-" : n.toFixed(1); }], ["충원율(%)", 5, function (n) { return n == null ? "-" : n.toFixed(1); }]].map(function (r) {
                return "<tr><th>" + r[0] + "</th>" + years.map(function (y) { return '<td class="num">' + (x.y[y] ? r[2](x.y[y][r[1]]) : "-") + "</td>"; }).join("") + "</tr>";
              }).join("") + "</tbody></table></div></td></tr>";
          }
          return html;
        }).join("") || '<tr><td colspan="8" class="empty">조건에 맞는 학과가 없습니다.</td></tr>';
      }
      $("#deptBody").addEventListener("click", function (e) {
        var tr = e.target.closest(".exp-row");
        if (!tr) return;
        var k = tr.getAttribute("data-key");
        open = open === k ? null : k;
        render();
      });
      $("#dQ").addEventListener("input", function () { st.q = this.value.trim(); render(); });
      $("#dField").addEventListener("change", function () { st.field = this.value; render(); });
      $("#dSort").addEventListener("change", function () { st.sort = this.value; render(); });
      $("#dOld").addEventListener("change", function () { st.showOld = this.checked; render(); });
      render();
      document.title = d.name + " 학과별 경쟁률·입시결과 | 입시나침반";
    });
  }
  /* ---------- 대학 직접 공개 입결 ---------- */
  function resultSection(d) {
    if (!d.resultData || !d.resultData.length) return "";
    return d.resultData.map(function (r) {
      var hasGrade = r.tables.some(function (t) { return t.grade; });
      return '<div class="card result-card"><h2>' + esc(r.title) + ' <span class="tag tag-c">대학 공개 원자료</span></h2>' +
        '<p class="muted small">' + esc(r.note) + "</p>" +
        (hasGrade ? '<div class="toolbar"><label>내 내신 평균등급 (9등급제)<input type="number" class="my-grade" min="1" max="9" step="0.01" inputmode="decimal" placeholder="예: 2.85" /></label>' +
          '<p class="muted small grade-hint">입력하면 학생부등급 평균이 내 등급보다 낮거나 같은(내가 더 유리한) 모집단위를 표시합니다. 평균 비교일 뿐 합격 가능성을 뜻하지 않습니다.</p></div>' : "") +
        r.tables.map(function (t, i) {
          return '<details class="rtable"' + (i < 3 ? " open" : "") + '><summary>' + esc(t.title) + ' <span class="muted small">(' + t.rows.length + "개 모집단위)</span></summary>" +
            '<div class="table-wrap"><table class="data-table compact"' + (t.grade ? ' data-grade="' + t.grade + '"' : "") + "><thead><tr>" +
            t.cols.map(function (c, j) { return "<th" + (j ? ' class="num"' : "") + ">" + esc(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
            t.rows.map(function (row) {
              return "<tr>" + row.map(function (v, j) { return j ? '<td class="num">' + esc(v) + "</td>" : "<td><b>" + esc(v) + "</b></td>"; }).join("") + "</tr>";
            }).join("") + "</tbody></table></div></details>";
        }).join("") +
        '<p class="source">출처: <a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.source) + "</a> (공공데이터포털, " + esc(r.license) + ")</p></div>";
    }).join("");
  }
  function bindResults() {
    $all(".my-grade").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var g = num(inp.value);
        var card = inp.closest(".result-card");
        $all("table[data-grade]", card).forEach(function (tb) {
          var col = +tb.getAttribute("data-grade");
          $all("tbody tr", tb).forEach(function (tr) {
            var v = num(tr.children[col].textContent);
            tr.classList.toggle("hit", g != null && g >= 1 && g <= 9 && v != null && g <= v);
          });
        });
      });
    });
  }

  function kpi(label, value) { return '<div class="kpi"><span>' + esc(label) + "</span><strong>" + esc(value) + "</strong></div>"; }

  /* ---------- 전문대 상세 ---------- */
  var JC_TYPES = ["일반전형", "일반고", "특성화고", "연계교", "고른기회", "특기자", "추천자", "대학자체"];
  function pageCollegeDetail(code) {
    view.innerHTML = '<p class="section">불러오는 중…</p>';
    return getJSON("data/college/" + encodeURIComponent(code) + ".json").then(function (d) {
      var st = { q: "", field: "" };
      var fields = uniq(d.departments.map(function (x) { return x.field; })).sort();
      view.innerHTML =
        '<section class="section"><p class="crumb"><a href="#/college">전문대학</a> ›</p>' +
        '<div class="detail-head"><div><h1>' + esc(d.name) + '</h1><p class="muted">' + esc([d.region, d.found, "전문대학"].join(" · ")) +
        (d.homepage ? ' · <a href="' + esc(d.homepage) + '" target="_blank" rel="noopener">홈페이지</a>' : "") + "</p></div>" +
        '<div class="kpis">' + kpi(IDX.meta.collegeYear + " 정원내 모집", fmtInt(d.recruit) + "명") + kpi("경쟁률", fmtRate(d.rate)) + kpi("등록률", fmtPct(d.fill)) + kpi("모집단위", d.depts + "개") + "</div></div>" +
        '<div class="card"><h2>' + IDX.meta.collegeYear + '학년도 학과·전형별 모집결과</h2><p class="muted small">전형 칸의 숫자는 경쟁률(지원÷모집)이며, 마우스를 올리면 모집·지원·등록 인원이 보입니다.</p>' +
        '<div class="toolbar"><label>학과 검색<input type="search" id="cQ" placeholder="예: 간호, 유아교육" /></label>' +
        '<label>계열<select id="cField"><option value="">전체</option>' + fields.map(function (f) { return "<option>" + esc(f) + "</option>"; }).join("") + "</select></label></div>" +
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>모집단위</th><th>계열</th><th>학제</th><th class="num">모집</th><th class="num">지원</th><th class="num">경쟁률</th>' +
        JC_TYPES.map(function (t) { return '<th class="num">' + t + "</th>"; }).join("") + '</tr></thead><tbody id="cBody"></tbody></table></div>' + sourceNote(SRC_COLLEGE) + "</div>" +
        '<div class="card">' + docsSection(d) + "</div></section>";
      function render() {
        $("#cBody").innerHTML = d.departments.filter(function (x) {
          return (!st.q || x.name.indexOf(st.q) >= 0) && (!st.field || x.field === st.field);
        }).map(function (x) {
          return "<tr><td><b>" + esc(x.name) + "</b>" + (x.dn === "야간" ? ' <span class="tag">야간</span>' : "") + "</td><td>" + esc(x.field) + "</td><td>" + esc(x.years) + "년제</td>" +
            '<td class="num">' + fmtInt(x.recruit) + '</td><td class="num">' + fmtInt(x.apply) + '</td><td class="num"><b>' + fmtRate(x.rate) + "</b></td>" +
            JC_TYPES.map(function (t) {
              var b = x.by[t];
              return '<td class="num">' + (b ? '<span title="모집 ' + b[0] + " · 지원 " + b[1] + " · 등록 " + b[3] + '">' + b[2].toFixed(1) + "</span>" : '<span class="muted">-</span>') + "</td>";
            }).join("") + "</tr>";
        }).join("") || '<tr><td colspan="14" class="empty">조건에 맞는 학과가 없습니다.</td></tr>';
      }
      $("#cQ").addEventListener("input", function () { st.q = this.value.trim(); render(); });
      $("#cField").addEventListener("change", function () { st.field = this.value; render(); });
      render();
      document.title = d.name + " 학과별 경쟁률 | 입시나침반";
    });
  }

  /* ---------- 학과 찾기 ---------- */
  function pageDept(q) {
    view.innerHTML = '<p class="section">학과 목록을 불러오는 중…</p>';
    return Promise.all([DEPTS ? Promise.resolve(DEPTS) : getJSON("data/depts.json"), majorsIndex().catch(function () { return null; })]).then(function (r) {
      var list = r[0];
      DEPTS = list;
      var byCode = {};
      IDX.univ.forEach(function (u) { byCode[u.code] = u; });
      var regions = uniq(IDX.univ.map(function (x) { return x.region; })).sort();
      var fields = uniq(list.map(function (x) { return x[2]; })).sort();
      var st = { q: q.get("q") || "", region: "", field: "", sort: "rate" };
      view.innerHTML =
        '<section class="section"><div class="section-head"><h1>학과 찾기</h1><p>' + IDX.meta.univYears[1] + "학년도 4년제 대학 공시 기준. 같은 이름의 학과를 개설한 전국 대학을 비교합니다. 학과명은 대학마다 표기가 달라 검색어 일부만 입력하는 것이 좋습니다.</p></div>" +
        '<div class="toolbar card"><label>학과명<input type="search" id="pQ" value="' + esc(st.q) + '" placeholder="예: 컴퓨터, 간호, 경영" /></label>' +
        '<label>지역<select id="pRegion"><option value="">전체</option>' + regions.map(function (r) { return "<option>" + esc(r) + "</option>"; }).join("") + "</select></label>" +
        '<label>계열<select id="pField"><option value="">전체</option>' + fields.map(function (r) { return "<option>" + esc(r) + "</option>"; }).join("") + "</select></label>" +
        '<label>정렬<select id="pSort"><option value="rate">경쟁률 높은순</option><option value="recruit">모집인원 많은순</option><option value="name">대학명순</option></select></label></div>' +
        '<div id="pMajors"></div><p class="muted small" id="pCount"></p><div class="table-wrap"><table class="data-table"><thead><tr><th>학과</th><th>대학</th><th>지역</th><th>계열</th><th class="num">정원내 모집</th><th class="num">경쟁률</th></tr></thead><tbody id="pBody"></tbody></table></div>' +
        sourceNote(SRC_UNIV) + "</section>";
      function majorsBox() {
        var box = $("#pMajors");
        if (!MAJORS) { box.innerHTML = ""; return; }
        var ms = st.q ? majorMatches(st.q) : MAJORS.majors.slice(0, 24);
        box.innerHTML = ms.length ? '<div class="card"><h2>' + (st.q ? "학과 정보 보기" : "많이 뽑는 학과 둘러보기") + '</h2><p class="muted small">학과를 누르면 무엇을 배우는지, 전국 개설 대학, 10년 경쟁률·미달 추이를 볼 수 있습니다.</p><div class="chips">' +
          ms.map(function (m) { return '<a class="chip" href="#/major/' + m.id + '">' + esc(m.name) + ' <small>' + m.nUniv + "개 대학</small></a>"; }).join("") + "</div></div>" : "";
      }
      function render() {
        majorsBox();
        if (!st.q && !st.field) {
          $("#pCount").textContent = "학과명을 입력하거나 계열을 선택하세요.";
          $("#pBody").innerHTML = "";
          return;
        }
        var rows = list.filter(function (x) {
          var u = byCode[x[1]];
          return u && (!st.q || x[0].indexOf(st.q) >= 0) && (!st.field || x[2] === st.field) && (!st.region || u.region === st.region);
        });
        rows.sort(function (a, b) {
          if (st.sort === "recruit") return b[3] - a[3];
          if (st.sort === "name") return byCode[a[1]].name.localeCompare(byCode[b[1]].name, "ko");
          return (b[4] || 0) - (a[4] || 0);
        });
        $("#pCount").textContent = rows.length + "개 학과" + (rows.length > 500 ? " (상위 500개 표시)" : "");
        $("#pBody").innerHTML = rows.slice(0, 500).map(function (x) {
          var u = byCode[x[1]];
          return '<tr class="link-row" data-href="#/univ/' + esc(u.code) + '"><td><b>' + esc(x[0]) + '</b></td><td><a href="#/univ/' + esc(u.code) + '">' + esc(u.name) + "</a>" + campusTag(u) +
            "</td><td>" + esc(u.region) + "</td><td>" + esc(x[2]) + '</td><td class="num">' + fmtInt(x[3]) + '</td><td class="num"><b>' + fmtRate(x[4]) + "</b></td></tr>";
        }).join("") || '<tr><td colspan="6" class="empty">검색 결과가 없습니다.</td></tr>';
        bindRows();
      }
      var t;
      $("#pQ").addEventListener("input", function () { var v = this.value.trim(); clearTimeout(t); t = setTimeout(function () { st.q = v; render(); }, 150); });
      $("#pRegion").addEventListener("change", function () { st.region = this.value; render(); });
      $("#pField").addEventListener("change", function () { st.field = this.value; render(); });
      $("#pSort").addEventListener("change", function () { st.sort = this.value; render(); });
      render();
    });
  }

  /* ---------- 학과·진로 ---------- */
  function pageCareers(q) {
    var C = window.CAREERS || [];
    return majorsIndex().catch(function () { return { majors: [] }; }).then(function (ix) {
      var fields = uniq(C.map(function (c) { return c.field; }));
      var cur = q.get("f") || "";
      function stats(c) {
        var ms = ix.majors.filter(function (m) { return c.mids.indexOf(m.mid) >= 0 && (!c.fieldOnly || m.field === c.fieldOnly) && (c.fieldOnly || m.field !== "광역계열"); });
        var rec = 0, app = 0, und = 0, n = 0;
        ms.forEach(function (m) { rec += m.rec; app += (m.rate || 0) * m.rec; if (m.underShare != null) { und += m.underShare * m.nUniv; n += m.nUniv; } });
        return { rec: rec, rate: rec ? app / rec : null, under: n ? und / n : null, ms: ms };
      }
      function majorLink(name) {
        var m = ix.majors.filter(function (x) { return x.name === name || x.aliases.indexOf(name) >= 0; })[0];
        return m ? '<a class="chip" href="#/major/' + m.id + '">' + esc(name) + " <small>" + m.nUniv + "개 대학</small></a>" : '<span class="chip">' + esc(name) + "</span>";
      }
      view.innerHTML = '<section class="section"><div class="section-head"><h1>학과·진로</h1>' +
        "<p>학과 이름만 보고 지원하면 입학 뒤에 ‘생각했던 공부가 아니었다’는 일이 많습니다. 계열·학과군별로 <b>무엇을 배우는지, 어떤 학생에게 맞는지, 고등학교 때 어떤 과목을 들으면 좋은지, 졸업 후 어떤 일을 하는지</b> 정리했습니다. " +
        "학과를 누르면 전국 개설 대학과 10년 경쟁률·미달 추이를 볼 수 있습니다.</p></div>" +
        '<div class="chips field-tabs"><a class="chip' + (cur ? "" : " is-active") + '" href="#/careers">전체</a>' +
        fields.map(function (f) { return '<a class="chip' + (f === cur ? " is-active" : "") + '" href="#/careers?f=' + encodeURIComponent(f) + '">' + esc(f) + "</a>"; }).join("") + "</div>" +
        '<div class="career-grid">' + C.filter(function (c) { return !cur || c.field === cur; }).map(function (c) {
          var st = stats(c);
          return '<article class="card career"><p class="eyebrow-sm">' + esc(c.field) + "</p><h2>" + esc(c.title) + "</h2>" +
            '<div class="kpis mini">' + kpi("전국 모집", fmtInt(st.rec) + "명") + kpi("평균 경쟁률", fmtRate(st.rate)) + kpi("미달 학과", st.under == null ? "-" : Math.round(st.under * 100) + "%") + "</div>" +
            "<dl><dt>무엇을 배우나</dt><dd>" + esc(c.learn) + "</dd><dt>이런 학생에게 맞아요</dt><dd>" + esc(c.fit) + "</dd>" +
            "<dt>고등학교 때 들으면 좋은 과목</dt><dd>" + esc(c.hs) + "</dd><dt>졸업 후 진로</dt><dd>" + esc(c.jobs) + "</dd>" +
            (c.cert ? "<dt>관련 자격·시험</dt><dd>" + esc(c.cert) + "</dd>" : "") + "</dl>" +
            (c.note ? '<p class="muted small">※ ' + esc(c.note) + "</p>" : "") +
            '<div class="chips">' + c.majors.map(majorLink).join("") + "</div></article>";
        }).join("") + "</div>" +
        '<p class="source">수치: ' + SRC_UNIV + " (학과군 합계) · 고교 과목은 2022 개정 교육과정 과목명 기준의 일반적 안내이며, 대학별 ‘권장 이수 과목’은 각 대학 발표를 확인하세요. " +
        '더 자세한 학과 설명: <a href="https://www.career.go.kr" target="_blank" rel="noopener">커리어넷</a></p></section>';
    });
  }

  /* ---------- 학과 정보 ---------- */
  var MAJORS = null;
  function majorsIndex() {
    return MAJORS ? Promise.resolve(MAJORS) : getJSON("data/majors/index.json").then(function (j) { MAJORS = j; return j; });
  }
  function majorMatches(q) {
    if (!MAJORS || !q) return [];
    return MAJORS.majors.filter(function (m) { return m.name.indexOf(q) >= 0 || m.key.indexOf(q) >= 0 || m.aliases.some(function (a) { return a.indexOf(q) >= 0; }); }).slice(0, 12);
  }
  // 커리어넷 학과정보: 응답 구조가 항목마다 조금씩 달라 아는 항목만 골라 보여 준다
  function cnText(v) {
    if (v == null) return "";
    if (Array.isArray(v)) return v.map(cnText).filter(Boolean).join(", ");
    if (typeof v === "object") return Object.keys(v).map(function (k) { return cnText(v[k]); }).filter(Boolean).join(" · ");
    return String(v).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  function cnSection(c) {
    var x = (((c || {}).dataSearch || {}).content || [])[0];
    if (!x) return "";
    var parts = [["학과 개요", x.summary], ["이런 학생에게 맞아요(흥미)", x.interest], ["필요한 적성", x.property],
      ["대학에서 배우는 주요 과목", x.main_subject], ["고등학교 때 들으면 좋은 과목", x.relate_subject], ["졸업 후 진출 분야", x.enter_field],
      ["관련 직업", x.job], ["관련 자격증", x.qualifications], ["추천 활동", x.career_act]];
    var html = parts.map(function (p) {
      var t = cnText(p[1]);
      return t ? "<h3>" + p[0] + "</h3><p>" + esc(t) + "</p>" : "";
    }).join("");
    return html ? '<div class="card major-info"><h2>학과 이해</h2>' + html + sourceNote("커리어넷 학과정보 (한국직업능력연구원)") + "</div>" : "";
  }
  function pageMajor(id) {
    view.innerHTML = '<p class="section">불러오는 중…</p>';
    return getJSON("data/majors/" + encodeURIComponent(id) + ".json").then(function (m) {
      var s = m.series.filter(function (x) { return x.rec; });
      var cnP = m.cn ? getJSON("data/majors/careernet/" + encodeURIComponent(m.cn) + ".json").catch(function () { return null; }) : Promise.resolve(null);
      return majorsIndex().then(function (ix) {
        var cn = (ix.majors.filter(function (x) { return x.id === m.id; })[0] || {}).cn;
        return cn ? getJSON("data/majors/careernet/" + encodeURIComponent(cn) + ".json").catch(function () { return null; }) : cnP;
      }).then(function (cn) {
        var first = s[0], last = s[s.length - 1];
        var change = first && last && first.rec ? Math.round((last.rec - first.rec) / first.rec * 100) : null;
        view.innerHTML =
          '<section class="section"><p class="crumb"><a href="#/dept?q=' + encodeURIComponent(m.key) + '">학과 찾기</a> ›</p>' +
          '<div class="detail-head"><div><h1>' + esc(m.name) + '</h1><p class="muted">' + esc(m.field) + " · " + esc(m.mid) +
          (m.aliases.length > 1 ? " · 같은 학과로 묶은 이름: " + esc(m.aliases.slice(0, 6).join(", ")) : "") + "</p></div>" +
          '<div class="kpis">' + kpi("개설 대학", m.nUniv + "곳") + kpi(m.baseYear + " 전국 모집", fmtInt(m.rec) + "명") + kpi("전국 평균 경쟁률", fmtRate(m.rate)) +
          kpi("미달 학과 비율", m.underShare == null ? "-" : Math.round(m.underShare * 100) + "%") + "</div></div>" +
          (cnSection(cn) || '<div class="card"><h2>학과 이해</h2><p class="muted">이 학과에서 무엇을 배우고 졸업 후 어떤 일을 하는지에 대한 설명은 커리어넷 학과정보 연동 후 제공됩니다. ' +
            '지금은 <a href="https://www.career.go.kr/cnet/front/base/major/FunivMajorList.do" target="_blank" rel="noopener">커리어넷 학과정보</a>에서 ‘' + esc(m.key) + "’을 검색해 보세요.</p></div>") +
          '<div class="card"><h2>전국 추이 ' + (s.length ? s[0].y + "~" + last.y : "") + "</h2>" +
          '<p class="muted small">같은 학과로 묶인 전국 4년제 학과의 합계입니다.' + (change != null ? " 10년 동안 모집인원 " + (change >= 0 ? "+" : "") + change + "%." : "") + "</p>" +
          lineChart(s.map(function (x) { return { k: String(x.y), v: x.rate }; }), { label: m.name + " 전국 경쟁률", unit: ":1" }) +
          '<div class="table-wrap"><table class="data-table compact"><thead><tr><th>학년도</th>' + s.map(function (x) { return '<th class="num">' + x.y + "</th>"; }).join("") + "</tr></thead><tbody>" +
          "<tr><th>개설 학과</th>" + s.map(function (x) { return '<td class="num">' + x.n + "</td>"; }).join("") + "</tr>" +
          "<tr><th>정원내 모집</th>" + s.map(function (x) { return '<td class="num">' + fmtInt(x.rec) + "</td>"; }).join("") + "</tr>" +
          "<tr><th>경쟁률</th>" + s.map(function (x) { return '<td class="num"><b>' + (x.rate == null ? "-" : x.rate.toFixed(1)) + "</b></td>"; }).join("") + "</tr>" +
          "<tr><th>충원율</th>" + s.map(function (x) { return '<td class="num">' + fmtPct(x.fill) + "</td>"; }).join("") + "</tr></tbody></table></div>" +
          sourceNote(SRC_UNIV) + "</div>" +
          '<div class="card"><h2>개설 대학 ' + m.univ.length + '곳</h2><p class="muted small">' + m.baseYear + "학년도 공시. 충원율이 100% 미만이면 그 해 신입생을 다 뽑지 못한(미달) 학과입니다. " +
          '<a href="#/chance">4년제 기회 찾기</a>에서 미달 예상 학과만 모아 볼 수 있습니다.</p>' +
          '<div class="table-wrap"><table class="data-table"><thead><tr><th>대학</th><th>학과명</th><th>지역</th><th class="num">모집</th><th class="num">경쟁률</th><th class="num">충원율</th></tr></thead><tbody>' +
          m.univ.map(function (u) {
            return '<tr class="link-row" data-href="#/univ/' + esc(u.code) + '"><td><a href="#/univ/' + esc(u.code) + '">' + esc(u.univ) + "</a></td><td>" + esc(u.dept) + (u.dn && u.dn !== "주간" ? ' <span class="tag">' + esc(u.dn) + "</span>" : "") +
              "</td><td>" + esc(u.region) + '</td><td class="num">' + fmtInt(u.rec) + '</td><td class="num"><b>' + fmtRate(u.rate) + '</b></td><td class="num">' +
              (u.fill != null && u.fill < 100 ? '<span class="tag tag-w">' + fmtPct(u.fill) + "</span>" : fmtPct(u.fill)) + "</td></tr>";
          }).join("") + "</tbody></table></div>" + sourceNote(SRC_UNIV) + "</div></section>";
        bindRows();
      });
    });
  }

  /* ---------- 4년제 기회 찾기 (미달 예상 대학·학과) ---------- */
  function pageChance(q) {
    view.innerHTML = '<p class="section">불러오는 중…</p>';
    return getJSON("data/risk.json").then(function (R) {
      var regions = uniq(R.univ.map(function (u) { return u.region; })).sort();
      var fields = uniq([].concat.apply([], R.univ.map(function (u) { return u.depts.map(function (d) { return d.field; }); }))).sort();
      var st = { region: q.get("region") || "", field: "", level: "", hideRel: true, hideArt: false, q: "" };
      var bt = R.backtest.methods;
      var hiP = bt["LR(0.5)"] ? Math.round(bt["LR(0.5)"].precision * 100) : null;
      var midP = bt["LR(최적)"] ? Math.round(bt["LR(최적)"].precision * 100) : null;
      view.innerHTML =
        '<section class="section"><div class="section-head"><h1>4년제 기회 찾기</h1>' +
        "<p>등급이 낮아도 4년제 대학에 갈 길은 있습니다. 최근 몇 년간 <b>신입생을 정원만큼 다 뽑지 못한(미달) 대학·학과</b>를 교육부 공시 10개년 자료로 찾아, " +
        R.predictYear + "학년도에도 미달이 예상되는 곳을 보여 줍니다. 이런 학과는 지원하면 합격 가능성이 높고, 수시·정시 뒤 <b>추가모집</b>(매년 2월 말)에서도 다시 기회가 있습니다.</p></div>" +
        '<div class="grid-2">' +
        '<div class="card"><h2>어떻게 골랐나요</h2><ul class="plain small">' +
        "<li>학과별 최근 신입생 충원율·경쟁률·3년간 미달 횟수, 대학 전체 충원율, 모집 규모로 미달 확률을 계산합니다(로지스틱 회귀).</li>" +
        "<li><b>정확도(과거 검증)</b>: " + R.backtest.years[0] + "~" + R.backtest.years[1] + "학년도를 각각 그 전 자료만으로 예측해 본 결과, " +
        (hiP != null ? "‘가능성 높음’으로 고른 학과의 <b>" + hiP + "%</b>가 실제로 미달" : "") + (midP != null ? ", ‘가능성 있음’까지 넓히면 " + midP + "%가 실제로 미달" : "") + "이었습니다. 판별력(AUC) " + R.backtest.auc + ".</li>" +
        "<li><b>검정고시 출신도 지원할 수 있습니다.</b> 정시는 수능 점수로, 수시는 대학이 정한 방식(비교내신 등)으로 지원합니다. 미달이 잦은 대학은 검정고시 출신 지원을 폭넓게 받는 경우가 많으니 모집요강의 ‘지원자격’을 확인하세요.</li>" +
        "<li>합격선(성적 컷)을 보여 주는 화면이 아닙니다. 실제 전형·지원 자격은 대학 모집요강을 확인하세요.</li></ul></div>" +
        '<div class="card"><h2>알고 선택하세요</h2><p class="small">이 목록은 대학을 걸러 내지 않습니다. 불이익이 있더라도 4년제 학위가 더 중요한 학생도 있으니, 아래를 미리 알고 선택하면 됩니다.</p><ul class="plain small">' +
        "<li><b>학자금 지원 제한 여부</b>: 교육부가 매년 8~9월 발표하는 ‘학자금 지원 제한 대학’이면 그 해 국가장학금·학자금 대출이 막힐 수 있습니다. 제한은 해마다 다시 평가되며, 대학이 자체 장학금으로 보전해 주는 경우도 있으니 입학처에 확인하세요.</li>" +
        "<li><b>대학의 재정·취업률·중도탈락률</b>: 대학알리미(academyinfo.go.kr) 공시에서 확인하세요. 신입생이 계속 줄면 학과 통폐합이나 폐교 위험도 있습니다.</li>" +
        "<li><b>장학금</b>: 미달 대학은 신입생 장학금·기숙사 혜택이 큰 경우가 많습니다. 입학처에 직접 물어보세요.</li>" +
        "<li><b>추가모집</b>: 대학어디가(adiga.kr) ‘추가모집’ 안내에서 매년 2월 대학별 모집 학과를 확인할 수 있습니다.</li></ul></div></div>" +
        '<div class="card"><div class="toolbar">' +
        '<label>지역<select id="cRegion"><option value="">전체</option>' + regions.map(function (r) { return "<option>" + esc(r) + "</option>"; }).join("") + "</select></label>" +
        '<label>계열<select id="cField"><option value="">전체</option>' + fields.map(function (r) { return "<option>" + esc(r) + "</option>"; }).join("") + "</select></label>" +
        '<label>가능성<select id="cLevel"><option value="">높음+있음</option><option value="높음">높음만</option></select></label>' +
        '<label>학과·대학 검색<input type="search" id="cQ" placeholder="예: 간호, 경영" /></label>' +
        '<label class="check"><input type="checkbox" id="cRel" checked /> 종교 지도자 양성 학과 숨기기</label>' +
        '<label class="check"><input type="checkbox" id="cArt" /> 예체능(실기) 학과 숨기기</label></div>' +
        '<p class="muted small" id="cCount"></p><div id="cList"></div>' +
        sourceNote(SRC_UNIV + " · " + R.baseYear + "학년도까지 공시 · 분석 " + esc(R.built)) + "</div></section>";

      function deptOk(d) {
        if (st.hideRel && d.tags.indexOf("종교") >= 0) return false;
        if (st.hideArt && d.tags.indexOf("예체능") >= 0) return false;
        if (st.field && d.field !== st.field) return false;
        if (st.level && d.level !== st.level) return false;
        return true;
      }
      function render() {
        var n = 0, nu = 0;
        var html = R.univ.filter(function (u) { return !st.region || u.region === st.region; }).map(function (u) {
          var ds = u.depts.filter(deptOk).filter(function (d) { return !st.q || (u.name + d.name).indexOf(st.q) >= 0; });
          if (!ds.length) return "";
          n += ds.length; nu++;
          return '<div class="chance-univ"><div class="chance-head"><a href="#/univ/' + esc(u.code) + '"><b>' + esc(u.name) + "</b></a>" + (u.campus && u.campus !== "본교" ? ' <span class="tag">' + esc(u.campus) + "</span>" : "") +
            ' <span class="muted small">' + esc(u.region) + " · 대학 전체 충원율 " + R.baseYear + "년 " + u.fill + "% (최근 5년 " + u.fillTrend.join("→") + ")</span></div>" +
            '<div class="table-wrap"><table class="data-table compact"><thead><tr><th>학과</th><th>계열</th><th class="num">모집</th><th class="num">작년 경쟁률</th><th class="num">작년 충원율</th><th>합격 가능성</th></tr></thead><tbody>' +
            ds.map(function (d) {
              return "<tr><td>" + esc(d.name) + d.tags.map(function (t) { return ' <span class="tag">' + esc(t) + "</span>"; }).join("") + "</td><td>" + esc(d.field) +
                '</td><td class="num">' + fmtInt(d.rec) + '</td><td class="num">' + fmtRate(d.rate) + '</td><td class="num">' + fmtPct(d.fill) + "</td><td>" +
                (d.level === "높음" ? '<span class="tag tag-c">높음</span>' : '<span class="tag">있음</span>') + "</td></tr>";
            }).join("") + "</tbody></table></div></div>";
        }).join("");
        $("#cCount").textContent = "대학 " + nu + "곳 · 학과 " + n + "개";
        $("#cList").innerHTML = html || '<p class="empty">조건에 맞는 학과가 없습니다.</p>';
      }
      $("#cRegion").value = st.region;
      $("#cRegion").addEventListener("change", function () { st.region = this.value; render(); });
      $("#cField").addEventListener("change", function () { st.field = this.value; render(); });
      $("#cLevel").addEventListener("change", function () { st.level = this.value; render(); });
      $("#cQ").addEventListener("input", function () { st.q = this.value.trim(); render(); });
      $("#cRel").addEventListener("change", function () { st.hideRel = this.checked; render(); });
      $("#cArt").addEventListener("change", function () { st.hideArt = this.checked; render(); });
      render();
    });
  }

  /* ---------- 내 성적 (내신·모의고사·수능·검정고시) ---------- */
  var GROUPS = ["국어", "수학", "영어", "사회", "과학", "한국사", "기타"];
  var SEMS = ["1-1", "1-2", "2-1", "2-2", "3-1", "3-2"];
  var EXAM_KINDS = [
    "교육청 학력평가 3월", "교육청 학력평가 4월", "평가원 모의평가 6월", "교육청 학력평가 7월",
    "평가원 모의평가 9월", "교육청 학력평가 10월", "교육청 학력평가 11월(고1·2)", "수능 가채점", "수능 성적표(실채점)"
  ];
  var KOR_SEL = ["", "화법과 작문", "언어와 매체"];
  var MATH_SEL = ["", "확률과 통계", "미적분", "기하"];
  var TAM_SUBJ = ["", "생활과 윤리", "윤리와 사상", "한국지리", "세계지리", "동아시아사", "세계사", "경제", "정치와 법", "사회·문화",
    "물리학Ⅰ", "화학Ⅰ", "생명과학Ⅰ", "지구과학Ⅰ", "물리학Ⅱ", "화학Ⅱ", "생명과학Ⅱ", "지구과학Ⅱ", "직업탐구"];
  // 영역: 키, 이름, 원점수 최대, 표준점수 최대(없으면 절대평가), 선택과목 목록
  var AREAS = [
    { k: "kor", n: "국어", raw: 100, std: 200, sel: KOR_SEL },
    { k: "math", n: "수학", raw: 100, std: 200, sel: MATH_SEL },
    { k: "eng", n: "영어", raw: 100, abs: "eng" },
    { k: "his", n: "한국사", raw: 50, abs: "his" },
    { k: "t1", n: "탐구1", raw: 50, std: 100, sel: TAM_SUBJ },
    { k: "t2", n: "탐구2", raw: 50, std: 100, sel: TAM_SUBJ }
  ];
  var GED_SUBJ = ["국어", "수학", "영어", "사회", "과학", "한국사"];
  var GED_OPT = ["도덕", "기술·가정", "체육", "음악", "미술"];

  function absGrade(kind, raw) {
    var v = num(raw);
    if (kind === "eng") return v == null || v < 0 || v > 100 ? null : Math.min(9, 10 - Math.floor(Math.min(v, 99) / 10));
    return v == null || v < 0 || v > 50 ? null : (v >= 40 ? 1 : Math.min(9, 1 + Math.ceil((40 - v) / 5)));
  }
  function gradeOf(rec, k) {
    var a = rec.s && rec.s[k] || {};
    var g = num(a.grade);
    if (g >= 1 && g <= 9) return Math.round(g);
    var area = AREAS.filter(function (x) { return x.k === k; })[0];
    if (area && area.abs) return absGrade(area.abs, a.raw);
    return pctGrade(a.pct);
  }
  // 상대평가 영역: 수능 등급은 누적 비율 4·11·23·40·60·77·89·96% 로 나뉜다. 백분위로 등급을 구한다
  // (동점자 처리 때문에 경계 근처에서는 성적표 등급과 1등급 차이가 날 수 있어 '백분위 기준'으로 표시)
  function pctGrade(p) {
    var v = num(p);
    if (v == null || v < 0 || v > 100) return null;
    var cut = [96, 89, 77, 60, 40, 23, 11, 4];
    for (var i = 0; i < cut.length; i++) if (v >= cut[i]) return i + 1;
    return 9;
  }
  function gradeNote(rec, k) {
    var a = rec.s && rec.s[k] || {};
    if (num(a.grade) >= 1) return "";
    var area = AREAS.filter(function (x) { return x.k === k; })[0];
    if (area.abs) return num(a.raw) != null ? "원점수 기준" : "";
    return num(a.pct) != null ? "백분위 기준" : "";
  }
  // 수능 최저: 대상 영역에서 필수 영역을 넣고 나머지는 좋은 등급부터 채워 합산
  function minCheck(rec, r) {
    var t1 = gradeOf(rec, "t1"), t2 = gradeOf(rec, "t2"), tam = null;
    if (r.tam === "top1") tam = [t1, t2].filter(function (x) { return x != null; }).sort()[0];
    else if (t1 != null && t2 != null) { tam = (t1 + t2) / 2; if (r.tam === "avg2f") tam = Math.floor(tam); else if (r.tam === "avg2c") tam = Math.ceil(tam); }
    var g = { kor: gradeOf(rec, "kor"), math: gradeOf(rec, "math"), eng: gradeOf(rec, "eng"), tam: tam };
    var use = ["kor", "math", "eng", "tam"].filter(function (k) { return r.use[k]; });
    var need = Math.min(+r.count || 0, use.length);
    var must = use.filter(function (k) { return r.must[k]; });
    if (!need) return { ok: null, msg: "반영 영역 수를 정하세요" };
    if (must.length > need) return { ok: null, msg: "필수 영역이 반영 영역 수보다 많습니다" };
    var missing = use.filter(function (k) { return g[k] == null; });
    if (must.some(function (k) { return g[k] == null; })) return { ok: null, msg: "필수 영역 등급이 없습니다" };
    var rest = use.filter(function (k) { return must.indexOf(k) < 0 && g[k] != null; }).sort(function (a, b) { return g[a] - g[b]; });
    var pick = must.concat(rest).slice(0, need);
    if (pick.length < need) return { ok: null, msg: "입력된 등급이 부족합니다 (" + missing.map(areaName).join("·") + ")" };
    var sum = pick.reduce(function (s, k) { return s + g[k]; }, 0);
    var ok = sum <= +r.max;
    var his = gradeOf(rec, "his");
    var hisMsg = "";
    if (num(r.his)) { if (his == null) return { ok: null, msg: "한국사 등급이 없습니다" }; if (his > +r.his) { ok = false; hisMsg = " · 한국사 " + his + "등급(기준 " + r.his + " 이내) 미충족"; } }
    return { ok: ok, msg: pick.map(function (k) { return areaName(k) + " " + fmtG(g[k]); }).join(" + ") + " = " + fmtG(sum) + " (기준 " + r.max + " 이내)" + hisMsg };
  }
  function areaName(k) { return { kor: "국어", math: "수학", eng: "영어", tam: "탐구" }[k]; }
  function fmtG(v) { return v == null ? "-" : (Math.round(v * 100) / 100).toString(); }
  function newId() { return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function pageCalc() {
    var s = load();
    s.gpa = s.gpa || { system: "9", rows: [] };
    s.who = s.who || "재학생";
    s.exams = s.exams || [];
    s.ged = s.ged || { opt: "도덕", sc: {} };
    s.rule = s.rule || { count: 2, max: 5, tam: "top1", his: "", use: { kor: true, math: true, eng: true, tam: true }, must: {} };
    s.tab = s.tab || (s.who === "검정고시" ? "ged" : "exam");
    if (!s.cur || !s.exams.some(function (e) { return e.id === s.cur; })) s.cur = s.exams.length ? s.exams[s.exams.length - 1].id : null;

    var WHO_NOTE = {
      "재학생": "수시는 보통 3학년 1학기까지의 학생부(내신)로, 정시는 수능 점수로 선발합니다. 내신과 모의고사·수능을 모두 입력해 두세요.",
      "졸업생": "졸업생(N수생)은 정시는 재학생과 똑같이 수능 점수로 지원합니다. 수시는 3학년 2학기까지 내신이 반영될 수 있고, 일부 교과·학교장추천 전형은 졸업연도 제한(예: 재학생·직전 졸업생만)이 있으니 모집요강 ‘지원자격’을 꼭 확인하세요.",
      "검정고시": "정시는 재학생과 똑같이 수능 점수로 지원합니다(모의고사·수능 탭 사용). 수시는 대학마다 지원 가능 여부와 검정고시 성적을 내신으로 바꾸는 방식(‘비교내신’)이 달라, 같은 점수라도 대학별 환산 등급이 다릅니다. 학교장추천 전형은 대부분 지원할 수 없습니다. 모집요강의 ‘지원자격’과 ‘검정고시 출신자 성적 산출’ 항목을 확인하세요."
    };

    view.innerHTML =
      '<section class="section"><div class="section-head"><h1>내 성적</h1><p>내신, 모의고사, 수능 가채점·실채점, 검정고시 성적을 입력하고 수능 최저 충족 여부를 확인합니다. ' +
      "<b>입력한 성적은 이 기기의 브라우저에만 저장되며 서버로 전송되지 않습니다.</b></p></div>" +
      '<div class="card"><div class="toolbar"><label>나는<select id="who"><option>재학생</option><option>졸업생</option><option>검정고시</option></select></label>' +
      '<p class="muted small" id="whoNote" style="flex:3 1 320px;margin:0"></p></div>' +
      '<div class="tabs" role="tablist"><button type="button" data-tab="exam">모의고사·수능</button><button type="button" data-tab="gpa">학생부 내신</button><button type="button" data-tab="ged">검정고시</button><button type="button" data-tab="record">학생부 기록</button><button type="button" data-tab="counsel">상담 기록</button></div></div>' +
      '<div id="tabBody"></div>' +
      '<div class="callout"><b>합격 가능성 예측은 제공하지 않습니다.</b> 이 화면은 입력한 성적을 정리하고, 정해진 규칙(등급 합, 절대평가 기준)만 계산합니다. ' +
      "대학별 합격선은 각 대학이 발표한 공식 입시결과 원문(대학 상세 페이지)에서, 수능 최저 기준과 반영 방법은 해당 학년도 모집요강에서 확인하세요.</div></section>";

    $("#who").value = s.who;
    $("#who").addEventListener("change", function () { s.who = this.value; if (s.who === "검정고시") s.tab = "ged"; save(s); head(); renderTab(); });
    $all(".tabs button").forEach(function (b) { b.addEventListener("click", function () { s.tab = b.getAttribute("data-tab"); save(s); head(); renderTab(); }); });
    function head() {
      $("#whoNote").textContent = WHO_NOTE[s.who];
      $all(".tabs button").forEach(function (b) {
        var on = b.getAttribute("data-tab") === s.tab;
        b.classList.toggle("is-active", on); b.setAttribute("aria-selected", String(on));
      });
    }
    function renderTab() {
      var t = { gpa: tabGpa, ged: tabGed, record: tabRecord, counsel: tabCounsel }[s.tab] || tabExam;
      var body = $("#tabBody"), fresh = body.cloneNode(false); body.parentNode.replaceChild(fresh, body);  // 탭마다 붙인 이벤트 정리
      t();
    }

    /* --- 모의고사·수능 --- */
    function tabExam() {
      var rec = s.exams.filter(function (e) { return e.id === s.cur; })[0];
      $("#tabBody").innerHTML =
        '<div class="card"><h2>모의고사·수능 성적</h2>' +
        '<div class="toolbar"><label>저장된 성적<select id="eSel">' +
        (s.exams.length ? s.exams.map(function (e) { return '<option value="' + e.id + '"' + (e.id === s.cur ? " selected" : "") + ">" + esc(examLabel(e)) + "</option>"; }).join("") : "<option value=\"\">(없음)</option>") +
        '</select></label><div class="toolbar-actions"><button class="btn btn-primary" type="button" id="eNew">+ 새 시험 성적</button>' +
        (rec ? '<button class="btn btn-ghost danger" type="button" id="eDel">이 성적 삭제</button>' : "") + "</div></div>" +
        (rec ? examForm(rec) : '<p class="empty">‘+ 새 시험 성적’을 눌러 모의고사·가채점·수능 성적을 입력하세요.</p>') + "</div>" +
        (rec ? minCard(rec) : "") + (s.exams.length > 1 ? trendCard() : "");

      $("#eSel").addEventListener("change", function () { s.cur = this.value; save(s); tabExam(); });
      $("#eNew").addEventListener("click", function () {
        var y = new Date().getFullYear() + (new Date().getMonth() >= 11 ? 2 : 1);
        var e = { id: newId(), kind: "교육청 학력평가 3월", year: String(y), grade: "고3", s: {} };
        s.exams.push(e); s.cur = e.id; save(s); tabExam();
      });
      if (!rec) return;
      $("#eDel").addEventListener("click", function () {
        if (!confirm(examLabel(rec) + " 성적을 삭제할까요?")) return;
        s.exams = s.exams.filter(function (e) { return e.id !== rec.id; }); s.cur = null; save(s); pageCalc();
      });
      $("#eMeta").addEventListener("input", function (e) {
        var k = e.target.getAttribute("data-m"); if (!k) return;
        rec[k] = e.target.value; save(s);
        var o = $("#eSel option[value='" + rec.id + "']"); if (o) o.textContent = examLabel(rec);
        $("#eHint").innerHTML = examHint(rec);
      });
      $("#eRows").addEventListener("input", function (e) {
        var tr = e.target.closest("tr"), k = e.target.getAttribute("data-k");
        if (!tr || !k) return;
        var a = tr.getAttribute("data-a");
        rec.s[a] = rec.s[a] || {}; rec.s[a][k] = e.target.value; save(s);
        var area = AREAS.filter(function (x) { return x.k === a; })[0];
        var g = num(rec.s[a].grade) >= 1 ? null : gradeOf(rec, a); $(".auto", tr).textContent = g ? "→ " + g + "등급" : "";
        validate(e.target, area, k);
        updMin(rec); updSum(rec);
      });
      bindRule(rec);
      updSum(rec);
    }
    function examLabel(e) { return (e.year ? e.year + "학년도 " : "") + e.kind + (e.grade && e.grade !== "고3" ? " (" + e.grade + ")" : ""); }
    function examHint(e) {
      if (e.kind === "수능 가채점") return "가채점은 <b>원점수</b>만 정확합니다. 국어·수학·탐구의 등급·표준점수·백분위는 성적표가 나오기 전까지 입시기관 추정 등급컷에 따른 <b>예상값</b>이므로, 입력하더라도 실제와 다를 수 있습니다. 영어·한국사 등급은 절대평가라 원점수로 정확히 계산됩니다.";
      if (e.kind === "수능 성적표(실채점)") return "수능 성적표에는 원점수가 나오지 않습니다. 성적표의 <b>표준점수·백분위·등급</b>을 그대로 입력하세요(영어·한국사는 등급만).";
      return "성적표의 원점수·표준점수·백분위·등급을 그대로 입력하세요. 모르는 칸은 비워 두면 됩니다. 등급 칸을 비우면 영어·한국사는 원점수로, 국어·수학·탐구는 백분위로 등급을 계산합니다(백분위 기준 등급은 경계 근처에서 성적표와 다를 수 있음). 원점수만으로는 국어·수학·탐구 등급을 정할 수 없습니다(시험마다 등급컷이 다름).";
    }
    function examForm(e) {
      return '<div class="toolbar" id="eMeta">' +
        '<label>시험<select data-m="kind">' + EXAM_KINDS.map(function (k) { return "<option" + (k === e.kind ? " selected" : "") + ">" + k + "</option>"; }).join("") + "</select></label>" +
        '<label>대상 학년도(수능 기준)<input data-m="year" type="number" min="2020" max="2035" inputmode="numeric" value="' + esc(e.year) + '" /></label>' +
        '<label>응시 학년<select data-m="grade">' + ["고1", "고2", "고3", "졸업생"].map(function (k) { return "<option" + (k === e.grade ? " selected" : "") + ">" + k + "</option>"; }).join("") + "</select></label>" +
        '<label>메모<input data-m="memo" value="' + esc(e.memo || "") + '" placeholder="예: 국어 시간 부족" /></label></div>' +
        '<p class="muted small" id="eHint">' + examHint(e) + "</p>" +
        '<div class="table-wrap"><table class="data-table score-table"><thead><tr><th>영역</th><th>선택과목</th><th class="num">원점수</th><th class="num">표준점수</th><th class="num">백분위</th><th class="num">등급</th></tr></thead><tbody id="eRows">' +
        AREAS.map(function (a) {
          var v = e.s[a.k] || {};
          var sel = a.sel ? '<select data-k="sub">' + a.sel.map(function (x) { return '<option value="' + esc(x) + '"' + (x === (v.sub || "") ? " selected" : "") + ">" + (x || "선택") + "</option>"; }).join("") + "</select>" : '<span class="muted small">절대평가</span>';
          var inp = function (k, max, ph) { return '<input data-k="' + k + '" type="number" min="0" max="' + max + '" step="any" inputmode="decimal" value="' + esc(v[k] == null ? "" : v[k]) + '" placeholder="' + (ph || "") + '" />'; };
          var g = num(v.grade) >= 1 ? null : gradeOf(e, a.k);
          return '<tr data-a="' + a.k + '"><th>' + a.n + "</th><td>" + sel + "</td>" +
            '<td class="num">' + inp("raw", a.raw, "0~" + a.raw) + "</td>" +
            '<td class="num">' + (a.std ? inp("std", a.std) : '<span class="muted">-</span>') + "</td>" +
            '<td class="num">' + (a.std ? inp("pct", 100, "0~100") : '<span class="muted">-</span>') + "</td>" +
            '<td class="num">' + inp("grade", 9, "1~9") + ' <small class="auto muted">' + (g ? "→ " + g + "등급" : "") + "</small></td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<div class="kpis wide" id="eSum"></div>';
    }
    function validate(el, area, k) {
      var v = num(el.value), max = k === "raw" ? area.raw : k === "std" ? area.std : k === "pct" ? 100 : 9, min = k === "grade" ? 1 : 0;
      var bad = el.value !== "" && (v == null || v < min || v > max || (k === "grade" && v !== Math.round(v)));
      el.classList.toggle("invalid", bad);
      el.title = bad ? min + "~" + max + " 범위로 입력하세요" : "";
    }
    function updSum(rec) {
      var g = function (k) { return gradeOf(rec, k); };
      var pick = function (k, f) { var v = num(rec.s[k] && rec.s[k][f]); return v; };
      var items = [["국어", "kor"], ["수학", "math"], ["영어", "eng"], ["탐구1", "t1"], ["탐구2", "t2"], ["한국사", "his"]]
        .map(function (x) { var v = g(x[1]), n = gradeNote(rec, x[1]); return '<div class="kpi"><span>' + x[0] + "</span><strong>" + (v ? v + "등급" : "-") + "</strong>" + (v && n ? "<small>" + n + "</small>" : "") + "</div>"; });
      var pk = pick("kor", "pct"), pm = pick("math", "pct"), p1 = pick("t1", "pct"), p2 = pick("t2", "pct");
      if (pk != null && pm != null && p1 != null && p2 != null)
        items.push('<div class="kpi"><span>백분위 합 (국+수+탐2과목)</span><strong>' + fmtG(pk + pm + p1 + p2) + "</strong><small>참고용 단순 합</small></div>");
      var sk = pick("kor", "std"), sm = pick("math", "std"), s1 = pick("t1", "std"), s2 = pick("t2", "std");
      if (sk != null && sm != null && s1 != null && s2 != null)
        items.push('<div class="kpi"><span>표준점수 합 (국+수+탐2과목)</span><strong>' + fmtG(sk + sm + s1 + s2) + "</strong><small>참고용 단순 합</small></div>");
      $("#eSum").innerHTML = items.join("") +
        '<p class="muted small" style="flex-basis:100%;margin:4px 0 0">합계는 단순 합입니다. 대학별 정시 환산점수는 영역별 반영 비율·탐구 변환표준점수·가산점이 달라 이 값과 다릅니다.</p>';
    }

    /* --- 수능 최저 확인 --- */
    function minCard(rec) {
      var r = s.rule;
      var chk = function (grp, k, label) { return '<label class="check"><input type="checkbox" data-r="' + grp + '" data-k="' + k + '"' + (r[grp][k] ? " checked" : "") + " /> " + label + "</label>"; };
      return '<div class="card"><h2>수능 최저학력기준 충족 확인</h2>' +
        '<p class="muted small">모집요강의 기준을 그대로 옮겨 넣으세요. 예) “국어, 수학, 영어, 탐구(1과목) 중 2개 영역 등급 합 5 이내, 한국사 4등급 이내” → 반영 영역 4개 모두 체크, 2개 합 5, 탐구 상위 1과목, 한국사 4.</p>' +
        '<div class="toolbar" id="ruleBox">' +
        '<div><span class="muted small">반영 영역</span><div>' + chk("use", "kor", "국어") + chk("use", "math", "수학") + chk("use", "eng", "영어") + chk("use", "tam", "탐구") + "</div></div>" +
        '<div><span class="muted small">반드시 포함할 영역</span><div>' + chk("must", "kor", "국어") + chk("must", "math", "수학") + chk("must", "eng", "영어") + chk("must", "tam", "탐구") + "</div></div>" +
        '<label>몇 개 영역<select data-r="count">' + [1, 2, 3, 4].map(function (n) { return "<option" + (n === +r.count ? " selected" : "") + ">" + n + "</option>"; }).join("") + "</select></label>" +
        '<label>등급 합 (이내)<input data-r="max" type="number" min="1" max="36" inputmode="numeric" value="' + esc(r.max) + '" /></label>' +
        '<label>탐구 반영<select data-r="tam">' +
        [["top1", "상위 1과목"], ["avg2", "2과목 평균(소수점 그대로)"], ["avg2f", "2과목 평균(소수점 버림)"], ["avg2c", "2과목 평균(소수점 올림)"]].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === r.tam ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>" +
        '<label>한국사 (이내, 없으면 비움)<input data-r="his" type="number" min="1" max="9" inputmode="numeric" value="' + esc(r.his) + '" /></label></div>' +
        '<div id="minOut"></div>' +
        '<p class="muted small">대학에 따라 수학 선택과목(미적분·기하) 지정, 과학탐구 지정, 제2외국어/한문의 탐구 대체 등 추가 조건이 있습니다. 이런 조건은 여기서 계산하지 않으니 모집요강에서 직접 확인하세요.</p></div>';
    }
    function bindRule(rec) {
      var box = $("#ruleBox");
      var h = function (e) {
        var g = e.target.getAttribute("data-r"); if (!g) return;
        if (g === "use" || g === "must") s.rule[g][e.target.getAttribute("data-k")] = e.target.checked;
        else s.rule[g] = e.target.value;
        save(s); updMin(rec);
      };
      box.addEventListener("input", h); box.addEventListener("change", h);
      updMin(rec);
    }
    function updMin(rec) {
      var out = $("#minOut"); if (!out) return;
      var rows = s.exams.map(function (e) { return [e, minCheck(e, s.rule)]; });
      out.innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr><th>시험</th><th>결과</th><th>계산</th></tr></thead><tbody>' +
        rows.map(function (x) {
          var res = x[1], badge = res.ok === true ? '<span class="tag tag-c">충족</span>' : res.ok === false ? '<span class="tag tag-w">미충족</span>' : '<span class="tag">확인 불가</span>';
          return "<tr" + (x[0].id === rec.id ? ' class="is-cur"' : "") + "><td>" + esc(examLabel(x[0])) + "</td><td>" + badge + "</td><td class=\"small\">" + esc(res.msg) + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    }
    function trendCard() {
      var cols = [["kor", "국어"], ["math", "수학"], ["eng", "영어"], ["t1", "탐구1"], ["t2", "탐구2"], ["his", "한국사"]];
      return '<div class="card"><h2>시험별 등급 추이</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>시험</th>' +
        cols.map(function (c) { return '<th class="num">' + c[1] + "</th>"; }).join("") + "</tr></thead><tbody>" +
        s.exams.map(function (e) {
          return "<tr><td>" + esc(examLabel(e)) + "</td>" + cols.map(function (c) { var g = gradeOf(e, c[0]); return '<td class="num">' + (g || "-") + "</td>"; }).join("") + "</tr>";
        }).join("") + "</tbody></table></div></div>";
    }

    /* --- 학생부 내신 --- */
    function tabGpa() {
      $("#tabBody").innerHTML =
        '<div class="card"><h2>학생부 내신 평균등급</h2><p class="muted small">평균등급 = Σ(등급 × 단위수) ÷ Σ단위수. 진로선택(성취도 A·B·C) 과목은 대학마다 반영 방식이 달라 제외하고 입력하세요. ' +
        "실제 대학별 환산점수는 반영 교과·학년별 비율·가산점이 달라 이 평균과 다를 수 있습니다.</p>" +
        '<div class="toolbar"><label>등급 체계<select id="gSys"><option value="9">9등급제 (2025학년도 고1 이전 입학)</option><option value="5">5등급제 (2025년 고1 입학부터)</option></select></label>' +
        '<div class="toolbar-actions"><button class="btn btn-ghost" type="button" id="gAdd">+ 과목 추가</button><button class="btn btn-ghost danger" type="button" id="gClear">전체 삭제</button></div></div>' +
        '<div class="table-wrap"><table class="data-table gpa-table"><thead><tr><th>학기</th><th>교과</th><th>과목명</th><th>단위수(학점)</th><th>석차등급</th><th></th></tr></thead><tbody id="gRows"></tbody></table></div>' +
        '<div class="kpis wide" id="gStats"></div></div>';

      function rowHtml(r, i) {
        var max = s.gpa.system === "5" ? 5 : 9;
        return '<tr data-i="' + i + '"><td><select data-k="sem">' + SEMS.map(function (x) { return "<option" + (x === r.sem ? " selected" : "") + ">" + x + "</option>"; }).join("") + "</select></td>" +
          '<td><select data-k="group">' + GROUPS.map(function (x) { return "<option" + (x === r.group ? " selected" : "") + ">" + x + "</option>"; }).join("") + "</select></td>" +
          '<td><input data-k="name" value="' + esc(r.name) + '" placeholder="과목명" /></td>' +
          '<td><input data-k="unit" type="number" min="1" max="10" inputmode="numeric" value="' + esc(r.unit) + '" /></td>' +
          '<td><input data-k="grade" type="number" min="1" max="' + max + '" inputmode="numeric" value="' + esc(r.grade) + '" /></td>' +
          '<td><button type="button" class="icon-btn" data-del aria-label="삭제">×</button></td></tr>';
      }
      function avg(rows) {
        var sum = 0, u = 0, max = s.gpa.system === "5" ? 5 : 9;
        rows.forEach(function (r) { var g = num(r.grade), w = num(r.unit); if (g >= 1 && g <= max && w > 0) { sum += g * w; u += w; } });
        return u ? { v: sum / u, u: u } : null;
      }
      function stats() {
        var rows = s.gpa.rows;
        var pick = function (gs) { return rows.filter(function (r) { return gs.indexOf(r.group) >= 0; }); };
        var items = [["전과목", avg(rows)], ["국영수사과", avg(pick(["국어", "수학", "영어", "사회", "과학"]))], ["국영수과", avg(pick(["국어", "수학", "영어", "과학"]))], ["국영수사", avg(pick(["국어", "수학", "영어", "사회"]))]];
        SEMS.forEach(function (sm) { var a = avg(rows.filter(function (r) { return r.sem === sm; })); if (a) items.push([sm + "학기", a]); });
        $("#gStats").innerHTML = items.map(function (it) {
          return '<div class="kpi"><span>' + it[0] + "</span><strong>" + (it[1] ? it[1].v.toFixed(2) : "-") + "</strong><small>" + (it[1] ? it[1].u + "단위" : "") + "</small></div>";
        }).join("");
      }
      function render() {
        $("#gSys").value = s.gpa.system;
        $("#gRows").innerHTML = s.gpa.rows.map(rowHtml).join("") || '<tr><td colspan="6" class="empty">‘+ 과목 추가’로 과목을 입력하세요.</td></tr>';
        stats();
      }
      $("#gRows").addEventListener("input", function (e) {
        var tr = e.target.closest("tr"), k = e.target.getAttribute("data-k");
        if (!tr || !k) return;
        s.gpa.rows[+tr.getAttribute("data-i")][k] = e.target.value; save(s); stats();
      });
      $("#gRows").addEventListener("click", function (e) {
        if (!e.target.hasAttribute("data-del")) return;
        s.gpa.rows.splice(+e.target.closest("tr").getAttribute("data-i"), 1); save(s); render();
      });
      $("#gAdd").addEventListener("click", function () {
        var last = s.gpa.rows[s.gpa.rows.length - 1];
        s.gpa.rows.push({ sem: last ? last.sem : "1-1", group: "국어", name: "", unit: 4, grade: "" }); save(s); render();
      });
      $("#gClear").addEventListener("click", function () { if (confirm("입력한 과목을 모두 삭제할까요?")) { s.gpa.rows = []; save(s); render(); } });
      $("#gSys").addEventListener("change", function () { s.gpa.system = this.value; save(s); render(); });
      render();
    }

    /* --- 검정고시 --- */
    function tabGed() {
      var g = s.ged;
      $("#tabBody").innerHTML =
        '<div class="card"><h2>고졸 검정고시 성적</h2>' +
        '<p class="muted small">필수 6과목(국어·수학·영어·사회·과학·한국사)과 선택 1과목의 점수(0~100)를 합격증명서·성적증명서 그대로 입력하세요.</p>' +
        '<div class="table-wrap"><table class="data-table score-table"><thead><tr><th>과목</th><th class="num">점수</th></tr></thead><tbody id="gedRows">' +
        GED_SUBJ.map(function (n) { return '<tr data-g="' + n + '"><th>' + n + '</th><td class="num"><input type="number" min="0" max="100" step="any" inputmode="decimal" value="' + esc(g.sc[n] == null ? "" : g.sc[n]) + '" /></td></tr>'; }).join("") +
        '<tr data-g="opt"><th>선택 <select id="gedOpt">' + GED_OPT.map(function (n) { return "<option" + (n === g.opt ? " selected" : "") + ">" + n + "</option>"; }).join("") + "</select></th>" +
        '<td class="num"><input type="number" min="0" max="100" step="any" inputmode="decimal" value="' + esc(g.sc.opt == null ? "" : g.sc.opt) + '" /></td></tr>' +
        "</tbody></table></div>" +
        '<div class="kpis wide" id="gedSum"></div></div>' +
        '<div class="card"><h2>검정고시 출신자가 알아야 할 것</h2><ul class="plain">' +
        "<li><b>정시</b>: 재학생·졸업생과 똑같이 수능 점수로만 선발합니다. ‘모의고사·수능’ 탭에 성적을 입력하세요.</li>" +
        "<li><b>수시 교과·종합</b>: 학생부가 없으므로 대학이 정한 방식으로 검정고시 점수를 내신 등급으로 바꿉니다(‘비교내신’). 검정고시 점수 구간별 환산표를 쓰는 대학, 수능 성적과 연계하는 대학, 서류·면접으로만 보는 대학 등 방식이 모두 다릅니다. <b>같은 평균 점수라도 대학마다 환산 등급이 다르므로</b> 이 사이트는 등급을 임의로 환산하지 않습니다.</li>" +
        "<li><b>지원 제한</b>: 학교장추천이 필요한 전형은 대부분 지원할 수 없고, 일부 대학은 검정고시 출신자의 수시 지원 자체를 제한합니다.</li>" +
        "<li><b>확인할 곳</b>: 지원하려는 대학 모집요강의 ‘지원자격’, ‘검정고시 출신자 성적 산출(비교내신)’ 항목. 대학 상세 페이지 하단의 모집요강 원문 링크를 이용하세요.</li>" +
        '<li><b>합격 가능성이 높은 4년제</b>: <a href="#/chance">4년제 기회 찾기</a>에서 최근 미달이 이어진 대학·학과를 볼 수 있습니다. 검정고시 출신도 지원할 수 있는 곳이 많습니다.</li>' +
        "</ul></div>";
      $("#gedRows").addEventListener("input", function (e) {
        var tr = e.target.closest("tr"); if (!tr) return;
        if (e.target.id === "gedOpt") { g.opt = e.target.value; save(s); return; }
        var v = e.target.value, n = num(v);
        e.target.classList.toggle("invalid", v !== "" && (n == null || n < 0 || n > 100));
        g.sc[tr.getAttribute("data-g")] = v; save(s); gedSum();
      });
      $("#gedOpt").addEventListener("change", function () { g.opt = this.value; save(s); });
      gedSum();
    }
    function gedSum() {
      var g = s.ged, vals = GED_SUBJ.map(function (n) { return num(g.sc[n]); }), opt = num(g.sc.opt);
      var ok = function (a) { return a.every(function (v) { return v != null && v >= 0 && v <= 100; }); };
      var m6 = ok(vals) ? vals.reduce(function (a, b) { return a + b; }, 0) / 6 : null;
      var m7 = ok(vals.concat([opt])) ? (vals.reduce(function (a, b) { return a + b; }, 0) + opt) / 7 : null;
      $("#gedSum").innerHTML =
        '<div class="kpi"><span>전 과목 평균 (7과목)</span><strong>' + (m7 == null ? "-" : m7.toFixed(2)) + "</strong></div>" +
        '<div class="kpi"><span>필수 6과목 평균</span><strong>' + (m6 == null ? "-" : m6.toFixed(2)) + "</strong></div>" +
        '<p class="muted small" style="flex-basis:100%;margin:4px 0 0">평균은 단순 산술평균입니다. 대학별 비교내신 등급은 대학마다 기준이 달라 계산하지 않습니다.</p>';
    }


    /* --- 학생부 기록 (학생부종합 준비용) --- */
    function tabRecord() {
      var r = s.record = s.record || { hope: "", hopeDept: "", att: {}, cha: {}, seteuk: [], haeng: {} };
      var YRS = ["1", "2", "3"];
      var ta = function (path, val, ph, rows) { return '<textarea data-p="' + path + '" rows="' + (rows || 3) + '" placeholder="' + esc(ph || "") + '">' + esc(val || "") + '</textarea><small class="muted cnt">' + (val || "").length + "자</small>"; };
      $("#tabBody").innerHTML =
        '<div class="card"><h2>학생부 기록</h2><p class="muted small">학생부종합전형 준비용입니다. 학교에서 받은 학생부(또는 나이스 학생부 조회) 내용을 옮겨 두면, 진로와 활동이 잘 이어지는지 스스로 점검할 수 있습니다. ' +
        "2024학년도부터 수상경력·독서활동·개인 봉사활동 실적·자율동아리는 대입에 반영되지 않아 입력 칸에서 뺐습니다.</p>" +
        '<div class="toolbar"><label>희망 진로(직업)<input data-p="hope" value="' + esc(r.hope) + '" placeholder="예: 간호사" /></label>' +
        '<label>희망 학과<input data-p="hopeDept" value="' + esc(r.hopeDept) + '" placeholder="예: 간호학과" /></label></div>' +
        '<div class="kpis" id="recCheck"></div></div>' +

        '<div class="card"><h2>세부능력 및 특기사항 (세특)</h2><p class="muted small">과목별로 선생님이 써 주신 내용을 옮겨 적으세요. 학생부종합에서 가장 중요하게 보는 부분입니다.</p>' +
        '<div id="setList"></div><button class="btn btn-ghost" type="button" id="setAdd">+ 과목 추가</button></div>' +

        '<div class="card"><h2>창의적 체험활동</h2>' + YRS.map(function (y) {
          var c = r.cha[y] = r.cha[y] || {};
          return "<h3>" + y + '학년</h3><div class="rec-grid">' +
            "<label>자율활동" + ta("cha." + y + ".ja", c.ja, "학급·학교 자치 활동, 행사 등") + "</label>" +
            "<label>동아리활동(정규)" + ta("cha." + y + ".dong", c.dong, "동아리명과 활동 내용") + "</label>" +
            "<label>진로활동" + ta("cha." + y + ".jin", c.jin, "진로 탐색 활동, 희망 분야") + "</label></div>";
        }).join("") + "</div>" +

        '<div class="grid-2"><div class="card"><h2>출결</h2><p class="muted small">미인정(무단) 결석·지각·조퇴가 많으면 불리할 수 있습니다. 질병 결석은 대부분 감점이 없습니다.</p>' +
        '<div class="table-wrap"><table class="data-table compact"><thead><tr><th>학년</th><th class="num">질병 결석</th><th class="num">미인정 결석</th><th class="num">미인정 지각</th><th class="num">미인정 조퇴</th><th class="num">미인정 결과</th></tr></thead><tbody>' +
        YRS.map(function (y) {
          var a = r.att[y] = r.att[y] || {};
          var n = function (k) { return '<td class="num"><input type="number" min="0" max="200" inputmode="numeric" data-p="att.' + y + "." + k + '" value="' + esc(a[k] == null ? "" : a[k]) + '" style="width:64px" /></td>'; };
          return "<tr><th>" + y + "학년</th>" + n("sick") + n("abs") + n("late") + n("early") + n("miss") + "</tr>";
        }).join("") + "</tbody></table></div></div>" +
        '<div class="card"><h2>행동특성 및 종합의견</h2>' + YRS.map(function (y) { return "<label>" + y + "학년" + ta("haeng." + y, r.haeng[y], "담임 선생님 종합의견", 3) + "</label>"; }).join("") + "</div></div>";

      function setRows() {
        $("#setList").innerHTML = r.seteuk.length ? r.seteuk.map(function (x, i) {
          return '<div class="set-row" data-i="' + i + '"><div class="toolbar"><label>학년<select data-sk="grade">' + ["1", "2", "3"].map(function (g) { return "<option" + (g === x.grade ? " selected" : "") + ">" + g + "</option>"; }).join("") + "</select></label>" +
            '<label>과목<input data-sk="subj" value="' + esc(x.subj) + '" placeholder="예: 생명과학Ⅰ" /></label><button class="icon-btn" type="button" data-sdel aria-label="삭제">×</button></div>' +
            '<textarea data-sk="text" rows="4" placeholder="세특 내용">' + esc(x.text) + '</textarea><small class="muted cnt">' + (x.text || "").length + "자</small></div>";
        }).join("") : '<p class="empty">‘+ 과목 추가’로 과목별 세특을 입력하세요.</p>';
      }
      function check() {
        var kw = (r.hopeDept + " " + r.hope).replace(/학과|학부|전공|과$/g, " ").split(/[\s,·]+/).filter(function (w) { return w.length >= 2; });
        var hit = kw.length ? r.seteuk.filter(function (x) { return kw.some(function (w) { return (x.text || "").indexOf(w) >= 0 || (x.subj || "").indexOf(w) >= 0; }); }).length : 0;
        var bad = 0; Object.keys(r.att).forEach(function (y) { ["abs", "late", "early", "miss"].forEach(function (k) { bad += num(r.att[y][k]) || 0; }); });
        var chaFilled = 0; Object.keys(r.cha).forEach(function (y) { ["ja", "dong", "jin"].forEach(function (k) { if ((r.cha[y][k] || "").trim()) chaFilled++; }); });
        $("#recCheck").innerHTML = kpi("세특 입력 과목", r.seteuk.length + "개") +
          kpi("희망 분야가 드러난 세특", kw.length ? hit + "개" : "희망 학과 입력 필요") +
          kpi("창체 입력", chaFilled + " / 9칸") + kpi("미인정 결석·지각·조퇴·결과", bad + "회");
      }
      $("#tabBody").addEventListener("input", function (e) {
        var el = e.target, p = el.getAttribute("data-p");
        if (p) {
          var parts = p.split("."), o = r;
          for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
          o[parts[parts.length - 1]] = el.value;
        }
        var sk = el.getAttribute("data-sk");
        if (sk) r.seteuk[+el.closest(".set-row").getAttribute("data-i")][sk] = el.value;
        if (el.tagName === "TEXTAREA" && el.nextElementSibling && el.nextElementSibling.classList.contains("cnt")) el.nextElementSibling.textContent = el.value.length + "자";
        save(s); check();
      });
      $("#tabBody").addEventListener("change", function (e) {
        var sk = e.target.getAttribute("data-sk");
        if (sk && e.target.tagName === "SELECT") { r.seteuk[+e.target.closest(".set-row").getAttribute("data-i")][sk] = e.target.value; save(s); }
      });
      $("#setAdd").addEventListener("click", function () { r.seteuk.push({ grade: "1", subj: "", text: "" }); save(s); setRows(); check(); });
      $("#setList").addEventListener("click", function (e) {
        if (!e.target.hasAttribute("data-sdel")) return;
        if (!confirm("이 과목 세특을 지울까요?")) return;
        r.seteuk.splice(+e.target.closest(".set-row").getAttribute("data-i"), 1); save(s); setRows(); check();
      });
      setRows(); check();
    }

    /* --- 대입 상담 기록 --- */
    var WHO = ["담임 선생님", "진학 담당 선생님", "학원·컨설턴트", "부모", "대학 입학처", "기타"];
    function tabCounsel() {
      var list = s.counsel = s.counsel || [];
      var today = new Date().toISOString().slice(0, 10);
      $("#tabBody").innerHTML =
        '<div class="card"><h2>대입 상담 기록</h2><p class="muted small">상담 날짜·상담자·내용·결정한 것·다음에 할 일을 남겨 두세요. 로그인하면 서버에 저장되고, 연결된 학부모도 함께 볼 수 있습니다.</p>' +
        '<form id="csForm" class="form"><div class="toolbar"><label>날짜<input type="date" name="date" value="' + today + '" required /></label>' +
        '<label>상담자<select name="who">' + WHO.map(function (w) { return "<option>" + w + "</option>"; }).join("") + "</select></label>" +
        '<label>주제<input name="topic" placeholder="예: 수시 6장 조합" /></label><label>다음 상담일<input type="date" name="next" /></label></div>' +
        '<label>상담 내용<textarea name="content" rows="4" placeholder="들은 조언, 논의한 대학·학과, 성적 이야기 등"></textarea></label>' +
        '<label>결정한 것 · 해야 할 일<textarea name="todo" rows="2" placeholder="예: 6월 모평 뒤 논술 2곳 추가 검토"></textarea></label>' +
        '<button class="btn btn-primary" type="submit">기록 추가</button></form></div>' +
        '<div id="csList"></div>';
      function paint() {
        var upcoming = list.filter(function (c) { return c.next && c.next >= today; }).sort(function (a, b) { return a.next < b.next ? -1 : 1; })[0];
        $("#csList").innerHTML = (upcoming ? '<div class="callout">다음 상담: <b>' + esc(upcoming.next) + "</b> (" + esc(upcoming.who) + (upcoming.topic ? " · " + esc(upcoming.topic) : "") + ")</div>" : "") +
          (list.length ? list.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (c) {
            return '<article class="card counsel" data-id="' + esc(c.id) + '"><div class="counsel-head"><b>' + esc(c.date) + "</b> · " + esc(c.who) + (c.topic ? " · " + esc(c.topic) : "") +
              ' <button class="icon-btn" type="button" data-cdel aria-label="삭제">×</button></div>' +
              (c.content ? "<p>" + esc(c.content).replace(/\n/g, "<br>") + "</p>" : "") +
              (c.todo ? '<p class="todo"><b>할 일</b> ' + esc(c.todo).replace(/\n/g, "<br>") + "</p>" : "") +
              (c.next ? '<p class="muted small">다음 상담 ' + esc(c.next) + "</p>" : "") + "</article>";
          }).join("") : '<p class="empty">아직 상담 기록이 없습니다.</p>');
      }
      $("#csForm").addEventListener("submit", function (e) {
        e.preventDefault();
        var f = this;
        list.push({ id: newId(), date: f.date.value, who: f.who.value, topic: f.topic.value.trim(), content: f.content.value.trim(), todo: f.todo.value.trim(), next: f.next.value });
        save(s); f.reset(); f.date.value = today; paint();
      });
      $("#csList").addEventListener("click", function (e) {
        if (!e.target.hasAttribute("data-cdel")) return;
        if (!confirm("이 상담 기록을 지울까요?")) return;
        var id = e.target.closest("[data-id]").getAttribute("data-id");
        s.counsel = list = list.filter(function (c) { return c.id !== id; }); save(s); paint();
      });
      paint();
    }

    head(); renderTab();
  }

  /* ---------- 가이드 ---------- */
  function pageGuide(q) {
    var G = window.GUIDE;
    if (!G) { view.innerHTML = '<section class="section"><p>가이드를 불러오지 못했습니다.</p></section>'; return; }
    var cur = (q && q.get("s")) || G.sections[0].id;
    view.innerHTML =
      '<section class="section"><div class="section-head"><h1>입시 가이드</h1><p>교육부·대교협 공식 발표를 기준으로 정리했습니다(' + esc(G.updated) + ' 기준). 세부 사항은 대학·학년도마다 다르니 지원 전 반드시 모집요강을 확인하세요.</p></div>' +
      '<div class="guide-layout"><nav class="guide-nav" aria-label="가이드 목차">' +
      G.sections.map(function (x) { return '<a href="#/guide?s=' + x.id + '"' + (x.id === cur ? ' class="is-active"' : "") + ">" + esc(x.title) + "</a>"; }).join("") + "</nav>" +
      '<div class="guide-body">' + G.sections.filter(function (x) { return x.id === cur; }).map(function (x) {
        return "<h2>" + esc(x.title) + '</h2><p class="lead-sm">' + esc(x.lead) + "</p>" + x.html;
      }).join("") +
      '<h3 class="sub-head">공식 정보 바로가기</h3><ul class="link-list">' +
      link("https://www.adiga.kr", "대학어디가 (한국대학교육협의회)", "대학별 입결·모집요강·추가모집 공식 포털") +
      link("https://www.academyinfo.go.kr", "대학알리미 (교육부)", "대학 재정·취업률·충원율 공시 원자료") +
      link("https://www.procollege.kr", "전문대학포털", "전문대학 입시정보") +
      link("https://www.suneung.re.kr", "한국교육과정평가원 수능", "수능·모의평가 일정과 정답") +
      link("https://www.kcue.or.kr", "한국대학교육협의회", "대입전형 기본사항·시행계획") +
      "</ul></div></div></section>";
  }
  function link(href, t, d) { return '<li><a href="' + href + '" target="_blank" rel="noopener">' + t + "</a><span>" + d + "</span></li>"; }

  /* ---------- 데이터 출처 ---------- */
  function pageData() {
    var m = IDX.meta;
    view.innerHTML =
      '<section class="section"><div class="section-head"><h1>데이터 출처와 원칙</h1><p>입시나침반은 정부·공공기관이 공개한 원자료만 사용하고, 출처와 갱신일을 모든 화면에 표시합니다.</p></div>' +
      '<div class="card"><h2>사용 데이터</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>데이터</th><th>이용허락</th><th>원출처</th></tr></thead><tbody>' +
      m.sources.map(function (s) {
        return "<tr><td><b>" + esc(s.name) + "</b>" + (s.file ? '<br><span class="muted small">' + esc(s.file) + "</span>" : "") + "</td><td>" + esc(s.license) +
          '</td><td><a href="' + esc(s.url) + '" target="_blank" rel="noopener">공공데이터포털</a></td></tr>';
      }).join("") + "</tbody></table></div>" +
      '<p class="muted small">데이터 빌드일: ' + esc(m.built) + " · 4년제 " + m.univYears[0] + "~" + m.univYears[1] + "학년도 · 전문대학 " + m.collegeYear + "학년도" +
      (m.linksChecked ? " · 원문 링크 접속 확인 완료(열리지 않는 링크 제외)" : "") + "</p></div>" +
      '<div class="card"><h2>운영 원칙</h2><ul class="plain">' +
      "<li>공시 원자료의 숫자를 바꾸거나 보정하지 않습니다. 비율(경쟁률·충원율)은 공시 정의대로 계산합니다.</li>" +
      "<li>근거 없는 ‘예상 합격선’, ‘합격 확률’은 제공하지 않습니다. 합격선은 대학이 발표한 원문으로 연결합니다.</li>" +
      "<li>일부 대학은 모집단위와 입학자 공시 단위가 달라 입학자가 0으로 공시됩니다. 이런 경우 충원율을 ‘-’로 표시합니다.</li>" +
      "<li>원문 자료의 학년도는 PDF 표지를 확인해 바로잡았습니다(입시결과는 다음 해 봄에 발표).</li>" +
      "<li>4년제 데이터에는 교육대학·산업대학·사이버대학 등 대학알리미 ‘대학’ 공시 대상이 포함됩니다.</li></ul></div>" +
      '<div class="card"><h2>오류 신고</h2><p>수치가 원자료와 다르면 해당 화면 주소와 함께 알려주세요. 원자료와 대조해 즉시 수정합니다.</p></div></section>';
  }

  /* ---------- 대학 발표 입결 (원문 PDF 표 추출) ---------- */
  var IPSI = null;
  function ipsiTable(t, url, open) {
    var head = t.head.map(function (row) {
      return "<tr>" + row.map(function (c) {
        return '<th colspan="' + c[2] + '" rowspan="' + c[3] + '">' + esc(c[0]) + "</th>";
      }).join("") + "</tr>";
    }).join("");
    var body = t.rows.map(function (r) {
      return '<tr data-s="' + esc(r.join(" ")) + '">' + r.map(function (v, j) {
        return j === 0 ? "<td><b>" + esc(v) + "</b></td>" : '<td class="num">' + esc(v) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    return '<details class="ipsi-t rtable"' + (open ? " open" : "") + '><summary class="ipsi-cap"><span>' + esc(t.title || "표") + '</span> <a href="' + esc(url) + "#page=" + t.page +
      '" target="_blank" rel="noopener" class="small">원문 ' + t.page + "쪽 ↗</a></summary>" +
      '<div class="table-wrap"><table class="data-table compact ipsi-table"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div></details>";
  }
  function loadIpsi(d) {
    var box = $("#ipsiBox");
    if (!box) return;
    (IPSI ? Promise.resolve(IPSI) : getJSON("data/ipsi_index.json").catch(function () { return { tables: {} }; })).then(function (ix) {
      IPSI = ix;
      if (!ix.tables || !ix.tables[d.code]) return null;
      return getJSON("data/ipsi/" + d.code + ".json");
    }).then(function (docs) {
      if (!docs) return;
      docs = docs.filter(function (x) { return x.tables.length; });
      var tabs = docs.map(function (x, i) {
        return '<button type="button" class="seg-btn' + (i ? "" : " is-active") + '" data-i="' + i + '">' + x.year + "학년도 " + esc(x.season) + (x.campus && docs.some(function (y) { return y.campus !== x.campus; }) ? " · " + esc(x.campus) : "") + "</button>";
      }).join("");
      box.innerHTML = '<div class="card ipsi-card"><h2>대학 발표 입시결과 <span class="tag tag-c">원문 그대로</span></h2>' +
        '<p class="muted small">대학이 발표한 입시결과 PDF의 표를 글자 그대로 옮겼습니다(계산·보정 없음). 모든 칸은 원문 텍스트와 자동 대조를 통과한 표만 싣고, 표마다 원문 쪽 링크를 달았습니다. ' +
        "성적 기준(최초합/최종등록, 50%·70% 컷, 평균 등)은 대학마다 다르니 표 머리글을 꼭 확인하세요.</p>" +
        '<div class="seg ipsi-tabs">' + tabs + "</div>" +
        '<div class="toolbar"><label>모집단위·전형 검색<input type="search" id="ipsiQ" placeholder="예: 간호, 논술, 교과" /></label></div>' +
        '<div id="ipsiBody"></div><p class="source">출처: 각 대학 발표 입시결과 원문 (경상남도교육청 경남대입정보센터 수집본)</p></div>';
      var cur = 0;
      function render() {
        var x = docs[cur], q = $("#ipsiQ").value.trim();
        var html = '<p class="small"><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + x.year + "학년도 " + esc(x.season) + " 입시결과 원문 PDF 전체 보기 ↗</a></p>" +
          x.tables.map(function (t, i) { return ipsiTable(t, x.url, !q && i < 2); }).join("");
        $("#ipsiBody").innerHTML = html;
        if (q) {
          $all("#ipsiBody .ipsi-t").forEach(function (el) {
            var titleHit = el.querySelector(".ipsi-cap span").textContent.indexOf(q) >= 0;
            var any = false;
            $all("tbody tr", el).forEach(function (tr) {
              var hit = titleHit || tr.getAttribute("data-s").indexOf(q) >= 0;
              tr.hidden = !hit; any = any || hit;
            });
            el.hidden = !any;
            el.open = any;
          });
        }
      }
      $all(".ipsi-tabs .seg-btn", box).forEach(function (b) {
        b.addEventListener("click", function () {
          cur = +b.getAttribute("data-i");
          $all(".ipsi-tabs .seg-btn", box).forEach(function (y) { y.classList.toggle("is-active", y === b); });
          render();
        });
      });
      $("#ipsiQ").addEventListener("input", render);
      render();
    }).catch(function () { /* 입결 없음 */ });
  }

  /* =========================================================
   * 회원 (로그인·동기화·관심 대학·결과 제보·학부모 연결)
   * 서버: /api (admission/api/app.py). 서버가 없거나 꺼져 있어도 나머지 기능은 그대로 동작한다.
   * ========================================================= */
  var ME = null;           // 로그인한 회원 (null = 비로그인)
  var PROV = {};           // 사용 가능한 간편 로그인
  var syncTimer = null, syncState = "";
  function api(method, path, body) {
    var o = { method: method, credentials: "same-origin", headers: { "x-ipsi": "1" } };
    if (body !== undefined) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(body); }
    return fetch("/api" + path, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ("오류 " + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function canSync() { return ME && !ME.needConsent; }
  function scheduleSync() {
    if (!canSync()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushData, 1200);
  }
  function pushData() {
    if (!canSync()) return Promise.resolve();
    syncState = "저장 중…"; showSync();
    return api("PUT", "/data", load()).then(function () { syncState = "서버에 저장됨"; showSync(); })
      .catch(function (e) { syncState = "서버 저장 실패: " + e.message; showSync(); });
  }
  function showSync() { var el = $("#syncNote"); if (el) el.textContent = syncState; }
  function hasContent(s) { return !!(s && ((s.exams && s.exams.length) || (s.gpa && s.gpa.rows && s.gpa.rows.length) || (s.fav && s.fav.length) || (s.counsel && s.counsel.length) || (s.record && s.record.seteuk && s.record.seteuk.length))); }
  // 로그인 직후: 서버 자료와 이 기기 자료를 맞춘다
  function pullData() {
    if (!canSync()) return Promise.resolve();
    return api("GET", "/data").then(function (r) {
      var local = load();
      if (!r.data) { if (hasContent(local)) return pushData(); return; }
      if (!hasContent(local) || JSON.stringify(local) === JSON.stringify(r.data)) { save(r.data, true); return; }
      ME.conflict = r.data;   // 둘 다 있고 다르면 내 계정 화면에서 고르게 한다
    }).catch(function () { /* 무시 */ });
  }
  function refreshMe() {
    return api("GET", "/me").then(function (u) { ME = u; }).catch(function () { ME = null; }).then(navAccount);
  }
  function navAccount() {
    var a = $("#navAccount");
    if (!a) return;
    a.textContent = ME ? (ME.role === "parent" ? "우리 아이" : "내 대시보드") : "로그인";
    a.setAttribute("href", ME ? "#/my" : "#/login");
    a.setAttribute("data-nav", ME ? "my" : "account");
    var g = $("#navAdmin");
    if (ME && ME.isStaff && !g) {
      g = document.createElement("a"); g.id = "navAdmin"; g.href = "#/admin"; g.setAttribute("data-nav", "admin"); g.textContent = "관리";
      a.parentNode.insertBefore(g, a);
    } else if (g && !(ME && ME.isStaff)) g.remove();
  }
  function needLogin(next) {
    view.innerHTML = '<section class="section"><div class="card narrow"><h1>로그인이 필요합니다</h1><p class="muted">이 기능은 회원만 쓸 수 있습니다.</p>' +
      '<a class="btn btn-primary" href="#/login?next=' + encodeURIComponent(next || "") + '">로그인</a> <a class="btn btn-ghost" href="#/signup">회원가입</a></div></section>';
  }

  /* --- 약관 동의 양식 (일반 가입·간편 로그인 공통) --- */
  function consentFields(u) {
    u = u || {};
    return '<label>이름(별명)<input name="name" maxlength="30" value="' + esc(u.name || "") + '" autocomplete="nickname" /></label>' +
      '<fieldset class="roles"><legend>회원 구분</legend>' +
      '<label class="check"><input type="radio" name="role" value="student"' + (u.role !== "parent" ? " checked" : "") + " /> 학생(수험생)</label>" +
      '<label class="check"><input type="radio" name="role" value="parent"' + (u.role === "parent" ? " checked" : "") + " /> 학부모</label></fieldset>" +
      '<div class="consents">' +
      '<label class="check"><input type="checkbox" name="agreeTerms" /> (필수) <a href="#/terms" target="_blank">이용약관</a>에 동의합니다</label>' +
      '<label class="check"><input type="checkbox" name="agreePrivacy" /> (필수) <a href="#/privacy" target="_blank">개인정보 수집·이용</a>에 동의합니다</label>' +
      '<label class="check"><input type="checkbox" name="age14" /> (필수) 만 14세 이상입니다</label>' +
      '<label class="check"><input type="checkbox" name="reportConsent" /> (선택) 내가 제보한 합격·불합격 결과를 개인을 알 수 없게 통계로 만들어 합격 예측에 쓰는 데 동의합니다</label></div>';
  }
  function consentValues(f) {
    return { name: f.name.value.trim(), role: f.role.value, agreeTerms: f.agreeTerms.checked, agreePrivacy: f.agreePrivacy.checked,
      age14: f.age14.checked, reportConsent: f.reportConsent.checked };
  }

  function pageLogin(q) {
    var next = q.get("next") || "my";
    var msg = q.get("error");
    view.innerHTML = '<section class="section"><div class="card narrow"><h1>로그인</h1>' +
      (msg ? '<p class="form-error">' + esc(msg) + "</p>" : "") +
      '<div id="socialBox"></div>' +
      '<form id="loginForm" class="form"><label>이메일<input name="email" type="email" required autocomplete="username" /></label>' +
      '<label>비밀번호<input name="password" type="password" required autocomplete="current-password" /></label>' +
      '<p class="form-error" id="lErr"></p><button class="btn btn-primary" type="submit">로그인</button></form>' +
      '<p class="muted small">아직 회원이 아니신가요? <a href="#/signup">회원가입</a></p></div></section>';
    socialButtons($("#socialBox"));
    $("#loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = this;
      api("POST", "/auth/login", { email: f.email.value, password: f.password.value }).then(function (u) {
        ME = u; navAccount(); return pullData();
      }).then(function () { location.hash = "#/" + next; }).catch(function (er) { $("#lErr").textContent = er.message; });
    });
  }
  function socialButtons(box) {
    var html = "";
    if (PROV.kakao) html += '<a class="btn btn-kakao" href="/api/auth/kakao/start">카카오로 시작하기</a>';
    if (PROV.naver) html += '<a class="btn btn-naver" href="/api/auth/naver/start">네이버로 시작하기</a>';
    box.innerHTML = html ? '<div class="social">' + html + '</div><p class="divider"><span>또는 이메일로</span></p>' : "";
  }
  function pageSignup() {
    view.innerHTML = '<section class="section"><div class="card narrow"><h1>회원가입</h1><div id="socialBox"></div>' +
      '<form id="suForm" class="form"><label>이메일<input name="email" type="email" required autocomplete="username" /></label>' +
      '<label>비밀번호 (8자 이상, 영문+숫자)<input name="password" type="password" required minlength="8" autocomplete="new-password" /></label>' +
      '<label>비밀번호 확인<input name="password2" type="password" required autocomplete="new-password" /></label>' +
      consentFields() + '<p class="form-error" id="sErr"></p><button class="btn btn-primary" type="submit">가입하기</button></form>' +
      '<p class="muted small">이미 회원이신가요? <a href="#/login">로그인</a></p></div></section>';
    socialButtons($("#socialBox"));
    $("#suForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = this;
      if (f.password.value !== f.password2.value) { $("#sErr").textContent = "비밀번호가 서로 다릅니다."; return; }
      var b = consentValues(f); b.email = f.email.value; b.password = f.password.value;
      api("POST", "/auth/signup", b).then(function (u) { ME = u; navAccount(); return pullData(); })
        .then(function () { location.hash = "#/my"; }).catch(function (er) { $("#sErr").textContent = er.message; });
    });
  }

  /* --- 내 계정 --- */
  function pageAccount() {
    return refreshMe().then(function () {
      if (!ME) return needLogin("account");
      if (ME.needConsent) return pageConsent();
      var s = load();
      var fav = s.fav || [];
      view.innerHTML = '<section class="section"><div class="section-head"><h1>내 계정</h1><p>' + esc(ME.name || "") + " · " +
        (ME.role === "parent" ? "학부모" : "학생") + (ME.email ? " · " + esc(ME.email) : "") +
        (ME.providers.length ? " · " + ME.providers.map(function (p) { return p === "kakao" ? "카카오" : "네이버"; }).join("·") + " 로그인" : "") +
        ' <span class="muted small" id="syncNote">' + esc(syncState) + "</span></p></div>" +
        (ME.conflict ? '<div class="callout"><b>이 기기와 서버에 서로 다른 성적이 저장되어 있습니다.</b> 어느 쪽을 쓸지 고르세요. 고르지 않은 쪽은 덮어씁니다.<div class="toolbar-actions" style="margin:10px 0 0">' +
          '<button class="btn btn-primary" id="useServer">서버에 저장된 성적 쓰기</button><button class="btn btn-ghost" id="useLocal">이 기기의 성적을 서버에 올리기</button></div></div>' : "") +
        '<div class="grid-2">' +
        '<div class="card"><h2>관심 대학</h2>' + (fav.length ? '<ul class="plain">' + fav.map(function (f, i) {
          return '<li><a href="#/univ/' + esc(f.code) + '">' + esc(f.name) + '</a> <button class="icon-btn" data-unfav="' + i + '" aria-label="삭제">×</button></li>';
        }).join("") + "</ul>" : '<p class="muted">대학 상세 페이지에서 ‘☆ 관심 대학’을 누르면 여기에 모입니다.</p>') + "</div>" +
        '<div class="card"><h2>' + (ME.role === "parent" ? "자녀 계정 연결" : "학부모와 연결") + '</h2><div id="linkBox">불러오는 중…</div></div></div>' +
        (ME.role === "student" ? '<div class="card"><h2>합격·불합격 결과 제보</h2><div id="repBox"></div></div>' : "") +
        '<div class="card"><h2>계정 설정</h2><form id="setForm" class="form inline-form">' +
        '<label>이름(별명)<input name="name" maxlength="30" value="' + esc(ME.name || "") + '" /></label>' +
        '<label>회원 구분<select name="role"><option value="student"' + (ME.role !== "parent" ? " selected" : "") + '>학생</option><option value="parent"' + (ME.role === "parent" ? " selected" : "") + ">학부모</option></select></label>" +
        '<label class="check"><input type="checkbox" name="reportConsent"' + (ME.reportConsent ? " checked" : "") + " /> 결과 제보를 익명 통계에 활용하는 데 동의</label>" +
        '<button class="btn btn-ghost" type="submit">저장</button></form>' +
        (ME.email && !ME.providers.length ? '<form id="pwForm" class="form inline-form"><label>현재 비밀번호<input name="password" type="password" autocomplete="current-password" /></label>' +
          '<label>새 비밀번호<input name="newPassword" type="password" autocomplete="new-password" /></label><button class="btn btn-ghost" type="submit">비밀번호 변경</button></form>' : "") +
        '<p class="form-error" id="setErr"></p>' +
        '<div class="toolbar-actions"><button class="btn btn-ghost" id="logout">로그아웃</button><button class="btn btn-ghost danger" id="quit">회원 탈퇴</button></div></div></section>';

      if (ME.conflict) {
        $("#useServer").addEventListener("click", function () { save(ME.conflict, true); ME.conflict = null; pageAccount(); });
        $("#useLocal").addEventListener("click", function () { ME.conflict = null; pushData().then(pageAccount); });
      }
      $all("[data-unfav]").forEach(function (b) {
        b.addEventListener("click", function () { var t = load(); t.fav.splice(+b.getAttribute("data-unfav"), 1); save(t); pageAccount(); });
      });
      $("#setForm").addEventListener("submit", function (e) {
        e.preventDefault();
        api("PUT", "/me", { name: this.name.value, role: this.role.value, reportConsent: this.reportConsent.checked })
          .then(function (u) { ME = u; navAccount(); pageAccount(); }).catch(function (er) { $("#setErr").textContent = er.message; });
      });
      if ($("#pwForm")) $("#pwForm").addEventListener("submit", function (e) {
        e.preventDefault();
        var f = this;
        api("PUT", "/me", { password: f.password.value, newPassword: f.newPassword.value })
          .then(function () { f.reset(); $("#setErr").textContent = "비밀번호를 바꿨습니다."; }).catch(function (er) { $("#setErr").textContent = er.message; });
      });
      $("#logout").addEventListener("click", function () {
        api("POST", "/auth/logout").then(function () { ME = null; navAccount(); location.hash = "#/"; });
      });
      $("#quit").addEventListener("click", function () {
        if (!confirm("탈퇴하면 서버에 저장된 성적·관심 대학·제보 결과·연결 정보가 모두 즉시 삭제되고 되돌릴 수 없습니다. 탈퇴할까요?")) return;
        api("DELETE", "/me").then(function () { ME = null; navAccount(); alert("탈퇴했습니다. 이 기기 브라우저에 남은 성적은 ‘내 성적’ 화면에서 지울 수 있습니다."); location.hash = "#/"; })
          .catch(function (er) { $("#setErr").textContent = er.message; });
      });
      linkBox();
      if (ME.role === "student") repBox();
    });
  }
  function pageConsent() {
    view.innerHTML = '<section class="section"><div class="card narrow"><h1>가입 마무리</h1><p class="muted">간편 로그인으로 처음 오셨습니다. 아래 내용을 확인해 주세요.</p>' +
      '<form id="cForm" class="form">' + consentFields(ME) + '<p class="form-error" id="cErr"></p><button class="btn btn-primary" type="submit">시작하기</button></form>' +
      '<p class="muted small">동의하지 않으려면 <a href="#" id="cCancel">가입 취소(계정 삭제)</a></p></div></section>';
    $("#cForm").addEventListener("submit", function (e) {
      e.preventDefault();
      api("POST", "/me/consent", consentValues(this)).then(function (u) { ME = u; navAccount(); return pullData(); })
        .then(pageAccount).catch(function (er) { $("#cErr").textContent = er.message; });
    });
    $("#cCancel").addEventListener("click", function (e) {
      e.preventDefault();
      api("DELETE", "/me").then(function () { ME = null; navAccount(); location.hash = "#/"; });
    });
  }

  function linkBox() {
    var box = $("#linkBox");
    api("GET", "/link").then(function (list) {
      var rows = list.length ? '<ul class="plain">' + list.map(function (l) {
        return "<li>" + (ME.role === "parent" ? '<a href="#/child/' + l.uid + '">' + esc(l.name || l.email || "자녀") + "</a>" : esc(l.name || l.email || "학부모")) +
          ' <button class="icon-btn" data-unlink="' + l.id + '" aria-label="연결 해제">×</button></li>';
      }).join("") + "</ul>" : '<p class="muted">연결된 계정이 없습니다.</p>';
      if (ME.role === "parent") {
        box.innerHTML = rows + '<form id="acceptForm" class="form inline-form"><label>자녀가 알려준 연결 코드<input name="code" maxlength="6" placeholder="6자리" /></label>' +
          '<button class="btn btn-ghost" type="submit">연결</button></form><p class="form-error" id="lkErr"></p>' +
          '<p class="muted small">자녀가 자기 계정의 ‘학부모와 연결’에서 코드를 만들어 알려 주면, 자녀의 성적·관심 대학·결과를 읽기 전용으로 볼 수 있습니다.</p>';
        $("#acceptForm").addEventListener("submit", function (e) {
          e.preventDefault();
          api("POST", "/link/accept", { code: this.code.value }).then(linkBox).catch(function (er) { $("#lkErr").textContent = er.message; });
        });
      } else {
        box.innerHTML = rows + '<button class="btn btn-ghost" id="mkCode">연결 코드 만들기</button> <strong id="codeOut" class="code"></strong>' +
          '<p class="muted small">코드를 학부모에게 알려 주세요(24시간 유효). 연결된 학부모는 내 성적·관심 대학·제보 결과를 볼 수만 있고 고칠 수는 없습니다. ×로 언제든 연결을 끊을 수 있습니다.</p>';
        $("#mkCode").addEventListener("click", function () { api("POST", "/link/code").then(function (r) { $("#codeOut").textContent = r.code; }); });
      }
      $all("[data-unlink]").forEach(function (b) {
        b.addEventListener("click", function () { if (confirm("연결을 끊을까요?")) api("DELETE", "/link/" + b.getAttribute("data-unlink")).then(linkBox); });
      });
    }).catch(function (e) { box.textContent = e.message; });
  }

  var TRACKS = ["수시 교과", "수시 종합", "수시 논술", "수시 실기", "수시 기타", "정시 가군", "정시 나군", "정시 다군"];
  var RESULTS = ["최초합격", "추가합격", "예비번호 대기", "불합격", "1단계 합격", "1단계 불합격", "등록 포기"];
  function repBox() {
    var box = $("#repBox");
    if (!ME.reportConsent) {
      box.innerHTML = '<p class="muted">결과 제보는 ‘계정 설정’에서 익명 통계 활용에 동의한 뒤 쓸 수 있습니다. 제보된 결과는 이름·이메일 없이 합격 예측 통계에만 쓰입니다.</p>';
      return;
    }
    api("GET", "/reports").then(function (list) {
      var y = new Date().getFullYear() + 1;
      box.innerHTML = '<p class="muted small">수시·정시 결과가 나오면 입력해 주세요. 이름·이메일 없이 합격 예측 통계에만 쓰이며, 언제든 지울 수 있습니다.</p>' +
        '<form id="repForm" class="form inline-form">' +
        '<label>학년도<input name="year" type="number" min="2015" max="2040" value="' + y + '" /></label>' +
        '<label>전형 구분<select name="track">' + TRACKS.map(function (t) { return "<option>" + t + "</option>"; }).join("") + "</select></label>" +
        '<label>대학<input name="univName" list="univList" required placeholder="대학명" /></label>' +
        '<datalist id="univList">' + IDX.univ.map(function (u) { return '<option value="' + esc(u.name) + '">'; }).join("") + "</datalist>" +
        '<label>학과(모집단위)<input name="dept" required /></label>' +
        '<label>전형명<input name="jeonhyeong" placeholder="예: 학생부교과(지역균형)" /></label>' +
        '<label>결과<select name="result">' + RESULTS.map(function (t) { return "<option>" + t + "</option>"; }).join("") + "</select></label>" +
        '<label class="check"><input type="checkbox" name="snap" checked /> 지금 저장된 내 성적(내신·모의고사·수능)을 함께 보냄</label>' +
        '<button class="btn btn-primary" type="submit">결과 등록</button></form><p class="form-error" id="rErr"></p>' +
        (list.length ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>학년도</th><th>전형</th><th>대학</th><th>학과</th><th>전형명</th><th>결과</th><th></th></tr></thead><tbody>' +
          list.map(function (r) {
            return "<tr><td>" + r.year + "</td><td>" + esc(r.track) + "</td><td>" + esc(r.univ_name) + "</td><td>" + esc(r.dept) + "</td><td>" + esc(r.jeonhyeong) +
              "</td><td><b>" + esc(r.result) + '</b></td><td><button class="icon-btn" data-rdel="' + r.id + '" aria-label="삭제">×</button></td></tr>';
          }).join("") + "</tbody></table></div>" : "");
      $("#repForm").addEventListener("submit", function (e) {
        e.preventDefault();
        var f = this, name = f.univName.value.trim();
        var u = IDX.univ.filter(function (x) { return x.name === name; })[0];
        var st = load();
        api("POST", "/reports", { year: +f.year.value, track: f.track.value, univName: name, univCode: u ? u.code : "", dept: f.dept.value,
          jeonhyeong: f.jeonhyeong.value, result: f.result.value,
          snapshot: f.snap.checked ? { gpa: st.gpa, exams: st.exams, ged: st.ged, who: st.who } : null })
          .then(repBox).catch(function (er) { $("#rErr").textContent = er.message; });
      });
      $all("[data-rdel]").forEach(function (b) {
        b.addEventListener("click", function () { if (confirm("이 결과를 지울까요?")) api("DELETE", "/reports/" + b.getAttribute("data-rdel")).then(repBox); });
      });
    }).catch(function (e) { box.textContent = e.message; });
  }

  /* --- 학부모: 자녀 성적 보기 (읽기 전용) --- */
  function pageChild(id) {
    return refreshMe().then(function () {
      if (!ME) return needLogin("child/" + id);
      return api("GET", "/children/" + encodeURIComponent(id)).then(function (c) {
        var d = c.data || {}, ex = d.exams || [], fav = d.fav || [];
        var cols = [["kor", "국어"], ["math", "수학"], ["eng", "영어"], ["t1", "탐구1"], ["t2", "탐구2"], ["his", "한국사"]];
        var gp = (d.gpa && d.gpa.rows) || [], sum = 0, un = 0, mx = d.gpa && d.gpa.system === "5" ? 5 : 9;
        gp.forEach(function (r) { var g = num(r.grade), w = num(r.unit); if (g >= 1 && g <= mx && w > 0) { sum += g * w; un += w; } });
        view.innerHTML = '<section class="section"><p class="crumb"><a href="#/account">내 계정</a> ›</p><div class="section-head"><h1>' + esc(c.name || c.email || "자녀") + "의 성적</h1>" +
          '<p class="muted">읽기 전용 · 마지막 저장 ' + (c.updated ? new Date(c.updated * 1000).toLocaleString("ko-KR") : "없음") + "</p></div>" +
          '<div class="card"><h2>모의고사·수능 등급</h2>' + (ex.length ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>시험</th>' +
            cols.map(function (x) { return '<th class="num">' + x[1] + "</th>"; }).join("") + "</tr></thead><tbody>" +
            ex.map(function (e) { return "<tr><td>" + esc((e.year ? e.year + "학년도 " : "") + e.kind) + "</td>" + cols.map(function (x) { return '<td class="num">' + (gradeOf(e, x[0]) || "-") + "</td>"; }).join("") + "</tr>"; }).join("") +
            "</tbody></table></div>" : '<p class="muted">입력된 시험 성적이 없습니다.</p>') + "</div>" +
          '<div class="grid-2"><div class="card"><h2>내신 평균등급</h2><p class="kpi-big">' + (un ? (sum / un).toFixed(2) + "등급" : "-") + '</p><p class="muted small">전과목, ' + un + "단위 · " + mx + "등급제</p></div>" +
          '<div class="card"><h2>관심 대학</h2>' + (fav.length ? '<ul class="plain">' + fav.map(function (f) { return '<li><a href="#/univ/' + esc(f.code) + '">' + esc(f.name) + "</a></li>"; }).join("") + "</ul>" : '<p class="muted">없음</p>') + "</div></div>" +
          childRecord(d) +
          '<div class="card"><h2>합격·불합격 결과</h2>' + (c.reports.length ? '<ul class="plain">' + c.reports.map(function (r) {
            return "<li>" + r.year + " " + esc(r.track) + " · " + esc(r.univ_name) + " " + esc(r.dept) + " — <b>" + esc(r.result) + "</b></li>";
          }).join("") + "</ul>" : '<p class="muted">없음</p>') + "</div></section>";
      }).catch(function (e) { view.innerHTML = '<section class="section"><p>' + esc(e.message) + "</p></section>"; });
    });
  }

  function childRecord(d) {
    var r = d.record || {}, cs = (d.counsel || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return '<div class="grid-2"><div class="card"><h2>학생부 기록</h2>' +
      (r.hope || r.hopeDept ? "<p>희망: <b>" + esc([r.hope, r.hopeDept].filter(Boolean).join(" · ")) + "</b></p>" : "") +
      "<p>세특 " + ((r.seteuk || []).length) + "과목 입력</p>" +
      ((r.seteuk || []).length ? '<ul class="plain small">' + r.seteuk.map(function (x) { return "<li><b>" + esc(x.grade) + "학년 " + esc(x.subj) + "</b> " + esc((x.text || "").slice(0, 80)) + ((x.text || "").length > 80 ? "…" : "") + "</li>"; }).join("") + "</ul>" : "") +
      '</div><div class="card"><h2>상담 기록</h2>' + (cs.length ? cs.map(function (c) {
        return '<div class="counsel"><b>' + esc(c.date) + "</b> · " + esc(c.who) + (c.topic ? " · " + esc(c.topic) : "") + (c.content ? "<p>" + esc(c.content).replace(/\n/g, "<br>") + "</p>" : "") + (c.todo ? '<p class="todo"><b>할 일</b> ' + esc(c.todo) + "</p>" : "") + "</div>";
      }).join("") : '<p class="muted">없음</p>') + "</div></div>";
  }

  /* --- 관심 대학 버튼 (대학 상세) --- */
  function favButton(d) {
    var head = $(".detail-head h1");
    if (!head) return;
    var b = document.createElement("button");
    b.type = "button"; b.className = "btn btn-ghost fav-btn";
    function paint() { var on = (load().fav || []).some(function (f) { return f.code === d.code; }); b.textContent = on ? "★ 관심 대학" : "☆ 관심 대학"; b.setAttribute("aria-pressed", String(on)); }
    b.addEventListener("click", function () {
      var s = load(); s.fav = s.fav || [];
      var i = s.fav.map(function (f) { return f.code; }).indexOf(d.code);
      if (i >= 0) s.fav.splice(i, 1); else s.fav.push({ code: d.code, name: d.name + (d.campus && d.campus !== "본교" ? " (" + d.campus + ")" : "") });
      save(s); paint();
      if (!ME) { syncState = ""; }
    });
    paint();
    head.parentNode.appendChild(b);
  }

  /* --- 약관·개인정보처리방침 (운영자 정보는 반드시 실제 내용으로 바꿔야 함) --- */
  var OPERATOR = "[운영자(회사)명 입력 필요]", OFFICER = "[개인정보 보호책임자 성명·연락처 입력 필요]";
  function pageTerms() {
    view.innerHTML = '<section class="section"><div class="card narrow doc"><h1>이용약관</h1>' +
      "<p>시행일: [시행일 입력 필요]</p>" +
      "<h2>제1조 (목적)</h2><p>이 약관은 " + OPERATOR + "(이하 ‘운영자’)가 제공하는 입시나침반(ipsi.isjung.com, 이하 ‘서비스’) 이용 조건과 절차를 정합니다.</p>" +
      "<h2>제2조 (서비스 내용)</h2><p>서비스는 공공기관·대학이 공개한 입시 자료 조회, 회원의 성적 기록·정리, 수능 최저 충족 계산, 관심 대학 저장, 결과 제보, 학부모-자녀 계정 연결 기능을 제공합니다.</p>" +
      "<h2>제3조 (정보의 성격)</h2><p>서비스가 보여 주는 수치는 원출처 자료를 옮긴 것이며, 계산 결과와 예측은 참고용입니다. 지원 결정 전에는 반드시 해당 대학의 최신 모집요강을 확인해야 하며, 운영자는 서비스 정보만으로 내린 지원 결정의 결과에 책임을 지지 않습니다.</p>" +
      "<h2>제4조 (회원가입과 탈퇴)</h2><p>만 14세 이상인 사람만 가입할 수 있습니다. 회원은 ‘내 계정’에서 언제든 탈퇴할 수 있으며, 탈퇴하면 회원의 모든 정보가 즉시 삭제됩니다.</p>" +
      "<h2>제5조 (회원의 의무)</h2><p>회원은 타인의 정보를 도용하거나 사실이 아닌 결과를 제보해서는 안 되며, 계정 정보를 스스로 관리해야 합니다.</p>" +
      "<h2>제6조 (약관 변경)</h2><p>약관을 바꿀 때는 시행 7일 전부터 서비스에 알립니다.</p>" +
      '<p class="muted small">이 약관은 초안입니다. 운영 전에 운영자 정보와 내용을 검토해 확정하세요.</p></div></section>';
  }
  function pagePrivacy() {
    view.innerHTML = '<section class="section"><div class="card narrow doc"><h1>개인정보 처리방침</h1>' +
      "<p>" + OPERATOR + "는 「개인정보 보호법」에 따라 회원의 개인정보를 다음과 같이 처리합니다. 시행일: [시행일 입력 필요]</p>" +
      '<h2>1. 수집 항목과 목적</h2><div class="table-wrap"><table class="data-table"><thead><tr><th>구분</th><th>항목</th><th>목적</th></tr></thead><tbody>' +
      "<tr><td>필수</td><td>이메일, 비밀번호(암호화 저장), 이름(별명), 회원 구분 / 간편 로그인 시 카카오·네이버 회원 식별값, 이메일, 별명</td><td>회원 식별, 로그인</td></tr>" +
      "<tr><td>회원이 입력한 경우</td><td>내신·모의고사·수능·검정고시 성적, 관심 대학</td><td>성적 저장과 여러 기기 간 동기화, 계산 기능 제공</td></tr>" +
      "<tr><td>선택 동의 시</td><td>합격·불합격 결과(대학·학과·전형·결과)와 함께 보낸 성적</td><td>개인을 알아볼 수 없게 처리한 합격 예측 통계 작성</td></tr>" +
      "<tr><td>자동 수집</td><td>로그인 유지용 쿠키, 접속 기록</td><td>로그인 유지, 부정 이용 방지</td></tr></tbody></table></div>" +
      "<h2>2. 보유 기간</h2><p>회원 탈퇴 시 즉시 삭제합니다. 다만 결과 제보로 만든 통계는 개인을 알아볼 수 없는 형태이므로 탈퇴 후에도 남을 수 있습니다.</p>" +
      "<h2>3. 제3자 제공·처리 위탁</h2><p>회원의 개인정보를 제3자에게 제공하거나 판매하지 않습니다. 회원이 연결한 학부모 계정은 해당 자녀의 성적·관심 대학·제보 결과를 볼 수 있으며, 회원은 언제든 연결을 끊을 수 있습니다.</p>" +
      "<h2>4. 만 14세 미만</h2><p>만 14세 미만은 가입할 수 없습니다.</p>" +
      "<h2>5. 회원의 권리</h2><p>회원은 언제든 자신의 정보를 조회·수정·삭제하고 탈퇴할 수 있습니다(‘내 계정’). 비회원으로 입력한 성적은 이용자의 브라우저에만 저장되며 서버로 전송되지 않습니다.</p>" +
      "<h2>6. 안전성 확보 조치</h2><p>비밀번호는 복원할 수 없는 방식(scrypt)으로 암호화하고, 모든 통신은 HTTPS로 암호화합니다.</p>" +
      "<h2>7. 개인정보 보호책임자</h2><p>" + OFFICER + "</p>" +
      '<p class="muted small">이 방침은 초안입니다. 운영 전에 운영자·책임자 정보와 내용을 검토해 확정하세요.</p></div></section>';
  }

  /* ---------- 우리 아이 대시보드 (고1·고2 학부모 관리 도구) ---------- */
  // 학년·월별 할 일 (대략적인 학사 일정 기준. 학교마다 시험 시기는 조금씩 다름)
  var TODO = {
    "고1": { 3: ["3월 학력평가 응시 — 첫 전국 단위 위치 확인", "진로 희망 정리(학생부 진로활동의 시작)"], 4: ["1학기 중간고사 준비", "동아리 정하기 — 진로와 연결되면 좋음"], 5: ["중간고사 결과로 과목별 약점 점검", "수업 중 궁금한 점 기록 → 세특의 재료"],
      6: ["6월 학력평가", "기말고사 준비"], 7: ["1학기 성적 확인 → ‘내 성적’에 입력", "여름방학 진로 탐색(학과·진로 메뉴)"], 8: ["2학기 계획, 독서·탐구 주제 정하기"], 9: ["9월 학력평가", "2학년 선택과목 안내 확인"], 10: ["2학기 중간고사", "선택과목 결정 — 희망 학과 권장 이수 과목 확인"],
      11: ["11월 학력평가", "기말고사 준비"], 12: ["2학기 성적 확인·입력", "학생부(세특·창체) 내용 확인"], 1: ["1학년 총정리, 겨울방학 공부 계획"], 2: ["2학년 선택과목 최종 확인"] },
    "고2": { 3: ["3월 학력평가", "진로를 구체화 — 희망 학과 2~3개"], 4: ["중간고사 — 2학년 성적이 대입에서 가장 비중이 큼"], 5: ["진로 관련 과목에서 탐구 활동(세특)"], 6: ["6월 학력평가", "기말고사"], 7: ["1학기 성적 입력, 목표 대학 3~5곳 공식 입결 확인(대학 찾기)"],
      8: ["수능 영역별 약점 파악"], 9: ["9월 학력평가", "수시/정시 무게 중심 생각해 보기"], 10: ["2학기 중간고사", "3학년 선택과목 결정"], 11: ["11월 학력평가", "기말고사"], 12: ["2학기 성적 입력 — 내신 추이 확인", "내신으로 갈 수 있는 대학 확인"], 1: ["고3 대비 겨울방학 계획 — 수능 기초"], 2: ["학생부 1·2학년 내용 점검"] },
    "고3": { 3: ["3월 학력평가 — 지원 가능 범위 첫 점검", "수시 후보 대학 10곳"], 4: ["중간고사 — 마지막 반영 학기", "대학별 수시 모집요강 확인"], 5: ["수능 최저 기준 맞출 영역 정하기"], 6: ["6월 모의평가(평가원) — 수시/정시 결정의 기준", "기말고사"],
      7: ["1학기 성적 확정, 학생부 최종 점검", "수시 6곳 압축"], 8: ["자기 점검용 면접 준비, 원서 준비"], 9: ["9월 모의평가", "수시 원서접수"], 10: ["논술·면접 대비"], 11: ["대학수학능력시험", "가채점 → 수능 최저·정시 판단"], 12: ["수시 발표, 정시 지원 전략", "정시 원서접수(12월 말~1월 초)"], 1: ["정시 합격 발표 확인"], 2: ["추가합격·추가모집 확인"] },
    "졸업생": { 3: ["3월 계획 — 재수 목표 대학 정하기"], 6: ["6월 모의평가로 위치 확인"], 9: ["9월 모의평가, 수시 원서(졸업생 지원 가능 전형 확인)"], 11: ["수능, 가채점"], 12: ["정시 지원 전략"], 2: ["추가모집 확인"] },
    "검정고시": { 4: ["검정고시(4월 시행) 응시 — 점수가 높을수록 유리한 대학이 많음"], 8: ["검정고시(8월 시행)", "수시 지원 가능 대학·비교내신 방식 확인"], 9: ["수시 원서접수"], 11: ["수능"], 12: ["정시 지원 전략"] }
  };
  function semAvg(rows, system) {
    var max = system === "5" ? 5 : 9, out = [];
    SEMS.forEach(function (sm) {
      var sum = 0, u = 0;
      rows.forEach(function (r) { if (r.sem !== sm) return; var g = num(r.grade), w = num(r.unit); if (g >= 1 && g <= max && w > 0) { sum += g * w; u += w; } });
      out.push({ k: sm, v: u ? Math.round(sum / u * 100) / 100 : null });
    });
    return out;
  }
  function allAvg(rows, system) {
    var max = system === "5" ? 5 : 9, sum = 0, u = 0;
    rows.forEach(function (r) { var g = num(r.grade), w = num(r.unit); if (g >= 1 && g <= max && w > 0) { sum += g * w; u += w; } });
    return u ? Math.round(sum / u * 100) / 100 : null;
  }
  function dashboardHtml(d, editable) {
    var p = d.profile || {}, grade = p.grade || "고1", m = new Date().getMonth() + 1;
    var gpa = d.gpa || { system: "9", rows: [] }, sems = semAvg(gpa.rows || [], gpa.system).filter(function (x) { return x.v != null; }), avg = allAvg(gpa.rows || [], gpa.system);
    var ex = d.exams || [];
    var exPts = ex.map(function (e) {
      var gs = ["kor", "math", "eng", "t1"].map(function (k) { return gradeOf(e, k); }).filter(function (v) { return v; });
      return { k: (e.year ? String(e.year).slice(2) + " " : "") + e.kind.replace(/교육청 학력평가 |평가원 모의평가 /, "").replace("수능 성적표(실채점)", "수능"), v: gs.length ? Math.round(gs.reduce(function (a, b) { return a + b; }, 0) / gs.length * 10) / 10 : null };
    });
    var todos = (TODO[grade] || {})[m] || [];
    var done = d.todoDone || {};
    var rec = d.record || {}, cs = (d.counsel || []).filter(function (c) { return c.next && c.next >= new Date().toISOString().slice(0, 10); }).sort(function (a, b) { return a.next < b.next ? -1 : 1; })[0];
    return '<div class="dash-grid">' +
      '<div class="card dash-profile"><h2>프로필</h2>' + (editable ?
        '<div class="toolbar"><label>학년<select id="pfGrade">' + ["고1", "고2", "고3", "졸업생", "검정고시"].map(function (g) { return "<option" + (g === grade ? " selected" : "") + ">" + g + "</option>"; }).join("") + "</select></label>" +
        '<label>목표 학과<input id="pfDept" value="' + esc((rec.hopeDept) || "") + '" placeholder="예: 간호학과" /></label></div>' :
        "<p><b>" + esc(grade) + "</b>" + (rec.hopeDept ? " · 목표 " + esc(rec.hopeDept) : "") + "</p>") +
      '<div class="kpis">' + kpi("내신 평균", avg ? avg.toFixed(2) + "등급" : "-") + kpi("등급제", (gpa.system || "9") + "등급") + kpi("관심 대학", (d.fav || []).length + "곳") + "</div></div>" +
      '<div class="card"><h2>' + m + "월 할 일 <small class=\"muted\">(" + esc(grade) + ")</small></h2>" + (todos.length ? '<ul class="todo-list">' + todos.map(function (t, i) {
        var key = grade + "-" + m + "-" + i;
        return '<li><label class="check"><input type="checkbox" data-todo="' + key + '"' + (done[key] ? " checked" : "") + (editable ? "" : " disabled") + " /> " + esc(t) + "</label></li>";
      }).join("") + "</ul>" : '<p class="muted">이번 달 특별한 일정이 없습니다.</p>') + '<p class="muted small">시험 시기는 학교마다 조금씩 다릅니다.</p></div>' +
      '<div class="card"><h2>학기별 내신 추이</h2>' + (sems.some(function (x) { return x.v; }) ? lineChart(sems, { label: "학기별 평균 등급", unit: "등급", h: 170 }) + '<p class="muted small">숫자가 작을수록 좋은 등급입니다.</p>' :
        '<p class="muted">‘내 성적 → 학생부 내신’에 과목을 입력하면 학기별 추이가 나옵니다.</p>') + "</div>" +
      '<div class="card"><h2>모의고사 추이 <small class="muted">(국·수·영·탐 평균 등급)</small></h2>' + (exPts.some(function (x) { return x.v; }) ? lineChart(exPts, { label: "모의고사 평균 등급", unit: "등급", h: 170 }) :
        '<p class="muted">‘내 성적 → 모의고사·수능’에 성적을 입력하세요.</p>') + "</div>" +
      '<div class="card"><h2>학생부 점검</h2><ul class="plain">' +
      "<li>희망 학과: " + (rec.hopeDept ? "<b>" + esc(rec.hopeDept) + "</b>" : '<span class="muted">미입력</span>') + "</li>" +
      "<li>세특 입력: " + ((rec.seteuk || []).length) + "과목</li>" +
      "<li>다음 상담: " + (cs ? "<b>" + esc(cs.next) + "</b> " + esc(cs.who) : '<span class="muted">없음</span>') + "</li></ul>" +
      (editable ? '<a class="btn btn-ghost" href="#/calc">성적·학생부·상담 기록하기</a>' : "") + "</div>" +
      '<div class="card dash-cta"><h2>내신으로 갈 수 있는 대학</h2><p>지금 내신으로 대학별 교과전형 합격선과 비교해 <b>안정·적정·소신</b>으로 나눠 보여 줍니다.</p>' +
      '<a class="btn btn-primary" href="#/fit">' + (avg ? "내신 " + avg.toFixed(2) + "등급으로 찾아보기" : "찾아보기") + "</a></div>" +
      "</div>";
  }
  function pageMy(q) {
    return refreshMe().then(function () {
      if (!ME) return needLogin("my");
      if (ME.needConsent) return pageConsent();
      var who = q.get("child") || "";
      var render = function (data, editable, label, kids) {
        view.innerHTML = '<section class="section"><div class="section-head"><h1>' + esc(label) + "</h1>" +
          "<p>고1부터 고3까지 내신·모의고사 추이와 학년별로 그때그때 해야 할 일을 한곳에서 관리하세요.</p></div>" +
          (kids && kids.length ? '<div class="chips field-tabs"><a class="chip' + (who ? "" : " is-active") + '" href="#/my">직접 입력한 기록</a>' +
            kids.map(function (k) { return '<a class="chip' + (String(k.uid) === who ? " is-active" : "") + '" href="#/my?child=' + k.uid + '">' + esc(k.name || k.email || "자녀") + "</a>"; }).join("") + "</div>" : "") +
          (ME.role === "parent" && !(kids && kids.length) ? '<div class="callout">자녀가 자기 계정에서 기록하고 있다면 <a href="#/account">내 계정 → 자녀 계정 연결</a>로 연결하세요. 연결하지 않아도 이 화면에서 직접 입력해 관리할 수 있습니다.</div>' : "") +
          dashboardHtml(data, editable) + '<p class="muted small" style="margin-top:12px"><a href="#/account">내 계정 설정 · 자녀 연결 · 결과 제보 · 로그아웃</a></p></section>';
        if (!editable) return;
        var s = load();
        $("#pfGrade").addEventListener("change", function () { s = load(); s.profile = s.profile || {}; s.profile.grade = this.value; if (this.value === "검정고시") s.who = "검정고시"; save(s); pageMy(q); });
        $("#pfDept").addEventListener("change", function () { s = load(); s.record = s.record || { hope: "", hopeDept: "", att: {}, cha: {}, seteuk: [], haeng: {} }; s.record.hopeDept = this.value.trim(); save(s); });
        $all("[data-todo]").forEach(function (c) {
          c.addEventListener("change", function () { s = load(); s.todoDone = s.todoDone || {}; s.todoDone[c.getAttribute("data-todo")] = c.checked; save(s); });
        });
      };
      var kidsP = ME.role === "parent" ? api("GET", "/link").catch(function () { return []; }) : Promise.resolve([]);
      return kidsP.then(function (kids) {
        if (who) return api("GET", "/children/" + encodeURIComponent(who)).then(function (c) { render(c.data || {}, false, (c.name || "자녀") + " 대시보드", kids); });
        render(load(), true, ME.role === "parent" ? "우리 아이 대시보드" : "내 대시보드", kids);
      });
    });
  }

  /* ---------- 내신으로 갈 수 있는 대학 ---------- */
  function pageFit(q) {
    return refreshMe().then(function () {
      var s = load(), gpa = s.gpa || { system: "9", rows: [] }, avg = allAvg(gpa.rows || [], gpa.system);
      var regions = uniq(IDX.univ.map(function (u) { return u.region; })).sort();
      view.innerHTML = '<section class="section"><div class="section-head"><h1>내신으로 갈 수 있는 대학</h1>' +
        "<p>내 내신 평균등급을 대학이 공식 발표한 <b>교과전형 합격선</b>(70% 컷 등 대학이 공개한 기준)과 비교해 <b>안정·적정·소신</b>으로 나눠 보여 줍니다.</p></div>" +
        (ME && ME.premiumFree ? '<div class="callout ok">지금은 <b>무료 공개 기간</b>입니다. 회원이면 모든 결과를 볼 수 있습니다.</div>' : "") +
        '<div class="card"><form id="fitForm" class="toolbar">' +
        '<label>내신 평균등급<input name="grade" type="number" step="0.01" min="1" max="9" required value="' + (avg || "") + '" /></label>' +
        '<label>등급제<select name="scale"><option value="9"' + (gpa.system !== "5" ? " selected" : "") + '>9등급제</option><option value="5"' + (gpa.system === "5" ? " selected" : "") + ">5등급제(2025 고1~)</option></select></label>" +
        '<label>전형<select name="track"><option value="교과">학생부교과</option><option value="종합">학생부종합(참고)</option><option value="">전체</option></select></label>' +
        '<label>지역<select name="region"><option value="">전체</option>' + regions.map(function (r) { return "<option>" + esc(r) + "</option>"; }).join("") + "</select></label>" +
        '<button class="btn btn-primary" type="submit">찾기</button></form>' +
        (avg ? '<p class="muted small">‘내 성적’에 입력한 내신 평균(' + avg.toFixed(2) + "등급)을 불러왔습니다.</p>" : '<p class="muted small"><a href="#/calc">내 성적</a>에 내신을 입력해 두면 자동으로 채워집니다.</p>') +
        '</div><div id="fitOut"></div>' +
        '<div class="card"><h2>꼭 알아 두세요</h2><ul class="plain small">' +
        "<li><b>안정</b>: 내 등급이 합격선보다 0.3등급 이상 좋음 · <b>적정</b>: 합격선 근처(±0.2~0.3) · <b>소신</b>: 합격선보다 0.6등급 이내로 낮음.</li>" +
        "<li>합격선은 대학이 공개한 지난 입시결과(최종등록자 70% 컷 등)이며, 대학마다 기준(70%·80%·평균)이 다릅니다. 표마다 기준과 원문 링크를 달았습니다.</li>" +
        "<li>대학별 반영 교과·학년 비율이 달라 실제 환산 등급은 내 전과목 평균과 다를 수 있습니다. 수능 최저 기준도 함께 확인하세요.</li>" +
        "<li>5등급제 성적은 등급 비율로 9등급제에 맞춰 바꾼 <b>참고용 환산</b>입니다. 5등급제 입시결과가 나오면(2028학년도~) 그대로 비교합니다.</li>" +
        "<li>현재 공식 입결을 확보한 대학만 나옵니다. 대학은 계속 추가됩니다. 합격선이 없는 대학은 <a href=\"#/chance\">4년제 기회 찾기</a>(미달 예상)도 함께 보세요.</li></ul></div></section>";
      $("#fitForm").addEventListener("submit", function (e) {
        e.preventDefault();
        var f = this, out = $("#fitOut");
        if (!ME) { out.innerHTML = '<div class="card narrow"><h2>회원 전용</h2><p>로그인하면 결과를 볼 수 있습니다. 가입은 무료입니다.</p><a class="btn btn-primary" href="#/signup">무료 회원가입</a> <a class="btn btn-ghost" href="#/login?next=fit">로그인</a></div>'; return; }
        out.innerHTML = '<p class="muted">찾는 중…</p>';
        var qs = new URLSearchParams({ grade: f.grade.value, scale: f.scale.value, track: f.track.value, region: f.region.value });
        api("GET", "/premium/match?" + qs).then(function (r) {
          var c = r.counts;
          var head = '<div class="kpis">' + kpi("적정", c["적정"] + "곳") + kpi("소신", c["소신"] + "곳") + kpi("안정", c["안정"] + "곳") +
            kpi("비교 기준", (r.converted ? "환산 " : "") + r.g9.toFixed(2) + "등급(9등급제)") + kpi("합격선 보유", r.univ + "개 대학") + "</div>";
          if (!r.premium) {
            out.innerHTML = head + '<div class="card"><h2>미리보기</h2><p>전체 대학·학과 목록은 이용권 회원에게 제공됩니다.</p><a class="btn btn-primary" href="#/premium">이용권 안내</a></div>';
            return;
          }
          var cats = ["적정", "소신", "안정"];
          out.innerHTML = head + cats.map(function (cat) {
            var rows = r.rows.filter(function (x) { return x.cat === cat; });
            if (!rows.length) return "";
            return '<div class="card"><h2>' + cat + " <small class=\"muted\">" + rows.length + "곳</small></h2>" +
              '<div class="table-wrap"><table class="data-table"><thead><tr><th>대학</th><th>학과(모집단위)</th><th>전형</th><th>지역</th><th class="num">합격선</th><th class="num">내 등급과 차이</th><th>기준·원문</th></tr></thead><tbody>' +
              rows.slice(0, 300).map(function (x) {
                return '<tr><td><a href="#/univ/' + esc(x.u) + '">' + esc(x.un) + "</a></td><td>" + esc(x.d) + "</td><td>" + esc(x.j || x.tr) + "</td><td>" + esc(x.rg) +
                  '</td><td class="num"><b>' + x.c.toFixed(2) + '</b> <small class="muted">' + x.y + '</small></td><td class="num">' + (x.diff >= 0 ? "+" : "") + x.diff.toFixed(2) +
                  '</td><td class="small">' + esc(x.ct) + ' · <a href="' + esc(x.src) + (x.pg ? "#page=" + x.pg : "") + '" target="_blank" rel="noopener">원문</a></td></tr>';
              }).join("") + "</tbody></table></div></div>";
          }).join("") || '<p class="empty">조건에 맞는 학과가 없습니다. 지역·전형을 넓혀 보세요.</p>';
        }).catch(function (er) { out.innerHTML = '<p class="form-error">' + esc(er.message) + "</p>"; });
      });
      if (avg && ME) $("#fitForm").dispatchEvent(new Event("submit", { cancelable: true }));
    });
  }

  /* ---------- 이용권 안내 ---------- */
  function pagePremium() {
    return refreshMe().then(function () {
      view.innerHTML = '<section class="section"><div class="section-head"><h1>이용권 안내</h1><p>입시나침반의 기본 기능은 모두 무료입니다.</p></div>' +
        (ME && ME.premiumFree ? '<div class="callout ok"><b>지금은 무료 공개 기간</b>입니다. 회원이면 ‘내신으로 갈 수 있는 대학’을 포함한 모든 기능을 무료로 쓸 수 있습니다.</div>' : "") +
        '<div class="grid-2"><div class="card"><h2>무료 회원</h2><ul class="plain">' +
        "<li>우리 아이 대시보드 (고1~고3 관리)</li><li>내신·모의고사·수능·검정고시 성적 기록, 수능 최저 확인</li><li>학생부·상담 기록, 학부모-자녀 연결</li>" +
        "<li>대학·학과 10년 통계, 4년제 기회 찾기(미달 예상)</li><li>입시 전략·가이드, 학과·진로</li></ul></div>" +
        '<div class="card"><h2>이용권</h2><ul class="plain"><li><b>내신으로 갈 수 있는 대학</b> — 대학별 공식 합격선과 비교한 안정·적정·소신 전체 목록과 원문 근거</li>' +
        "<li>앞으로 추가: 정시 환산점수 비교, 합격 예측</li></ul>" +
        (ME && ME.premiumUntil ? "<p>이용 기간: <b>" + new Date(ME.premiumUntil * 1000).toLocaleDateString("ko-KR") + "</b>까지</p>" : '<p class="muted small">결제 기능은 준비 중입니다.</p>') + "</div></div></section>";
    });
  }

  /* ---------- 관리 (관리자·운영자) ---------- */
  function pageAdmin(sub) {
    return refreshMe().then(function () {
      if (!ME) return needLogin("admin");
      if (!ME.isStaff) { view.innerHTML = '<section class="section"><h1>페이지를 찾을 수 없습니다</h1></section>'; return; }
      if (sub === "gichul") return pageGichul();
      var tab = sub || "stats";
      view.innerHTML = '<section class="section"><div class="section-head"><h1>관리 <span class="tag tag-w">' + (ME.isAdmin ? "관리자" : "운영자") + "</span></h1>" +
        "<p>회원 현황, 결과 제보, 기출 정리함을 관리합니다. 회원의 성적·학생부·상담 기록은 개인정보라 이 화면에서 볼 수 없습니다.</p></div>" +
        '<div class="tabs" style="margin-bottom:14px">' +
        [["stats", "현황"], ["users", "회원"], ["reports", "결과 제보"], ["gichul", "기출 정리함"]].map(function (t) {
          return '<a class="tabs-a' + (t[0] === tab ? " is-active" : "") + '" href="#/admin/' + t[0] + '">' + t[1] + "</a>";
        }).join("") + '</div><div id="adBody">불러오는 중…</div></section>';
      var box = $("#adBody");
      if (tab === "stats") return api("GET", "/admin/stats").then(function (x) {
        var max = Math.max.apply(null, x.daily.map(function (d) { return d.n; }).concat([1]));
        box.innerHTML = '<div class="kpis">' + kpi("회원", fmtInt(x.users) + "명") + kpi("학생", fmtInt(x.students)) + kpi("학부모", fmtInt(x.parents)) +
          kpi("최근 7일 가입", fmtInt(x.new7)) + kpi("최근 30일 가입", fmtInt(x.new30)) + kpi("최근 7일 로그인", fmtInt(x.active7)) + "</div>" +
          '<div class="kpis wide">' + kpi("성적 저장 회원", fmtInt(x.withData)) + kpi("학부모-자녀 연결", fmtInt(x.links)) + kpi("제보 동의 회원", fmtInt(x.reportConsent)) +
          kpi("결과 제보", fmtInt(x.reports) + "건") + kpi("카카오", fmtInt(x.social.kakao || 0)) + kpi("네이버", fmtInt(x.social.naver || 0)) + kpi("기출 파일", fmtInt(x.gichulFiles)) + kpi("이용권 회원", fmtInt(x.premium)) + "</div>" +
          '<div class="card" style="margin-top:16px"><h2>최근 30일 가입</h2>' + (x.daily.length ? '<div class="bars">' + x.daily.map(function (d) {
            return '<div class="bar" title="' + esc(d.d) + " " + d.n + '명"><i style="height:' + Math.round(d.n / max * 100) + '%"></i><small>' + esc(d.d.slice(5)) + "</small></div>";
          }).join("") + "</div>" : '<p class="muted">가입 없음</p>') + "</div>";
      });
      if (tab === "users") {
        var load = function (q) {
          return api("GET", "/admin/users?q=" + encodeURIComponent(q || "")).then(function (list) {
            var date = function (t) { return t ? new Date(t * 1000).toLocaleDateString("ko-KR") : "-"; };
            box.innerHTML = '<div class="card"><div class="toolbar"><label>이메일·이름 검색<input type="search" id="uQ" value="' + esc(q || "") + '" /></label></div>' +
              '<div class="table-wrap"><table class="data-table"><thead><tr><th>이메일</th><th>이름</th><th>구분</th><th>로그인</th><th>가입</th><th>최근 로그인</th><th class="num">제보</th><th>권한</th><th>이용권</th><th></th></tr></thead><tbody>' +
              list.map(function (u) {
                var role = u.admin ? '<span class="tag tag-c">최초 관리자</span>' : ME.isAdmin && u.id !== ME.id ?
                  '<select data-staff="' + u.id + '">' + [["", "일반"], ["operator", "운영자"], ["admin", "관리자"]].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === u.staff ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select>" :
                  esc({ "": "일반", operator: "운영자", admin: "관리자" }[u.staff] || "일반");
                return "<tr><td>" + esc(u.email || "(간편 로그인)") + "</td><td>" + esc(u.name) + "</td><td>" + (u.role === "parent" ? "학부모" : "학생") + (u.consent_at ? "" : ' <span class="tag">동의 전</span>') +
                  "</td><td>" + esc((u.providers || "이메일").replace("kakao", "카카오").replace("naver", "네이버")) + "</td><td>" + date(u.created) + "</td><td>" + date(u.last_login) +
                  '</td><td class="num">' + u.reports + "</td><td>" + role + "</td><td>" + (u.premium_until && u.premium_until * 1000 > Date.now() ? '<span class="tag tag-c">' + new Date(u.premium_until * 1000).toLocaleDateString("ko-KR") + "까지</span> " : "") +
                  (ME.isAdmin ? '<select data-prem="' + u.id + '"><option value="">이용권…</option><option value="30">+30일</option><option value="365">+1년</option><option value="0">해제</option></select>' : "") + "</td><td>" + (ME.isAdmin && u.id !== ME.id && !u.admin ? '<button class="icon-btn" data-udel="' + u.id + '" title="강제 탈퇴">×</button>' : "") + "</td></tr>";
              }).join("") + '</tbody></table></div><p class="muted small">최대 500명 표시. 권한 변경·강제 탈퇴는 관리자만 할 수 있습니다. 최초 관리자는 서버 설정(ADMIN_EMAILS)으로 정합니다.</p></div>';
            var t;
            $("#uQ").addEventListener("input", function () { var v = this.value.trim(); clearTimeout(t); t = setTimeout(function () { load(v); }, 300); });
            $all("[data-staff]").forEach(function (sel) {
              sel.addEventListener("change", function () {
                api("PUT", "/admin/users/" + sel.getAttribute("data-staff"), { staff: sel.value }).catch(function (e) { alert(e.message); load(q); });
              });
            });
            $all("[data-prem]").forEach(function (sel) {
              sel.addEventListener("change", function () {
                if (sel.value === "") return;
                api("PUT", "/admin/users/" + sel.getAttribute("data-prem") + "/premium", { days: +sel.value }).then(function () { load(q); }).catch(function (e) { alert(e.message); });
              });
            });
            $all("[data-udel]").forEach(function (b) {
              b.addEventListener("click", function () {
                if (!confirm("이 회원을 강제 탈퇴시킬까요? 회원의 모든 정보가 즉시 삭제됩니다.")) return;
                api("DELETE", "/admin/users/" + b.getAttribute("data-udel")).then(function () { load(q); }).catch(function (e) { alert(e.message); });
              });
            });
          });
        };
        return load("");
      }
      if (tab === "reports") return api("GET", "/admin/reports").then(function (list) {
        var byRes = {}, byTrack = {};
        list.forEach(function (r) { byRes[r.result] = (byRes[r.result] || 0) + 1; byTrack[r.track] = (byTrack[r.track] || 0) + 1; });
        box.innerHTML = '<div class="kpis">' + kpi("제보", list.length + "건") + Object.keys(byRes).map(function (k) { return kpi(k, byRes[k]); }).join("") + "</div>" +
          '<div class="card" style="margin-top:16px"><h2>최근 제보</h2><p class="muted small">통계 활용에 동의한 회원의 제보만, 누가 썼는지 빼고 보여 줍니다. 이 자료가 쌓이면 합격 예측 모델의 사례가 됩니다.</p>' +
          '<div class="table-wrap"><table class="data-table"><thead><tr><th>학년도</th><th>전형</th><th>대학</th><th>학과</th><th>전형명</th><th>결과</th><th>성적 첨부</th></tr></thead><tbody>' +
          list.map(function (r) { return "<tr><td>" + r.year + "</td><td>" + esc(r.track) + "</td><td>" + esc(r.univ_name) + "</td><td>" + esc(r.dept) + "</td><td>" + esc(r.jeonhyeong) + "</td><td><b>" + esc(r.result) + "</b></td><td>" + (r.has_score ? "있음" : "-") + "</td></tr>"; }).join("") +
          "</tbody></table></div></div>";
      });
    });
  }

  /* ---------- 관리자: 기출 정리함 (운영자 개인 참고용) ---------- */
  var G_SUBJ = ["언어와 매체", "화법과 작문", "문학", "독서", "국어", "확률과 통계", "미적분", "기하", "수학Ⅱ", "수학Ⅰ", "수학2", "수학1", "수학",
    "영어Ⅱ", "영어Ⅰ", "영어2", "영어1", "영어독해와 작문", "영어", "한국사", "통합사회", "통합과학", "물리학Ⅱ", "물리학Ⅰ", "물리", "화학Ⅱ", "화학Ⅰ", "화학",
    "생명과학Ⅱ", "생명과학Ⅰ", "생명과학", "지구과학Ⅱ", "지구과학Ⅰ", "지구과학", "한국지리", "세계지리", "생활과 윤리", "윤리와 사상", "사회·문화", "사회문화",
    "정치와 법", "경제", "동아시아사", "세계사", "정보", "일본어", "중국어", "한문", "과학탐구실험"];
  function gParse(name) {
    var n = name.replace(/[_\-.()\[\]]/g, " "), sq = n.replace(/\s+/g, "");
    var y = (n.match(/20(1\d|2\d|3\d)/) || [""])[0];
    var g = (sq.match(/([123])학년/) || sq.match(/고([123])/) || [null, ""])[1];
    var sem = (sq.match(/([12])학기/) || [null, ""])[1];
    var exam = /중간/.test(sq) ? "중간" : /기말/.test(sq) ? "기말" : /1차/.test(sq) ? "1차 지필" : /2차/.test(sq) ? "2차 지필" : "";
    var subj = "";
    for (var i = 0; i < G_SUBJ.length; i++) if (sq.indexOf(G_SUBJ[i].replace(/\s/g, "")) >= 0) { subj = G_SUBJ[i]; break; }
    return { year: y, grade: g ? g + "학년" : "", sem: sem ? sem + "학기" : "", exam: exam, subject: subj };
  }
  function pageGichul() {
    return refreshMe().then(function () {
      if (!ME) return needLogin("admin/gichul");
      if (!ME.isStaff) { view.innerHTML = '<section class="section"><h1>페이지를 찾을 수 없습니다</h1></section>'; return; }
      return Promise.all([api("GET", "/admin/gichul/schools"), api("GET", "/admin/gichul/files")]).then(function (r) {
        var schools = r[0], files = r[1];
        var st = { q: "", gu: "", status: "", type: "", open: null, tab: "schools" };
        var gus = uniq(schools.map(function (s) { return s.gu; })).sort();
        var types = uniq(schools.map(function (s) { return s.type; })).sort();
        view.innerHTML = '<section class="section"><div class="section-head"><p class="crumb"><a href="#/admin">관리</a> ›</p><h1>기출 정리함 <span class="tag tag-w">운영진 전용</span></h1>' +
          "<p>서울 고등학교가 홈페이지에 공개한 평가 문항을 직접 내려받아 모아 두는 곳입니다. 파일은 웹에 공개되지 않는 서버 폴더에만 저장되며 운영자 개인 참고용입니다(사이트 게시·배포 금지).</p></div>" +
          '<div class="kpis" id="gSum"></div>' +
          '<div class="tabs" style="margin:14px 0"><button type="button" data-t="schools">학교 체크리스트</button><button type="button" data-t="files">모은 파일</button></div>' +
          '<div id="gBody"></div></section>';
        function summary() {
          var c = function (v) { return schools.filter(function (s) { return s.status === v; }).length; };
          $("#gSum").innerHTML = kpi("전체 학교", schools.length + "곳") + kpi("받음", c("받음") + "곳") + kpi("확인 중", c("확인 중") + "곳") +
            kpi("자료 없음", c("자료 없음") + "곳") + kpi("남은 학교", c("") + "곳") + kpi("모은 파일", files.length + "개");
        }
        function tabs() {
          $all(".tabs button[data-t]").forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-t") === st.tab); });
          if (st.tab === "files") renderFiles(); else renderSchools();
        }
        $all(".tabs button[data-t]").forEach(function (b) { b.addEventListener("click", function () { st.tab = b.getAttribute("data-t"); tabs(); }); });

        function renderSchools() {
          $("#gBody").innerHTML = '<div class="card"><div class="toolbar">' +
            '<label>학교 검색<input type="search" id="gQ" value="' + esc(st.q) + '" /></label>' +
            '<label>구<select id="gGu"><option value="">전체</option>' + gus.map(function (g) { return "<option" + (g === st.gu ? " selected" : "") + ">" + esc(g) + "</option>"; }).join("") + "</select></label>" +
            '<label>학교 유형<select id="gType"><option value="">전체</option>' + types.map(function (g) { return "<option" + (g === st.type ? " selected" : "") + ">" + esc(g) + "</option>"; }).join("") + "</select></label>" +
            '<label>진행 상황<select id="gSt"><option value="">전체</option><option value="-">아직 안 봄</option><option>확인 중</option><option>받음</option><option>자료 없음</option><option>제외</option></select></label></div>' +
            '<p class="muted small">① 학교 이름 옆 ‘홈페이지’를 눌러 학교 홈페이지의 ‘평가 공개’(학사·평가 메뉴)에서 문항 파일을 내려받고 → ② ‘파일 올리기’에 끌어다 놓으세요. 파일 이름에서 학년도·학년·학기·시험·과목을 자동으로 채웁니다.</p>' +
            '<div class="table-wrap"><table class="data-table"><thead><tr><th>학교</th><th>구</th><th>유형</th><th>홈페이지</th><th>진행 상황</th><th class="num">파일</th><th></th></tr></thead><tbody id="gRows"></tbody></table></div></div>';
          $("#gSt").value = st.status;
          var rows = function () {
            var list = schools.filter(function (s) {
              return (!st.q || s.name.indexOf(st.q) >= 0) && (!st.gu || s.gu === st.gu) && (!st.type || s.type === st.type) &&
                (!st.status || (st.status === "-" ? s.status === "" : s.status === st.status));
            });
            $("#gRows").innerHTML = list.map(function (s) {
              var html = '<tr data-code="' + esc(s.code) + '"><td><b>' + esc(s.name) + "</b></td><td>" + esc(s.gu) + "</td><td>" + esc(s.type) + "</td>" +
                '<td><a href="' + esc(s.home) + '" target="_blank" rel="noopener">홈페이지 ↗</a></td>' +
                '<td><select data-status>' + ["", "확인 중", "받음", "자료 없음", "제외"].map(function (v) { return '<option value="' + v + '"' + (v === s.status ? " selected" : "") + ">" + (v || "아직 안 봄") + "</option>"; }).join("") + "</select></td>" +
                '<td class="num">' + (s.files ? '<a href="#" data-showfiles>' + s.files + "</a>" : "0") + '</td><td><button class="btn btn-ghost" type="button" data-up>파일 올리기</button></td></tr>';
              if (st.open === s.code) html += '<tr class="exp-detail"><td colspan="7">' + uploader(s) + "</td></tr>";
              return html;
            }).join("") || '<tr><td colspan="7" class="empty">조건에 맞는 학교가 없습니다.</td></tr>';
            if (st.open) bindUploader(schools.filter(function (s) { return s.code === st.open; })[0], rows);
          };
          $("#gRows").addEventListener("change", function (e) {
            if (!e.target.hasAttribute("data-status")) return;
            var code = e.target.closest("tr").getAttribute("data-code"), s = schools.filter(function (x) { return x.code === code; })[0];
            api("PUT", "/admin/gichul/schools/" + encodeURIComponent(code), { status: e.target.value, note: s.note }).then(function () { s.status = e.target.value; summary(); });
          });
          $("#gRows").addEventListener("click", function (e) {
            var tr = e.target.closest("tr[data-code]"); if (!tr) return;
            var code = tr.getAttribute("data-code");
            if (e.target.hasAttribute("data-up")) { st.open = st.open === code ? null : code; rows(); }
            if (e.target.hasAttribute("data-showfiles")) { e.preventDefault(); st.tab = "files"; st.fileSchool = code; tabs(); }
          });
          var t;
          $("#gQ").addEventListener("input", function () { var v = this.value.trim(); clearTimeout(t); t = setTimeout(function () { st.q = v; rows(); }, 150); });
          $("#gGu").addEventListener("change", function () { st.gu = this.value; rows(); });
          $("#gType").addEventListener("change", function () { st.type = this.value; rows(); });
          $("#gSt").addEventListener("change", function () { st.status = this.value; rows(); });
          rows();
        }
        function uploader(s) {
          return '<div class="drop" id="gDrop"><b>' + esc(s.name) + '</b> — 파일을 여기에 끌어다 놓거나 <label class="linklike">선택<input type="file" id="gPick" multiple hidden /></label> (hwp·hwpx·pdf·zip 등, 60MB 이하)' +
            '<label style="display:block;margin-top:8px">원본 게시글 주소(선택)<input id="gSrc" placeholder="학교 홈페이지 게시글 주소를 붙여 두면 나중에 다시 찾기 쉽습니다" /></label></div>' +
            '<div id="gQueue"></div>';
        }
        function bindUploader(s, rerender) {
          var queue = [];
          var drop = $("#gDrop");
          function add(fl) {
            Array.prototype.forEach.call(fl, function (f) { var p = gParse(f.name); queue.push({ f: f, m: p, state: "" }); });
            paint();
          }
          function paint() {
            $("#gQueue").innerHTML = queue.length ? '<div class="table-wrap"><table class="data-table compact"><thead><tr><th>파일</th><th>학년도</th><th>학년</th><th>학기</th><th>시험</th><th>과목</th><th></th></tr></thead><tbody>' +
              queue.map(function (q, i) {
                var inp = function (k, w) { return '<input data-i="' + i + '" data-k="' + k + '" value="' + esc(q.m[k]) + '" style="width:' + w + 'px" />'; };
                return "<tr><td>" + esc(q.f.name) + ' <small class="muted">' + Math.round(q.f.size / 1024) + "KB</small></td><td>" + inp("year", 70) + "</td><td>" + inp("grade", 60) +
                  "</td><td>" + inp("sem", 60) + "</td><td>" + inp("exam", 70) + "</td><td>" + inp("subject", 110) + "</td><td>" + (q.state ? esc(q.state) : '<button class="icon-btn" data-rm="' + i + '">×</button>') + "</td></tr>";
              }).join("") + '</tbody></table></div><button class="btn btn-primary" type="button" id="gSend">' + queue.filter(function (q) { return !q.state; }).length + "개 올리기</button>" : "";
            $all("#gQueue input").forEach(function (el) { el.addEventListener("input", function () { queue[+el.getAttribute("data-i")].m[el.getAttribute("data-k")] = el.value; }); });
            $all("#gQueue [data-rm]").forEach(function (b) { b.addEventListener("click", function () { queue.splice(+b.getAttribute("data-rm"), 1); paint(); }); });
            if ($("#gSend")) $("#gSend").addEventListener("click", send);
          }
          function send() {
            var src = $("#gSrc").value.trim();
            var todo = queue.filter(function (q) { return !q.state; });
            var next = function () {
              var q = todo.shift();
              if (!q) {
                return api("GET", "/admin/gichul/files").then(function (f) {
                  files = f; s.files = files.filter(function (x) { return x.school_code === s.code; }).length;
                  if (!s.status) s.status = "받음";
                  summary(); paint();
                });
              }
              q.state = "올리는 중…"; paint();
              var qs = new URLSearchParams({ school: s.code, name: q.f.name, year: /^\d{4}$/.test(q.m.year) ? q.m.year : "0", grade: q.m.grade, sem: q.m.sem, exam: q.m.exam, subject: q.m.subject, src: src });
              return fetch("/api/admin/gichul/upload?" + qs, { method: "PUT", credentials: "same-origin", headers: { "x-ipsi": "1" }, body: q.f })
                .then(function (r) { return r.json().then(function (j) { q.state = r.ok ? "완료" : (j.error || "실패"); }); })
                .catch(function () { q.state = "실패(연결)"; }).then(next);
            };
            next();
          }
          drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("over"); });
          drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
          drop.addEventListener("drop", function (e) { e.preventDefault(); drop.classList.remove("over"); add(e.dataTransfer.files); });
          $("#gPick").addEventListener("change", function () { add(this.files); this.value = ""; });
        }

        function renderFiles() {
          var sub = uniq(files.map(function (f) { return f.subject; })).sort();
          var yrs = uniq(files.map(function (f) { return String(f.year || ""); })).sort().reverse();
          var fs = { school: st.fileSchool || "", subject: "", year: "" };
          $("#gBody").innerHTML = '<div class="card"><div class="toolbar">' +
            '<label>학교<select id="fSch"><option value="">전체</option>' + uniq(files.map(function (f) { return f.school_code + "|" + f.school_name; })).sort(function (a, b) { return a.split("|")[1].localeCompare(b.split("|")[1], "ko"); })
              .map(function (v) { var p = v.split("|"); return '<option value="' + esc(p[0]) + '"' + (p[0] === fs.school ? " selected" : "") + ">" + esc(p[1]) + "</option>"; }).join("") + "</select></label>" +
            '<label>학년도<select id="fYr"><option value="">전체</option>' + yrs.map(function (y) { return "<option>" + esc(y) + "</option>"; }).join("") + "</select></label>" +
            '<label>과목<select id="fSub"><option value="">전체</option>' + sub.map(function (y) { return "<option>" + esc(y) + "</option>"; }).join("") + "</select></label></div>" +
            '<div class="table-wrap"><table class="data-table"><thead><tr><th>학교</th><th>학년도</th><th>학년</th><th>학기</th><th>시험</th><th>과목</th><th>파일</th><th></th></tr></thead><tbody id="fRows"></tbody></table></div></div>';
          function rows() {
            var list = files.filter(function (f) { return (!fs.school || f.school_code === fs.school) && (!fs.year || String(f.year || "") === fs.year) && (!fs.subject || f.subject === fs.subject); });
            $("#fRows").innerHTML = list.map(function (f) {
              return "<tr><td>" + esc(f.school_name) + "</td><td>" + (f.year || "") + "</td><td>" + esc(f.grade) + "</td><td>" + esc(f.sem) + "</td><td>" + esc(f.exam) + "</td><td>" + esc(f.subject) +
                '</td><td><a href="/api/admin/gichul/files/' + f.id + '/download">' + esc(f.filename) + "</a>" + (f.src_url ? ' <a href="' + esc(f.src_url) + '" target="_blank" rel="noopener" class="small">원문↗</a>' : "") +
                '</td><td><button class="icon-btn" data-fdel="' + f.id + '" aria-label="삭제">×</button></td></tr>';
            }).join("") || '<tr><td colspan="8" class="empty">모은 파일이 없습니다.</td></tr>';
          }
          $("#fRows").addEventListener("click", function (e) {
            var id = e.target.getAttribute("data-fdel"); if (!id) return;
            if (!confirm("이 파일을 서버에서 지울까요?")) return;
            api("DELETE", "/admin/gichul/files/" + id).then(function () {
              files = files.filter(function (f) { return String(f.id) !== id; });
              schools.forEach(function (s) { s.files = files.filter(function (f) { return f.school_code === s.code; }).length; });
              summary(); rows();
            });
          });
          $("#fSch").addEventListener("change", function () { fs.school = this.value; st.fileSchool = this.value; rows(); });
          $("#fYr").addEventListener("change", function () { fs.year = this.value; rows(); });
          $("#fSub").addEventListener("change", function () { fs.subject = this.value; rows(); });
          rows();
        }
        summary(); tabs();
      });
    });
  }

  /* ---------- 시작 ---------- */
  getJSON("data/index.json").then(function (j) {
    IDX = j;
    $("#footerSources").innerHTML = "데이터 기준: " + esc(j.meta.built) + "<br>" + j.meta.sources.map(function (s) { return esc(s.name); }).join("<br>");
    view.classList.remove("loading");
    // 회원 API 가 없거나 응답하지 않아도 사이트는 그대로 연다
    return refreshMe().then(function () {
      return api("GET", "/auth/providers").then(function (p) { PROV = p; }).catch(function () {});
    }).then(pullData).then(route);
  }).catch(function (e) {
    view.innerHTML = '<div class="section"><h1>데이터를 불러오지 못했습니다</h1><p class="muted">' + esc(e.message) + "</p><p>웹서버(nginx 등)를 통해 접속해야 합니다. 파일을 직접 열면 동작하지 않습니다.</p></div>";
  });
})();
