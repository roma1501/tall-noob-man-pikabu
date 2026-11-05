// GameRunner.js — бегущий Нуб: рост и ширина (пружины растяжения), руление, ворота и препятствия, финал.
// Сам Runner — ещё и «физическое тело» для Motion Matching (поля как у NoobCharacter: pos, vel, desired,
// пружины sx/sz, курс facing, grounded…): MotionController берёт отсюда траекторию и подбирает кадры базы.
// Шаг масштабируется ростом: высокий Нуб идёт длинными шагами (в базе это ходьба), маленький — бежит.
// 1 px = 1 см. Дорога вдоль мира +z, курс бега 90° (π/2), x — поперёк.

class Runner {
    constructor(game, view) {
        this.game = game;
        this.model = Noob.build(view);
        this.mm = new MotionController(this.model);
        this.mm.cfg.lookAtCamera = 0;
        this.H = 180; this.W = 100;                // цель: рост, см; ширина, %
        this.hs = new Float64Array([180, 0]);      // пружина роста [значение, скорость]
        this.ws = new Float64Array([100, 0]);
        this.body = Noob.body(1, 1);
        // поля «тела» для MotionController
        this.pos = [700, 0, 0]; this.vel = [0, 0, 0]; this.groundVel = [0, 0, 0]; this.groundSpin = 0;
        this.sx = { v: 0, a: 0 }; this.sz = { v: 0, a: 0 }; this.desired = [0, 0];
        this.facing = { x: Math.PI / 2, v: 0 }; this.facingGoal = Math.PI / 2;
        this.hlVel = 0.3; this.hlRot = 0.16;
        this.grounded = true; this.airTime = 0; this.jumpT = 9; this.impact = 0;
        this.pushW = 0; this.camYaw = null; this.camPitch = 0;
        /** @type {NoobRagdoll | null} */ this.ragdoll = null;
        this.vy = 0;
        this.targetX = 700; this.speed = 0; this.running = false;
        this.phase = 'idle';       // idle | run | finale | done
        this.collected = 0;
        this.hitCool = 0;
        this.finale = null;
        this.power = 0;                            // шкала «Гиганта» 0..1
        this.giantT = 0;                           // сколько ещё длится режим
        this.gk = new Float64Array([1, 0]);        // пружина множителя роста гиганта
        this.lavaCool = 0;
        this.c = Runner.cfg();
        this._hit = { y: 0, n: [0, 1, 0], body: null, t: 0, moving: false };
    }

    static cfg() {
        const U = 'undefined';
        return {
            speed: typeof RUN_SPEED !== U ? RUN_SPEED : 340,
            sens: typeof RUN_STEER_SENS !== U ? RUN_STEER_SENS : 1.5,
            keySteer: typeof RUN_KEY_STEER !== U ? RUN_KEY_STEER : 560,
            steerHl: typeof RUN_STEER_HALFLIFE !== U ? RUN_STEER_HALFLIFE : 0.07,
            roadW: typeof ROAD_WIDTH !== U ? ROAD_WIDTH : 620,
            minH: typeof RUN_MIN_HEIGHT !== U ? RUN_MIN_HEIGHT : 60,
            maxH: typeof RUN_MAX_HEIGHT !== U ? RUN_MAX_HEIGHT : 1400,
            minW: typeof RUN_MIN_WIDTH !== U ? RUN_MIN_WIDTH : 50,
            maxW: typeof RUN_MAX_WIDTH !== U ? RUN_MAX_WIDTH : 400,
            growHz: typeof RUN_GROW_HZ !== U ? RUN_GROW_HZ : 2.4,
            growZeta: typeof RUN_GROW_DAMPING !== U ? RUN_GROW_DAMPING : 0.4,
            hammerLoss: typeof RUN_HAMMER_LOSS !== U ? RUN_HAMMER_LOSS : 30,
            wallMin: typeof RUN_WALL_MIN_LOSS !== U ? RUN_WALL_MIN_LOSS : 10,
            sawMargin: typeof RUN_SAW_MARGIN !== U ? RUN_SAW_MARGIN : 8,
            startW: typeof RUN_START_WIDTH !== U ? RUN_START_WIDTH : 100,
            punchPush: typeof RUN_PUNCH_PUSH !== U ? RUN_PUNCH_PUSH : 260,
            punchLoss: typeof RUN_PUNCH_LOSS !== U ? RUN_PUNCH_LOSS : 20,
            rollerLoss: typeof RUN_ROLLER_LOSS !== U ? RUN_ROLLER_LOSS : 25,
            jumpV: typeof RUN_JUMP_SPEED !== U ? RUN_JUMP_SPEED : 820,
            lavaLoss: typeof RUN_LAVA_LOSS !== U ? RUN_LAVA_LOSS : 40,
            fanForce: typeof RUN_FAN_FORCE !== U ? RUN_FAN_FORCE : 520,
            ramSlow: typeof RUN_RAM_SLOW !== U ? RUN_RAM_SLOW : 0.45,
            giantCharge: typeof RUN_GIANT_CHARGE !== U ? RUN_GIANT_CHARGE : 6,
            giantTime: typeof RUN_GIANT_TIME !== U ? RUN_GIANT_TIME : 5,
            giantScale: typeof RUN_GIANT_SCALE !== U ? RUN_GIANT_SCALE : 1.7,
        };
    }

