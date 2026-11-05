// Platform.js — платформа игры: ядро + встроенные адаптеры local, yandex (YaGames) и playables
// (ytgame). Игра зовёт только Platform — SDK знает адаптер. Новая площадка = ещё один адаптер:
// Platform.register(имя, адаптер) в СВОЁМ файле (js/PlatformPlaygama.js — готовый пример), ядро
// не переписывается. Файл адаптера — <script> после Platform.js и строка в CODE_FILES.
// Адаптеры в своих файлах: PlatformPlaygama.js (Bridge), PlatformTelegram.js (Mini App),
// PlatformCrazy.js (CrazyGames), PlatformAndroid.js (нативная обёртка WebView, RuStore),
// PlatformTest.js (сборка test: двойной клик по index.html, тестовая реклама).
// SDK подключает сборка: build.bat yandex вписывает в index.html скрипт /sdk.js,
// build.bat playables — SDK Playables первым скриптом, build.bat playgama — Bridge первым
// скриптом, build.bat telegram — telegram-web-app.js первым, build.bat crazygames — SDK CrazyGames.
// Без SDK (run.bat, web-сборка) работает локальный адаптер: сохранения — в Store,
// реклама — ничего (с ?mockads в адресе — заглушка-оверлей на секунду: проверить паузу, звук
// и выдачу награды).
//
//   await Platform.init()        SDK, язык платформы, события паузы (main.js)
//   Platform.firstFrame()        экран загрузки на экране (Playables firstFrameReady; main.js)
//   Platform.ready()             игра готова к вводу: Яндекс LoadingAPI.ready, Playables gameReady (main.js)
//   Platform.gameplay(on)        идёт ли игровой процесс (Яндекс GameplayAPI start/stop);
//                                на паузе (Pause.js) движок сам шлёт stop, после — start
//   Platform.rewardedSupported() / interstitialSupported()  умеет ли площадка формат: иначе кнопки рекламы прячут
//   Platform.ads.roundEnded(win?) раунд завершён (победа или поражение) — ОДИН раз на раунд;
//                                win (true/false) заодно сообщает итог площадке (Playgama level_completed/level_failed)
//   Platform.ads.next(go)        переход по кнопке «Далее/Заново/Меню»: после двух
//                                результатов сначала interstitial, потом go(); защита от двойного клика
//   await Platform.rewarded(id)  true — ТОЛЬКО если SDK подтвердил просмотр
//   Platform.submitScore(n)      рекорд: Яндекс и Playgama — лидерборд 'Score' (не чаще раза в секунду), Playables — sendScore
//   await Platform.leaderboard() [{ rank, name, score, me, avatar? }] или null (Яндекс, Playgama in_game);
//                                avatar — URL аватара, поля нет, если площадка его не дала
//   Platform.authorized()        игрок вошёл в аккаунт площадки (Яндекс, Playgama); без аккаунтов — false
//   Platform.canLogin()          показывать ли кнопку входа: площадка умеет окно входа, а игрок не вошёл
//   await Platform.login()       окно входа — ТОЛЬКО по нажатию игрока; true — теперь вошёл
//   Platform.analytics(имя, данные)  событие в аналитику площадки (Playgama bridge.analytics.send), у остальных — ничего;
//                                имя snake_case, данные — плоские строки/числа/логические без личных данных (Telemetry.js)
//   await Platform.load()        сохранение игры (объект) или null
//   await Platform.save(obj)     записать сохранение (Яндекс — облако игрока + Store, Playables — saveData, Playgama — bridge.storage);
//                                большое облачное сохранение прозрачно сжимается gzip (PLATFORM_SAVE_GZIP_MIN), старые читаются как есть
//   Platform.langSwitch          в настройках игры показывать переключатель языка (Telegram, test); игрок выбирает язык сам
//   Platform.setLanguage(code)   выбор языка игроком: хранится в Store, применяется сразу без перезапуска (Lang.apply); true — принят
//   Platform.backHandler         «Назад» (Android-обёртка): функция игры, true — игра закрыла окно сама; иначе нативный слой спросит про выход
// На время рекламы игра и звук стоят (Pause 'ad'), после — прежнее состояние.
//
// === КОНТРАКТ АДАПТЕРА =========================================================================
// Platform.register(имя, адаптер): объект с НЕОБЯЗАТЕЛЬНЫМИ полями; чего нет — не поддерживается.
// Площадку выбирает detect(): адаптеры опрашиваются от последнего зарегистрированного к первому
// (адаптер игры перекрывает встроенные; повторная регистрация имени заменяет адаптер); ни один не
// подошёл — 'local'. P в хуках — сам Platform (P.sdk, P.lang, P.player, P.LEADERBOARD…).
//   detect()                     есть ли SDK площадки на странице (до init, без побочных эффектов)
//   async init(P)                поднять SDK: поставить P.sdk и P.lang, подписаться на паузу площадки
//                                (Pause.set('platform', on)) и звук (Sound.setPlatformMuted(!on)), ДО чтения
//                                начального состояния. Ошибка — игра идёт локально; strict: true — ошибка
//                                уходит наружу (Playables: молча перейти на локальные сохранения нельзя)
//   firstFrame(P)                экран загрузки на экране (ядро шлёт один раз)
//   ready(P)                     игра готова к вводу (один раз; при strict ошибка уходит наружу, иначе — warn)
//   gameplay(on, P)              игровой процесс начался/остановился; без повторов и с учётом паузы;
//                                P.playing — игра в раунде (даже если сейчас пауза)
//   async interstitial(P)        показать полноэкранную рекламу -> true, если показ состоялся
//   async rewarded(id, P)        true — ТОЛЬКО по подтверждению SDK; закрытие и ошибка — false
//   supports(kind, P)            kind: 'interstitial' | 'rewarded' | 'analytics' — умеет ли площадка (нет хука — да)
//   levelEnd(win, level, P)      итог раунда (из ads.roundEnded(win)); level — строка или ''
//   scoreInterval                мс между рекордами (ядро отправляет последнее значение позже); 0 — без ограничения
//   submitScore(v, P)            рекорд — целое >= 0
//   async leaderboard(opts, P)   [{ rank, name, score, me, avatar? }] или null; opts.avatarSize — размер аватара
//   async load(P)                сырое сохранение: объект, строка (JSON или 'gz:…') или null; ошибка = reject
//                                (игра увидит её и не затрёт облако; save тоже откажет)
//   async save(data, json, obj, P)  data — строка к записи (JSON или сжатая 'gz:…'), json — несжатый JSON, obj — объект.
//                                Облачный адаптер ПЕРЕД записью зовёт await P.ensureLoaded(). false — не записано
//   authorized(P) / canLogin(P) / async login(P)  аккаунт площадки: вошёл ли, умеет ли окно входа, открыть окно (-> вошёл ли)
//   analytics(name, data, P)     событие аналитики; имя и данные уже проверены ядром
//   pauseOverlay                 true — на паузе платформы видна плашка «Пауза» без кнопок, весь ввод заблокирован (Pause.js)
//   ownAdPause                   true — паузой рекламы ведает адаптер: ядро НЕ ставит 'ad' перед показом, адаптер ставит 'adwait'
//                                (игра стоит, звук играет), на старте ролика — 'ad'. Ядро всё равно снимает обе причины в конце
//   gameplayIgnore               ['auto', …] — причины паузы, которые не считаются остановкой игрового процесса (gameplay(false)
//                                не шлётся): CrazyGames ведёт фокус и уход со страницы сам
//   languageChoice               true — игрок выбирает язык сам (P.langSwitch); после init() ядро ставит P.lang = выбор из Store
//                                (Platform.setLanguage), адаптер в init() кладёт в P.lang язык по умолчанию. Нужен LANG_AUTO = 1
//                                (сборка ставит его платформам telegram и test)
// ===============================================================================================

