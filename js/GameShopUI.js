// GameShopUI.js — окна магазина, подарка дня и колеса фортуны Tall Noob Run (контракт — docs/shop-contract.md).
// Логику ведут модули движка Shop / DailyGift / Wheel, вид предметов — Cosmetics (GameCosmetics.js), данные — GameShopData.js.
// Стиль «рулетка-метр»: жёлтая лента с делениями, толстая тёмная обводка, надувные кнопки (как GameUI.js); стили лежат под #shop-ui.
//
//   ShopUI.init(game)       один раз в Game.init: Shop / DailyGift / Wheel с данными и game.save.*, подписка Shop -> Cosmetics.apply
//   ShopUI.open(kind, tab?) 'shop' | 'daily' | 'wheel'; false — нельзя (идёт туториал или забег). Магазин открывается на ПЕРВОЙ вкладке
//                           (brainrot), если игра не просит другую вторым аргументом (id вкладки).
//   ShopUI.close() / isOpen() / onClose(fn) / onOpen(fn)
//   ShopUI.maybeOfferDaily()   в меню: подарок доступен и сегодня не показывали — открыть и markOffered()
//   ShopUI.badges()         { daily, wheel } — красные точки на кнопках меню
//   ShopUI.freeArea()       { x, y, w, h } в долях экрана (0..1): часть, не закрытая окном магазина — туда игре стоит сдвинуть Нуба
//                           (камера меню), пока магазин открыт; onOpen/onClose сообщают, когда сдвигать и возвращать.
//   ShopUI.sink()           приёмник наград для DailyGift и Wheel (Shop, но случайный предмет не берёт noWheel-вещи: скины брейнрота).
// Esc закрывает окно и не получает preventDefault (Playables). Реклама — только Platform.rewarded через модули движка; кнопки
// «за рекламу» неактивны с пояснением, если Platform.rewardedSupported() = false. Картинки — assets/ui/icons/*.webp (пути литералами).

