// GameCamera.js — камера раннера: за спиной Нуба и чуть сверху, отъезжает с ростом (RUN_CAM_GROW), в портрете
// дальше (узкий горизонтальный угол). Меню — спереди (видно лицо), финал — сбоку на Нуба и босса/линейку.
// Заменяет обновление CameraController движка (main.js зовёт app.camera.update(dt) перед кадром).

/** @satisfies {Record<string, any>} */
const RunCam = {
    /** @type {any} */ app: null,
    mode: 'menu',
    pos: [0, 0, 0], tgt: [0, 0, 0],
    /** @type {any} */ menuFree: null,
    /** @type {any} */ shopFree: null,   // открыт магазин: полоса для героя вне окна (UI.shopStage), важнее menuFree
    fovWant: 0,                            // угол обзора кадра (рад): в меню шире, если Нуб не влезает      // свободная полоса меню для Нуба (доли холста), ставит UI.layoutMenu
    shakeT: 0, shakeAmp: 0,
    menuT: 0,
    _v: null,
    cfg() {
        const U = 'undefined';
        return {
            dist: typeof RUN_CAM_DIST !== U ? RUN_CAM_DIST : 560,
            height: typeof RUN_CAM_HEIGHT !== U ? RUN_CAM_HEIGHT : 330,
            grow: typeof RUN_CAM_GROW !== U ? RUN_CAM_GROW : 0.75,
            fov: typeof RUN_CAM_FOV_DEG !== U ? RUN_CAM_FOV_DEG : 56,
        };
    },
    init(app) {
        this.app = app;
        this._v = new BABYLON.Vector3(0, 0, 0);
        app.camera.detach();
        app.camera.update = (dt) => this.update(dt);
        const cam = app.location.view.camera;
        cam.minZ = 4; cam.maxZ = 30000;
        cam.fov = this.cfg().fov * GM.DEG;
    },
    shake(a, t) { this.shakeAmp = Math.max(this.shakeAmp, a); this.shakeT = Math.max(this.shakeT, t); },

    aspect() {
        const cv = this.app.location.view.world.canvas;
        return cv ? cv.clientWidth / Math.max(1, cv.clientHeight) : 1.6;
    },

    // Желаемые положение и цель камеры.
    want(outP, outT) {
        const c = this.cfg(), r = Game.runner;
        const H = r ? r.hs[0] : 180, k = 1 + (H / 180 - 1) * c.grow;
        const asp = this.aspect(), far = asp < 1 ? 1 + (1 - asp) * 0.75 : 1;
        const x = r ? r.pos[0] : Level.roadX, y = Level.roadY, z = r ? r.pos[2] : Level.start.z;
        if (this.mode === 'menu') {
            // Нуб — в свободной полосе экрана (её считает UI.layoutMenu: между заголовком, верхней строкой и
            // нижним блоком кнопок): камера отъезжает, чтобы он влез по высоте, и смещает взгляд к центру полосы
            const a = Math.sin(this.menuT * 0.35) * 0.35;
            const fz = this.shopFree || this.menuFree || { top: 0.2, bottom: 0.62, left: 0.05, right: 0.95 };
            // дальше 600 px камера заехала бы за первые ворота: не влезает — шире угол обзора (до 80°, только в меню)
            const span = Math.max(0.2, fz.bottom - fz.top);
            const d = Math.min(Math.max(330 + H * 0.9, 380), 600) * Math.min(far, 1.25);
            const tanH = GM.clamp((H * 1.18) / (span * 2 * d), Math.tan(c.fov * GM.DEG / 2), Math.tan(40 * GM.DEG));
            this.fovWant = 2 * Math.atan(tanH);
            const vis = 2 * d * tanH, visW = vis * asp;
            const mid = (fz.top + fz.bottom) / 2, hmid = (fz.left + fz.right) / 2;
            const ty = y + H * 0.5 - (0.5 - mid) * vis;
            // камера на высоте середины Нуба (не под землёй), наклоняется к центру полосы; смотрит спереди
            // (экранное «вправо» — +x мира)
            const ox = -(hmid - 0.5) * visW;
            GM.set(outP, x + ox + Math.sin(a) * d, y + H * 0.5 + 20, z + Math.cos(a) * d);
            GM.set(outT, x + ox, ty, z);
        } else if (this.mode === 'fight') {
            const bz = Level.boss ? Level.boss.z : z + 300;
            const bh = typeof Fight !== 'undefined' && Fight.st ? Fight.st.bhs[0] : (Level.boss ? Level.boss.height : 300);
            const big = Math.max(H, bh), mid = (z + bz) / 2;
            // сбоку, слева от ринга (−x — экранное «вправо» тогда +z): Нуб слева, босс справа; чуть со стороны Нуба.
            // Декор в этом коридоре убран при загрузке карты (Game.clearFightView).
            // кадр с запасом сверху: там полосы роста «ТЫ vs БОСС»
            const d = (340 + big * 1.15) * (asp < 1 ? 1.05 : 1);   // бойцы рядом: в портрете хватает высоты кадра
            GM.set(outP, Level.roadX - d, y + big * 0.55 + 80, mid - d * 0.12);
            GM.set(outT, Level.roadX, y + big * 0.56, mid);
        } else if (this.mode === 'finale') {
            const f = r && r.finale, other = Level.boss ? Level.boss.z : (Level.ruler ? Level.ruler.z : z + 400);
            const bossH = Level.boss ? Level.boss.height : (Level.ruler ? Level.ruler.H : 300);
            const big = Math.max(H, bossH);
            const mid = (z + other) / 2;
            // сзади-сбоку и выше: над дорогой, не в деревьях декора
            const d = (560 + big * 1.0) * far;
            GM.set(outP, x + Math.min(d * 0.42, 300), y + big * 0.7 + 260, mid - d * 0.95);
            GM.set(outT, x, y + big * 0.42, mid + 40);
            void f;
        } else {
            // с ростом камера больше поднимается, чем отъезжает: смотрит поверх ворот на великана
            const kd = 1 + (H / 180 - 1) * c.grow * 0.62, kh = 1 + (H / 180 - 1) * c.grow * 1.05;
            const dist = c.dist * kd * far, hh = c.height * kh * (asp < 1 ? 1.12 : 1);
            GM.set(outP, GM.lerp(Level.roadX, x, 0.55), y + hh, z - dist);
            GM.set(outT, GM.lerp(Level.roadX, x, 0.85), y + H * 0.5, z + 260 * kd);
        }
    },

    snap() { this.want(this.pos, this.tgt); },

    update(dt) {
        const app = this.app;
        if (!app || !app.location || typeof Game === 'undefined' || !Game.runner) return;
        dt = Math.min(0.1, Math.max(0, dt));
        this.menuT += dt;
        const wp = this._wp || (this._wp = [0, 0, 0]), wt = this._wt || (this._wt = [0, 0, 0]);
        this.fovWant = this.cfg().fov * GM.DEG;
        this.want(wp, wt);
        const hl = this.mode === 'finale' || this.mode === 'fight' ? 0.45 : 0.12;
        const kp = GM.damperK(hl, dt), kt = GM.damperK(hl * 0.7, dt);
        for (let i = 0; i < 3; i++) { this.pos[i] += (wp[i] - this.pos[i]) * kp; this.tgt[i] += (wt[i] - this.tgt[i]) * kt; }
        let sx = 0, sy = 0;
        if (this.shakeT > 0) {
            this.shakeT -= dt;
            const a = this.shakeAmp * Math.min(1, this.shakeT / 0.2);
            sx = (Math.random() * 2 - 1) * a; sy = (Math.random() * 2 - 1) * a;
            if (this.shakeT <= 0) this.shakeAmp = 0;
        }
        const cam = app.location.view.camera;
        cam.fov += (this.fovWant - cam.fov) * GM.damperK(0.15, dt);
        cam.position.set(this.pos[0] + sx, this.pos[1] + sy, this.pos[2]);
        this._v.set(this.tgt[0] + sx * 0.4, this.tgt[1] + sy * 0.4, this.tgt[2]);
        cam.setTarget(this._v);
        const H = Game.runner ? Game.runner.hs[0] : 180;
        app.location.view.fitShadowFrustum(this.tgt[0], this.tgt[2], Level.roadY, 700 + H * 1.2);
        app.camera.viewVersion++;
    },
};
