// GameMotion.js — Motion Matching в рантайме: поза Нуба каждый кадр.
//
// Поток кадра (update):
//  1. Режим: 'mm' (по земле — Motion Matching), 'air' (полёт — процедурная поза по вертикальной скорости),
//     'getup' (подъём после рэгдолла), 'ragdoll' (части ставит физика — GameRagdoll.js).
//  2. MM: раз в NOOB_MM_SEARCH_INTERVAL с (или сразу при резкой смене ввода, конце дубля, приземлении)
//     запрос = признаки позы ТЕКУЩЕГО кадра базы + прогноз траектории физической капсулы (та же пружина
//     скорости и курса, что в базе) в системе анимационного корня -> лучший кадр базы. Переход —
//     инерциализацией (Holden): смещение «старая поза − новая» и его скорость затухают критической пружиной.
//  3. Root motion: анимационный корень едет по корню базы, затем подтягивается к физике (не больше доли
//     собственной скорости — ноги не скользят) и не отходит дальше NOOB_MM_MAX_ERROR px.
//  4. Слои поверх: просадка при приземлении (пружина), «живая» вторичная физика корпуса, головы и рук
//     по ускорениям, толкание ящиков, голова смотрит туда же, куда камера.
//  5. Ноги: стопы опускаются на землю под ними (лестницы, склоны), опорная стопа «прилипает» (foot locking),
//     таз проседает, если ногу иначе не дотянуть, — затем IK и поворот стопы по нормали земли.

class MotionController {
    constructor(model) {
        this.db = MotionDB;
        this.model = model;
        this.base = Noob.newPose();       // источник кадра (база / процедурная поза)
        this.blend = Noob.newPose();      // источник + затухающие смещения инерциализации
        this.prevBlend = Noob.newPose();
        this.pose = Noob.newPose();       // итог кадра (со слоями)
        this.tmp = Noob.newPose();
        this.tmp2 = Noob.newPose();
        this.world = Noob.newWorld();
        this.offHips = new Float64Array(6);
        this.offRot = new Float64Array(15 * 6);
        this.cur = 0;
        this.char = { pos: [0, 0, 0], yaw: 0, vel: [0, 0, 0] };
        this.mode = 'mm';
        this.modeT = 0;
        this.searchT = 0;
        this.lastDt = 1 / 60;
        this.lastDesired = [0, 0];
        this.locks = [0, 1].map(() => ({ on: false, pos: [0, 0, 0], off: new Float64Array(6), body: null }));
        this.pelvisDrop = 0;
        this.land = new Float64Array(2);
        this.sec = new Float64Array(20);
        this.aFast = [0, 0, 0]; this.aSlow = [0, 0, 0];
        this.prevCharVel = [0, 0, 0];
        this.look = { yaw: 0, pitch: 0 };
        this.pushW = 0;
        this.takeoffLeg = 0;
        this.getup = { faceDown: true, T: 1.25 };
        this.q = new Float32Array(MotionDB.F);
        this.res = { index: 0, cost: 0 };
        this.debug = { index: 0, take: '', cost: 0, searches: 0, transitions: 0, ms: 0, mode: 'mm' };
        /** @type {Float32Array | null} */
        this.dbgTraj = null;
        this.footEvents = [];             // стопа коснулась земли: { side, x, y, z, speed }
        this._prevContact = [1, 1];
        this._r0 = { x: 0, z: 0, yaw: 0 }; this._r1 = { x: 0, z: 0, yaw: 0 };
        this._v = [0, 0, 0]; this._v2 = [0, 0, 0]; this._q = [0, 0, 0, 1]; this._q2 = [0, 0, 0, 1]; this._q3 = [0, 0, 0, 1];
        this._rootQ = [0, 0, 0, 1];
        this.cfg = MotionController.cfg();
        this.body = Noob.BODY1;            // растяжение тела (рост, ширина): шаг и IK масштабируются
        this.reset([0, 0, 0], 0);
    }

    static cfg() {
        const U = 'undefined';
        return {
            searchInterval: typeof NOOB_MM_SEARCH_INTERVAL !== U ? NOOB_MM_SEARCH_INTERVAL : 0.1,
            blendHalflife: typeof NOOB_MM_BLEND_HALFLIFE !== U ? NOOB_MM_BLEND_HALFLIFE : 0.1,
            adjHalflife: typeof NOOB_MM_ADJUST_HALFLIFE !== U ? NOOB_MM_ADJUST_HALFLIFE : 0.1,
            adjRatio: typeof NOOB_MM_ADJUST_RATIO !== U ? NOOB_MM_ADJUST_RATIO : 0.5,
            maxError: typeof NOOB_MM_MAX_ERROR !== U ? NOOB_MM_MAX_ERROR : 15,
            footLock: typeof NOOB_MM_FOOT_LOCK !== U ? NOOB_MM_FOOT_LOCK : 1,
            secondary: typeof NOOB_SECONDARY !== U ? NOOB_SECONDARY : 1,
            lookAtCamera: typeof NOOB_LOOK_AT_CAMERA !== U ? NOOB_LOOK_AT_CAMERA : 1,
        };
    }