    // Половина ширины тела (плечи с руками), px.
    halfWidth() { const B = this.body; return Math.abs(B.off[3 * 3 + 2]) + 16.5 * (1 + (B.sw - 1) * 0.8); }
    heightPx() { return this.hs[0] * this.gk[0]; }
    // Рост «для препятствий и финала»: с гигантом — больше.
    effH() { return this.H * Math.max(1, this.gk[0]); }
    get giant() { return this.giantT > 0; }

    // Опора под точкой (для стоп): дорога или земля.
    ground(x, z, yTop) {
        const h = this._hit;
        const onRoad = Math.abs(x - Level.roadX) < this.c.roadW / 2 + 26 && z > Level.start.z - 400 && z < Level.endZ;
        h.y = onRoad ? Level.roadY : Phys.groundY(x, z);
        if (onRoad) for (const j of Level.jumps) if (z > j.zA && z < j.z) h.y = Math.max(h.y, Level.roadY + j.H * (z - j.zA) / (j.z - j.zA));
        if (h.y > yTop) return null;
        h.n[0] = 0; h.n[1] = 1; h.n[2] = 0; h.body = null; h.moving = false;
        return h;
    }

    reset(startH) {
        this.c = Runner.cfg();
        this.H = startH; this.W = this.c.startW;
        this.hs[0] = startH; this.hs[1] = 0; this.ws[0] = this.W; this.ws[1] = 0;
        this.power = 0; this.giantT = 0; this.gk[0] = 1; this.gk[1] = 0; this.lavaCool = 0;
        this.body = Noob.body(this.H / 180, this.W / 100);
        this.mm.body = this.body;
        GM.set(this.pos, Level.start.x, Level.roadY, Level.start.z);
        GM.set(this.vel, 0, 0, 0);
        this.sx.v = this.sx.a = this.sz.v = this.sz.a = 0;
        this.desired[0] = this.desired[1] = 0;
        this.facing.x = Math.PI / 2; this.facing.v = 0; this.facingGoal = Math.PI / 2;
        this.targetX = Level.start.x; this.speed = 0; this.vy = 0;
        this.running = false; this.phase = 'idle';
        this.grounded = true; this.airTime = 0; this.jumpT = 9; this.impact = 0;
        this.collected = 0; this.hitCool = 0; this.finale = null;
        this.ragdoll = null;
        this.mm.reset(this.pos, Math.PI / 2);
        this.model.root.setEnabled(true);
    }

    start() { this.running = true; this.phase = 'run'; }

