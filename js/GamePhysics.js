// GamePhysics.js — небольшой физический мир игры (без внешних библиотек: инвариант «ноль зависимостей»).
// Тела: 'static' (стены, площадки), 'kinematic' (едут и крутятся по своей функции: лифты, маятники),
// 'dynamic' (ящики-коробки и мячи-сферы: масса, инерция, трение, отскок, сон).
// Персонаж — особое тело-капсула (без вращения), его силы задаёт контроллер (GameCharacter.js) через
// preStep(h) на каждом подшаге. Земля карты — аналитическое поле высот Terrain3D.fieldHeight (одно на всех
// устройствах, инвариант 4).
// Контакты: точки коробки (углы и середины рёбер) внутри другой коробки, сфера — ближайшая точка, капсула —
// ближайшие точки отрезка и коробки. Решатель — последовательные импульсы (нормаль + трение по Кулону),
// позиционная поправка смещением скорости (Baumgarte). Шаг фиксированный, 1/120 с.
// Единицы: px (1 м = 100 px), с, масса в «кг».

class PBody {
    constructor(o) {
        this.type = o.type || 'static';
        this.shape = o.shape || 'box';
        this.half = o.half ? [o.half[0], o.half[1], o.half[2]] : [50, 50, 50];
        this.r = o.r || 0;
        this.pos = o.pos ? [o.pos[0], o.pos[1], o.pos[2]] : [0, 0, 0];
        this.q = o.q ? [o.q[0], o.q[1], o.q[2], o.q[3]] : [0, 0, 0, 1];
        this.vel = [0, 0, 0];
        this.ang = [0, 0, 0];
        this.friction = o.friction != null ? o.friction : 0.6;
        this.restitution = o.restitution != null ? o.restitution : 0.1;
        this.tag = o.tag || '';
        this.mesh = o.mesh || null;
        /** @type {((t: number, b: PBody) => void) | null} */
        this.anim = o.anim || null;
        this.R = new Float64Array(9);
        this.aabb = new Float64Array(6);
        this.sleep = false;
        this.startAsleep = false;
        this.sleepT = 0;
        this.invMass = 0;
        this.invI = [0, 0, 0];
        this.mass = 0;
        this.linDamp = o.linDamp != null ? o.linDamp : 0.05;
        this.angDamp = o.angDamp != null ? o.angDamp : 0.35;
        this.user = o.user || null;
        this.home = { pos: this.pos.slice(), q: this.q.slice() };
        if (this.type === 'dynamic') {
            const m = this.mass = o.mass || 20;
            this.invMass = 1 / m;
            if (this.shape === 'sphere') {
                const I = 0.4 * m * this.r * this.r;
                this.invI = [1 / I, 1 / I, 1 / I];
            } else {
                const sx = this.half[0] * 2, sy = this.half[1] * 2, sz = this.half[2] * 2;
                this.invI = [12 / (m * (sy * sy + sz * sz)), 12 / (m * (sx * sx + sz * sz)), 12 / (m * (sx * sx + sy * sy))];
            }
        }
        this.updateDerived();
    }