    // Кадр «стойка» из базы — для сброса.
    idleFrame() {
        const t = this.db.takes.find(k => k.name === 'idle') || this.db.takes[0];
        return t.start + Math.floor((t.end - t.start) * 0.4);
    }

    reset(pos, yaw) {
        GM.copy(this.char.pos, pos);
        this.char.yaw = yaw;
        GM.set(this.char.vel, 0, 0, 0);
        this.mode = 'mm'; this.modeT = 0;
        if (this.db.ready) {
            this.cur = this.idleFrame();
            this.db.samplePose(this.cur, this.base);
        }
        Noob.copyPose(this.blend, this.base); Noob.copyPose(this.prevBlend, this.base); Noob.copyPose(this.pose, this.base);
        this.offHips.fill(0); this.offRot.fill(0);
        for (const L of this.locks) { L.on = false; L.off.fill(0); }
        this.land.fill(0); this.sec.fill(0); this.pelvisDrop = 0;
        this.searchT = 0;
    }

    // ---- инерциализация ------------------------------------------------------------------------
    // Переход к позе dst со скоростями dstVel ({ hips: [3], rot: Float64Array(45) }).
    transition(dst, dstVel) {
        const inv = 1 / Math.max(1e-3, this.lastDt), q = this._q, q2 = this._q2, v = this._v, v2 = this._v2;
        for (let k = 0; k < 3; k++) {
            this.offHips[k * 2] = this.blend.hips[k] - dst.hips[k];
            this.offHips[k * 2 + 1] = (this.blend.hips[k] - this.prevBlend.hips[k]) * inv - (dstVel ? dstVel.hips[k] : 0);
        }
        for (let j = 0; j < 15; j++) {
            Noob.getLocal(this.blend, j, q); Noob.getLocal(dst, j, q2);
            GM.qmulinv(this._q3, q, q2); GM.qabs(this._q3, this._q3); GM.qlog(v, this._q3);
            Noob.getLocal(this.prevBlend, j, q2);
            GM.qangvel(v2, q, q2, this.lastDt);
            for (let a = 0; a < 3; a++) {
                this.offRot[(j * 3 + a) * 2] = v[a];
                this.offRot[(j * 3 + a) * 2 + 1] = v2[a] - (dstVel ? dstVel.rot[j * 3 + a] : 0);
            }
        }
        this.debug.transitions++;
    }

    // Скорости позы базы в кадре i (по соседнему кадру).
    dbVel(i, out) {
        const tk = this.db.takeOf(i), i1 = Math.min(tk.end - 1, i + 1), i0 = i1 - 1;
        const H = this.db.hips, Rr = this.db.rot, fps = this.db.FPS, a = this._q, b = this._q2, v = this._v;
        for (let k = 0; k < 3; k++) out.hips[k] = (H[i1 * 3 + k] - H[i0 * 3 + k]) * fps;
        for (let j = 0; j < 15; j++) {
            for (let k = 0; k < 4; k++) { a[k] = Rr[i0 * 60 + j * 4 + k]; b[k] = Rr[i1 * 60 + j * 4 + k]; }
            GM.qangvel(v, b, a, 1 / fps);
            out.rot[j * 3] = v[0]; out.rot[j * 3 + 1] = v[1]; out.rot[j * 3 + 2] = v[2];
        }
        return out;
    }

    // Источник + смещения -> blend; смещения затухают.
    compose(dt, halflife) {
        for (let k = 0; k < 3; k++) {
            GM.decay(this.offHips, k * 2, halflife, dt);
            this.blend.hips[k] = this.base.hips[k] + this.offHips[k * 2];
        }
        const v = this._v, q = this._q, q2 = this._q2;
        for (let j = 0; j < 15; j++) {
            for (let a = 0; a < 3; a++) { GM.decay(this.offRot, (j * 3 + a) * 2, halflife, dt); v[a] = this.offRot[(j * 3 + a) * 2]; }
            GM.qexp(q, v);
            Noob.getLocal(this.base, j, q2);
            GM.qmul(q, q, q2); GM.qnorm(q, q);
            Noob.setLocal(this.blend, j, q);
        }
    }

    // ---- запрос MM -------------------------------------------------------------------------------
    buildQuery(ch) {
        const db = this.db, F = db.F, q = this.q, i = Math.floor(this.cur);
        for (let d = 0; d < 15; d++) q[d] = db.feat[i * F + d];
        const cy = Math.cos(this.char.yaw), sy = Math.sin(this.char.yaw);
        const gx = ch.groundVel[0], gz = ch.groundVel[2];
        for (let t = 0; t < 3; t++) {
            const T = db.TRAJ[t] / db.FPS;
            const sx = { v: ch.sx.v, a: ch.sx.a }, sz = { v: ch.sz.v, a: ch.sz.a };
            const dx = GM.springChar(sx, ch.desired[0], ch.hlVel, T) + gx * T;
            const dz = GM.springChar(sz, ch.desired[1], ch.hlVel, T) + gz * T;
            const rx = ch.pos[0] + dx - this.char.pos[0], rz = ch.pos[2] + dz - this.char.pos[2];
            const iL = 1 / this.body.leg;
            q[15 + t * 2] = (rx * cy + rz * sy) * iL; q[15 + t * 2 + 1] = (-rx * sy + rz * cy) * iL;
            const fa = { x: ch.facing.x, v: ch.facing.v };
            GM.springAngle(fa, ch.facingGoal, ch.hlRot, T);
            const dth = fa.x - this.char.yaw;
            q[21 + t * 2] = Math.cos(dth); q[21 + t * 2 + 1] = Math.sin(dth);
        }
        const dt = this.dbgTraj || (this.dbgTraj = new Float32Array(6));
        for (let d = 0; d < 6; d++) dt[d] = q[15 + d];
        for (let d = 15; d < F; d++) q[d] = (q[d] - db.fOffset[d]) / db.fScale[d];
        return q;
    }