/** @satisfies {Record<string, any>} */
const ShopUI = {
    /** Тексты окна: при загрузке дополняют LANG_STRINGS (не затирая чужие ключи). Тексты Shop / DailyGift / Wheel берём их же. */
    TEXT: {
        ru: {
            'su.shop': 'Магазин', 'su.daily': 'Подарок дня', 'su.wheel': 'Колесо фортуны', 'su.close': 'Закрыть',
            'su.pick': 'Нажмите на вещь, чтобы примерить', 'su.trying': 'Примерка: вещь пока не ваша',
            'su.noAds': 'Реклама за награду на этой площадке недоступна.', 'su.loadingAd': 'Загрузка рекламы…',
            'su.retryIn': 'Повторить через {n} с', 'su.adFailed': 'Реклама не досмотрена, просмотр не засчитан. Прогресс сохранён.',
            'su.adViews': 'Просмотров: {a} из {b}', 'su.unlocked': 'Открыто: {name}!', 'su.bought': 'Куплено: {name}!',
            'su.exclusiveHint': 'Награда 7-го дня подарка дня. Нигде не продаётся.',
            'su.brainNote': 'Особые скины: открываются только за рекламу, 3–7 просмотров.',
            'su.dayOf': 'День {n} из {m}', 'su.comeBack': 'Приходите завтра за новым подарком!',
            'su.youGot': 'Вы получили', 'su.nice': 'Здорово!', 'su.equipNow': 'Надеть',
            'su.dupNote': 'Такая вещь уже есть, поэтому вместо неё монеты.', 'su.lastPrize': 'Приз за прошлое вращение',
            'su.newItem': 'Новая вещь!', 'su.spun': 'Вращение завершено', 'su.spinAdBusy': 'Идёт реклама…',
            'su.dayLabel': 'День {n}', 'su.todayBig': 'Сегодня', 'su.claimedAlready': 'Подарок уже получен',
            'su.sectorsHint': 'Все призы колеса перед вами',
        },
        en: {
            'su.shop': 'Shop', 'su.daily': 'Daily Gift', 'su.wheel': 'Wheel of Fortune', 'su.close': 'Close',
            'su.pick': 'Tap an item to try it on', 'su.trying': 'Trying on: not yours yet',
            'su.noAds': 'Rewarded ads are not available on this platform.', 'su.loadingAd': 'Loading ad…',
            'su.retryIn': 'Try again in {n} s', 'su.adFailed': 'The ad did not finish, so no view was counted. Your progress is safe.',
            'su.adViews': 'Views: {a} of {b}', 'su.unlocked': 'Unlocked: {name}!', 'su.bought': 'Bought: {name}!',
            'su.exclusiveHint': 'Reward for day 7 of the Daily Gift. Not sold anywhere.',
            'su.brainNote': 'Special skins: unlocked only by watching ads, 3 to 7 views each.',
            'su.dayOf': 'Day {n} of {m}', 'su.comeBack': 'Come back tomorrow for the next gift!',
            'su.youGot': 'You got', 'su.nice': 'Awesome!', 'su.equipNow': 'Equip now',
            'su.dupNote': 'You already own this item, so you got coins instead.', 'su.lastPrize': 'Prize from your last spin',
            'su.newItem': 'New item!', 'su.spun': 'Spin finished', 'su.spinAdBusy': 'Ad in progress…',
            'su.dayLabel': 'Day {n}', 'su.todayBig': 'Today', 'su.claimedAlready': 'Gift already claimed',
            'su.sectorsHint': 'Every prize on the wheel is shown',
        },
    },

    /** Готовые картинки интерфейса (литералы: так их видит сборщик архива). */
    ICON: {
        coin: 'assets/ui/icons/coin.webp', ad: 'assets/ui/icons/watch-video.webp', tv: 'assets/ui/icons/ad-tv.webp', lock: 'assets/ui/icons/lock.webp',
        check: 'assets/ui/icons/check.webp', close: 'assets/ui/icons/close.webp', crown: 'assets/ui/icons/crown.webp', gift: 'assets/ui/icons/gift.webp',
        wheel: 'assets/ui/icons/prize-wheel.webp', shop: 'assets/ui/icons/shop.webp', timer: 'assets/ui/icons/timer.webp', sparkles: 'assets/ui/icons/sparkles.webp',
        star: 'assets/ui/icons/star.webp', chest: 'assets/ui/icons/chest.webp', bag: 'assets/ui/icons/money-bag.webp', trophy: 'assets/ui/icons/trophy.webp',
        bolt: 'assets/ui/icons/lightning.webp',
    },

    /** Значки вкладок: свои SVG (скин, лицо, шляпа, питомец) и готовые картинки (след, брейнрот). */
    TAB_ICON: {
        skin: '<svg viewBox="0 0 24 24"><path d="M8.5 3 3 5.8l2.1 4.3 2.2-1V21h9.4V9.1l2.2 1L21 5.8 15.5 3c-1.2 2.3-5.8 2.3-7 0z" fill="#4CC9F0" stroke="#1B1B3A" stroke-width="2" stroke-linejoin="round"/></svg>',
        face: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.2" fill="#FFD23F" stroke="#1B1B3A" stroke-width="2"/><ellipse cx="8.6" cy="10" rx="1.3" ry="2.1" fill="#1B1B3A"/><ellipse cx="15.4" cy="10" rx="1.3" ry="2.1" fill="#1B1B3A"/><path d="M7.6 14.4c2.6 3 6.2 3 8.8 0" fill="none" stroke="#1B1B3A" stroke-width="2" stroke-linecap="round"/></svg>',
        hat: '<svg viewBox="0 0 24 24"><rect x="6.5" y="3.5" width="11" height="12" rx="1.5" fill="#FF5D73" stroke="#1B1B3A" stroke-width="2"/><rect x="6.5" y="11" width="11" height="2.6" fill="#1B1B3A"/><rect x="2.5" y="15.2" width="19" height="4.2" rx="2.1" fill="#FF5D73" stroke="#1B1B3A" stroke-width="2"/></svg>',
        pet: '<svg viewBox="0 0 24 24"><g fill="#2EC4B6" stroke="#1B1B3A" stroke-width="1.8"><ellipse cx="5.2" cy="11" rx="2.2" ry="2.9"/><ellipse cx="9.6" cy="6.6" rx="2.3" ry="3"/><ellipse cx="14.4" cy="6.6" rx="2.3" ry="3"/><ellipse cx="18.8" cy="11" rx="2.2" ry="2.9"/><path d="M12 11.2c-3.3 0-6 3.4-6 6 0 2.3 2 3 3.6 3 1 0 1.7-.4 2.4-.4s1.4.4 2.4.4c1.6 0 3.6-.7 3.6-3 0-2.6-2.7-6-6-6z"/></g></svg>',
        trail: '<img class="su-tico" src="assets/ui/icons/sparkles.webp" alt="">',
        brainrot: '<img class="su-tico" src="assets/ui/icons/lightning.webp" alt="">',
    },

    // ---- состояние -------------------------------------------------------------------------------------
    /** @type {any} */ game: null,
    _ready: false,
    /** @type {any} */ _root: null,
    /** @type {any} */ _win: null,
    /** @type {any} */ _ui: null,
    _kind: '',
    _tab: '',
    /** @type {string | null} */ _sel: null,
    _busy: false,
    /** @type {any} */ _spin: null,
    _wAngle: 0,
    /** @type {any} */ _sink: null,
    /** @type {any} */ _recovered: null,
    /** @type {any} */ _unsub: null,
    /** @type {any} */ _timer: 0,
    /** @type {Array<() => void>} */ _closeFns: [],
    /** @type {Array<() => void>} */ _openFns: [],
    _mirrorDirty: false,
    /** @type {any} */ _toastT: 0,
    /** @type {Map<string, HTMLImageElement>} */ _imgs: new Map(),

    // ---- строки ------------------------------------------------------------------------------------------
    /** Строка по ключу Lang (с подстановкой {имя}); без Lang — из TEXT. */
    t(key, params) {
        if (typeof Lang !== 'undefined' && Lang.has(key)) return Lang.t(key, params);
        const code = typeof Lang !== 'undefined' ? Lang.code : 'en';
        const s = (this.TEXT[code] || this.TEXT.en)[key] || this.TEXT.en[key] || key;
        return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s;
    },

    // ---- запуск ------------------------------------------------------------------------------------------
    /** Один раз из Game.init: модули магазина, подарка и колеса, подписка внешнего вида. */
    init(game) {
        this.game = game;
        if (!game.save) game.save = {};
        const save = game.save;
        const persist = () => { try { return typeof game.persist === 'function' ? game.persist() : undefined; } catch (e) { console.warn('ShopUI: сохранение:', e); return undefined; } };
        const adsOk = () => typeof Platform !== 'undefined' && Platform.rewardedSupported();
        Shop.init({ tabs: SHOP_TABS, items: SHOP_ITEMS, state: save.shop, persist, adsAvailable: adsOk });
        save.shop = Shop.state;
        this._sink = this._makeSink();
        DailyGift.init({ rewards: DAILY_REWARDS, rewardsSink: this._sink, state: save.daily, persist, adsAvailable: adsOk });
        save.daily = DailyGift.state;
        Wheel.init({
            sectors: WHEEL_SECTORS, rewardsSink: this._sink, state: save.wheel, persist, adsAvailable: adsOk,
            // приз вращения, прерванного закрытием страницы, модуль выдаёт при init: запоминаем, чтобы показать при открытии колеса
            onChange: (e) => { if (e.type === 'prize' && e.recovered) this._recovered = e; },
        });
        save.wheel = Wheel.state;
        Shop.on((e) => { if (e.type === 'equip' || e.type === 'unequip' || e.type === 'preview') this._look(); });
        this._look();
        // сверка данных: замечания показываем в консоли (особые скины брейнрота — осознанное исключение из правила 5–50 предметов и 1–5 просмотров)
        const rep = Shop.validate();
        const bad = rep.problems.filter((p) => p.tab !== 'brainrot' && !(p.id && String(p.id).indexOf('brainrot_') === 0));
        if (bad.length) console.warn('ShopUI: каталог не проходит Shop.validate:', bad.map((p) => p.message));
        const dv = DailyGift.validate(), wv = Wheel.validate();
        if (!dv.ok) console.warn('ShopUI: Daily Gift:', dv.problems.map((p) => p.message));
        if (!wv.ok) console.warn('ShopUI: колесо:', wv.problems.map((p) => p.message));
        window.addEventListener('keydown', (e) => { if (this.isOpen() && (e.code === 'Escape' || e.key === 'Escape')) this._esc(); });   // без preventDefault
        window.addEventListener('resize', () => { if (this.isOpen()) this._onResize(); });
        window.addEventListener('lory-language', () => { if (this.isOpen()) { const k = this._kind, t = this._tab; this._teardown(true); this._kind = ''; this.open(k, t); } });
        this._ready = true;
    },

    /** Применить надетое и примеряемое к Нубу в игре. */
    _look() {
        try { if (typeof Cosmetics !== 'undefined') Cosmetics.apply(this.game, Shop.look()); } catch (e) { console.warn('ShopUI: косметика:', e); }
        this._mirrorDirty = true;
    },

    // ---- приёмник наград ------------------------------------------------------------------------------
    /** Приёмник наград для DailyGift и Wheel: Shop, но случайный предмет не берёт вещи с noWheel (скины брейнрота — только за рекламу). */
    sink() { return this._sink || (this._sink = this._makeSink()); },
    _makeSink() {
        return {
            addCoins: (n, o) => Shop.addCoins(n, o),
            owns: (id) => Shop.owns(id),
            grant: (id, o) => Shop.grant(id, o),
            isExclusive: (id) => Shop.isExclusive(id),
            exclusiveIds: (k) => Shop.exclusiveIds(k),
            name: (id) => Shop.name(id),
            item: (id) => Shop.item(id),
            randomItem: (opts) => this._randomItem(opts),
        };
    },
    /** Как Shop.randomItem (редкие реже), но без эксклюзивов, стартовых и noWheel-вещей. */
    _randomItem(opts) {
        const o = opts || {};
        const R = Shop.RARITIES, W = Shop.RARITY_WEIGHT;
        const maxRank = R.indexOf(o.maxRarity) >= 0 ? R.indexOf(o.maxRarity) : R.length - 1;
        const pool = Shop.items().filter((it) => !it.exclusive && !it.default && !it.noWheel
            && ((it.price && it.price.coins > 0) || Shop.need(it.id) > 0)
            && Math.max(0, R.indexOf(it.rarity)) <= maxRank
            && (o.tab == null || it.tab === o.tab)
            && (o.notOwned === false || !Shop.owns(it.id)));
        if (!pool.length) return null;
        const rng = typeof o.rng === 'function' ? o.rng : Math.random;
        const w = (it) => (W[it.rarity] > 0 ? W[it.rarity] : 1);
        let total = 0;
        for (const it of pool) total += w(it);
        let r = Math.min(0.999999999, Math.max(0, rng())) * total;
        for (const it of pool) { r -= w(it); if (r < 0) return it.id; }
        return pool[pool.length - 1].id;
    },

    // ---- публичное ------------------------------------------------------------------------------------
    isOpen() { return !!(this._root && !this._root.hidden && this._kind); },
    onClose(fn) { if (typeof fn === 'function') this._closeFns.push(fn); },
    onOpen(fn) { if (typeof fn === 'function') this._openFns.push(fn); },

    /** Красные точки кнопок меню. */
    badges() {
        if (!this._ready) return { daily: false, wheel: false };
        try { return { daily: DailyGift.badge() > 0, wheel: Wheel.badge() > 0 }; } catch (e) { return { daily: false, wheel: false }; }
    },

    /** Подарок дня само не всплывает поверх туториала и игры: в меню, если доступен и сегодня ещё не предлагался. */
    maybeOfferDaily() {
        if (!this._ready || this.isOpen()) return;
        if (this.game && this.game.state !== 'menu') return;
        if (typeof Tutorial !== 'undefined' && Tutorial.active) return;
        // первый запуск: сначала туториал (первый забег), подарок — после него или при следующем входе
        if (this.game && this.game.save && !this.game.save.tutorialDone) return;
        if (DailyGift.shouldOffer() && this.open('daily')) DailyGift.markOffered();
    },

    /** Что окно оставляет открытым (в долях экрана): { x, y, w, h }. Для окна магазина — слева (альбомная) или сверху (портрет). */
    freeArea() {
        const W = window.innerWidth || 1, H = window.innerHeight || 1;
        if (!this.isOpen() || this._kind !== 'shop' || !this._win) return { x: 0, y: 0, w: 1, h: 1 };
        const r = this._win.getBoundingClientRect();
        if (H > W) return { x: 0, y: 0, w: 1, h: Math.max(0.1, r.top / H) };
        return { x: 0, y: 0, w: Math.max(0.1, r.left / W), h: 1 };
    },

    open(kind, tab) {
        if (!this._ready) return false;
        if (kind !== 'shop' && kind !== 'daily' && kind !== 'wheel') return false;
        if (typeof Tutorial !== 'undefined' && Tutorial.active) return false;
        if (this.game && this.game.state === 'play') return false;
        if (this.isOpen() && this._kind === kind) return true;
        if (this.isOpen()) this._teardown(true);
        this._mount();
        this._kind = kind;
        this._root.hidden = false;
        this._root.className = 'su-k-' + kind;
        if (kind === 'shop') this._openShop(tab); else if (kind === 'daily') this._openDaily(); else this._openWheel();
        this._timer = setInterval(() => this._tick(), 500);
        if (typeof Cosmetics !== 'undefined') Cosmetics.trailInMenu = kind === 'shop';
        for (const fn of this._openFns.slice()) { try { fn(); } catch (e) { console.error('ShopUI.onOpen:', e); } }
        return true;
    },

    close() {
        if (!this.isOpen()) return;
        this._teardown(false);
        this._root.hidden = true;
        this._kind = '';
        for (const fn of this._closeFns.slice()) { try { fn(); } catch (e) { console.error('ShopUI.onClose:', e); } }
    },

    /** Esc: сначала всплывающая карточка приза, затем вращение колеса (домотать до результата), иначе — закрыть окно. */
    _esc() {
        if (this._ui && this._ui.pop) { this._closePop(); return; }
        if (this._spin) { this._skipSpin(); return; }
        this.close();
    },

    /** Убрать окно и подписки; silent — без звука и переходов (смена окна). */
    _teardown(silent) {
        if (this._spin) this._skipSpin(true);
        if (this._timer) { clearInterval(this._timer); this._timer = 0; }
        if (this._unsub) { this._unsub(); this._unsub = null; }
        if (this._kind === 'shop') { Shop.clearPreview(); }
        if (typeof Cosmetics !== 'undefined') Cosmetics.trailInMenu = false;
        if (this._win) { this._win.remove(); this._win = null; }
        this._ui = null;
        this._busy = false;
        void silent;
    },

    // ---- каркас -----------------------------------------------------------------------------------------
    CSS: `
#shop-ui{position:fixed;inset:0;z-index:40;font-family:'Rubik',system-ui,sans-serif;color:#1B1B3A;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;
 --tape:#FFD23F;--tape-dark:#E9B300;--ink:#1B1B3A;--coral:#FF5D73;--mint:#2EC4B6;--sky:#4CC9F0;--violet:#7B61FF;--paper:#FFFBEF}
#shop-ui[hidden]{display:none}
#shop-ui *{box-sizing:border-box}
#shop-ui img{-webkit-user-drag:none}
#shop-ui .su-dim{position:absolute;inset:0;background:rgba(20,20,48,.6)}
#shop-ui.su-k-shop .su-dim{background:linear-gradient(90deg,rgba(20,20,48,0) 0,rgba(20,20,48,0) 28%,rgba(20,20,48,.62) 52%)}
#shop-ui .su-o{text-shadow:0 2px 0 var(--ink),2px 0 0 var(--ink),-2px 0 0 var(--ink),0 -2px 0 var(--ink),1.5px 1.5px 0 var(--ink),-1.5px 1.5px 0 var(--ink),1.5px -1.5px 0 var(--ink),-1.5px -1.5px 0 var(--ink),0 4px 0 rgba(27,27,58,.35)}
#shop-ui .su-ico{width:1.25em;height:1.25em;object-fit:contain;display:inline-block;vertical-align:middle;pointer-events:none;flex:none}
#shop-ui .su-win{position:absolute;display:flex;flex-direction:column;background:var(--paper);border:3px solid var(--ink);border-radius:20px;box-shadow:0 8px 0 rgba(27,27,58,.85);overflow:hidden;animation:su-in .24s cubic-bezier(.2,1.4,.4,1)}
@keyframes su-in{from{transform:translateY(26px) scale(.96);opacity:0}}
#shop-ui .su-head{flex:none;position:relative;display:flex;align-items:center;gap:8px;padding:8px 10px 13px;background:var(--tape);border-bottom:3px solid var(--ink)}
#shop-ui .su-head::after{content:'';position:absolute;left:0;right:0;bottom:0;height:8px;background:repeating-linear-gradient(90deg,var(--ink) 0 2px,transparent 2px 10px),repeating-linear-gradient(90deg,var(--ink) 0 2px,transparent 2px 50px);background-size:100% 5px,100% 8px;background-repeat:no-repeat;opacity:.55;pointer-events:none}
#shop-ui .su-hico{width:34px;height:34px;object-fit:contain;flex:none;filter:drop-shadow(0 2px 0 rgba(27,27,58,.5))}
#shop-ui .su-title{margin:0;flex:1;min-width:0;font-weight:900;font-size:min(24px,5.6vw);letter-spacing:1px;text-transform:uppercase;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.1}
#shop-ui .su-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 12px 4px 7px;border:3px solid var(--ink);border-radius:999px;background:#fff;color:var(--ink);font-weight:900;font-size:18px;box-shadow:0 3px 0 var(--ink);font-variant-numeric:tabular-nums}
#shop-ui .su-chip.pop{animation:su-bump .35s}
@keyframes su-bump{40%{transform:scale(1.18)}}
#shop-ui .su-pill{font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 16px 11px;line-height:1.1;border:3px solid var(--ink);border-radius:999px;background:var(--c,#fff);color:#fff;font-weight:900;font-size:18px;box-shadow:inset 0 -6px 0 rgba(0,0,0,.18),inset 0 3px 0 rgba(255,255,255,.45),0 5px 0 var(--ink);transition:transform .08s;touch-action:manipulation;-webkit-tap-highlight-color:transparent;text-align:center}
#shop-ui .su-pill:active:not([disabled]){transform:translateY(3px);box-shadow:inset 0 -3px 0 rgba(0,0,0,.18),0 2px 0 var(--ink)}
#shop-ui .su-pill[disabled]{filter:grayscale(.6) brightness(.95);opacity:.8;cursor:default}
#shop-ui .su-pill{text-shadow:0 2px 0 rgba(27,27,58,.6),0 -1px 0 rgba(27,27,58,.45),1px 0 0 rgba(27,27,58,.45),-1px 0 0 rgba(27,27,58,.45)}
#shop-ui .su-pill.su-done[disabled]{filter:none;opacity:1;--c:var(--mint)}
#shop-ui .su-tape,#shop-ui .su-pill.su-tape{text-shadow:none}
#shop-ui .su-tape{--c:var(--tape);color:var(--ink);position:relative;overflow:hidden}
#shop-ui .su-tape::before{content:'';position:absolute;left:0;right:0;top:0;height:11px;background:repeating-linear-gradient(90deg,var(--ink) 0 2px,transparent 2px 12px);opacity:.5;pointer-events:none}
#shop-ui .su-tape::after{content:'';position:absolute;left:0;right:0;top:0;height:7px;background:repeating-linear-gradient(90deg,var(--ink) 0 2px,transparent 2px 60px);pointer-events:none}
#shop-ui .su-x{width:44px;height:44px;padding:0;--c:var(--coral);font-size:20px}
#shop-ui .su-x .su-ico{width:22px;height:22px}
#shop-ui .su-hint{font-weight:700;font-size:12.5px;line-height:1.25;color:#5a5a7a;text-align:center;min-height:1.2em}
#shop-ui .su-hint.bad{color:#c23a50}
#shop-ui .su-toast{position:absolute;left:50%;bottom:max(20px,env(safe-area-inset-bottom));transform:translateX(-50%) translateY(20px);width:max-content;max-width:92vw;z-index:6;padding:9px 18px;border:3px solid var(--ink);border-radius:999px;background:#fff;color:var(--ink);font-weight:900;font-size:16px;box-shadow:0 4px 0 var(--ink);opacity:0;pointer-events:none;transition:opacity .2s,transform .25s cubic-bezier(.2,1.5,.4,1);text-align:center}
#shop-ui .su-toast.on{opacity:1;transform:translateX(-50%)}
#shop-ui .su-toast.good{background:var(--tape)}
/* ---- магазин ---- */
#shop-ui .su-shop{right:max(10px,2.2vw);top:max(10px,3vh);bottom:max(16px,3.4vh);width:min(760px,62vw)}
#shop-ui .su-shopbody{flex:1;min-height:0;display:flex;gap:10px;padding:10px}
#shop-ui .su-side{flex:none;width:clamp(180px,31%,236px);display:flex;flex-direction:column;gap:8px;min-height:0}
#shop-ui .su-mirror{width:min(100%,38vh);aspect-ratio:1;margin:0 auto;border:3px solid var(--ink);border-radius:18px;overflow:hidden;background:radial-gradient(ellipse at 50% 85%,rgba(27,27,58,.18) 0 22%,transparent 24%),radial-gradient(circle at 50% 35%,#fff 0,#e6f3ff 62%,#cfe6ff 100%);box-shadow:inset 0 -5px 0 rgba(27,27,58,.1)}
#shop-ui .su-mirror canvas{display:block;width:100%;height:100%}
#shop-ui .su-info{display:flex;flex-direction:column;align-items:center;gap:3px;min-height:0;text-align:center}
#shop-ui .su-iname{font-weight:900;font-size:18px;line-height:1.1;max-width:100%;overflow:hidden;text-overflow:ellipsis}
#shop-ui .su-irar{display:inline-block;padding:1px 10px 2px;border:2px solid var(--ink);border-radius:999px;background:var(--rc,#9aa3b2);color:#fff;font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.5px;text-shadow:0 1px 0 rgba(27,27,58,.6)}
#shop-ui .su-ipips{display:flex;gap:4px;justify-content:center;flex-wrap:wrap;min-height:14px}
#shop-ui .su-pip{width:14px;height:14px;border:2.5px solid var(--ink);border-radius:50%;background:#fff}
#shop-ui .su-pip.on{background:var(--mint)}
#shop-ui .su-act{width:100%;font-size:17px;padding:9px 10px 10px}
#shop-ui .su-act .su-ico{width:1.35em;height:1.35em}
#shop-ui .su-act small{display:block;font-size:11px;font-weight:800;opacity:.9}
#shop-ui .su-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;min-height:0}
#shop-ui .su-tabs{flex:none;display:flex;gap:6px;overflow-x:auto;padding:2px 2px 6px;scrollbar-width:none}
#shop-ui .su-tabs::-webkit-scrollbar{display:none}
#shop-ui .su-tab{flex:1 1 0;min-width:52px;display:flex;flex-direction:column;align-items:center;gap:0;padding:5px 3px 4px;border:3px solid var(--ink);border-radius:14px;background:#fff;color:var(--ink);font:inherit;cursor:pointer;box-shadow:0 3px 0 var(--ink);touch-action:manipulation}
#shop-ui .su-tab .su-ti{width:24px;height:24px;display:block}
#shop-ui .su-tab .su-ti svg,#shop-ui .su-tab .su-tico{width:24px;height:24px;display:block;object-fit:contain}
#shop-ui .su-tab b{font-size:11px;font-weight:900;line-height:1.1;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#shop-ui .su-tab small{font-size:9.5px;font-weight:800;opacity:.6;line-height:1}
#shop-ui .su-tab.on{background:var(--tape);transform:translateY(2px);box-shadow:0 1px 0 var(--ink)}
#shop-ui .su-tab.special{background:linear-gradient(135deg,#ffe1f1,#e6dcff)}
#shop-ui .su-tab.special.on{background:linear-gradient(135deg,#ff9ed0,#a58bff)}
#shop-ui .su-note{flex:none;font-weight:800;font-size:12px;line-height:1.25;color:#6b3fc4;text-align:center;padding:0 4px}
#shop-ui .su-note:empty{display:none}
#shop-ui .su-grid{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:9px;align-content:start;padding:3px 4px 10px}
#shop-ui .su-card{position:relative;display:flex;flex-direction:column;align-items:center;gap:1px;padding:9px 4px 5px;border:3px solid var(--ink);border-radius:16px;background:#fff;color:var(--ink);font:inherit;cursor:pointer;box-shadow:0 4px 0 var(--ink);min-width:0;touch-action:manipulation;transition:transform .08s}
#shop-ui .su-card::before{content:'';position:absolute;left:12px;right:12px;top:-1px;height:5px;border-radius:0 0 5px 5px;background:var(--rc,#9aa3b2)}
#shop-ui .su-card:active{transform:translateY(2px)}
#shop-ui .su-card.sel{background:#FFF3BF;box-shadow:0 4px 0 var(--ink),0 0 0 4px var(--tape)}
#shop-ui .su-card[data-r=legendary]{background:linear-gradient(#fff6d4,#fff)}
#shop-ui .su-card[data-r=legendary].sel{background:#FFF3BF}
#shop-ui .su-card.brain{background:linear-gradient(#f3e8ff,#fff)}
#shop-ui .su-card.brain.sel{background:#f6e3ff}
#shop-ui .su-cico{width:100%;aspect-ratio:1;display:block;border-radius:12px;overflow:hidden}
#shop-ui .su-cico canvas{display:block;width:100%;height:100%}
#shop-ui .su-cname{width:100%;font-weight:800;font-size:12px;line-height:1.1;height:2.2em;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden}
#shop-ui .su-cprice{display:flex;align-items:center;justify-content:center;gap:3px;font-weight:900;font-size:13px;min-height:19px;white-space:nowrap}
#shop-ui .su-cprice .su-ico{width:1.3em;height:1.3em}
#shop-ui .su-cprice.poor{color:#b3364b}
#shop-ui .su-cprice.own{color:#2b8a4e;font-size:12px}
#shop-ui .su-cbadge{position:absolute;right:3px;top:7px;width:24px;height:24px;object-fit:contain;filter:drop-shadow(0 2px 0 rgba(27,27,58,.45))}
#shop-ui .su-card.eq{border-color:#1f9d55}
#shop-ui .su-card.eq::before{background:#2EC4B6}
/* ---- подарок дня ---- */
#shop-ui .su-center{left:0;right:0;top:0;bottom:0;margin:auto;height:fit-content;max-height:96vh}
#shop-ui .su-daily{width:min(600px,94vw)}
#shop-ui .su-dbody{display:flex;flex-direction:column;gap:10px;padding:10px 12px 14px;overflow-y:auto;overscroll-behavior:contain}
#shop-ui .su-dsub{text-align:center;font-weight:800;font-size:14px;color:#4b4b6a}
#shop-ui .su-days{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
#shop-ui .su-dc{position:relative;display:flex;flex-direction:column;align-items:center;gap:1px;padding:6px 3px 5px;min-height:96px;border:3px solid var(--ink);border-radius:14px;background:#fff;box-shadow:0 4px 0 var(--ink);overflow:hidden}
#shop-ui .su-dc.d7{grid-column:1/-1;min-height:122px;background:linear-gradient(#fff3c4,#fff);flex-direction:row;justify-content:center;gap:14px;padding:8px 10px}
#shop-ui .su-dc.d7 .su-dtxt{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0}
#shop-ui .su-dd{font-weight:900;font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:#6b6b86;white-space:nowrap}
#shop-ui .su-dv{width:100%;flex:1;display:flex;align-items:center;justify-content:center;position:relative;min-height:38px}
#shop-ui .su-dv .su-ico{width:40px;height:40px}
#shop-ui .su-dv canvas{width:100%;max-width:64px;height:auto}
#shop-ui .su-dc.d7 .su-dv{flex:none;width:92px}
#shop-ui .su-dc.d7 .su-dv canvas{max-width:92px}
#shop-ui .su-dc.d7 .su-dv .su-ico{width:56px;height:56px}
#shop-ui .su-da{font-weight:900;font-size:16px;line-height:1.1;display:flex;align-items:center;gap:3px;text-align:center}
#shop-ui .su-dc.d7 .su-da{font-size:14px;text-align:left}
#shop-ui .su-dc.d7 .su-ds{white-space:normal;line-height:1.1;text-align:left}
#shop-ui .su-ds{font-weight:900;font-size:10px;text-transform:uppercase;color:#6b6b86;min-height:12px;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
#shop-ui .su-dtxt{display:flex;flex-direction:column;align-items:center;gap:1px;max-width:100%;min-width:0}
#shop-ui .su-extra{position:absolute;right:3px;top:-3px;width:24px!important;height:24px!important;filter:drop-shadow(0 2px 0 rgba(27,27,58,.35));animation:su-wob 1.6s ease-in-out infinite}
@keyframes su-wob{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(10deg) scale(1.08)}}
#shop-ui .su-stack{position:relative;display:block;width:58px;height:46px}
#shop-ui .su-stack .su-ico{position:absolute;width:34px;height:34px;filter:drop-shadow(0 2px 0 rgba(27,27,58,.3))}
#shop-ui .su-stack.s1 .su-c0{left:10px;top:4px;width:38px;height:38px}
#shop-ui .su-stack.s2 .su-c0{left:5px;top:10px}#shop-ui .su-stack.s2 .su-c1{left:19px;top:2px}
#shop-ui .su-stack.s3 .su-c0{left:1px;top:12px}#shop-ui .su-stack.s3 .su-c1{left:23px;top:12px}#shop-ui .su-stack.s3 .su-c2{left:12px;top:0}
#shop-ui .su-dv .su-big{width:48px;height:48px;filter:drop-shadow(0 3px 0 rgba(27,27,58,.3))}
#shop-ui .su-dc.locked{background:#f6f5fb}
#shop-ui .su-dc.today .su-dv>*:not(.su-extra){animation:su-bob .9s ease-in-out infinite alternate}
@keyframes su-bob{to{transform:translateY(-4px) scale(1.06)}}
#shop-ui .su-dc.today .su-ds{background:var(--tape);color:var(--ink);border:2px solid var(--ink);border-radius:999px;padding:0 7px;line-height:14px;min-height:0}
#shop-ui .su-dc.d7{background:radial-gradient(circle at 50% 46%,rgba(255,255,255,.95) 0 22%,rgba(255,255,255,0) 46%),repeating-conic-gradient(from 0deg at 50% 46%,#ffe27a 0 11deg,#fff4c9 11deg 22deg);border-color:#b07a00}
#shop-ui .su-dc.d7 .su-ds{background:var(--coral);color:#fff;border-radius:999px;padding:1px 8px;line-height:13px;font-size:9.5px;letter-spacing:.4px;white-space:nowrap}
#shop-ui .su-dc.d7 .su-da{overflow-wrap:normal;word-break:normal;-webkit-hyphens:manual;hyphens:manual;font-size:12px;line-height:1.08}
#shop-ui .su-dc.today{border-color:var(--ink);background:#FFF3BF;box-shadow:0 4px 0 var(--ink),0 0 0 4px var(--tape);animation:su-glow 1.1s ease-in-out infinite alternate}
@keyframes su-glow{to{box-shadow:0 4px 0 var(--ink),0 0 0 7px rgba(255,210,63,.65)}}
#shop-ui .su-dc.today .su-ds{color:#b07a00}
#shop-ui .su-dc.claimed{background:#e9f8ee}
#shop-ui .su-dc.claimed .su-ds{visibility:hidden}
#shop-ui .su-dc.claimed .su-dv,#shop-ui .su-dc.claimed .su-da{opacity:.45}
#shop-ui .su-dc .su-ok{position:absolute;left:50%;top:44%;width:44px;height:44px;margin:-22px 0 0 -22px;object-fit:contain;pointer-events:none;filter:drop-shadow(0 2px 0 rgba(27,27,58,.5))}
#shop-ui .su-dc.d7 .su-ok{left:46px;top:50%}
#shop-ui .su-dbtns{display:flex;gap:10px;flex-wrap:wrap}
#shop-ui .su-dbtns .su-pill{flex:1 1 200px}
#shop-ui .su-dbtns small{display:block;font-size:11px;font-weight:800;opacity:.9}
#shop-ui .su-next{display:flex;align-items:center;justify-content:center;gap:8px;font-weight:900;font-size:17px}
#shop-ui .su-next .su-ico{width:1.5em;height:1.5em}
/* ---- колесо ---- */
#shop-ui .su-wheelwin{width:min(780px,96vw)}
#shop-ui .su-wbody{display:flex;gap:16px;align-items:center;justify-content:center;padding:12px 16px 16px;--wd:min(380px,86vw,44vh);overflow-y:auto}
#shop-ui .su-wbox{position:relative;width:var(--wd);height:var(--wd);flex:none;margin-top:10px}
#shop-ui .su-wbox canvas{position:absolute;inset:0;width:100%;height:100%;will-change:transform}
#shop-ui .su-ptr{position:absolute;left:50%;top:-14px;width:12%;height:15%;transform:translateX(-50%);transform-origin:50% 30%;z-index:3;transition:transform .08s;filter:drop-shadow(0 3px 0 rgba(27,27,58,.5))}
#shop-ui .su-hub{position:absolute;left:50%;top:50%;width:21%;height:21%;transform:translate(-50%,-50%);border:3px solid var(--ink);border-radius:50%;background:radial-gradient(circle at 40% 35%,#fff7c8,var(--tape) 55%,var(--tape-dark));box-shadow:0 4px 0 rgba(27,27,58,.5);display:flex;align-items:center;justify-content:center;z-index:2}
#shop-ui .su-hub img{width:62%;height:62%;object-fit:contain}
#shop-ui .su-wctl{display:flex;flex-direction:column;gap:10px;width:min(300px,100%);min-width:0}
#shop-ui .su-wstat{font-weight:800;font-size:14px;text-align:center;color:#4b4b6a}
#shop-ui .su-wctl .su-pill{width:100%}
#shop-ui .su-spinfree{font-size:24px;padding:14px 10px 15px;letter-spacing:1px}
#shop-ui .su-wctl small{display:block;font-size:11px;font-weight:800;opacity:.9}
/* ---- карточка приза и конфетти ---- */
#shop-ui .su-pop{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;background:rgba(20,20,48,.62);animation:su-fade .2s}
@keyframes su-fade{from{opacity:0}}
#shop-ui .su-pcard{position:relative;width:min(380px,92vw);padding:16px 18px 18px;display:flex;flex-direction:column;align-items:center;gap:10px;background:var(--paper);border:3px solid var(--ink);border-radius:22px;box-shadow:0 8px 0 rgba(27,27,58,.85);animation:su-in .3s cubic-bezier(.2,1.6,.4,1);overflow:hidden;max-height:94vh;overflow-y:auto}
#shop-ui .su-ptitle{font-weight:900;font-size:30px;color:var(--tape);text-align:center;line-height:1.05}
#shop-ui .su-burst{position:absolute;left:50%;top:78px;width:360px;height:360px;margin:-180px 0 0 -180px;border-radius:50%;background:repeating-conic-gradient(rgba(255,210,63,.55) 0 9deg,transparent 9deg 18deg);-webkit-mask:radial-gradient(circle,#000 0,transparent 68%);mask:radial-gradient(circle,#000 0,transparent 68%);animation:su-spin 12s linear infinite;pointer-events:none}
@keyframes su-spin{to{transform:rotate(360deg)}}
#shop-ui .su-pitems{position:relative;display:flex;flex-wrap:wrap;gap:10px;justify-content:center;align-items:flex-start}
#shop-ui .su-pit{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:92px;max-width:150px;text-align:center}
#shop-ui .su-pit canvas{width:96px;height:96px;animation:su-pop .5s cubic-bezier(.2,1.8,.4,1)}
@keyframes su-pop{from{transform:scale(.2) rotate(-12deg);opacity:0}}
#shop-ui .su-pit .su-ico{width:76px;height:76px;animation:su-pop .5s cubic-bezier(.2,1.8,.4,1)}
#shop-ui .su-pamt{font-weight:900;font-size:34px;display:flex;align-items:center;gap:6px;line-height:1}
#shop-ui .su-pnm{font-weight:900;font-size:15px;line-height:1.1}
#shop-ui .su-pnote{font-weight:700;font-size:12.5px;color:#5a5a7a;text-align:center}
#shop-ui .su-pbtns{display:flex;flex-direction:column;gap:8px;width:100%}
#shop-ui .su-cf{position:absolute;top:-12px;width:9px;height:14px;border-radius:2px;pointer-events:none;animation:su-fall 1.7s ease-in forwards;z-index:6}
@keyframes su-fall{to{transform:translate(var(--dx),110vh) rotate(var(--rot));opacity:.9}}
/* ---- портрет: окно снизу, Нуб сверху ---- */
@media (max-aspect-ratio:1/1){
#shop-ui.su-k-shop .su-dim{background:linear-gradient(180deg,rgba(20,20,48,0) 0,rgba(20,20,48,0) 22%,rgba(20,20,48,.62) 44%)}
#shop-ui .su-shop{left:8px;right:8px;top:auto;bottom:max(10px,env(safe-area-inset-bottom));width:auto;height:min(76vh,660px)}
#shop-ui .su-shopbody{flex-direction:column;gap:8px;padding:8px}
#shop-ui .su-side{width:auto;flex-direction:row;align-items:center;gap:10px}
#shop-ui .su-mirror{width:min(32vw,15vh,120px);flex:none;margin:0}
#shop-ui .su-sidecol{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
#shop-ui .su-wbody{flex-direction:column;--wd:min(86vw,42vh,400px)}
#shop-ui .su-days .su-dc.d7{min-height:112px}
}
@media (min-aspect-ratio:1/1){
#shop-ui .su-sidecol{display:flex;flex-direction:column;gap:8px;min-height:0}
}
/* альбомный: подарок на широком окне и в низком — в одну строку (7-й день крупнее), на узком, но высоком — 4 колонки */
@media (min-aspect-ratio:5/4) and (min-width:760px),(max-height:430px) and (min-aspect-ratio:1/1){
#shop-ui .su-days{grid-template-columns:repeat(6,1fr) 1.85fr;gap:6px}
#shop-ui .su-dc.d7{grid-column:auto;flex-direction:column;gap:1px;min-height:96px;padding:6px 3px 5px}
#shop-ui .su-dc.d7 .su-dv{width:100%;flex:1}
#shop-ui .su-dc.d7 .su-dtxt{align-items:center}
#shop-ui .su-dc.d7 .su-da{text-align:center;font-size:11.5px}
#shop-ui .su-dc.d7 .su-ds{text-align:center}
#shop-ui .su-dc.d7 .su-ok{left:50%;top:44%}
}
@media (min-aspect-ratio:5/4) and (max-width:759px) and (min-height:431px){
#shop-ui .su-days{grid-template-columns:repeat(4,1fr)}
#shop-ui .su-dc.d7{grid-column:span 2}
}
/* низкий альбомный экран (640×360, 568×320, окно с рекламной полосой) */
@media (max-height:430px) and (min-aspect-ratio:1/1){
#shop-ui .su-shop{top:6px;bottom:10px;right:6px;width:min(74vw,620px)}
#shop-ui .su-head{padding:5px 8px 11px}
#shop-ui .su-title{font-size:19px}
#shop-ui .su-hico{width:26px;height:26px}
#shop-ui .su-chip{font-size:15px;padding:2px 9px 2px 5px}
#shop-ui .su-x{width:36px;height:36px}
#shop-ui .su-shopbody{padding:6px;gap:6px}
#shop-ui .su-side{width:clamp(124px,28%,160px);gap:5px}
#shop-ui .su-mirror{width:min(100%,25vh)}
#shop-ui .su-iname{font-size:14px}
#shop-ui .su-irar{font-size:10px;padding:0 8px 1px}
#shop-ui .su-act{font-size:13px;padding:6px 4px 7px;gap:4px;flex-wrap:wrap;row-gap:0}
#shop-ui .su-act .su-ico{width:1.15em;height:1.15em}
#shop-ui .su-hint{font-size:11px}
#shop-ui .su-tab{padding:3px 2px 2px;border-radius:11px}
#shop-ui .su-tab .su-ti,#shop-ui .su-tab .su-ti svg,#shop-ui .su-tab .su-tico{width:19px;height:19px}
#shop-ui .su-tab small{display:none}
#shop-ui .su-tab:not(.on) b{display:none}
#shop-ui .su-tab{min-width:36px}
#shop-ui .su-tab.on{flex:2.6 1 0}
#shop-ui .su-grid{grid-template-columns:repeat(auto-fill,minmax(74px,1fr));gap:7px}
#shop-ui .su-card{padding:7px 3px 3px;border-radius:13px}
#shop-ui .su-cname{font-size:10.5px}
#shop-ui .su-cprice{font-size:11.5px;min-height:16px}
#shop-ui .su-note{font-size:10.5px}
#shop-ui .su-dbody{gap:6px;padding:6px 10px 10px}
#shop-ui .su-dc{min-height:82px;padding:4px 2px 3px}
#shop-ui .su-dd{font-size:9.5px}
#shop-ui .su-ds{font-size:9px}
#shop-ui .su-dv{min-height:30px}
#shop-ui .su-dv .su-ico{width:32px;height:32px}
#shop-ui .su-dc.d7{min-height:82px}
#shop-ui .su-dc .su-ok{width:34px;height:34px;margin:-17px 0 0 -17px}
#shop-ui .su-dv canvas,#shop-ui .su-dc.d7 .su-dv canvas{max-width:52px}
#shop-ui .su-dc.d7 .su-dv .su-ico{width:40px;height:40px}
#shop-ui .su-next{font-size:14px}
#shop-ui .su-da{font-size:13px}
#shop-ui .su-dsub{font-size:12px}
#shop-ui .su-pill{font-size:15px;padding:7px 12px 8px}
#shop-ui .su-spinfree{font-size:19px;padding:9px 8px 10px}
#shop-ui .su-wbody{--wd:min(66vh,46vw,330px);padding:8px 12px 12px;gap:12px}
#shop-ui .su-wctl{gap:7px}
#shop-ui .su-ptitle{font-size:24px}
#shop-ui .su-pit canvas{width:72px;height:72px}
#shop-ui .su-pit .su-ico{width:58px;height:58px}
#shop-ui .su-pamt{font-size:26px}
#shop-ui .su-pcard{padding:10px 14px 12px;gap:6px}
}
/* узкое окно: у вкладок видна подпись только у выбранной, остальные — значки */
@media (max-width:900px){
#shop-ui .su-tab:not(.on) b,#shop-ui .su-tab small{display:none}
#shop-ui .su-tab{min-width:38px;padding:6px 3px 5px}
#shop-ui .su-tab.on{flex:2.6 1 0}
#shop-ui .su-tab.on small{display:block}
}
@media (prefers-reduced-motion:reduce){#shop-ui .su-dc.today,#shop-ui .su-burst{animation:none}}
`,

    /** Корневой слой и стили — один раз. */
    _mount() {
        if (this._root) return;
        const st = document.createElement('style');
        st.id = 'shop-ui-css';
        st.textContent = this.CSS;
        document.head.appendChild(st);
        const root = document.createElement('div');
        root.id = 'shop-ui';
        root.hidden = true;
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        const dim = document.createElement('div');
        dim.className = 'su-dim';
        root.appendChild(dim);
        document.body.appendChild(root);
        // касания и клики не уходят в игру под окном
        for (const ev of ['pointerdown', 'pointerup', 'click', 'touchstart', 'wheel']) root.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
        this._root = root;
    },

    /** Поставить новое окно в слой. */
    _setWin(win) {
        if (this._win) this._win.remove();
        this._win = win;
        this._root.appendChild(win);
    },

    $(sel) { return this._win ? /** @type {any} */ (this._win.querySelector(sel)) : null; },

    _el(tag, cls, html) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return /** @type {any} */ (e);
    },

    img(src, cls) { return '<img class="' + (cls || 'su-ico') + '" src="' + src + '" alt="">'; },

    /** Звук нажатия и наград (пути литералами). */
    _snd(kind) {
        if (typeof Sound === 'undefined') return;
        try {
            if (kind === 'click') Sound.play('assets/sounds/click.ogg', { volume: 0.6 });
            else if (kind === 'tick') Sound.play('assets/sounds/click.ogg', { volume: 0.22, rate: 1.5 });
            else if (kind === 'reward') Sound.play('assets/sounds/reward.ogg', { volume: 0.7 });
            else if (kind === 'coin') Sound.play('assets/sounds/coin.ogg', { volume: 0.7 });
            else if (kind === 'win') Sound.play('assets/sounds/win.ogg', { volume: 0.6 });
            else if (kind === 'bad') Sound.play('assets/sounds/lose.ogg', { volume: 0.25 });
        } catch (e) { /* звук не критичен */ }
    },

    /** Кнопка окна: звук нажатия и обработчик. */
    _on(el, fn) {
        el.addEventListener('click', (e) => { e.stopPropagation(); this._snd('click'); fn(e); });
    },

    /** Шапка окна: картинка, заголовок, (монеты), закрыть. */
    _head(icon, titleKey, coins) {
        const h = this._el('header', 'su-head',
            this.img(icon, 'su-hico') + '<h2 class="su-title su-o"></h2>'
            + (coins ? '<div class="su-chip su-coins">' + this.img(this.ICON.coin) + '<b>0</b></div>' : '')
            + '<button class="su-pill su-x" type="button" data-adbreak>' + this.img(this.ICON.close) + '</button>');
        h.querySelector('.su-title').textContent = this.t(titleKey);
        const x = h.querySelector('.su-x');
        x.setAttribute('aria-label', this.t('su.close'));
        this._on(x, () => this.close());
        return h;
    },

    _toast(text, good) {
        let t = this._ui && this._ui.toast;
        if (!t) { t = this._el('div', 'su-toast'); this._root.appendChild(t); if (this._ui) this._ui.toast = t; }
        t.textContent = text;
        t.classList.toggle('good', !!good);
        t.classList.add('on');
        clearTimeout(this._toastT);
        this._toastT = setTimeout(() => t.classList.remove('on'), 2200);
    },

    _confetti(host, n) {
        const colors = ['#FFD23F', '#FF5D73', '#2EC4B6', '#4CC9F0', '#7B61FF', '#ffffff'];
        const w = host.clientWidth || 300;
        for (let i = 0; i < n; i++) {
            const c = this._el('i', 'su-cf');
            c.style.left = Math.round(Math.random() * w) + 'px';
            c.style.background = colors[i % colors.length];
            c.style.setProperty('--dx', Math.round((Math.random() - 0.5) * 160) + 'px');
            c.style.setProperty('--rot', Math.round(Math.random() * 720 - 360) + 'deg');
            c.style.animationDelay = (Math.random() * 0.35).toFixed(2) + 's';
            c.style.animationDuration = (1.2 + Math.random() * 0.9).toFixed(2) + 's';
            host.appendChild(c);
            setTimeout(() => c.remove(), 2600);
        }
    },

    _onResize() {
        if (this._kind === 'wheel') { this._sizeWheel(); this._drawWheel(); }
        this._mirrorDirty = true;
    },

    // ---- общий опрос раз в полсекунды (таймеры и ожидание рекламы) -----------------------------------
    _tick() {
        if (!this.isOpen()) return;
        if (this._kind === 'shop') { this._refreshPanel(); }
        else if (this._kind === 'daily') this._dailyTimer();
        else this._wheelCtl();
    },

    // =============================================================================================================
    // МАГАЗИН
    // =============================================================================================================
    /** tab — id вкладки, на которой открыться; без него — первая (brainrot). */
    _openShop(tab) {
        const tabs = Shop.tabs();
        this._tab = tab && tabs.some((t) => t.id === tab) ? tab : tabs[0].id;
        const win = this._el('section', 'su-win su-shop');
        win.appendChild(this._head(this.ICON.shop, 'su.shop', true));
        const body = this._el('div', 'su-shopbody',
            '<aside class="su-side"><div class="su-mirror"></div>'
            + '<div class="su-sidecol"><div class="su-info"><div class="su-iname"></div><div class="su-irar"></div><div class="su-ipips"></div></div>'
            + '<button class="su-pill su-act" type="button"></button><div class="su-hint"></div></div></aside>'
            + '<div class="su-main"><nav class="su-tabs" role="tablist"></nav><div class="su-note"></div><div class="su-grid"></div></div>');
        win.appendChild(body);
        this._setWin(win);
        this._ui = { cards: new Map(), tabs: new Map(), toast: null, pop: null };
        const ui = this._ui;
        ui.mirror = this.$('.su-mirror'); ui.name = this.$('.su-iname'); ui.rar = this.$('.su-irar'); ui.pips = this.$('.su-ipips');
        ui.act = this.$('.su-act'); ui.hint = this.$('.su-hint'); ui.grid = this.$('.su-grid'); ui.tabsEl = this.$('.su-tabs'); ui.note = this.$('.su-note');
        ui.coins = this.$('.su-coins'); ui.coinsB = this.$('.su-coins b'); ui.lastCoins = Shop.coins;
        for (const t of tabs) {
            const b = this._el('button', 'su-tab' + (t.data && t.data.special ? ' special' : ''));
            b.type = 'button';
            b.setAttribute('role', 'tab');
            b.innerHTML = '<span class="su-ti">' + (this.TAB_ICON[t.data && t.data.icon] || this.TAB_ICON[t.id] || '') + '</span><b></b><small></small>';
            b.querySelector('b').textContent = t.name;
            this._on(b, () => this._setTab(t.id));
            ui.tabsEl.appendChild(b);
            ui.tabs.set(t.id, b);
        }
        this._on(ui.act, () => this._act());
        this._unsub = Shop.on((e) => this._onShop(e));
        Shop.clearPreview();
        this._setTab(this._tab, true);
        this._mirror();
        this._refreshCoins(false);
    },

    /** События Shop, пока окно открыто. */
    _onShop(e) {
        if (!this.isOpen() || this._kind !== 'shop' || !this._ui) return;
        if (e.type === 'coins') this._refreshCoins(true);
        this._refreshCards();
        this._refreshPanel();
        this._refreshTabs();
        if (e.type === 'equip' || e.type === 'unequip' || e.type === 'preview' || e.type === 'grant') this._mirrorDirty = true;
        if (this._mirrorDirty) { this._mirrorDirty = false; this._mirror(); }
    },

    _refreshCoins(anim) {
        const ui = this._ui;
        if (!ui || !ui.coinsB) return;
        ui.coinsB.textContent = String(Shop.coins);
        if (anim && Shop.coins !== ui.lastCoins) { ui.coins.classList.remove('pop'); void ui.coins.offsetWidth; ui.coins.classList.add('pop'); }
        ui.lastCoins = Shop.coins;
    },

    /** «Зеркало»: Нуб целиком в надетом и примеряемом. */
    _mirror() {
        const ui = this._ui;
        if (!ui || !ui.mirror || typeof Cosmetics === 'undefined') return;
        const c = Cosmetics.portrait(Shop.look(), 168);
        c.style.width = '100%'; c.style.height = '100%';
        ui.mirror.replaceChildren(c);
    },

    _refreshTabs() {
        for (const t of Shop.tabs()) {
            const b = this._ui.tabs.get(t.id);
            if (!b) continue;
            b.classList.toggle('on', t.id === this._tab);
            b.setAttribute('aria-selected', t.id === this._tab ? 'true' : 'false');
            b.querySelector('small').textContent = t.owned + '/' + t.count;
        }
    },

    /** Выбрать вкладку: заново построить карточки, снять примерку, выбрать надетое. */
    _setTab(id, first) {
        const ui = this._ui;
        this._tab = id;
        if (!first) Shop.clearPreview();
        const cards = Shop.cards(id);
        ui.cards.clear();
        ui.grid.replaceChildren();
        ui.grid.scrollTop = 0;
        const special = !!(Shop.tabs().find((t) => t.id === id) || { data: {} }).data.special;
        ui.note.textContent = special ? this.t('su.brainNote') : '';
        const frag = document.createDocumentFragment();
        for (const c of cards) {
            const b = this._el('button', 'su-card' + (special ? ' brain' : ''));
            b.type = 'button';
            b.dataset.id = c.id;
            b.dataset.r = c.rarity || 'common';
            b.style.setProperty('--rc', (typeof Cosmetics !== 'undefined' && Cosmetics.RARITY_COLOR[c.rarity]) || '#9aa3b2');
            const ico = this._el('span', 'su-cico');
            if (typeof Cosmetics !== 'undefined') ico.appendChild(Cosmetics.icon(c.item, 88));
            b.appendChild(ico);
            b.appendChild(this._el('span', 'su-cname')).textContent = c.name;
            b.appendChild(this._el('span', 'su-cprice'));
            b.appendChild(this._el('img', 'su-cbadge'));
            this._on(b, () => this._select(c.id));
            frag.appendChild(b);
            ui.cards.set(c.id, b);
        }
        ui.grid.appendChild(frag);
        // выбранное: надетое в слоте вкладки (если оно в этой вкладке), иначе ничего
        const slot = cards[0] ? cards[0].slot : id;
        const eq = Shop.equippedId(slot);
        this._sel = eq && ui.cards.has(eq) ? eq : null;
        this._refreshTabs();
        this._refreshCards();
        this._refreshPanel();
        this._mirrorDirty = true;
        this._mirror();
    },

    /** Нажатие на карточку: выбрать и примерить на Нубе. */
    _select(id) {
        this._sel = id;
        Shop.preview(id);
        this._refreshCards();
        this._refreshPanel();
        this._mirror();
    },

    /** Подписи карточек по состоянию Shop. */
    _refreshCards() {
        const ui = this._ui;
        if (!ui) return;
        for (const [id, b] of ui.cards) {
            const c = Shop.card(id);
            if (!c) continue;
            b.classList.toggle('sel', id === this._sel);
            b.classList.toggle('eq', c.equipped);
            const price = b.querySelector('.su-cprice');
            price.className = 'su-cprice';
            if (c.equipped) { price.classList.add('own'); price.innerHTML = this.img(this.ICON.check) + '<span></span>'; price.lastChild.textContent = Shop.t('shop.equipped'); }
            else if (c.owned) { price.classList.add('own'); price.textContent = Shop.t('shop.owned'); }
            else if (c.kind === 'coins') { if (!c.affordable) price.classList.add('poor'); price.innerHTML = this.img(this.ICON.coin) + '<span>' + c.price + '</span>'; }
            else if (c.kind === 'ads') price.innerHTML = this.img(this.ICON.tv) + '<span>' + c.progress + '/' + c.need + '</span>';
            else if (c.kind === 'exclusive') { price.innerHTML = this.img(this.ICON.crown) + '<span></span>'; price.lastChild.textContent = Shop.t('shop.exclusive.daily'); }
            const badge = b.querySelector('.su-cbadge');
            const src = c.equipped ? this.ICON.check : c.owned ? '' : this.ICON.lock;
            if (src) { badge.src = src; badge.style.display = ''; } else badge.style.display = 'none';
        }
    },

    /** Панель выбранной вещи: имя, редкость, прогресс, главная кнопка и пояснение. */
    _refreshPanel() {
        const ui = this._ui;
        if (!ui || !ui.act) return;
        const c = this._sel ? Shop.card(this._sel) : null;
        const rewarded = typeof Platform === 'undefined' || Platform.rewardedSupported();
        const act = ui.act;
        ui.pips.replaceChildren();
        if (!c) {
            ui.name.textContent = (Shop.tabs().find((t) => t.id === this._tab) || { name: '' }).name;
            ui.rar.style.display = 'none';
            act.style.display = 'none';
            ui.hint.textContent = this.t('su.pick'); ui.hint.className = 'su-hint';
            return;
        }
        ui.name.textContent = c.name;
        ui.rar.style.display = c.rarityLabel ? '' : 'none';
        ui.rar.textContent = c.rarityLabel;
        ui.rar.style.setProperty('--rc', (typeof Cosmetics !== 'undefined' && Cosmetics.RARITY_COLOR[c.rarity]) || '#9aa3b2');
        if (c.kind === 'ads' && !c.owned) for (let i = 0; i < c.need; i++) ui.pips.appendChild(this._el('i', 'su-pip' + (i < c.progress ? ' on' : '')));
        act.style.display = '';
        let label = '', disabled = !c.enabled, hint = c.hint, bad = false, cls = 'su-pill su-act';
        if (c.action === 'buy') {
            cls += ' su-tape';
            label = '<span>' + Shop.t('shop.buy') + '</span>' + this.img(this.ICON.coin) + '<b>' + c.price + '</b>';
        } else if (c.action === 'watch') {
            cls += ' su-ad';
            const wait = c.adWait;
            if (!rewarded) { disabled = true; hint = this.t('su.noAds'); bad = true; }
            else if (c.busy || this._busy) { disabled = true; hint = ''; }
            else if (wait > 0) { disabled = true; hint = this.t('su.retryIn', { n: wait }); bad = true; }
            label = this.img(this.ICON.tv) + '<span>' + (c.busy || this._busy ? this.t('su.loadingAd') : Shop.t('shop.adProgress', { a: c.progress, b: c.need })) + '</span>';
            if (!hint && !disabled) hint = this.t('su.adViews', { a: c.progress, b: c.need });
        } else if (c.action === 'equip') { cls += ' su-tape'; label = '<span>' + Shop.t('shop.equip') + '</span>'; hint = c.owned ? '' : hint; }
        else if (c.action === 'unequip') { label = '<span>' + Shop.t('shop.unequip') + '</span>'; }
        else if (c.kind === 'exclusive') { cls += ' su-tape'; label = this.img(this.ICON.crown) + '<span>' + Shop.t('shop.exclusive.daily') + '</span>'; disabled = true; hint = this.t('su.exclusiveHint'); }
        else { cls += ' su-done'; label = this.img(this.ICON.check) + '<span>' + Shop.t('shop.equipped') + '</span>'; disabled = true; hint = ''; }
        if (!c.owned && c.action !== 'none' && !hint && this._previewing()) hint = this.t('su.trying');
        act.className = cls;
        if (act.dataset.sig !== label) { act.innerHTML = label; act.dataset.sig = label; }
        act.disabled = disabled;
        ui.hint.textContent = hint || '';
        ui.hint.className = 'su-hint' + (bad ? ' bad' : '');
        ui.act.style.setProperty('--c', c.action === 'watch' ? 'var(--violet)' : c.action === 'unequip' ? 'var(--sky)' : '');
    },

    _previewing() { return !!(this._sel && Shop.look()[Shop.card(this._sel).slot] === this._sel && !Shop.isEquipped(this._sel)); },

    /** Главная кнопка панели: купить / посмотреть рекламу / надеть / снять. */
    async _act() {
        const ui = this._ui;
        if (!ui || !this._sel || this._busy) return;
        const id = this._sel, c = Shop.card(id);
        if (!c || !c.enabled) return;
        if (c.action === 'watch') {
            this._busy = true;
            this._refreshPanel();
            let r;
            try { r = await Shop.watchAd(id); } finally { this._busy = false; }
            if (!this.isOpen() || this._kind !== 'shop') return;
            if (r && r.ok) {
                if (r.unlocked) {
                    this._snd('reward');
                    this._toast(this.t('su.unlocked', { name: Shop.name(id) }), true);
                    this._confetti(this._win, 26);
                    this._analytics('shop_unlock', { item: id });
                } else this._toast(this.t('su.adViews', { a: r.progress, b: r.need }), false);
            } else if (r && (r.reason === 'adFailed')) { this._snd('bad'); this._toast(this.t('su.adFailed'), false); }
            this._refreshCards(); this._refreshPanel(); this._refreshTabs();
            return;
        }
        const r = await Shop.act(id);
        if (!this.isOpen() || this._kind !== 'shop') return;
        if (r && r.ok && c.action === 'buy') {
            this._snd('coin');
            this._toast(this.t('su.bought', { name: Shop.name(id) }), true);
            this._confetti(this._win, 18);
            this._analytics('shop_buy', { item: id });
        }
        this._refreshCards(); this._refreshPanel(); this._refreshTabs();
    },

    _analytics(name, data) {
        try { if (typeof Platform !== 'undefined' && typeof Platform.analytics === 'function') Platform.analytics(name, data); } catch (e) { /* аналитика не критична */ }
    },

    // =============================================================================================================
    // ПОДАРОК ДНЯ
    // =============================================================================================================
    _openDaily() {
        const win = this._el('section', 'su-win su-center su-daily');
        win.appendChild(this._head(this.ICON.gift, 'su.daily', false));
        win.appendChild(this._el('div', 'su-dbody',
            '<div class="su-dsub"></div><div class="su-days"></div>'
            + '<div class="su-dbtns"><button class="su-pill su-tape su-claim" type="button" data-noad></button>'
            + '<button class="su-pill su-x2" type="button" style="--c:var(--violet)"></button></div>'
            + '<div class="su-hint"></div><div class="su-next"></div>'));
        this._setWin(win);
        this._ui = { toast: null, pop: null };
        const ui = this._ui;
        ui.sub = this.$('.su-dsub'); ui.days = this.$('.su-days'); ui.claim = this.$('.su-claim'); ui.x2 = this.$('.su-x2');
        ui.hint = this.$('.su-hint'); ui.next = this.$('.su-next');
        this._on(ui.claim, () => this._claim(false));
        this._on(ui.x2, () => this._claim(true));
        this._renderDaily();
    },

    /** Картинка награды дня: монеты, предмет или подарок со случайным предметом. */
    _rewardVisual(d) {
        const host = this._el('div', 'su-dv');
        const r = d.reward;
        const itemId = r.exclusive || r.item;
        if (itemId && typeof Cosmetics !== 'undefined') host.appendChild(Cosmetics.icon(itemId, d.exclusive ? 92 : 64));
        else if (r.coins > 0) {
            // награда растёт на глазах: монета → две → горка → мешок → сундук
            const n = d.day || 1;
            if (r.big || n >= 6) host.innerHTML = this.img(this.ICON.chest, 'su-ico su-big');
            else if (n === 5) host.innerHTML = this.img(this.ICON.bag, 'su-ico su-big');
            else {
                const k = Math.min(3, n);
                let h = '<span class="su-stack s' + k + '">';
                for (let i = 0; i < k; i++) h += this.img(this.ICON.coin, 'su-ico su-c' + i);
                host.innerHTML = h + '</span>';
            }
        } else host.innerHTML = this.img(this.ICON.gift, 'su-ico su-big');
        // + случайный предмет: подарок в углу (внутри карточки)
        if (!d.exclusive && r.coins > 0 && (r.randomItems > 0 || r.item)) host.insertAdjacentHTML('beforeend', this.img(this.ICON.gift, 'su-ico su-extra'));
        return host;
    },

    _renderDaily() {
        const ui = this._ui;
        if (!ui || !ui.days) return;
        const v = DailyGift.view();
        ui.days.replaceChildren();
        for (const d of v.days) {
            const card = this._el('div', 'su-dc ' + d.state + (d.exclusive ? ' d7' : ''));
            card.appendChild(this._el('div', 'su-dd')).textContent = d.dayLabel;
            card.appendChild(this._rewardVisual(d));
            const txt = this._el('div', 'su-dtxt');
            const amt = this._el('div', 'su-da');
            const r = d.reward;
            if (d.exclusive && r.exclusive) amt.textContent = Shop.name(r.exclusive);
            else if (r.coins > 0) amt.textContent = (r.big ? '' : '') + r.coins;
            else if (r.randomItems > 0) amt.textContent = '?';
            txt.appendChild(amt);
            if (d.exclusive && r.exclusive) txt.appendChild(this._el('div', 'su-ds')).textContent = Shop.t('shop.exclusive');
            else txt.appendChild(this._el('div', 'su-ds')).textContent = d.stateLabel;
            card.appendChild(txt);
            if (d.state === 'claimed') card.insertAdjacentHTML('beforeend', this.img(this.ICON.check, 'su-ok'));
            ui.days.appendChild(card);
        }
        ui.sub.textContent = this.t('su.dayOf', { n: v.nextDay, m: DailyGift.cycleDays() });
        this._dailyButtons(v);
        this._dailyTimer();
    },

    /** Кнопки: забрать, x2 за рекламу и пояснения (рекламы нет — неактивна с причиной). */
    _dailyButtons(v) {
        const ui = this._ui;
        const rewarded = typeof Platform === 'undefined' || Platform.rewardedSupported();
        const can = v.canClaim;
        ui.claim.disabled = !can || this._busy;
        ui.claim.innerHTML = can ? this.img(this.ICON.gift) + '<span>' + v.claim.label + '</span>' : this.img(this.ICON.check) + '<span>' + this.t('daily.claimed') + '</span>';
        const x2 = v.x2;
        ui.x2.style.display = can && x2.available ? '' : 'none';
        ui.x2.disabled = !x2.enabled || !rewarded || this._busy;
        ui.x2.innerHTML = this.img(this.ICON.tv) + '<span>' + x2.label + (x2.rewardLabel ? '<small>' + x2.rewardLabel + '</small>' : '') + '</span>';
        let hint = x2.hint, bad = false;
        if (can && x2.available && !rewarded) { hint = this.t('su.noAds'); bad = true; }
        else if (can && x2.available && x2.adWait > 0) { hint = this.t('su.retryIn', { n: x2.adWait }); bad = true; }
        ui.hint.textContent = can ? (hint || '') : '';
        ui.hint.className = 'su-hint' + (bad ? ' bad' : '');
    },

    _dailyTimer() {
        const ui = this._ui;
        if (!ui || !ui.next) return;
        const st = DailyGift.status();
        if (st.canClaim) { ui.next.textContent = ''; ui.next.style.display = 'none'; }
        else { ui.next.style.display = ''; ui.next.innerHTML = this.img(this.ICON.timer) + '<span></span>'; ui.next.lastChild.textContent = st.nextLabel; }
        if (this._kind === 'daily' && !this._busy) this._dailyButtons(DailyGift.view());
    },

    async _claim(x2) {
        if (this._busy || !this.isOpen() || this._kind !== 'daily') return;
        this._busy = true;
        this._dailyButtons(DailyGift.view());
        let r;
        try { r = x2 ? await DailyGift.claimX2() : DailyGift.claim(); } finally { this._busy = false; }
        if (!this.isOpen() || this._kind !== 'daily') return;
        if (!r || !r.ok) {
            if (r && r.reason === 'adFailed') { this._snd('bad'); this._toast(this.t('su.adFailed'), false); }
            this._renderDaily();
            return;
        }
        this._snd('reward');
        this._analytics('daily_claim', { day: r.day, x2: x2 ? 1 : 0 });
        this._renderDaily();
        this._popup({ title: this.t('su.youGot'), got: r.got });
    },

    // =============================================================================================================
    // КОЛЕСО ФОРТУНЫ
    // =============================================================================================================
    _openWheel() {
        const win = this._el('section', 'su-win su-center su-wheelwin');
        win.appendChild(this._head(this.ICON.wheel, 'su.wheel', false));
        win.appendChild(this._el('div', 'su-wbody',
            '<div class="su-wbox"><canvas></canvas>'
            + '<svg class="su-ptr" viewBox="0 0 40 50"><path d="M20 48 4 14C-2 2 10 -2 20 -2s22 4 16 16z" fill="#FF5D73" stroke="#1B1B3A" stroke-width="4" stroke-linejoin="round"/><circle cx="20" cy="14" r="5" fill="#fff" stroke="#1B1B3A" stroke-width="3"/></svg>'
            + '<div class="su-hub">' + this.img(this.ICON.star, '') + '</div></div>'
            + '<div class="su-wctl"><div class="su-wstat"></div>'
            + '<button class="su-pill su-tape su-spinfree" type="button" data-noad></button>'
            + '<button class="su-pill su-spinad" type="button" style="--c:var(--violet)"></button>'
            + '<div class="su-hint"></div></div>'));
        this._setWin(win);
        this._ui = { toast: null, pop: null };
        const ui = this._ui;
        ui.box = this.$('.su-wbox'); ui.canvas = this.$('.su-wbox canvas'); ui.ptr = this.$('.su-ptr');
        ui.stat = this.$('.su-wstat'); ui.free = this.$('.su-spinfree'); ui.ad = this.$('.su-spinad'); ui.hint = this.$('.su-hint');
        this._on(ui.free, () => this._spinFree());
        this._on(ui.ad, () => this._spinAd());
        ui.canvas.style.transform = 'rotate(' + this._wAngle + 'deg)';
        this._sizeWheel();
        this._drawWheel();
        this._wheelCtl();
        // предметы-призы: картинки лиц и т. п. могут догружаться — перерисовать диск
        try { if (typeof Cosmetics !== 'undefined') Cosmetics.preload(Wheel.sectors().map((s) => s.itemId).filter(Boolean), () => this._drawWheel()); } catch (e) { /* не критично */ }
        // вращение, прерванное закрытием страницы, уже выдано при init: покажем приз
        if (this._recovered) {
            const e = this._recovered;
            this._recovered = null;
            setTimeout(() => { if (this.isOpen() && this._kind === 'wheel') this._popup({ title: this.t('su.lastPrize'), got: e.got, label: e.label }); }, 350);
        } else {
            const st = Wheel.status();
            if (st.pending) { const res = Wheel.pendingSpin(); if (res && res.stale) this._finishSpin(res); }
        }
    },

    /** Размер холста колеса по CSS-размеру блока (с учётом плотности пикселей). */
    _sizeWheel() {
        const ui = this._ui;
        if (!ui || !ui.box) return;
        const css = Math.max(120, Math.round(ui.box.getBoundingClientRect().width));
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const px = Math.round(css * dpr);
        if (ui.canvas.width !== px) { ui.canvas.width = px; ui.canvas.height = px; }
    },

    /** Картинка из assets/ui/icons для холста (кэш; после загрузки — перерисовать колесо). */
    _wimg(src) {
        let im = this._imgs.get(src);
        if (!im) {
            im = new Image();
            im.onload = () => { if (this.isOpen() && this._kind === 'wheel') this._drawWheel(); };
            im.src = src;
            this._imgs.set(src, im);
        }
        return im.complete && im.naturalWidth ? im : null;
    },

    /** Нарисовать диск: метровая лента по краю, секторы с призами, лампочки. Сектор 0 — под стрелкой сверху, дальше по часовой. */
    _drawWheel() {
        const ui = this._ui;
        if (!ui || !ui.canvas) return;
        const cv = ui.canvas, g = cv.getContext('2d'), S = cv.width, C = S / 2;
        g.clearRect(0, 0, S, S);
        const sectors = Wheel.sectors();
        const n = sectors.length, step = Math.PI * 2 / n;
        const k = S / 400;   // единицы чертежа: холст 400×400
        g.save(); g.scale(k, k);
        // ободок: тёмный, жёлтая лента с делениями
        g.fillStyle = '#1B1B3A'; g.beginPath(); g.arc(200, 200, 199, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#FFD23F'; g.beginPath(); g.arc(200, 200, 190, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#1B1B3A'; g.lineCap = 'butt';
        for (let i = 0; i < 120; i++) {
            const a = i / 120 * Math.PI * 2, long = i % 5 === 0;
            g.lineWidth = long ? 3 : 2;
            g.beginPath(); g.moveTo(200 + Math.cos(a) * 190, 200 + Math.sin(a) * 190); g.lineTo(200 + Math.cos(a) * (long ? 172 : 179), 200 + Math.sin(a) * (long ? 172 : 179)); g.stroke();
        }
        g.fillStyle = '#1B1B3A'; g.beginPath(); g.arc(200, 200, 166, 0, Math.PI * 2); g.fill();
        const R = 160;
        const palette = ['#FFD23F', '#4CC9F0', '#FF5D73', '#2EC4B6'];
        const imgCoin = this._wimg(this.ICON.coin);
        sectors.forEach((s, i) => {
            const a0 = -Math.PI / 2 + (i - 0.5) * step, a1 = a0 + step;
            const col = (s.data && s.data.color) || palette[i % palette.length];
            const grd = g.createRadialGradient(200, 200, 20, 200, 200, R);
            grd.addColorStop(0, this._shade(col, 1.25)); grd.addColorStop(1, col);
            g.beginPath(); g.moveTo(200, 200); g.arc(200, 200, R, a0, a1); g.closePath();
            g.fillStyle = grd; g.fill();
            g.strokeStyle = '#1B1B3A'; g.lineWidth = 4; g.lineJoin = 'round'; g.stroke();
            // содержимое: повёрнуто по лучу сектора, «верх» — наружу
            g.save(); g.translate(200, 200); g.rotate(i * step);
            if (s.kind === 'item' && s.itemId && typeof Cosmetics !== 'undefined') {
                const ic = Cosmetics.icon(s.itemId, 86);
                g.drawImage(ic, -39, -R + 12, 78, 78);
                g.font = '900 15px Rubik, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 4; g.strokeStyle = '#1B1B3A'; g.fillStyle = '#fff'; g.lineJoin = 'round';
                const nm = Shop.name(s.itemId);
                const short = nm.length > 13 ? nm.slice(0, 12) + '…' : nm;
                g.strokeText(short, 0, -R + 100); g.fillText(short, 0, -R + 100);
            } else {
                if (imgCoin) g.drawImage(imgCoin, -22, -R + 14, 44, 44);
                g.font = '900 30px Rubik, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
                g.lineWidth = 6; g.strokeStyle = '#1B1B3A'; g.strokeText(String(s.coins), 0, -R + 78);
                g.fillStyle = '#fff'; g.fillText(String(s.coins), 0, -R + 78);
            }
            g.restore();
        });
        // лампочки между секторами
        for (let i = 0; i < n; i++) {
            const a = -Math.PI / 2 + (i - 0.5) * step;
            g.fillStyle = '#fff'; g.strokeStyle = '#1B1B3A'; g.lineWidth = 3;
            g.beginPath(); g.arc(200 + Math.cos(a) * R, 200 + Math.sin(a) * R, 6, 0, Math.PI * 2); g.fill(); g.stroke();
        }
        g.restore();
        void C;
    },

    /** Кнопки и подписи по Wheel.status(). */
    _wheelCtl() {
        const ui = this._ui;
        if (!ui || !ui.free) return;
        const st = Wheel.status();
        const rewarded = typeof Platform === 'undefined' || Platform.rewardedSupported();
        const spinning = !!this._spin;
        ui.free.disabled = !st.canSpinFree || spinning;
        ui.free.innerHTML = this.img(st.canSpinFree ? this.ICON.wheel : this.ICON.timer) + '<span></span>';
        ui.free.lastChild.textContent = spinning ? this.t('wheel.spinning') : st.freeLabel;
        const adOk = st.canSpinAd && rewarded && !spinning && !this._busy;
        ui.ad.disabled = !adOk;
        ui.ad.innerHTML = this.img(this.ICON.tv) + '<span></span>';
        ui.ad.lastChild.textContent = this._busy ? this.t('su.loadingAd') : st.adLabel;
        let hint = st.hint, bad = false;
        if (!rewarded && st.adLeft > 0) { hint = this.t('su.noAds'); bad = true; }
        else if (st.adWait > 0) { hint = this.t('su.retryIn', { n: st.adWait }); bad = true; }
        ui.stat.textContent = spinning ? '' : this.t('su.sectorsHint');
        ui.hint.textContent = spinning ? '' : (hint || '');
        ui.hint.className = 'su-hint' + (bad ? ' bad' : '');
    },

    _spinFree() {
        if (this._spin || this._busy) return;
        const r = Wheel.spinFree();
        if (r.ok) { this._analytics('wheel_spin', { kind: 'free' }); this._startSpin(r); }
        else { if (r.reason === 'pending' && r.pending) this._finishSpin(r.pending); this._wheelCtl(); }
    },

    async _spinAd() {
        if (this._spin || this._busy) return;
        this._busy = true;
        this._wheelCtl();
        let r;
        try { r = await Wheel.spinAd(); } finally { this._busy = false; }
        if (!this.isOpen() || this._kind !== 'wheel') { if (r && r.ok) { /* окно закрыли во время рекламы: вращение хранится как ожидающее, приз выдаст следующий init */ } return; }
        if (r && r.ok) { this._analytics('wheel_spin', { kind: 'ad' }); this._startSpin(r); }
        else { if (r && r.reason === 'adFailed') { this._snd('bad'); this._toast(this.t('su.adFailed'), false); } this._wheelCtl(); }
    },

    /** Анимация вращения до заранее выбранного сектора (результат уже в Wheel.state.pending). */
    _startSpin(res) {
        const ui = this._ui;
        const from = this._wAngle, to = Wheel.angleFrom(from, res);
        this._spin = { res, from, to, t0: performance.now(), dur: Math.max(1500, res.durationMs || 5500), lastSector: Wheel.sectorAt(from), lastTick: 0 };
        this._wheelCtl();
        const frame = (now) => {
            const s = this._spin;
            if (!s || s.res !== res) return;
            const t = Math.min(1, (now - s.t0) / s.dur), e = 1 - Math.pow(1 - t, 4);
            const a = s.from + (s.to - s.from) * e;
            this._wAngle = a;
            if (this._ui && this._ui.canvas) this._ui.canvas.style.transform = 'rotate(' + a + 'deg)';
            const sec = Wheel.sectorAt(a);
            if (sec !== s.lastSector) {
                s.lastSector = sec;
                if (now - s.lastTick > 55) { s.lastTick = now; this._snd('tick'); if (this._ui && this._ui.ptr) { this._ui.ptr.style.transform = 'translateX(-50%) rotate(-16deg)'; setTimeout(() => { if (this._ui && this._ui.ptr) this._ui.ptr.style.transform = 'translateX(-50%)'; }, 70); } }
            }
            if (t < 1) requestAnimationFrame(frame); else this._endSpin();
        };
        requestAnimationFrame(frame);
        void ui;
    },

    /** Вращение закончилось (или его домотали): диск ровно на секторе, приз выдан один раз. */
    _endSpin(silent) {
        const s = this._spin;
        if (!s) return;
        this._spin = null;
        this._wAngle = s.to % 360 === 0 ? s.to : s.to;
        if (this._ui && this._ui.canvas) this._ui.canvas.style.transform = 'rotate(' + this._wAngle + 'deg)';
        const r = Wheel.finish();
        if (silent) return;
        this._drawWheel();
        this._wheelCtl();
        if (r && r.ok) this._popup({ title: Wheel.t('wheel.win'), got: r.got, label: r.label, wheel: true });
    },

    /** Домотать вращение мгновенно (Esc или закрытие окна): приз всё равно выдаётся ровно один раз. */
    _skipSpin(silent) {
        const s = this._spin;
        if (!s) return;
        this._endSpin(silent);
    },

    /** Завершить ожидающее вращение без анимации (страницу закрывали посреди вращения) и показать приз. */
    _finishSpin(res) {
        void res;
        const r = Wheel.finish();
        this._drawWheel();
        this._wheelCtl();
        if (r && r.ok) this._popup({ title: Wheel.t('wheel.win'), got: r.got, label: r.label, wheel: true });
    },

    // =============================================================================================================
    // КАРТОЧКА ПРИЗА (подарок дня и колесо)
    // =============================================================================================================
    /** Что выдано: got — [{ type: 'coins' | 'item' | 'exclusive', amount, id, converted }]. */
    _popup(o) {
        const ui = this._ui;
        if (!ui) return;
        this._closePop();
        const pop = this._el('div', 'su-pop');
        const card = this._el('div', 'su-pcard');
        card.appendChild(this._el('div', 'su-burst'));
        card.appendChild(this._el('div', 'su-ptitle su-o')).textContent = o.title || '';
        const items = this._el('div', 'su-pitems');
        let dup = false;
        const equip = [];
        for (const it of o.got || []) {
            const cell = this._el('div', 'su-pit');
            if (it.type === 'coins') {
                if (it.converted) dup = true;
                cell.innerHTML = this.img(it.big ? this.ICON.bag : this.ICON.coin) + '<div class="su-pamt"><span></span></div>';
                cell.querySelector('.su-pamt span').textContent = '+' + it.amount;
            } else if (it.id) {
                if (typeof Cosmetics !== 'undefined') cell.appendChild(Cosmetics.icon(it.id, 96));
                cell.appendChild(this._el('div', 'su-pnm')).textContent = Shop.name(it.id);
                const card2 = Shop.card(it.id);
                if (card2 && card2.rarityLabel) cell.appendChild(this._el('div', 'su-pnote')).textContent = card2.rarityLabel;
                equip.push(it.id);
            }
            items.appendChild(cell);
        }
        card.appendChild(items);
        if (dup) card.appendChild(this._el('div', 'su-pnote')).textContent = this.t('su.dupNote');
        const btns = this._el('div', 'su-pbtns');
        if (equip.length) {
            const eq = this._el('button', 'su-pill su-tape');
            eq.type = 'button'; eq.textContent = this.t('su.equipNow');
            this._on(eq, () => { for (const id of equip) { const r = Shop.equip(id); if (r && r.ok) break; } this._closePop(); });
            btns.appendChild(eq);
        }
        const ok = this._el('button', 'su-pill');
        ok.type = 'button'; ok.style.setProperty('--c', 'var(--mint)'); ok.textContent = this.t('su.nice');
        this._on(ok, () => this._closePop());
        btns.appendChild(ok);
        card.appendChild(btns);
        pop.appendChild(card);
        this._win.appendChild(pop);
        ui.pop = pop;
        this._confetti(pop, 34);
        this._snd(o.wheel && (o.got || []).some((x) => x.type === 'coins' && x.amount >= 200) ? 'win' : 'reward');
        if ((o.got || []).some((x) => x.type === 'coins')) setTimeout(() => this._snd('coin'), 220);
    },

    _closePop() {
        const ui = this._ui;
        if (ui && ui.pop) { ui.pop.remove(); ui.pop = null; }
    },

    /** Цвет #rrggbb светлее (f > 1) или темнее (f < 1) -> rgb(). */
    _shade(c, f) {
        const n = parseInt(String(c).replace('#', ''), 16) || 0;
        const ch = (v) => Math.max(0, Math.min(255, Math.round(f > 1 ? v + (255 - v) * (f - 1) : v * f)));
        return 'rgb(' + ch((n >> 16) & 255) + ',' + ch((n >> 8) & 255) + ',' + ch(n & 255) + ')';
    },
};

// Строки окна кладём в LANG_STRINGS, не затирая существующие ключи.
if (typeof LANG_STRINGS !== 'undefined') {
    for (const code of Object.keys(ShopUI.TEXT)) {
        const dict = LANG_STRINGS[code];
        if (!dict) continue;
        for (const key of Object.keys(ShopUI.TEXT[code])) if (!(key in dict)) dict[key] = ShopUI.TEXT[code][key];
    }
}
