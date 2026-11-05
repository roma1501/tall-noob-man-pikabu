// GameRagdoll.js — рэгдолл Нуба: частицы Верле в суставах (Jakobsen). Торс — жёсткий набор, конечности —
// звенья, колено и локоть не выворачиваются; столкновения частиц — Phys.pushSphere (земля, коробки, мячи).
// Работает с растянутым телом (body из Noob.body): радиусы и массы частиц растут вместе с Нубом.

class NoobRagdoll {
    // world — мировые суставы Нуба (Noob.newWorld), vel — начальная скорость тела.
    constructor(world, vel, spin, body) {
        const BD = body || Noob.BODY1, sc = Math.sqrt(BD.leg * BD.wide);
        this.body = BD;
        const J = Noob.J, gp = (j) => Noob.getPos(world, j, [0, 0, 0]), gr = (j) => Noob.getRot(world, j, [0, 0, 0, 1]);
        const P = [];
        const add = (p, r, m) => { P.push({ p: p.slice(), o: p.slice(), r: r * sc, m: m * BD.leg * BD.wide }); return P.length - 1; };
        const rotate = (q, v) => GM.qrot([0, 0, 0], q, v);
        const hipsQ = gr(J.HIPS), headQ = gr(J.NECK);
        this.i = {};
        const I = this.i;
        I.pelvis = add(gp(J.HIPS), 15, 10);
        I.chest = add(gp(J.NECK), 15, 10);
        I.head = add(GM.add([0, 0, 0], gp(J.NECK), rotate(headQ, [0, BD.partOff[2][1], 0])), 20, 5);
        I.shL = add(gp(J.SHL), 11, 3); I.elL = add(gp(J.ELL), 11, 2);
        I.haL = add(GM.add([0, 0, 0], gp(J.WRL), rotate(gr(J.WRL), [0, -6, 0])), 10, 1.5);
        I.shR = add(gp(J.SHR), 11, 3); I.elR = add(gp(J.ELR), 11, 2);
        I.haR = add(GM.add([0, 0, 0], gp(J.WRR), rotate(gr(J.WRR), [0, -6, 0])), 10, 1.5);
        I.hiL = add(gp(J.HIPL), 13, 5); I.knL = add(gp(J.KNL), 12, 3); I.anL = add(gp(J.ANL), 9, 2);
        I.toL = add(GM.add([0, 0, 0], gp(J.ANL), rotate(gr(J.ANL), [15, -10, 0])), 6, 1);
        I.hiR = add(gp(J.HIPR), 13, 5); I.knR = add(gp(J.KNR), 12, 3); I.anR = add(gp(J.ANR), 9, 2);
        I.toR = add(GM.add([0, 0, 0], gp(J.ANR), rotate(gr(J.ANR), [15, -10, 0])), 6, 1);
        I.belly = add(GM.add([0, 0, 0], gp(J.WAIST), rotate(hipsQ, [16, 20, 0])), 12, 4);
        this.P = P;
        // скорость: поступательная + вращение вокруг таза
        const h = 1 / 120, c0 = P[I.pelvis].p;
        for (const q of P) {
            const r = GM.sub([0, 0, 0], q.p, c0);
            const w = spin || [0, 0, 0];
            const vx = vel[0] + w[1] * r[2] - w[2] * r[1], vy = vel[1] + w[2] * r[0] - w[0] * r[2], vz = vel[2] + w[0] * r[1] - w[1] * r[0];
            q.o[0] = q.p[0] - vx * h; q.o[1] = q.p[1] - vy * h; q.o[2] = q.p[2] - vz * h;
        }
        // связи
        this.C = [];
        const link = (a, b, k, minOnly) => this.C.push({ a, b, L: GM.dist(P[a].p, P[b].p), k: k || 1, min: !!minOnly });
        const torso = [I.pelvis, I.chest, I.shL, I.shR, I.hiL, I.hiR, I.belly];
        for (let x = 0; x < torso.length; x++) for (let y = x + 1; y < torso.length; y++) link(torso[x], torso[y], 1);
        link(I.chest, I.head, 1); link(I.head, I.shL, 0.35); link(I.head, I.shR, 0.35); link(I.head, I.belly, 0.3);
        link(I.shL, I.elL); link(I.elL, I.haL); link(I.shR, I.elR); link(I.elR, I.haR);
        link(I.hiL, I.knL); link(I.knL, I.anL); link(I.anL, I.toL); link(I.knL, I.toL);
        link(I.hiR, I.knR); link(I.knR, I.anR); link(I.anR, I.toR); link(I.knR, I.toR);
        // пределы: локоть и колено не складываются полностью
        const lim = (a, b, f) => this.C.push({ a, b, L: f * BD.leg, k: 1, min: true });
        lim(I.shL, I.haL, 30); lim(I.shR, I.haR, 30); lim(I.hiL, I.anL, 30); lim(I.hiR, I.anR, 30);
        lim(I.haL, I.hiL, 14); lim(I.haR, I.hiR, 14);
        this.t = 0; this.still = 0; this.acc = 0;
        this.world = Noob.newWorld();
        this._hit = { n: [0, 0, 0], body: null, depth: 0 };
        this.bounce = 0;
        this.toWorld();
    }