    // Поиск лучшего кадра. always — переход в любом случае (из полёта, подъёма): поза сейчас не из базы.
    search(ch, always) {
        const t0 = performance.now(), db = this.db;
        const q = this.buildQuery(ch);
        const i = Math.floor(this.cur);
        const curCost = db.valid[i] ? db.costAt(q, i) : Infinity;
        db.search(q, this.res, -1, -1);
        this.debug.searches++;
        this.debug.ms = performance.now() - t0;
        const best = this.res.index;
        if (best < 0) return;
        const near = best >= i && best - i < 12 && db.take[best] === db.take[i];
        if (always || (!near && this.res.cost < curCost - 0.01) || !db.valid[i]) {
            this.db.samplePose(best, this.tmp);
            this.transition(this.tmp, this.dbVel(best, this._dv || (this._dv = { hips: [0, 0, 0], rot: new Float64Array(45) })));
            this.cur = best;
        }
        this.debug.cost = Math.min(curCost, this.res.cost);
        this.debug.index = Math.floor(this.cur);
        this.debug.take = db.takeOf(Math.floor(this.cur)).name;
    }

    // ---- процедурные позы ------------------------------------------------------------------------
    airPose(ch, out) {
        const D = GM.DEG, J = Noob.J;
        const up = GM.clamp(ch.vel[1] / 450, -1.2, 1);
        const rise = GM.smooth((up + 0.25) / 1.0), fall = 1 - rise;
        const hs = Math.hypot(ch.vel[0] - ch.groundVel[0], ch.vel[2] - ch.groundVel[2]);
        const run = GM.smooth((hs - 120) / 200);
        const long = GM.smooth((ch.airTime - 0.75) / 0.5);
        const t = this.modeT, fl = Math.sin(t * 13), fl2 = Math.sin(t * 11 + 1.3);
        out.hips[0] = 0; out.hips[1] = 70; out.hips[2] = 0;
        GM.qeuler(this._q, 0, (-6 * rise + 4 * fall - 6 * run * rise) * D, 0); Noob.setLocal(out, J.HIPS, this._q);
        GM.qeuler(this._q, 0, (-8 * rise - 2 * fall + 6 * long) * D, 0); Noob.setLocal(out, J.WAIST, this._q);
        GM.qeuler(this._q, 0, (6 * rise - 8 * fall) * D, 0); Noob.setLocal(out, J.NECK, this._q);
        for (let k = 0; k < 2; k++) {
            const side = k ? 1 : -1, lead = k !== this.takeoffLeg;
            // ноги: толчковая отстаёт, маховая поднята; к приземлению обе готовятся
            const hipR = lead ? GM.lerp(35, 62, run) : GM.lerp(35, -18, run);
            const kneeR = lead ? GM.lerp(-60, -88, run) : GM.lerp(-60, -38, run);
            const hipF = lead ? 24 : 6, kneeF = lead ? -32 : -26;
            const hip = GM.lerp(hipF, hipR, rise) + long * 10 * (lead ? fl : -fl);
            const knee = GM.lerp(kneeF, kneeR, rise) - long * 12 * Math.abs(lead ? fl2 : fl);
            GM.qeuler(this._q, 0, hip * D, side * -3 * D); Noob.setLocal(out, k ? J.HIPR : J.HIPL, this._q);
            GM.qeuler(this._q, 0, knee * D, 0); Noob.setLocal(out, k ? J.KNR : J.KNL, this._q);
            GM.qeuler(this._q, 0, (-18 * rise + 6 * fall) * D, 0); Noob.setLocal(out, k ? J.ANR : J.ANL, this._q);
            // руки: на взлёте вверх-вперёд (против ног), в падении — в стороны; долгое падение — вверх, как в Roblox
            const armRun = lead ? -22 : 48;
            const pitchA = GM.lerp(GM.lerp(28, armRun, run), 22, fall);
            const pitch = GM.lerp(pitchA, 150 + 12 * (k ? fl : fl2), long);
            const roll = GM.lerp(GM.lerp(18, 10, run), 52, fall) * (1 - long * 0.6) + long * 12;
            GM.qeuler(this._q, 0, pitch * D, -side * roll * D); Noob.setLocal(out, k ? J.SHR : J.SHL, this._q);
            GM.qeuler(this._q, 0, GM.lerp(GM.lerp(25, 70, run), 32, fall) * (1 - long * 0.7) * D, 0); Noob.setLocal(out, k ? J.ELR : J.ELL, this._q);
            GM.qeuler(this._q, 0, 0, 0); Noob.setLocal(out, k ? J.WRR : J.WRL, this._q);
        }
        return out;
    }