    // Перетаскивание: dx экранных px; клавиши — ось −1..1.
    steer(dxScreen, axis, dt) {
        if (this.phase !== 'run') return;
        const w = Math.max(320, (typeof window !== 'undefined' ? window.innerWidth : 800) * 0.8);
        // камера смотрит вдоль +z: экранное «вправо» — это −x мира
        this.targetX -= dxScreen * this.c.sens * this.c.roadW / w;
        this.targetX -= axis * this.c.keySteer * dt;
        const lim = Math.max(0, this.c.roadW / 2 - this.halfWidth() * 0.8);
        this.targetX = GM.clamp(this.targetX, Level.roadX - lim, Level.roadX + lim);
    }

    setHeight(h) { this.H = GM.clamp(h, 0, this.c.maxH); }
    setWidth(w) { this.W = GM.clamp(w, this.c.minW, this.c.maxW); }

    // ---- кадр ---------------------------------------------------------------------------------------
    update(dt) {
        const c = this.c, g = this.game;
        this.hitCool = Math.max(0, this.hitCool - dt);
        this.jumpT += dt;
        // рост и ширина — пружины с отскоком (растяжение)
        GM.springTo(this.hs, 0, this.H, c.growHz, c.growZeta, dt);
        GM.springTo(this.ws, 0, this.W, c.growHz * 1.1, c.growZeta, dt);
        if (this.hs[0] < 20) this.hs[0] = 20;
        if (this.ws[0] < 30) this.ws[0] = 30;
        // гигант: пружина множителя роста, ширина растёт слабее
        if (this.giantT > 0) { this.giantT -= dt; if (this.giantT <= 0) this.game.fxGiant(this, false); }
        GM.springTo(this.gk, 0, this.giantT > 0 ? c.giantScale : 1, 1.6, 0.45, dt);
        const g2 = Math.max(0.6, this.gk[0]);
        const sh = this.hs[0] * g2 / 180, sw = this.ws[0] * Math.sqrt(g2) / 100;
        if (Math.abs(sh - this.body.sh) > 0.002 || Math.abs(sw - this.body.sw) > 0.002) { this.body = Noob.body(sh, sw); this.mm.body = this.body; }
        // вперёд
        const z0 = this.pos[2];
        let want = this.phase === 'run' ? c.speed : 0;
        if (this.finale && this.finale.stopZ != null) {
            const left = this.finale.stopZ - this.pos[2];
            want = Math.max(0, Math.min(c.speed, left * 2.2));
            if (left < 2) want = 0;
        }
        this.speed = GM.damper(this.speed, want, this.phase === 'run' && this.speed < want ? 0.25 : 0.18, dt);
        if (this.speed < 1 && want === 0) this.speed = 0;
        this.pos[2] += this.speed * dt;
        // вбок — за целью
        const x0 = this.pos[0];
        this.pos[0] += (this.targetX - this.pos[0]) * GM.damperK(c.steerHl, dt);
        const vx = (this.pos[0] - x0) / dt, vz = (this.pos[2] - z0) / dt;
        // вертикаль: прыжки (победа, удар); иначе — на дороге
        const gy = this.ground(this.pos[0], this.pos[2], this.pos[1] + 200);
        const floor = gy ? gy.y : Level.roadY;
        if (this.vy !== 0 || this.pos[1] > floor + 0.5) {
            this.vy -= Phys.gravity * dt;
            this.pos[1] += this.vy * dt;
            if (this.pos[1] <= floor) { this.impact = -this.vy; this.pos[1] = floor; this.vy = 0; this.grounded = true; this.airTime = 0; }
            else { this.grounded = false; this.airTime += dt; }
        } else { this.pos[1] = floor; this.grounded = true; this.airTime = 0; }
        GM.set(this.vel, vx, this.vy, vz);
        // пружины траектории (для запроса MM): скорость сейчас и желаемая
        this.sx.v = vx; this.sz.v = vz;
        const dvx = GM.clamp((this.targetX - this.pos[0]) * (Math.LN2 / c.steerHl), -900, 900);
        this.desired[0] = this.phase === 'run' ? dvx : 0; this.desired[1] = want;
        if (Math.hypot(this.desired[0], this.desired[1]) > 20) this.facingGoal = Math.atan2(this.desired[1], this.desired[0] * 0.55);
        GM.springAngle(this.facing, this.facingGoal, this.hlRot, dt);
        // события трассы
        if (this.phase === 'run') { this.events(z0, this.pos[2]); this.obstacles(dt); }
        this.hammers(dt);
        this.pickCoins();
        if (this.phase === 'run' && this.H < c.minH) { g.lose('small'); this.phase = 'done'; }
        if (this.phase === 'run' && this.pos[2] >= Level.finish.z) this.enterFinale();
        if (this.finale) this.updateFinale(dt);
        // поза
        if (this.ragdoll) {
            this.ragdoll.update(dt);
            Noob.apply(this.model, this.ragdoll.world, this.body);
        } else {
            this.mm.update(dt, this);
        }
    }

