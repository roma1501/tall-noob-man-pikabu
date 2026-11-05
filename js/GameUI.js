// GameUI.js — интерфейс Tall Noob Run в стиле «рулетка-метр»: жёлтая лента с делениями, толстая тёмная
// обводка, надувные кнопки. Меню поверх живой сцены (Нуб смотрит в камеру), HUD (уровень, прогресс, рост,
// монеты), всплывающие числа у ворот, окна финиша/проигрыша, пауза и настройки. Тексты — Lang (data-t).

/** @satisfies {Record<string, any>} */
const UI = {
    /** @type {any} */ game: null,
    els: {},
    toastT: 0,
    pops: [],

    // Иконки — WebP из прошлых игр автора (ART-NOTES.md); рулетка — своя SVG.
    ICONS: {
        coin: '<img class="ico" src="assets/ui/icons/coin.webp" alt="">',
        gear: '<img class="ico" src="assets/ui/icons/gear.webp" alt="">',
        pause: '<img class="ico" src="assets/ui/icons/pause.webp" alt="">',
        bag: '<img class="ico" src="assets/ui/icons/shop.webp" alt="">',
        gift: '<img class="ico" src="assets/ui/icons/gift.webp" alt="">',
        wheel: '<img class="ico" src="assets/ui/icons/prize-wheel.webp" alt="">',
        up: '<img class="ico" src="assets/ui/icons/jump-arrow.webp" alt="">',
        coinsUp: '<img class="ico" src="assets/ui/icons/money-bag.webp" alt="">',
        ad: '<img class="ico" src="assets/ui/icons/watch-video.webp" alt="">',
        trophy: '<img class="ico" src="assets/ui/icons/trophy.webp" alt="">',
        sound: '<svg class="ico" viewBox="0 0 24 24"><path d="M3.5 9h4l5-4.2v14.4l-5-4.2h-4z" fill="#fff" stroke="#1B1B3A" stroke-width="2" stroke-linejoin="round"/><path class="snd-on" d="M15.5 8.6c1.8 1.9 1.8 4.9 0 6.8M18.2 6c3.2 3.4 3.2 8.6 0 12" fill="none" stroke="#1B1B3A" stroke-width="2.2" stroke-linecap="round"/><path class="snd-off" d="M15.5 9.2l5.3 5.6M20.8 9.2l-5.3 5.6" fill="none" stroke="#FF5D73" stroke-width="2.6" stroke-linecap="round"/></svg>',
        tape: '<svg viewBox="0 0 24 24" width="1em" height="1em"><rect x="2.5" y="5" width="15" height="14" rx="4" fill="#FFD23F" stroke="#1B1B3A" stroke-width="2"/><circle cx="10" cy="12" r="3" fill="#fff" stroke="#1B1B3A" stroke-width="1.8"/><path d="M17.5 15H22" stroke="#1B1B3A" stroke-width="3"/></svg>',
    },

    css: `
#ui{position:fixed;inset:0;pointer-events:none;z-index:20;font-family:'Rubik',system-ui,sans-serif;color:#fff;-webkit-tap-highlight-color:transparent;
 --tape:#FFD23F;--tape-dark:#E9B300;--ink:#1B1B3A;--coral:#FF5D73;--mint:#2EC4B6;--sky:#4CC9F0;--violet:#7B61FF;--paper:#FFFBEF}
#ui *{box-sizing:border-box}
#ui button{font-family:inherit;cursor:pointer;pointer-events:auto;-webkit-tap-highlight-color:transparent}
#ui .ico{width:1em;height:1em;object-fit:contain;display:inline-block;vertical-align:middle;-webkit-user-drag:none;pointer-events:none}
.adbtn{display:flex;align-items:center;justify-content:center;gap:8px}.adbtn .ico{font-size:1.5em}
.o{text-shadow:0 3px 0 var(--ink),3px 0 0 var(--ink),-3px 0 0 var(--ink),0 -3px 0 var(--ink),2px 2px 0 var(--ink),-2px 2px 0 var(--ink),2px -2px 0 var(--ink),-2px -2px 0 var(--ink),0 6px 0 rgba(27,27,58,.35)}
.os{text-shadow:0 2px 0 var(--ink),2px 0 0 var(--ink),-2px 0 0 var(--ink),0 -2px 0 var(--ink),1.5px 1.5px 0 var(--ink),-1.5px 1.5px 0 var(--ink),1.5px -1.5px 0 var(--ink),-1.5px -1.5px 0 var(--ink)}
.pill{border:3px solid var(--ink);border-radius:999px;background:var(--c,#fff);color:#fff;font-weight:900;box-shadow:inset 0 -6px 0 rgba(0,0,0,.18),inset 0 3px 0 rgba(255,255,255,.45),0 5px 0 var(--ink);transition:transform .08s}
.pill:active{transform:translateY(3px);box-shadow:inset 0 -3px 0 rgba(0,0,0,.18),0 2px 0 var(--ink)}
.pill[disabled]{filter:grayscale(.75) brightness(.9);opacity:.75}
.tapebtn{--c:var(--tape);color:var(--ink);position:relative;overflow:hidden}
.tapebtn::before{content:'';position:absolute;left:0;right:0;top:0;height:12px;background:repeating-linear-gradient(90deg,var(--ink) 0 2px,transparent 2px 12px);opacity:.55;pointer-events:none}
.tapebtn::after{content:'';position:absolute;left:0;right:0;top:0;height:7px;background:repeating-linear-gradient(90deg,var(--ink) 0 2px,transparent 2px 60px);pointer-events:none}
.chip{display:inline-flex;align-items:center;gap:7px;padding:5px 14px 5px 8px;border:3px solid var(--ink);border-radius:999px;background:rgba(255,255,255,.95);color:var(--ink);font-weight:900;box-shadow:0 4px 0 var(--ink)}
.chip svg{font-size:1.35em}
.scr{position:absolute;inset:0;display:none}.scr.on{display:block}
.round{width:54px;height:54px;padding:0;display:flex;align-items:center;justify-content:center;font-size:34px}
/* меню */
#m-top{position:absolute;left:max(12px,env(safe-area-inset-left));right:max(12px,env(safe-area-inset-right));top:max(12px,env(safe-area-inset-top));display:flex;justify-content:space-between;align-items:center}
#m-coins{font-size:22px}
#m-tr{display:flex;flex-direction:row;gap:8px;align-items:center}
#b-snd svg{width:32px;height:32px}#b-snd .snd-off{display:none}#b-snd.muted .snd-off{display:inline}#b-snd.muted .snd-on{display:none}
#lb-list{display:flex;flex-direction:column;gap:6px;max-height:min(46vh,380px);overflow-y:auto;overscroll-behavior:contain;padding:2px}
.lb-row{display:flex;align-items:center;gap:10px;padding:6px 12px 6px 8px;border:3px solid var(--ink);border-radius:14px;background:#fff;font-weight:800;font-size:16px}
.lb-row.me{background:var(--tape)}
.lb-r{flex:none;width:30px;text-align:center;font-weight:900;font-variant-numeric:tabular-nums}
.lb-a{flex:none;width:34px;height:34px;border-radius:50%;border:2px solid var(--ink);background:#d9d6ee center/cover no-repeat;display:flex;align-items:center;justify-content:center;font-weight:900;color:var(--ink)}
.lb-n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lb-s{flex:none;font-weight:900;font-variant-numeric:tabular-nums}
.lb-empty{text-align:center;font-weight:800;color:#6b6b86;padding:14px 0}
.hl-low #lb-list{max-height:40vh}.hl-low .lb-row{padding:3px 10px 3px 6px;font-size:14px}.hl-low .lb-a{width:26px;height:26px}
#m-title{position:absolute;left:50%;top:clamp(70px,11vh,120px);transform:translateX(-50%);text-align:center;line-height:.86;font-weight:900;white-space:nowrap}
#m-title.fit{left:0!important;top:0!important;transform-origin:0 0}#m-title.fit.left{text-align:left}#m-title.fit.left .tape{margin-left:0}
#m-title .a{display:block;font-size:clamp(46px,10vh,92px);color:var(--tape);letter-spacing:2px}
#m-title .b{display:block;font-size:clamp(34px,7vh,66px);letter-spacing:1px}
#m-title .tape{display:block;margin:10px auto 0;width:clamp(180px,30vh,320px);height:20px;border:3px solid var(--ink);border-radius:6px;background:var(--tape);
  background-image:repeating-linear-gradient(90deg,var(--ink) 0 2px,transparent 2px 10px),repeating-linear-gradient(90deg,var(--ink) 0 2px,transparent 2px 50px);background-size:100% 8px,100% 13px;background-repeat:no-repeat;box-shadow:0 4px 0 var(--ink)}
#m-level{display:inline-block;margin-top:14px;padding:4px 16px;border:3px solid var(--ink);border-radius:10px;background:var(--violet);font-size:clamp(16px,2.6vh,22px);font-weight:900;transform:rotate(-2deg)}
#m-bottom{position:absolute;left:50%;transform:translateX(-50%);bottom:max(16px,env(safe-area-inset-bottom));width:min(440px,92vw);display:flex;flex-direction:column;align-items:center;gap:14px}
#menu.shop-on #m-title,#menu.shop-on #m-bottom{opacity:0;visibility:hidden;transition:opacity .15s}
#m-ups{display:flex;gap:12px;width:100%;max-width:440px}
.up{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 6px 10px;border-radius:18px;--c:#fff;color:var(--ink);font-weight:900}
.up .ic{font-size:36px;line-height:1}
.up .nm{font-size:14px;text-transform:uppercase;letter-spacing:.5px}
.up .lv{font-size:12px;opacity:.7}
.up .pr{display:flex;align-items:center;gap:4px;font-size:17px}
#btn-run{width:100%;max-width:440px;font-size:clamp(28px,5vh,40px);padding:16px 0 14px;letter-spacing:2px}
#m-row{display:flex;gap:10px;justify-content:center;width:100%}
.ib{position:relative;flex:1 1 0;min-width:0;max-width:132px;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 6px 8px;border-radius:18px;--c:#fff;color:var(--ink);font-weight:900;font-size:13px;text-transform:uppercase;white-space:nowrap}
.ib>span:not(.ic){max-width:100%;overflow:hidden;text-overflow:ellipsis}
.ib .ic{font-size:40px;line-height:1}
.ib .bd{position:absolute;right:-6px;top:-6px;width:20px;height:20px;border-radius:50%;background:var(--coral);border:3px solid var(--ink);display:none}
.ib .bd.on{display:block;animation:bdp 1s infinite}
@keyframes bdp{50%{transform:scale(1.25)}}
/* HUD */
#hud{position:absolute;inset:0;display:none}#hud.on{display:block}
#h-top{position:absolute;left:max(10px,env(safe-area-inset-left));right:max(10px,env(safe-area-inset-right));top:max(10px,env(safe-area-inset-top));display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center}
#h-coins{font-size:20px}
#h-prog{position:relative;isolation:isolate;height:22px;margin:0 14px;border:3px solid var(--ink);border-radius:999px;background:rgba(255,255,255,.9);box-shadow:0 4px 0 var(--ink);overflow:visible}
#h-prog .fill{position:absolute;left:0;top:0;bottom:0;border-radius:999px;background:var(--tape);background-image:repeating-linear-gradient(90deg,var(--ink) 0 2px,transparent 2px 14px);background-size:100% 7px;background-repeat:no-repeat}
#h-prog .lv{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-weight:900;font-size:14px;line-height:1;white-space:nowrap;z-index:2;pointer-events:none}
#h-prog .dot{position:absolute;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:#F5CD30;border:3px solid var(--ink)}
#h-prog .fin{position:absolute;right:-6px;top:-8px;font-size:30px}
#h-power{position:absolute;left:50%;transform:translateX(-50%);top:calc(max(10px,env(safe-area-inset-top)) + 66px);width:min(260px,52vw);height:22px;display:flex;align-items:center;gap:6px}
#h-power .ico{font-size:30px;flex:none;filter:drop-shadow(0 2px 0 var(--ink))}
#h-power .bar{position:relative;flex:1;height:16px;border:3px solid var(--ink);border-radius:999px;background:rgba(255,255,255,.85);overflow:hidden;box-shadow:0 3px 0 var(--ink)}
#h-power .fill{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,var(--violet),#c86bff);transition:width .2s}
#h-power.giant .fill{background:repeating-linear-gradient(90deg,#FFD23F 0 12px,#ff9f1c 12px 24px);animation:gp .4s linear infinite}
#h-power.giant{animation:gb .5s ease-in-out infinite alternate}
@keyframes gp{to{background-position:24px 0}}@keyframes gb{to{transform:translateX(-50%) scale(1.08)}}
#flash{position:absolute;inset:0;background:radial-gradient(circle,rgba(255,255,255,.9),rgba(123,97,255,.4) 60%,transparent);opacity:0;pointer-events:none;transition:opacity .5s}
#flash.on{opacity:1;transition:none}
@media (max-width:560px){#h-power{left:max(12px,env(safe-area-inset-left));transform:none;width:calc(100vw - 200px)}}
.hl-low #h-power{top:calc(max(8px,env(safe-area-inset-top)) + 52px);width:min(200px,36vw)}
#h-height{position:absolute;right:max(12px,env(safe-area-inset-right));top:calc(max(10px,env(safe-area-inset-top)) + 74px);display:flex;align-items:center;gap:6px;padding:6px 14px 6px 10px;border:3px solid var(--ink);border-radius:12px;background:var(--tape);color:var(--ink);font-weight:900;font-size:22px;box-shadow:0 4px 0 var(--ink);font-variant-numeric:tabular-nums;transform-origin:right center}
#h-height svg{font-size:1.3em}
#h-vs{position:absolute;left:50%;transform:translateX(-50%);top:calc(max(10px,env(safe-area-inset-top)) + 64px);width:min(520px,92vw);display:none;align-items:flex-end;gap:8px;pointer-events:none}
#hud.fighting #h-vs{display:flex}
#hud.fighting #h-power,#hud.fighting #h-prog,#hud.fighting #h-height{visibility:hidden}
.vs-side{flex:1;display:flex;flex-direction:column;gap:3px;min-width:0}
.vs-side.boss{align-items:flex-end}
.vs-nm{font-weight:900;font-size:16px;color:#fff;letter-spacing:1px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:440px){.vs-nm{font-size:13px;letter-spacing:0}}
.vs-bar{position:relative;width:100%;height:20px;border:3px solid var(--ink);border-radius:999px;background:rgba(255,255,255,.85);overflow:hidden;box-shadow:0 3px 0 var(--ink)}
.vs-bar .fill{position:absolute;top:0;bottom:0;width:100%;transition:width .15s}
.me .vs-bar .fill{left:0;background:linear-gradient(90deg,#ff7a3d,#ffc9a4)}
.boss .vs-bar .fill{right:0;background:linear-gradient(270deg,#8d1b2e,#ff5d73)}
.vs-x{font-weight:900;font-size:30px;color:var(--tape);flex:none;line-height:1}
#h-tap{position:absolute;left:50%;bottom:max(30px,env(safe-area-inset-bottom));transform:translateX(-50%);display:none;align-items:center;gap:10px;font-weight:900;font-size:clamp(26px,4.6vh,42px);color:#fff;pointer-events:none;white-space:nowrap}
#hud.fighting #h-tap{display:flex}
#h-tap .hand{font-size:1.3em;animation:tp .45s ease-in-out infinite}
@keyframes tp{50%{transform:scale(.8) translateY(6px)}}
.hl-low #h-vs{top:max(8px,env(safe-area-inset-top));width:min(380px,52vw);gap:6px}.hl-low .vs-nm{font-size:12px}.hl-low .vs-bar{height:14px;border-width:2px}.hl-low .vs-x{font-size:22px}
.hl-low #h-tap{font-size:20px;bottom:max(6px,env(safe-area-inset-bottom))}
#h-height.bump{animation:hb .35s}
@keyframes hb{40%{transform:scale(1.25)}}
#pops{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.pop{position:absolute;font-weight:900;font-size:40px;white-space:nowrap;transform:translate(-50%,-50%);will-change:transform,opacity}
#toast{position:absolute;left:50%;top:30%;transform:translate(-50%,-50%) scale(.6);font-weight:900;font-size:clamp(24px,min(7vh,7.4vw),64px);line-height:1.05;opacity:0;transition:opacity .15s,transform .3s cubic-bezier(.2,1.7,.4,1);white-space:normal;text-align:center;width:max-content;max-width:min(92vw,900px)}
#toast.on{opacity:1;transform:translate(-50%,-50%) scale(1)}
#h-hint{position:absolute;left:50%;bottom:max(26px,env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;align-items:center;gap:10px;font-weight:900;font-size:clamp(20px,3.4vh,30px);opacity:0;transition:opacity .3s;pointer-events:none}
#h-hint.on{opacity:1}
#h-hint .hand{font-size:1.4em;animation:sw 1.2s ease-in-out infinite}
@keyframes sw{0%,100%{transform:translateX(-30px)}50%{transform:translateX(30px)}}
/* модальные */
.modal{background:rgba(20,20,48,.55)}
.card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(430px,92vw);max-height:92vh;overflow:auto;padding:24px 22px;display:flex;flex-direction:column;gap:16px;align-items:stretch;
  background:var(--paper);color:var(--ink);border:3px solid var(--ink);border-radius:22px;box-shadow:0 8px 0 rgba(27,27,58,.85);pointer-events:auto}
.card h2{margin:0;text-align:center;font-weight:900;font-size:clamp(28px,5vh,40px);color:var(--tape);line-height:1.05}
.card .pill{font-size:21px;padding:12px 16px 13px;text-align:center}
.res-mult{align-self:center;font-weight:900;font-size:clamp(46px,9vh,80px);color:var(--violet);line-height:1}
.res-coins{align-self:center;display:flex;align-items:center;gap:8px;font-weight:900;font-size:clamp(30px,6vh,46px)}
.res-sub{text-align:center;font-weight:700;font-size:16px;color:#4b4b6a}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:800;font-size:17px}
.row input[type=range]{flex:1;max-width:190px;accent-color:var(--violet)}
.row select{font:inherit;font-size:16px;padding:6px 8px;border:3px solid var(--ink);border-radius:10px;background:#fff;color:var(--ink)}
.ad-note{font-size:13px;font-weight:700;text-align:center;color:#6b6b86;margin-top:-8px}
#fade{position:absolute;inset:0;background:#141430;opacity:0;transition:opacity .3s;pointer-events:none}#fade.on{opacity:1}
/* альбомная ориентация: меню колонкой справа */
.hl-wide #m-title,.hl-land #m-title,.hl-low #m-title{left:max(24px,4vw);transform:none;text-align:left}
.hl-wide #m-title .tape,.hl-land #m-title .tape,.hl-low #m-title .tape{margin-left:0}
.hl-low #m-title{top:56px}.hl-low #m-title .a{font-size:44px}.hl-low #m-title .b{font-size:32px}.hl-low #m-level{margin-top:8px;font-size:15px}
.hl-low #m-bottom{gap:8px;bottom:8px;width:min(420px,60vw)}.hl-low .up{padding:4px 6px 6px}.hl-low .up .ic{font-size:20px}.hl-low .up .lv{display:none}
.hl-low #btn-run{padding:9px 0 8px;font-size:24px}.hl-low .ib{padding:4px 8px}.hl-low .ib .ic{font-size:22px}
.hl-low .card{gap:9px;padding:14px 18px;width:min(400px,72vw)}.hl-low .card h2{font-size:26px}.hl-low .card .pill{font-size:17px;padding:7px 12px 8px}
.hl-low .res-mult{font-size:40px}.hl-low .res-coins{font-size:28px}
.hl-low #h-height{top:calc(max(8px,env(safe-area-inset-top)) + 58px);font-size:18px}
`,

    init(game) {
        this.game = game;
        const st = document.createElement('style');
        st.textContent = this.css;
        document.head.appendChild(st);
        const I = this.ICONS, ui = document.createElement('div');
        ui.id = 'ui';
        ui.innerHTML = `
<div id="menu" class="scr">
  <div id="m-top"><div class="chip" id="m-coins">${I.coin}<span id="m-coins-v">0</span></div><div id="m-tr"><button class="pill round" id="b-set" style="--c:var(--violet)">${I.gear}</button><button class="pill round" id="b-lb" style="--c:var(--tape);display:none">${I.trophy}</button><button class="pill round" id="b-snd" style="--c:var(--sky);display:none">${I.sound}</button></div></div>
  <div id="m-title" class="o">${String(GAME_PLATFORM) === 'pikabu' ? '<span class="a">СТАНЬ</span><span class="b">ВЫШЕ</span>' : '<span class="a">TALL</span><span class="b">NOOB MAN</span>'}<span class="tape"></span><span id="m-level" class="os"></span></div>
  <div id="m-bottom">
    <div id="m-ups">
      <button class="pill up" id="up-h"><span class="ic">${I.up}</span><span class="nm" data-t="up.height"></span><span class="lv"></span><span class="pr">${I.coin}<b></b></span></button>
      <button class="pill up" id="up-c"><span class="ic">${I.coinsUp}</span><span class="nm" data-t="up.income"></span><span class="lv"></span><span class="pr">${I.coin}<b></b></span></button>
    </div>
    <button class="pill tapebtn" id="btn-run" data-t="menu.play"></button>
    <div id="m-row">
      <button class="pill ib" id="b-shop"><span class="ic">${I.bag}</span><span data-t="menu.shop"></span><i class="bd"></i></button>
      <button class="pill ib" id="b-daily"><span class="ic">${I.gift}</span><span data-t="menu.daily"></span><i class="bd" id="bd-daily"></i></button>
      <button class="pill ib" id="b-wheel"><span class="ic">${I.wheel}</span><span data-t="menu.wheel"></span><i class="bd" id="bd-wheel"></i></button>
    </div>
  </div>
</div>
<div id="hud">
  <div id="h-top"><div class="chip" id="h-coins">${I.coin}<span id="h-coins-v">0</span></div>
    <div id="h-prog"><span class="lv os" id="h-lv"></span><span class="fill" id="h-fill"></span><span class="dot" id="h-dot"></span><span class="fin">🏁</span></div>
    <button class="pill round" id="b-pause" style="--c:var(--sky)">${I.pause}</button></div>
  <div id="h-power"><img class="ico" src="assets/ui/icons/lightning.webp" alt=""><div class="bar"><span class="fill" id="h-power-f"></span></div></div>
  <div id="h-vs"><div class="vs-side me"><span class="vs-nm os" id="vs-me-n"></span><div class="vs-bar"><span class="fill" id="vs-me"></span></div></div><span class="vs-x o">VS</span><div class="vs-side boss"><span class="vs-nm os" id="vs-boss-n"></span><div class="vs-bar"><span class="fill" id="vs-boss"></span></div></div></div>
  <div id="h-tap" class="o"><span class="hand">👆</span><span data-t="fight.tap"></span></div>
  <div id="h-height">${I.tape}<span id="h-height-v">1.80 m</span></div>
  <div id="flash"></div>
  <div id="pops"></div>
  <div id="h-hint" class="o"><span class="hand">👆</span><span data-t="hud.drag"></span></div>
</div>
<div id="toast" class="o"></div>
<div id="win" class="scr modal"><div class="card">
  <h2 class="o" id="w-title"></h2>
  <div class="res-mult o" id="w-mult"></div>
  <div class="res-sub" id="w-sub"></div>
  <div class="res-coins">${I.coin}<span id="w-coins">0</span></div>
  <button class="pill" id="w-x3" style="--c:var(--violet)"></button>
  <div class="ad-note" id="w-x3-note"></div>
  <button class="pill tapebtn" id="w-next" data-t="win.next"></button>
</div></div>
<div id="lose" class="scr modal"><div class="card">
  <h2 class="o" id="l-title"></h2>
  <div class="res-sub" data-t="lose.hint"></div>
  <div class="res-coins">${I.coin}<span id="l-coins">0</span></div>
  <button class="pill" id="l-revive" style="--c:var(--mint)"></button>
  <div class="ad-note" id="l-revive-note"></div>
  <button class="pill tapebtn" id="l-retry" data-t="lose.retry"></button>
</div></div>
<div id="pause" class="scr modal"><div class="card">
  <h2 class="o" data-t="pause.title"></h2>
  <button class="pill tapebtn" id="p-resume" data-t="pause.resume"></button>
  <button class="pill" id="p-restart" style="--c:var(--sky)" data-t="pause.restart"></button>
  <button class="pill" id="p-menu" style="--c:var(--coral)" data-t="pause.menu"></button>
</div></div>
<div id="settings" class="scr modal"><div class="card">
  <h2 class="o" data-t="set.title"></h2>
  <label class="row"><span data-t="set.music"></span><input type="range" id="s-music" min="0" max="1" step="0.05"></label>
  <label class="row"><span data-t="set.sfx"></span><input type="range" id="s-sfx" min="0" max="1" step="0.05"></label>
  <label class="row" id="s-lang-row" style="display:none"><span data-t="set.lang"></span><select id="s-lang"><option value="en">English</option><option value="ru">Русский</option></select></label>
  <label class="row"><span data-t="set.quality"></span><select id="s-q"><option value="auto" data-t="set.q.auto"></option><option value="low" data-t="set.q.low"></option><option value="medium" data-t="set.q.medium"></option><option value="high" data-t="set.q.high"></option></select></label>
  <button class="pill" id="s-howto" style="--c:var(--mint)" data-t="set.howto"></button>
  <button class="pill tapebtn" id="s-close" data-t="set.close"></button>
</div></div>
<div id="board" class="scr modal"><div class="card">
  <h2 class="o" data-t="lb.title"></h2>
  <div class="res-sub" data-t="lb.sub"></div>
  <div id="lb-list"></div>
  <button class="pill" id="lb-login" style="--c:var(--sky);display:none" data-t="lb.login"></button>
  <button class="pill tapebtn" id="lb-close" data-t="set.close"></button>
</div></div>
<div id="fade"></div>`;
        document.body.appendChild(ui);
        const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
        for (const id of ['menu', 'hud', 'win', 'lose', 'pause', 'settings', 'toast', 'fade', 'pops', 'm-coins-v', 'm-level', 'up-h', 'up-c', 'h-coins-v', 'h-lv', 'h-fill', 'h-dot', 'h-height', 'h-height-v', 'h-hint', 'h-power', 'h-power-f', 'flash', 'vs-me', 'vs-boss', 'vs-me-n', 'vs-boss-n',
            'board', 'b-lb', 'lb-list', 'lb-login', 'b-snd', 's-lang', 's-lang-row', 'w-title', 'w-mult', 'w-sub', 'w-coins', 'w-x3', 'w-x3-note', 'l-title', 'l-coins', 'l-revive', 'l-revive-note', 's-music', 's-sfx', 's-q', 'bd-daily', 'bd-wheel']) this.els[id] = $(id);
        Lang.apply(ui);
        const click = (id, fn) => $(id).addEventListener('click', (e) => { e.stopPropagation(); Sound.play('assets/sounds/click.ogg', { volume: 0.6 }); fn(); });
        click('btn-run', () => game.adBreak(() => game.run()));
        click('up-h', () => game.buyUpgrade('h'));
        click('up-c', () => game.buyUpgrade('c'));
        click('b-shop', () => ShopUI.open('shop'));
        click('b-daily', () => ShopUI.open('daily'));
        click('b-wheel', () => ShopUI.open('wheel'));
        click('b-set', () => this.showSettings());
        click('b-lb', () => this.showBoard());
        click('b-snd', () => game.toggleMute());
        this.els['b-snd'].style.display = game.muteButton() ? '' : 'none';
        const lang = /** @type {HTMLSelectElement} */ (this.els['s-lang']);
        this.els['s-lang-row'].style.display = game.langChoice() ? '' : 'none';
        lang.addEventListener('change', () => game.setLang(lang.value, true));
        click('lb-close', () => { this.show('board', false); game.adBreak(); });
        click('lb-login', () => game.loginBoard());
        click('b-pause', () => game.setPaused(true));
        click('p-resume', () => game.adBreak(() => game.setPaused(false), true));
        click('p-restart', () => game.adBreak(() => { game.setPaused(false); game.restartLevel(); }, true));
        click('p-menu', () => game.adBreak(() => { game.setPaused(false); game.toMenu(); }, true));
        click('w-x3', () => game.rewardX3());
        click('w-next', () => game.next());
        click('l-revive', () => game.revive());
        click('l-retry', () => game.retry());
        click('s-howto', () => { this.show('settings', false); game.adBreak(() => game.howTo()); });
        click('s-close', () => { this.show('settings', false); game.adBreak(); });
        // реклама Playables (Game.adBreak): эти кнопки показывают её сами до перехода; вход — без рекламы
        for (const id of ['btn-run', 'w-next', 'l-retry', 'p-resume', 'p-restart', 'p-menu', 's-howto', 's-close', 'lb-close']) $(id).setAttribute('data-adbreak', '');
        for (const id of ['b-pause', 'lb-login']) $(id).setAttribute('data-noad', '');
        const mus = /** @type {HTMLInputElement} */ (this.els['s-music']), sfx = /** @type {HTMLInputElement} */ (this.els['s-sfx']);
        mus.addEventListener('input', () => { game.save.settings.music = Number(mus.value); game.applyVolumes(); game.persistSoon(); });
        sfx.addEventListener('input', () => { game.save.settings.sfx = Number(sfx.value); game.applyVolumes(); game.persistSoon(); });
        const q = /** @type {HTMLSelectElement} */ (this.els['s-q']);
        q.addEventListener('change', () => { Quality.set(q.value); game.save.settings.quality = q.value; game.persistSoon(); });
        for (const el of ui.querySelectorAll('button, input, select')) el.addEventListener('pointerdown', (e) => e.stopPropagation());
        // Esc закрывает окна (без preventDefault — требование Playables)
        window.addEventListener('keydown', (e) => {
            if (e.code !== 'Escape') return;
            if (this.els.board.classList.contains('on')) this.show('board', false);
            else if (this.els.settings.classList.contains('on')) this.show('settings', false);
            else if (this.els.pause.classList.contains('on')) game.setPaused(false);
        });
        window.addEventListener('lory-language', () => { Lang.apply(ui); this.updateMenu(); });
        window.addEventListener('resize', () => requestAnimationFrame(() => { this.layoutMenu(); this.shopStage(); }));
        // магазин открыт — герой в открытой части экрана (примерка видна в 3D), заголовок и кнопки меню там не мешают
        ShopUI.onOpen(() => requestAnimationFrame(() => this.shopStage()));
        ShopUI.onClose(() => this.shopStage());
    },

    // Сцена примерки: пока открыт магазин, камера меню кадрирует героя в части экрана, не закрытой окном
    // (ShopUI.freeArea: слева в альбоме, сверху в портрете), ниже верхней строки с монетами. Узкая полоса — не кадрируем
    // (на телефоне в портрете окно занимает почти весь экран, примерку показывает «зеркало» в окне).
    shopStage() {
        const open = ShopUI.isOpen(), fa = open ? ShopUI.freeArea() : null;
        let free = null;
        if (fa && (fa.w < 0.98 || fa.h < 0.98)) {
            const H = window.innerHeight || 1, top = document.getElementById('m-top');
            const y0 = top ? Math.min(0.3, (top.getBoundingClientRect().bottom + 8) / H) : 0.12;
            free = fa.w < 0.98 ? { top: y0, bottom: 0.97, left: 0.02, right: Math.max(0.1, fa.w - 0.02) }
                : { top: y0, bottom: Math.max(y0, fa.h - 0.01), left: 0.05, right: 0.95 };
            if (free.bottom - free.top < 0.16 || free.right - free.left < 0.14) free = null;
        }
        this.els.menu.classList.toggle('shop-on', !!free);
        if (typeof RunCam !== 'undefined') RunCam.shopFree = free;
    },

    show(id, on) {
        this.els[id].classList.toggle('on', !!on);
        if (id === 'menu' && on) this.layoutMenu();
    },

    // Меню без наложений на любом экране: заголовок — в свободной полосе между верхней строкой (монеты, кнопки)
    // и нижним блоком (портрет — по центру, альбом — слева, рядом с нижним блоком или над ним), масштаб — чтобы влез.
    // Оставшаяся полоса — для 3D-Нуба: камера меню кадрирует его в ней (RunCam.menuFree, доли холста).
    layoutMenu() {
        const $ = (id) => document.getElementById(id);
        const title = $('m-title'), top = $('m-top'), bottom = $('m-bottom');
        const cv = this.game && this.game.app && this.game.app.location ? this.game.app.location.view.world.canvas : null;
        if (!title || !top || !bottom || !cv || !this.els.menu.classList.contains('on')) return;
        const C = cv.getBoundingClientRect(), W = C.width, H = C.height;
        if (W < 50 || H < 50) return;
        title.classList.add('fit');
        title.style.transform = 'none';
        // естественный размер — по детям (наклонённая плашка уровня выходит за рамку контейнера)
        const o = title.getBoundingClientRect();
        let nr = 0, nb = 0;
        for (const k of title.children) { const q = k.getBoundingClientRect(); if (q.width > 0) { nr = Math.max(nr, q.right - o.left); nb = Math.max(nb, q.bottom - o.top); } }
        const n = { width: Math.max(1, nr), height: Math.max(1, nb) };
        const T = top.getBoundingClientRect(), B = bottom.getBoundingClientRect();
        const gap = 10, y0 = T.bottom - C.top + gap, y1 = B.top - C.top - gap;
        const portrait = W < H * 1.05;
        let s, x, y = y0, left = false, free;
        if (portrait) {
            s = Math.min(1, ((y1 - y0) * 0.42) / n.height, (W - 24) / n.width);
            x = (W - n.width * s) / 2;
            const tb = y + n.height * s + gap;
            free = { top: tb / H, bottom: y1 / H, left: 0.05, right: 0.95 };
        } else {
            left = true;
            // над нижним блоком (во всю левую половину) или сбоку от него (до низа экрана) — что крупнее
            const sideW = B.left - C.left - 24 - gap;
            const sA = Math.min(1, (y1 - y0) / n.height, (W * 0.46) / n.width);
            const sB = sideW > 60 ? Math.min(1, (H - y0 - 12) / n.height, sideW / n.width) : 0;
            s = Math.max(sA, sB);
            x = 24;
            const tr = x + n.width * s + gap;
            free = { top: y0 / H, bottom: y1 / H, left: Math.min(0.7, tr / W), right: 0.97 };
        }
        s = Math.max(0.3, s);
        title.classList.toggle('left', left);
        title.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px) scale(' + s.toFixed(3) + ')';
        // полоса для Нуба не меньше четверти экрана: иначе пусть заходит под кнопки, но будет виден
        if (free.bottom - free.top < 0.25) free.top = Math.max(0.04, free.bottom - 0.25);
        if (typeof RunCam !== 'undefined') RunCam.menuFree = free;
    },
    fade(on) { this.els.fade.classList.toggle('on', !!on); },
    anyModal() { return ['win', 'lose', 'pause', 'settings', 'board'].some(id => this.els[id].classList.contains('on')) || ShopUI.isOpen(); },

    // «Рекорды»: таблица лидерборда площадки (ник, аватар, пройдено уровней); кнопка входа — если площадка умеет.
    async showBoard() {
        const list = this.els['lb-list'];
        list.innerHTML = '<div class="lb-empty">' + Lang.t('lb.loading') + '</div>';
        this.els['lb-login'].style.display = Platform.canLogin() ? '' : 'none';
        this.show('board', true);
        const rows = await Platform.leaderboard({ avatarSize: 'small' });
        list.innerHTML = '';
        if (!rows || !rows.length) {
            const e = document.createElement('div');
            e.className = 'lb-empty'; e.textContent = Lang.t('lb.empty');
            list.appendChild(e);
            return;
        }
        for (const r of rows) {
            const row = document.createElement('div');
            row.className = 'lb-row' + (r.me ? ' me' : '');
            const name = String(r.name || '').trim() || Lang.t('lb.anon');
            const rk = document.createElement('span'); rk.className = 'lb-r'; rk.textContent = String(r.rank);
            const av = document.createElement('span'); av.className = 'lb-a';
            if (r.avatar) av.style.backgroundImage = 'url("' + String(r.avatar).replace(/["\\]/g, '') + '")'; else av.textContent = name.charAt(0).toUpperCase();
            const nm = document.createElement('span'); nm.className = 'lb-n'; nm.textContent = name;
            const sc = document.createElement('span'); sc.className = 'lb-s'; sc.textContent = Lang.t('up.lvl', { n: r.score });
            row.append(rk, av, nm, sc);
            list.appendChild(row);
        }
    },
    setMuted(on) { if (this.els['b-snd']) this.els['b-snd'].classList.toggle('muted', !!on); },

    // Кнопка «Рекорды» — только если площадка отдаёт таблицу.
    setBoardAvailable(on) { if (this.els['b-lb']) this.els['b-lb'].style.display = on ? '' : 'none'; },

    meters(cm) { return (cm / 100).toFixed(cm < 995 ? 2 : 1) + ' ' + Lang.t('hud.m'); },

    updateMenu() {
        const g = this.game;
        this.layoutMenu();
        this.els['m-coins-v'].textContent = String(g.coins());
        this.els['m-level'].textContent = Lang.t('menu.level', { n: g.levelNumber() });
        for (const [k, el] of [['h', this.els['up-h']], ['c', this.els['up-c']]]) {
            const lv = g.save.upgrades[k] || 0, max = g.upgradeMax(), cost = g.upgradeCost(k);
            el.querySelector('.lv').textContent = Lang.t('up.lvl', { n: lv + 1 });
            el.querySelector('.pr b').textContent = lv >= max ? Lang.t('up.max') : String(cost);
            /** @type {HTMLButtonElement} */ (el).disabled = lv >= max || g.coins() < cost;
        }
        const b = ShopUI.badges();
        this.els['bd-daily'].classList.toggle('on', !!b.daily);
        this.els['bd-wheel'].classList.toggle('on', !!b.wheel);
    },

    showSettings() {
        const s = this.game.save.settings;
        /** @type {HTMLInputElement} */ (this.els['s-music']).value = String(s.music);
        /** @type {HTMLInputElement} */ (this.els['s-sfx']).value = String(s.sfx);
        /** @type {HTMLSelectElement} */ (this.els['s-q']).value = s.quality || 'auto';
        /** @type {HTMLSelectElement} */ (this.els['s-lang']).value = Lang.code;
        this.show('settings', true);
    },

    toast(text, sec, color) {
        const t = this.els.toast;
        t.textContent = text; t.style.color = color || 'var(--tape)';
        t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
        this.toastT = sec || 1;
    },

    // Число у мировой точки: «+40», «−30».
    pop(text, worldPos, color) {
        const el = document.createElement('div');
        el.className = 'pop o'; el.textContent = text; el.style.color = color || '#fff';
        this.els.pops.appendChild(el);
        this.pops.push({ el, p: worldPos.slice(), t: 0 });
    },

    setPower(v, giant) {
        const f = this.els['h-power-f'];
        if (!f) return;
        f.style.width = (GM.clamp(v, 0, 1) * 100) + '%';
        this.els['h-power'].classList.toggle('giant', !!giant);
    },
    flash() { const f = this.els.flash; f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 60); },

    // Бой с боссом: показать полосы «ТЫ vs БОСС» и подсказку тапать; доли роста до нокаута 0..1.
    fight(on) { if (this.els.hud) this.els.hud.classList.toggle('fighting', !!on); },
    setFight(me, boss, meH, bossH, name) {
        if (!this.els['vs-me']) return;
        if (meH != null) this.els['vs-me-n'].textContent = Lang.t('fight.you') + ' · ' + this.meters(meH);
        if (bossH != null) this.els['vs-boss-n'].textContent = (name || Lang.t('fight.boss')) + ' · ' + this.meters(bossH);   // имя первым: при нехватке места обрежется рост
        this.els['vs-me'].style.width = (GM.clamp(me, 0, 1) * 100) + '%';
        this.els['vs-boss'].style.width = (GM.clamp(boss, 0, 1) * 100) + '%';
    },

    bumpHeight() { const h = this.els['h-height']; h.classList.remove('bump'); void h.offsetWidth; h.classList.add('bump'); },

    showWin(title, multText, sub, coins, canX3) {
        this.els['w-title'].textContent = title;
        this.els['w-mult'].textContent = multText;
        this.els['w-mult'].style.display = multText ? '' : 'none';
        this.els['w-sub'].textContent = sub;
        this.els['w-coins'].textContent = '+' + coins;
        const b = /** @type {HTMLButtonElement} */ (this.els['w-x3']);
        b.innerHTML = this.ICONS.ad + '<span></span>'; b.classList.add('adbtn');
        /** @type {HTMLElement} */ (b.querySelector('span')).textContent = Lang.t('win.x3', { n: coins * 3 });
        b.disabled = !canX3; b.style.display = '';
        this.els['w-x3-note'].textContent = canX3 ? '' : Lang.t('ad.unavailable');
        this.show('win', true);
    },
    setWinCoins(n, x3Used) {
        this.els['w-coins'].textContent = '+' + n;
        if (x3Used) { this.els['w-x3'].style.display = 'none'; this.els['w-x3-note'].textContent = ''; }
    },
    showLose(title, coins, canRevive) {
        this.els['l-title'].textContent = title;
        this.els['l-coins'].textContent = '+' + coins;
        const b = /** @type {HTMLButtonElement} */ (this.els['l-revive']);
        b.innerHTML = this.ICONS.ad + '<span></span>'; b.classList.add('adbtn');
        /** @type {HTMLElement} */ (b.querySelector('span')).textContent = Lang.t('lose.revive');
        b.disabled = !canRevive; b.style.display = '';
        this.els['l-revive-note'].textContent = canRevive ? '' : Lang.t('ad.unavailable');
        this.show('lose', true);
    },

    // Кадр HUD.
    frame(dt) {
        const g = this.game, r = g.runner;
        if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.els.toast.classList.remove('on'); }
        if (!r) return;
        if (g.state !== 'menu') {
            this.els['h-coins-v'].textContent = String(r.collected);
            const p = GM.clamp((r.pos[2] - Level.start.z) / Math.max(1, Level.length), 0, 1);
            this.els['h-fill'].style.width = (p * 100) + '%';
            this.els['h-dot'].style.left = (p * 100) + '%';
            this.els['h-lv'].textContent = Lang.t('menu.level', { n: g.levelNumber() });
            this.els['h-height-v'].textContent = this.meters(r.heightPx());
        }
        // всплывающие числа
        const view = g.app.location.view;
        for (let i = this.pops.length - 1; i >= 0; i--) {
            const o = this.pops[i];
            o.t += dt;
            const s = view.projectToScreen(o.p[0], o.p[2], o.p[1] + o.t * 160);
            const a = o.t < 0.15 ? o.t / 0.15 : Math.max(0, 1 - (o.t - 0.6) / 0.5);
            o.el.style.left = s.x + 'px'; o.el.style.top = s.y + 'px';
            o.el.style.opacity = s.behind ? '0' : String(a);
            o.el.style.transform = 'translate(-50%,-50%) scale(' + (0.7 + Math.min(1, o.t * 6) * 0.5) + ')';
            if (o.t > 1.15) { o.el.remove(); this.pops.splice(i, 1); }
        }
    },
};