    // Подъём после падения: сидя на корточках с упором руками -> стойка. Ноги — IK к стопам в системе корня.
    getupPose(t, out) {
        const D = GM.DEG, J = Noob.J, T = this.getup.T;
        const u = GM.clamp(t / T, 0, 1), s = GM.smoother(u), s2 = GM.smoother((u - 0.15) / 0.85);
        out.hips[0] = GM.lerp(-6, 0, s); out.hips[1] = GM.lerp(34, 72.8, s2); out.hips[2] = 0;
        GM.qeuler(this._q, 0, -GM.lerp(48, 0, s) * D, 0); Noob.setLocal(out, J.HIPS, this._q);
        GM.qeuler(this._q, 0, -GM.lerp(22, 2, s) * D, 0); Noob.setLocal(out, J.WAIST, this._q);
        GM.qeuler(this._q, 0, GM.lerp(42, 0, s) * D, 0); Noob.setLocal(out, J.NECK, this._q);
        for (let k = 0; k < 2; k++) {
            const side = k ? 1 : -1;
            const push = 1 - GM.smooth((u - 0.1) / 0.45);
            GM.qeuler(this._q, 0, GM.lerp(4, 68, push) * D, -side * GM.lerp(6, 14, push) * D); Noob.setLocal(out, k ? J.SHR : J.SHL, this._q);
            GM.qeuler(this._q, 0, GM.lerp(10, 18, push) * D, 0); Noob.setLocal(out, k ? J.ELR : J.ELL, this._q);
            GM.qeuler(this._q, 0, 0, 0); Noob.setLocal(out, k ? J.WRR : J.WRL, this._q);
        }
        // стопы: шаг вразножку -> вместе
        const sole = [0, 0, 0], fq = [0, 0, 0, 1], ank = [0, 0, 0];
        const B = this.body;
        Noob.fk(out, [0, 0, 0], [0, 0, 0, 1], this.world, B);
        for (let k = 0; k < 2; k++) {
            const side = k ? 1 : -1;
            sole[0] = GM.lerp(k ? -12 : 12, 0, GM.smooth((u - 0.55) / 0.4)) * B.leg; sole[1] = 0; sole[2] = side * 15 * B.wide;
            Noob.footFrame(sole, 0, 0, null, fq, ank, B);
            Noob.ikLeg(out, this.world, k, ank, [0, 0, 1], fq, B);
        }
        return out;
    }

    // ---- переходы режимов ------------------------------------------------------------------------
    enterAir(ch) {
        this.mode = 'air'; this.modeT = 0;
        // толчковая — та, что дольше на земле (последний контакт)
        const i = Math.floor(this.cur), c = this.db.contact;
        this.takeoffLeg = c[i * 2] && !c[i * 2 + 1] ? 0 : !c[i * 2] && c[i * 2 + 1] ? 1 : this.takeoffLeg ^ 1;
        this.airPose(ch, this.tmp);
        this.transition(this.tmp, null);
        for (const L of this.locks) this.unlock(L, null);
    }

    enterGround(ch, impact) {
        this.mode = 'mm'; this.modeT = 0;
        this.search(ch, true);
        // пружина просадки таза: чем сильнее удар, тем глубже
        this.land[1] += GM.clamp(impact * 0.62, 0, 720);
        this.searchT = this.cfg.searchInterval;
    }

    // Из рэгдолла: поза по мировым частям -> подъём.
    enterGetup(ch, ragWorld, faceDown, yaw) {
        this.mode = 'getup'; this.modeT = 0;
        this.getup.faceDown = faceDown;
        this.char.yaw = yaw;
        const hp = Noob.getPos(ragWorld, Noob.J.HIPS, [0, 0, 0]);
        GM.set(this.char.pos, hp[0], ch.pos[1], hp[2]);
        // локальная поза рэгдолла = текущая (скорость ноль)
        const rq = GM.qheading(this._rootQ, yaw);
        GM.sub(this._v, hp, this.char.pos);
        GM.qinvrot(this.blend.hips, rq, this._v);
        this.blend.hips[0] /= this.body.hx; this.blend.hips[1] /= this.body.hy; this.blend.hips[2] /= this.body.hz;
        const w = ragWorld;
        for (let j = 0; j < 15; j++) Noob.storeLocal(this.blend, w, j, rq);
        Noob.copyPose(this.prevBlend, this.blend);
        this.getupPose(0, this.tmp);
        this.transition(this.tmp, null);
        for (const L of this.locks) { L.on = false; L.off.fill(0); }
        this.land.fill(0);
        this.pelvisDrop = 0;
    }

    unlock(L, target) {
        if (!L.on) return;
        L.on = false;
        if (target) { for (let a = 0; a < 3; a++) { L.off[a * 2] = L.pos[a] - target[a]; L.off[a * 2 + 1] = 0; } }
        else L.off.fill(0);
    }

