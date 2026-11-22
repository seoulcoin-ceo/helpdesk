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
  function save(s) { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) { /* 무시 */ } }
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
    $all(".site-nav a").forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("data-nav") === parts[0]); });
    $(".site-nav").classList.remove("open");
    var p;
    switch (parts[0]) {
      case "univ": p = parts[1] ? pageUnivDetail(parts[1]) : pageUnivList(q); break;
      case "college": p = parts[1] ? pageCollegeDetail(parts[1]) : pageCollegeList(q); break;
      case "dept": p = pageDept(q); break;
      case "calc": p = pageCalc(); break;
      case "guide": p = pageGuide(); break;
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
      var lbl = '<text class="xl" x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + String(p.k).slice(-2) + "</text>";
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
      card("#/univ", "4년제 대학", "대학별·학과별 10개년 모집인원, 지원자, 경쟁률, 충원율 추이와 대학 공식 입시결과·모집요강 원문.") +
      card("#/college", "전문대학", "전문대학 학과별 일반전형·일반고·특성화고 등 전형별 모집·지원·경쟁률.") +
      card("#/dept", "학과 찾기", "가고 싶은 학과를 개설한 전국 대학을 경쟁률·모집인원 순으로 비교.") +
      card("#/calc", "성적 계산기", "내신 평균등급(9등급·5등급제)과 영어·한국사 절대평가 등급 자동 계산.") +
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
    return (DEPTS ? Promise.resolve(DEPTS) : getJSON("data/depts.json")).then(function (list) {
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
        '<p class="muted small" id="pCount"></p><div class="table-wrap"><table class="data-table"><thead><tr><th>학과</th><th>대학</th><th>지역</th><th>계열</th><th class="num">정원내 모집</th><th class="num">경쟁률</th></tr></thead><tbody id="pBody"></tbody></table></div>' +
        sourceNote(SRC_UNIV) + "</section>";
      function render() {
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

  /* ---------- 성적 계산기 ---------- */
  var GROUPS = ["국어", "수학", "영어", "사회", "과학", "한국사", "기타"];
  var SEMS = ["1-1", "1-2", "2-1", "2-2", "3-1", "3-2"];
  function pageCalc() {
    var s = load();
    s.gpa = s.gpa || { system: "9", rows: [] };
    view.innerHTML =
      '<section class="section"><div class="section-head"><h1>성적 계산기</h1><p>입력한 성적은 이 기기의 브라우저에만 저장되며 서버로 전송되지 않습니다.</p></div>' +
      '<div class="card"><h2>내신 평균등급</h2><p class="muted small">평균등급 = Σ(등급 × 단위수) ÷ Σ단위수. 진로선택(성취도 A·B·C) 과목은 대학마다 반영 방식이 달라 제외하고 입력하세요. ' +
      "실제 대학별 환산점수는 반영 교과·학년별 비율·가산점이 달라 이 평균과 다를 수 있습니다.</p>" +
      '<div class="toolbar"><label>등급 체계<select id="gSys"><option value="9">9등급제 (2025학년도 고1 이전 입학)</option><option value="5">5등급제 (2025년 고1 입학부터)</option></select></label>' +
      '<div class="toolbar-actions"><button class="btn btn-ghost" type="button" id="gAdd">+ 과목 추가</button><button class="btn btn-ghost danger" type="button" id="gClear">전체 삭제</button></div></div>' +
      '<div class="table-wrap"><table class="data-table gpa-table"><thead><tr><th>학기</th><th>교과</th><th>과목명</th><th>단위수(학점)</th><th>석차등급</th><th></th></tr></thead><tbody id="gRows"></tbody></table></div>' +
      '<div class="kpis wide" id="gStats"></div></div>' +

      '<div class="card"><h2>영어·한국사 절대평가 등급</h2><p class="muted small">수능·평가원 모의평가 기준: 영어 90점 이상 1등급(10점 단위), 한국사 40점 이상 1등급(5점 단위).</p>' +
      '<div class="toolbar"><label>영어 원점수 (0~100)<input type="number" id="eRaw" min="0" max="100" inputmode="numeric" /></label><div class="kpi"><span>영어 등급</span><strong id="eOut">-</strong></div>' +
      '<label>한국사 원점수 (0~50)<input type="number" id="hRaw" min="0" max="50" inputmode="numeric" /></label><div class="kpi"><span>한국사 등급</span><strong id="hOut">-</strong></div></div></div>' +
      '<div class="callout"><b>합격 가능성 예측은 제공하지 않습니다.</b> 대학별 합격선은 각 대학이 발표한 공식 입시결과 원문(대학 상세 페이지 하단)에서 확인하세요. ' +
      "근거 없는 추정 합격선은 오히려 판단을 흐린다고 보기 때문입니다.</div></section>";

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
    $("#eRaw").addEventListener("input", function () {
      var v = num(this.value); $("#eOut").textContent = v == null || v < 0 || v > 100 ? "-" : Math.min(9, 10 - Math.floor(Math.min(v, 99) / 10)) + "등급";
    });
    $("#hRaw").addEventListener("input", function () {
      var v = num(this.value); $("#hOut").textContent = v == null || v < 0 || v > 50 ? "-" : (v >= 40 ? 1 : Math.min(9, 1 + Math.ceil((40 - v) / 5))) + "등급";
    });
    render();
  }

  /* ---------- 가이드 ---------- */
  function pageGuide() {
    view.innerHTML =
      '<section class="section"><div class="section-head"><h1>입시 가이드</h1><p>제도 설명은 교육부·대교협 공식 발표를 기준으로 합니다. 세부 사항은 매년 바뀌므로 해당 학년도 모집요강을 반드시 확인하세요.</p></div>' +
      '<div class="grid-2">' +
      '<article class="card"><h2>수시와 정시</h2><ul class="plain">' +
      "<li><b>수시</b>: 학생부교과·학생부종합·논술·실기 전형. 최대 6회 지원(산업대·전문대·KAIST 등 특수 대학 제외). 최초·충원 합격 시 정시 지원 불가.</li>" +
      "<li><b>정시</b>: 수능 위주. 가·나·다군 군별 1회씩 최대 3회 지원.</li>" +
      "<li><b>수능 최저학력기준</b>: 수시 합격을 위해 충족해야 하는 수능 등급 조건. 대학·전형마다 다름.</li></ul></article>" +
      '<article class="card"><h2>공식 입시결과(입결) 읽는 법</h2><ul class="plain">' +
      "<li><b>50%컷 / 70%컷</b>: 최종 등록자를 성적순으로 줄 세웠을 때 상위 50%·70% 지점의 성적. 70%컷이 ‘이 정도면 합격권 하단’에 가깝습니다.</li>" +
      "<li><b>최초합 vs 최종등록</b>: 추가합격 후 실제 등록자 기준인지 확인하세요. 대부분 최종등록자 기준입니다.</li>" +
      "<li><b>학생부종합 등급</b>: 정량 반영이 아니라 참고용 수치입니다(대학 각주 참고).</li>" +
      "<li><b>정시 점수</b>: 대학별 환산점수·백분위 평균 등 기준이 제각각이므로 대학 간 숫자를 그대로 비교하면 안 됩니다.</li></ul></article>" +
      '<article class="card"><h2>경쟁률·충원율 읽는 법</h2><ul class="plain">' +
      "<li><b>경쟁률</b> = 정원내 지원자 ÷ 정원내 모집인원 (수시·정시 합산, 대학알리미 공시). 수시 6회 중복지원 때문에 실제 체감 경쟁보다 높게 나옵니다.</li>" +
      "<li><b>신입생 충원율</b> = 정원내 입학자 ÷ 정원내 모집인원. 100% 미만이면 미충원이 발생했다는 뜻입니다.</li>" +
      "<li><b>10년 추이</b>: 학과 신설·통폐합·명칭 변경 시 이전 연도 기록이 끊길 수 있습니다.</li></ul></article>" +
      '<article class="card"><h2>전문대학</h2><ul class="plain">' +
      "<li>전문대학은 수시 6회 제한이 없어 횟수 제한 없이 지원할 수 있습니다(정시도 횟수 제한 없음).</li>" +
      "<li>일반전형 외에 일반고·특성화고 졸업자 특별전형, 고른기회, 대학자체기준 등 전형이 다양합니다.</li>" +
      "<li>수시 합격자(등록 여부 무관)의 정시 지원 제한은 4년제와 전문대학 사이에도 적용됩니다. 해당 학년도 ‘대입전형 기본사항’을 꼭 확인하세요.</li></ul></article>" +
      "</div>" +
      '<h2 class="sub-head">고3 연간 흐름</h2><ol class="timeline">' +
      "<li><span>3월</span><div><b>3월 학력평가</b> · 대학별 전형시행계획(전년도 4월 발표) 확인</div></li>" +
      "<li><span>4~5월</span><div><b>대학별 수시 모집요강 발표</b> · 지난해 공식 입결 원문 비교</div></li>" +
      "<li><span>6월</span><div><b>6월 모의평가</b>(평가원)</div></li>" +
      "<li><span>9월</span><div><b>9월 모의평가 · 수시 원서접수</b></div></li>" +
      "<li><span>11월</span><div><b>대학수학능력시험</b> · 가채점으로 수시 최저·정시 지원선 판단</div></li>" +
      "<li><span>12월</span><div><b>수능 성적 통지 · 수시 합격자 발표 · 정시 원서접수(12월 말~1월 초)</b></div></li>" +
      "<li><span>1~2월</span><div><b>정시 합격자 발표 · 추가합격</b></div></li></ol>" +
      '<h2 class="sub-head">공식 정보 바로가기</h2><ul class="link-list">' +
      link("https://www.adiga.kr", "대학어디가 (한국대학교육협의회)", "대학별 입결·모집요강·성적분석 공식 포털") +
      link("https://www.academyinfo.go.kr", "대학알리미 (교육부)", "대학 정보공시 원자료") +
      link("https://www.procollege.kr", "전문대학포털 (한국전문대학교육협의회)", "전문대학 입시정보") +
      link("https://www.suneung.re.kr", "한국교육과정평가원 수능", "수능·모의평가 일정과 정답") +
      link("https://jinhak.gne.go.kr", "경남대입정보센터 (경상남도교육청)", "대학별 입시결과·모집요강 원문 모음") +
      "</ul></section>";
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

  /* ---------- 시작 ---------- */
  getJSON("data/index.json").then(function (j) {
    IDX = j;
    $("#footerSources").innerHTML = "데이터 기준: " + esc(j.meta.built) + "<br>" + j.meta.sources.map(function (s) { return esc(s.name); }).join("<br>");
    view.classList.remove("loading");
    route();
  }).catch(function (e) {
    view.innerHTML = '<div class="section"><h1>데이터를 불러오지 못했습니다</h1><p class="muted">' + esc(e.message) + "</p><p>웹서버(nginx 등)를 통해 접속해야 합니다. 파일을 직접 열면 동작하지 않습니다.</p></div>";
  });
})();