    updateDerived() {
        const R = this.R, q = this.q;
        const x = q[0], y = q[1], z = q[2], w = q[3];
        // столбцы: локальные X, Y, Z в мире
        R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y + w * z); R[2] = 2 * (x * z - w * y);
        R[3] = 2 * (x * y - w * z); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z + w * x);
        R[6] = 2 * (x * z + w * y); R[7] = 2 * (y * z - w * x); R[8] = 1 - 2 * (x * x + y * y);
        const a = this.aabb, p = this.pos;
        if (this.shape === 'sphere') {
            a[0] = p[0] - this.r; a[1] = p[1] - this.r; a[2] = p[2] - this.r;
            a[3] = p[0] + this.r; a[4] = p[1] + this.r; a[5] = p[2] + this.r;
        } else {
            const h = this.half;
            for (let i = 0; i < 3; i++) {
                const e = Math.abs(R[i]) * h[0] + Math.abs(R[3 + i]) * h[1] + Math.abs(R[6 + i]) * h[2];
                a[i] = p[i] - e; a[3 + i] = p[i] + e;
            }
        }
    }

    // мир -> локальные оси тела (без сдвига)
    toLocal(o, v) {
        const R = this.R, x = v[0] - this.pos[0], y = v[1] - this.pos[1], z = v[2] - this.pos[2];
        o[0] = R[0] * x + R[1] * y + R[2] * z; o[1] = R[3] * x + R[4] * y + R[5] * z; o[2] = R[6] * x + R[7] * y + R[8] * z;
        return o;
    }
    toWorld(o, l) {
        const R = this.R, x = l[0], y = l[1], z = l[2];
        o[0] = this.pos[0] + R[0] * x + R[3] * y + R[6] * z; o[1] = this.pos[1] + R[1] * x + R[4] * y + R[7] * z; o[2] = this.pos[2] + R[2] * x + R[5] * y + R[8] * z;
        return o;
    }
    // I⁻¹ в мире · v
    invInertia(o, v) {
        if (this.invMass === 0 || this.shape === 'capsule') { o[0] = 0; o[1] = 0; o[2] = 0; return o; }
        const R = this.R, I = this.invI;
        const l0 = (R[0] * v[0] + R[1] * v[1] + R[2] * v[2]) * I[0];
        const l1 = (R[3] * v[0] + R[4] * v[1] + R[5] * v[2]) * I[1];
        const l2 = (R[6] * v[0] + R[7] * v[1] + R[8] * v[2]) * I[2];
        o[0] = R[0] * l0 + R[3] * l1 + R[6] * l2; o[1] = R[1] * l0 + R[4] * l1 + R[7] * l2; o[2] = R[2] * l0 + R[5] * l1 + R[8] * l2;
        return o;
    }
    // скорость точки p (мир)
    pointVel(o, p) {
        const rx = p[0] - this.pos[0], ry = p[1] - this.pos[1], rz = p[2] - this.pos[2], w = this.ang;
        o[0] = this.vel[0] + w[1] * rz - w[2] * ry;
        o[1] = this.vel[1] + w[2] * rx - w[0] * rz;
        o[2] = this.vel[2] + w[0] * ry - w[1] * rx;
        return o;
    }
    applyImpulse(P, p) {
        if (this.invMass === 0) return;
        this.vel[0] += P[0] * this.invMass; this.vel[1] += P[1] * this.invMass; this.vel[2] += P[2] * this.invMass;
        if (this.shape !== 'capsule') {
            const rx = p[0] - this.pos[0], ry = p[1] - this.pos[1], rz = p[2] - this.pos[2];
            const t = Phys._t3;
            t[0] = ry * P[2] - rz * P[1]; t[1] = rz * P[0] - rx * P[2]; t[2] = rx * P[1] - ry * P[0];
            this.invInertia(t, t);
            this.ang[0] += t[0]; this.ang[1] += t[1]; this.ang[2] += t[2];
        }
        this.wake();
    }
    wake() { if (this.sleep) { this.sleep = false; this.sleepT = 0; } }
}