    // ---- кадр ------------------------------------------------------------------------------------
    update(dt, ch) {
        if (!this.db.ready) return;
        dt = Math.max(1e-4, dt);
        this.footEvents.length = 0;
        if (ch.ragdoll) { this.mode = 'ragdoll'; this.debug.mode = 'ragdoll'; return; }
        this.modeT += dt;
        const c = this.cfg;
        // режимы
        if (this.mode === 'mm' && !ch.grounded && (ch.airTime > 0.07 || ch.jumpT < 0.15)) this.enterAir(ch);
        else if (this.mode === 'air' && ch.grounded) this.enterGround(ch, ch.impact);
        else if (this.mode === 'getup' && this.modeT >= this.getup.T) {
            this.mode = 'mm'; this.modeT = 0;
            this.cur = this.idleFrame();
            this.search(ch, true);
        } else if (this.mode === 'ragdoll') {
            this.mode = 'mm';
        }
        this.debug.mode = this.mode;

        let halflife = c.blendHalflife;
        const rootQ = this._rootQ;
        if (this.mode === 'mm') {
            // поиск: по таймеру, при резкой смене ввода, у конца дубля
            const d = ch.desired, ld = this.lastDesired;
            const m0 = Math.hypot(ld[0], ld[1]), m1 = Math.hypot(d[0], d[1]);
            let changed = Math.abs(m1 - m0) > 0.25 * MotionDB.cfg().sprint;
            if (!changed && m0 > 20 && m1 > 20) changed = Math.abs(GM.wrap(Math.atan2(d[1], d[0]) - Math.atan2(ld[1], ld[0]))) > 30 * GM.DEG;
            const i = Math.floor(this.cur), tk = this.db.takeOf(i);
            const nearEnd = i + 2 >= tk.end - 1 || !this.db.valid[i];
            this.searchT -= dt;
            if (this.searchT <= 0 || changed || nearEnd) {
                this.search(ch, false);
                this.searchT = c.searchInterval;
                ld[0] = d[0]; ld[1] = d[1];
            }
            // проигрывание с лёгкой подгонкой темпа под скорость физики
            const i2 = Math.floor(this.cur), tk2 = this.db.takeOf(i2);
            const animSp = this.db.speed[i2], simSp = Math.hypot(ch.vel[0] - ch.groundVel[0], ch.vel[2] - ch.groundVel[2]);
            const rate = animSp > 60 && simSp > 60 ? GM.clamp(simSp / animSp, 0.9, 1.1) : 1;
            const r0 = this.db.sampleRoot(this.cur, this._r0);
            const next = Math.min(tk2.end - 1.001, this.cur + dt * this.db.FPS * rate);
            const r1 = this.db.sampleRoot(next, this._r1);
            this.cur = next;
            // root motion: смещение в системе корня базы -> в мир персонажа
            const cs0 = Math.cos(r0.yaw), sn0 = Math.sin(r0.yaw), dx = r1.x - r0.x, dz = r1.z - r0.z;
            const lx = dx * cs0 + dz * sn0, lz = -dx * sn0 + dz * cs0;
            const cy = Math.cos(this.char.yaw), sy = Math.sin(this.char.yaw);
            const L = this.body.leg, mx = (lx * cy - lz * sy) * L, mz = (lx * sy + lz * cy) * L;
            this.char.pos[0] += mx; this.char.pos[2] += mz;
            const dyaw = GM.wrap(r1.yaw - r0.yaw);
            this.char.yaw = GM.wrap(this.char.yaw + dyaw + ch.groundSpin * dt);
            this.char.pos[0] += ch.groundVel[0] * dt; this.char.pos[2] += ch.groundVel[2] * dt;
            // подстройка к физике (Holden: adjustment by velocity + clamping)
            const ex = ch.pos[0] - this.char.pos[0], ez = ch.pos[2] - this.char.pos[2];
            const k = GM.damperK(c.adjHalflife, dt);
            let ax = ex * k, az = ez * k;
            const lim = c.adjRatio * Math.hypot(mx, mz) + 0.02 * dt * 60;
            const al = Math.hypot(ax, az);
            if (al > lim) { ax *= lim / al; az *= lim / al; }
            this.char.pos[0] += ax; this.char.pos[2] += az;
            const eyaw = GM.wrap(ch.facing.x - this.char.yaw);
            let ay = eyaw * GM.damperK(c.adjHalflife * 2, dt);
            const liml = 2.0 * Math.abs(dyaw) + 0.008 * dt * 60;
            ay = GM.clamp(ay, -liml, liml);
            this.char.yaw = GM.wrap(this.char.yaw + ay);
            this.clampToSim(ch, c.maxError * this.body.leg, 70 * GM.DEG);
            this.db.samplePose(this.cur, this.base);
        } else if (this.mode === 'air') {
            this.airPose(ch, this.base);
            halflife = 0.12;
            const k = GM.damperK(0.05, dt);
            this.char.pos[0] += (ch.pos[0] - this.char.pos[0]) * k + ch.vel[0] * dt * (1 - k);
            this.char.pos[2] += (ch.pos[2] - this.char.pos[2]) * k + ch.vel[2] * dt * (1 - k);
            this.char.yaw = GM.wrap(this.char.yaw + GM.wrap(ch.facing.x - this.char.yaw) * GM.damperK(0.08, dt));
            this.clampToSim(ch, c.maxError, 70 * GM.DEG);
        } else if (this.mode === 'getup') {
            this.getupPose(this.modeT, this.base);
            halflife = 0.22;
            const k = GM.damperK(0.25, dt);
            this.char.pos[0] += (ch.pos[0] - this.char.pos[0]) * k;
            this.char.pos[2] += (ch.pos[2] - this.char.pos[2]) * k;
        }
        // высота корня — за физикой (капсула «парит» на пружине над землёй)
        const yk = GM.damperK(this.mode === 'air' ? 0.01 : 0.04, dt);
        this.char.pos[1] += (ch.pos[1] - this.char.pos[1]) * yk;
        if (Math.abs(ch.pos[1] - this.char.pos[1]) > 40) this.char.pos[1] = ch.pos[1] + Math.sign(this.char.pos[1] - ch.pos[1]) * 40;

        // инерциализация
        Noob.copyPose(this.prevBlend, this.blend);
        this.compose(dt, halflife);
        Noob.copyPose(this.pose, this.blend);
        this.lastDt = dt;

        // скорость и ускорение анимационного корня (для вторичной физики)
        const cv = this.char.vel;
        const vx = (this.char.pos[0] - (this._lastPos ? this._lastPos[0] : this.char.pos[0])) / dt;
        const vy = ch.vel[1];
        const vz = (this.char.pos[2] - (this._lastPos ? this._lastPos[2] : this.char.pos[2])) / dt;
        this._lastPos = this._lastPos || [0, 0, 0];
        GM.copy(this._lastPos, this.char.pos);
        const ax = (vx - cv[0]) / dt, ayv = (vy - cv[1]) / dt, az = (vz - cv[2]) / dt;
        GM.set(cv, vx, vy, vz);
        const kf = GM.damperK(0.03, dt), ks = GM.damperK(0.35, dt);
        this.aFast[0] += (ax - this.aFast[0]) * kf; this.aFast[1] += (ayv - this.aFast[1]) * kf; this.aFast[2] += (az - this.aFast[2]) * kf;
        for (let k = 0; k < 3; k++) this.aSlow[k] += (this.aFast[k] - this.aSlow[k]) * ks;

        this.layers(dt, ch);
        // мир, ноги
        GM.qheading(rootQ, this.char.yaw);
        Noob.fk(this.pose, this.char.pos, rootQ, this.world, this.body);
        if (this.mode !== 'air') this.feet(dt, ch, rootQ);
        Noob.apply(this.model, this.world, this.body);
    }