    jump(v) { this.vy = v; this.grounded = false; this.jumpT = 0; this.pos[1] += 1; }

    // Пересечённые за кадр события (по y карты = мировой z).
    events(z0, z1) {
        const g = this.game, c = this.c, x = this.pos[0], half = this.halfWidth();
        for (const ev of Level.events) {
            if (ev.used || ev.type === 'hammer') continue;
            if (ev.z > z1) break;
            if (ev.z <= z0 - 1) continue;
            if (ev.type === 'gate') {
                // ряд ворот: срабатывают те, что ближе к Нубу (щель между створками не спасает)
                let best = null, bd = Infinity;
                for (const o of Level.events) {
                    if (o.type !== 'gate' || o.used || Math.abs(o.z - ev.z) > 40) continue;
                    const d = Math.max(0, Math.abs(x - o.x) - o.w / 2);
                    if (d < bd) { bd = d; best = o; }
                }
                if (!best || bd > half * 0.5 + 30) { ev.used = true; continue; }
                if (best !== ev) continue;
                ev.used = true;
                // ворота в том же ряду гаснут
                for (const o of Level.events) if (o !== ev && o.type === 'gate' && Math.abs(o.z - ev.z) < 40) { o.used = true; o.mat.alpha = 0.15; }
                this.applyGate(ev);
            } else if (ev.type === 'saw') {
                ev.used = true;
                if (Math.abs(x - ev.x) > ev.w / 2 + half * 0.5) continue;
                if (this.giant) { g.fxSawGiant(this, ev); continue; }
                if (this.H > ev.h) {
                    const before = this.H;
                    this.setHeight(Math.max(c.minH - 1, ev.h - c.sawMargin));
                    g.fxCut(this, before - this.H, ev);
                }
            } else if (ev.type === 'jump') {
                ev.used = true;
                // с верха клина — всегда в полёт (в этот кадр опора уже ушла из-под ног)
                if (this.pos[1] < Level.roadY + ev.H + 40) { this.pos[1] = Math.max(this.pos[1], Level.roadY + ev.H); this.jump(c.jumpV); g.fxJump(this, ev); }
            } else if (ev.type === 'ram') {
                // таран: задел по ширине — насквозь, минус прочность блока (гигант — без потерь), рывок и замедление.
                // Пара блоков на одной y — срабатывает ближайший к Нубу (как ворота), двух сразу не бывает.
                let hit = null, bd = Infinity;
                for (const o of Level.events) {
                    if (o.type !== 'ram' || o.used || Math.abs(o.z - ev.z) > 40) continue;
                    o.used = true;
                    const d = Math.abs(x - o.x) - o.w / 2;
                    if (d < bd) { bd = d; hit = o; }
                }
                if (!hit || Math.abs(x - hit.x) > hit.w / 2 + half * 0.6) continue;
                const loss = this.giant ? 0 : hit.s;
                if (loss > 0) { this.setHeight(this.H - loss); this.hs[1] -= 220; }
                this.speed *= c.ramSlow;
                this.mm.sec[1] -= 2.2; this.mm.sec[5] += 2.5;
                Level.smash(hit, x, this.giant ? 2.6 : GM.clamp(this.heightPx() / 160, 0.9, 2.4), 1e5, hit.w * 2 + 400);
                g.fxRam(this, loss, hit);
            } else if (ev.type === 'wall') {
                ev.used = true;
                if (Math.abs(x - ev.x) > ev.w / 2 + half * 0.6) continue;
                const loss = this.giant ? 0 : this.effH() < ev.h ? Math.max(c.wallMin, (ev.h - this.effH()) / 2) : 0;
                if (loss > 0) this.setHeight(this.H - loss);
                const power = this.giant ? 2.6 : GM.clamp((this.heightPx() / ev.h) * Math.sqrt(this.ws[0] / 100), 0.4, 2.2);
                Level.smash(ev, x, power, this.heightPx(), 2 * half);
                g.fxSmash(this, loss, ev);
            }
        }
    }