/** @satisfies {Record<string, any>} */
const Phys = {
    /** @type {PBody[]} */ bodies: [],
    /** @type {PBody[]} */ dynamics: [],
    /** @type {PBody[]} */ solids: [],      // статические и кинематические
    /** @type {any} */ terrain: null,
    /** @type {any} */ character: null,     // { body: PBody (capsule), a, b, rc, preStep(h), postStep(h) }
    gravity: 1200,
    step: 1 / 120,
    acc: 0,
    time: 0,
    contacts: [],
    nContacts: 0,
    iterations: 10,
    /** @type {number[][] | null} */ _boxPts: null,
    _t3: [0, 0, 0], _a: [0, 0, 0], _b: [0, 0, 0], _c: [0, 0, 0], _d: [0, 0, 0], _e: [0, 0, 0], _l: [0, 0, 0],

    cfg() {
        const U = 'undefined';
        return {
            gravity: typeof NOOB_GRAVITY !== U ? NOOB_GRAVITY : 1200,
            iterations: typeof PHYS_ITERATIONS !== U ? PHYS_ITERATIONS : 10,
        };
    },

    reset(terrain) {
        this.bodies = []; this.dynamics = []; this.solids = [];
        this.terrain = terrain || null;
        this.character = null;
        this.acc = 0; this.time = 0;
        const c = this.cfg();
        this.gravity = c.gravity; this.iterations = c.iterations;
    },

    add(o) {
        const b = new PBody(o);
        this.bodies.push(b);
        if (b.type === 'dynamic') this.dynamics.push(b); else this.solids.push(b);
        return b;
    },
    remove(b) {
        for (const list of [this.bodies, this.dynamics, this.solids]) { const i = list.indexOf(b); if (i >= 0) list.splice(i, 1); }
    },

    // ---- земля ---------------------------------------------------------------------------------
    groundY(x, z) { return this.terrain ? this.terrain.fieldHeight(x, z) : 0; },
    groundN(o, x, z) {
        const e = 8, hx = this.groundY(x + e, z) - this.groundY(x - e, z), hz = this.groundY(x, z + e) - this.groundY(x, z - e);
        o[0] = -hx / (2 * e); o[1] = 1; o[2] = -hz / (2 * e);
        return GM.norm(o, o);
    },

    // ---- шаг -------------------------------------------------------------------------------------
    update(dt) {
        this.acc = Math.min(this.acc + dt, this.step * 6);
        let n = 0;
        while (this.acc >= this.step) {
            this.substep(this.step);
            this.acc -= this.step;
            n++;
        }
        return n;
    },

    substep(h) {
        this.time += h;
        const g = this.gravity;
        // кинематика
        for (const b of this.solids) {
            if (b.type !== 'kinematic' || !b.anim) continue;
            const p0 = this._a, q0 = [b.q[0], b.q[1], b.q[2], b.q[3]];
            GM.copy(p0, b.pos);
            b.anim(this.time, b);
            b.vel[0] = (b.pos[0] - p0[0]) / h; b.vel[1] = (b.pos[1] - p0[1]) / h; b.vel[2] = (b.pos[2] - p0[2]) / h;
            GM.qangvel(b.ang, b.q, q0, h);
            b.updateDerived();
        }
        // силы
        for (const b of this.dynamics) {
            if (b.sleep) continue;
            b.vel[1] -= g * h;
            const ld = Math.max(0, 1 - b.linDamp * h), ad = Math.max(0, 1 - b.angDamp * h);
            b.vel[0] *= ld; b.vel[1] *= ld; b.vel[2] *= ld;
            b.ang[0] *= ad; b.ang[1] *= ad; b.ang[2] *= ad;
        }
        const ch = this.character;
        if (ch && ch.enabled) ch.preStep(h);
        // контакты
        this.nContacts = 0;
        this.detect();
        if (ch && ch.enabled && ch.preSolve) ch.preSolve(h);
        this.solve(h);
        // интегрирование
        for (const b of this.dynamics) {
            if (b.sleep) continue;
            b.pos[0] += b.vel[0] * h; b.pos[1] += b.vel[1] * h; b.pos[2] += b.vel[2] * h;
            const w = b.ang, q = b.q;
            const dx = 0.5 * h * (w[0] * q[3] + w[1] * q[2] - w[2] * q[1]);
            const dy = 0.5 * h * (w[1] * q[3] + w[2] * q[0] - w[0] * q[2]);
            const dz = 0.5 * h * (w[2] * q[3] + w[0] * q[1] - w[1] * q[0]);
            const dw = 0.5 * h * (-w[0] * q[0] - w[1] * q[1] - w[2] * q[2]);
            q[0] += dx; q[1] += dy; q[2] += dz; q[3] += dw;
            GM.qnorm(q, q);
            b.updateDerived();
            // сон
            const v2 = b.vel[0] * b.vel[0] + b.vel[1] * b.vel[1] + b.vel[2] * b.vel[2];
            const w2 = w[0] * w[0] + w[1] * w[1] + w[2] * w[2];
            if (v2 < 16 && w2 < 0.01) { b.sleepT += h; if (b.sleepT > 0.7) { b.sleep = true; GM.set(b.vel, 0, 0, 0); GM.set(b.ang, 0, 0, 0); } }
            else b.sleepT = 0;
            if (b.pos[1] < -3000) { this.respawnBody(b); }
        }
        if (ch && ch.enabled) {
            const cb = ch.body;
            cb.pos[0] += cb.vel[0] * h; cb.pos[1] += cb.vel[1] * h; cb.pos[2] += cb.vel[2] * h;
            cb.updateDerived();
            ch.postStep(h);
        }
    },

    // Вернуть тело на место; уложенные стопки (ящики) спят, пока их не толкнут.
    respawnBody(b) {
        GM.copy(b.pos, b.home.pos); GM.qcopy(b.q, b.home.q);
        GM.set(b.vel, 0, 0, 0); GM.set(b.ang, 0, 0, 0);
        b.updateDerived(); b.sleep = !!b.startAsleep; b.sleepT = 0;
    },

    // ---- поиск контактов -----------------------------------------------------------------------
    _overlap(a, b, pad) {
        const A = a.aabb, B = b.aabb;
        return A[0] - pad <= B[3] && A[3] + pad >= B[0] && A[1] - pad <= B[4] && A[4] + pad >= B[1] && A[2] - pad <= B[5] && A[5] + pad >= B[2];
    },

    detect() {
        const D = this.dynamics, S = this.solids;
        for (let i = 0; i < D.length; i++) {
            const a = D[i];
            if (!a.sleep) this.vsTerrain(a);
            for (const s of S) {
                if (a.sleep && s.type === 'static') continue;
                if (this._overlap(a, s, 1)) this.pair(a, s);
            }
            for (let j = i + 1; j < D.length; j++) {
                const b = D[j];
                if (a.sleep && b.sleep) continue;
                if (this._overlap(a, b, 1)) this.pair(a, b);
            }
        }
        const ch = this.character;
        if (ch && ch.enabled) {
            const cb = ch.body;
            ch.contacts.length = 0;
            for (const s of S) if (this._overlap(cb, s, 2)) this.capsulePair(ch, s);
            for (const b of D) if (this._overlap(cb, b, 2)) this.capsulePair(ch, b);
            this.capsuleTerrain(ch);
        }
    },

    _contact() {
        let c = this.contacts[this.nContacts];
        if (!c) {
            c = { a: null, b: null, n: [0, 0, 0], p: [0, 0, 0], depth: 0, ra: [0, 0, 0], rb: [0, 0, 0], t1: [0, 0, 0], t2: [0, 0, 0], mn: 0, mt1: 0, mt2: 0, jn: 0, jt1: 0, jt2: 0, bias: 0, mu: 0, target: 0 };
            this.contacts.push(c);
        }
        this.nContacts++;
        return c;
    },
    addContact(a, b, n, p, depth) {
        const c = this._contact();
        c.a = a; c.b = b; GM.copy(c.n, n); GM.copy(c.p, p); c.depth = depth;
        return c;
    },

    pair(a, b) {
        if (a.shape === 'box' && b.shape === 'box') {
            this.pointsInBox(a, b, false);
            if (b.type === 'dynamic' || Math.max(b.half[0], b.half[1], b.half[2]) < 2.5 * Math.max(a.half[0], a.half[1], a.half[2])) this.pointsInBox(b, a, true);
        } else if (a.shape === 'sphere' && b.shape === 'sphere') {
            const d = GM.sub(this._a, a.pos, b.pos), L = GM.len(d), rr = a.r + b.r;
            if (L < rr && L > 1e-6) {
                GM.scale(d, d, 1 / L);
                const p = GM.adds(this._b, b.pos, d, b.r);
                this.addContact(a, b, d, p, rr - L);
            }
        } else if (a.shape === 'sphere') this.sphereBox(a, b, false);
        else this.sphereBox(b, a, true);
    },

    // Углы и середины рёбер коробки A внутри коробки B. flip: контакт пишется для пары (B, A) — B толкается.
    pointsInBox(A, B, flip) {
        const h = A.half, l = this._l, p = this._c, n = this._d;
        const pts = Phys._boxPts || (Phys._boxPts = (() => {
            const out = [];
            for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
                const k = Math.abs(x) + Math.abs(y) + Math.abs(z);
                if (k >= 2) out.push([x, y, z]);   // 8 углов + 12 рёбер
            }
            return out;
        })());
        const bh = B.half;
        for (const s of pts) {
            l[0] = s[0] * h[0]; l[1] = s[1] * h[1]; l[2] = s[2] * h[2];
            A.toWorld(p, l);
            const lb = B.toLocal(this._e, p);
            const dx = bh[0] - Math.abs(lb[0]), dy = bh[1] - Math.abs(lb[1]), dz = bh[2] - Math.abs(lb[2]);
            if (dx <= 0 || dy <= 0 || dz <= 0) continue;
            let ax = 0, d = dx;
            if (dy < d) { ax = 1; d = dy; }
            if (dz < d) { ax = 2; d = dz; }
            const sg = lb[ax] >= 0 ? 1 : -1, R = B.R;
            n[0] = R[ax * 3] * sg; n[1] = R[ax * 3 + 1] * sg; n[2] = R[ax * 3 + 2] * sg;
            if (!flip) this.addContact(A, B, n, p, d);
            else { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; this.addContact(B, A, n, p, d); }
        }
    },

    // Сфера S и коробка B. flip: пара (B, S).
    sphereBox(S, B, flip) {
        const l = B.toLocal(this._l, S.pos), h = B.half, cp = this._c;
        cp[0] = GM.clamp(l[0], -h[0], h[0]); cp[1] = GM.clamp(l[1], -h[1], h[1]); cp[2] = GM.clamp(l[2], -h[2], h[2]);
        const dx = l[0] - cp[0], dy = l[1] - cp[1], dz = l[2] - cp[2], L = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const n = this._d, p = this._e, R = B.R;
        let depth;
        if (L > 1e-6) {
            if (L >= S.r) return;
            const ux = dx / L, uy = dy / L, uz = dz / L;
            n[0] = R[0] * ux + R[3] * uy + R[6] * uz; n[1] = R[1] * ux + R[4] * uy + R[7] * uz; n[2] = R[2] * ux + R[5] * uy + R[8] * uz;
            B.toWorld(p, cp);
            depth = S.r - L;
        } else {
            let ax = 0, d = h[0] - Math.abs(l[0]);
            for (let k = 1; k < 3; k++) { const e = h[k] - Math.abs(l[k]); if (e < d) { d = e; ax = k; } }
            const sg = l[ax] >= 0 ? 1 : -1;
            n[0] = R[ax * 3] * sg; n[1] = R[ax * 3 + 1] * sg; n[2] = R[ax * 3 + 2] * sg;
            GM.copy(p, S.pos);
            depth = S.r + d;
        }
        if (!flip) this.addContact(S, B, n, p, depth);
        else { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; const pp = GM.adds(this._a, p, n, 0); this.addContact(B, S, n, pp, depth); }
    },

    vsTerrain(a) {
        if (!this.terrain) return;
        const n = this._d, p = this._c, l = this._l;
        if (a.shape === 'sphere') {
            const gy = this.groundY(a.pos[0], a.pos[2]);
            if (a.pos[1] - a.r < gy) {
                this.groundN(n, a.pos[0], a.pos[2]);
                GM.set(p, a.pos[0], gy, a.pos[2]);
                this.addContact(a, null, n, p, (gy - (a.pos[1] - a.r)) * n[1]);
            }
            return;
        }
        if (a.aabb[1] > this.groundY(a.pos[0], a.pos[2]) + 40) return;
        const h = a.half;
        for (let s = 0; s < 8; s++) {
            l[0] = (s & 1 ? 1 : -1) * h[0]; l[1] = (s & 2 ? 1 : -1) * h[1]; l[2] = (s & 4 ? 1 : -1) * h[2];
            a.toWorld(p, l);
            const gy = this.groundY(p[0], p[2]);
            if (p[1] < gy) {
                this.groundN(n, p[0], p[2]);
                this.addContact(a, null, n, p, (gy - p[1]) * n[1]);
            }
        }
    },

    // ---- капсула персонажа ------------------------------------------------------------------------
    capsulePair(ch, B) {
        const cb = ch.body, rc = ch.rc;
        const p0 = this._a, p1 = this._b;
        GM.set(p0, cb.pos[0], cb.pos[1] + ch.a, cb.pos[2]);
        GM.set(p1, cb.pos[0], cb.pos[1] + ch.b, cb.pos[2]);
        const n = this._d, p = this._e;
        if (B.shape === 'sphere') {
            const t = GM.clamp((B.pos[1] - p0[1]) / (p1[1] - p0[1]), 0, 1);
            const sx = p0[0], sy = p0[1] + (p1[1] - p0[1]) * t, sz = p0[2];
            const dx = sx - B.pos[0], dy = sy - B.pos[1], dz = sz - B.pos[2], L = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (L >= rc + B.r || L < 1e-6) return;
            GM.set(n, dx / L, dy / L, dz / L);
            GM.set(p, B.pos[0] + n[0] * B.r, B.pos[1] + n[1] * B.r, B.pos[2] + n[2] * B.r);
            const c = this.addContact(cb, B, n, p, rc + B.r - L);
            ch.contacts.push(c);
            return;
        }
        // отрезок в осях коробки, чередование ближайших точек
        const s0 = B.toLocal(this._l, p0), s1 = B.toLocal(this._c, p1);
        const s0x = s0[0], s0y = s0[1], s0z = s0[2], ux = s1[0] - s0x, uy = s1[1] - s0y, uz = s1[2] - s0z;
        const uu = ux * ux + uy * uy + uz * uz || 1, h = B.half;
        let t = 0.5, cx = 0, cy = 0, cz = 0, sx = 0, sy = 0, sz = 0;
        for (let it = 0; it < 4; it++) {
            sx = s0x + ux * t; sy = s0y + uy * t; sz = s0z + uz * t;
            cx = GM.clamp(sx, -h[0], h[0]); cy = GM.clamp(sy, -h[1], h[1]); cz = GM.clamp(sz, -h[2], h[2]);
            t = GM.clamp(((cx - s0x) * ux + (cy - s0y) * uy + (cz - s0z) * uz) / uu, 0, 1);
        }
        sx = s0x + ux * t; sy = s0y + uy * t; sz = s0z + uz * t;
        cx = GM.clamp(sx, -h[0], h[0]); cy = GM.clamp(sy, -h[1], h[1]); cz = GM.clamp(sz, -h[2], h[2]);
        const dx = sx - cx, dy = sy - cy, dz = sz - cz, L = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const R = B.R;
        let depth;
        const lc = this._l;
        if (L > 1e-6) {
            if (L >= rc) return;
            const vx = dx / L, vy = dy / L, vz = dz / L;
            n[0] = R[0] * vx + R[3] * vy + R[6] * vz; n[1] = R[1] * vx + R[4] * vy + R[7] * vz; n[2] = R[2] * vx + R[5] * vy + R[8] * vz;
            depth = rc - L;
        } else {
            const ll = [sx, sy, sz];
            let ax = 0, d = h[0] - Math.abs(sx);
            for (let k = 1; k < 3; k++) { const e = h[k] - Math.abs(ll[k]); if (e < d) { d = e; ax = k; } }
            const sg = ll[ax] >= 0 ? 1 : -1;
            n[0] = R[ax * 3] * sg; n[1] = R[ax * 3 + 1] * sg; n[2] = R[ax * 3 + 2] * sg;
            depth = rc + d;
        }
        lc[0] = cx; lc[1] = cy; lc[2] = cz;
        B.toWorld(p, lc);
        const c = this.addContact(cb, B, n, p, depth);
        ch.contacts.push(c);
    },

    capsuleTerrain(ch) {
        if (!this.terrain) return;
        const cb = ch.body, rc = ch.rc;
        const x = cb.pos[0], z = cb.pos[2], y = cb.pos[1] + ch.a;
        const gy = this.groundY(x, z);
        if (y - rc >= gy) return;
        const n = this.groundN(this._d, x, z);
        const p = GM.set(this._e, x, gy, z);
        const c = this.addContact(cb, null, n, p, (gy - (y - rc)) * n[1]);
        ch.contacts.push(c);
    },

    // ---- решатель --------------------------------------------------------------------------------
    solve(h) {
        const N = this.nContacts, C = this.contacts;
        const va = this._a, vb = this._b, t = this._c, u = this._e;
        for (let k = 0; k < N; k++) {
            const c = C[k], a = c.a, b = c.b, n = c.n;
            GM.sub(c.ra, c.p, a.pos);
            if (b) GM.sub(c.rb, c.p, b.pos); else GM.set(c.rb, 0, 0, 0);
            // касательные
            if (Math.abs(n[0]) > 0.57) GM.set(t, n[1], -n[0], 0); else GM.set(t, 0, n[2], -n[1]);
            GM.norm(c.t1, t); GM.cross(c.t2, n, c.t1);
            c.mn = 1 / this.effMass(a, b, c.ra, c.rb, n);
            c.mt1 = 1 / this.effMass(a, b, c.ra, c.rb, c.t1);
            c.mt2 = 1 / this.effMass(a, b, c.ra, c.rb, c.t2);
            c.mu = Math.sqrt(a.friction * (b ? b.friction : 0.8));
            a.pointVel(va, c.p);
            if (b) b.pointVel(vb, c.p); else GM.set(vb, 0, 0, 0);
            const vn = (va[0] - vb[0]) * n[0] + (va[1] - vb[1]) * n[1] + (va[2] - vb[2]) * n[2];
            const e = Math.max(a.restitution, b ? b.restitution : 0.05);
            const bounce = vn < -90 ? -e * vn : 0;
            const bias = Math.min(500, 0.25 / h * Math.max(0, c.depth - 0.4));
            c.target = Math.max(bounce, bias);
            c.jn = 0; c.jt1 = 0; c.jt2 = 0;
            // разбудить спящих от удара или скольжения соседа
            const vrel = Math.hypot(va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]);
            if (b && b.sleep && a.invMass > 0 && !a.sleep && vrel > 6) b.wake();
            if (a.sleep && b && (b.type === 'kinematic' || (!b.sleep && b.invMass > 0)) && vrel > 6) a.wake();
        }
        const P = this._d;
        for (let it = 0; it < this.iterations; it++) {
            for (let k = 0; k < N; k++) {
                const c = C[k], a = c.a, b = c.b, n = c.n;
                if (a.sleep && (!b || b.sleep || b.invMass === 0)) continue;
                a.pointVel(va, c.p);
                if (b) b.pointVel(vb, c.p); else GM.set(vb, 0, 0, 0);
                const rx = va[0] - vb[0], ry = va[1] - vb[1], rz = va[2] - vb[2];
                const vn = rx * n[0] + ry * n[1] + rz * n[2];
                let lam = c.mn * (c.target - vn);
                const jn = Math.max(0, c.jn + lam);
                lam = jn - c.jn; c.jn = jn;
                GM.scale(P, n, lam);
                this.impulse(a, b, P, c.p);
                // трение
                const lim = c.mu * c.jn;
                for (let tt = 0; tt < 2; tt++) {
                    const tv = tt ? c.t2 : c.t1;
                    a.pointVel(va, c.p);
                    if (b) b.pointVel(vb, c.p); else GM.set(vb, 0, 0, 0);
                    const vt = (va[0] - vb[0]) * tv[0] + (va[1] - vb[1]) * tv[1] + (va[2] - vb[2]) * tv[2];
                    const m = tt ? c.mt2 : c.mt1;
                    const old = tt ? c.jt2 : c.jt1;
                    const nj = GM.clamp(old - m * vt, -lim, lim);
                    const l2 = nj - old;
                    if (tt) c.jt2 = nj; else c.jt1 = nj;
                    GM.scale(P, tv, l2);
                    this.impulse(a, b, P, c.p);
                }
            }
        }
        void u;
    },

    impulse(a, b, P, p) {
        const t = this._t3;
        if (a.invMass > 0) {
            a.vel[0] += P[0] * a.invMass; a.vel[1] += P[1] * a.invMass; a.vel[2] += P[2] * a.invMass;
            if (a.shape !== 'capsule') {
                const rx = p[0] - a.pos[0], ry = p[1] - a.pos[1], rz = p[2] - a.pos[2];
                t[0] = ry * P[2] - rz * P[1]; t[1] = rz * P[0] - rx * P[2]; t[2] = rx * P[1] - ry * P[0];
                a.invInertia(t, t);
                a.ang[0] += t[0]; a.ang[1] += t[1]; a.ang[2] += t[2];
            }
        }
        if (b && b.invMass > 0) {
            b.vel[0] -= P[0] * b.invMass; b.vel[1] -= P[1] * b.invMass; b.vel[2] -= P[2] * b.invMass;
            if (b.shape !== 'capsule') {
                const rx = p[0] - b.pos[0], ry = p[1] - b.pos[1], rz = p[2] - b.pos[2];
                t[0] = ry * P[2] - rz * P[1]; t[1] = rz * P[0] - rx * P[2]; t[2] = rx * P[1] - ry * P[0];
                b.invInertia(t, t);
                b.ang[0] -= t[0]; b.ang[1] -= t[1]; b.ang[2] -= t[2];
            }
        }
    },

    effMass(a, b, ra, rb, n) {
        const t = this._t3;
        let k = a.invMass + (b ? b.invMass : 0);
        if (a.invMass > 0 && a.shape !== 'capsule') {
            GM.cross(t, ra, n); a.invInertia(t, t); GM.cross(t, t, ra); k += GM.dot(t, n);
        }
        if (b && b.invMass > 0 && b.shape !== 'capsule') {
            GM.cross(t, rb, n); b.invInertia(t, t); GM.cross(t, t, rb); k += GM.dot(t, n);
        }
        return Math.max(k, 1e-9);
    },

    // ---- запросы -------------------------------------------------------------------------------------
    // Луч вниз из (x, yTop, z) на maxDist: ближайшая опора { y, n, body, t } или null. skip — тело, которое не считать.
    rayDown(x, z, yTop, maxDist, skip, out) {
        let best = maxDist, hitB = null;
        const n = out.n || (out.n = [0, 1, 0]);
        let nx = 0, ny = 1, nz = 0;
        if (this.terrain) {
            const gy = this.groundY(x, z), t = yTop - gy;
            if (t >= 0 && t < best) { best = t; hitB = 'terrain'; }
        }
        const o = this._a, l = this._l;
        for (const list of [this.solids, this.dynamics]) {
            for (const b of list) {
                if (b === skip) continue;
                const A = b.aabb;
                if (x < A[0] || x > A[3] || z < A[2] || z > A[5] || A[1] > yTop || A[4] < yTop - best) continue;
                if (b.shape === 'sphere') {
                    const dx = x - b.pos[0], dz = z - b.pos[2], d2 = dx * dx + dz * dz;
                    if (d2 > b.r * b.r) continue;
                    const top = b.pos[1] + Math.sqrt(b.r * b.r - d2), t = yTop - top;
                    if (t >= 0 && t < best) { best = t; hitB = b; nx = dx / b.r; ny = (top - b.pos[1]) / b.r; nz = dz / b.r; }
                    continue;
                }
                // луч в осях коробки: начало и направление (0, −1, 0)
                GM.set(o, x, yTop, z);
                b.toLocal(l, o);
                const R = b.R, dl = [-R[1], -R[4], -R[7]], h = b.half;
                let t0 = -Infinity, t1 = Infinity, ax = -1, sg = 0;
                let miss = false;
                for (let k = 0; k < 3; k++) {
                    if (Math.abs(dl[k]) < 1e-9) { if (Math.abs(l[k]) > h[k]) { miss = true; break; } continue; }
                    let ta = (-h[k] - l[k]) / dl[k], tb = (h[k] - l[k]) / dl[k], s = -1;
                    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; s = 1; }
                    if (ta > t0) { t0 = ta; ax = k; sg = dl[k] > 0 ? -1 : 1; }
                    if (tb < t1) t1 = tb;
                    void s;
                }
                if (miss || t0 > t1 || t1 < 0 || ax < 0) continue;
                const t = Math.max(0, t0);
                if (t < best) {
                    best = t; hitB = b;
                    nx = R[ax * 3] * sg; ny = R[ax * 3 + 1] * sg; nz = R[ax * 3 + 2] * sg;
                }
            }
        }
        if (!hitB) return null;
        out.t = best; out.y = yTop - best;
        if (hitB === 'terrain') { this.groundN(n, x, z); out.body = null; }
        else { n[0] = nx; n[1] = ny; n[2] = nz; out.body = hitB; }
        return out;
    },

    // Луч o + d·t (d единичный) до maxT: { t, body } | null — камера. Тонкие (меньше minSize) и динамические — по флагу.
    ray(o, d, maxT, withDynamic) {
        let best = maxT, hit = null;
        const l = this._l, dl = this._c;
        for (const list of withDynamic ? [this.solids, this.dynamics] : [this.solids]) {
            for (const b of list) {
                if (b.user && b.user.noCamera) continue;
                if (b.shape === 'sphere') {
                    const ox = o[0] - b.pos[0], oy = o[1] - b.pos[1], oz = o[2] - b.pos[2];
                    const bb = ox * d[0] + oy * d[1] + oz * d[2], cc = ox * ox + oy * oy + oz * oz - b.r * b.r, disc = bb * bb - cc;
                    if (disc < 0) continue;
                    const t = -bb - Math.sqrt(disc);
                    if (t > 0 && t < best) { best = t; hit = b; }
                    continue;
                }
                b.toLocal(l, o);
                const R = b.R, h = b.half;
                dl[0] = R[0] * d[0] + R[1] * d[1] + R[2] * d[2]; dl[1] = R[3] * d[0] + R[4] * d[1] + R[5] * d[2]; dl[2] = R[6] * d[0] + R[7] * d[1] + R[8] * d[2];
                let t0 = 0, t1 = best, miss = false;
                for (let k = 0; k < 3; k++) {
                    if (Math.abs(dl[k]) < 1e-9) { if (Math.abs(l[k]) > h[k]) { miss = true; break; } continue; }
                    let ta = (-h[k] - l[k]) / dl[k], tb = (h[k] - l[k]) / dl[k];
                    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
                    if (ta > t0) t0 = ta;
                    if (tb < t1) t1 = tb;
                    if (t0 > t1) { miss = true; break; }
                }
                if (miss) continue;
                if (t0 < best && t0 > 0) { best = t0; hit = b; }
            }
        }
        // земля: шагами + уточнение
        if (this.terrain) {
            const step = 30;
            let prev = 0;
            for (let t = step; t < best; t += step) {
                const y = o[1] + d[1] * t, gy = this.groundY(o[0] + d[0] * t, o[2] + d[2] * t);
                if (y < gy) {
                    let a = prev, b2 = t;
                    for (let k = 0; k < 6; k++) { const m = (a + b2) / 2; if (o[1] + d[1] * m < this.groundY(o[0] + d[0] * m, o[2] + d[2] * m)) b2 = m; else a = m; }
                    best = a; hit = 'terrain';
                    break;
                }
                prev = t;
            }
        }
        return hit ? { t: best, body: hit === 'terrain' ? null : hit } : null;
    },

    // Сфера (частица рэгдолла) против мира: вытолкнуть, вернуть нормаль и тело касания (или null).
    // out = { n, body, depth } | null
    pushSphere(p, r, out) {
        let hit = null, maxDepth = 0;
        const n = out.n || (out.n = [0, 0, 0]);
        if (this.terrain) {
            const gy = this.groundY(p[0], p[2]);
            if (p[1] - r < gy) {
                const gn = this.groundN(this._d, p[0], p[2]), d = (gy - (p[1] - r)) * gn[1];
                p[0] += gn[0] * d; p[1] += gn[1] * d; p[2] += gn[2] * d;
                GM.copy(n, gn); hit = 'terrain'; maxDepth = d;
            }
        }
        const l = this._l, cp = this._c;
        for (const list of [this.solids, this.dynamics]) {
            for (const b of list) {
                const A = b.aabb;
                if (p[0] + r < A[0] || p[0] - r > A[3] || p[1] + r < A[1] || p[1] - r > A[4] || p[2] + r < A[2] || p[2] - r > A[5]) continue;
                let nx, ny, nz, d;
                if (b.shape === 'sphere') {
                    const dx = p[0] - b.pos[0], dy = p[1] - b.pos[1], dz = p[2] - b.pos[2], L = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (L >= r + b.r || L < 1e-6) continue;
                    nx = dx / L; ny = dy / L; nz = dz / L; d = r + b.r - L;
                } else {
                    b.toLocal(l, p);
                    const h = b.half;
                    cp[0] = GM.clamp(l[0], -h[0], h[0]); cp[1] = GM.clamp(l[1], -h[1], h[1]); cp[2] = GM.clamp(l[2], -h[2], h[2]);
                    const dx = l[0] - cp[0], dy = l[1] - cp[1], dz = l[2] - cp[2], L = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    const R = b.R;
                    if (L > 1e-6) {
                        if (L >= r) continue;
                        const ux = dx / L, uy = dy / L, uz = dz / L;
                        nx = R[0] * ux + R[3] * uy + R[6] * uz; ny = R[1] * ux + R[4] * uy + R[7] * uz; nz = R[2] * ux + R[5] * uy + R[8] * uz;
                        d = r - L;
                    } else {
                        let ax = 0, e = h[0] - Math.abs(l[0]);
                        for (let k = 1; k < 3; k++) { const ee = h[k] - Math.abs(l[k]); if (ee < e) { e = ee; ax = k; } }
                        const sg = l[ax] >= 0 ? 1 : -1;
                        nx = R[ax * 3] * sg; ny = R[ax * 3 + 1] * sg; nz = R[ax * 3 + 2] * sg; d = r + e;
                    }
                }
                if (b.type === 'dynamic') {
                    // делим поправку по массам (частица ~ 6 кг)
                    const share = b.invMass / (b.invMass + 1 / 6);
                    const P = this._e; GM.set(P, -nx * d * 6 * 30, -ny * d * 6 * 30, -nz * d * 6 * 30);
                    b.applyImpulse(P, p);
                    d *= 1 - share;
                }
                p[0] += nx * d; p[1] += ny * d; p[2] += nz * d;
                if (d > maxDepth) { maxDepth = d; GM.set(n, nx, ny, nz); hit = b; }
            }
        }
        if (!hit) return null;
        out.body = hit === 'terrain' ? null : hit;
        out.depth = maxDepth;
        return out;
    },
};