/**
 * @typedef {object} PlatformAdapter
 * @property {string} [name] ставит Platform.register
 * @property {() => boolean} [detect]
 * @property {boolean} [strict]
 * @property {boolean} [pauseOverlay]
 * @property {boolean} [ownAdPause]
 * @property {string[]} [gameplayIgnore]
 * @property {boolean} [languageChoice]
 * @property {number} [scoreInterval]
 * @property {(P: typeof Platform) => any} [init]
 * @property {(P: typeof Platform) => void} [firstFrame]
 * @property {(P: typeof Platform) => void} [ready]
 * @property {(on: boolean, P: typeof Platform) => void} [gameplay]
 * @property {(P: typeof Platform) => Promise<boolean>} [interstitial]
 * @property {(id: string, P: typeof Platform) => Promise<boolean>} [rewarded]
 * @property {(kind: string, P: typeof Platform) => boolean} [supports]
 * @property {(win: boolean, level: string, P: typeof Platform) => void} [levelEnd]
 * @property {(value: number, P: typeof Platform) => void} [submitScore]
 * @property {(opts: any, P: typeof Platform) => Promise<any[] | null>} [leaderboard]
 * @property {(P: typeof Platform) => Promise<any>} [load]
 * @property {(data: string, json: string, obj: any, P: typeof Platform) => any} [save]
 * @property {(P: typeof Platform) => boolean} [authorized]
 * @property {(P: typeof Platform) => boolean} [canLogin]
 * @property {(P: typeof Platform) => Promise<boolean>} [login]
 * @property {(name: string, data: Record<string, string | number | boolean> | undefined, P: typeof Platform) => void} [analytics]
 */