    applyGate(ev) {
        const g = this.game, v = ev.v;
        const before = { H: this.H, W: this.W };
        switch (ev.kind) {
            case 'g-tall': this.setHeight(this.H + v * 100); break;
            case 'g-short': this.setHeight(this.H - v * 100); break;
            case 'g-fat': this.setWidth(this.W + v * 100); break;
            case 'g-thin': this.setWidth(this.W - v * 100); break;
            case 'g-xtall': this.setHeight(this.H * v); break;
            case 'g-xshort': this.setHeight(this.H / Math.max(1, v)); break;
            default: break;
        }
        // толчок пружины: растяжение «с запасом» и отскок
        if (this.H > before.H) this.hs[1] += 220; else if (this.H < before.H) this.hs[1] -= 160;
        if (this.H > before.H || this.W > before.W) this.addPower(1 / Math.max(1, this.c.giantCharge));
        if (this.W > before.W) this.ws[1] += 160; else if (this.W < before.W) this.ws[1] -= 120;
        g.fxGate(this, ev, this.H - before.H, this.W - before.W);
    }

    hammers(dt) {
        if (this.phase !== 'run' || this.hitCool > 0) return;
        const x = this.pos[0], half = this.halfWidth(), H = this.hs[0];
        for (const hm of Level.hammers) {
            if (!hm.headPos || Math.abs(hm.z - this.pos[2]) > 90) continue;
            const hp = hm.headPos;
            if (Math.abs(hp[0] - x) < half + 75 && hp[1] - 55 < this.pos[1] + H) {
                this.hitCool = 0.9;
                if (this.giant) { this.game.fxBlock(this, hp); break; }
                this.setHeight(this.H - this.c.hammerLoss);
                const dir = Math.sign(hm.headVel || 1);
                this.targetX = GM.clamp(this.targetX + dir * 120, Level.roadX - this.c.roadW / 2 + half, Level.roadX + this.c.roadW / 2 - half);
                this.mm.sec[1] += 3; this.mm.sec[3] += dir * 4;
                this.game.fxHammer(this, hm);
                break;
            }
        }
        void dt;
    }

    pickCoins() {
        const x = this.pos[0], z = this.pos[2], half = this.halfWidth();
        for (const c of Level.coins) {
            if (c.taken || Math.abs(c.z - z) > 45) continue;
            if (Math.abs(c.x - x) < half + 28 && c.h < this.hs[0] + 40) {
                c.taken = true; c.t = 0;
                this.collected += c.value;
                if (c.gem) this.addPower(0.08);
                this.game.fxCoin(this, c);
            }
        }
    }

    addPower(v) {
        if (this.giant || this.phase !== 'run') return;
        this.power = Math.min(1, this.power + v);
        if (this.power >= 1) { this.power = 0; this.giantT = this.c.giantTime; this.game.fxGiant(this, true); }
    }

