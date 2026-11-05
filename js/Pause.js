// Pause.js — пауза игры по причинам. Игра стоит, пока есть хоть одна причина:
//   'auto'     — вкладка скрыта или окно без фокуса (ставит и снимает сам Pause);
//   'manual'   — кнопка паузы игрока;
//   'ad'       — идёт реклама (Platform.showInterstitial / showRewarded);
//   'platform' — пауза от платформы (Яндекс game_api_pause, Playables onPause, Telegram deactivated);
//   'adwait'   — реклама запрашивается (CrazyGames): игра стоит, звук играет; с началом ролика — 'ad';
//   'orient'   — Telegram: портретная ориентация, поверх страницы картинка «Поверните устройство»;
//   свои причины игры — любая строка.
// Снятие одной причины не снимает другие: вернулись на вкладку — снята только
// 'auto', ручная и рекламная пауза остаются. Звук молчит на любой паузе (Sound.js).
// main.js не зовёт Game.update и location.update на паузе, но кадр рисует (иначе
// в канвасе мусор: preserveDrawingBuffer false).
// При автопаузе — событие window 'lory-release-input': игра сбрасывает зажатые
// клавиши и касания, чтобы движение не залипло.
// Пауза платформы с platformOverlay = true (Playables; адаптер Platform.js с pauseOverlay): поверх игры
// плашка «Пауза» (Lang platformPaused) БЕЗ кнопки продолжения, весь ввод — игра, HUD, кнопки меню —
// заблокирован. Плашка уходит только по снятию причины 'platform', то есть по resume SDK.

/** @satisfies {Record<string, any>} */
const Pause = {
    reasons: new Set(),
    _listeners: [],
    _hidden: false,
    _blurred: false,
    _inited: false,
    platformOverlay: false,   // true — плашка «Пауза» и блок ввода на паузе 'platform' (ставит адаптер площадки)
    /** @type {HTMLElement | null} */
    _overlay: null,

    get active() { return this.reasons.size > 0; },

    has(reason) { return this.reasons.has(reason); },

    // Поставить (on = true) или снять причину паузы.
    set(reason, on) {
        const had = this.reasons.has(reason);
        if (!!on === had) return;
        if (on) this.reasons.add(reason); else this.reasons.delete(reason);
        if (reason === 'platform' || reason === 'ad' || reason === 'adwait') this._syncOverlay();
        if (on && (reason === 'auto' || reason === 'platform')) window.dispatchEvent(new Event('lory-release-input'));
        for (const fn of this._listeners) {
            try { fn(this.active, reason, !!on); } catch (e) { console.error('Pause listener:', e); }
        }
    },

    // Плашка паузы платформы: есть, пока причина 'platform' стоит и включён platformOverlay. Пока идёт реклама
    // ('ad' / 'adwait') — нет: поверх рекламы «Пауза» не нужна (площадка ставит свою паузу на время показа). Без DOM — тишина.
    _syncOverlay() {
        const want = this.platformOverlay && this.reasons.has('platform') && !this.reasons.has('ad') && !this.reasons.has('adwait');
        try {
            if (!want) {
                if (this._overlay) { this._overlay.remove(); this._overlay = null; }
                return;
            }
            if (this._overlay || typeof document.createElement !== 'function' || !document.body) return;
            const el = document.createElement('div');
            el.id = 'platform-pause';
            el.setAttribute('role', 'status');
            el.setAttribute('aria-live', 'assertive');
            el.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;' +
                'background:rgba(0,0,0,.72);color:#fff;font:700 clamp(28px,7vw,56px) system-ui,sans-serif;text-align:center;' +
                'touch-action:none;user-select:none;-webkit-user-select:none;cursor:default';
            el.textContent = typeof Lang !== 'undefined' ? Lang.t('platformPaused') : 'Paused';
            document.body.appendChild(el);
            this._overlay = el;
        } catch (e) { console.warn('Pause overlay:', e); }
    },

    toggle(reason) { this.set(reason, !this.reasons.has(reason)); },

    // fn(active, reason, on) — после каждой смены причины.
    onChange(fn) { this._listeners.push(fn); return () => { const i = this._listeners.indexOf(fn); if (i >= 0) this._listeners.splice(i, 1); }; },

    // Автопауза: скрытая вкладка или потеря фокуса окна. Фокус при старте не
    // проверяется: в iframe платформы его нет до первого касания, игра стояла бы.
    init() {
        if (this._inited) return;
        this._inited = true;
        const playables = typeof ytgame !== 'undefined' && ytgame.IN_PLAYABLES_ENV;
        if (playables) this.platformOverlay = true;
        // Пауза платформы с плашкой: ввод не доходит ни до игры, ни до HUD и кнопок меню. Перехват на window
        // в фазе capture — раньше любых обработчиков игры; Escape остаётся хозяину (Playables).
        const block = e => {
            if (this.platformOverlay && this.has('platform')) {
                if (e.key !== 'Escape' && e.code !== 'Escape') e.preventDefault();
                e.stopImmediatePropagation();
            }
        };
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu',
            'keydown', 'keyup', 'keypress', 'wheel', 'touchstart', 'touchmove', 'touchend']) {
            window.addEventListener(type, block, { capture: true, passive: false });
        }
        // Playables owns lifecycle. Browser focus/visibility must not resume or pause it.
        if (playables) return;
        const sync = () => this.set('auto', this._hidden || this._blurred);
        document.addEventListener('visibilitychange', () => {
            this._hidden = document.hidden;
            if (!this._hidden) this._blurred = false;   // мобильные возвращают вкладку без focus
            sync();
        });
        window.addEventListener('blur', () => { this._blurred = true; sync(); });
        window.addEventListener('focus', () => { this._blurred = false; sync(); });
        window.addEventListener('pointerdown', () => { if (this._blurred) { this._blurred = false; sync(); } }, true);
        window.addEventListener('pagehide', () => { this._hidden = true; sync(); });
        window.addEventListener('pageshow', () => { this._hidden = document.hidden; sync(); });
    },
};
