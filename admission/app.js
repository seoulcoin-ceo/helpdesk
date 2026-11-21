(function () {
  "use strict";

  var DATA = window.ADMISSION_DATA || { records: [] };
  var RECORDS = DATA.records || [];
  var STORE_KEY = "ipsi-compass-v1";

  /* ---------- 유틸 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function fmt(n, d) { return n == null ? "-" : n.toFixed(d == null ? 2 : d); }
  function uniq(arr) { return arr.filter(function (v, i) { return arr.indexOf(v) === i; }); }

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  var state = loadState();
  state.gpa = state.gpa || { system: "9", rows: [] };
  state.exam = state.exam || null;
  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 저장 불가 환경 */ }
  }

  /* ---------- 탭 / 내비게이션 ---------- */
  var TABS = ["home", "gpa", "exam", "recommend", "cutoff", "guide"];
  function showTab(name) {
    if (TABS.indexOf(name) < 0) name = "home";
    $all("[data-panel]").forEach(function (p) { p.hidden = p.getAttribute("data-panel") !== name; });
    $all(".site-nav a").forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("data-tab") === name); });
    $(".site-nav").classList.remove("open");
    $(".nav-toggle").setAttribute("aria-expanded", "false");
    if (name === "recommend") renderRecommend();
    if (name === "home") renderSummary();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", function () { showTab(location.hash.slice(1)); });
  $(".nav-toggle").addEventListener("click", function () {
    var nav = $(".site-nav");
    var open = nav.classList.toggle("open");
    this.setAttribute("aria-expanded", String(open));
  });

  /* ---------- 내신 계산 ---------- */
  var GROUPS = ["국어", "수학", "영어", "사회", "과학", "한국사", "기타"];
  var CORE = ["국어", "수학", "영어", "사회", "과학", "한국사"];
  var SEMS = ["1-1", "1-2", "2-1", "2-2", "3-1", "3-2"];

  function gpaRowHtml(r, i) {
    var max = state.gpa.system === "5" ? 5 : 9;
    return '<tr data-i="' + i + '">' +
      '<td><select data-k="sem">' + SEMS.map(function (s) { return '<option' + (s === r.sem ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select></td>" +
      '<td><select data-k="group">' + GROUPS.map(function (g) { return '<option' + (g === r.group ? " selected" : "") + ">" + g + "</option>"; }).join("") + "</select></td>" +
      '<td><input data-k="name" value="' + esc(r.name) + '" placeholder="과목명" /></td>' +
      '<td><input data-k="unit" type="number" min="1" max="10" step="1" inputmode="numeric" value="' + esc(r.unit) + '" /></td>' +
      '<td><input data-k="grade" type="number" min="1" max="' + max + '" step="1" inputmode="numeric" value="' + esc(r.grade) + '" /></td>' +
      '<td><button type="button" class="icon-btn" data-del aria-label="삭제">×</button></td></tr>';
  }

  function renderGpaRows() {
    var rows = state.gpa.rows;
    $("#gpaRows").innerHTML = rows.map(gpaRowHtml).join("");
    $("#gpaEmpty").hidden = rows.length > 0;
    $("#gradeSystem").value = state.gpa.system;
    renderGpaStats();
  }

  function weightedAvg(rows) {
    var sum = 0, units = 0;
    rows.forEach(function (r) {
      var g = num(r.grade), u = num(r.unit);
      if (g && u) { sum += g * u; units += u; }
    });
    return units ? { avg: sum / units, units: units } : null;
  }

  function gpaCalc() {
    var rows = state.gpa.rows;
    var pick = function (groups) { return rows.filter(function (r) { return groups.indexOf(r.group) >= 0; }); };
    return {
      all: weightedAvg(rows),
      core: weightedAvg(pick(["국어", "수학", "영어", "사회", "과학"])),
      kems: weightedAvg(pick(["국어", "수학", "영어", "과학"])),
      kemso: weightedAvg(pick(["국어", "수학", "영어", "사회"])),
      bySem: SEMS.map(function (s) { return { sem: s, v: weightedAvg(rows.filter(function (r) { return r.sem === s; })) }; })
    };
  }

  // 5등급제 평균을 9등급제 환산(누적비율 기준 근사)
  var P5 = [[1, 5], [2, 22], [3, 50], [4, 78], [5, 95]];
  var P9 = [[1, 2], [2, 7.5], [3, 17], [4, 31.5], [5, 50], [6, 68.5], [7, 83], [8, 92.5], [9, 98]];
  function interp(x, table, inIdx, outIdx) {
    if (x <= table[0][inIdx]) return table[0][outIdx];
    for (var i = 1; i < table.length; i++) {
      var a = table[i - 1], b = table[i];
      if (x <= b[inIdx]) return a[outIdx] + (x - a[inIdx]) * (b[outIdx] - a[outIdx]) / (b[inIdx] - a[inIdx]);
    }
    return table[table.length - 1][outIdx];
  }
  function to9(avg) {
    if (avg == null) return null;
    if (state.gpa.system !== "5") return avg;
    return interp(interp(avg, P5, 0, 1), P9, 1, 0);
  }

  function renderGpaStats() {
    var c = gpaCalc();
    var five = state.gpa.system === "5";
    function stat(label, v, primary) {
      var sub = v ? v.units + "단위" + (five ? " · 9등급 환산 " + fmt(to9(v.avg)) : "") : "입력 필요";
      return '<div class="stat' + (primary ? " primary" : "") + '"><span>' + label + "</span><strong>" + (v ? fmt(v.avg) : "-") + "</strong><small>" + sub + "</small></div>";
    }
    $("#gpaStats").innerHTML =
      stat("국영수사과 평균", c.core, true) + stat("전과목 평균", c.all) +
      stat("국영수과 평균", c.kems) + stat("국영수사 평균", c.kemso);

    var max = five ? 5 : 9;
    var bars = c.bySem.filter(function (s) { return s.v; }).map(function (s) {
      var pct = Math.max(4, (max + 1 - s.v.avg) / max * 100);
      return '<div class="sem-bar"><span>' + s.sem + '학기</span><div class="track"><div class="fill" style="width:' + pct + '%"></div></div><b>' + fmt(s.v.avg) + "</b></div>";
    }).join("");
    $("#gpaBySem").innerHTML = '<h2 style="font-size:1.05rem">학기별 추이 (전과목)</h2>' +
      (bars ? '<div class="sem-bars">' + bars + "</div>" : '<p class="note">입력된 과목이 없습니다.</p>') +
      (five ? '<p class="note">5등급제 성적은 9등급제 입결과 비교하기 위해 누적비율 기준으로 근사 환산하여 추천에 사용합니다. 실제 대학별 반영 방식은 모집요강을 확인하세요.</p>' : "");
  }

  $("#gpaRows").addEventListener("input", function (e) {
    var tr = e.target.closest("tr"); var k = e.target.getAttribute("data-k");
    if (!tr || !k) return;
    state.gpa.rows[+tr.getAttribute("data-i")][k] = e.target.value;
    saveState(); renderGpaStats();
  });
  $("#gpaRows").addEventListener("click", function (e) {
    if (!e.target.hasAttribute("data-del")) return;
    state.gpa.rows.splice(+e.target.closest("tr").getAttribute("data-i"), 1);
    saveState(); renderGpaRows();
  });
  $("#gpaAddRow").addEventListener("click", function () {
    var last = state.gpa.rows[state.gpa.rows.length - 1];
    state.gpa.rows.push({ sem: last ? last.sem : "1-1", group: "국어", name: "", unit: 4, grade: "" });
    saveState(); renderGpaRows();
    var inputs = $all("#gpaRows tr:last-child input"); if (inputs[0]) inputs[0].focus();
  });
  $("#gpaClear").addEventListener("click", function () {
    if (!state.gpa.rows.length || confirm("입력한 과목을 모두 삭제할까요?")) { state.gpa.rows = []; saveState(); renderGpaRows(); }
  });
  $("#gpaSample").addEventListener("click", function () {
    var five = state.gpa.system === "5";
    var base = [["국어", "국어", 4], ["수학", "수학", 4], ["영어", "영어", 4], ["사회", "통합사회", 3], ["과학", "통합과학", 3], ["한국사", "한국사", 3]];
    var rows = [];
    ["1-1", "1-2", "2-1", "2-2", "3-1"].forEach(function (s, si) {
      base.forEach(function (b, bi) {
        var g = five ? 1 + ((si + bi) % 3 === 0 ? 1 : 0) : 2 + ((si + bi) % 3) - (si > 2 ? 1 : 0);
        rows.push({ sem: s, group: b[0], name: b[1], unit: b[2], grade: Math.max(1, g) });
      });
    });
    state.gpa.rows = rows; saveState(); renderGpaRows();
  });
  $("#gradeSystem").addEventListener("change", function () {
    state.gpa.system = this.value; saveState(); renderGpaRows();
  });

  /* ---------- 모의고사 / 수능 ---------- */
  var EXAM_NAMES = { suneung: "수능 가채점", sep: "9월 모의평가", jun: "6월 모의평가", mar: "3월 학력평가", etc: "기타 학력평가" };
  function engGrade(raw) { if (raw == null) return null; return Math.min(9, Math.max(1, 10 - Math.floor(raw / 10))); }
  function histGrade(raw) { if (raw == null) return null; if (raw >= 40) return 1; return Math.min(9, 1 + Math.ceil((40 - raw) / 5)); }
  var ENG_PENALTY = [0, 0, 0.5, 1.5, 3, 5, 7, 9, 11, 13];
  var WEIGHTS = { "인문": { k: 0.4, m: 0.3, t: 0.3 }, "자연": { k: 0.3, m: 0.4, t: 0.3 } };

  function examCalc(ex) {
    if (!ex) return null;
    var k = num(ex.kor), m = num(ex.math), t1 = num(ex.t1), t2 = num(ex.t2);
    var eg = engGrade(num(ex.eng)), hg = histGrade(num(ex.hist));
    if (k == null || m == null || (t1 == null && t2 == null)) return { eg: eg, hg: hg, score: null };
    var t = t1 != null && t2 != null ? (t1 + t2) / 2 : (t1 != null ? t1 : t2);
    var w = WEIGHTS[ex.field] || WEIGHTS["인문"];
    var raw = k * w.k + m * w.m + t * w.t;
    var pen = (eg ? ENG_PENALTY[eg] : 0) + (hg && hg > 4 ? (hg - 4) * 0.3 : 0);
    return { eg: eg, hg: hg, raw: raw, pen: pen, score: Math.max(0, raw - pen), t: t };
  }

  var form = $("#examForm");
  function fillExamForm() {
    if (!state.exam) return;
    Object.keys(state.exam).forEach(function (k) { if (form.elements[k]) form.elements[k].value = state.exam[k]; });
  }
  function readExamForm() {
    var o = {};
    ["exam", "field", "kor", "math", "eng", "hist", "t1name", "t1", "t2name", "t2"].forEach(function (k) { o[k] = form.elements[k].value; });
    // 범위 보정
    ["kor", "math", "eng", "t1", "t2"].forEach(function (k) { var v = num(o[k]); if (v != null) o[k] = String(Math.min(100, Math.max(0, v))); });
    var h = num(o.hist); if (h != null) o.hist = String(Math.min(50, Math.max(0, h)));
    return o;
  }
  function renderExam() {
    var ex = readExamForm();
    var c = examCalc(ex);
    $("#engGrade").textContent = c && c.eg ? c.eg + "등급" : "-";
    $("#histGrade").textContent = c && c.hg ? c.hg + "등급" : "-";
    var saved = examCalc(state.exam);
    if (!saved || saved.score == null) { $("#examStats").innerHTML = ""; return; }
    $("#examStats").innerHTML =
      '<div class="stat primary"><span>국수탐 환산 백분위 (' + esc(state.exam.field) + ')</span><strong>' + fmt(saved.score, 1) + "</strong><small>" + esc(EXAM_NAMES[state.exam.exam]) + "</small></div>" +
      '<div class="stat"><span>가중 평균(감점 전)</span><strong>' + fmt(saved.raw, 1) + "</strong><small>영어·한국사 감점 −" + fmt(saved.pen, 1) + "</small></div>" +
      '<div class="stat"><span>탐구 평균 백분위</span><strong>' + fmt(saved.t, 1) + "</strong><small>" + esc([state.exam.t1name, state.exam.t2name].filter(Boolean).join(" · ") || "탐구 2과목") + "</small></div>" +
      '<div class="stat"><span>영어 / 한국사</span><strong>' + (saved.eg || "-") + " / " + (saved.hg || "-") + "</strong><small>등급</small></div>";
  }
  form.addEventListener("input", renderExam);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var ex = readExamForm();
    var c = examCalc(ex);
    if (!c || c.score == null) { alert("국어·수학 백분위와 탐구 백분위(1과목 이상)를 입력해주세요."); return; }
    state.exam = ex; saveState(); fillExamForm(); renderExam();
    location.hash = "#recommend";
  });
  $("#examReset").addEventListener("click", function () {
    form.reset(); state.exam = null; saveState(); renderExam();
  });

  /* ---------- 요약 ---------- */
  function renderSummary() {
    var c = gpaCalc();
    var sfx = state.gpa.system === "5" ? " (5등급제)" : "";
    $("#sumGpaAll").textContent = c.all ? fmt(c.all.avg) + "등급" + sfx : "미입력";
    $("#sumGpaCore").textContent = c.core ? fmt(c.core.avg) + "등급" + sfx : "미입력";
    var e = examCalc(state.exam);
    $("#sumExamName").textContent = state.exam ? EXAM_NAMES[state.exam.exam] + " · " + state.exam.field : "미입력";
    $("#sumExamPct").textContent = e && e.score != null ? fmt(e.score, 1) : "미입력";
    $("#sumExamEng").textContent = e && (e.eg || e.hg) ? (e.eg || "-") + "등급 / " + (e.hg || "-") + "등급" : "미입력";
  }

  /* ---------- 추천 ---------- */
  var recMode = "susi";
  var YEARS = uniq(RECORDS.map(function (r) { return r.year; })).sort(function (a, b) { return b - a; });
  var YEAR_W = [0.5, 0.3, 0.2];

  // 대학+학과 단위로 묶고 연도별 가중평균 컷 계산
  function groupPrograms() {
    var map = {};
    RECORDS.forEach(function (r) {
      var key = r.univ + "|" + r.major;
      (map[key] = map[key] || { univ: r.univ, major: r.major, field: r.field, region: r.region, years: {} }).years[r.year] = r;
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }
  var PROGRAMS = groupPrograms();

  function wavg(p, field) {
    var s = 0, w = 0;
    YEARS.forEach(function (y, i) {
      var r = p.years[y]; var v = r ? num(r[field]) : null;
      if (v != null && i < YEAR_W.length) { s += v * YEAR_W[i]; w += YEAR_W[i]; }
    });
    return w ? s / w : null;
  }

  function classify(diff, mode) {
    var t = mode === "susi" ? [0.3, 0, -0.3, -0.7] : [1.5, 0, -1.5, -3];
    if (diff >= t[0]) return "safe";
    if (diff >= t[1]) return "fit";
    if (diff >= t[2]) return "reach";
    if (diff >= t[3]) return "up";
    return null;
  }

  var COLS = [["safe", "안정"], ["fit", "적정"], ["reach", "소신"], ["up", "상향"]];
  var expanded = {};

  function renderRecommend() {
    var field = $("#recField").value, region = $("#recRegion").value, q = $("#recMajor").value.trim();
    var my = null, myLabel = "", unitLabel;
    var c = gpaCalc(), e = examCalc(state.exam);

    if (recMode === "susi") {
      var basis = $("#recGpaBasis").value;
      var g = basis === "all" ? c.all : c.core;
      if (g) {
        my = to9(g.avg);
        myLabel = "내 내신 (" + (basis === "all" ? "전과목" : "국영수사과") + ") <b>" + fmt(g.avg) + "등급</b>" +
          (state.gpa.system === "5" ? ' <span class="note">→ 9등급 환산 ' + fmt(my) + "</span>" : "");
      }
      unitLabel = "등급";
    } else {
      if (e && e.score != null) {
        my = e.score;
        myLabel = "내 수능 환산 백분위 <b>" + fmt(my, 1) + "</b> <span class=\"note\">" + esc(EXAM_NAMES[state.exam.exam]) + " · " + esc(state.exam.field) + "</span>";
        if (!field) field = state.exam.field;
      }
      unitLabel = "백분위";
    }
    $("#recGpaBasis").closest("label").hidden = recMode !== "susi";

    if (my == null) {
      $("#recMyScore").innerHTML = '<span class="note">' + (recMode === "susi" ? "내신 성적" : "모의고사·수능 성적") + "을 먼저 입력해주세요.</span>";
      $("#recResults").innerHTML = '<div class="callout">' + (recMode === "susi"
        ? '내신 등급을 입력하면 학생부교과 전형 추천 결과가 표시됩니다.<br /><a class="btn btn-primary" href="#gpa">내신 입력하기</a>'
        : '모의고사 또는 수능 가채점 백분위를 입력하면 정시 추천 결과가 표시됩니다.<br /><a class="btn btn-primary" href="#exam">성적 입력하기</a>') + "</div>";
      return;
    }
    $("#recMyScore").innerHTML = "<span>" + myLabel + "</span><span class=\"note\">비교 기준: 최근 " + YEARS.slice(0, 3).join("·") + "학년도 70%컷 가중평균</span>" +
      (recMode === "jungsi" && !$("#recField").value ? '<span class="note">계열 필터: ' + esc(field) + " (입력한 계열 기준)</span>" : "");

    var buckets = { safe: [], fit: [], reach: [], up: [] };
    PROGRAMS.forEach(function (p) {
      if (field && p.field !== field) return;
      if (region && p.region !== region) return;
      if (q && p.major.indexOf(q) < 0 && p.univ.indexOf(q) < 0) return;
      var cut = wavg(p, recMode === "susi" ? "susiCut70" : "jungsiCut70");
      if (cut == null) return;
      var diff = recMode === "susi" ? cut - my : my - cut;
      var cls = classify(diff, recMode);
      if (cls) buckets[cls].push({ p: p, cut: cut, diff: diff });
    });

    $("#recResults").innerHTML = COLS.map(function (col) {
      var list = buckets[col[0]].sort(function (a, b) { return a.diff - b.diff; });
      var limit = expanded[col[0]] ? list.length : 8;
      var items = list.slice(0, limit).map(function (it) {
        var latest = it.p.years[YEARS[0]] || {};
        var rate = recMode === "susi" ? latest.susiRate : latest.jungsiRate;
        var extra = recMode === "susi" ? "교과 " + (latest.susiQuota || "-") + "명" : (latest.jungsiGun || "-") + "군 " + (latest.jungsiQuota || "-") + "명";
        var sign = it.diff >= 0 ? "+" : "−";
        return '<div class="rec-item"><div class="top"><strong>' + esc(it.p.univ) + '</strong><span class="meta">' + esc(it.p.region) + "</span></div>" +
          "<div>" + esc(it.p.major) + ' <span class="meta">· ' + esc(it.p.field) + " · " + esc(extra) + "</span></div>" +
          '<div class="nums"><span>70%컷 ' + fmt(it.cut, recMode === "susi" ? 2 : 1) + unitLabel + (rate ? " · " + rate + ":1" : "") + '</span><span class="diff">' + sign + fmt(Math.abs(it.diff), recMode === "susi" ? 2 : 1) + "</span></div></div>";
      }).join("");
      var more = list.length > 8 ? '<button type="button" class="btn btn-ghost more-btn" data-more="' + col[0] + '">' + (expanded[col[0]] ? "접기" : "더보기 (" + (list.length - 8) + ")") + "</button>" : "";
      return '<div class="rec-col ' + col[0] + '"><h2>' + col[1] + "<span>" + list.length + "</span></h2>" +
        '<div class="rec-list">' + (items || '<div class="rec-empty">해당 없음</div>') + "</div>" + more + "</div>";
    }).join("");
  }

  $all(".seg-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      recMode = b.getAttribute("data-mode"); expanded = {};
      $all(".seg-btn").forEach(function (x) {
        var on = x === b; x.classList.toggle("is-active", on); x.setAttribute("aria-selected", String(on));
      });
      renderRecommend();
    });
  });
  ["#recGpaBasis", "#recField", "#recRegion"].forEach(function (s) { $(s).addEventListener("change", renderRecommend); });
  $("#recMajor").addEventListener("input", renderRecommend);
  $("#recResults").addEventListener("click", function (e) {
    var k = e.target.getAttribute("data-more");
    if (k) { expanded[k] = !expanded[k]; renderRecommend(); }
  });

  /* ---------- 입결 조회 ---------- */
  var sortKey = "univ", sortDir = 1, openKey = null;
  var UNIVS = uniq(RECORDS.map(function (r) { return r.univ; }));
  var REGIONS = uniq(RECORDS.map(function (r) { return r.region; }));

  $("#cutUniv").innerHTML += UNIVS.map(function (u) { return "<option>" + esc(u) + "</option>"; }).join("");
  $("#recRegion").innerHTML += REGIONS.map(function (u) { return "<option>" + esc(u) + "</option>"; }).join("");
  $("#cutYear").innerHTML = YEARS.map(function (y) { return '<option value="' + y + '">' + y + "학년도</option>"; }).join("");

  function trendSvg(p, field, label, digits, invert) {
    var pts = YEARS.slice().reverse().map(function (y) { return { y: y, v: p.years[y] ? num(p.years[y][field]) : null }; }).filter(function (d) { return d.v != null; });
    if (!pts.length) return "";
    var vals = pts.map(function (d) { return d.v; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = (hi - lo) * 0.3 || (invert ? 0.1 : 0.5); lo -= pad; hi += pad;
    var W = 300, H = 120, L = 30, R = 30, T = 22, B = 24;
    var x = function (i) { return pts.length === 1 ? W / 2 : L + i * (W - L - R) / (pts.length - 1); };
    // 등급은 낮을수록 좋으므로 invert 시 위쪽이 좋은 값
    var yv = function (v) { var t = (v - lo) / (hi - lo); return invert ? T + t * (H - T - B) : H - B - t * (H - T - B); };
    var path = pts.map(function (d, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + yv(d.v).toFixed(1); }).join(" ");
    return '<div><h4>' + label + '</h4><svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(label) + ' 추이">' +
      '<line class="axis" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '" />' +
      '<path class="line" d="' + path + '" />' +
      pts.map(function (d, i) {
        return '<circle class="pt" cx="' + x(i) + '" cy="' + yv(d.v) + '" r="4" />' +
          '<text class="val" x="' + x(i) + '" y="' + (yv(d.v) - 9) + '" text-anchor="middle">' + d.v.toFixed(digits) + "</text>" +
          '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + d.y + "</text>";
      }).join("") + "</svg></div>";
  }

  function renderCutoff() {
    var u = $("#cutUniv").value, q = $("#cutMajor").value.trim(), f = $("#cutField").value, y = +$("#cutYear").value;
    var rows = RECORDS.filter(function (r) {
      return r.year === y && (!u || r.univ === u) && (!f || r.field === f) && (!q || r.major.indexOf(q) >= 0);
    });
    rows.sort(function (a, b) {
      var A = a[sortKey], B = b[sortKey];
      if (typeof A === "number" && typeof B === "number") return (A - B) * sortDir;
      return String(A).localeCompare(String(B), "ko") * sortDir || a.major.localeCompare(b.major, "ko");
    });
    var progMap = {};
    PROGRAMS.forEach(function (p) { progMap[p.univ + "|" + p.major] = p; });

    $("#cutRows").innerHTML = rows.map(function (r) {
      var key = r.univ + "|" + r.major;
      var html = '<tr data-key="' + esc(key) + '"><td><b>' + esc(r.univ) + "</b></td><td>" + esc(r.major) + "</td><td>" + esc(r.field) + "</td>" +
        '<td class="num">' + fmt(r.susiRate, 1) + ':1</td><td class="num">' + fmt(r.susiCut50) + '</td><td class="num"><b>' + fmt(r.susiCut70) + "</b></td>" +
        "<td>" + esc(r.jungsiGun) + '군</td><td class="num">' + fmt(r.jungsiRate, 1) + ':1</td><td class="num"><b>' + fmt(r.jungsiCut70, 1) + "</b></td></tr>";
      if (key === openKey) {
        var p = progMap[key];
        html += '<tr class="trend-row"><td colspan="9"><div class="trend">' +
          trendSvg(p, "susiCut70", "학생부교과 70%컷 (등급)", 2, true) +
          trendSvg(p, "susiRate", "학생부교과 경쟁률", 1, false) +
          trendSvg(p, "jungsiCut70", "정시 백분위 70%컷", 1, false) +
          "</div></td></tr>";
      }
      return html;
    }).join("");
    $("#cutEmpty").hidden = rows.length > 0;
    $("#cutCount").textContent = y + "학년도 · " + rows.length + "개 모집단위";
    $all(".cut-table th[data-sort]").forEach(function (th) {
      th.classList.toggle("sorted-asc", th.getAttribute("data-sort") === sortKey && sortDir === 1);
      th.classList.toggle("sorted-desc", th.getAttribute("data-sort") === sortKey && sortDir === -1);
    });
  }
  ["#cutUniv", "#cutField", "#cutYear"].forEach(function (s) { $(s).addEventListener("change", renderCutoff); });
  $("#cutMajor").addEventListener("input", renderCutoff);
  $all(".cut-table th[data-sort]").forEach(function (th) {
    th.addEventListener("click", function () {
      var k = th.getAttribute("data-sort");
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
      renderCutoff();
    });
  });
  $("#cutRows").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-key]"); if (!tr) return;
    var k = tr.getAttribute("data-key");
    openKey = openKey === k ? null : k; renderCutoff();
  });

  /* ---------- 초기화 ---------- */
  $("#sampleBanner").hidden = !DATA.isSample;
  $("#dataUpdated").textContent = DATA.updated || "-";
  renderGpaRows();
  fillExamForm();
  renderExam();
  renderCutoff();
  showTab(location.hash.slice(1) || "home");
})();
