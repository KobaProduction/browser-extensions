// ==UserScript==
// @name         Koba Browser Tools
// @namespace    https://github.com/KobaProduction/browser-extensions
// @version      0.3.0
// @description  Reusable Koba Browser Tools / Koba Browser Tools
// @homepageURL   https://github.com/KobaProduction/browser-extensions
// @updateURL    https://raw.githubusercontent.com/KobaProduction/browser-extensions/distribution/userscripts/all-in-one.user.js
// @downloadURL  https://raw.githubusercontent.com/KobaProduction/browser-extensions/distribution/userscripts/all-in-one.user.js
// @match        https://vk.ru/im*
// @match        https://vk.com/im*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @sandbox      raw
// ==/UserScript==

(() => {
  // packages/ui/src/theme.ts
  var brandMark = `<svg viewBox="0 0 44 44" width="28" height="28" fill="none" aria-hidden="true">
<rect x="1" y="1" width="42" height="42" rx="12" fill="#315AA7"/>
<path d="M13 13v18m18-18L18.8 25.2M24 13l-11 11 11 7" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="31" cy="13" r="2.8" fill="#B9DBFF"/></svg>`;
  var classicThemeCss = `
:host {
  all: initial; color-scheme: light;
  --kb-bg:#fff;--kb-bg-soft:#f6f8fc;--kb-ink:#182337;
  --kb-ink-light:#54627a;--kb-accent:#315aa7;--kb-border:#e1e6f0;
  --kb-shadow:0 22px 80px rgb(16 34 63 / 19%),0 4px 14px rgb(16 34 63 / 8%);
  font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  color:var(--kb-ink);
}
*,*::before,*::after{box-sizing:border-box}
:host([hidden]){display:none!important}
[hidden]{display:none!important}
button,input,select{font:inherit}
button{cursor:pointer}
button:disabled{opacity:.46;cursor:not-allowed}
button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #82a9f3;outline-offset:2px}
.kb-window{background:var(--kb-bg);color:var(--kb-ink);border:1px solid var(--kb-border);border-radius:18px;box-shadow:var(--kb-shadow);overflow:hidden;max-height:min(88vh,850px)}
.kb-window-body{padding:22px 24px;overflow-y:auto;max-height:calc(88vh - 145px)}
.kb-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 22px;border-bottom:1px solid var(--kb-border);background:linear-gradient(110deg,var(--kb-bg) 65%,var(--kb-bg-soft))}
.kb-brand{display:flex;align-items:center;gap:11px;min-width:0}
.kb-mark{display:flex;align-items:center;flex:none}
.kb-brand-copy{min-width:0}
.kb-eyebrow{font-size:10px;letter-spacing:.105em;font-weight:800;text-transform:uppercase;color:var(--kb-accent)}
.kb-title{font-size:17px;line-height:1.26;letter-spacing:-.025em;font-weight:730;margin:3px 0 0;color:var(--kb-ink)}
.kb-icon-button{border:1px solid var(--kb-border);background:var(--kb-bg);color:var(--kb-ink-light);border-radius:9px;width:35px;height:35px;display:inline-flex;justify-content:center;align-items:center;flex:none}
.kb-icon-button:hover{background:var(--kb-bg-soft);color:var(--kb-ink)}
.kb-section{margin-top:21px}
.kb-section:first-child{margin-top:0}
.kb-section-title{font-size:12px;font-weight:780;letter-spacing:.065em;text-transform:uppercase;color:var(--kb-ink-light);margin:0 0 10px}
.kb-description{color:var(--kb-ink-light);font-size:12px;line-height:1.55;margin:6px 0 0}
.kb-row{display:flex;gap:10px;align-items:center;justify-content:space-between}
.kb-row+.kb-row{margin-top:9px}
.kb-muted{color:var(--kb-ink-light);font-size:12px}
.kb-card{background:var(--kb-bg-soft);border:1px solid var(--kb-border);border-radius:12px;padding:14px}
.kb-card+.kb-card{margin-top:10px}
.kb-label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:640;color:var(--kb-ink-light);min-width:0}
.kb-input,.kb-select{width:100%;background:var(--kb-bg);color:var(--kb-ink);border:1px solid #cdd5e2;border-radius:9px;padding:10px 11px;min-height:40px;min-width:0;font-size:13px;outline-offset:2px}
.kb-input:hover,.kb-select:hover{border-color:#92a8d3}
.kb-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.kb-grid-wide{grid-template-columns:minmax(0,1.75fr) minmax(0,1fr)}
.kb-button{border:1px solid var(--kb-border);background:var(--kb-bg);color:var(--kb-ink);border-radius:9px;min-height:38px;padding:9px 13px;font-weight:660;font-size:13px;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:7px}
.kb-button:hover:not(:disabled){background:var(--kb-bg-soft);border-color:#becde7}
.kb-button-primary{color:#fff;background:var(--kb-accent);border-color:var(--kb-accent)}
.kb-button-primary:hover:not(:disabled){background:#264b91;border-color:#264b91}
.kb-button-link{border-color:transparent;background:transparent;color:var(--kb-accent)}
.kb-pill{border-radius:999px;border:1px solid var(--kb-border);padding:4px 9px;font-size:11px;font-weight:650;color:var(--kb-ink-light);white-space:nowrap;background:var(--kb-bg)}
.kb-pill-good{background:#e8f6ef;color:#176745;border-color:#cbe8d9}
.kb-divider{border-top:1px solid var(--kb-border);margin:18px 0}
.kb-progress-track{height:9px;background:#e7edf6;border-radius:99px;overflow:hidden}
.kb-progress-fill{height:100%;width:0;background:var(--kb-accent);border-radius:inherit;transition:width 180ms ease}
.kb-stat-number{font-size:23px;line-height:1.15;font-weight:760;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.kb-stat-label{color:var(--kb-ink-light);font-size:11px;margin-top:4px}
.kb-footer{padding:12px 22px;border-top:1px solid var(--kb-border);background:var(--kb-bg-soft);color:var(--kb-ink-light);font-size:11px}
.kb-error{color:#af2734;font-size:12px;white-space:pre-wrap}
.kb-checkbox{accent-color:var(--kb-accent)}
.kb-details{border:1px solid var(--kb-border);border-radius:11px;padding:12px 13px}
.kb-details summary{cursor:pointer;color:var(--kb-ink);font-size:13px;font-weight:670}
.kb-details[open] summary{margin-bottom:13px}
@media(prefers-color-scheme:dark){
  :host{color-scheme:dark;--kb-bg:#1d2736;--kb-bg-soft:#253246;--kb-ink:#edf2fb;--kb-ink-light:#abb9d0;--kb-accent:#92b5f7;--kb-border:#3a4a62;--kb-shadow:0 22px 80px rgb(0 0 0 / 38%)}
  .kb-input,.kb-select{border-color:#4a5d79}
  .kb-button-primary{background:#577ece;border-color:#577ece;color:#fff}
  .kb-button-primary:hover:not(:disabled){background:#4c72bf;border-color:#4c72bf}
  .kb-pill-good{background:#183f32;color:#a0e5c4;border-color:#295540}
  .kb-progress-track{background:#34455d}
}
@media(max-width:520px){
  .kb-header{padding:14px 16px}
  .kb-window-body{padding:16px}
  .kb-footer{padding:11px 16px}
  .kb-grid,.kb-grid-wide{grid-template-columns:1fr}
}
`;

  // packages/ui/src/index.ts
  var localCss = `
.kb-shell{position:fixed;bottom:20px;right:20px;pointer-events:auto;z-index:2147483647}
.kb-control{width:min(440px,calc(100vw - 30px))}
.kb-feature-head{display:flex;gap:10px;justify-content:space-between;align-items:center}
.kb-feature-name{font-size:14px;font-weight:730;line-height:1.3}
.kb-feature-description{margin:6px 0 11px;color:var(--kb-ink-light);font-size:12px}
.kb-feature-actions{display:flex;align-items:center;gap:11px;justify-content:space-between}
.kb-toggle{appearance:none;width:38px;height:22px;border-radius:22px;background:#cbd4e4;position:relative;cursor:pointer;transition:background .15s}
.kb-toggle::before{content:'';position:absolute;background:#fff;top:3px;left:3px;width:16px;height:16px;border-radius:50%;transition:transform .15s}
.kb-toggle:checked{background:var(--kb-accent)}
.kb-toggle:checked::before{transform:translateX(16px)}
.kb-toggle:disabled{opacity:.4}
.kb-launcher{display:flex;align-items:center;gap:9px;margin-left:auto;background:var(--kb-accent);color:#fff;border:0;padding:9px 15px;border-radius:13px;box-shadow:0 8px 24px rgb(30 62 110 / 23%);font-size:12px;font-weight:690}
.kb-launcher svg{width:20px;height:20px}
.kb-empty{padding:22px 5px;text-align:center;color:var(--kb-ink-light);font-size:13px}
@media(max-width:520px){.kb-shell{bottom:12px;right:12px}.kb-control{width:calc(100vw - 24px)}}
`;
  function element(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className)
      node.className = className;
    if (text)
      node.textContent = text;
    return node;
  }
  function mountControlCenter(options) {
    document.getElementById("koba-browser-tools-root")?.remove();
    const host = element("div");
    host.id = "koba-browser-tools-root";
    host.style.cssText = "position:fixed;inset:0;width:0;height:0;z-index:2147483646;pointer-events:none";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = "<style>" + classicThemeCss + localCss + "</style>";
    const shell = element("section", "kb-shell");
    const panel = element("article", "kb-window kb-control");
    const header = element("header", "kb-header");
    const brand = element("div", "kb-brand");
    const mark = element("span", "kb-mark");
    mark.innerHTML = brandMark;
    const brandCopy = element("div", "kb-brand-copy");
    brandCopy.append(element("div", "kb-eyebrow", "Koba tools"));
    brandCopy.append(element("h2", "kb-title", options.title ?? "Browser Tools"));
    brand.append(mark, brandCopy);
    const closeButton = element("button", "kb-icon-button", "×");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Закрыть центр управления");
    header.append(brand, closeButton);
    const body = element("div", "kb-window-body");
    const summary = element("p", "kb-description");
    summary.style.marginTop = "0";
    const list = element("div", "kb-section");
    body.append(summary, list);
    const footer = element("footer", "kb-footer", "Модули управляются независимо · данные остаются в браузере");
    panel.append(header, body, footer);
    panel.hidden = true;
    shell.append(panel);
    const launcher = element("button", "kb-launcher");
    launcher.type = "button";
    launcher.innerHTML = '<span aria-hidden="true">' + brandMark + "</span><span>Инструменты</span>";
    launcher.hidden = !options.launcher;
    shell.append(launcher);
    shadow.append(shell);
    document.documentElement.append(host);
    let opened = false;
    function render() {
      panel.hidden = !opened;
      const statuses = options.runtime.list();
      const active = statuses.filter((item) => item.state === "active").length;
      summary.textContent = "Для этого сайта: " + active + " из " + statuses.length + " модулей готовы к работе.";
      list.replaceChildren();
      if (!statuses.length) {
        list.append(element("p", "kb-empty", "Здесь пока нет доступных модулей"));
        return;
      }
      for (const item of statuses)
        list.append(renderFeature(item));
    }
    function renderFeature(item) {
      const card = element("section", "kb-card");
      const head = element("div", "kb-feature-head");
      head.append(element("strong", "kb-feature-name", item.title));
      const badge = element("span", "kb-pill" + (item.state === "active" ? " kb-pill-good" : ""));
      badge.textContent = item.state === "active" ? "Готово" : item.state === "disabled" ? "Выключен" : item.state === "unsupported" ? "Недоступен" : "Ошибка";
      badge.title = item.reason ?? "";
      head.append(badge);
      const description = element("p", "kb-feature-description", item.reason && item.state === "failed" ? item.reason : item.description);
      const actions = element("div", "kb-feature-actions");
      const toggleLabel = element("label", "kb-row");
      const toggle = element("input", "kb-toggle");
      toggle.type = "checkbox";
      toggle.checked = item.state !== "disabled";
      toggle.disabled = item.state === "unsupported";
      toggle.setAttribute("aria-label", "Включить " + item.title);
      const toggleText = element("span", "kb-muted", "Включён");
      toggle.onchange = async () => {
        toggle.disabled = true;
        try {
          await options.runtime.setEnabled(item.id, toggle.checked);
        } finally {
          render();
        }
      };
      toggleLabel.append(toggle, toggleText);
      const openButton = element("button", "kb-button kb-button-primary", "Открыть модуль");
      openButton.type = "button";
      openButton.disabled = item.state !== "active";
      openButton.onclick = () => {
        close();
        options.runtime.open(item.id);
      };
      actions.append(toggleLabel, openButton);
      card.append(head, description, actions);
      return card;
    }
    function open() {
      opened = true;
      render();
    }
    function close() {
      opened = false;
      panel.hidden = true;
    }
    const onKeyDown = (event) => {
      if (event.key === "Escape" && opened)
        close();
    };
    document.addEventListener("keydown", onKeyDown);
    closeButton.onclick = close;
    launcher.onclick = () => opened ? close() : open();
    render();
    return {
      open,
      close,
      destroy() {
        document.removeEventListener("keydown", onKeyDown);
        host.remove();
      }
    };
  }

  // modules/vk-booster/src/archive-runtime.js
  function installVkArchive() {
    const VERSION = "2.2.0", GLOBAL = "VKExport";
    if (globalThis[GLOBAL]?.version === VERSION)
      return;
    const initialPeer = () => Number(location.pathname.match(/\/im\/convo\/(\d+)/)?.[1]) || 0;
    const cfg = { peerId: initialPeer(), mode: "recent", limit: 10, from: "", through: "", pageSize: 50, delay: 450, media: true };
    let root = null, meta = null, rows = [], token = "", busy = false, stopRequested = false, box = null;
    let prog = { phase: "Ожидание", done: 0, total: 0, newCount: 0, downloaded: 0, failed: 0 };
    let uiError = "";
    const ts = () => new Date().toISOString(), sleep = (ms) => globalThis.__VK_EXPORT_TEST_MODE ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const validDay = (d) => !d || /^\d{4}-\d\d-\d\d$/.test(d) && new Date(Date.parse(d + "T00:00:00+03:00") + 10800000).toISOString().slice(0, 10) === d;
    const unixDay = (d) => d ? Math.floor(Date.parse(d + "T00:00:00+03:00") / 1000) : null;
    const safe = (s) => {
      const raw = String(s || "file").normalize("NFC").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/^\.+/, "_").trim();
      let out = "", n = 0;
      for (const ch of raw) {
        let m = new TextEncoder().encode(ch).length;
        if (n + m > 150)
          break;
        out += ch;
        n += m;
      }
      return out || "file";
    };
    const ext = (s, fallback = "bin") => String(s || fallback).replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || fallback;
    const fileStem = (name, fallback) => safe(name || fallback);
    const join = (...x) => x.join("/");
    const known = () => new Map(rows.map((m) => [m.id, m]));
    const blank = () => ({ schema: 2, version: VERSION, peer_id: cfg.peerId, updated: ts(), total: 0, checkpoint: null, files: {}, runs: [], conversation: null });
    const json = async (name) => {
      try {
        return JSON.parse(await (await (await root.getFileHandle(name)).getFile()).text());
      } catch (e) {
        if (e.name === "NotFoundError")
          return null;
        throw e;
      }
    };
    async function write(name, data, dir = root) {
      const h = await dir.getFileHandle(name, { create: true }), w = await h.createWritable();
      try {
        await w.write(typeof data === "string" || data instanceof Uint8Array || data instanceof Blob ? data : JSON.stringify(data, null, 2) + `
`);
        await w.close();
      } catch (e) {
        await w.abort().catch(() => {});
        throw e;
      }
    }
    async function dir(name, parent = root) {
      return parent.getDirectoryHandle(name, { create: true });
    }
    const sorted = () => rows.sort((a, b) => a.date - b.date || a.id - b.id);
    async function checkpoint() {
      sorted();
      meta.total = rows.length;
      meta.updated = ts();
      meta.lastMessageDate = rows.length ? new Date(rows.at(-1).date * 1000).toISOString() : null;
      await write("messages.json", { schema: 2, peer_id: cfg.peerId, messages: rows });
      await write("metadata.json", meta);
      refresh();
    }
    function status() {
      return {
        version: VERSION,
        folder: root?.name || null,
        busy,
        options: { ...cfg },
        progress: { ...prog },
        messages: rows.length,
        checkpoint: meta?.checkpoint || null
      };
    }
    function configure(v = {}) {
      if (busy)
        throw Error("Заверши или приостанови выгрузку");
      let o = { ...cfg, ...v };
      if (!["recent", "incremental", "backfill"].includes(o.mode))
        throw Error("Режим");
      if (!Number.isSafeInteger(o.limit) || o.limit < 1 || o.limit > 1e5)
        throw Error("Количество: 1–100000");
      if (!Number.isSafeInteger(o.pageSize) || o.pageSize < 1 || o.pageSize > 100)
        throw Error("Пачка: 1–100");
      if (!Number.isSafeInteger(o.delay) || o.delay < 300)
        throw Error("Пауза: от 300 мс");
      if (!validDay(o.from) || !validDay(o.through) || o.from && o.through && o.from > o.through)
        throw Error("Диапазон дат");
      if (root && o.peerId !== meta.peer_id)
        throw Error("Для другого диалога нужна отдельная папка");
      Object.assign(cfg, o);
      return status();
    }
    async function useFolder(handle) {
      if (!cfg.peerId)
        throw Error("Открой диалог VK перед выбором папки");
      if (busy)
        throw Error("Выгрузка идёт");
      root = handle;
      const previous = await json("metadata.json");
      if (!previous) {
        try {
          await root.getFileHandle("state.json");
          root = null;
          throw Error("Обнаружен старый архив v1. Используй отдельную утилиту миграции.");
        } catch (e) {
          if (e.name !== "NotFoundError")
            throw e;
        }
        try {
          await root.getDirectoryHandle("pages");
          root = null;
          throw Error("Обнаружен старый каталог pages/. Сначала выполни миграцию.");
        } catch (e) {
          if (e.name !== "NotFoundError")
            throw e;
        }
      }
      if (previous && (previous.schema !== 2 || previous.peer_id !== cfg.peerId)) {
        root = null;
        throw Error("Старая папка несовместима. Мигрируй её отдельной утилитой в новую папку.");
      }
      meta = previous || blank();
      const existing = await json("messages.json");
      if (existing && (existing.schema !== 2 || existing.peer_id !== cfg.peerId || !Array.isArray(existing.messages))) {
        root = null;
        throw Error("Неверный формат messages.json");
      }
      rows = existing?.messages || [];
      sorted();
      if (!previous)
        await checkpoint();
      refresh();
      return status();
    }
    async function selectFolder() {
      if (!globalThis.showDirectoryPicker)
        throw Error("Нужен Chrome и HTTPS");
      const h = await showDirectoryPicker({ id: "vk-archive-v2", mode: "readwrite" });
      if (await h.requestPermission({ mode: "readwrite" }) !== "granted")
        throw Error("Нет разрешения на запись");
      return useFolder(h);
    }
    function vkTokens() {
      const result = [], seen = new Set;
      const add = (v) => {
        if (typeof v === "string" && v.length >= 16 && v.length < 4096 && !seen.has(v)) {
          seen.add(v);
          result.push(v);
        }
      };
      const dive = (o, depth = 0) => {
        if (!o || typeof o !== "object" || depth > 4)
          return;
        for (const [k, v] of Object.entries(o).slice(0, 100)) {
          if (/^(access_?token|vk_?access_?token|oauth_?token|token)$/i.test(k))
            add(v);
          else if (v && typeof v === "object")
            dive(v, depth + 1);
        }
      };
      for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
        try {
          for (let i = 0;i < Math.min(store?.length || 0, 400); i++) {
            const k = store.key(i);
            if (!/auth|oauth|token|session|vk/i.test(k))
              continue;
            const v = store.getItem(k);
            if (!v || v.length > 300000)
              continue;
            if (/token/i.test(k) && !v.startsWith("{"))
              add(v);
            try {
              dive(JSON.parse(v));
            } catch {}
          }
        } catch {}
      }
      return result.slice(0, 8);
    }
    async function api(method, p, attempt = 0) {
      const body = new URLSearchParams({ ...p, access_token: token });
      const resp = await fetch("https://web.api.vk.ru/method/" + method + "?v=5.289&client_id=6287487", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(25000)
      });
      if (resp.status === 429 || resp.status >= 500) {
        if (attempt < 2) {
          await sleep(1000 * (attempt + 1));
          return api(method, p, attempt + 1);
        }
      }
      if (!resp.ok)
        throw Error("VK HTTP " + resp.status);
      const out = await resp.json();
      if (out.error)
        throw Error("VK API " + out.error.error_code);
      return out.response;
    }
    async function auth() {
      if (token)
        return true;
      for (const t of vkTokens())
        try {
          token = t;
          const r = await api("messages.getHistory", { peer_id: cfg.peerId, count: 1, offset: 0, rev: 0 });
          if (Array.isArray(r?.items)) {
            refresh();
            return true;
          }
        } catch {}
      token = "";
      if (globalThis.VKArchive?.state?.().authenticated && globalThis.VKArchive.state().peer_id === cfg.peerId)
        return true;
      refresh();
      return false;
    }
    async function history(offset, count) {
      if (token) {
        const r = await api("messages.getHistory", { peer_id: cfg.peerId, count, offset, rev: 0 });
        if (!Array.isArray(r.items))
          throw Error("Неверный ответ истории");
        return r;
      }
      const a = globalThis.VKArchive;
      if (!a?.state?.().authenticated)
        throw Error("Не найдена авторизация VK");
      const from = "1970-01-01", through = "2099-12-31";
      let chunk;
      try {
        chunk = a.getPart(from, through);
      } catch {}
      while ((chunk?.next_offset || 0) < offset + count && !chunk?.complete) {
        const prev = chunk?.next_offset || 0;
        await a.captureRange({ from, through, maxPages: 1, pageSize: Math.min(100, count), delayMs: 450 });
        chunk = a.getPart(from, through);
        if (chunk.next_offset <= prev)
          break;
      }
      const all = [...chunk?.messages || []].sort((a, b) => b.date - a.date || b.id - a.id);
      return { items: all.slice(offset, offset + count), count: chunk?.conversation_total || all.length };
    }
    function assets(m) {
      const out = [];
      function descend(n, ctx, depth) {
        if (!n || depth > 8)
          return;
        (n.attachments || []).forEach((att, i) => {
          const t = att.type || "unknown", v = att[t] || {}, key = [m.id, ctx, i, t].join(":");
          const choice = [];
          const add = (url, name, size = null) => {
            if (typeof url === "string" && /^https?:\/\//i.test(url))
              choice.push({ url, name: safe(name), size });
          };
          if (t === "doc" && (v.preview?.audio_msg || v.type === 5)) {
            const a = v.preview?.audio_msg || {};
            add(a.link_ogg, "Голосовое.ogg");
            add(a.link_mp3, "Голосовое.mp3");
            if (!choice.length)
              add(v.url, "Голосовое." + ext(v.ext, "ogg"), v.size);
          } else if (t === "doc")
            add(v.url, fileStem(v.title, "Документ") + (String(v.title || "").toLowerCase().endsWith("." + ext(v.ext)) ? "" : "." + ext(v.ext)), v.size);
          else if (t === "photo") {
            const s = [...v.sizes || []].filter((x) => x.url).sort((a, b) => b.width * b.height - a.width * a.height)[0];
            add(s?.url, "Фото." + ext(s?.url?.split("?")[0].match(/\.([a-z0-9]{3,4})$/i)?.[1], "jpg"));
          } else if (t === "audio_message") {
            add(v.link_ogg, "Голосовое.ogg");
            add(v.link_mp3, "Голосовое.mp3");
          } else if (t === "audio")
            add(v.url, "Аудио.mp3");
          else if (t === "graffiti")
            add(v.url, "Граффити.png");
          else if (t === "sticker")
            add((v.images_with_background || v.images || []).at(-1)?.url, "Стикер.png");
          else if (t === "video") {
            const f = Object.entries(v.files || {}).filter(([k, u]) => /^mp4_\d+$/.test(k) && typeof u === "string").sort(([a], [b]) => parseInt(b.slice(4)) - parseInt(a.slice(4)));
            add(f[0]?.[1], "Видео.mp4");
          }
          out.push({
            key,
            rootId: m.id,
            type: t,
            choices: choice,
            sourceId: n.id ?? null,
            context: ctx,
            external: t === "link" && /^https?:\/\//i.test(v.url || "") ? v.url : null,
            transcript: t === "audio_message" ? v.transcript || null : t === "doc" ? v.preview?.audio_msg?.transcript || null : null
          });
        });
        if (n.reply_message)
          descend(n.reply_message, ctx + ".reply", depth + 1);
        (n.fwd_messages || []).forEach((f, i) => descend(f, ctx + ".fwd" + i, depth + 1));
      }
      descend(m, "root", 0);
      return out;
    }
    async function download(a) {
      const prev = meta.files[a.key];
      if (prev?.status === "saved") {
        try {
          const d = await dir(String(a.rootId), await dir("media"));
          const file = await (await d.getFileHandle(prev.name)).getFile();
          if (file.size === prev.size)
            return "existing";
        } catch {}
      }
      const result = { type: a.type, message_id: a.rootId, source_id: a.sourceId, status: "unavailable" };
      if (a.type === "link") {
        result.status = "link";
        meta.files[a.key] = result;
        return "link";
      }
      let failures = 0;
      for (const v of a.choices) {
        try {
          const response = await fetch(v.url, { method: "GET", credentials: "omit", signal: AbortSignal.timeout(60000) });
          if (!response.ok)
            throw Error("HTTP " + response.status);
          if ((response.headers.get("content-type") || "").includes("text/html"))
            throw Error("Вместо файла HTML");
          const cap = 64 * 1048576, reader = response.body?.getReader();
          if (!reader)
            throw Error("Нет файла");
          const chunks = [];
          let n = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done)
              break;
            n += value.byteLength;
            if (n > cap) {
              await reader.cancel();
              throw Error("Превышен размер 64 МБ");
            }
            chunks.push(value);
          }
          if (!n || v.size !== null && v.size !== n)
            throw Error("Размер не совпал");
          const bytes = new Uint8Array(n);
          let pos = 0;
          for (const b of chunks) {
            bytes.set(b, pos);
            pos += b.length;
          }
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          const hash = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, "0")).join("");
          const media = await dir(String(a.rootId), await dir("media"));
          let name = v.name, index = 2;
          const occupied = new Set(Object.entries(meta.files).filter(([k, f]) => k !== a.key && f.message_id === a.rootId && f.status === "saved").map(([, f]) => f.name));
          while (occupied.has(name)) {
            const i = v.name.lastIndexOf(".");
            name = i > 0 ? v.name.slice(0, i) + " (" + index++ + ")" + v.name.slice(i) : v.name + " (" + index++ + ")";
          }
          await write(name, bytes, media);
          Object.assign(result, {
            status: "saved",
            name,
            size: n,
            sha256: hash,
            path: join("media", String(a.rootId), name),
            mime: response.headers.get("content-type") || ""
          });
          meta.files[a.key] = result;
          return "saved";
        } catch {
          failures++;
        }
        await sleep(300);
      }
      if (failures)
        result.status = "failed";
      meta.files[a.key] = result;
      return result.status;
    }
    function attachmentView(m) {
      return assets(m).map((a) => ({
        type: a.type,
        key: a.key,
        media: meta.files[a.key]?.path || null,
        status: meta.files[a.key]?.status || "missing",
        external: a.external,
        transcript: a.transcript,
        name: meta.files[a.key]?.name || a.choices[0]?.name || a.type
      }));
    }
    function viewerHTML() {
      const snapshot = rows.map((m) => ({
        id: m.id,
        author: m.from_id,
        out: !!m.out,
        date: m.date,
        text: m.text || "",
        media: attachmentView(m),
        reply: m.reply_message ? { text: m.reply_message.text || "", from: m.reply_message.from_id } : null,
        forwards: (m.fwd_messages || []).map((f) => ({ text: f.text || "", from: f.from_id }))
      }));
      const embed = JSON.stringify(snapshot).replace(/</g, "\\u003c");
      return `<!DOCTYPE html><html lang="ru"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VK Booster — диалог ${cfg.peerId}</title><style>
:root{color-scheme:light;font:15px/1.5 system-ui,sans-serif;background:#f3f5fa;color:#202838}
*{box-sizing:border-box}body{margin:0}.top{position:sticky;top:0;background:white;border-bottom:1px solid #d8deeb;padding:14px 18px;z-index:5}
h1{font-size:19px;margin:0 0 8px}.stats{color:#68758b;font-size:13px}.search{width:100%;max-width:630px;border:1px solid #c4cee1;border-radius:9px;padding:10px}
main{max-width:860px;margin:18px auto;padding:0 14px}.msg{background:white;border:1px solid #e1e5ed;border-radius:12px;margin:9px 0;padding:12px 16px;max-width:85%;overflow-wrap:anywhere}
.msg.mine{margin-left:auto;background:#e6f0ff}.by{font-size:12px;color:#65738b;margin-bottom:5px}.content{white-space:pre-wrap}
.file{display:block;margin-top:6px;color:#2154a5}.file img{display:block;max-width:min(100%,390px);max-height:360px;border-radius:8px}
.file audio{width:min(100%,380px)}.quote{border-left:3px solid #8da9d8;padding-left:10px;color:#5b6881;margin:7px 0}
</style><header class="top"><h1>VK Booster · Архив переписки</h1><div class="stats" id="stats"></div><input class="search" id="q" placeholder="Поиск по сообщениям…"></header><main id="list"></main>
<script>const entries=${embed};const list=document.getElementById('list'),q=document.getElementById('q'),stats=document.getElementById('stats');
function elt(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
function link(path){return path.split('/').map(encodeURIComponent).join('/')}
function render(){const filter=q.value.toLowerCase(),found=entries.filter(m=>!filter||m.text.toLowerCase().includes(filter));list.replaceChildren();
const fragment=document.createDocumentFragment();for(const m of found){const box=elt('article','msg'+(m.out?' mine':''));box.append(elt('div','by',(m.out?'Вы':'ID '+m.author)+' · '+new Date(m.date*1000).toLocaleString('ru-RU')));
if(m.reply)box.append(elt('div','quote','↪ '+(m.reply.text||'Ответ на сообщение')));
for(const f of m.forwards)box.append(elt('div','quote','Переслано: '+(f.text||'Вложение')));
const content=elt('div','content');
for(const part of m.text.split(/(https?:\\/\\/[^\\s]+)/g)){
 if(/^https?:\\/\\//.test(part)){
  const a=elt('a',null,part);a.href=part.replace(/[),.;!?]+$/,'');a.target='_blank';a.rel='noopener noreferrer';content.append(a);
 }else content.append(document.createTextNode(part));
}
box.append(content);for(const a of m.media){if(a.media){const tag=elt('a','file','\uD83D\uDCCE '+a.name);tag.href=link(a.media);tag.target='_blank';tag.rel='noopener noreferrer';
if(/\\.(jpe?g|png|webp|gif)$/i.test(a.name)){const img=elt('img');img.src=link(a.media);img.loading='lazy';tag.append(img)}
else if(/\\.(ogg|mp3|wav|m4a)$/i.test(a.name)){const audio=elt('audio');audio.controls=true;audio.preload='none';audio.src=link(a.media);box.append(audio)}
box.append(tag)}else if(a.external){const external=elt('a','file','\uD83D\uDD17 '+a.external);external.href=a.external;external.target='_blank';external.rel='noopener noreferrer';box.append(external)}
else box.append(elt('div','by','Вложение ('+a.type+'): '+a.status));
if(a.transcript)box.append(elt('div','quote','Расшифровка: '+a.transcript))}
fragment.append(box)}
list.append(fragment);stats.textContent=found.length+' / '+entries.length+' сообщений · локальный архив'}
q.addEventListener('input',render);render();</script></html>`;
    }
    async function buildViewer() {
      sorted();
      await write("index.html", viewerHTML());
      return { messages: rows.length };
    }
    function progress(phase, done, total, extra = {}) {
      prog = { phase, done, total, ...extra };
      refresh();
    }
    function stop() {
      stopRequested = true;
      refresh();
    }
    async function run(options = {}) {
      if (busy)
        throw Error("Выгрузка уже запущена");
      if (!cfg.peerId)
        throw Error("Открой диалог VK перед выгрузкой");
      if (!root)
        throw Error("Сначала выбери папку");
      const resume = options.resume === true;
      if (!resume)
        configure(options);
      if (!await auth())
        throw Error("Не удалось авторизовать VK API из хранилища");
      busy = true;
      stopRequested = false;
      if (resume && meta.checkpoint?.settings)
        Object.assign(cfg, meta.checkpoint.settings);
      const index = known(), lower = unixDay(cfg.from), upper = cfg.through ? unixDay(cfg.through) + 86400 : null;
      const countTarget = cfg.limit;
      let cp = resume && meta.checkpoint && ["paused", "running"].includes(meta.checkpoint.status) ? meta.checkpoint : {
        mode: cfg.mode,
        target: countTarget,
        offset: cfg.mode === "backfill" ? meta.backfillOffset || 0 : 0,
        matched: 0,
        scanned: 0,
        newCount: 0,
        phase: "messages",
        fileCursor: 0,
        status: "running",
        totalVK: null,
        started: ts(),
        settings: { ...cfg }
      };
      meta.checkpoint = cp;
      cfg.mode = cp.mode;
      progress("Сообщения", cp.matched, cp.target);
      try {
        if (!meta.conversation && token) {
          try {
            meta.conversation = await api("messages.getConversationsById", { peer_ids: String(cfg.peerId), extended: 0 });
          } catch {}
        }
        if (cp.phase === "messages") {
          while (!stopRequested && cp.matched < cp.target) {
            const batch = await history(cp.offset, cfg.pageSize);
            cp.totalVK = batch.count;
            if (!batch.items.length || cp.offset >= batch.count) {
              cp.phase = "media";
              break;
            }
            let consumed = 0, end = false;
            for (const m of batch.items) {
              consumed++;
              cp.scanned++;
              if (upper !== null && m.date >= upper)
                continue;
              if (lower !== null && m.date < lower) {
                end = true;
                break;
              }
              const present = index.has(m.id);
              if (cp.mode === "incremental" && present) {
                end = true;
                break;
              }
              if (cp.mode === "backfill" && present)
                continue;
              cp.matched++;
              if (!present) {
                index.set(m.id, m);
                cp.newCount++;
              }
              if (cp.matched >= cp.target)
                break;
            }
            cp.offset += consumed;
            rows = [...index.values()];
            sorted();
            if (cp.mode === "backfill")
              meta.backfillOffset = cp.offset;
            if (cp.mode === "incremental") {
              meta.backfillOffset = (meta.backfillOffset || 0) + cp.newCount - (cp.shifted || 0);
              cp.shifted = cp.newCount;
            }
            if (cp.mode === "recent")
              meta.backfillOffset = Math.max(meta.backfillOffset || 0, cp.offset);
            if (cp.mode === "incremental")
              meta.backfillOffset = (meta.backfillOffset || 0) + Math.max(0, cp.newCount - (cp.shifted || 0));
            cp.shifted = cp.newCount;
            cp.status = "running";
            meta.checkpoint = cp;
            await checkpoint();
            progress("Сообщения", cp.matched, cp.target, { newCount: cp.newCount, scanned: cp.scanned });
            if (end || cp.offset >= batch.count || batch.items.length < cfg.pageSize) {
              cp.phase = "media";
              break;
            }
            if (!stopRequested)
              await sleep(cfg.delay);
          }
          if (cp.matched >= cp.target)
            cp.phase = "media";
        }
        if (stopRequested) {
          cp.status = "paused";
          await checkpoint();
          return { paused: true, progress: status().progress };
        }
        if (cp.phase === "media") {
          const queue = cfg.media ? rows.flatMap(assets).filter((a) => a.type !== "link") : [];
          progress("Файлы", cp.fileCursor, queue.length, { newCount: cp.newCount });
          for (let i = cp.fileCursor;i < queue.length; i++) {
            if (stopRequested)
              break;
            const outcome = await download(queue[i]);
            cp.fileCursor = i + 1;
            meta.checkpoint = cp;
            await write("metadata.json", meta);
            const vals = Object.values(meta.files);
            progress("Файлы", cp.fileCursor, queue.length, {
              downloaded: vals.filter((f) => f.status === "saved").length,
              failed: vals.filter((f) => f.status === "failed").length,
              newCount: cp.newCount
            });
            if (!stopRequested && outcome !== "existing")
              await sleep(250);
          }
        }
        if (stopRequested) {
          cp.status = "paused";
          await checkpoint();
          return { paused: true, progress: status().progress };
        }
        cp.status = "done";
        cp.phase = "done";
        cp.finished = ts();
        meta.checkpoint = cp;
        meta.runs.push({ mode: cp.mode, target: cp.target, matched: cp.matched, newCount: cp.newCount, finished: ts() });
        if (meta.runs.length > 30)
          meta.runs = meta.runs.slice(-30);
        await checkpoint();
        await buildViewer();
        progress("Готово", cp.target, cp.target, { newCount: cp.newCount, downloaded: Object.values(meta.files).filter((f) => f.status === "saved").length });
        return { matched: cp.matched, newCount: cp.newCount, saved: rows.length, files: prog.downloaded, folder: root.name };
      } catch (e) {
        cp.status = "paused";
        cp.error = String(e.message || e).slice(0, 180);
        try {
          await checkpoint();
        } catch {}
        progress("Ошибка", cp.matched, cp.target, { error: cp.error });
        throw e;
      } finally {
        busy = false;
        refresh();
      }
    }
    function refresh() {
      if (!box?.shadowRoot)
        return;
      const $ = (id) => box.shadowRoot.querySelector("#" + id.replace(/^#/, ""));
      const current = meta?.checkpoint?.status;
      const phase = prog.error ? "Ошибка" : busy ? prog.phase : current === "paused" ? "Приостановлено" : current === "done" ? "Готово" : "Ожидание";
      $("#folder-name").textContent = root ? "Папка: " + root.name : "Папка не выбрана";
      $("#state").textContent = prog.error || phase;
      const pc = prog.total ? Math.min(100, Math.floor(prog.done / prog.total * 100)) : phase === "Готово" ? 100 : 0;
      $("#percent").textContent = pc + "%";
      $("#bar").style.width = pc + "%";
      $("#progress-track").setAttribute("aria-valuenow", String(pc));
      $("#counts").textContent = prog.done + " из " + prog.total + " обработано";
      $("#count-all").textContent = String(rows.length);
      $("#count-new").textContent = String(prog.newCount ?? 0);
      $("#count-files").textContent = String(Object.values(meta?.files || {}).filter((x) => x.status === "saved").length);
      $("#run").disabled = busy || !root;
      $("#stop").disabled = !busy;
      $("#resume").disabled = busy || !root || current !== "paused";
      $("#status-pill").textContent = busy ? "В работе" : current === "paused" ? "Пауза" : current === "done" ? "Завершено" : "Готов к запуску";
      $("#status-pill").classList.toggle("kb-pill-good", phase === "Готово");
      $("#error").textContent = uiError || prog.error || "";
    }
    function show() {
      if (!root && !busy) {
        const p = initialPeer();
        if (p !== cfg.peerId)
          cfg.peerId = p;
      }
      if (!box)
        mount();
      if (box?.shadowRoot) {
        box.hidden = false;
        box.shadowRoot.getElementById("dialog").textContent = cfg.peerId ? "Диалог VK · " + cfg.peerId : "Откройте переписку VK";
        refresh();
      }
    }
    function hide() {
      if (box)
        box.hidden = true;
    }
    const exporterCss = [
      ".kb-export{width:min(490px,calc(100vw - 28px))}",
      ".kb-export-host{position:fixed;right:20px;top:65px;z-index:2147483647}",
      ".kb-file-picker{display:flex;align-items:center;justify-content:space-between;gap:12px}",
      ".kb-file-meta{min-width:0;flex:1}",
      ".kb-file-meta strong{display:block;font-size:13px;font-weight:720}",
      ".kb-file-meta span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".kb-progress-heading{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:12px}",
      ".kb-progress-pct{font-weight:780;font-size:20px;font-variant-numeric:tabular-nums;color:var(--kb-accent)}",
      ".kb-export-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:17px}",
      ".kb-export-actions .kb-button-primary{flex:1}",
      ".kb-stat-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:16px}",
      ".kb-mini-stat{padding:12px 10px;background:var(--kb-bg-soft);border:1px solid var(--kb-border);border-radius:11px}",
      ".kb-field-hint{font-size:11px;color:var(--kb-ink-light);margin:5px 0 0}",
      ".kb-toggle-line{display:flex;flex-direction:row;align-items:center;gap:9px;color:var(--kb-ink);font-size:13px}",
      "#folder-name{display:block;max-width:220px}",
      "@media(max-width:520px){.kb-export-host{right:10px;top:10px}.kb-export{width:calc(100vw - 20px)}.kb-file-picker{flex-wrap:wrap}.kb-file-picker button{width:100%}.kb-stat-grid{gap:6px}.kb-mini-stat{padding:10px 6px}.kb-export-actions button{flex:1}}"
    ].join(`
`);
    function mount() {
      if (!document.body || box)
        return;
      const host = document.createElement("div");
      host.id = "vk-archive-v2";
      host.className = "kb-export-host";
      host.style.cssText = "position:fixed;z-index:2147483647;right:20px;top:65px";
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = "<style>" + classicThemeCss + exporterCss + "</style>" + [
        "<article class='kb-window kb-export' role='dialog' aria-modal='false' aria-label='VK Booster'>",
        "<header class='kb-header'><div class='kb-brand'><span class='kb-mark'>",
        brandMark,
        "</span>",
        "<div class='kb-brand-copy'><div class='kb-eyebrow'>Koba Browser Tools</div><h2 class='kb-title'>VK Booster</h2></div></div>",
        "<button type='button' class='kb-icon-button' id='hide' title='Закрыть' aria-label='Закрыть'>×</button></header>",
        "<main class='kb-window-body'>",
        "<section><div class='kb-row'><h3 class='kb-section-title'>Источник архива</h3><span class='kb-pill' id='status-pill'>Готов к запуску</span></div>",
        "<p class='kb-description' id='dialog'>Диалог VK</p>",
        "<div class='kb-card kb-file-picker' style='margin-top:12px'><div class='kb-file-meta'><strong>Локальное хранилище</strong>",
        "<span class='kb-muted' id='folder-name'>Папка не выбрана</span></div>",
        "<button type='button' class='kb-button' id='folder'>Выбрать папку</button></div></section>",
        "<section class='kb-section'><h3 class='kb-section-title'>Настройки экспорта</h3>",
        "<div class='kb-grid kb-grid-wide'><label class='kb-label'>Режим<select class='kb-select' id='mode'>",
        "<option value='recent'>Последние N сообщений</option><option value='incremental'>Только новые</option>",
        "<option value='backfill'>Продолжить историю</option></select></label>",
        "<label class='kb-label'>Количество<input class='kb-input' id='limit' type='number' min='1' max='100000' value='10'></label></div>",
        "<p class='kb-field-hint'>N — число сообщений в диапазоне, включая уже сохранённые.</p></section>",
        "<section class='kb-section'><div class='kb-progress-heading'><div>",
        "<h3 class='kb-section-title' style='margin:0'>Ход экспорта</h3>",
        "<span class='kb-muted' id='state' role='status' aria-live='polite'>Ожидание</span></div>",
        "<strong class='kb-progress-pct' id='percent'>0%</strong></div>",
        "<div class='kb-progress-track' id='progress-track' role='progressbar' aria-label='Прогресс' aria-valuemin='0' aria-valuemax='100' aria-valuenow='0'><div id='bar' class='kb-progress-fill'></div></div>",
        "<div class='kb-muted' id='counts' style='margin-top:8px'>0 из 0 обработано</div>",
        "<div class='kb-stat-grid'><div class='kb-mini-stat'><div id='count-all' class='kb-stat-number'>0</div><div class='kb-stat-label'>В архиве</div></div>",
        "<div class='kb-mini-stat'><div id='count-new' class='kb-stat-number'>0</div><div class='kb-stat-label'>Новых</div></div>",
        "<div class='kb-mini-stat'><div id='count-files' class='kb-stat-number'>0</div><div class='kb-stat-label'>Файлов</div></div></div>",
        "<div class='kb-export-actions'><button type='button' class='kb-button kb-button-primary' id='run'>Начать выгрузку</button>",
        "<button type='button' class='kb-button' id='stop'>Пауза</button><button type='button' class='kb-button' id='resume'>Продолжить</button></div>",
        "<p class='kb-error' id='error' role='alert' aria-live='polite'></p></section>",
        "<section class='kb-section'><details class='kb-details'><summary>Дополнительные настройки</summary>",
        "<div class='kb-grid'><label class='kb-label'>С даты<input id='from' class='kb-input' type='date'></label>",
        "<label class='kb-label'>По дату<input id='through' class='kb-input' type='date'></label>",
        "<label class='kb-label'>Размер пачки<input id='size' class='kb-input' type='number' min='1' max='100' value='50'></label>",
        "<label class='kb-label'>Пауза, мс<input id='delay' class='kb-input' type='number' min='300' value='450'></label></div>",
        "<label class='kb-toggle-line' style='margin-top:15px'><input id='media' class='kb-checkbox' type='checkbox' checked> Сохранять файлы и медиа</label>",
        "</details></section></main>",
        "<footer class='kb-footer'>metadata.json · messages.json · index.html · media/</footer></article>"
      ].join("");
      document.body.append(host);
      document.addEventListener("keydown", onEscape);
      box = host;
      host.hidden = true;
      const $ = (id) => shadow.querySelector("#" + id.replace(/^#/, ""));
      $("hide").onclick = hide;
      $("folder").onclick = () => {
        uiError = "";
        selectFolder().catch((e) => {
          uiError = e.message;
          refresh();
        });
      };
      $("stop").onclick = stop;
      $("run").onclick = () => execute(false);
      $("resume").onclick = () => execute(true);
      async function execute(resume) {
        uiError = "";
        $("error").textContent = "";
        try {
          const v = resume ? { resume: true } : {
            mode: $("mode").value,
            limit: Number($("limit").value),
            from: $("from").value,
            through: $("through").value,
            pageSize: Number($("size").value),
            delay: Number($("delay").value),
            media: $("media").checked
          };
          await run(v);
        } catch (e) {
          uiError = String(e.message || e).slice(0, 250);
        }
        refresh();
      }
      refresh();
    }
    function onEscape(event) {
      if (event.key === "Escape" && !box?.hidden)
        hide();
    }
    const apiObject = { version: VERSION, configure, selectFolder, useFolder, run, resume: () => run({ resume: true }), stop, status, show, hide, buildViewer, getMessages: () => [...rows], destroy() {
      document?.removeEventListener?.("keydown", onEscape);
      box?.remove();
      box = null;
      if (globalThis[GLOBAL] === apiObject)
        delete globalThis[GLOBAL];
    } };
    globalThis[GLOBAL] = Object.freeze(apiObject);
    if (!globalThis.__VK_EXPORT_TEST_MODE) {
      if (document.body)
        mount();
      else
        document.addEventListener("DOMContentLoaded", mount, { once: true });
    }
  }

  // modules/vk-booster/src/index.ts
  var vkBoosterFeature = {
    id: "vk-booster",
    title: "VK Booster",
    description: "История переписки, вложения и офлайн-просмотр",
    targets: ["userscript", "chromium"],
    requiredCapabilities: ["page-dom", "origin-storage", "local-files"],
    match: (url) => /^(vk\.ru|vk\.com)$/.test(url.hostname) && url.pathname.startsWith("/im"),
    start() {
      installVkArchive();
    },
    open() {
      window.VKExport?.show();
    },
    stop() {
      window.VKExport?.destroy?.();
    }
  };

  // packages/core/src/index.ts
  class FeatureSettings {
    store;
    constructor(store) {
      this.store = store;
    }
    enabled(id) {
      return this.store.get(`features.${id}.enabled`).then((value) => value !== false);
    }
    setEnabled(id, enabled) {
      return this.store.set(`features.${id}.enabled`, enabled);
    }
  }

  class FeatureRuntime {
    features;
    context;
    telemetry;
    active = new Map;
    status = new Map;
    started = false;
    constructor(features, context, telemetry) {
      this.features = features;
      this.context = context;
      this.telemetry = telemetry;
      const names = new Set;
      for (const feature of features) {
        if (!/^[a-z][a-z0-9-]+$/.test(feature.id) || names.has(feature.id))
          throw new Error(`Invalid or duplicate module id: ${feature.id}`);
        names.add(feature.id);
      }
    }
    async start() {
      if (this.started)
        return;
      this.started = true;
      for (const feature of this.features) {
        const base = { id: feature.id, title: feature.title, description: feature.description };
        if (!feature.match(this.context.url)) {
          this.status.set(feature.id, { ...base, state: "unsupported", reason: "Wrong site" });
          continue;
        }
        const missing = feature.requiredCapabilities.find((cap) => !this.context.capabilities.has(cap));
        if (!feature.targets.includes(this.context.target) || missing) {
          this.status.set(feature.id, { ...base, state: "unsupported", reason: missing ? `Requires ${missing}` : "Unsupported delivery target" });
          continue;
        }
        if (!await this.context.settings.enabled(feature.id)) {
          this.status.set(feature.id, { ...base, state: "disabled" });
          continue;
        }
        try {
          const begin = Date.now();
          await feature.start(this.context);
          this.active.set(feature.id, feature);
          this.status.set(feature.id, { ...base, state: "active" });
          this.telemetry?.record("feature.started", feature.id, Date.now() - begin);
        } catch (error) {
          this.status.set(feature.id, { ...base, state: "failed", reason: error instanceof Error ? error.message : "Unknown startup error" });
          this.telemetry?.record("feature.failed", feature.id);
        }
      }
    }
    async stop() {
      for (const f of [...this.active.values()].reverse())
        try {
          await f.stop?.();
          this.telemetry?.record("feature.stopped", f.id);
        } catch {}
      this.active.clear();
      this.started = false;
    }
    list() {
      return this.features.map((f) => this.status.get(f.id) ?? { id: f.id, title: f.title, description: f.description, state: "disabled" });
    }
    async open(id) {
      const feature = this.active.get(id);
      if (!feature)
        throw new Error(`Module is not active: ${id}`);
      await feature.open?.();
    }
    async setEnabled(id, value) {
      await this.context.settings.setEnabled(id, value);
      await this.stop();
      this.status.clear();
      await this.start();
    }
  }
  function defaultCapabilities(target) {
    return new Set(["page-dom", "origin-storage", "local-files"]);
  }

  // packages/adapters/src/index.ts
  function createSettingsStore(target, namespace = "koba-browser") {
    if (target === "chromium")
      return {
        async get(key) {
          const data = await chrome.storage.local.get(`${namespace}:${key}`);
          return data[`${namespace}:${key}`];
        },
        async set(key, enabled) {
          await chrome.storage.local.set({ [`${namespace}:${key}`]: enabled });
        }
      };
    return {
      async get(key) {
        try {
          const value = localStorage.getItem(`${namespace}:${key}`);
          return value === null ? undefined : value === "true";
        } catch {
          return;
        }
      },
      async set(key, enabled) {
        localStorage.setItem(`${namespace}:${key}`, String(enabled));
      }
    };
  }

  // apps/userscript/src/runtime.ts
  function bootstrapUserscript(features, title = "Koba Browser Tools") {
    const runtime = new FeatureRuntime(features, {
      target: "userscript",
      url: new URL(location.href),
      capabilities: defaultCapabilities("userscript"),
      settings: new FeatureSettings(createSettingsStore("userscript"))
    });
    let open = () => {};
    const launch = async () => {
      await runtime.start();
      const ui = mountControlCenter({ runtime, title, launcher: false });
      open = ui.open;
    };
    if (typeof GM_registerMenuCommand === "function")
      GM_registerMenuCommand("Открыть " + title, () => open());
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", () => void launch(), { once: true });
    else
      launch();
  }

  // apps/userscript/src/all-in-one.ts
  bootstrapUserscript([vkBoosterFeature], "Koba Browser Tools");
})();
