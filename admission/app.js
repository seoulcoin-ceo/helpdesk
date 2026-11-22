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
    $all(".site-nav a").forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("data-nav") === parts[0]); });
    $(".site-nav").classList.remove("open");
    var p;
    switch (parts[0]) {
      case "univ": p = parts[1] ? pageUnivDetail(parts[1]) : pageUnivList(q); break;
      case "college": p = parts[1] ? pageCollegeDetail(parts[1]) : pageCollegeList(q); break;
      case "dept": p = pageDept(q); break;
      case "calc": p = pageCalc(); break;
      case "chance": p = pageChance(q); break;
      case "login": p = pageLogin(q); break;
      case "signup": p = pageSignup(); break;
      case "account": p = pageAccount(); break;
      case "child": p = pageChild(parts[1]); break;
      case "terms": p = pageTerms(); break;
      case "privacy": p = pagePrivacy(); break;
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
      card("#/chance", "4년제 기회 찾기", "등급이 낮아도 갈 수 있는 4년제: 최근 미달이 이어져 합격 가능성이 높은 대학·학과를 10년 공시 자료로 예측.") +
      card("#/univ", "4년제 대학", "대학별·학과별 10개년 모집인원, 지원자, 경쟁률, 충원율 추이와 대학 공식 입시결과·모집요강 원문.") +
      card("#/college", "전문대학", "전문대학 학과별 일반전형·일반고·특성화고 등 전형별 모집·지원·경쟁률.") +
      card("#/dept", "학과 찾기", "가고 싶은 학과를 개설한 전국 대학을 경쟁률·모집인원 순으로 비교.") +
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
      '<div class="tabs" role="tablist"><button type="button" data-tab="exam">모의고사·수능</button><button type="button" data-tab="gpa">학생부 내신</button><button type="button" data-tab="ged">검정고시</button></div></div>' +
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
      if (s.tab === "gpa") tabGpa(); else if (s.tab === "ged") tabGed(); else tabExam();
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

    head(); renderTab();
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
  function hasContent(s) { return !!(s && ((s.exams && s.exams.length) || (s.gpa && s.gpa.rows && s.gpa.rows.length) || (s.fav && s.fav.length))); }
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
    a.textContent = ME ? (ME.name || "내 계정") : "로그인";
    a.setAttribute("href", ME ? "#/account" : "#/login");
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
    var next = q.get("next") || "account";
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
        .then(function () { location.hash = "#/account"; }).catch(function (er) { $("#sErr").textContent = er.message; });
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
          '<div class="card"><h2>합격·불합격 결과</h2>' + (c.reports.length ? '<ul class="plain">' + c.reports.map(function (r) {
            return "<li>" + r.year + " " + esc(r.track) + " · " + esc(r.univ_name) + " " + esc(r.dept) + " — <b>" + esc(r.result) + "</b></li>";
          }).join("") + "</ul>" : '<p class="muted">없음</p>') + "</div></section>";
      }).catch(function (e) { view.innerHTML = '<section class="section"><p>' + esc(e.message) + "</p></section>"; });
    });
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
