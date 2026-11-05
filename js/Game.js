// Game.js — Tall Noob Run: раннер по мотивам Tall Man Run. Нуб бежит сам, игрок рулит пальцем/мышью/клавишами,
// ворота меняют рост и ширину (Нуб тянется с пружинным отскоком), пилы режут, стены ломаются (физика), маятники
// бьют, на финише — линейка-множитель или босс (выше — сбиваешь его, ниже — летишь сам: рэгдолл).
// Анимация — Motion Matching по синтезированной базе (GameMotionDB/GameMotion), шаг масштабируется ростом.
// Магазин, Daily Gift, колесо — GameShopUI/GameCosmetics (логика движка Shop/DailyGift/Wheel).
// Реклама — по правилам Platform.ads (interstitial после двух раундов по кнопке перехода) и rewarded по согласию;
// в Playables interstitial запрашивается в каждой естественной паузе (adBreak), частоту решает YouTube.

/** @satisfies {Record<string, any>} */
const Game = {
    /** @type {LoryApp | null} */ app: null,
    save: null,
    state: 'menu',                 // menu | play | win | lose
    /** @type {Runner | null} */ runner: null,
    boss: null,
    levels: [],
    mapIndex: 0,
    reward: 0, x3Used: false, roundDone: false, loseReason: '', revived: false,
    drag: null, steerAccum: 0,
    resultT: 0, pending: null,
    _persistT: 0,
    time: 0,
    timeScale: 1, slowT: 0, hitT: 0,        // слоу-мо (финал): масштаб времени мира и сколько осталось (реальные с)

    cfgX() {
        const U = 'undefined';
        return {
            slowmo: typeof RUN_SLOWMO !== U ? RUN_SLOWMO : 0.3,
            slowmoTime: typeof RUN_SLOWMO_TIME !== U ? RUN_SLOWMO_TIME : 1.1,
        };
    },
    slowMo(sec) { this.slowT = sec != null ? sec : this.cfgX().slowmoTime; },

    cfg() {
        const U = 'undefined';
        return {
            startH: typeof RUN_START_HEIGHT !== U ? RUN_START_HEIGHT : 180,
            hStep: typeof RUN_UPGRADE_HEIGHT_STEP !== U ? RUN_UPGRADE_HEIGHT_STEP : 12,
            cStep: typeof RUN_UPGRADE_COINS_STEP !== U ? RUN_UPGRADE_COINS_STEP : 0.1,
            upMax: typeof RUN_UPGRADE_MAX !== U ? RUN_UPGRADE_MAX : 20,
            upBase: typeof RUN_UPGRADE_BASE_COST !== U ? RUN_UPGRADE_BASE_COST : 40,
            upGrowth: typeof RUN_UPGRADE_COST_GROWTH !== U ? RUN_UPGRADE_COST_GROWTH : 1.35,
            finishBase: typeof RUN_FINISH_BASE !== U ? RUN_FINISH_BASE : 20,
            bossReward: typeof RUN_BOSS_REWARD !== U ? RUN_BOSS_REWARD : 0.12,
        };
    },

    // ---- запуск -----------------------------------------------------------------------------------
    async init(app) {
        this.app = app;
        // сохранение: ошибка облака — наверх (экран загрузки с «Повторить»), перезаписывать нельзя
        const data = await Platform.load();
        this.save = this.migrate(data);
        if (this.langChoice() && this.save.settings.lang && this.save.settings.lang !== Lang.code) this.setLang(this.save.settings.lang, false);
        if (this.save.settings.quality && this.save.settings.quality !== Quality.choice) Quality.set(this.save.settings.quality);
        World3D.setOutlines(false);                     // без обводки и контура рёбер
        World3D.setOverrides({ fog: 0.00008 });         // длинная трасса: туман реже
        app.loading.set(82);
        await new Promise(r => setTimeout(r, 0));
        MotionDB.build();
        app.loading.set(88);
        const view = app.location.view;
        this.runner = new Runner(this, view);
        this.makeBoss(view);
        this.levels = app.maps.filter(m => /^level-\d+$/.test(m.id));
        if (!this.levels.length) this.levels = app.maps.slice(0, 1);
        for (const m of this.levels) this.clearFightView(m);
        this.mapIndex = this.save.level % this.levels.length;
        const want = this.levels[this.mapIndex];
        if (app.location.map.id !== want.id) {
            await app.location.loadMap(Location3D.copyMap(want));
            app.camera.setTerrain(app.location.terrain, { w: app.location.width, h: app.location.height });
        }
        RunCam.init(app);
        HudLayout.init({ app });
        Input.init({
            app, mouse: 'none', camera: false, touch: false,
            actions: {
                left: { keys: ['KeyA', 'ArrowLeft'], pad: [14] }, right: { keys: ['KeyD', 'ArrowRight'], pad: [15] },
                forward: { keys: ['KeyW', 'ArrowUp'], pad: [12] }, back: { keys: ['KeyS', 'ArrowDown'], pad: [13] },
                go: { keys: ['Space', 'Enter'], pad: [0] }, pause: { keys: ['KeyP'], pad: [9], rebind: false },
            },
        });
        this.bindDrag(app.location.view.world.canvas);
        UI.init(this);
        try { ShopUI.init(this); } catch (e) { console.warn('ShopUI.init:', e); }
        // кошелёк — Shop; если окно магазина ещё не подключило модуль, завести его самим (каталог может быть пуст)
        if (!Shop.state) Shop.init({ tabs: SHOP_TABS, items: SHOP_ITEMS, state: this.save.shop, persist: () => this.persistSoon() });
        // состояния модулей — части ОДНОГО сохранения (модули правят их на месте)
        this.save.shop = Shop.state;
        if (DailyGift.state) this.save.daily = DailyGift.state;
        if (Wheel.state) this.save.wheel = Wheel.state;
        this.hookAdBreaks();
        Shop.on((e) => { if (e.type === 'coins' && this.state === 'menu') UI.updateMenu(); if (e.type === 'equip' || e.type === 'unequip' || e.type === 'preview' || e.type === 'grant') this.cosmetics('apply', this.look()); });
        this.cosmetics('apply', this.look());
        this.initTutorial();
        this.applyVolumes();
        if (app.fx) {
            app.fx.register('burst', [{ texture: 'assets/fx/confetti.webp', spin: [-6, 6], burst: 26, capacity: 30, life: [0.4, 0.8], size: [8, 18], speed: [180, 420], direction: [[-1, 0.6, -1], [1, 1.4, 1]], color: '#ffffff', alpha: 1, blend: 'standard', gravity: [0, -700, 0], duration: 0.08 }]);
            app.fx.register('dust', [{ texture: 'assets/fx/smoke.webp', burst: 14, capacity: 16, life: [0.4, 0.8], size: [14, 30], speed: [60, 160], direction: [[-1, 0.2, -1], [1, 0.8, 1]], color: '#efe6d2', alpha: 0.6, blend: 'standard', gravity: [0, 40, 0], duration: 0.08, sizeGradient: [[0, 0.6], [1, 1.8]] }]);
        }
        Sound.music('assets/sounds/music.ogg', { volume: 0.7 });   // своя тема игры (tools/compose-theme.py), без суббаса
        this.buildLevel();
    },

    async ready() {
        this.toMenu();
        this.checkBoard();
        this.update(1 / 60);
        RunCam.snap();
    },

    migrate(data) {
        const s = Object.assign({ v: 1, level: 0, tutorialDone: false, best: 0 }, data && typeof data === 'object' ? data : {});
        s.upgrades = Object.assign({ h: 0, c: 0 }, s.upgrades || {});
        s.settings = Object.assign({ music: 0.6, sfx: 0.9, quality: 'auto' }, s.settings || {});
        s.level = Math.max(0, Math.floor(Number(s.level) || 0));
        return s;
    },
    // Запись сохранения: если ничего не изменилось с прошлой записи — не пишем (Playables хранит каждую запись
    // saveData в localStorage тестового окружения; лишние записи там упираются в квоту).
    persist() {
        this._persistT = 0;
        let json = '';
        try { json = JSON.stringify(this.save); } catch (e) { json = ''; }
        if (json && json === this._savedJson) return Promise.resolve(true);
        return Platform.save(this.save).then((ok) => { if (ok) this._savedJson = json; return ok; });
    },
    persistSoon() { if (!(this._persistT > 0)) this._persistT = 2; },

    applyVolumes() {
        const s = this.save.settings;
        if (!this._baseVolume) this._baseVolume = Sound._volume.bind(Sound);
        const base = this._baseVolume;
        Sound._volume = (kind) => (s.muted ? 0 : base(kind) * (kind === 'music' ? s.music : s.sfx));
        Sound._sync();
        UI.setMuted(!!s.muted);
    },
    toggleMute() {
        this.save.settings.muted = !this.save.settings.muted;
        this.applyVolumes();
        this.persistSoon();
    },
    // Кнопка звука — везде, кроме Playables (там свой выключатель у YouTube, своя кнопка запрещена).
    muteButton() { return typeof GAME_PLATFORM === 'undefined' || String(GAME_PLATFORM) !== 'playables'; },
    // Выбор языка в настройках — только Playgama (на Яндексе переключателя нет: язык площадки). Хранится в сохранении игры.
    langChoice() { return typeof GAME_PLATFORM !== 'undefined' && String(GAME_PLATFORM) === 'playgama'; },
    setLang(code, persist) {
        if (!LANG_STRINGS[code]) return;
        Lang.code = code;
        document.documentElement.lang = code;
        Lang.apply();
        window.dispatchEvent(new Event('lory-language'));
        if (persist) { this.save.settings.lang = code; this.persistSoon(); }
    },

    // Для косметики (контракт docs/shop-contract.md).
    get model() { return this.runner ? this.runner.model : null; },
    runnerPos() { const r = this.runner; return r ? [r.pos[0], r.pos[1], r.pos[2]] : [0, 0, 0]; },
    runnerHeight() { return this.runner ? this.runner.hs[0] : 180; },

    levelNumber() { return this.save.level + 1; },
    startHeight() { const c = this.cfg(); return c.startH + (this.save.upgrades.h || 0) * c.hStep; },
    income() { const c = this.cfg(); return 1 + (this.save.upgrades.c || 0) * c.cStep; },
    upgradeMax() { return this.cfg().upMax; },
    upgradeCost(k) { const c = this.cfg(); return Math.round(c.upBase * Math.pow(c.upGrowth, this.save.upgrades[k] || 0) * (k === 'c' ? 1.25 : 1)); },
    buyUpgrade(k) {
        if (this.state !== 'menu' || (this.save.upgrades[k] || 0) >= this.upgradeMax()) return;
        const cost = this.upgradeCost(k);
        if (!Shop.state || !Shop.spend(cost, { save: false })) return;
        this.save.upgrades[k] = (this.save.upgrades[k] || 0) + 1;
        Sound.play('assets/sounds/reward.ogg', { volume: 0.6 });
        if (k === 'h') { this.runner.setHeight(this.startHeight()); this.runner.hs[1] += 200; }
        this.persist();
        UI.updateMenu();
    },

    // ---- уровень ------------------------------------------------------------------------------------
    buildLevel() {
        Phys.reset(this.app.location.terrain);
        Level.build(this.app);
        this.runner.reset(this.startHeight());
        this.resetBoss();
        this.cosmetics('apply', this.look());
        RunCam.snap();
    },
    // Косметика (GameCosmetics.js): сбой в ней не должен ронять забег.
    cosmetics(op, arg) {
        if (typeof Cosmetics === 'undefined') return;
        try { if (op === 'apply') Cosmetics.apply(this, arg); else Cosmetics.update(arg, this); }
        catch (e) { if (!this._cosWarned) { this._cosWarned = true; console.warn('Cosmetics:', e); } }
    },
    look() { try { return Shop.state ? Shop.look() : {}; } catch (e) { return {}; } },
    coins() { return Shop.state ? Shop.coins : 0; },

    async loadLevel(index) {
        this.mapIndex = index % this.levels.length;
        const map = this.levels[this.mapIndex];
        UI.show('win', false); UI.show('lose', false);
        await this.app.loadMap(map.id, { prepare: async () => { this.buildLevel(); }, label: Lang.t('menu.level', { n: this.levelNumber() }) });
    },

    toMenu() {
        if (Tutorial.active) Tutorial.finish('abort');
        this.state = 'menu';
        RunCam.mode = 'menu';
        UI.show('hud', false); UI.show('win', false); UI.show('lose', false); UI.show('pause', false);
        UI.show('menu', true);
        if (this.runner.phase !== 'idle') this.buildLevel();
        UI.updateMenu();
        Platform.gameplay(false);
        Tutorial.whenIdle(() => ShopUI.maybeOfferDaily());
    },

    run() {
        if (this.state !== 'menu' || ShopUI.isOpen()) return;
        this.state = 'play';
        this.roundDone = false; this.revived = false; this.x3Used = false;
        UI.show('menu', false); UI.show('hud', true);
        RunCam.mode = 'run';
        this.runner.start();
        UI.toast(Lang.t('toast.go'), 0.7, 'var(--mint)');
        Platform.gameplay(true);
        Telemetry.progress('started', this.stepId(), { step_index: this.levelNumber() });
        if (this.save.level === 0) Tutorial.autoStart();
        this.tutRound = Tutorial.active;   // обучающий забег — не раунд (реклама, рекорд), даже если обучение закончится на финише
        UI.els['h-hint'].classList.toggle('on', !Tutorial.active && this.save.level < 2);
        this.steerAccum = 0;
    },

    howTo() {
        if (this.state !== 'menu') this.toMenu();
        this.run();
        Tutorial.start({ replay: true });
    },

    restartLevel() {
        this.buildLevel();
        this.state = 'menu';
        this.run();
    },

    setPaused(on) {
        if (this.state !== 'play') return;
        Pause.set('manual', !!on);
        UI.show('pause', !!on);
    },

    // ---- финал и итоги ------------------------------------------------------------------------------
    onFinish() {
        RunCam.mode = 'finale';
        UI.els['h-hint'].classList.remove('on');
        Tutorial.complete('goal');
        // дальше — бой с боссом: карточка обучения не должна закрывать полосы боя
        if (Tutorial.active) Tutorial.finish('done');
    },
    roundCounts() { return !this.tutRound && Tutorial.roundCounts(); },

    finishRuler(r, m) {
        const c = this.cfg();
        this.reward = Math.round((r.collected + c.finishBase) * m.mult * this.income());
        Sound.play('assets/sounds/win.ogg', { volume: 0.7 });
        UI.toast('×' + m.mult, 1.4, 'var(--tape)');
        if (m.mult >= 4) this.slowMo(0.8);
        RunCam.shake(4, 0.3);
        if (this.app.fx) this.app.fx.play('burst', [r.pos[0], Level.roadY + r.hs[0], r.pos[2]]);
        this.pending = { t: 1.7, fn: () => this.showWin(Lang.t('win.title'), '×' + m.mult, Lang.t('win.sub.ruler', { h: UI.meters(r.H), m: m.mult })) };
    },

    // Итог боя (GameFight.js): нокаут уже отправил проигравшего в полёт. fight — состояние боя.
    finishBoss(r, win, fight) {
        const c = this.cfg(), b = Level.boss;
        Sound.play('assets/sounds/punch.ogg', { volume: 1, rate: 0.8 });
        RunCam.shake(12, 0.5);
        this.slowMo();
        UI.flash();
        if (win) {
            const flawless = fight && fight.taken === 0;
            this.reward = Math.round((r.collected + c.finishBase + b.height * c.bossReward) * this.income() * (flawless ? 1.5 : 1));
            UI.toast(Lang.t(flawless ? 'fight.flawless' : 'fight.ko'), 1.6, 'var(--tape)');
            Sound.play('assets/sounds/win.ogg', { volume: 0.7 });
            this.pending = { t: 2.4, fn: () => this.showWin(Lang.t('win.boss'), flawless ? '×1.5' : '', Lang.t('win.sub.boss', { h: UI.meters(fight ? fight.pH0 : r.H), b: UI.meters(b.height) })) };
        } else {
            UI.toast(Lang.t('fight.ko'), 1.4, 'var(--coral)');
            Sound.play('assets/sounds/oof.ogg', { volume: 0.9 });
            this.pending = { t: 2.2, fn: () => this.lose('boss') };
        }
    },

    endRound(win) {
        if (this.roundDone) return;
        this.roundDone = true;
        Platform.gameplay(false);
        if (this.roundCounts()) Platform.ads.roundEnded(!!win);
    },

    showWin(title, mult, sub) {
        this.state = 'win';
        const counts = this.roundCounts();
        this.endRound(true);
        Telemetry.progress('completed', this.stepId(), { step_index: this.levelNumber() });
        Shop.addCoins(this.reward, { save: false });
        this.save.level += 1;
        this.save.best = Math.max(this.save.best || 0, this.save.level);
        // рекорд «Рекорды» — пройдено уровней; после каждого раунда (и поражения), кроме обучения
        if (counts) Platform.submitScore(this.save.level);
        this.persist();
        UI.showWin(title, mult, sub, this.reward, Platform.rewardedSupported());
        Sound.play('assets/sounds/reward.ogg', { volume: 0.5 });
    },

    async rewardX3() {
        if (this.x3Used || this.state !== 'win' || this._adBusy) return;
        this._adBusy = true;
        const ok = await Platform.rewarded('x3-coins');
        this._adBusy = false;
        if (!ok || this.x3Used) return;
        this.x3Used = true;
        Shop.addCoins(this.reward * 2, { save: false });
        this.persist();
        UI.setWinCoins(this.reward * 3, true);
        Sound.play('assets/sounds/reward.ogg', { volume: 0.7 });
    },

    next() {
        if (this.state !== 'win' || this._going) return;
        this._going = true;
        const go = async () => {
            try { await this.loadLevel(this.save.level); this.toMenu(); } finally { this._going = false; }
        };
        if (this.adBreaks()) this.adBreak(go); else Platform.ads.next(go);
    },

    // ---- межстраничная реклама в естественных паузах ----------------------------------------------
    // Playables: частоту показа решает YouTube, поэтому реклама запрашивается на КАЖДОЙ кнопке вне активного забега
    // (просьба модерации): меню, магазин, подарок, колесо, настройки, рекорды, пауза, итог раунда. Кнопки с переходом
    // (data-adbreak: «Бежать», «Дальше», «Ещё раз», кнопки паузы, закрытие окон) показывают рекламу ДО действия, прочие —
    // сразу после нажатия. Не во время забега, не на первом (обучающем) забеге, не на кнопках рекламы за награду и не
    // в течение 20 с после неё; data-noad — без рекламы (вход, «Забрать» подарка и «Крутить» — реклама после анимации).
    // Остальные площадки — правило двух раундов (Platform.ads.next).
    adBreaks() { return typeof GAME_PLATFORM !== 'undefined' && String(GAME_PLATFORM) === 'playables' && Platform.interstitialSupported(); },
    async adBreak(go, inPause, calmNow) {
        if (this._breakBusy) return;   // реклама уже запрошена: повторное нажатие не обгоняет её
        const calm = calmNow != null ? calmNow : inPause ? Pause.has('manual') : this.state !== 'play';
        const ok = this.adBreaks() && calm && !this._rewardBusy && !Pause.has('ad') && !Pause.has('adwait') && !Pause.has('platform')
            && Date.now() - (this._rewardAt || 0) > 20000 && (this.save.tutorialDone || this.save.level > 0);
        if (ok) {
            this._breakBusy = true;
            try { await Platform.interstitial(); } catch (e) { /* рекламы нет — дальше без задержки */ } finally { this._breakBusy = false; }
        }
        if (go) await go();
    },
    hookAdBreaks() {
        // время последней рекламы за награду (любой: x3, «ещё жизнь», магазин, подарок, колесо)
        const rewarded = Platform.rewarded.bind(Platform);
        Platform.rewarded = async (id) => {
            this._rewardBusy = true;
            try { return await rewarded(id); } finally { this._rewardBusy = false; this._rewardAt = Date.now(); }
        };
        DailyGift.on((e) => { if (e.type === 'claim') setTimeout(() => this.adBreak(), 1500); });
        Wheel.on((e) => { if (e.type === 'prize') setTimeout(() => this.adBreak(), 1500); });
        ShopUI.onClose(() => this.adBreak());
        if (!this.adBreaks() || typeof document === 'undefined') return;
        // любая кнопка (и выбор в настройках) вне забега: «спокойно» ли — по моменту нажатия; запрос — после обработчика
        // кнопки (кнопка рекламы за награду к этому времени уже подняла _rewardBusy)
        const press = (e) => {
            const t = /** @type {any} */ (e.target), b = t && t.closest ? t.closest('button, select') : null;
            if (!b || b.disabled || b.closest('[data-noad]') || b.closest('[data-adbreak]')) return;
            if (e.type === 'click' && b.tagName === 'SELECT') return;
            const calm = this.state !== 'play' || Pause.has('manual');
            if (calm) setTimeout(() => this.adBreak(null, false, true), 80);
        };
        document.addEventListener('click', press, true);
        document.addEventListener('change', press, true);
    },

    lose(reason) {
        if (this.state === 'lose') return;
        this.state = 'lose';
        this.loseReason = reason;
        const counts = this.roundCounts();
        this.endRound(false);
        Telemetry.progress('failed', this.stepId(), { step_index: this.levelNumber(), reason });
        if (counts) Platform.submitScore(this.save.level);
        const r = this.runner;
        this.reward = Math.round(r.collected * this.income());
        Shop.addCoins(this.reward, { save: false });
        this.persist();
        Sound.play('assets/sounds/lose.ogg', { volume: 0.7 });
        // «+1 м за рекламу» — не после каждого поражения: только если забег прошёл полпути (или дошёл до босса)
        // и прошлое поражение такого предложения не показывало
        const far = reason === 'boss' || (r.pos[2] - Level.start.z) / Math.max(1, Level.length) >= 0.5;
        const offer = Platform.rewardedSupported() && !this.revived && far && !this._reviveOffered;
        this._reviveOffered = offer;
        const show = () => UI.showLose(Lang.t(reason === 'boss' ? 'lose.boss' : 'lose.small'), this.reward, offer);
        if (reason === 'small') { r.phase = 'done'; r.speed = 0; this.pending = { t: 0.9, fn: show }; } else show();
    },

    async revive() {
        if (this.state !== 'lose' || this.revived || this._adBusy) return;
        this._adBusy = true;
        const ok = await Platform.rewarded('revive');
        this._adBusy = false;
        if (!ok || this.revived) return;
        this.revived = true;
        UI.show('lose', false);
        const r = this.runner;
        // продолжение: +1 м; у босса — разбег заново
        if (this.loseReason === 'boss') {
            r.ragdoll = null;
            r.setHeight(r.H + 100); r.hs[0] = r.H;
            GM.set(r.pos, Level.roadX, Level.roadY, Level.finish.z + 60);
            r.mm.reset(r.pos, Math.PI / 2);
            r.finale = null; r.phase = 'run'; r.speed = 0; r.targetX = Level.roadX;
            this.resetBoss();
        } else {
            r.setHeight(Math.max(r.H + 100, 180));
            r.hs[1] += 250;
            r.phase = 'run';
        }
        this.state = 'play'; this.roundDone = false;
        RunCam.mode = 'run';
        Platform.gameplay(true);
        Sound.play('assets/sounds/reward.ogg', { volume: 0.7 });
    },

    retry() {
        if (this.state !== 'lose' || this._going) return;
        this._going = true;
        const go = () => { this._going = false; UI.show('lose', false); this.restartLevel(); };
        if (this.adBreaks()) this.adBreak(go); else Platform.ads.next(go);
    },

    // ---- рекорды и вход -------------------------------------------------------------------------------
    // Кнопка «Рекорды» — если площадка отдаёт таблицу (Яндекс, Playgama in_game); иначе спрятана.
    async checkBoard() {
        try { UI.setBoardAvailable((await Platform.leaderboard()) !== null); } catch (e) { UI.setBoardAvailable(false); }
    },
    // «Войдите в аккаунт» в окне рекордов: окно входа только по нажатию. После входа — облачное сохранение:
    // если в аккаунте прогресс дальше, перезапуск с ним; иначе текущий прогресс уезжает в аккаунт.
    async loginBoard() {
        if (this._logging) return;
        this._logging = true;
        try {
            if (!(await Platform.login())) return;
            const cloud = this.migrate(await Platform.load());
            if (cloud.level > this.save.level) { location.reload(); return; }
            this.persist();
            Platform.submitScore(this.save.level);
            UI.showBoard();
        } catch (e) { console.warn('login:', e); } finally { this._logging = false; }
    },
    // Шаг воронки телеметрии: ограниченный id карты уровня (level_1 … level_12), номер — в step_index.
    stepId() { return 'level_' + (this.mapIndex + 1); },

    // ---- босс ----------------------------------------------------------------------------------------
    // Бой с боссом снимается сбоку (камера слева от ринга, −x): декор в этом коридоре и прямо за рингом убирается
    // при загрузке, чтобы деревья не заслоняли и не сливались с бойцами. В файле карты и в редакторе он остаётся.
    clearFightView(map) {
        const objs = map.objects || [];
        const boss = objs.find(o => o.kind === 'marker' && /^boss(-\d+)?$/.test(o.name || ''));
        if (!boss) return;
        // слева — между камерой и рингом; справа — сразу за рингом (фон за бойцами без деревьев)
        map.objects = objs.filter(o => !(o.kind === 'prop' && ((o.x < boss.x - 330 && Math.abs(o.y - boss.y) < 1800) || (o.x > boss.x + 330 && Math.abs(o.y - boss.y) < 900))));
    },
    makeBoss(view) {
        const model = Noob.build(view);
        // босс-задира: серо-лиловая кожа, чёрная майка, бордовые штаны, сердитое лицо
        model.mats.blue.diffuseColor = BABYLON.Color3.FromInts(43, 45, 66);
        model.mats.green.diffuseColor = BABYLON.Color3.FromInts(141, 27, 46);
        model.mats.yellow.diffuseColor = BABYLON.Color3.FromInts(176, 160, 196);
        for (const k of ['blue', 'green', 'yellow']) model.mats[k].emissiveColor = model.mats[k].diffuseColor.scale(0.16);
        Noob.dress(model, { hero: false, nose: true });   // без волос, наушников и рюкзака героя: свой вид — снаряжение по типу
        if (model.face) model.face.material = this.angryFace(view.scene);
        const gear = this.bossGear(view, model);
        const shield = this.bossShield(view);
        const mm = new MotionController(model);
        mm.cfg.lookAtCamera = 0;
        const sim = {
            pos: [0, 0, 0], vel: [0, 0, 0], groundVel: [0, 0, 0], groundSpin: 0, sx: { v: 0, a: 0 }, sz: { v: 0, a: 0 }, desired: [0, 0],
            facing: { x: -Math.PI / 2, v: 0 }, facingGoal: -Math.PI / 2, hlVel: 0.3, hlRot: 0.2, grounded: true, airTime: 0, jumpT: 9, impact: 0,
            pushW: 0, camYaw: null, camPitch: 0, ragdoll: null,
            ground: (x, z, yTop) => this.runner.ground(x, z, yTop),
        };
        this.boss = { model, mm, sim, rag: null, body: Noob.BODY1, on: false, gear, shield, type: Fight.TYPES[0] };
    },
    // Снаряжение на голове босса (по типу): повязка шустрика, каска подрывника, шлем щитоносца, рога берсерка.
    // Дети меша головы: растягиваются вместе с ним. Единицы — px головы (44×44×50, +x — лицо).
    bossGear(view, model) {
        const scene = view.scene, head = model.parts[2].mesh;
        const mat = (name, rgb) => { const m = new BABYLON.StandardMaterial('boss-gear-' + name, scene); m.diffuseColor = BABYLON.Color3.FromInts(rgb[0], rgb[1], rgb[2]); m.emissiveColor = m.diffuseColor.scale(0.16); m.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25); return m; };
        const put = (mesh, m, pos, rot) => {
            mesh.material = m; mesh.parent = head; mesh.position.set(pos[0], pos[1], pos[2]);
            if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
            World3D.addObject(view, mesh, 'actor'); mesh.isPickable = false;
            return mesh;
        };
        const band = [put(Geo.roundBox(scene, 'boss-band', 47, 9, 53, 4, 2), mat('band', [230, 40, 55]), [0, 9, 0]),
            put(Geo.roundBox(scene, 'boss-band-tail', 6, 6, 18, 2, 1), mat('band', [230, 40, 55]), [-26, 6, 8], [0.5, 0, 0.4])];
        const hm = mat('helmet', [96, 112, 66]);
        const dome = BABYLON.MeshBuilder.CreateSphere('boss-helmet', { diameter: 58, slice: 0.5, segments: 14 }, scene);
        const helmet = [put(dome, hm, [0, 6, 0]), put(Geo.roundBox(scene, 'boss-helmet-rim', 60, 5, 64, 2, 1), hm, [0, 6, 0])];
        const km = mat('knight', [190, 198, 212]);
        const knight = [put(Geo.roundBox(scene, 'boss-knight', 50, 18, 56, 7, 2), km, [0, 17, 0]),
            put(Geo.roundBox(scene, 'boss-knight-nose', 5, 16, 6, 2, 1), km, [25, 4, 0]),
            put(Geo.roundBox(scene, 'boss-knight-crest', 30, 10, 6, 3, 1), mat('crest', [222, 52, 72]), [0, 29, 0])];
        const horn = mat('horn', [245, 236, 214]);
        const horns = [-1, 1].map(s => put(BABYLON.MeshBuilder.CreateCylinder('boss-horn', { diameterTop: 0, diameterBottom: 13, height: 28, tessellation: 10 }, scene), horn, [0, 30, s * 15], [s * 0.45, 0, 0]));
        const gear = { band, helmet, knight, horns };
        for (const k of Object.keys(gear)) for (const m of gear[k]) m.setEnabled(false);
        return gear;
    },
    // Щит щитоносца: полупрозрачная голубая сфера вокруг верха тела (видна с любой стороны; Fight ставит место и размер).
    bossShield(view) {
        const scene = view.scene;
        const m = BABYLON.MeshBuilder.CreateSphere('boss-shield', { diameter: 1, segments: 20 }, scene);
        const mat = new BABYLON.StandardMaterial('boss-shield-m', scene);
        mat.diffuseColor = BABYLON.Color3.FromInts(76, 201, 240); mat.emissiveColor = BABYLON.Color3.FromInts(76, 201, 240).scale(0.7);
        mat.alpha = 0.3; mat.specularColor = new BABYLON.Color3(0.8, 0.8, 0.8); mat.backFaceCulling = false; mat.metadata = { toon: false };
        m.material = mat; m.isPickable = false;
        World3D.addObject(view, m, 'prop', { castShadow: false, outline: false, ink: false });
        m.setEnabled(false);
        return m;
    },
    // Вид босса по типу: цвета кожи, майки, штанов и снаряжение.
    styleBoss(type) {
        const B = this.boss, mats = B.model.mats, [skin, shirt, pants] = type.look;
        const set = (m, c) => { m.diffuseColor = BABYLON.Color3.FromInts(c[0], c[1], c[2]); m.emissiveColor = m.diffuseColor.scale(0.16); };
        set(mats.yellow, skin); set(mats.blue, shirt); set(mats.green, pants);
        set(mats.hem, shirt.map(v => v * 0.82)); set(mats.shoe, [40, 40, 52]);
        for (const k of Object.keys(B.gear)) for (const m of B.gear[k]) m.setEnabled(k === type.gear);
        B.type = type;
    },
    bombMat() {
        if (this._bombMat) return this._bombMat;
        const scene = this.app.location.view.scene, m = new BABYLON.StandardMaterial('boss-bomb-m', scene);
        m.diffuseColor = new BABYLON.Color3(0.2, 0.18, 0.3); m.emissiveColor = new BABYLON.Color3(0.08, 0.06, 0.14);
        m.specularColor = new BABYLON.Color3(0.9, 0.9, 0.9); m.specularPower = 24;
        return (this._bombMat = m);
    },
    markMat() {
        if (this._markMat) return this._markMat;
        const scene = this.app.location.view.scene, m = new BABYLON.StandardMaterial('boss-mark-m', scene);
        m.diffuseColor = new BABYLON.Color3(1, 0.25, 0.3); m.emissiveColor = new BABYLON.Color3(1, 0.2, 0.25); m.disableLighting = true; m.alpha = 0.6;
        m.metadata = { toon: false };
        return (this._markMat = m);
    },
    bombFuseMat() {
        if (this._fuseMat) return this._fuseMat;
        const scene = this.app.location.view.scene, m = new BABYLON.StandardMaterial('boss-fuse-m', scene);
        m.diffuseColor = new BABYLON.Color3(1, 0.8, 0.2); m.emissiveColor = new BABYLON.Color3(1, 0.55, 0.1); m.disableLighting = true;
        return (this._fuseMat = m);
    },
    waveMat() {
        if (this._waveMat) return this._waveMat;
        const scene = this.app.location.view.scene, m = new BABYLON.StandardMaterial('boss-wave-m', scene);
        m.diffuseColor = new BABYLON.Color3(1, 0.85, 0.3); m.emissiveColor = new BABYLON.Color3(1, 0.7, 0.2); m.disableLighting = true; m.alpha = 0.8;
        m.metadata = { toon: false };
        return (this._waveMat = m);
    },
    angryFace(scene) {
        const W = 256, H = 144, tex = new BABYLON.DynamicTexture('boss-face', { width: W, height: H }, scene, true);
        const c = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (tex.getContext()));
        c.clearRect(0, 0, W, H); c.fillStyle = '#111'; c.strokeStyle = '#111'; c.lineCap = 'round';
        for (const s of [-1, 1]) {
            c.beginPath(); c.ellipse(W * (0.5 + s * 0.13), H * 0.36, W * 0.04, H * 0.1, 0, 0, Math.PI * 2); c.fill();
            c.lineWidth = H * 0.07; c.beginPath(); c.moveTo(W * (0.5 + s * 0.22), H * 0.12); c.lineTo(W * (0.5 + s * 0.06), H * 0.24); c.stroke();
        }
        c.lineWidth = H * 0.075; c.beginPath(); c.arc(W * 0.5, H * 0.92, W * 0.16, Math.PI * 1.2, Math.PI * 1.8); c.stroke();
        tex.hasAlpha = true; tex.update(true);
        const m = new BABYLON.StandardMaterial('boss-face-m', scene);
        m.diffuseTexture = tex; m.useAlphaFromDiffuseTexture = true; m.specularColor = new BABYLON.Color3(0, 0, 0); m.zOffset = -2;
        return m;
    },
    resetBoss() {
        const B = this.boss, lb = Level.boss;
        Fight.reset(this);
        B.on = !!lb; B.rag = null;
        B.model.root.setEnabled(B.on);
        if (!lb) return;
        const type = Fight.typeFor(this.mapIndex);
        this.styleBoss(type);
        B.body = Noob.body(lb.height / 180, lb.width / 100 * type.wide);
        B.mm.body = B.body;
        GM.set(B.sim.pos, lb.x, Level.roadY, lb.z);
        B.mm.reset(B.sim.pos, -Math.PI / 2);
        B.sim.facing.x = -Math.PI / 2;
    },
    // Нокаут босса: рэгдолл с силой удара (летит назад, в ящики за рингом).
    knockBoss(vel, spin) {
        const B = this.boss;
        B.sim.fightPose = null;
        B.rag = new NoobRagdoll(B.mm.world, vel || [0, 650, 1150], spin || [-2.5, 0.4, 0], B.body);
        if (this.app.fx) this.app.fx.play('burst', [B.sim.pos[0], Level.roadY + B.body.sh * 120, B.sim.pos[2]]);
    },
    updateBoss(dt) {
        const B = this.boss;
        if (!B.on) return;
        if (B.rag) { B.rag.update(dt); Noob.apply(B.model, B.rag.world, B.body); return; }
        B.mm.update(dt, B.sim);
    },

    // ---- эффекты событий трассы ----------------------------------------------------------------------
    fxGate(r, ev, dh, dw) {
        const good = dh > 0 || dw > 0;
        const txt = dh ? (dh > 0 ? '+' : '−') + Math.round(Math.abs(dh)) : (dw > 0 ? '+' : '−') + Math.round(Math.abs(dw)) + '%';
        UI.pop(txt, [r.pos[0], Level.roadY + r.hs[0] + 40, r.pos[2] + 40], good ? 'var(--sky)' : 'var(--coral)');
        UI.bumpHeight();
        Sound.play(ev.kind === 'g-xtall' ? 'assets/sounds/gate-mul.ogg' : good ? 'assets/sounds/gate-up.ogg' : 'assets/sounds/gate-down.ogg', { volume: 0.7, rate: 0.95 + Math.random() * 0.1 });
        if (this.app.fx) this.app.fx.create({ texture: 'assets/fx/sparkle.webp', position: [ev.x, Level.roadY + 160, ev.z], burst: 22, capacity: 24, life: [0.4, 0.8], size: [8, 16], speed: [140, 320], direction: [[-1, -0.3, -0.4], [1, 1, 0.6]],
            color: this.hex(Level.GATE_COLORS[ev.kind] || [255, 255, 255]), color2: '#ffffff', blend: 'standard', gravity: [0, -400, 0], duration: 0.06 });
        ev.mat.alpha = 0.12;
        if (good) Tutorial.complete('gate');
    },
    hex(c) { return '#' + c.map(v => (v | 0).toString(16).padStart(2, '0')).join(''); },
    fxCut(r, lost, ev) {
        UI.pop('−' + Math.round(lost), [r.pos[0], ev.h + Level.roadY + 30, r.pos[2]], 'var(--coral)');
        UI.toast(Lang.t('toast.cut'), 0.7, 'var(--coral)');
        UI.bumpHeight();
        Sound.play('assets/sounds/saw.ogg', { volume: 0.8 });
        RunCam.shake(5, 0.25);
        // срезанный кусок улетает (физика)
        const scene = this.app.location.view.scene, size = [60 * r.body.wide, Math.min(120, lost), 40 * r.body.wide];
        const m = Geo.box(scene, 'cut', size[0], size[1], size[2], 256);
        m.material = r.model.mats.blue;
        const p = [r.pos[0], Level.roadY + ev.h + size[1] / 2 + 6, r.pos[2]];
        m.position.set(p[0], p[1], p[2]); m.rotationQuaternion = new BABYLON.Quaternion();
        World3D.addObject(this.app.location.view, m, 'prop');
        Level.meshes.push(m);
        const b = Phys.add({ type: 'dynamic', shape: 'box', half: [size[0] / 2, size[1] / 2, size[2] / 2], pos: p, mass: 4, mesh: m });
        GM.set(b.vel, (Math.random() - 0.5) * 300, 420, -260); GM.set(b.ang, 6, 3, 2);
        Level.bricks.push({ mesh: m, body: b, pos: p, size, t: 0, life: 1.6 });   // срез тает и исчезает, не валяется на карте
        Tutorial.complete('saw');
    },
    fxSmash(r, loss, ev) {
        Sound.play('assets/sounds/smash.ogg', { volume: 0.9 });
        RunCam.shake(loss > 0 ? 7 : 4, 0.25);
        if (loss > 0) { UI.pop('−' + Math.round(loss), [r.pos[0], Level.roadY + r.hs[0] + 30, r.pos[2]], 'var(--coral)'); UI.bumpHeight(); }
        else UI.toast(Lang.t('toast.smash'), 0.6, 'var(--tape)');
        if (this.app.fx) this.app.fx.play('dust', [r.pos[0], Level.roadY + 10, ev.z]);
    },
    fxRam(r, loss, ev) {
        Sound.play('assets/sounds/smash.ogg', { volume: 1, rate: 0.85 + Math.random() * 0.2 });
        Sound.play('assets/sounds/punch.ogg', { volume: 0.6, rate: 0.7 });
        if (ev.label) ev.label.setEnabled(false);
        RunCam.shake(loss > 0 ? 9 : 6, 0.3);
        this.hitT = 0.06;
        if (loss > 0) {
            UI.pop('−' + Math.round(loss), [r.pos[0], Level.roadY + r.heightPx() + 30, r.pos[2]], 'var(--coral)');
            UI.bumpHeight();
            UI.toast(Lang.t('toast.ram'), 0.6, 'var(--coral)');
        } else UI.toast(Lang.t('toast.block'), 0.6, 'var(--violet)');
        if (this.app.fx) {
            this.app.fx.play('dust', [r.pos[0], Level.roadY + 10, ev.z + 30]);
            this.app.fx.create({ texture: 'assets/fx/star.webp', position: [r.pos[0], Level.roadY + 100, ev.z + 20], burst: 12, capacity: 14, life: [0.3, 0.6], size: [12, 22], speed: [180, 420], direction: [[-1, 0, -0.3], [1, 1, 1]], color: '#FFD23F', color2: '#ffffff', blend: 'standard', gravity: [0, -400, 0], duration: 0.05 });
        }
    },
    fxHammer(r, hm) {
        Sound.play('assets/sounds/punch.ogg', { volume: 0.8 });
        UI.pop('−' + this.runner.c.hammerLoss, [r.pos[0], Level.roadY + r.hs[0] + 30, r.pos[2]], 'var(--coral)');
        UI.toast(Lang.t('toast.ouch'), 0.6, 'var(--coral)');
        RunCam.shake(8, 0.3);
        UI.bumpHeight();
        void hm;
    },
    fxGiant(r, on) {
        if (on) {
            UI.toast(Lang.t('toast.giant'), 1.4, 'var(--violet)');
            UI.flash();
            Sound.play('assets/sounds/gate-mul.ogg', { volume: 1, rate: 0.7 });
            Sound.duck(0.75, 0.1, (r.c.giantTime || 5) - 0.5, 0.6);   // чуть тише, но музыка остаётся
            RunCam.shake(10, 0.4);
            if (this.app.fx) this.app.fx.play('burst', [r.pos[0], Level.roadY + r.heightPx() * 0.6, r.pos[2]]);
        } else {
            UI.toast(Lang.t('toast.giantEnd'), 0.8, 'var(--sky)');
        }
        UI.setPower(r.power, on);
    },
    fxSawGiant(r, ev) {
        Sound.play('assets/sounds/saw.ogg', { volume: 0.3, rate: 1.05 });
        if (this.app.fx) this.app.fx.create({ texture: 'assets/fx/sparkle.webp', position: [r.pos[0], Level.roadY + ev.h, ev.z], burst: 18, capacity: 20, life: [0.2, 0.5], size: [8, 16], speed: [200, 460],
            direction: [[-1, 0.2, -1], [1, 1, 0.4]], color: '#FFD23F', color2: '#ffffff', blend: 'add', gravity: [0, -600, 0], duration: 0.06 });
    },
    fxBlock(r, at) {
        Sound.play('assets/sounds/punch.ogg', { volume: 0.7, rate: 1.3 });
        UI.toast(Lang.t('toast.block'), 0.6, 'var(--violet)');
        if (this.app.fx) this.app.fx.create({ texture: 'assets/fx/star.webp', position: at, burst: 10, capacity: 12, life: [0.3, 0.6], size: [10, 20], speed: [150, 350], direction: [[-1, -0.2, -1], [1, 1, 1]], color: '#ffffff', blend: 'standard', gravity: [0, -300, 0], duration: 0.05 });
        void r;
    },
    fxJump(r, ev) {
        Sound.play('assets/sounds/gate-up.ogg', { volume: 0.8, rate: 0.8 });
        UI.toast(Lang.t('toast.jump'), 0.8, 'var(--tape)');
        RunCam.shake(3, 0.15);
        void ev;
    },
    fxLava(r, j) {
        Sound.play('assets/sounds/oof.ogg', { volume: 0.8, rate: 1.2 });
        UI.toast(Lang.t('toast.hot'), 0.8, 'var(--coral)');
        if (!r.giant) UI.pop('−' + r.c.lavaLoss, [r.pos[0], Level.roadY + r.heightPx() + 30, r.pos[2]], 'var(--coral)');
        if (this.app.fx) this.app.fx.play('dust', [r.pos[0], Level.roadY + 6, r.pos[2]]);
        void j;
    },
    fxPunch(r, p) {
        Sound.play('assets/sounds/punch.ogg', { volume: 0.9 });
        UI.toast(Lang.t('toast.pow'), 0.6, 'var(--coral)');
        UI.pop('−' + r.c.punchLoss, [r.pos[0], Level.roadY + r.heightPx() + 30, r.pos[2]], 'var(--coral)');
        UI.bumpHeight();
        RunCam.shake(7, 0.25);
        if (this.app.fx) this.app.fx.create({ texture: 'assets/fx/star.webp', position: [p.tipX, p.y, p.z], burst: 8, capacity: 10, life: [0.3, 0.6], size: [10, 18], speed: [120, 300], direction: [[-1, -0.2, -1], [1, 1, 1]], color: '#FFD23F', blend: 'standard', gravity: [0, -300, 0], duration: 0.05 });
    },
    fxWind(f) {
        if (!this.app.fx) return;
        this.app.fx.create({ texture: 'assets/fx/cloud_puff.webp', position: [f.x, Level.roadY + 120 + Math.random() * 160, f.z + (Math.random() - 0.5) * f.zone * 0.6], burst: 2, capacity: 3, life: [0.5, 0.8], size: [18, 34], speed: [500, 800],
            direction: [[f.dir, -0.05, -0.1], [f.dir, 0.1, 0.1]], color: '#ffffff', alpha: 0.55, blend: 'standard', gravity: [0, 0, 0], duration: 0.04 });
    },
    fxStrike(r, ro) {
        Sound.play('assets/sounds/smash.ogg', { volume: 0.9, rate: 1.2 });
        UI.toast(Lang.t('toast.strike'), 0.8, 'var(--tape)');
        RunCam.shake(5, 0.2);
        void r; void ro;
    },
    fxRollerHit(r, ro) {
        Sound.play('assets/sounds/punch.ogg', { volume: 0.9, rate: 0.8 });
        UI.toast(Lang.t('toast.ouch'), 0.6, 'var(--coral)');
        UI.pop('−' + r.c.rollerLoss, [r.pos[0], Level.roadY + r.heightPx() + 30, r.pos[2]], 'var(--coral)');
        UI.bumpHeight();
        RunCam.shake(8, 0.3);
        void ro;
    },
    // Удар в бою: число роста, звёзды, тряска, стоп-кадр, вспышка по телу получившего.
    fxFightHit(at, dmg, onPlayer) {
        Sound.play('assets/sounds/punch.ogg', { volume: 0.85, rate: 0.85 + Math.random() * 0.35 });
        if (onPlayer) Sound.play('assets/sounds/oof.ogg', { volume: 0.5, rate: 1.1 + Math.random() * 0.2 });
        UI.pop('−' + dmg, [at[0], at[1] + 40, at[2]], onPlayer ? 'var(--coral)' : '#fff');
        if (onPlayer) UI.bumpHeight();
        RunCam.shake(onPlayer ? 9 : 5, 0.18);
        this.hitT = onPlayer ? 0.07 : 0.045;
        const model = onPlayer ? this.runner.model : this.boss.model;
        const flash = model.parts.flatMap(p => [p.mesh].concat(p.mesh.getChildMeshes(false)));   // с волосами, рюкзаком, снаряжением
        for (const m of flash) { m.renderOverlay = true; m.overlayColor = onPlayer ? new BABYLON.Color3(1, 0.3, 0.3) : new BABYLON.Color3(1, 1, 1); m.overlayAlpha = 0.55; }
        clearTimeout(onPlayer ? this._flashP : this._flashB);
        const off = setTimeout(() => { for (const m of flash) m.renderOverlay = false; }, 90);
        if (onPlayer) this._flashP = off; else this._flashB = off;
        if (this.app.fx) this.app.fx.create({ texture: 'assets/fx/star.webp', position: at, burst: 9, capacity: 10, life: [0.25, 0.55], size: [12, 24], speed: [160, 380], direction: [[-1, -0.2, -1], [1, 1, 1]], color: onPlayer ? '#FF5D73' : '#FFD23F', color2: '#ffffff', blend: 'standard', gravity: [0, -300, 0], duration: 0.05 });
    },
    fxFightMiss(r, text) {
        Sound.play('assets/sounds/click.ogg', { volume: 0.6, rate: 0.5 });
        UI.toast(text || Lang.t('fight.miss'), 0.7, 'var(--sky)');
        UI.pop(text || Lang.t('fight.miss'), [r.pos[0], Level.roadY + r.heightPx() + 40, r.pos[2]], 'var(--sky)');
    },
    fxFightBlock(at) {
        Sound.play('assets/sounds/punch.ogg', { volume: 0.7, rate: 1.7 });
        UI.pop(Lang.t('fight.blocked'), [at[0], at[1] + 40, at[2]], 'var(--sky)');
        RunCam.shake(3, 0.12);
        if (this.app.fx) this.app.fx.create({ texture: 'assets/fx/sparkle.webp', position: at, burst: 10, capacity: 12, life: [0.2, 0.45], size: [8, 16], speed: [160, 360], direction: [[-1, -0.3, -1], [1, 1, 0.2]], color: '#4CC9F0', color2: '#ffffff', blend: 'standard', gravity: [0, -300, 0], duration: 0.05 });
    },
    fxBomb(at, size) {
        Sound.play('assets/sounds/smash.ogg', { volume: 1, rate: 0.6 });
        Sound.play('assets/sounds/punch.ogg', { volume: 0.7, rate: 0.5 });
        RunCam.shake(10, 0.35);
        if (this.app.fx) {
            this.app.fx.play('dust', at);
            this.app.fx.create({ texture: 'assets/fx/star.webp', position: [at[0], at[1] + size * 0.5, at[2]], burst: 22, capacity: 24, life: [0.3, 0.7], size: [16, 34], speed: [260, 620], direction: [[-1, 0.2, -1], [1, 1.4, 1]], color: '#FF9F1C', color2: '#FFD23F', blend: 'standard', gravity: [0, -600, 0], duration: 0.06 });
        }
    },
    fxSlam(at) {
        Sound.play('assets/sounds/smash.ogg', { volume: 1, rate: 0.7 });
        RunCam.shake(12, 0.4);
        if (this.app.fx) this.app.fx.play('dust', at);
    },
    fxRage() {
        const B = this.boss, mats = B.model.mats;
        UI.toast(Lang.t('boss.rage'), 1.2, 'var(--coral)');
        Sound.play('assets/sounds/gate-mul.ogg', { volume: 0.9, rate: 0.75 });
        RunCam.shake(8, 0.5);
        for (const k of ['yellow', 'blue', 'green']) mats[k].emissiveColor = mats[k].diffuseColor.scale(0.16).add(new BABYLON.Color3(0.45, 0.04, 0.02));
        if (this.app.fx) this.app.fx.play('burst', [B.sim.pos[0], Level.roadY + B.body.sh * 120, B.sim.pos[2]]);
    },
    fxCrate(cr) {
        if (this.time - (this._crateT || 0) > 0.12) { this._crateT = this.time; Sound.play('assets/sounds/smash.ogg', { volume: 0.7, rate: 0.8 + Math.random() * 0.4 }); }
        if (this.app.fx) this.app.fx.play('dust', [cr.body.pos[0], Level.roadY + 6, cr.body.pos[2]]);
    },
    fxCoin(r, c) {
        this._coinT = (this.time - (this._lastCoin || 0)) < 0.5 ? Math.min(12, (this._coinT || 0) + 1) : 0;
        this._lastCoin = this.time;
        Sound.play('assets/sounds/coin.ogg', { volume: c.gem ? 0.8 : 0.45, rate: 1 + this._coinT * 0.04 });
        if (c.gem) UI.pop('+' + c.value, [c.x, Level.roadY + c.h + 30, c.z], 'var(--sky)');
        void r;
    },

    // ---- обучение -------------------------------------------------------------------------------------
    initTutorial() {
        const ahead = (type) => () => {
            const r = this.runner;
            for (const ev of Level.events) if (ev.type === type && !ev.used && ev.z > r.pos[2]) return { x: ev.x, y: ev.z, h: Level.roadY + (type === 'saw' ? ev.h : 220) };
            return null;
        };
        Tutorial.init({
            app: this.app,
            steps: [
                { id: 'steer', title: 'tut.steer.t', hint: { touch: 'tut.steer.touch', keyboard: 'tut.steer.keyboard', pad: 'tut.steer.pad' }, keys: { keyboard: ['left', 'right'] }, icons: { touch: ['swipe'], keyboard: ['mouse'] },
                  check: () => Math.min(1, this.steerAccum / 500) },
                { id: 'gate', title: 'tut.gate.t', hint: 'tut.gate.h', event: 'gate', world: ahead('gate') },
                { id: 'saw', title: 'tut.saw.t', hint: 'tut.saw.h', event: 'saw', world: ahead('saw'), skipIf: () => !Level.events.some(e => e.type === 'saw') },
                { id: 'goal', title: 'tut.goal.t', hint: 'tut.goal.h', event: 'goal' },
            ],
            state: () => this.save, field: 'tutorialDone',
            persist: () => this.persist(),
            onFinish: (reason) => {
                UI.els['h-hint'].classList.remove('on');
                if (reason === 'done' || reason === 'skip') Platform.analytics('tutorial_completed', { skipped: reason === 'skip' });
            },
        });
    },

    // ---- ввод: перетаскивание по экрану ----------------------------------------------------------
    bindDrag(canvas) {
        const target = window;
        target.addEventListener('pointerdown', (e) => {
            if (this.state !== 'play' || Pause.active || UI.anyModal()) return;
            const t = /** @type {HTMLElement} */ (e.target);
            if (t && t.closest && (t.closest('button') || t.closest('.card') || t.closest('#shop-ui'))) return;
            if (Fight.on) Fight.tap(this);
            this.drag = { id: e.pointerId, x: e.clientX, acc: 0 };
        });
        target.addEventListener('pointermove', (e) => {
            const d = this.drag;
            if (!d || d.id !== e.pointerId) return;
            d.acc += e.clientX - d.x; d.x = e.clientX;
        });
        const up = (e) => { if (this.drag && this.drag.id === e.pointerId) { this.dragRest = this.drag.acc; this.drag = null; } };
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
        window.addEventListener('lory-release-input', () => { this.drag = null; });
        void canvas;
    },

    // ---- кадр ---------------------------------------------------------------------------------------
    update(dt) {
        const r = this.runner;
        if (!r) return;
        this.time += dt;
        if (this._persistT > 0) { this._persistT -= dt; if (this._persistT <= 0) this.persist(); }
        // ввод
        if (this.state === 'play') {
            let dx = 0;
            if (this.drag) { dx = this.drag.acc; this.drag.acc = 0; }
            if (this.dragRest) { dx += this.dragRest; this.dragRest = 0; }
            const axis = Input.axis('left', 'right');
            if (Fight.on) {
                const kx = Input.pressed('left') ? -1 : Input.pressed('right') ? 1 : 0;
                Fight.swipe(this, dx, kx);
                if (Input.pressed('go')) Fight.tap(this);
            } else r.steer(dx, axis, dt);
            this.steerAccum += Math.abs(dx) + Math.abs(axis) * 600 * dt;
            if (this.steerAccum > 300) UI.els['h-hint'].classList.remove('on');
            if (Input.pressed('pause')) this.setPaused(true);
        } else if (this.state === 'menu' && Input.pressed('go') && !ShopUI.isOpen() && !UI.anyModal()) this.run();
        r.camYaw = null;
        if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.slowT = 0; }
        const slowTo = this.slowT > 0 ? this.cfgX().slowmo : 1;
        this.timeScale = GM.damper(this.timeScale, slowTo, slowTo < 1 ? 0.04 : 0.25, dt);
        // стоп-кадр удара: мир почти замирает на доли секунды
        let hit = 1;
        if (this.hitT > 0) { this.hitT -= dt; hit = 0.08; }
        const wdt = dt * this.timeScale * hit;
        Phys.update(wdt);
        Level.update(wdt);
        Fight.update(this, wdt);
        r.update(wdt);
        this.updateBoss(wdt);
        this.cosmetics('update', wdt);
        if (this.pending) { this.pending.t -= dt; if (this.pending.t <= 0) { const f = this.pending.fn; this.pending = null; f(); } }
        // шаги — из касаний стоп базы движений
        for (const fe of r.mm.footEvents) {
            if (this.state === 'menu') break;
            const i = Math.floor(Math.random() * 4);
            const url = ['assets/sounds/step-0.ogg', 'assets/sounds/step-1.ogg', 'assets/sounds/step-2.ogg', 'assets/sounds/step-3.ogg'][i];
            Sound.play(url, { volume: GM.clamp(0.15 + r.hs[0] / 1800, 0.15, 0.45), rate: GM.clamp(1.15 - r.hs[0] / 2400, 0.75, 1.2) });
            if (r.hs[0] > 420) { RunCam.shake(Math.min(6, r.hs[0] / 220), 0.12); if (this.app.fx) this.app.fx.play('dust', [fe.x, Level.roadY + 4, fe.z]); }
        }
        UI.setPower(r.giant ? r.giantT / Math.max(0.1, r.c.giantTime) : r.power, r.giant);
        if (this.state === 'menu') { this._menuT = (this._menuT || 0) + dt; if (this._menuT > 0.5) { this._menuT = 0; UI.updateMenu(); } }
        UI.frame(dt);
    },
};
