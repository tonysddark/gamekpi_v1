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

  /* ---- 탭 응답 공유 캐시 --------------------------------------------
   * 같은 시트 탭을 여러 번 읽는 낭비를 막는다. 커스텀 보드처럼 한 화면에
   * 섹션(iframe)이 여러 개 있으면 각 섹션이 같은 탭을 따로 읽어 첫 로드가
   * 오래 걸리는데, 같은 출처의 iframe 은 최상위 창을 공유하므로 캐시를
   * 그 창에 둔다 (노션처럼 상위가 다른 출처면 자기 창으로 되돌아간다).
   *   · 메모리에만 둔다 — 새로고침(F5)하면 언제나 새로 읽는다
   *   · TTL 5분 · 진행 중인 요청은 하나로 합친다(동시 로드 중복 제거)
   *   · 사용자가 직접 누른 동기화는 GSheet.bust() 로 캐시를 비우고 읽는다
   * 캐시에는 원문 텍스트만 담고 파서는 매번 새로 돌린다 — 호출한 쪽이
   * grid 를 고쳐 써도 다른 화면에 번지지 않게 하려는 것. */
  const TTL = 300000;
  // 최상위 창에 붙일 공유 저장소 — 상위가 다른 출처면 자기 창으로 되돌아간다
  function shared(key, make) {
    try { const w = global.top; void w.document; return w[key] || (w[key] = make()); }
    catch (e) { return global[key] || (global[key] = make()); }
  }
  function cacheStore() { return shared("__GS_CACHE", () => new Map()); }
  function bust() { try { cacheStore().clear(); } catch (e) {} }

  /* 동시 요청 상한 — 섹션이 여러 개면 수십 개가 한꺼번에 나가 오히려 밀린다.
     화면(최상위 창) 단위로 자리를 나눠 쓴다. */
  const MAXC = 6;
  function queue() { return shared("__GS_Q", () => ({ n: 0, waiting: [] })); }
  function slot() {
    const q = queue();
    if (q.n < MAXC) { q.n++; return Promise.resolve(); }
    return new Promise(res => q.waiting.push(res));
  }
  function release() {
    const q = queue();
    const next = q.waiting.shift();
    if (next) next();        // 자리를 그대로 넘긴다 (n 유지)
    else q.n = Math.max(0, q.n - 1);
  }

  // 탭 CSV fetch → grid(2차원 배열). tq: gviz 쿼리(예: "limit 1"). opts.fresh=true 면 캐시 무시
  async function fetchTab(url, tab, tq, opts) {
    const u = tabCsvUrl(url, tab);
    if (!u) throw new Error("시트 URL 형식을 인식하지 못했습니다.");
    const key = u + "|" + (tq || "");
    const cache = cacheStore(), now = Date.now();
    let hit = (opts && opts.fresh) ? null : cache.get(key);
    if (hit && now - hit.t >= TTL) { cache.delete(key); hit = null; }
    if (!hit) {
      const full = u + (tq ? "&tq=" + encodeURIComponent(tq) : "") + "&_t=" + now;
      const p = slot()
        .then(() => fetch(full, { cache: "no-store" }))
        .then(res => { if (!res.ok) throw new Error("HTTP " + res.status); return res.text(); })
        .finally(release);
      hit = { t: now, p };
      cache.set(key, hit);
      // 실패는 캐시에 남기지 않는다 (다음 호출이 다시 시도할 수 있게)
      p.catch(() => { if (cache.get(key) === hit) cache.delete(key); });
    }
    return parseCsv(await hit.p);
  }

  /* ---- 섹션 임베드 → 부모 창에 지금 상태 알리기 -----------------------
   * 커스텀 보드(custom.html)가 카드의 🔗 로 URL 을 복사할 때, 사용자가
   * 섹션 안에서 바꾼 게임·기간 같은 옵션이 그대로 담기게 하려는 것.
   * 부모가 다른 출처(노션 등)면 조용히 넘어간다. */
  function postSecState(src, sec, params) {
    if (!sec) return;
    try {
      if (global.parent === global) return;
      global.parent.postMessage({ __d2c: "secState", src, sec, p: params }, global.location.origin);
    } catch (e) {}
  }

  global.GSheet = { KNOWN_CODES, tabCsvUrl, csvUrl, parseCsv, toNum, normDate, headerOf, fetchTab, bust, postSecState };
})(window);
