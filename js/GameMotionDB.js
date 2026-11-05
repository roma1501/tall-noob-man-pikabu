// GameMotionDB.js — база движений для Motion Matching и поиск по ней.
//
// Мокапа у браузерной игры нет, поэтому база СИНТЕЗИРУЕТСЯ при загрузке «виртуальным актёром»:
//  1) сценарий дублей (стоит, идёт, бежит, спринтует, разгоняется, тормозит, разворачивается на 90–180°,
//     бежит по дуге, поворачивается на месте) — желаемые скорость и курс по отрезкам;
//  2) корень актёра движется той же пружиной, что и персонаж в игре (Holden, spring character), — база и
//     прогноз траектории в игре говорят на одном языке;
//  3) походка: фаза шага с частотой по скорости, доля опоры (ходьба — двойная опора, бег — полёт),
//     стопы ставятся в мировые точки по БУДУЩЕМУ положению корня в середине опоры (без скольжения),
//     перенос ноги по дуге с перекатом пятка-носок, таз качается и проседает, корпус наклоняется по
//     ускорению и в повороты, плечи против таза, руки маятником, голова смотрит в поворот и гасит качку;
//  4) ноги — аналитическим IK (Noob.ikLeg), таз опускается, если стопа иначе не достаётся.
// Каждый кадр базы (60 к/с) хранит позу, корень и признаки (features) для поиска:
//   стопы (положение и скорость), скорость таза, траектория корня через 1/3, 2/3 и 1 с (положение и курс).
// Признаки нормируются (среднее и разброс по группе, вес группы), поиск — полный перебор с ранним отсечением.

