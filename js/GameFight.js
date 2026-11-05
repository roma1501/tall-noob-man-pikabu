// GameFight.js — бой с боссом на ринге (финал каждого уровня).
// Тап — удар Нуба (без тапов он бьёт сам, но реже); свайп — отскок назад с прыжком.
// Удар отнимает рост (оба «сдуваются» по высоте), нокаут — когда рост упал до доли начального:
// проигравший улетает рэгдоллом (босс — в ящики за рингом, они разлетаются по физике).
// Боссы разные (TYPES, по номеру карты по кругу): у каждого свой вид и приёмы —
//   задира (удар), шустрик (серии), подрывник (бомбы в точку, где стоит Нуб), щитоносец (щит: удары не проходят,
//   потом контрудар), громила (прыжок и ударная волна по полу — перепрыгнуть), берсерк (на половине — ярость).
// Позы ударов — слой поверх Motion Matching (MotionController.layers читает ch.fightPose).

/** @satisfies {Record<string, any>} */
const Fight = {
    /** @type {any} */ st: null,       // текущий бой или null
    hints: 0,                          // сколько раз за сессию показана подсказка про уворот
    /** @type {Record<string, number>} */ seen: {},   // подсказки приёмов боссов за сессию
    _a: [0, 0, 0], _b: [0, 0, 0], _c: [0, 0, 0],

    // Типы боссов: id (тексты boss.<id>), вес приёмов, множители к RUN_FIGHT_* (rate — пауза между приёмами,
    // hit — сила удара, wide — ширина тела), цвета (кожа, майка, штаны) и снаряжение на голове.
    TYPES: [
        { id: 'brawler', moves: { punch: 1 }, rate: 1, hit: 1, wide: 1, look: [[176, 160, 196], [43, 45, 66], [141, 27, 46]], gear: '' },
        { id: 'speedster', moves: { combo: 1 }, rate: 1.3, hit: 0.42, wide: 0.85, look: [[158, 230, 198], [255, 79, 163], [43, 45, 66]], gear: 'band' },
        { id: 'bomber', moves: { punch: 0.4, bomb: 0.6 }, rate: 1, hit: 1, wide: 1.1, look: [[201, 162, 126], [74, 92, 52], [46, 46, 46]], gear: 'helmet' },
        { id: 'shield', moves: { punch: 0.6, block: 0.4 }, rate: 0.9, hit: 0.9, wide: 1.15, look: [[183, 196, 214], [91, 107, 130], [43, 47, 58]], gear: 'knight' },
        { id: 'slammer', moves: { punch: 0.5, slam: 0.5 }, rate: 1.05, hit: 1.1, wide: 1.35, look: [[143, 191, 90], [74, 44, 26], [42, 59, 26]], gear: '' },
        { id: 'berserk', moves: { punch: 1 }, rate: 1.05, hit: 0.95, wide: 1.1, rage: true, look: [[224, 90, 78], [30, 30, 30], [90, 18, 32]], gear: 'horns' },
    ],
    typeFor(mapIndex) { const n = this.TYPES.length; return this.TYPES[((mapIndex % n) + n) % n]; },

    cfg() {
        const U = 'undefined';
        return {
            hit: typeof RUN_FIGHT_HIT !== U ? RUN_FIGHT_HIT : 0.1,
            ko: typeof RUN_FIGHT_KO !== U ? RUN_FIGHT_KO : 0.45,
            bossHit: typeof RUN_FIGHT_BOSS_HIT !== U ? RUN_FIGHT_BOSS_HIT : 1.75,
            tap: typeof RUN_FIGHT_TAP !== U ? RUN_FIGHT_TAP : 0.2,
            auto: typeof RUN_FIGHT_AUTO !== U ? RUN_FIGHT_AUTO : 0.95,
            bossRate: typeof RUN_FIGHT_BOSS_RATE !== U ? RUN_FIGHT_BOSS_RATE : 0.95,
            windup: typeof RUN_FIGHT_WINDUP !== U ? RUN_FIGHT_WINDUP : 0.5,
            dodge: typeof RUN_FIGHT_DODGE !== U ? RUN_FIGHT_DODGE : 140,
            knock: typeof RUN_FIGHT_KNOCK !== U ? RUN_FIGHT_KNOCK : 1400,
        };
    },
    get on() { return !!this.st && !this.st.over; },

    newPose() { return { guard: 0, cheer: 0, block: 0, wl: 0, el: 0, wr: 0, er: 0, aimL: 90, aimR: 90, lean: 0 }; },
    newArm() { return { t: -1, hit: true, aim: 90, lean: 0, pow: 1, wind: 0.06, at: [0, 0, 0], kind: 'punch', mult: 1 }; },

    reset(game) {
        this.clearFx();
        this.st = null;
        if (game.runner) game.runner.fightPose = null;
        if (game.boss) {
            game.boss.sim.fightPose = null;
            if (game.boss.shield) game.boss.shield.setEnabled(false);
            if (Level.boss) game.boss.sim.pos[1] = Level.roadY;
        }
        UI.fight(false);
    },
    // Бомбы и ударные волны в полёте — убрать (новый уровень, оживление, конец боя).
    clearFx() {
        const st = this.st;
        if (!st) return;
        for (const o of st.bombs.concat(st.waves)) { try { o.mesh.dispose(); if (o.mark) o.mark.dispose(); } catch (e) { /* уже убран */ } }
        st.bombs.length = 0; st.waves.length = 0;
    },

    // Нуб дошёл до босса: бой начинается.
    start(game, r) {
        const c = this.cfg(), B = game.boss, lb = Level.boss, type = B.type || this.TYPES[0];
        const st = this.st = {
            c, type, t: 0, over: false, won: false,
            pH0: r.H, bH0: lb.height, bH: lb.height, bhs: new Float64Array([lb.height, 0]), bw: lb.width / 100 * type.wide,
            p: { pose: this.newPose(), arms: [this.newArm(), this.newArm()], next: 1, last: -9, queue: 0, kbv: 0 },
            b: { pose: this.newPose(), arms: [this.newArm(), this.newArm()], next: 0.9, side: 1, state: 'idle', move: null, last: '', kbv: 0, blocking: false, enraged: false, rate: 1, hitK: 1 },
            bombs: [], waves: [],
            swipe: 0, dodgeT: 0, dodgeCool: 0, taken: 0, dealt: 0, missed: 0, blocked: 0,
        };
        r.fightPose = st.p.pose; B.sim.fightPose = st.b.pose;
        UI.fight(true);
        UI.setFight(1, 1, r.H, lb.height, Lang.t('boss.' + type.id));
        UI.toast(Lang.t('fight.vs', { name: Lang.t('boss.' + type.id) }), 1.2, 'var(--coral)');
        Sound.play('assets/sounds/gate-mul.ogg', { volume: 0.9, rate: 0.8 });
        RunCam.mode = 'fight';
        RunCam.shake(4, 0.2);
    },

    // ---- ввод ---------------------------------------------------------------------------------------
    tap(game) {
        const st = this.st;
        if (!this.on) return;
        st.queue = 1;
        void game;
    },
    // Свайп (экранные px, в любую сторону) или клавиша: отскок назад с прыжком.
    // Пока длится окно отскока, удар босса проходит мимо; бомба падает на старое место; волну Нуб перепрыгивает.
    swipe(game, dx, axis) {
        const st = this.st;
        if (!this.on) return;
        st.swipe += dx;
        let go = !!axis;
        if (Math.abs(st.swipe) > 42) { go = true; st.swipe = 0; }
        if (!go || st.dodgeCool > 0) return;
        const r = game.runner;
        st.p.kbv -= st.c.dodge * 5;
        if (r.grounded) r.jump(340);
        st.dodgeT = 0.55; st.dodgeCool = 0.6;
        for (const o of st.bombs) if (o.t > 0.15) o.dodged = true;   // отскочил с круга, пока бомба летит
        Sound.play('assets/sounds/click.ogg', { volume: 0.5, rate: 0.6 });
    },

    // ---- кадр ---------------------------------------------------------------------------------------
    update(game, dt) {
        const st = this.st;
        if (!st) return;
        const c = st.c, r = game.runner, B = game.boss, lb = Level.boss, b = st.b;
        st.t += dt;
        this.fx(game, dt);
        // стойка: кулаки к лицу (после боя — опускаются)
        const gTo = st.over ? 0 : 1;
        st.p.pose.guard += (gTo - st.p.pose.guard) * GM.damperK(0.12, dt);
        b.pose.guard += (gTo - b.pose.guard) * GM.damperK(0.15, dt);
        b.pose.block += ((b.blocking && !st.over ? 1 : 0) - b.pose.block) * GM.damperK(0.07, dt);
        if (st.over) {
            const winner = st.won ? st.p.pose : b.pose;
            winner.cheer += (1 - winner.cheer) * GM.damperK(0.15, dt);
            this.arms(st.p, dt, 0.06, 0.07, 0.16, null);
            this.arms(b, dt, c.windup, 0.1, 0.35, null);
            if (B.shield) B.shield.setEnabled(false);
            this.crates(game);
            return;
        }
        // рост босса — пружина (сдувается от ударов), тело по нему
        GM.springTo(st.bhs, 0, st.bH, 3.2, 0.42, dt);
        const sh = Math.max(0.3, st.bhs[0] / 180);
        if (Math.abs(sh - B.body.sh) > 0.002) { B.body = Noob.body(sh, st.bw); B.mm.body = B.body; }
        // сближение: дистанция удара меньшего из двоих (оба шагают вперёд, когда «сдуваются»)
        const reachP = 64 * r.body.sh, reachB = 64 * B.body.sh;
        const gap = 20 * r.body.sw + 20 * st.bw + 0.78 * Math.min(reachP, reachB) + 14;
        if (r.finale) r.finale.stopZ = lb.z - gap;
        // отброс от ударов: Нуб шагает обратно сам (финал ведёт к stopZ), босс — пружиной к месту
        r.pos[2] += st.p.kbv * dt; st.p.kbv *= Math.exp(-dt * 9);
        B.sim.pos[2] += b.kbv * dt; b.kbv *= Math.exp(-dt * 9);
        B.sim.pos[2] += (lb.z - B.sim.pos[2]) * GM.damperK(0.35, dt);
        st.dodgeCool = Math.max(0, st.dodgeCool - dt);
        st.dodgeT = Math.max(0, st.dodgeT - dt);
        r.targetX = Level.roadX;
        // удары Нуба: тап (не чаще c.tap) или сам, если долго не тапают
        st.p.next -= dt;
        if (st.queue && st.t - st.p.last >= c.tap) { st.queue = 0; this.punch(game, st.p, r.mm.world, r.body, B.mm.world, st.bw, 0.06); }
        else if (st.p.next <= 0 && st.t - st.p.last >= c.auto) this.punch(game, st.p, r.mm.world, r.body, B.mm.world, st.bw, 0.06);
        this.arms(st.p, dt, 0.06, 0.07, 0.16, (arm) => this.hitBoss(game, arm));
        // берсерк: на половине — ярость (лечится, злее и быстрее)
        if (st.type.rage && !b.enraged && this.frac(st.bH, st.bH0) < 0.5) this.rage(game);
        // босс: пауза → приём своего типа (виден замах) → снова пауза
        if (b.state === 'idle') {
            b.next -= dt;
            if (b.next <= 0) this.startMove(game, this.pickMove());
        } else this.updateMove(game, dt);
        this.arms(b, dt, c.windup, 0.1, 0.35, (arm) => (arm.kind === 'bomb' ? this.throwBomb(game, arm) : this.hitPlayer(game, arm, arm.mult, false)));
        UI.setFight(this.frac(r.H, st.pH0), this.frac(st.bH, st.bH0), r.heightPx(), st.bhs[0], Lang.t('boss.' + st.type.id));
    },
    frac(h, h0) { const k = this.st.c.ko; return GM.clamp((h - h0 * k) / Math.max(1, h0 * (1 - k)), 0, 1); },

    // ---- приёмы босса --------------------------------------------------------------------------------
    pickMove() {
        const st = this.st, w = Object.assign({}, st.type.moves);
        if (st.b.last === 'block') delete w.block;          // щит не два раза подряд
        if (st.bombs.length) delete w.bomb;                 // одна бомба в воздухе
        const keys = Object.keys(w);
        if (!keys.length) return 'punch';
        let sum = 0; for (const k of keys) sum += w[k];
        let x = Math.random() * sum;
        for (const k of keys) { x -= w[k]; if (x <= 0) return k; }
        return keys[keys.length - 1];
    },
    // Подсказка о приёме: первый раз за сессию (по 2 раза на приём).
    hint(kind) {
        const n = this.seen[kind] || 0;
        if (n >= 2) return;
        this.seen[kind] = n + 1;
        UI.toast(Lang.t('boss.hint.' + kind), 1.2, 'var(--sky)');
    },
    warn(game) {
        const B = game.boss, hp = Noob.getPos(B.mm.world, Noob.J.NECK, this._a);
        UI.pop('!', [hp[0], hp[1] + 60, hp[2]], 'var(--coral)');
    },
    startMove(game, kind) {
        const st = this.st, c = st.c, b = st.b, r = game.runner, B = game.boss;
        b.state = 'move'; b.last = kind;
        /** @type {any} */
        const m = b.move = { kind, t: 0 };
        const mult = st.type.hit * b.hitK;
        if (kind === 'punch') {
            const arm = this.punch(game, b, B.mm.world, B.body, r.mm.world, r.body.sw, c.windup);
            arm.kind = 'punch'; arm.mult = mult;
            this.warn(game);
            if (!st.hinted && (this.hints || 0) < 2) { st.hinted = true; this.hints = (this.hints || 0) + 1; UI.toast(Lang.t('fight.dodge'), 1.1, 'var(--sky)'); }
        } else if (kind === 'combo') {
            // серия из трёх быстрых ударов: замах короче, каждый — слабее
            m.left = 2; m.last = st.t;
            const arm = this.punch(game, b, B.mm.world, B.body, r.mm.world, r.body.sw, c.windup * 0.6);
            arm.kind = 'punch'; arm.mult = mult; m.cur = arm;
            this.warn(game); this.hint('combo');
        } else if (kind === 'bomb') {
            // замах из-за головы, бросок в точку, где стоит Нуб (Level.roadX, его z)
            const arm = this.punch(game, b, B.mm.world, B.body, r.mm.world, r.body.sw, c.windup * 1.1);
            arm.kind = 'bomb'; arm.mult = 1.3 * mult; arm.aim = 150; arm.lean = 0;
            this.warn(game); this.hint('bomb');
        } else if (kind === 'block') {
            m.T = 1.25;
            b.blocking = true;
            if (B.shield) B.shield.setEnabled(true);
            Sound.play('assets/sounds/gate-up.ogg', { volume: 0.6, rate: 0.6 });
            this.hint('block');
        } else if (kind === 'slam') {
            // прыжок вверх, удар о пол — волна по рингу к Нубу (перепрыгнуть свайпом)
            m.T = 0.6; m.H = 40 + 0.22 * st.bhs[0];
            this.warn(game); this.hint('slam');
        }
    },
    updateMove(game, dt) {
        const st = this.st, c = st.c, b = st.b, m = b.move, r = game.runner, B = game.boss;
        m.t += dt;
        const idle = () => b.arms.every(a => a.t < 0);
        let done = false;
        if (m.kind === 'punch' || m.kind === 'bomb') done = idle();
        else if (m.kind === 'combo') {
            if (m.left > 0 && m.cur.hit && st.t - m.last > 0.26) {
                m.left--; m.last = st.t;
                const arm = this.punch(game, b, B.mm.world, B.body, r.mm.world, r.body.sw, c.windup * 0.4);
                arm.kind = 'punch'; arm.mult = st.type.hit * b.hitK; m.cur = arm;
            }
            done = m.left <= 0 && idle();
        } else if (m.kind === 'block') {
            if (m.t >= m.T) {
                // щит опускается — сразу контрудар
                b.blocking = false;
                if (B.shield) B.shield.setEnabled(false);
                this.startMove(game, 'punch');
                return;
            }
        } else if (m.kind === 'slam') {
            const k = m.t / m.T;
            b.pose.cheer = k < 1 ? Math.sin(Math.min(1, k * 1.4) * Math.PI / 2) : Math.max(0, b.pose.cheer - dt * 5);
            B.sim.pos[1] = Level.roadY + (k < 1 ? m.H * Math.sin(k * Math.PI) : 0);
            if (k >= 1 && !m.landed) { m.landed = true; this.slamWave(game); }
            done = k >= 1.5;
            if (done) { b.pose.cheer = 0; B.sim.pos[1] = Level.roadY; }
        }
        if (done) {
            b.state = 'idle'; b.move = null;
            const hurt = 1 - this.frac(st.bH, st.bH0);
            b.next = c.bossRate * st.type.rate * b.rate * GM.lerp(1, 0.6, GM.clamp(hurt, 0, 1)) * (0.85 + Math.random() * 0.3);
        }
    },

    // Бомба: летит дугой в точку, где стоял Нуб в момент броска; там взрыв — задело, если Нуб рядом.
    throwBomb(game, arm) {
        const st = this.st, r = game.runner, B = game.boss;
        if (st.over) return;
        const scene = game.app.location.view.scene, view = game.app.location.view;
        // бросок из-за головы босса (рука в этот миг уже над Нубом — от неё дуга не видна)
        const nk = Noob.getPos(B.mm.world, Noob.J.NECK, this._a);
        const size = 40 + 12 * B.body.sh;
        const mesh = BABYLON.MeshBuilder.CreateSphere('boss-bomb', { diameter: size, segments: 12 }, scene);
        mesh.material = game.bombMat();
        const fuse = BABYLON.MeshBuilder.CreateSphere('boss-bomb-fuse', { diameter: size * 0.28, segments: 6 }, scene);
        fuse.material = game.bombFuseMat(); fuse.parent = mesh; fuse.position.set(0, size * 0.5, 0);
        World3D.addObject(view, mesh, 'prop');
        Level.meshes.push(mesh);
        const p0 = [nk[0], nk[1] + 50 * B.body.sh, nk[2]], p1 = [r.pos[0], Level.roadY + size / 2, r.pos[2]];
        const dist = Math.abs(p1[2] - p0[2]);
        // красный круг на полу — куда упадёт (уйти с него отскоком)
        const mark = BABYLON.MeshBuilder.CreateDisc('boss-bomb-mark', { radius: 1, tessellation: 32 }, scene);
        mark.material = game.markMat(); mark.rotation.x = Math.PI / 2;
        mark.position.set(p1[0], Level.roadY + 2.5, p1[2]);
        const rad = 50 + size * 0.4; mark.scaling.set(rad, rad, 1);
        World3D.addObject(view, mark, 'prop', { castShadow: false, outline: false, ink: false });
        Level.meshes.push(mark);
        st.bombs.push({ mesh, mark, p0, p1, t: 0, T: 0.9, h: Math.max(160, dist * 0.8), mult: arm.mult, size });
        Sound.play('assets/sounds/click.ogg', { volume: 0.7, rate: 0.7 });
    },
    // Громила приземлился: кольцо волны расходится по рингу; дошло до Нуба на земле — удар.
    slamWave(game) {
        const st = this.st, B = game.boss;
        const scene = game.app.location.view.scene, view = game.app.location.view;
        const mesh = BABYLON.MeshBuilder.CreateTorus('boss-wave', { diameter: 1, thickness: 0.08, tessellation: 40 }, scene);
        mesh.material = game.waveMat();
        mesh.position.set(B.sim.pos[0], Level.roadY + 4, B.sim.pos[2]);
        mesh.scaling.set(60, 60, 60);
        World3D.addObject(view, mesh, 'prop', { castShadow: false });
        Level.meshes.push(mesh);
        st.waves.push({ mesh, rad: 30, z: B.sim.pos[2], hit: false, mult: 1.2 * st.type.hit * st.b.hitK });
        game.fxSlam([B.sim.pos[0], Level.roadY + 6, B.sim.pos[2]]);
    },
    // Полёт бомб и волн.
    fx(game, dt) {
        const st = this.st, r = game.runner;
        for (let i = st.bombs.length - 1; i >= 0; i--) {
            const o = st.bombs[i];
            o.t += dt;
            const k = Math.min(1, o.t / o.T);
            o.mesh.position.set(GM.lerp(o.p0[0], o.p1[0], k), GM.lerp(o.p0[1], o.p1[1], k) + o.h * 4 * k * (1 - k), GM.lerp(o.p0[2], o.p1[2], k));
            o.mesh.rotation.x += dt * 9;
            o.mark.visibility = 0.55 + 0.4 * Math.sin(o.t * 22);
            if (k < 1) continue;
            st.bombs.splice(i, 1);
            game.fxBomb([o.p1[0], Level.roadY + 10, o.p1[2]], o.size);
            try { o.mesh.dispose(); o.mark.dispose(); } catch (e) { /* уже убран */ }
            if (st.over) continue;
            const near = !o.dodged && Math.abs(r.pos[2] - o.p1[2]) < 50 + o.size * 0.4 && Math.abs(r.pos[0] - o.p1[0]) < 110;
            if (near) this.hitPlayer(game, { at: [r.pos[0], Level.roadY + r.heightPx() * 0.4, r.pos[2]] }, o.mult, true);
            else { st.missed++; game.fxFightMiss(r); }
        }
        for (let i = st.waves.length - 1; i >= 0; i--) {
            const o = st.waves[i];
            o.rad += dt * 720;
            o.mesh.scaling.set(o.rad * 2, o.rad * 2, o.rad * 2);
            o.mesh.visibility = GM.clamp(1.4 - o.rad / 420, 0, 1);
            if (!o.hit && !st.over && o.rad >= Math.abs(o.z - r.pos[2]) - 20 * r.body.sw) {
                o.hit = true;
                const air = r.pos[1] > Level.roadY + 14;
                if (air) { st.missed++; game.fxFightMiss(r, Lang.t('fight.jumped')); }
                else { this.hitPlayer(game, { at: [r.pos[0], Level.roadY + 30, r.pos[2]] }, o.mult, true); st.p.kbv -= 260; if (r.grounded) r.jump(260); }
            }
            if (o.rad > 560) { st.waves.splice(i, 1); try { o.mesh.dispose(); } catch (e) { /* уже убран */ } }
        }
        // щит: перед грудью босса, к Нубу
        const B = game.boss;
        if (B.shield && B.shield.isEnabled()) {
            const nk = Noob.getPos(B.mm.world, Noob.J.NECK, this._b), H = st.bhs[0];
            B.shield.position.set(nk[0], nk[1] - H * 0.12, nk[2]);
            const d = Math.max(H * 0.72, 120 * st.bw) * (1 + Math.sin(st.t * 12) * 0.03);
            B.shield.scaling.set(d, d * 1.1, d);
        }
    },
    rage(game) {
        const st = this.st, b = st.b;
        b.enraged = true; b.rate = 0.75; b.hitK = 1.15;
        st.bH = Math.min(st.bH0, st.bH + st.bH0 * (1 - st.c.ko) * 0.12);   // лечится на восьмую часть
        game.fxRage();
    },

    // Начать удар следующей рукой: прицел — в ту часть соперника, что на высоте плеча (ниже — в живот, выше — в голову).
    punch(game, f, attW, attBody, defW, defWide, wind) {
        const side = f.arms[1].t < 0 && (f.arms[0].t >= 0 || f.lastSide !== 1) ? 1 : 0;
        f.lastSide = side;
        const arm = f.arms[side], J = Noob.J;
        const s = Noob.getPos(attW, side ? J.SHR : J.SHL, this._a);
        const hp = Noob.getPos(defW, J.HIPS, this._b), nk = Noob.getPos(defW, J.NECK, this._c);
        const ty = GM.clamp(s[1], hp[1] + (nk[1] - hp[1]) * 0.25, nk[1] + 16);
        const fwd = Math.max(10, Math.abs(nk[2] - s[2]) - 20 * defWide), dy = ty - s[1];
        arm.aim = GM.clamp(Math.atan2(fwd, -dy) / GM.DEG, 25, 150);
        const reach = 64 * attBody.sh, H = 180 * attBody.sh;
        arm.lean = dy < 20 ? GM.clamp((Math.hypot(fwd, dy) - reach) / (0.45 * H), 0, 0.5) / GM.DEG : 0;
        GM.set(arm.at, hp[0], ty, nk[2] - Math.sign(nk[2] - s[2]) * 20 * defWide);
        // частые удары слабее: полная сила — после паузы в половину интервала автоудара
        arm.pow = GM.clamp((this.st.t - f.last) / (this.st.c.auto * 0.5), 0.35, 1);
        arm.t = 0; arm.hit = false; arm.wind = wind; arm.kind = 'punch'; arm.mult = 1;
        f.last = this.st.t; f.next = this.st.c.auto;
        void game;
        return arm;
    },

    // Руки: время удара → веса замаха/удара в позе; в момент удара — onHit(arm).
    arms(f, dt, W, S, R, onHit) {
        const P = f.pose;
        let lean = 0;
        for (let k = 0; k < 2; k++) {
            const a = f.arms[k];
            let wi = 0, ex = 0;
            if (a.t >= 0) {
                a.t += dt;
                const t = a.t, Wt = a.wind != null ? a.wind : W;
                if (t < Wt) wi = GM.smooth(t / Wt);
                else if (t < Wt + S) { const q = (t - Wt) / S; wi = 1 - q; ex = Math.sqrt(q); }
                else if (t < Wt + S + R) ex = 1 - GM.smooth((t - Wt - S) / R);
                else a.t = -1;
                if (!a.hit && t >= Wt + S * 0.8) { a.hit = true; if (onHit) onHit(a); }
            }
            if (k) { P.wr = wi; P.er = ex; P.aimR = a.aim; } else { P.wl = wi; P.el = ex; P.aimL = a.aim; }
            lean = Math.max(lean, a.lean * ex);
        }
        P.lean = lean;
    },

    // ---- попадания ----------------------------------------------------------------------------------
    hitBoss(game, arm) {
        const st = this.st, c = st.c, r = game.runner, B = game.boss;
        if (st.over) return;
        // щит: удар не проходит, Нуба отбрасывает
        if (st.b.blocking) {
            st.blocked++;
            st.p.kbv -= 120;
            game.fxFightBlock(arm.at);
            return;
        }
        const dmg = Math.max(4, Math.round(c.hit * r.effH() * arm.pow));
        st.bH = Math.max(st.bH0 * c.ko - 1, st.bH - dmg);
        st.dealt++;
        const ratio = GM.clamp(r.effH() / Math.max(60, st.bhs[0]), 0.3, 3);
        st.b.kbv += 140 * ratio;
        const S = B.mm.sec; S[1] -= 2.4 * ratio; S[5] += 3.5; S[3] += (Math.random() - 0.5) * 3;
        game.fxFightHit(arm.at, dmg, false);
        if (st.bH <= st.bH0 * c.ko) this.ko(game, true, ratio);
    },
    // Удар по Нубу: mult — сила приёма; area — бомба или волна (уворот — местом/прыжком, не окном отскока).
    hitPlayer(game, arm, mult, area) {
        const st = this.st, c = st.c, r = game.runner;
        if (st.over) return;
        // увернулся: Нуб отскочил назад — удар прошёл мимо
        if (!area && st.dodgeT > 0) { st.missed++; game.fxFightMiss(r); return; }
        const dmg = Math.max(6, Math.round(c.hit * c.bossHit * st.bhs[0] * (mult || 1)));
        r.setHeight(r.H - dmg);
        st.taken++;
        const ratio = GM.clamp(st.bhs[0] / Math.max(60, r.effH()), 0.3, 3);
        st.p.kbv -= 150 * ratio;
        const S = r.mm.sec; S[1] -= 2.4 * ratio; S[5] += 3.5; S[3] += (Math.random() - 0.5) * 3;
        r.hs[1] -= 120;
        game.fxFightHit(arm.at, dmg, true);
        if (r.H <= st.pH0 * c.ko || r.H < r.c.minH) this.ko(game, false, ratio);
    },

    // Нокаут: проигравший — рэгдолл, отлетает с силой удара (босс — назад, в ящики).
    ko(game, win, ratio) {
        const st = this.st, c = st.c, r = game.runner, B = game.boss;
        st.over = true; st.won = win;
        st.b.blocking = false;
        if (B.shield) B.shield.setEnabled(false);
        B.sim.pos[1] = Level.roadY;
        const k = GM.clamp(ratio, 0.6, 2);
        UI.fight(false);
        if (win) {
            game.knockBoss([(Math.random() - 0.5) * 140, 420 + 280 * k, c.knock * (0.65 + 0.35 * k)], [-2.4 * k, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5]);
            if (r.finale) r.finale.won = true;
        } else {
            r.ragdoll = new NoobRagdoll(r.mm.world, [(Math.random() - 0.5) * 120, 300 + 200 * k, -c.knock * (0.5 + 0.3 * k)], [2.2 * k, 0, 0], r.body);
            r.fightPose = null;
        }
        game.finishBoss(r, win, st);
    },

    // Ящики за рингом: проснулись от удара рэгдолла — звук и пыль (один раз на ящик).
    crates(game) {
        for (const cr of Level.crates) {
            if (cr.woke || cr.body.sleep) continue;
            cr.woke = true;
            game.fxCrate(cr);
        }
    },
};
