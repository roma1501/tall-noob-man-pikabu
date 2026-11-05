// GameLevel.js — трасса уровня из маркеров карты (формат — docs/levels-spec.md, правится в редакторе).
// Строит дорогу, ворота с надписями, пилы, сжималки, кирпичные стены (физика), маятники, монеты и кристаллы,
// финишную арку, линейку-множитель или арену босса. Логика забега (кто что задел) — GameRunner.js:
// здесь только данные (events, отсортированы по y) и вид. Дорога идёт вдоль +y карты (мир +z), центр x = 700.

/** @satisfies {Record<string, any>} */
const Level = {
    /** @type {any} */ app: null,
    mats: {},
    /** @type {any[]} */ own: [],             // материалы и текстуры этого уровня (надписи ворот, таранов, финиша) — убираются в clear()
    /** @type {any[]} */ events: [],
    /** @type {any[]} */ coins: [],
    /** @type {any[]} */ meshes: [],
    /** @type {any[]} */ spinners: [],
    /** @type {any[]} */ bricks: [],
    /** @type {any[]} */ crates: [],
    /** @type {any[]} */ posts: [],           // угловые стойки ринга: { x, z, meshes } — гаснут, если заслоняют камеру          // ящики за рингом босса (физика, спят до удара)
    /** @type {any[]} */ ropes: [],           // канаты ринга: { s, meshes, vis } (s — сторона −1/1)
    /** @type {any} */ archFade: null,       // финишная арка: { z, meshes, vis }
    /** @type {any[]} */ hammers: [],
    /** @type {any[]} */ punches: [],
    /** @type {any[]} */ rollers: [],
    /** @type {any[]} */ fans: [],
    /** @type {any[]} */ jumps: [],
    /** @type {any} */ lavaTex: null,
    start: { x: 700, y: 0, z: 500 },
    finish: { x: 700, y: 0, z: 6000 },
    /** @type {any} */ boss: null,
    ruler: null,
    roadY: 0,
    roadX: 700,
    length: 0,
    endZ: 0,
    time: 0,

    cfg() {
        const U = 'undefined';
        return {
            roadW: typeof ROAD_WIDTH !== U ? ROAD_WIDTH : 620,
            roadH: typeof ROAD_HEIGHT !== U ? ROAD_HEIGHT : 30,
            step: typeof RUN_FINISH_STEP !== U ? RUN_FINISH_STEP : 70,
        };
    },

    GATE_COLORS: { 'g-tall': [76, 201, 240], 'g-short': [255, 93, 115], 'g-fat': [46, 196, 140], 'g-thin': [255, 159, 67], 'g-xtall': [123, 97, 255], 'g-xshort': [70, 70, 90] },
    MULTS: [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10],

    // ---- материалы -----------------------------------------------------------------------------
    mat(key, make) {
        if (this.mats[key]) return this.mats[key];
        const scene = this.app.location.view.scene;
        const m = new BABYLON.StandardMaterial('lvl-' + key, scene);
        m.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
        if (make) make(m, scene);
        this.mats[key] = m;
        return m;
    },
    color(m, rgb) { m.diffuseColor = BABYLON.Color3.FromInts(rgb[0], rgb[1], rgb[2]); return m; },

    // Текстура дороги: светлая беговая дорожка с пунктиром и краями.
    roadTexture(scene) {
        const N = 256, t = new BABYLON.DynamicTexture('road-tex', { width: N, height: N }, scene, true);
        const c = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (t.getContext()));
        c.fillStyle = '#f3ecdf'; c.fillRect(0, 0, N, N);
        c.fillStyle = '#e7dccb'; for (let i = 0; i < N; i += 16) c.fillRect(0, i, N, 8);
        c.fillStyle = '#ffffff'; c.fillRect(N / 2 - 5, 0, 10, N / 2);
        t.update(true);
        t.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE; t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
        return t;
    },

    // Надпись ворот: «+40», «×2», «−30» и стрелка.
    gateLabel(scene, text, up, rgb) {
        const W = 256, H = 160, t = new BABYLON.DynamicTexture('gate-tex', { width: W, height: H }, scene, true);
        const c = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (t.getContext()));
        c.clearRect(0, 0, W, H);
        c.font = '900 92px Rubik, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineJoin = 'round'; c.lineWidth = 16; c.strokeStyle = '#1B1B3A'; c.strokeText(text, W * 0.56, H * 0.52);
        c.fillStyle = '#ffffff'; c.fillText(text, W * 0.56, H * 0.52);
        // стрелка
        c.save(); c.translate(W * 0.13, H * 0.5); if (!up) c.rotate(Math.PI);
        c.beginPath(); c.moveTo(0, -38); c.lineTo(26, 0); c.lineTo(10, 0); c.lineTo(10, 34); c.lineTo(-10, 34); c.lineTo(-10, 0); c.lineTo(-26, 0); c.closePath();
        c.lineWidth = 10; c.strokeStyle = '#1B1B3A'; c.stroke(); c.fillStyle = up ? '#FFD23F' : '#ffffff'; c.fill();
        c.restore();
        void rgb;
        t.hasAlpha = true;
        t.update(true);
        return t;
    },

    // ---- сборка ---------------------------------------------------------------------------------
    clear() {
        for (const m of this.meshes) { try { World3D.removeObject(this.app.location.view, m); } catch (e) { /* уже убран */ } }
        for (const b of this.bricks) if (b.body) Phys.remove(b.body);
        this.meshes = []; this.events = []; this.coins = []; this.spinners = []; this.bricks = []; this.crates = []; this.posts = []; this.ropes = []; this.archFade = null; this.hammers = []; this.punches = []; this.rollers = []; this.fans = []; this.jumps = []; this.lavaTex = null;
        this.boss = null; this.ruler = null;
        for (const k of Object.keys(this.mats)) { if (this.mats[k].metadata && this.mats[k].metadata.perLevel) { this.mats[k].dispose(false, true); delete this.mats[k]; } }
        // без этого каждая пересборка уровня оставляла ~50 материалов и ~30 текстур (утечка памяти за долгую игру)
        for (const o of this.own) { try { o.dispose(); } catch (e) { /* уже убран */ } }
        this.own = [];
    },
    track(o) { this.own.push(o); return o; },

    add(mesh, kind, opts) {
        World3D.addObject(this.app.location.view, mesh, kind || 'prop', opts || {});
        mesh.isPickable = false;
        this.meshes.push(mesh);
        return mesh;
    },

    box(name, size, pos, mat, opts) {
        const view = this.app.location.view;
        const m = Geo.box(view.scene, name, size[0], size[1], size[2], 256);
        m.material = mat;
        m.position.set(pos[0], pos[1], pos[2]);
        return this.add(m, 'prop', opts);
    },

    build(app) {
        this.app = app;
        this.clear();
        const loc = app.location, c = this.cfg(), scene = loc.view.scene;
        const markers = loc.map.objects.filter(o => o.kind === 'marker');
        const base = (n) => String(n).replace(/-\d+$/, '');
        const st = markers.find(m => base(m.name) === 'start'), fin = markers.find(m => base(m.name) === 'finish');
        const ground = (x, y) => loc.terrain.fieldHeight(x, y);
        this.roadX = st ? st.x : 700;
        const sz = st ? st.y : 500, fz = fin ? fin.y : sz + 6000;
        this.roadY = ground(this.roadX, (sz + fz) / 2) + c.roadH;
        this.start = { x: this.roadX, y: this.roadY, z: sz };
        this.finish = { x: this.roadX, y: this.roadY, z: fz };
        this.length = fz - sz;
        this.endZ = fz + 1300;
        // дорога (физика — плоскость верха; меш — с бортиками)
        const z0 = sz - 400, z1 = this.endZ, L = z1 - z0, cz = (z0 + z1) / 2, W = c.roadW;
        const roadMat = this.mat('road', (m, s) => { m.diffuseTexture = this.roadTexture(s); m.diffuseColor = new BABYLON.Color3(1, 1, 1); });
        const road = this.box('road', [W, 60, L], [this.roadX, this.roadY - 30, cz], roadMat, { castShadow: false });
        road.receiveShadows = true;
        Phys.add({ type: 'static', shape: 'box', half: [W / 2, 30, L / 2], pos: [this.roadX, this.roadY - 30, cz], friction: 0.8 });
        const curbMat = this.mat('curb', (m, s) => {
            const t = new BABYLON.DynamicTexture('curb-tex', { width: 64, height: 64 }, s, true);
            const g = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (t.getContext()));
            g.fillStyle = '#FF5D73'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 32); t.update(true);
            m.diffuseTexture = t;
        });
        for (const s of [-1, 1]) {
            const cb = this.box('curb', [26, 24, L], [this.roadX + s * (W / 2 + 13), this.roadY - 6, cz], curbMat);
            void cb;
            Phys.add({ type: 'static', shape: 'box', half: [13, 40, L / 2], pos: [this.roadX + s * (W / 2 + 13), this.roadY, cz] });
        }
        // старт и финиш — полосы на дороге и арка
        this.stripe(sz, '#ffffff');
        this.arch(fz);
        // маркеры -> события
        for (const m of markers) {
            const k = base(m.name), sc = m.scale || [1, 1, 1];
            const x = m.x, z = m.y, h = m.h || 0;
            if (k.startsWith('g-')) this.gate(k, x, z, sc[0] * 100, sc[1]);
            else if (k === 'saw') this.saw(x, z, h, sc[0] * 100);
            else if (k === 'wall') this.wall(x, z, sc[0] * 100, sc[1] * 100);
            else if (k === 'hammer') this.hammer(x, z, sc[1] || 1, this.hammers.length);
            else if (k === 'coins') this.coinRow(x, z, sc[1] * 100);
            else if (k === 'gem') this.gem(x, z, h || 40);
            else if (k === 'boss') this.boss = { x, z, height: (sc[1] || 3) * 100, width: (sc[0] || 1) * 100 };
            else if (k === 'punch') this.punch(x, z, (sc[0] || 3) * 100, this.punches.length);
            else if (k === 'roller') this.roller(x, z, (sc[0] || 0.9) * 50);
            else if (k === 'jump') this.jump(x, z, (sc[1] || 4) * 100);
            else if (k === 'fan') this.fan(x, z, (sc[0] || 3) * 100, this.fans.length);
            else if (k === 'ram') this.ram(x, z, (sc[0] || 2.9) * 100, (sc[1] || 0.3) * 100);
        }
        if (!this.boss) this.buildRuler(fz + 650); else this.arena(this.boss);
        this.events.sort((a, b) => a.z - b.z);
        this.time = 0;
        void scene;
        return this;
    },

    // Ринг босса: настил, угловые стойки, канаты по бокам; за рингом — пирамида ящиков (физика, спят до удара).
    // Спереди канатов нет (вход Нуба), сзади тоже — туда босс улетает после нокаута.
    arena(b) {
        const scene = this.app.location.view.scene, W = this.cfg().roadW, y = this.roadY;
        const hw = W / 2 - 16, z0 = b.z - 600, z1 = b.z + 130, L = z1 - z0, cz = (z0 + z1) / 2;
        const floor = BABYLON.MeshBuilder.CreateGround('ring', { width: 2 * hw, height: L }, scene);
        floor.material = this.mat('ring-floor', (m, s) => { m.diffuseTexture = this.ringTexture(s, 2 * hw, L); m.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08); });
        floor.position.set(this.roadX, y + 1.5, cz);
        this.add(floor, 'prop', { castShadow: false });
        const post = this.mat('ring-post', (m) => this.color(m, [228, 230, 238]));
        const padR = this.mat('ring-pad-r', (m) => this.color(m, [222, 52, 72]));
        const padB = this.mat('ring-pad-b', (m) => this.color(m, [52, 92, 222]));
        const ropeW = this.mat('ring-rope-w', (m) => this.color(m, [250, 250, 255]));
        const ropeR = this.mat('ring-rope-r', (m) => this.color(m, [222, 52, 72]));
        const H = [70, 125, 180];
        for (const s of [-1, 1]) {
            const ropes = { s, meshes: [], vis: 1 };
            this.ropes.push(ropes);
            for (const [pz, pad] of [[z0 + 14, padB], [z1 - 14, padR]]) {
                const p = BABYLON.MeshBuilder.CreateCylinder('ring-post', { diameter: 26, height: 220, tessellation: 14 }, scene);
                p.material = post; p.position.set(this.roadX + s * hw, y + 110, pz);
                this.add(p, 'prop');
                const rec = { x: this.roadX + s * hw, z: pz, meshes: [p], vis: 1 };
                for (const h of H) { const c = Geo.roundBox(scene, 'ring-pad', 34, 30, 34, 8, 2); c.material = pad; c.position.set(this.roadX + s * hw, y + h, pz); this.add(c, 'prop'); rec.meshes.push(c); }
                this.posts.push(rec);
            }
            H.forEach((h, i) => {
                const r = BABYLON.MeshBuilder.CreateCylinder('ring-rope', { diameter: 8, height: L - 28, tessellation: 8 }, scene);
                r.material = i === 1 ? ropeR : ropeW; r.rotation.x = Math.PI / 2;
                r.position.set(this.roadX + s * hw, y + h, cz);
                this.add(r, 'prop', { castShadow: false });
                ropes.meshes.push(r);
            });
        }
        // ящики: пирамида 4-3-2-1 поперёк дороги; у высокого босса — крупнее
        const sz = GM.clamp(b.height * 0.17, 60, 130);
        const crate = this.mat('crate', (m, s) => { m.diffuseTexture = this.crateTexture(s); });
        for (let row = 0; row < 4; row++) {
            const n = 4 - row;
            for (let i = 0; i < n; i++) {
                const pos = [this.roadX + (i - (n - 1) / 2) * (sz + 2), y + sz * (row + 0.5) + 0.5, z1 + 20 + sz / 2];
                const mesh = Geo.box(scene, 'crate', sz, sz, sz, sz);
                mesh.material = crate;
                mesh.position.set(pos[0], pos[1], pos[2]);
                mesh.rotationQuaternion = new BABYLON.Quaternion();
                this.add(mesh, 'prop');
                const body = Phys.add({ type: 'dynamic', shape: 'box', half: [sz / 2, sz / 2, sz / 2], pos, mass: 2.5, friction: 0.6, restitution: 0.12, angDamp: 0.1, mesh });
                body.sleep = true; body.startAsleep = true;
                this.bricks.push({ mesh, body, pos, size: [sz, sz, sz], t: -1e9 });   // меш едет за телом (Level.update)
                this.crates.push({ mesh, body, woke: false });
            }
        }
    },
    ringTexture(scene, w, l) {
        const W = 512, H = Math.round(512 * l / w);
        const t = new BABYLON.DynamicTexture('ring-tex', { width: W, height: H }, scene, true);
        const c = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (t.getContext()));
        c.fillStyle = '#3157d8'; c.fillRect(0, 0, W, H);
        c.fillStyle = '#2746b8'; for (let x = 0; x < W; x += 64) c.fillRect(x, 0, 32, H);
        c.strokeStyle = '#f4f4fa'; c.lineWidth = 22; c.strokeRect(11, 11, W - 22, H - 22);
        c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 6; c.strokeRect(46, 46, W - 92, H - 92);
        // звезда в центре
        c.save(); c.translate(W / 2, H / 2); c.fillStyle = '#FFD23F'; c.strokeStyle = '#1B1B3A'; c.lineWidth = 10; c.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 46 : 110; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        c.closePath(); c.stroke(); c.fill(); c.restore();
        t.update(true);
        return t;
    },
    crateTexture(scene) {
        const N = 128, t = new BABYLON.DynamicTexture('crate-tex', { width: N, height: N }, scene, true);
        const c = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (t.getContext()));
        c.fillStyle = '#d39a55'; c.fillRect(0, 0, N, N);
        c.fillStyle = '#c4874a'; for (let y = 0; y < N; y += 32) c.fillRect(0, y + 16, N, 2);
        c.fillStyle = '#8a5a2b'; c.fillRect(0, 0, N, 14); c.fillRect(0, N - 14, N, 14); c.fillRect(0, 0, 14, N); c.fillRect(N - 14, 0, 14, N);
        c.save(); c.translate(N / 2, N / 2); c.rotate(Math.PI / 4); c.fillRect(-80, -8, 160, 16); c.restore();
        c.strokeStyle = '#5c3a1a'; c.lineWidth = 3; c.strokeRect(1.5, 1.5, N - 3, N - 3);
        t.update(true);
        return t;
    },

    stripe(z, color) {
        const scene = this.app.location.view.scene, W = this.cfg().roadW;
        const m = this.mat('stripe-' + color, (mm) => { mm.diffuseColor = BABYLON.Color3.FromHexString(color); mm.emissiveColor = new BABYLON.Color3(0.15, 0.15, 0.15); });
        void scene;
        this.box('stripe', [W, 2, 24], [this.roadX, this.roadY + 1, z], m, { castShadow: false });
    },

    arch(z) {
        const scene = this.app.location.view.scene, W = this.cfg().roadW;
        const pole = this.mat('arch', (m) => this.color(m, [255, 210, 63]));
        const fade = this.archFade = { z, meshes: [], vis: 1 };   // арка гаснет, когда стоит между камерой и целью
        for (const s of [-1, 1]) fade.meshes.push(this.box('arch-pole', [40, 420, 40], [this.roadX + s * (W / 2 + 40), this.roadY + 210, z], pole));
        // полотно с надписью FINISH и клетками
        const t = this.track(new BABYLON.DynamicTexture('finish-tex', { width: 512, height: 96 }, scene, true));
        const c = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (t.getContext()));
        for (let i = 0; i < 32; i++) for (let j = 0; j < 6; j++) { c.fillStyle = (i + j) % 2 ? '#1B1B3A' : '#ffffff'; c.fillRect(i * 16, j * 16, 16, 16); }
        c.fillStyle = '#FFD23F'; c.fillRect(120, 14, 272, 68);
        c.font = '900 58px Rubik, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#1B1B3A'; c.fillText(Lang.t('lvl.finish'), 256, 50);
        t.update(true);
        // своя на каждый уровень: надпись на языке игры, текстура уходит вместе с уровнем
        const bm = this.track(new BABYLON.StandardMaterial('lvl-finish-banner', scene));
        bm.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04); bm.diffuseTexture = t; bm.emissiveColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        const ban = this.box('arch-banner', [W + 120, 90, 14], [this.roadX, this.roadY + 400, z], bm);
        this.fitUV(ban, W + 120, 90);
        fade.meshes.push(ban);
        // клетчатая полоса на дороге
        const tm = this.mat('checker', (m, s) => {
            const tt = new BABYLON.DynamicTexture('checker-tex', { width: 64, height: 64 }, s, true);
            const g = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (tt.getContext()));
            for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#1B1B3A' : '#ffffff'; g.fillRect(i * 16, j * 16, 16, 16); }
            tt.update(true); m.diffuseTexture = tt;
        });
        this.box('finish-line', [W, 2, 60], [this.roadX, this.roadY + 1, z], tm, { castShadow: false });
    },

    // Ворота: рамка + полупрозрачная панель с надписью.
    gate(kind, x, z, w, v) {
        const scene = this.app.location.view.scene;
        const rgb = this.GATE_COLORS[kind] || [200, 200, 200];
        const up = kind === 'g-tall' || kind === 'g-fat' || kind === 'g-xtall';
        const val = kind === 'g-xtall' ? '×' + this.num(v) : kind === 'g-xshort' ? '÷' + this.num(v) : (up ? '+' : '−') + Math.round(v * 100);
        const icon = kind === 'g-fat' || kind === 'g-thin' ? (up ? '↔' : '→←') : '';
        void icon;
        const Hp = 300, y = this.roadY;
        const frame = this.mat('frame', (m) => this.color(m, [255, 255, 255]));
        for (const s of [-1, 1]) this.box('gate-post', [24, Hp + 20, 24], [x + s * (w / 2 - 12), y + (Hp + 20) / 2, z], frame);
        this.box('gate-top', [w, 22, 26], [x, y + Hp + 20, z], frame);
        const pm = this.track(new BABYLON.StandardMaterial('gate-panel', scene));
        pm.diffuseColor = BABYLON.Color3.FromInts(rgb[0], rgb[1], rgb[2]);
        pm.emissiveColor = BABYLON.Color3.FromInts(rgb[0], rgb[1], rgb[2]).scale(0.45);
        pm.alpha = 0.55; pm.specularColor = new BABYLON.Color3(0, 0, 0);
        pm.metadata = { perLevel: true };
        const panel = Geo.box(scene, 'gate-panel', w - 48, Hp - 10, 4, 256);
        panel.material = pm; panel.position.set(x, y + Hp / 2 + 5, z);
        this.add(panel, 'prop', { castShadow: false, outline: false, ink: false });
        // надпись: плоскость с текстурой, смотрит на бегущего (−z)
        const label = BABYLON.MeshBuilder.CreatePlane('gate-label', { width: Math.min(w - 40, 230), height: 140 }, scene);
        const lm = this.track(new BABYLON.StandardMaterial('gate-label-m', scene));
        lm.diffuseTexture = this.track(this.gateLabel(scene, val, up, rgb)); lm.useAlphaFromDiffuseTexture = true; lm.emissiveColor = new BABYLON.Color3(1, 1, 1); lm.disableLighting = true;
        lm.backFaceCulling = false; lm.metadata = { perLevel: true, toon: false };
        label.material = lm; label.position.set(x, y + Hp * 0.62, z - 6);
        label.rotation.y = Math.PI;
        this.add(label, 'prop', { castShadow: false, outline: false, ink: false });
        this.events.push({ type: 'gate', kind, x, z, w, v, panel, label, mat: pm, used: false, row: null });
    },
    num(v) { return Math.abs(v - Math.round(v)) < 0.01 ? String(Math.round(v)) : v.toFixed(1); },

    // Ряд пил на высоте h.
    saw(x, z, h, w) {
        const scene = this.app.location.view.scene, y = this.roadY;
        const metal = this.mat('metal', (m) => this.color(m, [70, 76, 92]));
        const blade = this.mat('blade', (m) => { this.color(m, [200, 205, 215]); m.specularColor = new BABYLON.Color3(0.6, 0.6, 0.6); m.specularPower = 32; });
        for (const s of [-1, 1]) this.box('saw-post', [26, h + 40, 26], [x + s * (w / 2 + 14), y + (h + 40) / 2, z], metal);
        this.box('saw-bar', [w + 50, 18, 18], [x, y + h + 30, z], metal);
        const n = Math.max(1, Math.round(w / 110)), step = w / n;
        for (let i = 0; i < n; i++) {
            const d = BABYLON.MeshBuilder.CreateCylinder('saw-blade', { diameter: 96, height: 6, tessellation: 16 }, scene);
            d.material = blade;
            d.position.set(x - w / 2 + step * (i + 0.5), y + h, z);
            d.rotationQuaternion = new BABYLON.Quaternion();
            this.add(d, 'prop', { castShadow: true });
            this.spinners.push({ mesh: d, speed: 14 + i, axis: 'y' });
            // зубья
            for (let k = 0; k < 8; k++) {
                const a = k / 8 * Math.PI * 2;
                const tooth = BABYLON.MeshBuilder.CreateBox('saw-tooth', { width: 14, height: 5, depth: 14 }, scene);
                tooth.material = blade; tooth.parent = d; tooth.position.set(Math.cos(a) * 50, 0, Math.sin(a) * 50); tooth.rotation.y = a + Math.PI / 4;
                tooth.isPickable = false;
            }
        }
        this.events.push({ type: 'saw', x, z, w, h, used: false });
    },

    // Таран (как в Tall Man Run): стопка блоков с табличкой «−N» поперёк дороги. Нуб задел её по ширине —
    // пробивает насквозь (блоки становятся телами и разлетаются, Level.smash) и теряет N см роста.
    // Цвет — по прочности: голубой (до 40), оранжевый (до 80), красный (сильнее).
    ram(x, z, w, s) {
        const scene = this.app.location.view.scene, y = this.roadY;
        // прочнее — выше: 2…6 рядов блоков (сила видна издалека)
        const size = 58, depth = 58, rows = GM.clamp(Math.round(1.5 + s / 40), 2, 6), cols = Math.max(1, Math.round(w / size)), bw = w / cols;
        const rgb = s <= 40 ? [76, 201, 240] : s <= 80 ? [255, 159, 28] : [255, 93, 115];
        const key = rgb.join('-');
        const look = (m, c) => { this.color(m, c); m.emissiveColor = BABYLON.Color3.FromInts(c[0], c[1], c[2]).scale(0.18); m.specularColor = new BABYLON.Color3(0.35, 0.35, 0.35); m.specularPower = 24; };
        const mA = this.mat('ram-a-' + key, (m) => look(m, rgb));
        const mB = this.mat('ram-b-' + key, (m) => look(m, rgb.map(v => Math.round(v * 0.8))));
        const list = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const pos = [x - w / 2 + bw * (c + 0.5), y + size * (r + 0.5) + 0.5, z];
            const mesh = Geo.roundBox(scene, 'ram-block', bw - 3, size - 3, depth, 9, 2);
            mesh.material = (r + c) % 2 ? mA : mB;
            mesh.position.set(pos[0], pos[1], pos[2]);
            mesh.rotationQuaternion = new BABYLON.Quaternion();
            this.add(mesh, 'prop');
            const rec = { mesh, body: null, pos, size: [bw - 3, size - 3, depth], t: 0 };
            list.push(rec);
            this.bricks.push(rec);
        }
        // табличка «−N» над стопкой, смотрит на бегущего (−z)
        const label = BABYLON.MeshBuilder.CreatePlane('ram-label', { width: Math.min(w - 10, 190), height: 104 }, scene);
        const lm = this.track(new BABYLON.StandardMaterial('ram-label-m', scene));
        lm.diffuseTexture = this.track(this.ramLabel(scene, '−' + Math.round(s), rgb)); lm.useAlphaFromDiffuseTexture = true;
        lm.emissiveColor = new BABYLON.Color3(1, 1, 1); lm.disableLighting = true; lm.backFaceCulling = false; lm.metadata = { perLevel: true, toon: false };
        label.material = lm; label.position.set(x, y + size * rows + 66, z - depth / 2);
        label.rotation.y = Math.PI;
        this.add(label, 'prop', { castShadow: false, outline: false, ink: false });
        this.events.push({ type: 'ram', x, z: z - depth / 2 - 12, w, s, bricks: list, label, used: false });
    },
    ramLabel(scene, text, rgb) {
        const W = 256, H = 140, t = new BABYLON.DynamicTexture('ram-tex', { width: W, height: H }, scene, true);
        const c = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (t.getContext()));
        c.clearRect(0, 0, W, H);
        const r = 30, x0 = 10, y0 = 12, w = W - 20, h = H - 30;
        c.beginPath(); c.moveTo(x0 + r, y0); c.arcTo(x0 + w, y0, x0 + w, y0 + h, r); c.arcTo(x0 + w, y0 + h, x0, y0 + h, r); c.arcTo(x0, y0 + h, x0, y0, r); c.arcTo(x0, y0, x0 + w, y0, r); c.closePath();
        c.fillStyle = 'rgba(27,27,58,0.55)'; c.save(); c.translate(0, 8); c.fill(); c.restore();
        c.fillStyle = 'rgb(' + rgb.join(',') + ')'; c.fill();
        c.lineWidth = 9; c.strokeStyle = '#1B1B3A'; c.stroke();
        c.font = '900 76px Rubik, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
        c.lineWidth = 14; c.strokeStyle = '#1B1B3A'; c.strokeText(text, W / 2, y0 + h / 2 + 3);
        c.fillStyle = '#ffffff'; c.fillText(text, W / 2, y0 + h / 2 + 3);
        t.hasAlpha = true;
        t.update(true);
        return t;
    },

    // Кирпичная стена: динамические кирпичи спят, пока Нуб не проломит.
    wall(x, z, w, h) {
        const y = this.roadY, bw = 70, bh = 36, bd = 44;
        const cols = Math.max(1, Math.round(w / bw)), rows = Math.max(1, Math.round(h / bh));
        const sw = w / cols, sh = h / rows;
        const mA = this.mat('brick-a', (m) => this.color(m, [214, 96, 74]));
        const mB = this.mat('brick-b', (m) => this.color(m, [190, 78, 62]));
        const list = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const off = r % 2 ? sw * 0.25 : -sw * 0.25;
            let bx = x - w / 2 + sw * (c + 0.5) + off;
            if (bx < x - w / 2 + sw / 2 - 1 || bx > x + w / 2 - sw / 2 + 1) bx = GM.clamp(bx, x - w / 2 + sw / 2, x + w / 2 - sw / 2);
            const pos = [bx, y + sh * (r + 0.5) + 0.5, z];
            const mesh = this.box('brick', [sw - 2, sh - 2, bd], pos, (r + c) % 2 ? mA : mB);
            mesh.rotationQuaternion = new BABYLON.Quaternion();
            const rec = { mesh, body: null, pos, size: [sw - 2, sh - 2, bd], t: 0 };
            list.push(rec);
            this.bricks.push(rec);
        }
        this.events.push({ type: 'wall', x, z, w, h, bricks: list, used: false });
    },

    // Сломать стену: кирпичи становятся физическими телами и разлетаются от Нуба.
    smash(ev, px, power, noobH, noobW) {
        for (const b of ev.bricks) {
            if (b.body) continue;
            const inside = Math.abs(b.pos[0] - px) < noobW / 2 + 60 && b.pos[1] - this.roadY < noobH + 40;
            const body = Phys.add({ type: 'dynamic', shape: 'box', half: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2], pos: b.pos.slice(), mass: 3, friction: 0.5, restitution: 0.15, mesh: b.mesh, angDamp: 0.2 });
            b.body = body; b.t = 0;
            if (inside) {
                const dx = (b.pos[0] - px) / 60;
                GM.set(body.vel, dx * 220 * (0.6 + Math.random() * 0.8), 160 + Math.random() * 260 * power, 420 + Math.random() * 380 * power);
                GM.set(body.ang, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 12);
                b.life = 2.4 + Math.random() * 0.8;   // обломки тают через пару секунд — дорога остаётся чистой
            } else {
                body.sleep = true;
            }
        }
    },

    hammer(x, z, speed, idx) {
        const scene = this.app.location.view.scene, y = this.roadY, W = this.cfg().roadW;
        const metal = this.mat('metal', (m) => this.color(m, [70, 76, 92]));
        const red = this.mat('hammer', (m) => this.color(m, [255, 93, 115]));
        const pivotY = y + 520, L = 400;
        for (const s of [-1, 1]) this.box('ham-post', [36, 540, 36], [x + s * (W / 2 + 40), y + 270, z], metal);
        this.box('ham-bar', [W + 120, 30, 36], [x, pivotY + 10, z], metal);
        const arm = this.box('ham-arm', [18, L, 18], [x, pivotY - L / 2, z], metal);
        arm.rotationQuaternion = new BABYLON.Quaternion();
        const head = this.box('ham-head', [150, 110, 110], [x, pivotY - L, z], red);
        head.rotationQuaternion = new BABYLON.Quaternion();
        void scene;
        const ev = { type: 'hammer', x, z, pivot: [x, pivotY, z], L, arm, head, speed, phase: idx * 1.7, angle: 0, used: false, cool: 0 };
        this.hammers.push(ev);
        this.events.push(ev);
    },

    coinRow(x, z, len) {
        const scene = this.app.location.view.scene, y = this.roadY;
        const m = this.mat('coin', (mm) => { this.color(mm, [255, 205, 40]); mm.emissiveColor = new BABYLON.Color3(0.35, 0.25, 0.0); mm.specularColor = new BABYLON.Color3(0.8, 0.7, 0.3); mm.specularPower = 24; });
        const n = Math.max(1, Math.floor(len / 70) + 1);
        for (let i = 0; i < n; i++) {
            const c = BABYLON.MeshBuilder.CreateCylinder('coin', { diameter: 46, height: 8, tessellation: 20 }, scene);
            c.material = m;
            c.position.set(x, y + 60, z + i * 70);
            c.rotation.x = Math.PI / 2;
            this.add(c, 'prop', { castShadow: false });
            this.coins.push({ mesh: c, x, z: z + i * 70, h: 60, value: typeof RUN_COIN_VALUE !== 'undefined' ? RUN_COIN_VALUE : 1, taken: false, t: 0 });
        }
    },

    gem(x, z, h) {
        const scene = this.app.location.view.scene, y = this.roadY;
        const m = this.mat('gem', (mm) => { this.color(mm, [80, 220, 255]); mm.emissiveColor = new BABYLON.Color3(0.1, 0.35, 0.5); mm.alpha = 0.92; });
        const g = BABYLON.MeshBuilder.CreatePolyhedron('gem', { type: 1, size: 26 }, scene);
        g.material = m; g.position.set(x, y + h + 20, z);
        this.add(g, 'prop', { castShadow: false });
        this.coins.push({ mesh: g, x, z, h: h + 20, value: typeof RUN_GEM_VALUE !== 'undefined' ? RUN_GEM_VALUE : 10, taken: false, gem: true, t: 0 });
    },

    // Линейка-множитель после финиша: высокая лента с делениями, каждые RUN_FINISH_STEP см — ступень.
    buildRuler(z) {
        const scene = this.app.location.view.scene, y = this.roadY, step = this.cfg().step;
        const n = this.MULTS.length, H = step * n + 80;
        const t = new BABYLON.DynamicTexture('ruler-tex', { width: 256, height: 2048 }, scene, true);
        const c = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (t.getContext()));
        const k = 2048 / H;
        c.fillStyle = '#FFD23F'; c.fillRect(0, 0, 256, 2048);
        for (let i = 0; i < n; i++) {
            const y0 = 2048 - (i * step + 0) * k, y1 = 2048 - ((i + 1) * step) * k;
            c.fillStyle = i % 2 ? '#FFC21A' : '#FFD23F'; c.fillRect(0, y1, 256, y0 - y1);
            c.fillStyle = '#1B1B3A'; c.fillRect(0, y1 - 3, 256, 6);
            c.font = '900 64px Rubik, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillText('x' + this.MULTS[i], 128, (y0 + y1) / 2);
        }
        for (let cm = 0; cm < H; cm += 10) { const yy = 2048 - cm * k; c.fillRect(0, yy - 1, cm % 50 ? 22 : 44, 2); }
        t.update(true);
        const m = this.mat('ruler', (mm) => { mm.diffuseTexture = t; mm.emissiveColor = new BABYLON.Color3(0.25, 0.22, 0.1); });
        const W = 260;
        const mesh = Geo.box(scene, 'ruler', W, H, 40, 100000);
        // UV по всей ленте: фронтальная грань — текстура целиком
        mesh.material = m; mesh.position.set(this.roadX, y + H / 2, z + 60);
        this.add(mesh, 'prop');
        this.fitUV(mesh, W, H);
        // ступени-площадки перед линейкой (визуальная лестница множителей)
        const stepMat = this.mat('ruler-step', (mm) => this.color(mm, [76, 201, 240]));
        this.box('ruler-base', [W + 140, 30, 200], [this.roadX, y + 15, z - 60], stepMat);
        this.ruler = { z, H, step, mesh };
    },

    // Текстура один раз на всю переднюю грань, не зеркально для бегущего (камера смотрит вдоль +z: экранное «вправо» — −x).
    fitUV(mesh, W, H) {
        const uv = mesh.getVerticesData(BABYLON.VertexBuffer.UVKind), pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
        for (let i = 0; i < uv.length / 2; i++) { uv[i * 2] = 0.5 - pos[i * 3] / W; uv[i * 2 + 1] = pos[i * 3 + 1] / H + 0.5; }
        mesh.setVerticesData(BABYLON.VertexBuffer.UVKind, uv);
    },

    // Множитель по росту.
    multFor(h) {
        const i = GM.clamp(Math.floor(h / this.cfg().step), 0, this.MULTS.length - 1);
        return { mult: this.MULTS[i], index: i };
    },

    // ---- уникальные препятствия -------------------------------------------------------------------
    cfgX() {
        const U = 'undefined';
        return {
            punchPeriod: typeof RUN_PUNCH_PERIOD !== U ? RUN_PUNCH_PERIOD : 1.7,
            rollerSpeed: typeof RUN_ROLLER_SPEED !== U ? RUN_ROLLER_SPEED : 380,
            fanForce: typeof RUN_FAN_FORCE !== U ? RUN_FAN_FORCE : 520,
        };
    },

    // Боксёрская перчатка на поршне: стоит у края дороги (по стороне маркера), бьёт поперёк на reach px.
    punch(x, z, reach, idx) {
        const scene = this.app.location.view.scene, W = this.cfg().roadW, y = this.roadY;
        const side = x < this.roadX ? -1 : 1;                     // где стоит (бьёт к центру)
        const baseX = this.roadX + side * (W / 2 + 30);
        const metal = this.mat('metal', (m) => this.color(m, [70, 76, 92]));
        const glove = this.mat('glove', (m) => { this.color(m, [230, 40, 55]); m.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5); m.specularPower = 20; });
        const cuff = this.mat('cuff', (m) => this.color(m, [255, 255, 255]));
        this.box('punch-box', [70, 180, 110], [baseX, y + 90, z], metal);
        const arm = BABYLON.MeshBuilder.CreateCylinder('punch-arm', { diameter: 22, height: 1, tessellation: 12 }, scene);
        arm.material = metal; arm.rotation.z = Math.PI / 2;
        this.add(arm, 'prop');
        const head = Geo.roundBox(scene, 'punch-glove', 80, 72, 70, 26, 3);
        head.material = glove;
        this.add(head, 'prop');
        const thumb = Geo.roundBox(scene, 'punch-thumb', 34, 30, 28, 12, 2);
        thumb.material = glove; thumb.parent = head; thumb.position.set(0, 26, -26); thumb.isPickable = false;
        const band = Geo.roundBox(scene, 'punch-cuff', 30, 76, 74, 8, 2);
        band.material = cuff; band.parent = head; band.position.set(-side * 42, 0, 0); band.isPickable = false;
        const ev = { type: 'punch', x: baseX, z, side, reach, arm, head, phase: idx * 0.37, ext: 0, vel: 0, cool: 0, y: y + 110, tipX: baseX };
        this.punches.push(ev);
        this.events.push(ev);
    },

    // Шар для боулинга: ждёт у маркера и выкатывается навстречу, когда Нуб рядом (физика).
    roller(x, z, r) {
        const scene = this.app.location.view.scene;
        const m = this.mat('roller', (mm) => { this.color(mm, [96, 60, 200]); mm.specularColor = new BABYLON.Color3(0.7, 0.7, 0.8); mm.specularPower = 40; });
        const mesh = BABYLON.MeshBuilder.CreateSphere('roller', { diameter: r * 2, segments: 18 }, scene);
        mesh.material = m;
        const holeM = this.mat('roller-hole', (mm) => this.color(mm, [20, 14, 40]));
        for (const [a, b] of [[0.2, 0.35], [-0.15, 0.4], [0.02, 0.62]]) {
            const h = BABYLON.MeshBuilder.CreateSphere('roller-hole', { diameter: r * 0.26, segments: 6 }, scene);
            h.material = holeM; h.parent = mesh;
            h.position.set(Math.sin(a) * Math.cos(b) * r * 0.9, Math.sin(b) * r * 0.9, Math.cos(a) * Math.cos(b) * r * 0.9);
            h.isPickable = false;
        }
        const pos = [x, this.roadY + r + 1, z];
        mesh.position.set(pos[0], pos[1], pos[2]);
        mesh.rotationQuaternion = new BABYLON.Quaternion();
        this.add(mesh, 'prop');
        const body = Phys.add({ type: 'dynamic', shape: 'sphere', r, pos, mass: 30, friction: 0.7, restitution: 0.3, linDamp: 0.01, angDamp: 0.02, mesh });
        body.sleep = true;
        const rec = { type: 'roller', x, z, r, mesh, body, released: false, hit: false };
        this.rollers.push(rec);
        this.bricks.push({ mesh, body, pos, size: [r, r, r], t: -1e9 });   // меш едет за телом (Level.update)
    },
    releaseRollers(pz) {
        const sp = this.cfgX().rollerSpeed;
        for (const r of this.rollers) {
            if (r.released || r.z - pz > 1500) continue;
            r.released = true;
            r.body.wake();
            GM.set(r.body.vel, 0, 0, -sp);
            GM.set(r.body.ang, -sp / r.r, 0, 0);
        }
    },

    // Трамплин: клин на дороге и лавовая яма за ним длиной gap px.
    jump(x, z, gap) {
        const scene = this.app.location.view.scene, W = this.cfg().roadW, y = this.roadY;
        const L = 260, H = 90;
        const rampM = this.mat('ramp', (m) => { m.diffuseTexture = this.rampTexture(scene); });
        const ang = Math.atan2(H, L), len = Math.hypot(L, H);
        const ramp = Geo.box(scene, 'jump-ramp', len, 16, W, 128);
        ramp.material = rampM;
        ramp.position.set(this.roadX, y + H / 2 - 4, z - L / 2);
        // клин: длина вдоль +z (курс 90°), нос поднят на ang
        ramp.rotationQuaternion = new BABYLON.Quaternion();
        const q = GM.qmul([0, 0, 0, 1], GM.qheading([0, 0, 0, 1], Math.PI / 2), GM.qz([0, 0, 0, 1], ang));
        ramp.rotationQuaternion.set(q[0], q[1], q[2], q[3]);
        this.add(ramp, 'prop');
        const lava = this.mat('pit-lava', (m, s) => { m.emissiveTexture = this.lavaTexture(s); m.diffuseColor = new BABYLON.Color3(0, 0, 0); m.emissiveColor = new BABYLON.Color3(0, 0, 0); m.disableLighting = true; m.metadata = { toon: false }; });
        this.box('pit', [W, 4, gap], [this.roadX, y + 2, z + gap / 2 + 20], lava, { castShadow: false });
        const edge = this.mat('pit-edge', (m) => this.color(m, [40, 40, 52]));
        for (const zz of [z + 18, z + gap + 22]) this.box('pit-edge', [W, 10, 14], [this.roadX, y + 5, zz], edge);
        const ev = { type: 'jump', x: this.roadX, z, zA: z - L, H, gap, used: false, z0: z + 20, z1: z + gap + 20 };
        this.jumps.push(ev);
        this.events.push(ev);
    },
    rampTexture(scene) {
        const t = new BABYLON.DynamicTexture('ramp-tex', { width: 128, height: 128 }, scene, true);
        const c = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (t.getContext()));
        c.fillStyle = '#FFD23F'; c.fillRect(0, 0, 128, 128);
        c.fillStyle = '#1B1B3A';
        for (let i = -128; i < 256; i += 48) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 24, 0); c.lineTo(i + 24 + 128, 128); c.lineTo(i + 128, 128); c.closePath(); c.fill(); }
        t.update(true); t.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE; t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
        return t;
    },
    lavaTexture(scene) {
        if (this.lavaTex) return this.lavaTex;
        const N = 256, t = new BABYLON.DynamicTexture('lava-tex', { width: N, height: N }, scene, true);
        const c = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (t.getContext()));
        c.fillStyle = '#8a1204'; c.fillRect(0, 0, N, N);
        const R = GM.rng(77);
        for (let i = 0; i < 40; i++) {
            const x = R() * N, y = R() * N, r = 10 + R() * 40;
            for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) {
                const g = c.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
                g.addColorStop(0, i % 3 ? 'rgba(255,120,20,0.95)' : 'rgba(255,220,90,1)'); g.addColorStop(1, 'rgba(200,30,0,0)');
                c.fillStyle = g; c.beginPath(); c.arc(x + dx, y + dy, r, 0, Math.PI * 2); c.fill();
            }
        }
        t.update(true); t.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE; t.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
        this.lavaTex = t;
        return t;
    },

    // Вентилятор у края дороги: сдувает Нуба поперёк (худого — сильнее) в полосе ±zone/2.
    fan(x, z, zone, idx) {
        const scene = this.app.location.view.scene, W = this.cfg().roadW, y = this.roadY;
        const side = x < this.roadX ? -1 : 1;
        const baseX = this.roadX + side * (W / 2 + 70);
        const metal = this.mat('metal', (m) => this.color(m, [70, 76, 92]));
        const ringM = this.mat('fan-ring', (m) => this.color(m, [76, 201, 240]));
        const bladeM = this.mat('fan-blade', (m) => this.color(m, [240, 240, 250]));
        this.box('fan-stand', [60, 120, 60], [baseX, y + 60, z], metal);
        const ring = BABYLON.MeshBuilder.CreateTorus('fan-ring', { diameter: 230, thickness: 26, tessellation: 32 }, scene);
        ring.material = ringM; ring.position.set(baseX, y + 210, z); ring.rotation.z = Math.PI / 2;
        this.add(ring, 'prop');
        const hub = new BABYLON.Mesh('fan-hub', scene);
        hub.position.set(baseX, y + 210, z); hub.rotationQuaternion = new BABYLON.Quaternion();
        for (let k = 0; k < 4; k++) {
            const b = Geo.roundBox(scene, 'fan-blade', 8, 96, 34, 4, 1);
            b.material = bladeM; b.parent = hub;
            const a = k * Math.PI / 2;
            b.position.set(0, Math.cos(a) * 52, Math.sin(a) * 52); b.rotation.x = a; b.rotation.y = 0.4;
            b.isPickable = false;
        }
        this.add(hub, 'prop');
        const ev = { type: 'fan', x: baseX, z, zone, dir: -side, hub, spin: 0, idx, puff: 0 };
        this.fans.push(ev);
        this.events.push(ev);
    },

    // Кадр: пилы крутятся, маятники качаются, монеты вращаются, кирпичи — за физикой.
    update(dt) {
        this.time += dt;
        const q = [0, 0, 0, 1];
        for (const s of this.spinners) {
            GM.qy(q, this.time * s.speed);
            s.mesh.rotationQuaternion.set(q[0], q[1], q[2], q[3]);
        }
        for (const h of this.hammers) {
            h.angle = 1.05 * Math.sin(this.time * 2.2 * h.speed + h.phase);
            const qa = GM.qx(q, h.angle);
            const a = GM.qrot([0, 0, 0], qa, [0, -h.L / 2, 0]), b = GM.qrot([0, 0, 0], qa, [0, -h.L, 0]);
            h.arm.position.set(h.pivot[0] + a[0], h.pivot[1] + a[1], h.pivot[2] + a[2]);
            h.arm.rotationQuaternion.set(qa[0], qa[1], qa[2], qa[3]);
            h.head.position.set(h.pivot[0] + b[0], h.pivot[1] + b[1], h.pivot[2] + b[2]);
            h.head.rotationQuaternion.set(qa[0], qa[1], qa[2], qa[3]);
            h.headPos = [h.pivot[0] + b[0], h.pivot[1] + b[1], h.pivot[2] + b[2]];
            h.headVel = 1.05 * Math.cos(this.time * 2.2 * h.speed + h.phase) * 2.2 * h.speed * h.L;
        }
        // перчатки: быстрый удар, медленный возврат
        const px = this.cfgX();
        for (const p of this.punches) {
            const ph = GM.frac(this.time / px.punchPeriod + p.phase);
            const prev = p.ext;
            p.ext = ph < 0.12 ? GM.smoother(ph / 0.12) : ph < 0.3 ? 1 : ph < 0.7 ? 1 - GM.smooth((ph - 0.3) / 0.4) : 0;
            p.vel = (p.ext - prev) / Math.max(1e-3, dt);
            const tip = p.x - p.side * (40 + p.ext * p.reach);
            p.head.position.set(tip, p.y, p.z);
            p.tipX = tip;
            const mid = (p.x + tip) / 2, len = Math.abs(tip - p.x);
            p.arm.position.set(mid, p.y, p.z); p.arm.scaling.y = Math.max(1, len);
            p.head.rotation.y = p.side < 0 ? Math.PI : 0;
        }
        for (const f of this.fans) {
            f.spin += dt * 22;
            GM.qx(q, f.spin);
            f.hub.rotationQuaternion.set(q[0], q[1], q[2], q[3]);
        }
        if (this.lavaTex) { this.lavaTex.uOffset = GM.frac(this.lavaTex.uOffset + dt * 0.03); this.lavaTex.vOffset = GM.frac(this.lavaTex.vOffset + dt * 0.02); }
        for (const c of this.coins) {
            if (c.taken) {
                c.t += dt;
                const k = Math.min(1, c.t / 0.35);
                c.mesh.position.y += dt * 600;
                c.mesh.scaling.setAll(Math.max(0.01, 1 - k));
                if (k >= 1 && c.mesh.isEnabled()) c.mesh.setEnabled(false);
                continue;
            }
            c.mesh.rotation.y = this.time * 3 + c.z * 0.01;
            if (c.gem) c.mesh.position.y = this.roadY + c.h + Math.sin(this.time * 3 + c.z) * 8;
        }
        // стойки ринга и финишная арка между камерой и целью — полупрозрачные (не заслоняют бой)
        if (this.archFade && typeof RunCam !== 'undefined' && RunCam.pos) {
            const a = this.archFade, want = RunCam.pos[2] < a.z - 30 && RunCam.tgt[2] > a.z + 30 && RunCam.mode !== 'run' ? 0.15 : 1;
            a.vis += (want - a.vis) * GM.damperK(0.12, dt);
            for (const m of a.meshes) m.visibility = a.vis;
        }
        for (const rp of this.ropes) {
            const near = typeof RunCam !== 'undefined' && RunCam.mode === 'fight' && Math.sign(RunCam.pos[0] - this.roadX) === rp.s;
            rp.vis += ((near ? 0.22 : 1) - rp.vis) * GM.damperK(0.12, dt);
            for (const m of rp.meshes) m.visibility = rp.vis;
        }
        if (this.posts.length && typeof RunCam !== 'undefined' && RunCam.pos) {
            const c = RunCam.pos, t = RunCam.tgt, dx = t[0] - c[0], dz = t[2] - c[2], L2 = dx * dx + dz * dz || 1;
            for (const p of this.posts) {
                const k = GM.clamp(((p.x - c[0]) * dx + (p.z - c[2]) * dz) / L2, 0, 1);
                const ex = c[0] + dx * k - p.x, ez = c[2] + dz * k - p.z;
                const want = k < 0.85 && ex * ex + ez * ez < 110 * 110 ? 0.18 : 1;
                p.vis += (want - p.vis) * GM.damperK(0.1, dt);
                for (const m of p.meshes) m.visibility = p.vis;
            }
        }
        for (const b of this.bricks) {
            if (!b.body) continue;
            // временные куски (срез пилой): в конце жизни сжимаются и убираются вместе с телом
            if (b.life != null) {
                b.life -= dt;
                const k = GM.clamp(b.life / 0.5, 0, 1);
                b.mesh.scaling.set(k, k, k);
                if (b.life <= 0) { Phys.remove(b.body); b.body = null; b.mesh.setEnabled(false); continue; }
            }
            const p = b.body.pos, r = b.body.q;
            b.mesh.position.set(p[0], p[1], p[2]);
            b.mesh.rotationQuaternion.set(r[0], r[1], r[2], r[3]);
            b.t += dt;
            // разлетевшиеся кирпичи через время засыпают и не мешают физике
            if (b.t > 6 && !b.body.sleep) { b.body.sleep = true; GM.set(b.body.vel, 0, 0, 0); GM.set(b.body.ang, 0, 0, 0); }
        }
    },
};