/** @satisfies {Record<string, any>} */
const Platform = {
    name: 'local',        // имя активного адаптера: 'yandex' | 'playables' | 'playgama' | 'telegram' | 'crazygames' | 'android' | 'test' | 'local' | свой
    /** @type {PlatformAdapter[]} */
    adapters: [],         // зарегистрированные адаптеры (Platform.register)
    /** @type {PlatformAdapter | null} */
    adapter: null,        // активный адаптер (после init)
    sdk: null,            // объект SDK площадки (ysdk, bridge)
    hostId: null,         // Playgama: id площадки-хозяина по Bridge (playgama, yandex, …)
    lang: null,           // язык платформы (BCP-47) или null
    player: null,         // игрок Яндекса
    LEADERBOARD: 'Score', // технический id лидерборда Яндекса и Playgama (в интерфейсе — «Рекорды»)
    langSwitch: false,    // игрок выбирает язык сам (адаптер с languageChoice): в настройках — переключатель
    /** @type {(() => boolean) | null} */
    backHandler: null,    // «Назад» (Android): игра ставит функцию; true — игра закрыла своё окно
    _readySent: false,
    _firstFrameSent: false,
    _playing: false,
    _gameplaySent: false, // последнее, что ушло адаптеру: stop без start не шлётся
    _adBusy: false,
    _loaded: null,        // Promise первого load() — облачная запись только после успешной загрузки
    _loadFailed: false,   // последняя загрузка упала и игра ещё не получила сохранение (см. ensureLoaded)
    _scoreAt: 0,
    _scoreTimer: 0,
    _scorePending: null,

    // --- Адаптеры ---------------------------------------------------------------

    // Зарегистрировать адаптер площадки (контракт — в шапке файла). Возвращает его же.
    /**
     * @param {string} name
     * @param {PlatformAdapter} adapter
     * @returns {PlatformAdapter}
     */
    register(name, adapter) {
        adapter.name = String(name);
        const i = this.adapters.findIndex((a) => a.name === adapter.name);
        if (i >= 0) this.adapters.splice(i, 1);
        this.adapters.push(adapter);
        return adapter;
    },

    _local() { return this.adapters.find((a) => a.name === 'local') || {}; },

    // Площадка по detect(): от последнего зарегистрированного; не нашлась — local.
    _detect() {
        for (let i = this.adapters.length - 1; i >= 0; i--) {
            const a = this.adapters[i];
            if (a.name === 'local' || !a.detect) continue;
            try { if (a.detect()) return a; } catch (e) { /* SDK не отвечает — не эта площадка */ }
        }
        return this._local();
    },

    async init() {
        const a = this._detect();
        this.adapter = a;
        if (a.name !== 'local') {
            this.name = String(a.name);   // адаптер ставит обработчики паузы ещё до await — имя уже нужно
            if (a.pauseOverlay) Pause.platformOverlay = true;
            try {
                if (a.init) await a.init(this);
                if (a.languageChoice) {
                    this.langSwitch = true;
                    const saved = this.savedLanguage();
                    if (saved) this.lang = saved;
                }
            } catch (e) {
                // strict (Playables): нельзя незаметно перейти на локальные сохранения или
                // потерять обязательные SDK-события. Загрузка покажет ошибку/повтор.
                if (a.strict) throw e;
                console.warn('Platform: SDK не поднялся, играем локально — ' + ((e && e.message) || e));
                this.name = 'local';
                this.sdk = null;
                this.adapter = this._local();
                this.langSwitch = false;
                Pause.platformOverlay = false;
            }
        }
        Pause.onChange(() => this._syncGameplay());
        console.log('Platform: ' + this.name + (this.lang ? ', язык платформы ' + this.lang : ''));
        return this;
    },

    // --- Жизненный цикл -------------------------------------------------------

    firstFrame() {
        if (this._firstFrameSent) return;
        const a = this.adapter || this._detect();   // main.js зовёт до init
        if (!a.firstFrame) return;
        a.firstFrame(this);
        this._firstFrameSent = true;
    },

    ready() {
        if (this._readySent) return;
        const a = this.adapter || this._local();
        try {
            if (a.ready) a.ready(this);
            this._readySent = true;
        } catch (e) {
            if (a.strict) throw e;
            console.warn('Platform.ready:', e);
        }
    },

    // on — игрок в игровом процессе (раунд идёт). Меню, экран результата, пауза — false.
    gameplay(on) {
        this._playing = !!on;
        this._syncGameplay();
    },

    // Игра в раунде (gameplay(true)), даже если сейчас пауза.
    get playing() { return this._playing; },

    // Пауза с точки зрения игрового процесса: причины адаптера gameplayIgnore (CrazyGames: 'auto') не в счёт.
    _gameplayPaused(a) {
        const ignore = a && a.gameplayIgnore;
        if (!ignore || !ignore.length || !Pause.reasons) return Pause.active;
        for (const reason of Pause.reasons) if (!ignore.includes(reason)) return true;
        return false;
    },

    _syncGameplay() {
        const a = this.adapter;
        const want = this._playing && !this._gameplayPaused(a);
        if (this._gameplaySent === want) return;
        this._gameplaySent = want;
        if (!a || !a.gameplay) return;
        try { a.gameplay(want, this); } catch (e) { /* SDK без GameplayAPI */ }
    },

    // Итог раунда площадке (ads.roundEnded(win)); level — необязательное имя уровня.
    levelEnd(win, level) {
        const a = this.adapter;
        if (!a || !a.levelEnd) return;
        try { a.levelEnd(!!win, level == null ? '' : String(level), this); } catch (e) { /* площадка не принимает */ }
    },

    // --- Реклама ----------------------------------------------------------------

    // Interstitial. true — запрос успешен (Playables НЕ подтверждает факт показа).
    // Яндекс возвращает shown. Ошибка/нет API — false, переход всё равно продолжается.
    interstitial() { return this._showAd('interstitial', ''); },

    // Rewarded. id — стабильный id награды без данных игрока ('continue', 'coins-x2').
    // true — ТОЛЬКО по подтверждению SDK; закрытие и ошибка — false. Награду выдаёт
    // игра по true и один раз.
    rewarded(id) { return this._showAd('rewarded', id); },

    // Показ рекламы: пауза 'ad' на время показа (адаптер с ownAdPause ведёт паузу сам: 'adwait' -> 'ad'),
    // повторный запрос во время показа и формат без поддержки площадки — сразу false, без паузы.
    async _showAd(kind, id) {
        if (this._adBusy) return false;
        const a = this.adapter || this._local();
        if (!(kind === 'rewarded' ? a.rewarded : a.interstitial) || !this._supports(kind)) return false;
        this._adBusy = true;
        if (!a.ownAdPause) Pause.set('ad', true);
        try {
            return !!(await (kind === 'rewarded' ? a.rewarded(id, this) : a.interstitial(this)));
        } catch (e) {
            return false;
        } finally {
            Pause.set('ad', false);
            if (a.ownAdPause) Pause.set('adwait', false);
            this._adBusy = false;
        }
    },

    // Показывать ли кнопки рекламы: площадка умеет формат (иначе предложение прячут).
    rewardedSupported() { return this._supports('rewarded'); },
    interstitialSupported() { return this._supports('interstitial'); },

    _supports(kind) {
        const a = this.adapter || this._local();
        try { return a.supports ? !!a.supports(kind, this) : true; } catch (e) { return false; }
    },

    // Локальная заглушка рекламы: только с ?mockads в адресе — оверлей на секунду,
    // rewarded засчитывается. Без флага — рекламы нет (false).
    _mockAd(reward) {
        if (!/[?&#]mockads\b/.test(location.search + location.hash)) return Promise.resolve(false);
        return new Promise((resolve) => {
            const el = document.createElement('div');
            el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +
                'background:rgba(0,0,0,.85);color:#fff;font:bold 22px system-ui,sans-serif;text-align:center';
            el.textContent = (reward ? 'REWARDED' : 'INTERSTITIAL') + ' — local mock';
            document.body.appendChild(el);
            setTimeout(() => { el.remove(); resolve(true); }, 1000);
        });
    },

    // Счётчик interstitial по правилу игры: реклама — после каждых ДВУХ завершённых
    // раундов (любой исход), и только по кнопке перехода, не в момент результата.
    ads: {
        results: 0,
        busy: false,

        // Раунд завершён (победа или поражение) — звать ОДИН раз на раунд. win (true/false) —
        // итог, его получит и площадка (Playgama level_completed / level_failed); без win — только счёт.
        roundEnded(win, level) {
            this.results++;
            if (typeof win === 'boolean') Platform.levelEnd(win, level);
        },

        // Переход по кнопке: после двух результатов — сначала реклама, затем go().
        // Повторный клик, пока идёт переход, игнорируется. Реклама не пришла или
        // ошибка — переход без задержки, новый цикл из двух результатов.
        async next(go) {
            if (this.busy) return;
            this.busy = true;
            try {
                if (this.results >= 2) {
                    this.results = 0;
                    await Platform.interstitial();
                }
                if (go) await go();
            } finally {
                this.busy = false;
            }
        },
    },

    // --- Рекорды -------------------------------------------------------------------

    // Рекорд игрока. Яндекс и Playgama: лидерборд 'Score', не чаще раза в секунду (лишнее —
    // последним значением позже). Playables: sendScore.
    submitScore(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return;
        const v = Math.max(0, Math.floor(number));
        if (!Number.isSafeInteger(v)) return;
        const a = this.adapter;
        if (!a || !a.submitScore) return;
        const gap = a.scoreInterval || 0;
        if (gap > 0) {
            this._scorePending = v;
            const wait = this._scoreAt + gap - Date.now();
            if (wait > 0) {
                if (!this._scoreTimer) this._scoreTimer = setTimeout(() => { this._scoreTimer = 0; this.submitScore(this._scorePending); }, wait);
                return;
            }
            this._scoreAt = Date.now();
            this._scorePending = null;
        }
        try { a.submitScore(v, this); } catch (e) { console.warn('Platform.submitScore:', (e && e.message) || e); }
    },

    // Таблица рекордов: [{ rank, name, score, me, avatar? }] или null — нет SDK, нет
    // лидерборда или ошибка. opts — для адаптера (Яндекс: quantityTop, includeUser, quantityAround;
    // avatarSize 'small' | 'medium' | 'large'). Лимит Яндекса — 20 запросов за 5 минут: кэшировать в игре.
    async leaderboard(opts) {
        const a = this.adapter;
        if (!a || !a.leaderboard) return null;
        try {
            const list = await a.leaderboard(opts || {}, this);
            return Array.isArray(list) ? list : null;
        } catch (e) {
            return null;
        }
    },

    // --- Аккаунт площадки --------------------------------------------------------------

    // Игрок вошёл в аккаунт площадки. На площадке без аккаунтов — false.
    authorized() {
        const a = this.adapter;
        if (!a || !a.authorized) return false;
        try { return !!a.authorized(this); } catch (e) { return false; }
    },

    // Показывать ли кнопку «Войдите в аккаунт»: площадка умеет окно входа, а игрок ещё не вошёл.
    canLogin() {
        const a = this.adapter;
        if (!a || !a.login) return false;
        try { return (a.canLogin ? !!a.canLogin(this) : true) && !this.authorized(); } catch (e) { return false; }
    },

    // Окно входа — только по нажатию игрока (кнопка). true — игрок теперь вошёл. Аккаунт мог
    // смениться вместе с облачным сохранением: после true перечитать Platform.load().
    async login() {
        const a = this.adapter;
        if (!a || !a.login) return false;
        if (this.authorized()) return true;
        try {
            const ok = !!(await a.login(this));
            if (ok) this._loaded = null;
            return ok;
        } catch (e) {
            return false;
        }
    },

    // --- Язык игрока и «Назад» -------------------------------------------------------------

    _langKey() { return (typeof GAME_ID !== 'undefined' ? GAME_ID : 'lory-game') + '.lang'; },

    // Язык, который игрок выбрал сам (Store), или '' — выбора не было либо языка нет в словаре.
    savedLanguage() {
        const code = String(Store.get(this._langKey()) || '').toLowerCase();
        return code && LANG_STRINGS[code] ? code : '';
    },

    // Выбор языка игроком (адаптер с languageChoice; Telegram и test): хранится в Store и применяется
    // сразу — Lang.code, <html lang>, data-t в разметке; игра перерисовывает свои тексты по событию
    // 'lory-language' на window. false — переключатель на площадке не предусмотрен или языка нет.
    setLanguage(code) {
        const c = String(code || '').toLowerCase().split(/[-_]/)[0];
        if (!this.langSwitch || !c || !LANG_STRINGS[c]) return false;
        Store.set(this._langKey(), c);
        this.lang = c;
        Lang.code = c;
        try { document.documentElement.lang = c; Lang.apply(); } catch (e) { /* без DOM (тесты) */ }
        try { window.dispatchEvent(new Event('lory-language')); } catch (e) { /* без window */ }
        return true;
    },

    // «Назад» (аппаратная кнопка Android-обёртки): true — игра закрыла своё окно сама (Platform.backHandler),
    // false — нативный слой спросит про выход.
    handleBack() {
        try { return this.backHandler ? this.backHandler() === true : false; } catch (e) { return false; }
    },

    // --- Аналитика ---------------------------------------------------------------------

    // Умеет ли площадка принимать события аналитики.
    analyticsSupported() {
        const a = this.adapter;
        if (!a || !a.analytics) return false;
        try { return a.supports ? !!a.supports('analytics', this) : true; } catch (e) { return false; }
    },

    // Событие игры в аналитику площадки. name — стабильное snake_case (progression_completed), НЕ
    // номер уровня или счёт; меняющееся — в data: плоский объект строк (до 64 символов), конечных чисел
    // и логических значений (до 32 полей), без личных данных. Лишнее ядро отбрасывает. Нет аналитики — тишина.
    analytics(name, data) {
        if (!this.analyticsSupported()) return;
        const key = /^[a-z][a-z0-9_]{0,63}$/;
        const n = String(name == null ? '' : name);
        if (!key.test(n)) { console.warn('Platform.analytics: недопустимое имя события «' + n + '» (snake_case, до 64 знаков)'); return; }
        /** @type {Record<string, string | number | boolean>} */
        const clean = {};
        let count = 0;
        if (data && typeof data === 'object') {
            for (const k of Object.keys(data)) {
                if (count >= 32) break;
                const v = data[k];
                if (!key.test(k)) continue;
                if (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'boolean') clean[k] = v;
                else if (typeof v === 'string') clean[k] = v.slice(0, 64);
                else continue;
                count++;
            }
        }
        try { this.adapter.analytics(n, count ? clean : undefined, this); } catch (e) { /* аналитика не мешает игре */ }
    },

    // --- Сохранения ------------------------------------------------------------------

    _storeKey() { return (typeof GAME_ID !== 'undefined' ? GAME_ID : 'lory-game') + '.save'; },

    // Сохранение игры: объект или null. Ошибка (сеть, повреждённые данные) — reject: это не «сохранения
    // нет». Игра показывает ошибку с повтором; пока загрузка не удалась, облако не перезаписывается.
    load() {
        return this._loadOnce().then((data) => { this._loadFailed = false; return data; });
    },

    _loadOnce() {
        if (!this._loaded) this._loaded = this._load().catch((error) => {
            this._loaded = null; // ошибка сети/данных не означает пустое сохранение; возможен повтор
            this._loadFailed = true;
            throw error;
        });
        return this._loaded;
    },

    async _load() {
        const a = this.adapter || this._local();
        return a.load ? this._unpack(await a.load(this)) : null;
    },

    // Для облачных адаптеров перед записью: загрузка должна пройти. Ошибка загрузки блокирует запись;
    // если загрузка упала, а потом облако ответило прогрессом, которого игра не получила (Platform.load()),
    // — запись тоже отказывает: новая игра не затрёт чужой прогресс.
    async ensureLoaded() {
        const failed = this._loadFailed;
        const data = await this._loadOnce();
        if (failed && data) throw new Error('save blocked: the cloud has progress this session has not loaded (call Platform.load())');
    },

    // Записать JSON. Облачные адаптеры (Playables, Playgama): только SDK, после УСПЕШНОГО load, без localStorage.
    // До начала новой игры нужно await Platform.load() и применить загруженный прогресс; rejected load
    // следует показать как ошибку с повтором. false — не записано.
    async save(obj) {
        try {
            const json = JSON.stringify(obj);
            if (typeof json !== 'string') return false;
            const a = this.adapter || this._local();
            if (!a.save) return false;
            const data = await this._pack(json);
            return (await a.save(data, json, obj, this)) !== false;
        } catch (e) {
            console.warn('Platform.save:', (e && e.message) || e);
            return false;
        }
    },

    // --- Сжатие сохранения ---------------------------------------------------------------
    // Сохранение от PLATFORM_SAVE_GZIP_MIN знаков уходит в облако как 'gz:' + base64(gzip(JSON)), если есть
    // CompressionStream и так короче. Читается и сжатое, и обычный JSON (старые сохранения). Распаковать
    // нечем — загрузка отклоняется (облако не затирается).

    async _pack(json) {
        const min = typeof PLATFORM_SAVE_GZIP_MIN !== 'undefined' ? PLATFORM_SAVE_GZIP_MIN : 32768;
        if (!(min > 0) || json.length < min || typeof CompressionStream === 'undefined') return json;
        try {
            const packed = 'gz:' + await this._gzip(json);
            return packed.length < json.length ? packed : json;
        } catch (e) {
            return json;
        }
    },

    // Сырое значение адаптера -> объект сохранения или null; битое — исключение.
    async _unpack(raw) {
        if (raw == null || raw === '') return null;
        let data = raw;
        if (typeof data === 'string') {
            if (data.startsWith('gz:')) data = await this._gunzip(data.slice(3));
            data = JSON.parse(data);
        }
        if (!data || typeof data !== 'object') throw new Error('Invalid save data (' + this.name + ')');
        return data;
    },

    async _gzip(text) {
        const cs = new CompressionStream('gzip');
        const writer = cs.writable.getWriter();
        writer.write(new TextEncoder().encode(text)).catch(() => {});
        writer.close().catch(() => {});
        const bytes = await this._readAll(cs.readable);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
        return btoa(bin);
    },

    async _gunzip(b64) {
        if (typeof DecompressionStream === 'undefined') throw new Error('Compressed save cannot be read: no DecompressionStream');
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(bytes).catch(() => {});
        writer.close().catch(() => {});
        return new TextDecoder().decode(await this._readAll(ds.readable));
    },

    async _readAll(stream) {
        const reader = stream.getReader();
        const chunks = [];
        let size = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            size += value.length;
        }
        const out = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) { out.set(c, at); at += c.length; }
        return out;
    },
};

