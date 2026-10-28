// God Box — stylesheet injected by godbox.js (kept in JS so bundling needs no CSS loader).
// Uses the theme custom properties from src/ui/styles.css, with fallbacks for standalone use.
export const CSS = `
.gb{position:absolute;inset:0;overflow:hidden;background:var(--bg,#14121f);color:var(--ink,#f4efe6);
  font-family:var(--font-body,"Pixelify Sans",system-ui,sans-serif);touch-action:none;user-select:none;-webkit-user-select:none;
  -webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;
  --gb-safe-t:var(--safe-t,env(safe-area-inset-top,0px));--gb-safe-b:var(--safe-b,env(safe-area-inset-bottom,0px));
  --gb-safe-l:var(--safe-l,env(safe-area-inset-left,0px));--gb-safe-r:var(--safe-r,env(safe-area-inset-right,0px))}
.gb *{box-sizing:border-box}
.gb-world{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;image-rendering:pixelated}
.gb-icon{width:32px;height:32px;image-rendering:pixelated;image-rendering:crisp-edges;display:block;pointer-events:none}
.gb-icon.sm{width:16px;height:16px}
.gb-icon.md{width:24px;height:24px}
.gb-btn{min-width:44px;min-height:44px;border:0;border-radius:10px;background:var(--panel-2,#2f2950);color:var(--ink,#f4efe6);
  font:inherit;font-size:14px;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 12px;cursor:pointer;
  box-shadow:inset 0 -3px 0 rgba(0,0,0,.28);touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.gb-btn:active{transform:translateY(1px);box-shadow:inset 0 -1px 0 rgba(0,0,0,.28)}
.gb-btn:focus-visible{outline:2px solid var(--gem,#4ae3ff);outline-offset:2px}
.gb-btn.on{background:var(--gold,#ffcf4a);color:#241f3a}
.gb-btn.gold{background:var(--gold,#ffcf4a);color:#241f3a}
.gb-btn.primary{background:var(--blue,#3b7dd8)}
.gb-btn.danger{background:var(--red-dark,#8c2a23)}
.gb-btn.ghost{background:transparent;box-shadow:none}
.gb-btn[disabled]{opacity:.45}
.gb-top{position:absolute;left:0;right:0;top:0;z-index:3;display:flex;flex-direction:column;gap:3px;
  padding:calc(var(--gb-safe-t) + 6px) calc(var(--gb-safe-r) + 8px) 5px calc(var(--gb-safe-l) + 8px);
  background:linear-gradient(rgba(20,18,31,.95),rgba(20,18,31,.84));border-bottom:2px solid rgba(0,0,0,.4)}
.gb-row{display:flex;align-items:center;gap:6px}
.gb-date{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;padding-left:2px}
.gb-year{font-family:var(--font-display,monospace);font-size:10px;color:var(--gold,#ffcf4a);white-space:nowrap}
.gb-alive{font-size:13px;color:var(--ink-dim,#a79fc2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gb-speed{display:flex;gap:3px}
.gb-speed .gb-btn{padding:0;font-family:var(--font-display,monospace);font-size:10px}
.gb-pops{display:flex;gap:4px;justify-content:space-between;font-family:var(--font-display,monospace);font-size:9px;min-height:22px}
.gb-pop{display:inline-flex;align-items:center;gap:3px;padding:1px 6px 1px 2px;border-radius:9px;background:rgba(0,0,0,.3);white-space:nowrap}
.gb-pop .gb-icon{width:16px;height:16px}
.gb-bottom{position:absolute;left:0;right:0;bottom:0;z-index:3;display:flex;flex-direction:column;gap:6px;
  padding:6px calc(var(--gb-safe-r) + 6px) calc(var(--gb-safe-b) + 6px) calc(var(--gb-safe-l) + 6px);
  background:linear-gradient(rgba(20,18,31,.86),rgba(20,18,31,.97));border-top:2px solid rgba(0,0,0,.4)}
.gb-tools-wrap{display:flex;gap:6px;align-items:stretch}
.gb-brush{flex:none;width:50px;flex-direction:column;gap:1px;padding:0;font-family:var(--font-display,monospace);font-size:12px;line-height:1}
.gb-brush small{font-family:var(--font-body,sans-serif);font-size:10px;color:var(--ink-dim,#a79fc2)}
.gb-tools{flex:1;display:flex;gap:6px;overflow-x:auto;overflow-y:hidden;touch-action:pan-x;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding-bottom:1px}
.gb-tools::-webkit-scrollbar{display:none}
.gb-tool{flex:none;width:58px;height:62px;flex-direction:column;gap:3px;padding:4px 2px;background:var(--panel,#241f3a);
  border:2px solid transparent;font-size:11px;line-height:1;color:var(--ink-dim,#a79fc2)}
.gb-tool span{max-width:54px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gb-tool.on{border-color:var(--gold,#ffcf4a);background:var(--panel-3,#3b3463);color:var(--ink,#f4efe6)}
.gb-tool.toggle-off .gb-icon{opacity:.35}
.gb-tabs{display:flex;gap:6px}
.gb-tab{flex:1;padding:0 4px;font-family:var(--font-display,monospace);font-size:9px;letter-spacing:.5px;background:var(--panel,#241f3a);color:var(--ink-dim,#a79fc2)}
.gb-tab.on{background:var(--panel-3,#3b3463);color:var(--gold,#ffcf4a);box-shadow:inset 0 -3px 0 var(--gold,#ffcf4a)}
.gb-ticker{position:absolute;z-index:2;left:calc(var(--gb-safe-l) + 8px);right:calc(var(--gb-safe-r) + 8px);min-height:44px;
  display:flex;align-items:center;background:transparent;border:0;padding:0;color:var(--ink,#f4efe6);font:inherit;cursor:pointer;touch-action:manipulation}
.gb-ticker-pill{display:flex;align-items:center;gap:8px;max-width:100%;height:32px;padding:0 12px;border-radius:16px;
  background:rgba(20,18,31,.82);border:1px solid rgba(255,255,255,.08);font-size:14px;white-space:nowrap;overflow:hidden;transition:transform .2s}
.gb-ticker-pill span{overflow:hidden;text-overflow:ellipsis}
.gb-ticker-pill.bump{transform:scale(1.04)}
.gb-dot{flex:none;width:8px;height:8px;border-radius:2px;background:var(--ink-dim,#a79fc2)}
.gb-panel{position:absolute;z-index:4;left:calc(var(--gb-safe-l) + 8px);right:calc(var(--gb-safe-r) + 8px);background:var(--panel,#241f3a);
  border:2px solid var(--line,#4a4278);border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.5)}
.gb-info{max-height:46%;overflow:auto;padding:8px 10px 10px}
.gb-info-head{display:flex;align-items:center;gap:8px}
.gb-info-title{flex:1;min-width:0;font-family:var(--font-display,monospace);font-size:11px;line-height:1.5;color:var(--ink,#f4efe6);overflow-wrap:anywhere}
.gb-info-sub{color:var(--ink-dim,#a79fc2);font-size:13px;margin-top:2px}
.gb-stats{display:grid;grid-template-columns:1fr 1fr;gap:5px 12px;font-size:14px;margin-top:8px}
.gb-stats .wide{grid-column:1 / -1}
.gb-stats b{color:var(--ink-dim,#a79fc2);font-weight:400;margin-right:4px}
.gb-hp{height:8px;margin-top:3px;background:rgba(0,0,0,.45);border-radius:4px;overflow:hidden}
.gb-hp i{display:block;height:100%;background:var(--good,#5fd35f)}
.gb-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
.gb-tag{font-size:12px;padding:3px 8px;border-radius:10px;background:var(--panel-2,#2f2950)}
.gb-tag.good{background:#2f5a2f}.gb-tag.bad{background:#6a2a2a}.gb-tag.gold{background:#6a5520;color:#ffe9a0}
.gb-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.gb-sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.gb-log{max-height:52%;overflow:auto;padding:4px 6px}
.gb-log-head{display:flex;align-items:center;justify-content:space-between;padding:2px 4px 4px;font-family:var(--font-display,monospace);font-size:10px;color:var(--gold,#ffcf4a)}
.gb-log-item{width:100%;justify-content:flex-start;text-align:left;background:transparent;box-shadow:none;border-radius:8px;font-size:14px;gap:8px;padding:4px 6px}
.gb-log-item em{font-style:normal;color:var(--ink-faint,#6f6794);font-size:12px;flex:none}
.gb-empty{padding:14px;color:var(--ink-dim,#a79fc2);font-size:14px;text-align:center}
.gb-toast{position:absolute;z-index:6;left:50%;transform:translateX(-50%);max-width:86%;padding:8px 14px;border-radius:12px;
  background:rgba(20,18,31,.92);border:2px solid var(--line,#4a4278);font-size:14px;text-align:center;pointer-events:none;opacity:0;transition:opacity .25s}
.gb-toast.show{opacity:1}
.gb-modal{position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;background:rgba(10,8,20,.62);
  padding:calc(var(--gb-safe-t) + 12px) 12px calc(var(--gb-safe-b) + 12px)}
.gb-dialog{width:min(380px,100%);max-height:100%;overflow:auto;background:var(--panel,#241f3a);border:2px solid var(--line,#4a4278);
  border-radius:16px;padding:14px;box-shadow:0 12px 40px rgba(0,0,0,.6);touch-action:pan-y}
.gb-dialog h2{margin:0 0 10px;font-family:var(--font-display,monospace);font-size:13px;color:var(--gold,#ffcf4a);text-align:center;line-height:1.4}
.gb-dialog h3{margin:14px 0 8px;font-family:var(--font-display,monospace);font-size:10px;color:var(--ink-dim,#a79fc2);letter-spacing:.5px}
.gb-dialog p{margin:0 0 12px;font-size:15px;line-height:1.35;text-align:center}
.gb-chips{display:flex;gap:6px}
.gb-chips .gb-btn{flex:1;padding:0 4px}
.gb-field{display:flex;gap:6px;margin-top:8px}
.gb-input{flex:1;min-width:0;min-height:44px;border-radius:10px;border:2px solid var(--line,#4a4278);background:var(--bg-2,#1b1830);
  color:var(--ink,#f4efe6);font:16px var(--font-body,sans-serif);padding:0 10px;user-select:text;-webkit-user-select:text;touch-action:manipulation}
.gb-stack{display:flex;flex-direction:column;gap:6px}
.gb-stack>.gb-btn{width:100%}
.gb-slot{display:flex;gap:6px;align-items:center;padding:6px 6px 6px 10px;background:var(--bg-2,#1b1830);border-radius:12px}
.gb-slot-info{flex:1;min-width:0;font-size:13px;color:var(--ink-dim,#a79fc2);line-height:1.3}
.gb-slot-info b{display:block;font-family:var(--font-display,monospace);font-size:9px;color:var(--gold,#ffcf4a);font-weight:400;margin-bottom:3px}
.gb-row2{display:flex;gap:6px;margin-top:12px}
.gb-row2 .gb-btn{flex:1}
.gb-loading{position:absolute;inset:0;z-index:12;display:flex;align-items:center;justify-content:center;background:rgba(20,18,31,.72);
  font-family:var(--font-display,monospace);font-size:12px;color:var(--gold,#ffcf4a)}
.gb-hidden{display:none!important}
@media (prefers-reduced-motion:reduce){.gb-ticker-pill{transition:none}}
`;
