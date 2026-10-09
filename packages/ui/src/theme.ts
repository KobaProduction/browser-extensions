/** One reusable visual identity shared by injected tools and their plugins. */
export const brandMark = `<svg viewBox="0 0 44 44" width="28" height="28" fill="none" aria-hidden="true">
<rect x="1" y="1" width="42" height="42" rx="12" fill="#315AA7"/>
<path d="M13 13v18m18-18L18.8 25.2M24 13l-11 11 11 7" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="31" cy="13" r="2.8" fill="#B9DBFF"/></svg>`

export const classicThemeCss = `
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
`