// === Встроенные адаптеры ===========================================================================

// Локально (run.bat, web-сборка): сохранения — Store, реклама — только заглушка ?mockads.
Platform.register('local', {
    interstitial: (P) => P._mockAd(false),
    rewarded: (id, P) => P._mockAd(true),
    async load(P) { return Store.getJSON(P._storeKey(), null); },
    async save(data, json, obj, P) { return Store.set(P._storeKey(), json); },
});

// Яндекс Игры (SDK /sdk.js — вписывает build.bat yandex).
Platform.register('yandex', {
    scoreInterval: 1100,
    detect: () => typeof YaGames !== 'undefined',

    async init(P) {
        let timer = 0;
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('YaGames.init timeout')), 8000); });
        try { P.sdk = await Promise.race([YaGames.init(), timeout]); } finally { clearTimeout(timer); }
        try { P.lang = P.sdk.environment.i18n.lang || null; } catch (e) { /* язык по умолчанию */ }
        if (typeof P.sdk.on === 'function') {
            P.sdk.on('game_api_pause', () => Pause.set('platform', true));
            P.sdk.on('game_api_resume', () => Pause.set('platform', false));
        }
        try { P.player = await P.sdk.getPlayer({ scopes: false }); } catch (e) { P.player = null; }
    },

    ready(P) { P.sdk.features.LoadingAPI && P.sdk.features.LoadingAPI.ready(); },

    gameplay(want, P) {
        const api = P.sdk.features.GameplayAPI;
        if (api) { if (want) api.start(); else api.stop(); }
    },

    // Яндекс возвращает shown: показа не было — false.
    interstitial: (P) => new Promise((resolve) => P.sdk.adv.showFullscreenAdv({ callbacks: {
        onClose: (shown) => resolve(!!shown),
        onError: () => resolve(false),
        onOffline: () => resolve(false),
    } })),

    rewarded: (id, P) => new Promise((resolve) => {
        let got = false;
        P.sdk.adv.showRewardedVideo({ callbacks: {
            onRewarded: () => { got = true; },
            onClose: () => resolve(got),
            onError: () => resolve(false),
        } });
    }),

    // setScore — только авторизованным: сначала isAvailableMethod (документация Яндекса).
    submitScore(v, P) {
        const lb = P.sdk.leaderboards;
        const send = () => (lb && lb.setScore ? lb.setScore(P.LEADERBOARD, v)
            : P.sdk.getLeaderboards().then((old) => old.setLeaderboardScore(P.LEADERBOARD, v)));
        const p = typeof P.sdk.isAvailableMethod === 'function'
            ? Promise.resolve(P.sdk.isAvailableMethod('leaderboards.setScore')).then((ok) => (ok ? send() : null))
            : send();
        Promise.resolve(p).catch((e) => console.warn('Platform.submitScore:', (e && e.message) || e));
    },

    async leaderboard(opts, P) {
        const { avatarSize, ...query } = opts || {};
        const o = Object.assign({ quantityTop: 10, includeUser: true, quantityAround: 3 }, query);
        const lb = P.sdk.leaderboards;
        const res = lb && lb.getEntries ? await lb.getEntries(P.LEADERBOARD, o)
            : await (await P.sdk.getLeaderboards()).getLeaderboardEntries(P.LEADERBOARD, o);
        let myId = '';
        try { myId = P.player ? P.player.getUniqueID() : ''; } catch (e) { /* аноним */ }
        return (res.entries || []).map((e) => {
            /** @type {Record<string, any>} */
            const entry = {
                rank: e.rank, score: e.score,
                name: (e.player && e.player.publicName) || '',
                me: !!(myId && e.player && e.player.uniqueID === myId),
            };
            let avatar = '';
            try { avatar = (e.player && typeof e.player.getAvatarSrc === 'function' && e.player.getAvatarSrc(avatarSize || 'small')) || ''; } catch (err) { /* без аватара */ }
            if (avatar) entry.avatar = String(avatar);
            return entry;
        });
    },

    // Режим 'lite' — игрок не вошёл. Нечем определить — считаем, что не вошёл.
    authorized(P) {
        const p = P.player;
        if (!p) return false;
        if (typeof p.isAuthorized === 'function') return !!p.isAuthorized();
        if (typeof p.getMode === 'function') return p.getMode() !== 'lite';
        return false;
    },
    canLogin: (P) => !!(P.sdk && P.sdk.auth && typeof P.sdk.auth.openAuthDialog === 'function'),
    async login(P) {
        await P.sdk.auth.openAuthDialog();
        P.player = await P.sdk.getPlayer({ scopes: false });
        return this.authorized(P);
    },

    // Облако игрока; ошибка облака — локальная копия из Store. Сжатое облако читает ядро.
    async load(P) {
        const local = Store.getJSON(P._storeKey(), null);
        try {
            if (P.player) {
                const data = await P.player.getData(['save']);
                const cloud = data && data.save;
                if (cloud && typeof cloud === 'object') return cloud;
                if (typeof cloud === 'string' && cloud.startsWith('gz:')) return await P._unpack(cloud);
            }
        } catch (e) {
            console.warn('Platform.load:', (e && e.message) || e);
        }
        return local;
    },
    async save(data, json, obj, P) {
        const stored = Store.set(P._storeKey(), json);   // локальная копия — несжатая
        if (P.player) await P.player.setData({ save: data === json ? obj : data }, true);
        else if (!stored) return false;
    },
});