/** @satisfies {Record<string, any>} */
const MotionDB = {
    FPS: 60,
    F: 27,                   // длина вектора признаков
    TRAJ: [20, 40, 60],      // кадры вперёд для траектории
    n: 0,
    /** @type {Float32Array} */ rootX: null,
    /** @type {Float32Array} */ rootZ: null,
    /** @type {Float32Array} */ rootYaw: null,
    /** @type {Float32Array} */ hips: null,
    /** @type {Float32Array} */ rot: null,
    /** @type {Uint8Array} */ contact: null,
    /** @type {Int16Array} */ take: null,
    /** @type {Uint8Array} */ valid: null,
    /** @type {Float32Array} */ speed: null,
    /** @type {Float32Array} */ feat: null,
    /** @type {Float32Array} */ fOffset: null,
    /** @type {Float32Array} */ fScale: null,
    /** @type {{ name: string, start: number, end: number }[]} */ takes: [],
    ready: false,
    buildMs: 0,

    // ---- параметры походки (Constants.js с дефолтами) --------------------------------------------
    cfg() {
        const U = 'undefined';
        return {
            walk: typeof NOOB_WALK_SPEED !== U ? NOOB_WALK_SPEED : 140,
            jog: typeof NOOB_RUN_SPEED !== U ? NOOB_RUN_SPEED : 300,
            sprint: typeof NOOB_SPRINT_SPEED !== U ? NOOB_SPRINT_SPEED : 470,
            hlVel: typeof NOOB_VEL_HALFLIFE !== U ? NOOB_VEL_HALFLIFE : 0.25,
            hlRot: typeof NOOB_ROT_HALFLIFE !== U ? NOOB_ROT_HALFLIFE : 0.18,
            gravity: typeof NOOB_GRAVITY !== U ? NOOB_GRAVITY : 1200,
            seconds: typeof NOOB_MM_DB_SECONDS !== U ? NOOB_MM_DB_SECONDS : 230,
            wFootPos: typeof NOOB_MM_W_FOOT_POS !== U ? NOOB_MM_W_FOOT_POS : 0.75,
            wFootVel: typeof NOOB_MM_W_FOOT_VEL !== U ? NOOB_MM_W_FOOT_VEL : 1,
            wHipVel: typeof NOOB_MM_W_HIP_VEL !== U ? NOOB_MM_W_HIP_VEL : 1,
            wTrajPos: typeof NOOB_MM_W_TRAJ_POS !== U ? NOOB_MM_W_TRAJ_POS : 1.2,
            wTrajDir: typeof NOOB_MM_W_TRAJ_DIR !== U ? NOOB_MM_W_TRAJ_DIR : 1.5,
        };
    },

    // Частота шагов (шагов/с) и доля опоры по скорости (px/с).
    cadence(s, c) { return 1.75 + 2.45 * Math.pow(GM.clamp(s / c.sprint, 0, 1.3), 0.8); },
    duty(s) { return GM.lerp(0.64, 0.36, GM.smooth((s - 150) / 110)); },
    runFactor(s) { return GM.smooth((s - 170) / 90); },

    // ---- сценарий дублей ---------------------------------------------------------------------------
    // Отрезок: { dur, speed, dir (абсолютный курс), omega (рад/с, дуга), turn (поворот на месте), hlV, hlR }
    program(c) {
        const R = GM.rng(1501), D = GM.DEG;
        const rnd = (a, b) => a + (b - a) * R(), pick = (arr) => arr[Math.floor(R() * arr.length)];
        const sgn = () => (R() < 0.5 ? -1 : 1);
        const speedPick = () => { const r = R(); return r < 0.28 ? c.walk * rnd(0.85, 1.1) : r < 0.68 ? c.jog * rnd(0.9, 1.08) : c.sprint * rnd(0.93, 1.03); };
        const takes = [];
        const vary = (seg) => Object.assign({ hlV: c.hlVel * rnd(0.88, 1.15), hlR: c.hlRot * rnd(0.88, 1.15) }, seg);
        // 1. стойка
        takes.push({ name: 'idle', segs: [vary({ dur: 7, speed: 0, dir: 0 })] });
        // 2. повороты на месте
        {
            const segs = [vary({ dur: 1.2, speed: 0, dir: 0 })];
            let dir = 0;
            for (const a of [90, -90, 180, 45, -135, 135, -45, -180, 60, -60]) {
                dir += a * D * (a === 180 || a === -180 ? 0.985 : 1);
                segs.push(vary({ dur: rnd(1.1, 1.6), speed: 0, dir, turn: true }));
            }
            takes.push({ name: 'turn', segs });
        }
        // 3. старты и остановки с разворотом
        {
            const segs = [vary({ dur: 1.0, speed: 0, dir: 0 })];
            let dir = 0;
            for (let k = 0; k < 16; k++) {
                dir += pick([0, 0, 45, -45, 90, -90, 135, -135, 178, -178]) * D;
                segs.push(vary({ dur: rnd(1.0, 2.0), speed: speedPick(), dir }));
                segs.push(vary({ dur: rnd(0.9, 1.6), speed: 0, dir }));
            }
            takes.push({ name: 'start-stop', segs });
        }
        // 4. смена темпа по прямой
        {
            const segs = [vary({ dur: 1.0, speed: 0, dir: 0 })];
            const seq = ['walk', 'jog', 'sprint', 'jog', 'walk', 0, 'sprint', 'walk', 'sprint', 0, 'jog', 'sprint', 'walk', 0];
            for (const s of seq) segs.push(vary({ dur: s === 0 ? 1.3 : rnd(1.3, 2.2), speed: s === 0 ? 0 : c[s] * rnd(0.95, 1.05), dir: rnd(-0.1, 0.1) }));
            takes.push({ name: 'pace', segs });
        }
        // 5. свободная беготня (и её зеркало — левые и правые повороты поровну)
        const freeSeconds = Math.max(30, c.seconds - 7 - 16 - 40 - 26);
        const nFree = 4, perTake = freeSeconds / nFree;
        for (let t = 0; t < nFree / 2; t++) {
            const segs = [vary({ dur: 1.0, speed: 0, dir: 0 })];
            let dir = 0, time = 1, speed = 0;
            while (time < perTake) {
                const r = R();
                let seg;
                if (speed > 0 && r < 0.14) seg = { dur: rnd(0.8, 1.8), speed: 0, dir };
                else if (r < 0.3) seg = { dur: rnd(1.4, 3.0), speed: speedPick(), dir, omega: sgn() * rnd(40, 115) * D };
                else {
                    const r2 = R();
                    const d = r2 < 0.35 ? rnd(0, 25) : r2 < 0.6 ? rnd(25, 70) : r2 < 0.8 ? rnd(70, 120) : r2 < 0.92 ? rnd(120, 160) : rnd(172, 179);
                    dir += sgn() * d * D;
                    seg = { dur: rnd(0.6, 2.2), speed: speedPick(), dir };
                }
                seg = vary(seg);
                segs.push(seg);
                if (seg.omega) dir += seg.omega * seg.dur;
                speed = seg.speed;
                time += seg.dur;
            }
            takes.push({ name: 'free-' + t, segs });
            takes.push({ name: 'free-' + t + '-m', segs: segs.map(s => Object.assign({}, s, { dir: -s.dir, omega: s.omega ? -s.omega : 0 })) });
        }
        for (const tk of takes) tk.segs.push(vary({ dur: 1.7, speed: 0, dir: tk.segs[tk.segs.length - 1].dir + (tk.segs[tk.segs.length - 1].omega || 0) * tk.segs[tk.segs.length - 1].dur }));
        return takes;
    },

    // ---- синтез --------------------------------------------------------------------------------------
    build() {
        const t0 = performance.now();
        const c = this.cfg();
        const takes = this.program(c);
        const parts = takes.map((tk, i) => this.synthTake(tk, c, 1501 + i * 17));
        let n = 0;
        for (const p of parts) n += p.n;
        this.n = n;
        this.rootX = new Float32Array(n); this.rootZ = new Float32Array(n); this.rootYaw = new Float32Array(n);
        this.hips = new Float32Array(n * 3); this.rot = new Float32Array(n * 60);
        this.contact = new Uint8Array(n * 2); this.take = new Int16Array(n); this.valid = new Uint8Array(n);
        this.speed = new Float32Array(n);
        this.takes = [];
        let o = 0;
        for (let k = 0; k < parts.length; k++) {
            const p = parts[k];
            this.rootX.set(p.X, o); this.rootZ.set(p.Z, o); this.rootYaw.set(p.TH, o);
            this.hips.set(p.hips, o * 3); this.rot.set(p.rot, o * 60); this.contact.set(p.contact, o * 2);
            this.speed.set(p.S, o);
            for (let i = 0; i < p.n; i++) {
                this.take[o + i] = k;
                this.valid[o + i] = (i >= 1 && i + this.TRAJ[2] < p.n) ? 1 : 0;
            }
            this.takes.push({ name: takes[k].name, start: o, end: o + p.n });
            o += p.n;
        }
        this.computeFeatures(c);
        this.ready = true;
        this.buildMs = performance.now() - t0;
        return this;
    },

    // Один дубль: корень, фаза, стопы, таз, корпус, руки, IK -> массивы кадров.
    synthTake(tk, c, seed) {
        const R = GM.rng(seed), D = GM.DEG, dt = 1 / this.FPS, G = c.gravity;
        let total = 0;
        for (const s of tk.segs) total += s.dur;
        const n = Math.max(2, Math.round(total * this.FPS));
        const X = new Float32Array(n), Z = new Float32Array(n), TH = new Float32Array(n), S = new Float32Array(n);
        const W = new Float32Array(n), AF = new Float32Array(n), VX = new Float32Array(n), VZ = new Float32Array(n);
        // 1) корень
        const sx = { v: 0, a: 0 }, sz = { v: 0, a: 0 }, fa = { x: tk.segs[0].dir || 0, v: 0 };
        let x = 0, z = 0, seg = 0, segT = 0, goalDir = fa.x;
        for (let i = 0; i < n; i++) {
            while (seg < tk.segs.length - 1 && segT >= tk.segs[seg].dur) { segT -= tk.segs[seg].dur; seg++; }
            const sg = tk.segs[seg];
            const dir = sg.dir + (sg.omega || 0) * segT;
            const vgx = sg.speed * Math.cos(dir), vgz = sg.speed * Math.sin(dir);
            x += GM.springChar(sx, vgx, sg.hlV, dt);
            z += GM.springChar(sz, vgz, sg.hlV, dt);
            if (sg.speed > 0 || sg.turn) goalDir = dir;
            GM.springAngle(fa, goalDir, sg.hlR, dt);
            X[i] = x; Z[i] = z; TH[i] = fa.x; W[i] = fa.v; VX[i] = sx.v; VZ[i] = sz.v;
            S[i] = Math.hypot(sx.v, sz.v);
            AF[i] = sx.a * Math.cos(fa.x) + sz.a * Math.sin(fa.x);
            segT += dt;
        }
        // 2) фаза шага: движение по окну (что будет в ближайшие 0.4 с), остановка — в двойной опоре
        const moving = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            let m = 0;
            for (let j = Math.max(0, i - 6); j <= Math.min(n - 1, i + 24); j++) if (S[j] > 18 || Math.abs(W[j]) > 0.9) { m = 1; break; }
            moving[i] = m;
        }
        const PH = new Float64Array(n), BETA = new Float32Array(n), FROZEN = new Uint8Array(n);
        let ph = R() < 0.5 ? 0.05 : 0.55, frozen = true;
        for (let i = 0; i < n; i++) {
            const s = S[i];
            BETA[i] = this.duty(s);
            let rate = this.cadence(s, c) / 2;
            if (Math.abs(W[i]) > 0.9 && s < 80) rate = Math.max(rate, 1.05);
            if (frozen && moving[i]) frozen = false;
            if (!frozen) {
                let nx = ph + rate * dt;
                if (!moving[i] && Math.floor((ph - 0.05) / 0.5) < Math.floor((nx - 0.05) / 0.5)) {
                    nx = Math.floor((nx - 0.05) / 0.5) * 0.5 + 0.05;
                    frozen = true;
                }
                ph = nx;
            }
            PH[i] = ph; FROZEN[i] = frozen ? 1 : 0;
        }
        // 3) опоры каждой стопы и точки постановки
        const plants = [[], []];   // { a, b, x, z, yaw, run }
        for (let k = 0; k < 2; k++) {
            let a = -1;
            for (let i = 0; i <= n; i++) {
                const st = i < n && GM.frac(PH[i] - k * 0.5) < BETA[i];
                if (st && a < 0) a = i;
                if (!st && a >= 0) {
                    const m = Math.floor((a + i - 1) / 2);
                    const th = TH[m], sp = S[m];
                    const w = GM.lerp(15, 9, GM.clamp(sp / c.sprint, 0, 1));
                    const side = k ? 1 : -1;
                    const toe = (5 - 3 * this.runFactor(sp)) * D * side;
                    plants[k].push({ a, b: i, x: X[m] - Math.sin(th) * w * side, z: Z[m] + Math.cos(th) * w * side, yaw: th + toe, run: this.runFactor(S[a]), sp });
                    a = -1;
                }
            }
        }
        // 4) стопы по кадрам: подошва (плоская точка), курс, тангаж
        const FS = [new Float32Array(n * 3), new Float32Array(n * 3)], FY = [new Float32Array(n), new Float32Array(n)], FP = [new Float32Array(n), new Float32Array(n)];
        const STANCE = [new Uint8Array(n), new Uint8Array(n)];
        for (let k = 0; k < 2; k++) {
            const pl = plants[k];
            for (let q = 0; q < pl.length; q++) {
                const p = pl[q], T = (p.b - p.a) / this.FPS;
                const lifts = p.b < n;
                const offA = (22 + 18 * p.run) * D;
                const strike = (-12 * (1 - p.run) - 1) * D;
                for (let i = p.a; i < p.b; i++) {
                    let pitch = 0;
                    const tIn = (i - p.a) / this.FPS, tLeft = (p.b - i) / this.FPS;
                    if (q > 0 || p.a > 0) pitch = strike * (1 - GM.smooth(tIn / 0.09));
                    if (lifts) { const Th = GM.clamp(0.35 * T, 0.06, 0.24); if (tLeft < Th) pitch = offA * GM.smooth(1 - tLeft / Th); }
                    FS[k][i * 3] = p.x; FS[k][i * 3 + 1] = 0; FS[k][i * 3 + 2] = p.z; FY[k][i] = p.yaw; FP[k][i] = pitch;
                    STANCE[k][i] = 1;
                }
                // перенос до следующей опоры
                const nx = pl[q + 1];
                if (!nx) continue;
                const span = nx.a - p.b + 1, run = this.runFactor(S[Math.min(n - 1, Math.floor((p.b + nx.a) / 2))]);
                const sp = S[Math.min(n - 1, Math.floor((p.b + nx.a) / 2))];
                const Hs = (6 + 0.042 * sp) * (Math.abs(W[p.b] || 0) > 0.9 && sp < 80 ? 0.7 : 1);
                const landPitch = (-12 * (1 - nx.run) - 2) * D;
                const dyaw = GM.wrap(nx.yaw - p.yaw);
                for (let i = p.b; i < nx.a; i++) {
                    const u = (i - p.b + 1) / span;
                    const uh = GM.smoother(Math.pow(u, 1 + 0.6 * run));
                    const lift = Hs * Math.sin(Math.PI * Math.pow(u, 0.9 - 0.3 * run));
                    FS[k][i * 3] = GM.lerp(p.x, nx.x, uh); FS[k][i * 3 + 1] = lift; FS[k][i * 3 + 2] = GM.lerp(p.z, nx.z, uh);
                    FY[k][i] = p.yaw + dyaw * GM.smooth(u);
                    FP[k][i] = GM.lerp(offA, landPitch, GM.smooth(u * 1.15));
                }
            }
            // до первой опоры и после последней — на месте
            if (pl.length) {
                for (let i = 0; i < pl[0].a; i++) { FS[k][i * 3] = pl[0].x; FS[k][i * 3 + 2] = pl[0].z; FY[k][i] = pl[0].yaw; STANCE[k][i] = 1; }
                const L = pl[pl.length - 1];
                for (let i = L.b; i < n; i++) { FS[k][i * 3] = L.x; FS[k][i * 3 + 2] = L.z; FY[k][i] = L.yaw; STANCE[k][i] = 1; }
            }
        }
        // 5) таз, корпус, руки, голова; IK ног
        const pose = Noob.newPose(), w = Noob.newWorld();
        const hipsOut = new Float32Array(n * 3), rotOut = new Float32Array(n * 60), contact = new Uint8Array(n * 2);
        const rootQ = [0, 0, 0, 1], rootP = [0, 0, 0], q = [0, 0, 0, 1], q2 = [0, 0, 0, 1], v = [0, 0, 0];
        const footQ = [[0, 0, 0, 1], [0, 0, 0, 1]], ankle = [[0, 0, 0], [0, 0, 0]], sole = [0, 0, 0];
        const hipsW = [0, 0, 0], hipsQ = [0, 0, 0, 1], hj = [0, 0, 0];
        const drop = new Float32Array(n), hipY = new Float32Array(n);
        const J = Noob.J, LMAX = 54.8;
        let idleT = 0;
        const smAF = new Float32Array(n), smW = new Float32Array(n);
        // сглаженные ускорение и угловая скорость (наклоны не дёргаются)
        for (let i = 0; i < n; i++) {
            let sa = 0, sw = 0, cnt = 0;
            for (let j = Math.max(0, i - 5); j <= Math.min(n - 1, i + 5); j++) { sa += AF[j]; sw += W[j]; cnt++; }
            smAF[i] = sa / cnt; smW[i] = sw / cnt;
        }
        // проход A: таз (высота с ограничением по досягаемости стоп)
        const hipRot = new Float32Array(n * 4), lean = new Float32Array(n), bankA = new Float32Array(n), twistA = new Float32Array(n), dropRoll = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const s = S[i], ph = PH[i], beta = BETA[i], r = this.runFactor(s), th = TH[i];
            const mv = GM.clamp(s / 80, 0, 1);
            idleT = FROZEN[i] ? idleT + dt : 0;
            const idleW = GM.smooth(idleT / 1.2);
            const twist = -(3 + 5 * s / c.sprint) * D * mv * Math.cos(2 * Math.PI * ph);
            const sr = GM.clamp(s / c.sprint, 0, 1.2);
            const leanV = (2 + 6 * sr * sr) * D;
            const leanA = GM.clamp(Math.atan(smAF[i] / G) * 0.55, -14 * D, 16 * D);
            const bank = GM.clamp(Math.atan(s * smW[i] / G) * 0.55, -18 * D, 18 * D);
            const pdrop = 3 * D * (1 - r) * mv * Math.cos(2 * Math.PI * (ph - beta / 2));
            const idleSway = idleW * 0.9 * D * Math.sin(2 * Math.PI * i * dt / 5.3);
            lean[i] = leanV + leanA; bankA[i] = bank; twistA[i] = twist; dropRoll[i] = pdrop;
            GM.qheading(rootQ, th);
            GM.qeuler(q, twist + idleSway * 0.6, -(leanV + leanA) * 0.6, bank + pdrop + idleSway);
            GM.qmul(hipsQ, rootQ, q);
            hipRot.set(hipsQ, i * 4);
            // центр таза (сустав Hips; тазобедренные — на 8 px ниже, прямая нога — 74): стойка — колени чуть мягкие, бег — ниже
            const h0 = s < c.walk ? GM.lerp(73.2, 72.4, s / c.walk) : GM.lerp(72.4, 69.2, GM.clamp((s - c.walk) / (c.sprint - c.walk), 0, 1));
            const bobW = 1.6 * GM.clamp(s / c.walk, 0, 1) * Math.cos(4 * Math.PI * (ph - beta / 2));
            const bobR = -(3.2 + 3 * GM.clamp((s - 260) / 210, 0, 1)) * Math.cos(4 * Math.PI * (ph - beta / 2));
            hipY[i] = h0 + GM.lerp(bobW, bobR, r) + idleW * 0.4 * Math.sin(2 * Math.PI * i * dt / 3.4);
            const sway = -(2.4 * (1 - r) * mv) * Math.cos(2 * Math.PI * (ph - beta / 2)) + idleW * 2.2 * Math.sin(2 * Math.PI * i * dt / 5.3);
            hipsW[0] = X[i] - Math.sin(th) * sway; hipsW[1] = hipY[i]; hipsW[2] = Z[i] + Math.cos(th) * sway;
            hipsOut[i * 3] = hipsW[0]; hipsOut[i * 3 + 1] = hipsW[1]; hipsOut[i * 3 + 2] = hipsW[2];
            // досягаемость: опорные — жёстко, переносимые — наполовину
            let need = 0;
            for (let k = 0; k < 2; k++) {
                sole[0] = FS[k][i * 3]; sole[1] = FS[k][i * 3 + 1]; sole[2] = FS[k][i * 3 + 2];
                Noob.footFrame(sole, FY[k][i], FP[k][i], null, footQ[k], ankle[k]);
                GM.qrot(hj, hipsQ, [0, -8, k ? 17.5 : -17.5]); GM.add(hj, hj, hipsW);
                const dh = Math.hypot(hj[0] - ankle[k][0], hj[2] - ankle[k][2]);
                const maxY = ankle[k][1] + Math.sqrt(Math.max(0, LMAX * LMAX - dh * dh));
                const d = hj[1] - maxY;
                if (d > 0) need = Math.max(need, STANCE[k][i] ? d : d * 0.5);
            }
            drop[i] = need;
        }
        // сгладить провал таза (без рывков), но не меньше нужного для опорной ноги
        const dropS = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            let m = 0, cnt = 0;
            for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) { m = Math.max(m, drop[j] * (1 - Math.abs(j - i) / 6)); cnt++; }
            dropS[i] = m;
        }
        // проход B: поза
        for (let i = 0; i < n; i++) {
            const s = S[i], ph = PH[i], r = this.runFactor(s), th = TH[i];
            const mv = GM.clamp(s / 80, 0, 1);
            GM.qheading(rootQ, th);
            rootP[0] = X[i]; rootP[1] = 0; rootP[2] = Z[i];
            // таз в системе корня
            v[0] = hipsOut[i * 3] - X[i]; v[1] = hipsOut[i * 3 + 1] - dropS[i]; v[2] = hipsOut[i * 3 + 2] - Z[i];
            GM.qinvrot(pose.hips, rootQ, v);
            q[0] = hipRot[i * 4]; q[1] = hipRot[i * 4 + 1]; q[2] = hipRot[i * 4 + 2]; q[3] = hipRot[i * 4 + 3];
            GM.qinvmul(q, rootQ, q);
            Noob.setLocal(pose, J.HIPS, q);
            // корпус: против таза, наклон, дыхание
            const idleW = FROZEN[i] ? GM.smooth(Math.min(1, (i > 0 ? 1 : 0))) : 0;
            const breath = (FROZEN[i] ? 1 : 0.25) * 0.9 * D * Math.sin(2 * Math.PI * i * dt / 3.4);
            const runLean = (2 + 7 * GM.clamp(s / c.sprint, 0, 1.2)) * D;
            GM.qeuler(q, -1.35 * twistA[i], -(0.4 * lean[i] + runLean) + breath, -0.75 * dropRoll[i] - 0.25 * bankA[i]);
            Noob.setLocal(pose, J.WAIST, q);
            // руки маятником (противофаза ногам)
            const amp = (22 * GM.clamp(s / c.walk, 0, 1) + 30 * GM.clamp((s - c.walk) / (c.sprint - c.walk), 0, 1)) * D;
            const sw = Math.cos(2 * Math.PI * (ph - 0.04));
            const bias = (3 + 7 * r) * D;
            const abd = (4 + 4 * r) * D + idleW * 0.4 * D * Math.sin(2 * Math.PI * i * dt / 3.4);
            const elb0 = GM.lerp(10, 72, r) * D + 12 * D * s / c.sprint;
            for (let k = 0; k < 2; k++) {
                const side = k ? 1 : -1;            // правая +, левая −
                const a = side * amp * sw + bias;     // правая рука вперёд при левой ноге впереди
                GM.qeuler(q, 0, a, -side * abd);
                Noob.setLocal(pose, k ? J.SHR : J.SHL, q);
                const fw = Math.max(0, a) / Math.max(1e-3, amp + bias);
                GM.qeuler(q, 0, elb0 + 18 * D * fw * mv, 0);
                Noob.setLocal(pose, k ? J.ELR : J.ELL, q);
                GM.qeuler(q, 0, 6 * D, 0);
                Noob.setLocal(pose, k ? J.WRR : J.WRL, q);
            }
            // FK верха, чтобы поставить голову и найти тазобедренные суставы
            Noob.fk(pose, rootP, rootQ, w);
            // голова: смотрит в будущий курс, гасит наклоны корпуса
            const fut = Math.min(n - 1, i + 27);
            const look = GM.clamp(GM.wrap(TH[fut] - th), -50 * D, 50 * D) * 0.8;
            const nod = 1.5 * D * r * Math.cos(4 * Math.PI * (ph - BETA[i] / 2));
            GM.qheading(q2, th + look);
            GM.qeuler(q, 0, nod, 0);
            GM.qmul(q2, q2, q);
            Noob.getRot(w, J.WAIST, q);
            GM.qinvmul(q2, q, q2);
            GM.qslerp(q2, [0, 0, 0, 1], q2, 0.78);
            Noob.setLocal(pose, J.NECK, q2);
            // ноги — IK к стопам
            for (let k = 0; k < 2; k++) {
                sole[0] = FS[k][i * 3]; sole[1] = FS[k][i * 3 + 1]; sole[2] = FS[k][i * 3 + 2];
                Noob.footFrame(sole, FY[k][i], FP[k][i], null, footQ[k], ankle[k]);
                Noob.getRot(w, J.HIPS, q);
                const axis = Noob.kneeAxis([0, 0, 0], footQ[k], q);
                Noob.ikLeg(pose, w, k, ankle[k], axis, footQ[k]);
                contact[i * 2 + k] = STANCE[k][i] && Math.abs(FP[k][i]) < 4 * D ? 1 : 0;
            }
            hipsOut[i * 3] = pose.hips[0]; hipsOut[i * 3 + 1] = pose.hips[1]; hipsOut[i * 3 + 2] = pose.hips[2];
            rotOut.set(pose.rot, i * 60);
        }
        return { n, X, Z, TH, S, hips: hipsOut, rot: rotOut, contact };
    },

    // ---- признаки ------------------------------------------------------------------------------------
    computeFeatures(c) {
        const n = this.n, F = this.F;
        const feat = this.feat = new Float32Array(n * F);
        const pose = Noob.newPose(), w = Noob.newWorld(), id = [0, 0, 0, 1], zero = [0, 0, 0];
        // положения суставов (стопы, таз) в системе корня каждого кадра
        const loc = new Float32Array(n * 9);
        for (let i = 0; i < n; i++) {
            this.samplePoseAt(i, pose);
            Noob.fk(pose, zero, id, w);
            const J = Noob.J;
            for (const [s, j] of [[0, J.ANL], [1, J.ANR], [2, J.HIPS]]) {
                loc[i * 9 + s * 3] = w.pos[j * 3]; loc[i * 9 + s * 3 + 1] = w.pos[j * 3 + 1]; loc[i * 9 + s * 3 + 2] = w.pos[j * 3 + 2];
            }
        }
        const world = (i, s, o) => {   // мировое положение сустава s кадра i
            const th = this.rootYaw[i], cs = Math.cos(th), sn = Math.sin(th);
            const lx = loc[i * 9 + s * 3], ly = loc[i * 9 + s * 3 + 1], lz = loc[i * 9 + s * 3 + 2];
            // Ry(−θ)·(x, y, z): x' = x cos θ − z sin θ, z' = x sin θ + z cos θ
            o[0] = this.rootX[i] + lx * cs - lz * sn; o[1] = ly; o[2] = this.rootZ[i] + lx * sn + lz * cs;
            return o;
        };
        const a = [0, 0, 0], b = [0, 0, 0];
        for (const tk of this.takes) {
            for (let i = tk.start; i < tk.end; i++) {
                const o = i * F, th = this.rootYaw[i], cs = Math.cos(th), sn = Math.sin(th);
                for (let s = 0; s < 2; s++) { feat[o + s * 3] = loc[i * 9 + s * 3]; feat[o + s * 3 + 1] = loc[i * 9 + s * 3 + 1]; feat[o + s * 3 + 2] = loc[i * 9 + s * 3 + 2]; }
                const i0 = Math.max(tk.start, i - 1), i1 = Math.min(tk.end - 1, i + 1), inv = this.FPS / Math.max(1, i1 - i0);
                for (let s = 0; s < 3; s++) {
                    world(i0, s, a); world(i1, s, b);
                    const vx = (b[0] - a[0]) * inv, vy = (b[1] - a[1]) * inv, vz = (b[2] - a[2]) * inv;
                    // в систему корня: Ry(θ)
                    const k = o + 6 + s * 3;
                    feat[k] = vx * cs + vz * sn; feat[k + 1] = vy; feat[k + 2] = -vx * sn + vz * cs;
                }
                for (let t = 0; t < 3; t++) {
                    const j = Math.min(tk.end - 1, i + this.TRAJ[t]);
                    const dx = this.rootX[j] - this.rootX[i], dz = this.rootZ[j] - this.rootZ[i];
                    feat[o + 15 + t * 2] = dx * cs + dz * sn; feat[o + 15 + t * 2 + 1] = -dx * sn + dz * cs;
                    const dth = this.rootYaw[j] - th;
                    feat[o + 21 + t * 2] = Math.cos(dth); feat[o + 21 + t * 2 + 1] = Math.sin(dth);
                }
            }
        }
        // нормировка: среднее по измерению, разброс — по группе / вес группы
        const groups = [[0, 6, c.wFootPos], [6, 12, c.wFootVel], [12, 15, c.wHipVel], [15, 21, c.wTrajPos], [21, 27, c.wTrajDir]];
        const mean = new Float64Array(F), sd = new Float64Array(F);
        for (let i = 0; i < n; i++) for (let d = 0; d < F; d++) mean[d] += feat[i * F + d];
        for (let d = 0; d < F; d++) mean[d] /= n;
        for (let i = 0; i < n; i++) for (let d = 0; d < F; d++) { const e = feat[i * F + d] - mean[d]; sd[d] += e * e; }
        for (let d = 0; d < F; d++) sd[d] = Math.sqrt(sd[d] / n);
        this.fOffset = new Float32Array(F); this.fScale = new Float32Array(F);
        for (const [g0, g1, wt] of groups) {
            let m = 0;
            for (let d = g0; d < g1; d++) m += sd[d];
            m = m / (g1 - g0) || 1;
            for (let d = g0; d < g1; d++) { this.fOffset[d] = mean[d]; this.fScale[d] = m / Math.max(1e-4, wt); }
        }
        for (let i = 0; i < n; i++) for (let d = 0; d < F; d++) feat[i * F + d] = (feat[i * F + d] - this.fOffset[d]) / this.fScale[d];
    },

    // Нормировать вектор запроса на месте.
    normalize(q) { for (let d = 0; d < this.F; d++) q[d] = (q[d] - this.fOffset[d]) / this.fScale[d]; return q; },

    // Лучший кадр для запроса (нормированного). skip(i) — исключить кадр. -> { index, cost }
    search(q, out, skipFrom, skipTo) {
        const F = this.F, feat = this.feat, valid = this.valid, n = this.n;
        let best = -1, bestCost = Infinity;
        for (let i = 0; i < n; i++) {
            if (!valid[i] || (i >= skipFrom && i < skipTo)) continue;
            const o = i * F;
            let cost = 0;
            for (let d = 0; d < F; d++) {
                const e = q[d] - feat[o + d];
                cost += e * e;
                if (cost >= bestCost) break;
            }
            if (cost < bestCost) { bestCost = cost; best = i; }
        }
        out.index = best; out.cost = bestCost;
        return out;
    },

    // Стоимость кадра i для запроса (для решения «остаться ли на текущем»).
    costAt(q, i) {
        const F = this.F, o = i * F;
        let cost = 0;
        for (let d = 0; d < F; d++) { const e = q[d] - this.feat[o + d]; cost += e * e; }
        return cost;
    },

    takeOf(i) { return this.takes[this.take[i]]; },

    // ---- выборка ---------------------------------------------------------------------------------------
    samplePoseAt(i, pose) {
        pose.hips[0] = this.hips[i * 3]; pose.hips[1] = this.hips[i * 3 + 1]; pose.hips[2] = this.hips[i * 3 + 2];
        for (let k = 0; k < 60; k++) pose.rot[k] = this.rot[i * 60 + k];
        return pose;
    },
    // Поза в дробном кадре f (внутри дубля): таз — линейно, повороты — nlerp короткой дугой.
    samplePose(f, pose) {
        const i0 = Math.floor(f), tk = this.takeOf(i0), i1 = Math.min(tk.end - 1, i0 + 1), t = f - i0;
        const H = this.hips, Rr = this.rot;
        for (let k = 0; k < 3; k++) pose.hips[k] = H[i0 * 3 + k] + (H[i1 * 3 + k] - H[i0 * 3 + k]) * t;
        for (let j = 0; j < 15; j++) {
            const a = i0 * 60 + j * 4, b = i1 * 60 + j * 4;
            let bx = Rr[b], by = Rr[b + 1], bz = Rr[b + 2], bw = Rr[b + 3];
            if (Rr[a] * bx + Rr[a + 1] * by + Rr[a + 2] * bz + Rr[a + 3] * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
            let x = Rr[a] + (bx - Rr[a]) * t, y = Rr[a + 1] + (by - Rr[a + 1]) * t, z = Rr[a + 2] + (bz - Rr[a + 2]) * t, w = Rr[a + 3] + (bw - Rr[a + 3]) * t;
            const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
            pose.rot[j * 4] = x / l; pose.rot[j * 4 + 1] = y / l; pose.rot[j * 4 + 2] = z / l; pose.rot[j * 4 + 3] = w / l;
        }
        return pose;
    },
    // Корень в дробном кадре: { x, z, yaw }.
    sampleRoot(f, o) {
        const i0 = Math.floor(f), tk = this.takeOf(i0), i1 = Math.min(tk.end - 1, i0 + 1), t = f - i0;
        o.x = this.rootX[i0] + (this.rootX[i1] - this.rootX[i0]) * t;
        o.z = this.rootZ[i0] + (this.rootZ[i1] - this.rootZ[i0]) * t;
        o.yaw = this.rootYaw[i0] + GM.wrap(this.rootYaw[i1] - this.rootYaw[i0]) * t;
        return o;
    },
};