    // Перчатки, вентиляторы, шары, лава в яме — проверки каждый кадр (не по пересечению).
    obstacles(dt) {
        const c = this.c, g = this.game, x = this.pos[0], z = this.pos[2], half = this.halfWidth();
        const lim = Math.max(0, c.roadW / 2 - half * 0.8);
        // перчатки
        for (const p of Level.punches) {
            if (Math.abs(p.z - z) > 70 || p.cool > g.time) continue;
            const a = Math.min(p.x, p.tipX + p.side * 40), b = Math.max(p.x, p.tipX + p.side * 40);
            const hitLat = x + half > a + 10 && x - half < b - 10;
            const outward = p.vel > 0.5;
            if (hitLat && outward && this.pos[1] < Level.roadY + 260) {
                p.cool = g.time + 0.6;
                if (this.giant) { g.fxBlock(this, [p.tipX, p.y, p.z]); continue; }
                const k = 1 / Math.pow(Math.max(0.6, this.ws[0] / 100), 0.9);   // широкого почти не сдвинуть
                this.targetX = GM.clamp(this.targetX - p.side * c.punchPush * k, Level.roadX - lim, Level.roadX + lim);
                this.setHeight(this.H - c.punchLoss);
                this.mm.sec[3] += -p.side * 5; this.mm.sec[1] += 2;
                g.fxPunch(this, p);
            }
        }
        // вентиляторы: дуют поперёк, худого — сильнее
        for (const f of Level.fans) {
            if (Math.abs(f.z - z) > f.zone / 2) continue;
            const k = 1 / Math.pow(Math.max(0.5, this.ws[0] / 100), 1.3) / (this.giant ? 4 : 1);
            this.targetX = GM.clamp(this.targetX + f.dir * c.fanForce * k * dt, Level.roadX - lim, Level.roadX + lim);
            if (g.time - f.puff > 0.12) { f.puff = g.time; g.fxWind(f); }
        }
        // шары для боулинга
        Level.releaseRollers(z);
        for (const r of Level.rollers) {
            if (!r.released || r.hit) continue;
            const bp = r.body.pos;
            if (Math.abs(bp[2] - z) < r.r + 36 && Math.abs(bp[0] - x) < half + r.r * 0.8) {
                r.hit = true;
                const dx = (bp[0] - x) / Math.max(1, half);
                if (this.giant || this.effH() > r.r * 5) {
                    GM.set(r.body.vel, dx * 300, 650, 1100); GM.set(r.body.ang, 8, 3, 2);
                    g.fxStrike(this, r);
                } else {
                    this.setHeight(this.H - c.rollerLoss);
                    GM.set(r.body.vel, dx * 260 + (Math.random() - 0.5) * 120, 260, -160);
                    g.fxRollerHit(this, r);
                }
            }
        }
        // лава в яме трамплина: приземлился в неё — горячо
        this.lavaCool = Math.max(0, this.lavaCool - dt);
        if (this.grounded && this.lavaCool <= 0) for (const j of Level.jumps) {
            if (z > j.z0 && z < j.z1) {
                this.lavaCool = 0.8;
                if (!this.giant) this.setHeight(this.H - c.lavaLoss);
                this.jump(480);
                g.fxLava(this, j);
                break;
            }
        }
    }

    // ---- финал --------------------------------------------------------------------------------------
    enterFinale() {
        this.phase = 'finale';
        const g = this.game;
        this.targetX = Level.roadX;
        if (Level.boss) {
            const b = Level.boss;
            this.finale = { kind: 'boss', t: 0, stopZ: b.z - 80 - this.halfWidth() - b.width * 0.7, done: false };
        } else {
            this.finale = { kind: 'ruler', t: 0, stopZ: Level.ruler.z - 60 - this.halfWidth() * 0.6, done: false };
        }
        g.onFinish(this);
    }

    updateFinale(dt) {
        const f = this.finale, g = this.game;
        f.t += dt;
        const arrived = this.pos[2] >= f.stopZ - 3 && this.speed < 30;
        if (!f.done && arrived) {
            f.done = true;
            if (f.kind === 'ruler') {
                const m = Level.multFor(this.effH());
                g.finishRuler(this, m);
                this.jump(520);
            } else {
                // босс: бой на ринге (GameFight.js) — тапы, увороты, нокаут
                f.fight = true;
                Fight.start(g, this);
            }
        }
        // победные подпрыгивания
        if (f.done && (!f.fight || f.won) && !this.ragdoll && this.grounded && f.t - (f.jumpAt || 0) > 0.9 && (f.hops || 0) < 3) { f.hops = (f.hops || 0) + 1; f.jumpAt = f.t; this.jump(480); }
    }
}