    clampToSim(ch, maxErr, maxAng) {
        const ex = this.char.pos[0] - ch.pos[0], ez = this.char.pos[2] - ch.pos[2], e = Math.hypot(ex, ez);
        if (e > maxErr) { this.char.pos[0] = ch.pos[0] + ex / e * maxErr; this.char.pos[2] = ch.pos[2] + ez / e * maxErr; }
        const ey = GM.wrap(this.char.yaw - ch.facing.x);
        if (Math.abs(ey) > maxAng) this.char.yaw = GM.wrap(ch.facing.x + Math.sign(ey) * maxAng);
    }

    // ---- слои ------------------------------------------------------------------------------------
    layers(dt, ch) {
        const D = GM.DEG, J = Noob.J, P = this.pose, q = this._q, q2 = this._q2;
        const add = (j, yaw, pitch, roll) => {
            if (!yaw && !pitch && !roll) return;
            GM.qeuler(q, yaw, pitch, roll);
            Noob.getLocal(P, j, q2);
            GM.qmul(q2, q2, q);
            Noob.setLocal(P, j, q2);
        };
        // приземление: таз проседает и пружинит, корпус клонится, руки сгибаются
        GM.springTo(this.land, 0, 0, 3.0, 0.5, dt);
        const drop = GM.clamp(this.land[0], -6, 34);
        if (Math.abs(drop) > 0.01) {
            P.hips[1] -= drop;
            add(J.WAIST, 0, -drop * 0.7 * D, 0);
            add(J.NECK, 0, drop * 0.45 * D, 0);
            for (const j of [J.SHL, J.SHR]) add(j, 0, drop * 0.5 * D, 0);
            for (const j of [J.ELL, J.ELR]) add(j, 0, drop * 1.1 * D, 0);
        }
        // толкание: руки вперёд, корпус в наклон
        const pk = GM.damperK(0.12, dt);
        this.pushW += ((ch.pushW || 0) - this.pushW) * pk;
        if (this.pushW > 0.01) {
            const w = this.pushW;
            GM.qeuler(q, 0, -14 * D, 0); Noob.getLocal(P, J.WAIST, q2); GM.qslerp(q2, q2, GM.qmul(this._q3, q2, q), w); Noob.setLocal(P, J.WAIST, q2);
            for (let k = 0; k < 2; k++) {
                const side = k ? 1 : -1;
                GM.qeuler(q, 0, 78 * D, -side * 9 * D); Noob.getLocal(P, k ? J.SHR : J.SHL, q2); GM.qslerp(q2, q2, q, w); Noob.setLocal(P, k ? J.SHR : J.SHL, q2);
                GM.qeuler(q, 0, 32 * D, 0); Noob.getLocal(P, k ? J.ELR : J.ELL, q2); GM.qslerp(q2, q2, q, w); Noob.setLocal(P, k ? J.ELR : J.ELL, q2);
            }
        }
        // бой (GameFight.js): стойка — кулаки у лица; замах — локоть назад; удар — прямая рука в цель
        // (aim — угол руки в мире, ° от «вниз»; lean — наклон корпуса к цели); победа — руки вверх
        const fp = ch.fightPose;
        if (fp && (fp.guard > 0.01 || fp.cheer > 0.01)) {
            const g = fp.guard, cw = fp.cheer, w = Math.max(g, cw), lean = fp.lean || 0;
            for (let k = 0; k < 2; k++) {
                const side = k ? 1 : -1, wi = k ? fp.wr : fp.wl, ex = k ? fp.er : fp.el, aim = k ? fp.aimR : fp.aimL;
                let sp = 62, el = 112, rl = 16;
                sp += (26 - sp) * wi; el += (126 - el) * wi; rl += (4 - rl) * wi;
                sp += (aim + lean + 5 * g - sp) * ex; el += (4 - el) * ex; rl += (9 - rl) * ex;
                const bk = fp.block || 0;
                sp += (96 - sp) * bk; el += (132 - el) * bk; rl += (26 - rl) * bk;
                sp += (166 - sp) * cw; el += (22 - el) * cw; rl += (-30 - rl) * cw;
                GM.qeuler(q, 0, sp * D, side * rl * D); Noob.getLocal(P, k ? J.SHR : J.SHL, q2); GM.qslerp(q2, q2, q, w); Noob.setLocal(P, k ? J.SHR : J.SHL, q2);
                GM.qeuler(q, 0, el * D, 0); Noob.getLocal(P, k ? J.ELR : J.ELL, q2); GM.qslerp(q2, q2, q, w); Noob.setLocal(P, k ? J.ELR : J.ELL, q2);
            }
            const tw = ((fp.er - fp.wr * 0.8) - (fp.el - fp.wl * 0.8)) * 22 * D * g;
            const lp = Math.max(fp.er, fp.el) * lean;
            add(J.WAIST, tw, -(5 * g + lp) * D, 0);
            add(J.NECK, -tw * 0.5, lp * 0.6 * D, 0);
        }
        // вторичная физика: пружины по рывкам ускорения (в системе персонажа)
        if (this.cfg.secondary) {
            const cy = Math.cos(this.char.yaw), sy = Math.sin(this.char.yaw);
            const ax = this.aFast[0] - this.aSlow[0], az = this.aFast[2] - this.aSlow[2], ayv = this.aFast[1] - this.aSlow[1];
            const af = ax * cy + az * sy, al = -ax * sy + az * cy;
            const S = this.sec, g = 1 / 1200;
            GM.springTo(S, 0, GM.clamp(af * g * 0.10, -0.25, 0.25), 2.6, 0.42, dt);   // корпус вперёд-назад
            GM.springTo(S, 2, GM.clamp(al * g * 0.08, -0.2, 0.2), 2.4, 0.42, dt);     // корпус вбок
            GM.springTo(S, 4, GM.clamp(-af * g * 0.16 + ayv * g * 0.05, -0.35, 0.35), 3.2, 0.32, dt);  // голова
            GM.springTo(S, 6, GM.clamp(al * g * 0.12, -0.3, 0.3), 3.0, 0.32, dt);
            GM.springTo(S, 8, GM.clamp(-af * g * 0.35, -0.6, 0.6), 2.2, 0.28, dt);    // руки
            GM.springTo(S, 10, GM.clamp(al * g * 0.3 - ayv * g * 0.12, -0.6, 0.6), 2.0, 0.3, dt);
            add(J.WAIST, 0, -S[0], S[2]);
            add(J.NECK, 0, S[4], -S[6]);
            add(J.SHL, 0, S[8], S[10] > 0 ? 0 : -S[10] * 0.9);
            add(J.SHR, 0, S[8], S[10] < 0 ? 0 : -S[10] * 0.9);
            add(J.ELL, 0, Math.abs(S[8]) * 0.5, 0); add(J.ELR, 0, Math.abs(S[8]) * 0.5, 0);
        }
        // голова за камерой (как в Roblox): на месте и шагом сильнее, на бегу слабее
        if (this.cfg.lookAtCamera && ch.camYaw != null) {
            const sp = Math.hypot(this.char.vel[0], this.char.vel[2]);
            const w = (1 - GM.smooth((sp - 120) / 250)) * (this.mode === 'mm' ? 1 : 0.3) * (1 - this.pushW);
            let dy = GM.wrap(ch.camYaw - this.char.yaw);
            if (Math.abs(dy) > 120 * D) dy = 0;   // камера смотрит в лицо — голову не выворачиваем
            const ty = -GM.clamp(dy, -65 * D, 65 * D) * 0.75 * w, tp = GM.clamp(-ch.camPitch, -25 * D, 30 * D) * 0.6 * w;
            const k = GM.damperK(0.12, dt);
            this.look.yaw += (ty - this.look.yaw) * k; this.look.pitch += (tp - this.look.pitch) * k;
            add(J.NECK, this.look.yaw * 0.75, this.look.pitch, 0);
            add(J.WAIST, this.look.yaw * 0.25, 0, 0);
        }
    }

