/* ============================================================
 * gsheet.js — 구글시트(공개 gviz CSV) 데이터 접근 공통 모듈
 * 대시보드(index.html)와 KPI 플래너(kpi-planner.html)가 공유.
 * 전역 네임스페이스 window.GSheet 로 노출 (const 충돌 방지).
 *
 * 여기 한 곳만 고치면 두 페이지에 함께 반영됩니다.
 *  - 신규 프로젝트 코드 추가: KNOWN_CODES 에 추가
 *  - 날짜/숫자 포맷 인식 확대: normDate / toNum 수정
 * ============================================================ */
(function (global) {
  "use strict";

  // index 탭이 없을 때 존재 여부를 프로빙할 프로젝트 코드 후보 풀
  const KNOWN_CODES = ["POTC", "GBTW", "IMGN", "RESU", "WWM", "DS"];

  // 스프레드시트 URL + 탭 이름 → 해당 탭의 gviz CSV URL
  function tabCsvUrl(url, tab) {
    const m = String(url).match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!m) return null;
    return "https://docs.google.com/spreadsheets/d/" + m[1] +
      "/gviz/tq?tqx=out:csv&sheet=" + encodeURIComponent(tab);
  }

  // 일반 스프레드시트/게시 URL → 첫 탭(또는 gid) CSV URL
  function csvUrl(url) {
    url = String(url).trim();
    if (/gviz\/tq|output=csv/.test(url)) return url; // 이미 CSV 엔드포인트
    if (url.includes("/d/e/2PACX")) { // "웹에 게시" 링크
      if (/output=csv/.test(url)) return url;
      const base = url.split(/[?#]/)[0].replace(/\/pubhtml.*$/, "/pub").replace(/\/pub\/?$/, "/pub");
      const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1];
      return (base.endsWith("/pub") ? base : base + "/pub") + "?output=csv" + (gid ? "&gid=" + gid : "");
    }
    const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!m) return null;
    const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1];
    return "https://docs.google.com/spreadsheets/d/" + m[1] +
      "/gviz/tq?tqx=out:csv" + (gid ? "&gid=" + gid : "");
  }

  // RFC4180 CSV 파서 (따옴표·이스케이프·개행 처리)
  function parseCsv(text) {
    const rows = []; let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c !== "\r") field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // 문자열/숫자 → number (콤마·%·₩·원·공백 제거). 빈값/실패는 null
  function toNum(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return isNaN(v) ? null : v;
    const n = Number(String(v).replace(/[,%₩원\s]/g, ""));
    return isNaN(n) ? null : n;
  }

  // 다양한 날짜 표기 → "YYYY-MM-DD" (실패 시 null)
  function normDate(s) {
    const str = String(s || "").trim();
    let m = str.match(/(\d{4})[.\-\/\s]+(\d{1,2})[.\-\/\s]+(\d{1,2})/); // 2026-06-30 / 2026.6.30
    if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
    m = str.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})$/); // 06/30/2026 (미국식)
    if (m) return m[3] + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0");
    if (/^\d{4,5}(\.0+)?$/.test(str)) { // 엑셀 시리얼(예: 46203)
      const n = Number(str);
      if (n > 20000 && n < 80000) {
        const e = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
        return e.getUTCFullYear() + "-" + String(e.getUTCMonth() + 1).padStart(2, "0") + "-" + String(e.getUTCDate()).padStart(2, "0");
      }
    }
    const d = new Date(str); // "June 30, 2026" 등 영문
    if (!isNaN(d) && d.getFullYear() > 2000 && d.getFullYear() < 2100)
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    return null;
  }

  // 첫 행을 소문자 트림된 헤더 배열로
  function headerOf(grid) {
    return (grid[0] || []).map(h => String(h || "").trim().toLowerCase());
  }

  // 탭 CSV fetch → grid(2차원 배열). tq: gviz 쿼리(예: "limit 1"). 캐시 무효화 포함
  async function fetchTab(url, tab, tq) {
    const u = tabCsvUrl(url, tab);
    if (!u) throw new Error("시트 URL 형식을 인식하지 못했습니다.");
    const full = u + (tq ? "&tq=" + encodeURIComponent(tq) : "") + "&_t=" + Date.now();
    const res = await fetch(full, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return parseCsv(await res.text());
  }

  global.GSheet = { KNOWN_CODES, tabCsvUrl, csvUrl, parseCsv, toNum, normDate, headerOf, fetchTab };
})(window);