    update(dt) {
        this.acc = Math.min(this.acc + dt, 1 / 120 * 6);
        let impact = 0;
        while (this.acc >= 1 / 120) {
            impact = Math.max(impact, this.step(1 / 120));
            this.acc -= 1 / 120;
        }
        this.t += dt;
        // покой: средняя скорость частиц
        let sp = 0;
        for (const q of this.P) sp += GM.dist(q.p, q.o) * 120;
        sp /= this.P.length;
        this.still = sp < 22 ? this.still + dt : 0;
        this.toWorld();
        return impact;
    }

    step(h) {
        const g = Phys.gravity, damp = 0.996;
        let impact = 0;
        for (const q of this.P) {
            const vx = (q.p[0] - q.o[0]) * damp, vy = (q.p[1] - q.o[1]) * damp, vz = (q.p[2] - q.o[2]) * damp;
            q.o[0] = q.p[0]; q.o[1] = q.p[1]; q.o[2] = q.p[2];
            q.p[0] += vx; q.p[1] += vy - g * h * h; q.p[2] += vz;
        }
        for (let it = 0; it < 8; it++) {
            for (const c of this.C) {
                const a = this.P[c.a], b = this.P[c.b];
                const dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], dz = b.p[2] - a.p[2];
                const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
                if (c.min && L >= c.L) continue;
                const diff = (L - c.L) / L * c.k;
                const wa = 1 / a.m, wb = 1 / b.m, s = wa + wb;
                a.p[0] += dx * diff * wa / s; a.p[1] += dy * diff * wa / s; a.p[2] += dz * diff * wa / s;
                b.p[0] -= dx * diff * wb / s; b.p[1] -= dy * diff * wb / s; b.p[2] -= dz * diff * wb / s;
            }
            this.hinges();
            if (it % 2 === 1) for (const q of this.P) {
                const hit = Phys.pushSphere(q.p, q.r, this._hit);
                if (hit) {
                    // трение и гашение удара
                    const n = hit.n, vx = q.p[0] - q.o[0], vy = q.p[1] - q.o[1], vz = q.p[2] - q.o[2];
                    const vn = vx * n[0] + vy * n[1] + vz * n[2];
                    if (vn < 0) impact = Math.max(impact, -vn * 120);
                    const tx = vx - vn * n[0], ty = vy - vn * n[1], tz = vz - vn * n[2];
                    const f = 0.28, keep = vn > 0 ? vn : -vn * 0.15;
                    q.o[0] = q.p[0] - (tx * (1 - f) + n[0] * keep); q.o[1] = q.p[1] - (ty * (1 - f) + n[1] * keep); q.o[2] = q.p[2] - (tz * (1 - f) + n[2] * keep);
                    if (hit.body && hit.body.tag === 'lava') this.lava = true;
                }
            }
        }
        return impact;
    }

    // Колени сгибаются вперёд, локти — вперёд (относительно корпуса).
    hinges() {
        const I = this.i, P = this.P;
        const f = this.forward(this._f || (this._f = [0, 0, 0]));
        for (const [a, b, c, dir] of [[I.hiL, I.knL, I.anL, 1], [I.hiR, I.knR, I.anR, 1], [I.shL, I.elL, I.haL, 1], [I.shR, I.elR, I.haR, 1]]) {
            const A = P[a].p, B = P[b].p, C = P[c].p;
            const mx = (A[0] + C[0]) / 2, my = (A[1] + C[1]) / 2, mz = (A[2] + C[2]) / 2;
            const ex = B[0] - mx, ey = B[1] - my, ez = B[2] - mz;
            const d = (ex * f[0] + ey * f[1] + ez * f[2]) * dir;
            if (d < -1) {
                const k = (-d - 1) * 0.5;
                B[0] += f[0] * k * dir; B[1] += f[1] * k * dir; B[2] += f[2] * k * dir;
            }
        }
    }

    // Базис корпуса: вверх (таз -> грудь), вправо (левое -> правое плечо), вперёд = вверх × вправо.
    basis(u, r, f) {
        const I = this.i, P = this.P;
        GM.norm(u, GM.sub(u, P[I.chest].p, P[I.pelvis].p));
        GM.sub(r, P[I.shR].p, P[I.shL].p);
        GM.adds(r, r, u, -GM.dot(r, u)); GM.norm(r, r);
        GM.cross(f, u, r);
    }
    forward(f) { const u = [0, 0, 0], r = [0, 0, 0]; this.basis(u, r, f); return f; }

    // Частицы -> мировые суставы Нуба.
    toWorld() {
        const I = this.i, P = this.P, J = Noob.J, w = this.world;
        const u = [0, 0, 0], r = [0, 0, 0], f = [0, 0, 0], q = [0, 0, 0, 1], v = [0, 0, 0], d = [0, 0, 0];
        this.basis(u, r, f);
        GM.qbasis(q, f, u, r);
        Noob.setRot(w, J.HIPS, q); Noob.setRot(w, J.WAIST, q);
        Noob.setPos(w, J.HIPS, P[I.pelvis].p);
        GM.add(v, P[I.pelvis].p, GM.qrot(v, q, [0, this.body.off[4], 0])); Noob.setPos(w, J.WAIST, v);
        Noob.setPos(w, J.NECK, P[I.chest].p);
        // голова
        GM.norm(d, GM.sub(d, P[I.head].p, P[I.chest].p));
        GM.qlimb(q, GM.scale(v, d, -1), f); Noob.setRot(w, J.NECK, q);
        // руки и ноги: звено = направление «вниз по кости» + подсказка «вперёд»
        const limb = (j0, a, b, j1, c2, j2, lenEnd) => {
            Noob.setPos(w, j0, P[a].p);
            GM.norm(d, GM.sub(d, P[b].p, P[a].p)); GM.qlimbZ(q, d, r); Noob.setRot(w, j0, q);
            Noob.setPos(w, j1, P[b].p);
            GM.norm(d, GM.sub(d, P[c2].p, P[b].p)); GM.qlimbZ(q, d, r); Noob.setRot(w, j1, q);
            GM.add(v, P[b].p, GM.qrot(v, q, [0, -lenEnd, 0])); Noob.setPos(w, j2, v);
            return q;
        };
        const fore = -this.body.off[5 * 3 + 1];
        let qq = limb(J.SHL, I.shL, I.elL, J.ELL, I.haL, J.WRL, fore); Noob.setRot(w, J.WRL, qq);
        qq = limb(J.SHR, I.shR, I.elR, J.ELR, I.haR, J.WRR, fore); Noob.setRot(w, J.WRR, qq);
        for (const [jh, hi, kn, an, to] of [[J.HIPL, I.hiL, I.knL, I.anL, I.toL], [J.HIPR, I.hiR, I.knR, I.anR, I.toR]]) {
            Noob.setPos(w, jh, P[hi].p);
            GM.norm(d, GM.sub(d, P[kn].p, P[hi].p)); GM.qlimbZ(q, d, r); Noob.setRot(w, jh, q);
            Noob.setPos(w, jh + 1, P[kn].p);
            GM.norm(d, GM.sub(d, P[an].p, P[kn].p)); GM.qlimbZ(q, d, r); Noob.setRot(w, jh + 1, q);
            Noob.setPos(w, jh + 2, P[an].p);
            const toe = GM.norm([0, 0, 0], GM.sub([0, 0, 0], P[to].p, P[an].p));
            GM.qlimb(q, d, toe); Noob.setRot(w, jh + 2, q);
        }
        return w;
    }

    pelvis() { return this.P[this.i.pelvis].p; }
    // Лицом вниз? И курс подъёма (для лица вниз — к голове, вверх — к ногам).
    getupInfo() {
        const f = this.forward([0, 0, 0]);
        const I = this.i, P = this.P;
        const hx = P[I.head].p[0] - P[I.pelvis].p[0], hz = P[I.head].p[2] - P[I.pelvis].p[2];
        const faceDown = f[1] < 0;
        const yaw = faceDown ? Math.atan2(hz, hx) : Math.atan2(-hz, -hx);
        return { faceDown, yaw: Number.isFinite(yaw) ? yaw : 0 };
    }

    // Толкнуть частицы (удар по лежащему).
    kick(v) {
        for (const q of this.P) { q.o[0] -= v[0] / 120; q.o[1] -= v[1] / 120; q.o[2] -= v[2] / 120; }
    }
}