// YouTube Playables (SDK ytgame — вписывает build.bat playables, первым скриптом).
Platform.register('playables', {
    strict: true,          // без SDK-событий и облачного сохранения играть нельзя — ошибка наружу
    pauseOverlay: true,    // на паузе SDK — плашка «Пауза» без кнопок и блок ввода (требование Playables)
    detect: () => typeof ytgame !== 'undefined' && !!ytgame.IN_PLAYABLES_ENV,

    async init(P) {
        const sys = ytgame.system;
        sys.onPause(() => Pause.set('platform', true));
        sys.onResume(() => Pause.set('platform', false));
        sys.onAudioEnabledChange((on) => Sound.setPlatformMuted(!on));
        Sound.setPlatformMuted(!sys.isAudioEnabled());
        try { P.lang = await sys.getLanguage(); } catch (e) { P.lang = null; }
    },

    firstFrame() { ytgame.game.firstFrameReady(); },
    ready(P) {
        P.firstFrame();
        ytgame.game.gameReady();
    },

    // Playables НЕ подтверждает факт показа interstitial: true — запрос прошёл.
    async interstitial() {
        if (!ytgame.ads || !ytgame.ads.requestInterstitialAd) return false;
        await ytgame.ads.requestInterstitialAd();
        return true;
    },
    async rewarded(id) {
        if (!ytgame.ads || !ytgame.ads.requestRewardedAd) return false;
        return (await ytgame.ads.requestRewardedAd(String(id || 'reward'))) === true;
    },
    supports: (kind) => !!(typeof ytgame !== 'undefined' && ytgame.ads
        && (kind === 'rewarded' ? ytgame.ads.requestRewardedAd : kind === 'interstitial' ? ytgame.ads.requestInterstitialAd : false)),

    submitScore(v) { try { ytgame.engagement.sendScore({ value: v }).catch(() => {}); } catch (e) { /* SDK старый */ } },

    // Только SDK. Успешный loadData обязателен ДО saveData; ошибку нельзя превращать в null и затем
    // перезаписывать облако новой игрой.
    async load() { return (await ytgame.game.loadData()) || null; },
    async save(data, json, obj, P) {
        // Консервативная проверка обоих представлений (записываемой, возможно сжатой строки): < 3 MiB (MUST).
        // JSON.stringify экранирует непарные суррогаты: строка well-formed UTF-16.
        const bytes = Math.max(data.length * 2, new TextEncoder().encode(data).byteLength);
        if (bytes >= 3 * 1024 * 1024) throw new Error('Playables save must be smaller than 3 MiB');
        await P.ensureLoaded();
        await ytgame.game.saveData(data);
    },
});