    // ---- стопы ---------------------------------------------------------------------------------
    feet(dt, ch, rootQ) {
        const J = Noob.J, w = this.world, P = this.pose;
        const i = Math.floor(this.cur), db = this.db;
        const tg = [this._ft0 || (this._ft0 = [0, 0, 0]), this._ft1 || (this._ft1 = [0, 0, 0])];
        const fq = [this._fq0 || (this._fq0 = [0, 0, 0, 1]), this._fq1 || (this._fq1 = [0, 0, 0, 1])];
        const nrm = [null, null], need = [0, 0], cont = [0, 0];
        const rootY = this.char.pos[1];
        for (let k = 0; k < 2; k++) {
            const ja = k ? J.ANR : J.ANL;
            Noob.getPos(w, ja, tg[k]); Noob.getRot(w, ja, fq[k]);
            let contact = this.mode === 'getup' ? 1 : (this.mode === 'mm' ? db.contact[i * 2 + k] : 0);
            if (!ch.grounded) contact = 0;
            cont[k] = contact;
            const hit = ch.ground(tg[k][0], tg[k][2], rootY + 60);
            if (hit && ch.grounded) {
                const dy = GM.clamp(hit.y - rootY, -45 * this.body.leg, 50 * this.body.leg);
                tg[k][1] += dy;
                nrm[k] = hit.n;
                const minY = hit.y + this.body.footAnkle[1] * 0.9;   // голеностоп не ниже подошвы на земле
                if (tg[k][1] < minY) tg[k][1] = minY;
            }
            const L = this.locks[k];
            if (this.cfg.footLock && contact && hit && !hit.moving) {
                if (!L.on) {
                    L.on = true;
                    for (let a = 0; a < 3; a++) L.pos[a] = tg[k][a] + L.off[a * 2];
                    L.off.fill(0);
                    if (this.mode === 'mm' && !this._prevContact[k]) this.footEvents.push({ side: k, x: L.pos[0], y: L.pos[1], z: L.pos[2], speed: db.speed[i] });
                } else if (GM.dist(L.pos, tg[k]) > 24 * this.body.leg) this.unlock(L, tg[k]);
                if (L.on) { L.pos[1] = tg[k][1] > L.pos[1] ? L.pos[1] + (tg[k][1] - L.pos[1]) * GM.damperK(0.05, dt) : tg[k][1]; GM.copy(tg[k], L.pos); }
            } else {
                if (L.on) this.unlock(L, tg[k]);
                if (contact && !this._prevContact[k] && this.mode === 'mm' && hit) this.footEvents.push({ side: k, x: tg[k][0], y: tg[k][1], z: tg[k][2], speed: db.speed[i] });
            }
            if (!L.on) {
                for (let a = 0; a < 3; a++) { GM.decay(L.off, a * 2, 0.07, dt); tg[k][a] += L.off[a * 2]; }
            }
            this._prevContact[k] = contact;
            // досягаемость: насколько опустить таз
            const hp = Noob.getPos(w, k ? J.HIPR : J.HIPL, this._v);
            const dh = Math.hypot(hp[0] - tg[k][0], hp[2] - tg[k][2]), LM = this.body.thigh + this.body.shin - 1.5;
            const maxY = tg[k][1] + Math.sqrt(Math.max(0, LM * LM - dh * dh));
            need[k] = Math.max(0, hp[1] - maxY) * (contact ? 1 : 0.6);
        }
        const want = Math.min(40 * this.body.leg, Math.max(need[0], need[1]));
        this.pelvisDrop += (want - this.pelvisDrop) * GM.damperK(want > this.pelvisDrop ? 0.03 : 0.09, dt);
        if (this.pelvisDrop > 0.05) {
            P.hips[1] -= this.pelvisDrop / this.body.hy;
            Noob.fk(P, this.char.pos, rootQ, w, this.body);
        }
        // IK и поворот стоп по земле
        const up = [0, 1, 0], hq = Noob.getRot(w, J.HIPS, this._q);
        for (let k = 0; k < 2; k++) {
            let footQ = fq[k];
            if (nrm[k] && cont[k]) {
                const tilt = GM.qbetween(this._q3, up, nrm[k]);
                footQ = GM.qmul(this._q2, tilt, fq[k]);
            }
            const axis = Noob.kneeAxis(this._v2, fq[k], hq);
            Noob.ikLeg(P, w, k, tg[k], axis, footQ, this.body);
        }
    }
}
