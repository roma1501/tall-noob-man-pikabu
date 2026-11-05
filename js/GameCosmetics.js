// GameCosmetics.js — косметика на Нубе и превью карточек (контракт — docs/shop-contract.md).
//
// ЧТО ДЕЛАЕТ ИГРА:
//   Cosmetics.apply(game, look)   надетое -> вид Нуба; look — Shop.look() ({ skin, face, hat, trail, pet }: id или null).
//                                 Зовёт ShopUI (на события Shop equip/unequip/preview) и один раз при старте; безопасно звать
//                                 повторно: пересобирается только то, что поменялось.
//   Cosmetics.update(dt, game)    КАЖДЫЙ кадр: питомец рядом с Нубом, след за ногами (в 'play'), анимация шляп/питомцев.
//                                 Если game.model пересоздали — применяет последний look заново сам.
//   Cosmetics.icon(item, px)      <canvas> превью карточки (скин, лицо, шляпа, след, питомец), нарисован процедурно.
//   Cosmetics.portrait(look, px)  <canvas> «зеркало»: Нуб целиком в надетом (скин + лицо + шляпа + питомец + след).
// game: { model (Noob.build), app (LoryApp: location.view, fx), runnerPos() -> [x,y,z], runnerHeight() -> px, state }.
//
// ВИД ПРЕДМЕТОВ (поле art из js/GameShopData.js; готовые картинки — пути assets/…webp литералами из каталога, грузятся лениво):
//   skin  — зоны тела head/chest/belt/sleeve/arm/hand/thigh/shin/foot; у каждой цвет или { c, k (узор), c2, c3, n, e (свечение) };
//           на детали Нуба кладутся СВОИ материалы (DynamicTexture с узором), исходные mats Нуба не трогаются и возвращаются
//           на «Классике». Голова: { c, hair, hairY, band, visor, stripes } — цвет и тонкие детали из примитивов (волосы, пластина-повязка/забрало, полоски).
//           decal { src | text, c (тон), s, dy, back } — рисунок на груди (и спине): плоскости-дети UpperTorso с прозрачной
//           текстурой (белые картинки-маски assets/textures/decals умножаются на цвет c, цветные — c: null);
//           acc [{ on, k, c }] — детали из примитивов на частях тела (ACC: плавник, уши, чашка, пачка…), скины брейнрота.
//   face  — { k } рисунок на прозрачном холсте 256×144 (как Noob.faceMaterial) или { img } готовая картинка лица (вписана
//           по границам рисунка); ложится на model.face; исходный материал возвращается на «Улыбке».
//   hat   — набор примитивов Babylon (box/cyl/sph/tor), дочерний меш головы parts[2].mesh (голова — скруглённая коробка 44×44×50, нос +X); формы рассчитаны на голову-цилиндр r 21 и сажаются
//           на коробку масштабом HEAD_FIT.
//   pet   — то же из примитивов, летит рядом с Нубом с запаздыванием, качается и смотрит по курсу.
//   trail — частицы ParticleFX из-под ног: текстура частицы — img (assets/fx) или своя форма TRAIL_TEX; пока идёт забег
//           (и в примерке в меню при Cosmetics.trailInMenu).
// У предмета может быть icon — готовая картинка карточки (иначе иконку рисует Cosmetics.icon). Слот предмета — item.slot || item.tab
// (скины брейнрота лежат во вкладке brainrot, а надеваются в слот skin).
// Один и тот же набор примитивов рисуется и в 3D (Babylon), и в иконке (плоский софт-рендер ниже) — превью совпадает с игрой.
// Примитив: { k: 'box'|'cyl'|'sph'|'tor', p: [x,y,z], c: '#цвет', e?: свечение 0..1, rx/ry/rz?: поворот (порядок Y·X·Z, как у mesh.rotation),
//   sc?: [sx,sy,sz] масштаб до поворота, g?: имя группы-шарнира }; box s:[x,y,z]; cyl r (низ), rt (верх), h, t; sph s:[dx,dy,dz], sl (доля высоты,
//   0.5 — полусфера-купол); tor R (радиус кольца), r (радиус трубки). Определение формы: массив примитивов или
//   { prims, groups: { имя: { at: [x,y,z], mode: 'spin'|'flap'|'bob'|'pulse', axis: 'x'|'y'|'z', speed, amp, base? } }, squish?, back? }.

/** @satisfies {Record<string, any>} */
const Cosmetics = (() => {
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    // ---------------------------------------------------------------------------------------------
    // Цвет и случайность
    // ---------------------------------------------------------------------------------------------
    const hex = (c) => {
        let s = String(c || '#ffffff').replace('#', '');
        if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
        const n = parseInt(s, 16) || 0;
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
    /** Темнее (f < 1) или светлее (f > 1, к белому). */
    const sh = (c, f) => {
        const [r, g, b] = hex(c);
        if (f <= 1) return toHex(r * f, g * f, b * f);
        const t = f - 1;
        return toHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
    };
    const mix = (a, b, t) => {
        const p = hex(a), q = hex(b);
        return toHex(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t);
    };
    const rgba = (c, a) => { const [r, g, b] = hex(c); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; };
    const seedOf = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
    const rng = (seed) => {
        let a = seed >>> 0;
        return () => {
            a = (a + 0x6d2b79f5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    };

    // ---------------------------------------------------------------------------------------------
    // Холсты
    // ---------------------------------------------------------------------------------------------
    const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
    const ctxOf = (c) => /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    const rrect = (g, x, y, w, h, r) => {
        r = Math.min(r, w / 2, h / 2);
        g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    };
    const texCtx = (tex) => /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (tex.getContext()));

    // ---------------------------------------------------------------------------------------------
    // Готовые картинки (assets/…webp): загрузка с очередью ожидающих, обрезка по альфе, тонировка
    // ---------------------------------------------------------------------------------------------
    /** @type {Map<string, any>} */
    const IMGS = new Map();
    /** Пути, которых не оказалось в кэше во время отрисовки иконки (on: true) — иконка перерисуется, когда они загрузятся. */
    /** @type {{ on: boolean, list: string[] }} */
    const NEEDS = { on: false, list: [] };
    /** Картинка по пути или null (ещё грузится); cb — позвать, когда загрузится. Без cb путь попадает в NEEDS (если идёт отрисовка иконки). */
    const loadImg = (src, cb) => {
        let r = IMGS.get(src);
        if (!r) {
            const img = new Image();
            r = { img, ok: false, fail: false, cbs: [] };
            IMGS.set(src, r);
            img.onload = () => { r.ok = true; for (const f of r.cbs.splice(0)) { try { f(); } catch (e) { console.warn('Cosmetics:', e); } } };
            img.onerror = () => { r.fail = true; r.cbs.length = 0; console.warn('Cosmetics: нет картинки', src); };
            img.src = src;
        }
        if (r.ok) return r.img;
        if (cb) { if (!r.fail) r.cbs.push(cb); } else if (NEEDS.on && !r.fail) NEEDS.list.push(src);
        return null;
    };
    /** @type {Map<string, HTMLCanvasElement>} */
    const TRIM = new Map();
    /** Картинка, обрезанная по непрозрачной части (кэш), или null, пока не загружена. */
    const trimmed = (src) => {
        const hit = TRIM.get(src);
        if (hit) return hit;
        const img = loadImg(src);
        if (!img) return null;
        const w = img.naturalWidth, h = img.naturalHeight;
        const full = mkCanvas(w, h), g = ctxOf(full);
        g.drawImage(img, 0, 0);
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        try {
            const d = g.getImageData(0, 0, w, h).data;
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        } catch (e) { x1 = -1; }
        if (x1 < x0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
        const pad = 2, sx = Math.max(0, x0 - pad), sy = Math.max(0, y0 - pad), cw = Math.min(w, x1 + pad + 1) - sx, ch = Math.min(h, y1 + pad + 1) - sy;
        const c = mkCanvas(cw, ch);
        ctxOf(c).drawImage(full, sx, sy, cw, ch, 0, 0, cw, ch);
        TRIM.set(src, c);
        return c;
    };
    /** Умножить картинку (маску-рисунок) на цвет с сохранением формы; color пусто — как есть. Возвращает холст w×h. */
    const tinted = (src, color, w, h) => {
        const c = mkCanvas(w, h), g = ctxOf(c);
        g.drawImage(src, 0, 0, w, h);
        if (color) {
            g.globalCompositeOperation = 'multiply'; g.fillStyle = color; g.fillRect(0, 0, w, h);
            g.globalCompositeOperation = 'destination-in'; g.drawImage(src, 0, 0, w, h);
        }
        return c;
    };

    // ---------------------------------------------------------------------------------------------
    // Примитивы: конструкторы форм
    // ---------------------------------------------------------------------------------------------
    const D = (n) => [n, n, n];
    const Bx = (s, p, c, o) => ({ k: 'box', s, p, c, ...o });
    const Cy = (r, rt, h, p, c, o) => ({ k: 'cyl', r, rt, h, p, c, ...o });
    const Sp = (s, p, c, o) => ({ k: 'sph', s, p, c, ...o });
    const To = (R, r, p, c, o) => ({ k: 'tor', R, r, p, c, ...o });
    /** Углы rx/rz, при которых ось +Y примитива смотрит по направлению d (ry = 0). */
    const along = (d) => {
        const l = Math.hypot(d[0], d[1], d[2]) || 1;
        const x = d[0] / l, y = d[1] / l, z = d[2] / l;
        return { rz: -Math.asin(clamp(x, -1, 1)), rx: Math.atan2(z, y) };
    };
    /** Конус/цилиндр из точки a по направлению d длиной len (радиус r0 у начала, r1 на конце). Возвращает { prim, end }. */
    const limb = (a, d, len, r0, r1, c, o) => {
        const l = Math.hypot(d[0], d[1], d[2]) || 1;
        const u = [d[0] / l, d[1] / l, d[2] / l];
        const mid = [a[0] + u[0] * len / 2, a[1] + u[1] * len / 2, a[2] + u[2] * len / 2];
        return { prim: { k: 'cyl', r: r0, rt: r1, h: len, p: mid, c, t: 10, ...along(u), ...o }, end: [a[0] + u[0] * len, a[1] + u[1] * len, a[2] + u[2] * len] };
    };
    /** Дуга из коробочек в плоскости YZ вокруг головы (ободок): радиус R, углы от вертикали a0..a1 (рад). */
    const arcBand = (R, a0, a1, n, w, th, c, o) => {
        const out = [];
        const seg = R * (a1 - a0) / n * 1.18;
        for (let i = 0; i < n; i++) {
            const a = a0 + (i + 0.5) / n * (a1 - a0);
            out.push(Bx([w, seg, th], [0, R * Math.cos(a), R * Math.sin(a)], c, { rx: a + Math.PI / 2, ...o }));
        }
        return out;
    };

    // ---------------------------------------------------------------------------------------------
    // Примитив -> многоугольники (для иконок) и проекция
    // ---------------------------------------------------------------------------------------------
    /** Поворот в порядке Y·X·Z (как mesh.rotation в Babylon): сначала Z, затем X, затем Y. */
    const rotFn = (rx, ry, rz) => {
        const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
        return (v) => {
            const x1 = v[0] * cz - v[1] * sz, y1 = v[0] * sz + v[1] * cz, z1 = v[2];
            const y2 = y1 * cx - z1 * sx, z2 = y1 * sx + z1 * cx;
            return [x1 * cy + z2 * sy, y2, -x1 * sy + z2 * cy];
        };
    };
    const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

    /** Грани примитива в его локальных осях (до масштаба sc, поворота и сдвига): [{ v: [[x,y,z]…], n: [x,y,z] }]. */
    const primFaces = (p) => {
        const out = [];
        if (p.k === 'box') {
            const h = [p.s[0] / 2, p.s[1] / 2, p.s[2] / 2];
            for (let a = 0; a < 3; a++) for (const sg of [-1, 1]) {
                const u = (a + 1) % 3, w = (a + 2) % 3;
                const v = [];
                for (const [cu, cw] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                    const q = [0, 0, 0]; q[a] = sg * h[a]; q[u] = cu * h[u]; q[w] = cw * h[w]; v.push(q);
                }
                const n = [0, 0, 0]; n[a] = sg;
                out.push({ v, n });
            }
        } else if (p.k === 'rbox') {
            // скруглённая коробка (голова): радиус p.r, по 3 отсчёта на скругление — как Geo.roundBox
            const m = 3, h = [p.s[0] / 2, p.s[1] / 2, p.s[2] / 2], r = Math.min(p.r, h[0] * 0.95, h[1] * 0.95, h[2] * 0.95);
            const inner = [h[0] - r, h[1] - r, h[2] - r];
            const samples = (k) => {
                const o = [];
                for (let i = 0; i <= m; i++) o.push(-inner[k] - r * Math.cos(i * Math.PI / 2 / m));
                for (let i = 0; i <= m; i++) o.push(inner[k] + r * Math.sin(i * Math.PI / 2 / m));
                return o;
            };
            const S = [samples(0), samples(1), samples(2)];
            for (const [a, sgn, b, c] of [[0, 1, 2, 1], [0, -1, 2, 1], [1, 1, 0, 2], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 0, 1]]) {
                const pt = (i, j) => { const q = [0, 0, 0]; q[a] = sgn * h[a]; q[b] = S[b][i]; q[c] = S[c][j]; return q; };
                for (let i = 0; i < S[b].length - 1; i++) for (let j = 0; j < S[c].length - 1; j++) {
                    const v = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
                    const cen = [(v[0][0] + v[2][0]) / 2, (v[0][1] + v[2][1]) / 2, (v[0][2] + v[2][2]) / 2];
                    const d = [0, 1, 2].map((k) => cen[k] - clamp(cen[k], -inner[k], inner[k]));
                    const n = Math.hypot(d[0], d[1], d[2]) < 1e-6 ? [0, 0, 0] : norm3(d);
                    if (n[0] === 0 && n[1] === 0 && n[2] === 0) n[a] = sgn;
                    out.push({ v, n });
                }
            }
        } else if (p.k === 'cyl') {
            const t = p.t || 16, r0 = p.r, r1 = p.rt != null ? p.rt : p.r, h = p.h / 2;
            const slope = (r0 - r1) / p.h;
            const top = [], bot = [];
            for (let i = 0; i < t; i++) {
                const a0 = i / t * TAU, a1 = (i + 1) / t * TAU, am = (a0 + a1) / 2;
                out.push({ v: [[r0 * Math.cos(a0), -h, r0 * Math.sin(a0)], [r0 * Math.cos(a1), -h, r0 * Math.sin(a1)], [r1 * Math.cos(a1), h, r1 * Math.sin(a1)], [r1 * Math.cos(a0), h, r1 * Math.sin(a0)]],
                    n: norm3([Math.cos(am), slope, Math.sin(am)]) });
                top.push([r1 * Math.cos(a0), h, r1 * Math.sin(a0)]);
                bot.push([r0 * Math.cos(a0), -h, r0 * Math.sin(a0)]);
            }
            if (r1 > 0.05) out.push({ v: top, n: [0, 1, 0] });
            if (r0 > 0.05) out.push({ v: bot.reverse(), n: [0, -1, 0] });
        } else if (p.k === 'sph') {
            const rx = p.s[0] / 2, ry = p.s[1] / 2, rz = p.s[2] / 2, sl = p.sl || 1;
            const L = 7, M = 12;
            const pt = (i, j) => { const f = Math.PI * sl * i / L, th = j / M * TAU; return [rx * Math.sin(f) * Math.cos(th), ry * Math.cos(f), rz * Math.sin(f) * Math.sin(th)]; };
            for (let i = 0; i < L; i++) for (let j = 0; j < M; j++) {
                const v = [pt(i, j), pt(i, j + 1), pt(i + 1, j + 1), pt(i + 1, j)];
                const c = [(v[0][0] + v[2][0]) / 2, (v[0][1] + v[2][1]) / 2, (v[0][2] + v[2][2]) / 2];
                out.push({ v, n: norm3([c[0] / (rx * rx), c[1] / (ry * ry), c[2] / (rz * rz)]) });
            }
        } else if (p.k === 'tor') {
            const MJ = 16, MI = 6;
            const pt = (i, j) => { const th = i / MJ * TAU, f = j / MI * TAU, rr = p.R + p.r * Math.cos(f); return [rr * Math.cos(th), p.r * Math.sin(f), rr * Math.sin(th)]; };
            for (let i = 0; i < MJ; i++) for (let j = 0; j < MI; j++) {
                const th = (i + 0.5) / MJ * TAU, f = (j + 0.5) / MI * TAU;
                out.push({ v: [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)], n: [Math.cos(f) * Math.cos(th), Math.sin(f), Math.cos(f) * Math.sin(th)] });
            }
        }
        return out;
    };

    /** Список примитивов из определения формы (массив или { prims }). */
    const primsOf = (def) => (Array.isArray(def) ? def : (def && def.prims) || []);

    /**
     * Нарисовать примитивы ортографической проекцией в ctx: (ox, oy) — где на холсте начало координат модели, s — px на единицу,
     * yaw — поворот вокруг Y (нос +X уходит вправо экрана), pitch — взгляд сверху. Возвращает рамку { x0, y0, x1, y1 } в px холста.
     * dry: true — только посчитать рамку. fit: [sx, sy, sz, dy] — посадка на голову (HEAD_FIT) для шляп и деталей головы.
     */
    const drawPrims = (g, prims, o) => {
        const s = o.s || 1, ox = o.ox || 0, oy = o.oy || 0, yaw = o.yaw || 0, pitch = o.pitch || 0;
        const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        const view = (v) => { const x1 = v[0] * cy + v[2] * sy, z1 = -v[0] * sy + v[2] * cy; return [-z1, v[1] * cp - x1 * sp, x1 * cp + v[1] * sp]; };
        const L = norm3([-0.42, 0.78, 0.6]);
        const polys = [];
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of prims) {
            const rf = rotFn(p.rx || 0, p.ry || 0, p.rz || 0), pos = p.p || [0, 0, 0], sc = p.sc;
            const base = p.c || '#ffffff', em = p.e || 0, fit = o.fit;
            for (const f of primFaces(p)) {
                const wv = f.v.map((v) => {
                    const q = rf(sc ? [v[0] * sc[0], v[1] * sc[1], v[2] * sc[2]] : v);
                    const w = [q[0] + pos[0], q[1] + pos[1], q[2] + pos[2]];
                    return view(fit ? [w[0] * fit[0], w[1] * fit[1] + fit[3], w[2] * fit[2]] : w);
                });
                for (const q of wv) {
                    const X = ox + q[0] * s, Y = oy - q[1] * s;
                    if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
                }
                const nv = view(rf(f.n));
                if (nv[2] <= 0.02) continue;
                let depth = 0;
                for (const q of wv) depth += q[2];
                const d = Math.max(0, nv[0] * L[0] + nv[1] * L[1] + nv[2] * L[2]);
                let k = 0.6 + 0.55 * d;
                k = k * (1 - em) + 1.05 * em;
                polys.push({ pts: wv, depth: depth / wv.length, color: sh(base, k) });
            }
        }
        if (!o.dry) {
            polys.sort((a, b) => a.depth - b.depth);
            g.lineJoin = 'round'; g.lineWidth = 1;
            for (const pl of polys) {
                g.beginPath();
                pl.pts.forEach((q, i) => { const X = ox + q[0] * s, Y = oy - q[1] * s; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
                g.closePath();
                g.fillStyle = pl.color; g.strokeStyle = pl.color;
                g.fill(); g.stroke();
            }
        }
        return { x0, y0, x1, y1 };
    };

    // ---------------------------------------------------------------------------------------------
    // УЗОРЫ скинов: рисуются поверх базового цвета на холсте W×H (верх холста = верх детали)
    // ---------------------------------------------------------------------------------------------
    const RAINBOW = ['#ff4d4d', '#ff9f1c', '#ffe14d', '#4cd964', '#4cc9f0', '#7b61ff'];
    const PATTERNS = {
        stripes(g, W, H, z) { const n = z.n || 6; g.fillStyle = z.c2; for (let i = 1; i < n; i += 2) g.fillRect(0, Math.round(i * H / n), W, Math.ceil(H / n)); },
        vstripes(g, W, H, z) { const n = z.n || 6; g.fillStyle = z.c2; for (let i = 1; i < n; i += 2) g.fillRect(Math.round(i * W / n), 0, Math.ceil(W / n), H); },
        band(g, W, H, z) { g.fillStyle = z.c2; g.fillRect(0, H * 0.4, W, H * 0.2); g.fillStyle = rgba('#ffffff', 0.5); g.fillRect(0, H * 0.4, W, 2); },
        plaid(g, W, H, z) {
            g.globalAlpha = 0.6; g.fillStyle = z.c2;
            for (const v of [6, 38]) { g.fillRect(v * W / 64, 0, 14 * W / 64, H); g.fillRect(0, v * H / 64, W, 14 * H / 64); }
            g.globalAlpha = 0.35; g.fillStyle = '#ffffff';
            for (const v of [22, 54]) { g.fillRect(v * W / 64, 0, 2, H); g.fillRect(0, v * H / 64, W, 2); }
            g.globalAlpha = 1;
        },
        checker(g, W, H, z) { const n = z.n || 4; g.fillStyle = z.c2; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((i + j) % 2) g.fillRect(i * W / n, j * H / n, W / n, H / n); },
        dots(g, W, H, z) {
            const n = z.n || 4, r = W / (n * 2.6);
            for (let j = 0; j < n + 1; j++) for (let i = 0; i < n + 1; i++) {
                g.fillStyle = (i + j) % 2 && z.c3 ? z.c3 : z.c2;
                g.beginPath(); g.arc((i + (j % 2 ? 0.5 : 0)) * W / n, j * H / n, r, 0, TAU); g.fill();
            }
        },
        camo(g, W, H, z) {
            const r = rng(seedOf(z.c + z.c2));
            for (let i = 0; i < 18; i++) {
                g.fillStyle = i % 3 === 2 && z.c3 ? z.c3 : z.c2;
                g.beginPath(); g.ellipse(r() * W, r() * H, 7 + r() * 11, 5 + r() * 8, r() * Math.PI, 0, TAU); g.fill();
            }
        },
        tiger(g, W, H, z) {
            const r = rng(seedOf(z.c2 + 't'));
            g.fillStyle = z.c2;
            for (let i = 0; i < 8; i++) {
                const x = (i + r() * 0.5) * W / 8, hh = 10 + r() * 20, w = 4 + r() * 4;
                g.beginPath(); g.moveTo(x, 0); g.lineTo(x + w, 0); g.lineTo(x + w * 0.5 + (r() - 0.5) * 6, hh); g.closePath(); g.fill();
                const x2 = (i + 0.3 + r() * 0.5) * W / 8, h2 = 8 + r() * 22;
                g.beginPath(); g.moveTo(x2, H); g.lineTo(x2 + w, H); g.lineTo(x2 + w * 0.5 + (r() - 0.5) * 6, H - h2); g.closePath(); g.fill();
            }
            g.fillRect(0, H * 0.46, W * 0.35, 4); g.fillRect(W * 0.55, H * 0.52, W * 0.45, 4);
        },
        spots(g, W, H, z) {
            const r = rng(seedOf(z.c2 + 's'));
            g.fillStyle = z.c2;
            for (let i = 0; i < 5; i++) {
                const x = r() * W, y = r() * H;
                g.beginPath(); g.ellipse(x, y, 7 + r() * 8, 6 + r() * 7, r() * 3, 0, TAU); g.fill();
                g.beginPath(); g.ellipse(x + 6, y - 4, 5 + r() * 4, 4 + r() * 4, r() * 3, 0, TAU); g.fill();
            }
        },
        flames(g, W, H, z) {
            const gr = g.createLinearGradient(0, H * 0.35, 0, H);
            gr.addColorStop(0, rgba(z.c2, 0)); gr.addColorStop(1, rgba(z.c2, 0.75));
            g.fillStyle = gr; g.fillRect(0, 0, W, H);
            const r = rng(seedOf('fl' + z.c2));
            for (let i = 0; i < 6; i++) {
                const x = (i + 0.5) * W / 6, hh = 20 + r() * 22;
                g.fillStyle = z.c2;
                g.beginPath(); g.moveTo(x - 7, H); g.quadraticCurveTo(x - 6, H - hh * 0.5, x, H - hh); g.quadraticCurveTo(x + 6, H - hh * 0.5, x + 7, H); g.fill();
                g.fillStyle = z.c3 || '#ffd23f';
                g.beginPath(); g.moveTo(x - 3.5, H); g.quadraticCurveTo(x - 3, H - hh * 0.3, x, H - hh * 0.55); g.quadraticCurveTo(x + 3, H - hh * 0.3, x + 3.5, H); g.fill();
            }
        },
        gradient(g, W, H, z) { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, z.c); gr.addColorStop(1, z.c2); g.fillStyle = gr; g.fillRect(0, 0, W, H); },
        galaxy(g, W, H, z) {
            const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, z.c); gr.addColorStop(1, sh(z.c, 0.5)); g.fillStyle = gr; g.fillRect(0, 0, W, H);
            const r = rng(seedOf('gx' + z.c));
            for (let i = 0; i < 3; i++) {
                const x = r() * W, y = r() * H, rad = 14 + r() * 14, rg = g.createRadialGradient(x, y, 0, x, y, rad);
                rg.addColorStop(0, rgba(z.c3 || '#9d6bff', 0.55)); rg.addColorStop(1, rgba(z.c3 || '#9d6bff', 0));
                g.fillStyle = rg; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
            }
            for (let i = 0; i < 28; i++) { g.fillStyle = rgba(z.c2, 0.5 + r() * 0.5); const s = r() < 0.2 ? 3 : 2; g.fillRect(Math.floor(r() * W), Math.floor(r() * H), s, s); }
        },
        pixel(g, W, H, z) {
            const n = 8, r = rng(seedOf('px' + z.c));
            const cols = [z.c, z.c, z.c2, z.c3 || z.c2];
            for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(i * W / n, j * H / n, W / n + 0.5, H / n + 0.5); }
        },
        rainbow(g, W, H) { const n = RAINBOW.length; for (let i = 0; i < n; i++) { g.fillStyle = RAINBOW[i]; g.fillRect(0, Math.floor(i * H / n), W, Math.ceil(H / n)); } },
        grid(g, W, H, z) {
            for (const [pass, a] of [[7, 0.28], [3, 1]]) {
                g.lineWidth = pass;
                g.strokeStyle = rgba(z.c2, a);
                for (let y = H / 8; y < H; y += H / 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
                g.strokeStyle = rgba(z.c3 || z.c2, a);
                for (let x = W / 8; x < W; x += W / 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
            }
        },
        scales(g, W, H, z) {
            const R = W / 6;
            g.strokeStyle = z.c2; g.fillStyle = rgba(z.c2, 0.25); g.lineWidth = 2;
            for (let j = -1; j < 8; j++) for (let i = -1; i < 7; i++) {
                g.beginPath(); g.arc((i + (j % 2 ? 0.5 : 0)) * R * 2, j * R, R, 0, Math.PI); g.fill(); g.stroke();
            }
        },
        circuit(g, W, H, z) {
            const r = rng(seedOf('cc' + z.c2));
            g.strokeStyle = z.c2; g.fillStyle = z.c2; g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round';
            for (let i = 0; i < 6; i++) {
                let x = Math.floor(r() * 4) * W / 4 + 8, y = Math.floor(r() * 4) * H / 4 + 8;
                g.beginPath(); g.moveTo(x, y);
                for (let k = 0; k < 3; k++) { if (k % 2) y += (r() < 0.5 ? -1 : 1) * 12; else x += (r() < 0.5 ? -1 : 1) * 14; g.lineTo(x, y); }
                g.stroke(); g.beginPath(); g.arc(x, y, 3.4, 0, TAU); g.fill();
            }
            g.globalAlpha = 0.55; g.fillRect(W * 0.55, H * 0.12, 14, 9); g.fillRect(W * 0.1, H * 0.62, 12, 12); g.globalAlpha = 1;
        },
        patches(g, W, H, z) {
            const r = rng(seedOf('pt' + z.c2));
            for (let i = 0; i < 4; i++) {
                const x = r() * (W - 22), y = r() * (H - 22), w = 12 + r() * 10, h = 12 + r() * 10;
                g.fillStyle = z.c2; g.fillRect(x, y, w, h);
                g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1.6; g.setLineDash([3, 3]); g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3); g.setLineDash([]);
            }
        },
        argyle(g, W, H, z) {
            const n = 4, cw = W / n, ch = H / n;
            g.fillStyle = z.c2;
            for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
                if ((i + j) % 2) continue;
                g.beginPath(); g.moveTo(i * cw, j * ch - ch / 2 * 1.9); g.lineTo(i * cw + cw / 2 * 1.9, j * ch); g.lineTo(i * cw, j * ch + ch / 2 * 1.9); g.lineTo(i * cw - cw / 2 * 1.9, j * ch); g.closePath(); g.fill();
            }
            g.strokeStyle = z.c3 || '#ffffff'; g.lineWidth = 1.6; g.globalAlpha = 0.85;
            for (let k = -n; k <= n * 2; k++) {
                g.beginPath(); g.moveTo(k * cw, 0); g.lineTo(k * cw + W, H); g.stroke();
                g.beginPath(); g.moveTo(k * cw, 0); g.lineTo(k * cw - W, H); g.stroke();
            }
            g.globalAlpha = 1;
        },
    };

    // ---------------------------------------------------------------------------------------------
    // СКИН: зоны и особенности головы
    // ---------------------------------------------------------------------------------------------
    const ZONES = ['head', 'chest', 'belt', 'sleeve', 'arm', 'hand', 'thigh', 'shin', 'foot'];
    /** Индексы частей Noob.PARTS по зонам. */
    const ZONE_PARTS = { head: [2], belt: [0], chest: [1], sleeve: [3, 6], arm: [4, 7], hand: [5, 8], thigh: [9, 12], shin: [10, 13], foot: [11, 14] };
    const ZONE_FALLBACK = { belt: 'chest', arm: 'sleeve', hand: 'arm', shin: 'thigh', foot: 'shin' };
    // Стартовый вид — герой: персиковая кожа, коралловое худи с длинными рукавами, синие джинсы, белые кеды (как Noob.COLORS);
    // волосы, наушники, капюшон и рюкзак — детали модели (Noob.heroParts), на других скинах они прячутся.
    const CLASSIC = { head: '#f7c8a4', chest: '#f0544c', belt: '#d4403c', sleeve: '#f0544c', arm: '#f0544c', hand: '#f7c8a4', thigh: '#2f3f66', shin: '#2f3f66', foot: '#faf7f2' };

    /** Зоны скина в нормальном виде { c, k?, c2?, c3?, n?, e?, … } (недостающие берутся по цепочке, затем классические). */
    const FILL = 0.16;   // мягкая подсветка тела персонажа (доля своего цвета), как у Noob.build
    const resolveSkin = (art) => {
        const out = {};
        for (const z of ZONES) {
            let v = art ? art[z] : CLASSIC[z];
            if (v == null && ZONE_FALLBACK[z]) v = out[ZONE_FALLBACK[z]];
            if (v == null) v = CLASSIC[z] || CLASSIC.chest;
            out[z] = typeof v === 'string' ? { c: v } : v;
        }
        return out;
    };
    const zoneKey = (z) => JSON.stringify(z);

    /** Рисует зону 64×64 (деталь тела): базовый цвет + узор. */
    const paintZone = (g, W, H, z) => {
        g.fillStyle = z.c; g.fillRect(0, 0, W, H);
        if (z.k && PATTERNS[z.k]) PATTERNS[z.k](g, W, H, z);
    };

    /** Голова модели: скруглённая коробка 44×44×50 с радиусом 17.5 (Noob.PARTS) — по ней огибаются пластины лба. */
    const HEAD_BOX = [44, 44, 50, 17.5];
    /**
     * Особенности головы скина (волосы, повязка, забрало, полоски) — тонкие детали из примитивов: голова — скруглённая коробка 44×44×50
     * с общей текстурой на всех гранях, поэтому узор на неё не кладётся. Координаты — в осях головы (центр — центр, нос +X, верх y = 22).
     * hair — купол волос от y = hairY до макушки (sph, sl 0.5: низ купола — в p); band/visor — пластина на лбу спереди (patch: огибает
     * скругление головы, y0..y1); stripes — полоски на макушке.
     */
    const headPrims = (z) => {
        const out = [];
        if (z.hair) {
            const y0 = Math.max(9.6, z.hairY != null ? z.hairY : 9.6);
            out.push({ k: 'sph', s: [48, (27 - y0) * 2, 55], sl: 0.5, p: [-1, y0, 0], c: z.hair });
        }
        for (const [plate, w] of [[z.band, 40], [z.visor, 46]]) {
            if (plate) out.push({ k: 'patch', s: [0.3, plate[1] - plate[0], w], p: [22.12, (plate[0] + plate[1]) / 2, 0], y0: plate[0], y1: plate[1], c: plate[2] });
        }
        if (z.stripes) {
            const n = z.stripes[0];
            for (let i = 0; i < n; i++) out.push({ k: 'box', s: [18, 1.2, 3.8], p: [0, 22.2, (i - (n - 1) / 2) * (20 / Math.max(1, n - 1))], c: z.stripes[1] });
        }
        return out;
    };

    // ---------------------------------------------------------------------------------------------
    // ЛИЦА: рисунки на холсте 256×144 (глаза у x 94/161, y 43; рот — как у Noob.faceMaterial)
    // ---------------------------------------------------------------------------------------------
    const INK = '#111';
    const FACES = (() => {
        const oval = (g, x, y, rx, ry, col) => { g.fillStyle = col || INK; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill(); };
        const arc = (g, x, y, r, a0, a1, lw, col) => { g.strokeStyle = col || INK; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke(); };
        const line = (g, x0, y0, x1, y1, lw, col) => { g.strokeStyle = col || INK; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
        const eyes = (g, dy, s) => { oval(g, 94.7, 43 + (dy || 0), 10.75 * (s || 1), 21.6 * (s || 1)); oval(g, 161.3, 43 + (dy || 0), 10.75 * (s || 1), 21.6 * (s || 1)); };
        const smile = (g, dy, s) => arc(g, 128, 43 + (dy || 0), 56.3 * (s || 1), Math.PI * 0.2, Math.PI * 0.8, 10.8 * (s || 1));
        const heart = (g, x, y, s, fill, stroke) => {
            g.beginPath(); g.moveTo(x, y + s * 0.95);
            g.bezierCurveTo(x - s * 1.7, y + s * 0.1, x - s * 1.05, y - s * 1.05, x, y - s * 0.4);
            g.bezierCurveTo(x + s * 1.05, y - s * 1.05, x + s * 1.7, y + s * 0.1, x, y + s * 0.95); g.closePath();
            g.fillStyle = fill; g.fill();
            if (stroke) { g.strokeStyle = stroke; g.lineWidth = 5; g.lineJoin = 'round'; g.stroke(); }
        };
        const star = (g, x, y, R, r, fill, stroke) => {
            g.beginPath();
            for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r : R; if (i) g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); else g.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
            g.closePath(); g.fillStyle = fill; g.fill();
            if (stroke) { g.strokeStyle = stroke; g.lineWidth = 5; g.lineJoin = 'round'; g.stroke(); }
        };
        const grinMouth = (g, x0, x1, y0, depth, lw) => {
            g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, y0 + depth * 2, x1, y0); g.closePath();
            g.fillStyle = '#5a1a24'; g.fill();
            g.save(); g.clip(); g.fillStyle = '#fff'; g.fillRect(x0, y0, x1 - x0, depth * 0.38); g.restore();
            g.strokeStyle = INK; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke();
        };
        return {
            smile(g, W, H) {   // «Улыбка» по умолчанию — рисунок самой модели (Noob.drawFace); без неё — простые глаза и улыбка
                if (typeof Noob !== 'undefined' && typeof Noob.drawFace === 'function') Noob.drawFace(g, W, H);
                else { eyes(g); smile(g); }
            },
            grin(g) { eyes(g, -3); grinMouth(g, 68, 188, 68, 34, 9); },
            wink(g) { oval(g, 94.7, 43, 10.75, 21.6); arc(g, 161.3, 54, 15, Math.PI * 1.1, Math.PI * 1.9, 9); smile(g); },
            cool(g) {
                g.fillStyle = INK; rrect(g, 50, 18, 68, 46, 13); g.fill(); rrect(g, 138, 18, 68, 46, 13); g.fill();
                g.fillRect(112, 28, 32, 9); g.fillRect(34, 26, 20, 8); g.fillRect(202, 26, 20, 8);
                g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 5; g.lineCap = 'round';
                g.beginPath(); g.moveTo(62, 48); g.lineTo(80, 28); g.moveTo(150, 48); g.lineTo(168, 28); g.stroke();
                arc(g, 128, 54, 46, Math.PI * 0.22, Math.PI * 0.78, 9);
            },
            kawaii(g) {
                oval(g, 86, 48, 14, 25); oval(g, 170, 48, 14, 25);
                oval(g, 81, 37, 6, 7, '#fff'); oval(g, 165, 37, 6, 7, '#fff'); oval(g, 91, 58, 3.4, 3.4, '#fff'); oval(g, 175, 58, 3.4, 3.4, '#fff');
                oval(g, 50, 84, 18, 10, 'rgba(255,93,115,.6)'); oval(g, 206, 84, 18, 10, 'rgba(255,93,115,.6)');
                arc(g, 118, 78, 10, 0, Math.PI, 6); arc(g, 138, 78, 10, 0, Math.PI, 6);
            },
            angry(g) {
                oval(g, 94.7, 54, 9, 14); oval(g, 161.3, 54, 9, 14);
                line(g, 62, 26, 118, 46, 12); line(g, 194, 26, 138, 46, 12);
                arc(g, 128, 122, 36, Math.PI * 1.18, Math.PI * 1.82, 10);
            },
            hearts(g) { heart(g, 92, 46, 17, '#ff2d55', INK); heart(g, 164, 46, 17, '#ff2d55', INK); smile(g, 4, 0.92); },
            robot(g) {
                for (const x of [60, 144]) {
                    g.fillStyle = '#37e2ff'; rrect(g, x, 20, 52, 46, 7); g.fill(); g.strokeStyle = INK; g.lineWidth = 7; g.stroke();
                    g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(x + 7, 27, 17, 8);
                }
                g.fillStyle = '#0b132b'; rrect(g, 80, 84, 96, 36, 6); g.fill(); g.strokeStyle = INK; g.lineWidth = 6; g.stroke();
                g.strokeStyle = '#37e2ff'; g.lineWidth = 4;
                for (let x = 96; x < 170; x += 16) { g.beginPath(); g.moveTo(x, 88); g.lineTo(x, 116); g.stroke(); }
            },
            surprised(g) {
                for (const x of [92, 164]) { oval(g, x, 46, 19, 24, '#fff'); g.strokeStyle = INK; g.lineWidth = 6; g.beginPath(); g.ellipse(x, 46, 19, 24, 0, 0, TAU); g.stroke(); oval(g, x + 1, 48, 7, 9); }
                arc(g, 92, 16, 15, Math.PI * 1.15, Math.PI * 1.85, 7); arc(g, 164, 16, 15, Math.PI * 1.15, Math.PI * 1.85, 7);
                oval(g, 128, 100, 15, 21, '#5a1a24'); g.strokeStyle = INK; g.lineWidth = 8; g.beginPath(); g.ellipse(128, 100, 15, 21, 0, 0, TAU); g.stroke();
            },
            sleepy(g) {
                arc(g, 92, 46, 16, Math.PI * 0.12, Math.PI * 0.88, 9); arc(g, 164, 46, 16, Math.PI * 0.12, Math.PI * 0.88, 9);
                oval(g, 128, 94, 10, 8, '#5a1a24'); g.strokeStyle = INK; g.lineWidth = 6; g.beginPath(); g.ellipse(128, 94, 10, 8, 0, 0, TAU); g.stroke();
                g.strokeStyle = '#3a86ff'; g.lineWidth = 6; g.lineJoin = 'round'; g.lineCap = 'round';
                g.beginPath(); g.moveTo(200, 12); g.lineTo(224, 12); g.lineTo(200, 40); g.lineTo(224, 40); g.stroke();
                g.lineWidth = 4.5; g.beginPath(); g.moveTo(228, 2); g.lineTo(243, 2); g.lineTo(228, 20); g.lineTo(243, 20); g.stroke();
            },
            tongue(g) {
                arc(g, 94.7, 56, 15, Math.PI * 1.12, Math.PI * 1.88, 9); arc(g, 161.3, 56, 15, Math.PI * 1.12, Math.PI * 1.88, 9);
                g.fillStyle = '#ff6f91'; g.beginPath(); g.moveTo(112, 84); g.lineTo(112, 108); g.arc(124, 108, 12, Math.PI, 0, true); g.lineTo(136, 84); g.closePath();
                g.fill(); g.strokeStyle = INK; g.lineWidth = 5; g.lineJoin = 'round'; g.stroke(); line(g, 124, 94, 124, 108, 3.5, '#c93f66');
                smile(g, 0, 1);
            },
            cat(g) {
                oval(g, 90, 44, 9, 22); oval(g, 166, 44, 9, 22);
                oval(g, 90, 38, 3, 9, '#fff'); oval(g, 166, 38, 3, 9, '#fff');
                g.fillStyle = '#ff7a9c'; g.beginPath(); g.moveTo(120, 66); g.lineTo(136, 66); g.lineTo(128, 77); g.closePath(); g.fill();
                arc(g, 117, 80, 11, 0, Math.PI, 6); arc(g, 139, 80, 11, 0, Math.PI, 6);
                for (const dy of [-8, 4, 16]) { line(g, 60, 76 + dy, 18, 70 + dy * 1.4, 4); line(g, 196, 76 + dy, 238, 70 + dy * 1.4, 4); }
            },
            nerd(g) {
                g.strokeStyle = INK; g.lineWidth = 7;
                for (const x of [90, 166]) { g.beginPath(); g.arc(x, 48, 31, 0, TAU); g.stroke(); g.fillStyle = 'rgba(255,255,255,.35)'; g.fill(); }
                line(g, 120, 46, 136, 46, 7); line(g, 62, 38, 26, 30, 6); line(g, 194, 38, 230, 30, 6);
                oval(g, 92, 50, 7, 12); oval(g, 164, 50, 7, 12);
                arc(g, 128, 70, 36, Math.PI * 0.25, Math.PI * 0.75, 8);
                g.fillStyle = '#fff'; g.fillRect(120, 100, 16, 16); g.strokeStyle = INK; g.lineWidth = 4; g.strokeRect(120, 100, 16, 16); line(g, 128, 100, 128, 116, 3);
            },
            mustache(g) {
                eyes(g, -8, 0.85);
                g.fillStyle = INK;
                for (const sg of [-1, 1]) {
                    g.beginPath(); g.moveTo(128, 74);
                    g.bezierCurveTo(128 + sg * 22, 60, 128 + sg * 52, 60, 128 + sg * 66, 78);
                    g.bezierCurveTo(128 + sg * 70, 62, 128 + sg * 58, 52, 128 + sg * 50, 56);
                    g.bezierCurveTo(128 + sg * 70, 88, 128 + sg * 28, 100, 128, 90);
                    g.closePath(); g.fill();
                }
                arc(g, 128, 88, 17, Math.PI * 0.22, Math.PI * 0.78, 6);
            },
            cyclops(g) {
                g.fillStyle = '#fff'; g.beginPath(); g.ellipse(128, 48, 40, 32, 0, 0, TAU); g.fill();
                g.strokeStyle = INK; g.lineWidth = 8; g.stroke();
                oval(g, 128, 50, 19, 19, '#2b83ff'); oval(g, 128, 50, 9, 9); oval(g, 122, 43, 4, 4, '#fff');
                arc(g, 128, 66, 44, Math.PI * 0.2, Math.PI * 0.8, 9);
                g.fillStyle = '#fff'; g.fillRect(118, 105, 20, 12); g.strokeStyle = INK; g.lineWidth = 3.5; g.strokeRect(118, 105, 20, 12);
            },
            pirate(g) {
                oval(g, 94.7, 43, 10.75, 21.6);
                line(g, 148, 28, 0, 6, 8); line(g, 184, 28, 256, 8, 8);
                oval(g, 166, 50, 24, 28);
                smile(g, 4, 0.95);
                g.fillStyle = '#ffd23f'; g.fillRect(150, 82, 11, 14); g.strokeStyle = INK; g.lineWidth = 3; g.strokeRect(150, 82, 11, 14);
            },
            stars(g) { star(g, 92, 46, 28, 12, '#ffd23f', INK); star(g, 164, 46, 28, 12, '#ffd23f', INK); grinMouth(g, 84, 172, 84, 22, 8); },
            vampire(g) {
                oval(g, 94.7, 44, 11, 21, '#e51c23'); oval(g, 161.3, 44, 11, 21, '#e51c23'); oval(g, 94.7, 44, 3.4, 15); oval(g, 161.3, 44, 3.4, 15);
                smile(g, 2, 1);
                g.fillStyle = '#fff'; g.strokeStyle = INK; g.lineWidth = 3.5; g.lineJoin = 'round';
                for (const x of [100, 138]) { g.beginPath(); g.moveTo(x, 84); g.lineTo(x + 18, 84); g.lineTo(x + 9, 108); g.closePath(); g.fill(); g.stroke(); }
            },
            money(g) {
                g.font = '900 78px Rubik, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
                for (const x of [92, 164]) { g.lineWidth = 8; g.strokeStyle = INK; g.lineJoin = 'round'; g.strokeText('$', x, 48); g.fillStyle = '#22d05a'; g.fillText('$', x, 48); }
                grinMouth(g, 80, 176, 86, 20, 8);
            },
            evil(g) {
                line(g, 58, 20, 118, 48, 13); line(g, 198, 20, 138, 48, 13);
                for (const sg of [-1, 1]) {
                    g.fillStyle = '#ff2d2d'; g.beginPath(); g.moveTo(128 + sg * 14, 54); g.lineTo(128 + sg * 62, 38); g.lineTo(128 + sg * 52, 66); g.closePath(); g.fill();
                    g.strokeStyle = INK; g.lineWidth = 5; g.lineJoin = 'round'; g.stroke();
                }
                g.beginPath(); g.moveTo(64, 82); g.quadraticCurveTo(128, 140, 192, 82); g.closePath(); g.fillStyle = '#3b0a10'; g.fill();
                g.save(); g.clip(); g.fillStyle = '#fff';
                for (let x = 70; x < 190; x += 20) { g.beginPath(); g.moveTo(x, 80); g.lineTo(x + 20, 80); g.lineTo(x + 10, 100); g.closePath(); g.fill(); }
                g.restore(); g.strokeStyle = INK; g.lineWidth = 8; g.lineJoin = 'round'; g.beginPath(); g.moveTo(64, 82); g.quadraticCurveTo(128, 140, 192, 82); g.closePath(); g.stroke();
            },
            ghost(g) { oval(g, 90, 50, 15, 29); oval(g, 166, 50, 15, 29); oval(g, 128, 104, 13, 20); oval(g, 90, 44, 4, 7, 'rgba(255,255,255,.5)'); oval(g, 166, 44, 4, 7, 'rgba(255,255,255,.5)'); },
        };
    })();

    /** Лицо в холст W×H: по ключу k (процедурное) или из картинки img (обрезана по рисунку, вписана с полями). false — картинка ещё грузится. */
    const drawFace = (g, W, H, art) => {
        if (art && art.img) {
            const t = trimmed(art.img);
            if (!t) return false;
            const s = Math.min(W * 0.9 / t.width, H * 0.9 / t.height), w = t.width * s, h = t.height * s;
            g.drawImage(t, (W - w) / 2, (H - h) / 2, w, h);
            return true;
        }
        const f = art && FACES[art.k];
        if (f) {
            // свои рисунки лежат в верхней части холста — чуть ниже, чтобы лицо стояло по центру наклейки (36×20 на голове)
            if (art.k === 'smile') f(g, W, H, art);
            else { g.save(); g.translate(0, 8); f(g, W, H, art); g.restore(); }
        }
        return true;
    };

    /** @type {Map<string, HTMLCanvasElement>} */
    const DECALS = new Map();
    /** Рисунок на груди/спине на холсте size×size: картинка-маска, умноженная на цвет c, или надпись text. null — картинка ещё грузится. */
    const drawDecal = (d, size) => {
        const key = JSON.stringify([d.src || d.text, d.c, d.o, size]);
        const hit = DECALS.get(key);
        if (hit) return hit;
        let c = null;
        if (d.text) {
            c = mkCanvas(size, size);
            const g = ctxOf(c);
            g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
            g.font = '900 ' + size * (d.text.length > 2 ? 0.5 : 0.74) + 'px Rubik, "Arial Black", Impact, sans-serif';
            g.lineWidth = size * 0.09; g.strokeStyle = d.o || '#000000'; g.strokeText(d.text, size / 2, size * 0.54);
            g.fillStyle = d.c || '#ffffff'; g.fillText(d.text, size / 2, size * 0.54);
        } else {
            const img = loadImg(d.src);
            if (img) c = tinted(img, d.c, size, size);
        }
        if (c) DECALS.set(key, c);
        return c;
    };

    // ---------------------------------------------------------------------------------------------
    // ШЛЯПЫ: примитивы в осях головы-цилиндра (центр — центр головы, верх y = 21, нос +X); на голову-коробку сажаются масштабом HEAD_FIT
    // ---------------------------------------------------------------------------------------------
    const HATS = {
        cap: (c) => [
            Sp([46, 26, 46], [0, 15, 0], c[0], { sl: 0.5 }),
            Bx([22, 2.6, 32], [27, 15.4, 0], c[1], { rz: -0.16 }),
            Sp(D(4.5), [0, 28, 0], c[0]),
        ],
        beanie: (c) => [
            Sp([46, 32, 46], [0, 14, 0], c[0], { sl: 0.5 }),
            Cy(23.4, 23.4, 7, [0, 16, 0], c[1]),
            Sp(D(11), [0, 32, 0], c[2]),
        ],
        bucket: (c) => [
            Cy(22, 17, 14, [0, 22.5, 0], c[0]),
            Cy(36, 23, 4, [0, 16.5, 0], c[0]),
            Cy(22.5, 21.6, 3.4, [0, 19.4, 0], c[1]),
        ],
        top: (c) => [
            Cy(30, 30, 2.5, [0, 16, 0], c[0]),
            Cy(19, 18, 26, [0, 29.5, 0], c[0]),
            Cy(19.4, 18.6, 5, [0, 22, 0], c[1]),
        ],
        crown: (c) => {
            const out = [Cy(21.8, 21.8, 7, [0, 18, 0], c[0], { e: 0.12 })];
            for (let k = 0; k < 5; k++) {
                const a = k * TAU / 5, x = 17 * Math.cos(a), z = 17 * Math.sin(a);
                out.push(Cy(4.8, 0.3, 13, [x, 28, z], c[0], { e: 0.12, t: 8 }));
                out.push(Sp(D(4.6), [x, 35, z], k % 2 ? c[2] : c[1], { e: 0.25 }));
            }
            out.push(Sp([5, 7, 5], [21.8, 17.5, 0], c[1], { e: 0.3 }));
            return out;
        },
        viking: (c) => {
            const horn = (sg) => {
                const a = limb([0, 17, sg * 20.5], [0, 0.55, sg * 0.83], 11, 4.8, 3.3, c[1]);
                const b = limb(a.end, [0, 0.95, sg * 0.3], 12, 3.3, 0.5, c[1]);
                return [a.prim, b.prim];
            };
            return [
                Sp([46, 30, 46], [0, 14, 0], c[0], { sl: 0.5 }),
                Cy(23.4, 23.4, 4, [0, 14.8, 0], c[2]),
                Bx([34, 2.4, 3.6], [0, 28.2, 0], c[2]),
                ...horn(1), ...horn(-1),
            ];
        },
        wizard: (c) => [
            Cy(34, 34, 2.4, [0, 15.5, 0], c[0]),
            Cy(20, 6.5, 26, [0, 29, 0], c[0]),
            Cy(20.4, 19.2, 3.6, [0, 18.5, 0], c[1]),
            Cy(6.5, 0.3, 14, [-4.5, 47.5, 0], c[0], { rz: 0.45 }),
            Sp(D(4.5), [16, 26, 3.5], c[2], { e: 0.5 }), Sp(D(3.6), [12.4, 33, -4], c[2], { e: 0.5 }), Sp(D(3), [9.8, 38, 2], c[2], { e: 0.5 }),
        ],
        cone: (c) => [
            Bx([40, 3, 40], [0, 17, 0], c[0]),
            Cy(16, 5, 30, [0, 34, 0], c[0]),
            Cy(13.2, 10.6, 7, [0, 31, 0], c[1]),
        ],
        party: (c) => {
            const r = (y) => 17 * (1 - (y - 19) / 34);
            const out = [Cy(17, 0.5, 34, [0, 36, 0], c[0], { t: 14 })];
            for (const y of [26, 34, 42]) out.push(Cy(r(y - 1.7) + 0.5, r(y + 1.7) + 0.5, 3.4, [0, y, 0], c[1], { t: 14 }));
            out.push(Sp(D(9), [0, 54, 0], c[2]));
            return out;
        },
        chef: (c) => [
            Cy(22, 22, 9, [0, 19.5, 0], c[0]),
            Sp([30, 24, 30], [0, 34, 0], c[0]),
            Sp(D(16), [13, 30, 0], c[1]), Sp(D(16), [-13, 30, 0], c[1]), Sp(D(16), [0, 30, 13], c[1]), Sp(D(16), [0, 30, -13], c[1]),
            Sp(D(17), [0, 45, 0], c[0]),
        ],
        hard: (c) => [
            Sp([46, 32, 46], [0, 14.5, 0], c[0], { sl: 0.5 }),
            Cy(25, 25, 2.2, [0, 15, 0], c[0]),
            Bx([18, 2.2, 30], [28, 15.4, 0], c[0], { rz: -0.1 }),
            Bx([44, 3.6, 7], [0, 30.2, 0], c[1]),
            Sp(D(7), [21.5, 23, 0], '#ffffff', { e: 0.8 }),
        ],
        catears: (c) => {
            const out = arcBand(22.6, -1.3, 1.3, 9, 4.2, 3, c[0]);
            for (const sg of [-1, 1]) {
                out.push(Cy(9.4, 0.3, 18, [0, 24.6, sg * 13.4], c[1], { sc: [0.5, 1, 1], ...along([0, 0.85, sg * 0.5]), t: 8 }));
                out.push(Cy(5.6, 0.2, 12.5, [2.2, 23.4, sg * 13.6], c[2], { sc: [0.4, 1, 1], ...along([0, 0.85, sg * 0.5]), t: 8 }));
            }
            return out;
        },
        cowboy: (c) => [
            Cy(33, 33, 2.2, [0, 15.5, 0], c[0]),
            Bx([50, 2.2, 16], [0, 18.6, 35], c[0], { rx: -0.45 }), Bx([50, 2.2, 16], [0, 18.6, -35], c[0], { rx: 0.45 }),
            Cy(20.5, 17, 18, [0, 24.5, 0], c[0]),
            Bx([32, 3, 4.6], [0, 33.6, 0], sh(c[0], 0.78)),
            Cy(20.9, 20.3, 4, [0, 18.6, 0], c[1]),
            Bx([1.6, 4.6, 5.6], [21, 18.6, 0], c[2], { e: 0.25 }),
        ],
        duck: (c) => [
            Sp([36, 22, 28], [-1, 28.5, 0], c[0]),
            Sp([18, 16, 16], [10, 40, 0], c[0]),
            Sp([9, 4, 9], [18.5, 38.4, 0], c[1]),
            Sp(D(3), [16.6, 42.4, 6], '#111122'), Sp(D(3), [16.6, 42.4, -6], '#111122'),
            Cy(5.5, 0.3, 10, [-19, 33, 0], c[0], { rz: 1.2, t: 8 }),
            Sp([16, 9, 4], [-2, 29, 13.5], sh(c[0], 0.9)), Sp([16, 9, 4], [-2, 29, -13.5], sh(c[0], 0.9)),
        ],
        santa: (c) => {
            const a = limb([0, 33, 0], [-0.7, 0.7, 0], 12, 11.5, 8.5, c[0]);
            const b = limb(a.end, [-0.9, -0.45, 0], 14, 8.5, 5.5, c[0]);
            return [
                Cy(23, 23, 7, [0, 17.5, 0], c[1]),
                Cy(21, 12, 16, [0, 28, 0], c[0]),
                a.prim, b.prim,
                Sp(D(11), [b.end[0] - 2, b.end[1] - 3, 0], c[1]),
            ];
        },
        prop: (c) => ({
            prims: [
                Sp([46, 26, 46], [0, 15, 0], c[0], { sl: 0.5 }),
                Bx([16, 2.2, 26], [26, 15.4, 0], c[1], { rz: -0.15 }),
                Cy(1.2, 1.2, 7, [0, 30.5, 0], '#888e99'),
                Sp(D(5), [0, 34, 0], c[2]),
                Bx([30, 1.2, 6.5], [0, 35.5, 0], c[1], { g: 'p' }), Bx([6.5, 1.2, 30], [0, 35.6, 0], c[2], { g: 'p' }),
            ],
            groups: { p: { at: [0, 35.5, 0], mode: 'spin', axis: 'y', speed: 15 } },
        }),
        mush: (c) => {
            const out = [Sp([54, 32, 54], [0, 16.5, 0], c[0], { sl: 0.55 }), Cy(25, 25, 2, [0, 15, 0], c[2])];
            for (const [az, el] of [[0, 66], [95, 54], [200, 58], [285, 50], [150, 78]]) {
                const A = az * Math.PI / 180, E = el * Math.PI / 180;
                out.push(Sp([8, 3.4, 8], [27 * Math.cos(E) * Math.cos(A) * 0.97, 16.5 + 16 * Math.sin(E) * 0.97, 27 * Math.cos(E) * Math.sin(A) * 0.97], c[1], { ...along([Math.cos(E) * Math.cos(A) / 27, Math.sin(E) / 16, Math.cos(E) * Math.sin(A) / 27]) }));
            }
            return out;
        },
        horns: (c) => {
            const out = arcBand(22.4, -1.15, 1.15, 8, 4, 3, c[1]);
            for (const sg of [-1, 1]) {
                const a = limb([0, 20.4, sg * 10.6], [0.1, 1, sg * 0.4], 9, 4.6, 3.1, c[0]);
                const b = limb(a.end, [-0.2, 1, sg * 0.5], 9, 3.1, 0.4, c[0]);
                out.push(a.prim, b.prim);
            }
            return out;
        },
        unicorn: (c) => {
            const u = norm3([0.45, 0.9, 0]);
            const base = [11, 19, 0];
            const h = limb(base, u, 27, 5.2, 0.4, c[0], { e: 0.15 });
            const out = [h.prim];
            for (const t of [0.2, 0.4, 0.6, 0.8]) {
                const rA = 5.2 * (1 - (t - 0.05)) + 0.5, rB = 5.2 * (1 - (t + 0.05)) + 0.5;
                out.push(Cy(rA, rB, 2.6, [base[0] + u[0] * 27 * t, base[1] + u[1] * 27 * t, 0], c[1], { ...along(u), t: 10, e: 0.2 }));
            }
            for (const sg of [-1, 1]) out.push(Cy(4.2, 0.3, 9, [-3, 24.5, sg * 12.5], c[0], { sc: [0.5, 1, 1], ...along([0, 0.9, sg * 0.4]), t: 8 }), Cy(2.4, 0.2, 6, [-2, 23.6, sg * 12.7], c[2], { sc: [0.5, 1, 1], ...along([0, 0.9, sg * 0.4]), t: 8 }));
            return out;
        },
        halo: (c) => ({
            prims: [To(17, 2.3, [0, 37, 0], c[0], { e: 0.8, g: 'h', rz: 0.1 })],
            groups: { h: { at: [0, 37, 0], mode: 'bob', speed: 3, amp: 2.2 } },
        }),
    };

    // ---------------------------------------------------------------------------------------------
    // ПИТОМЦЫ: примитивы вокруг начала координат (высота ≈ 36 px, нос +X, y вверх)
    // ---------------------------------------------------------------------------------------------
    const PETS = {
        slime: (c) => ({
            prims: [
                Bx([30, 26, 30], [0, 0, 0], c[0]), Bx([14, 2.6, 14], [-3, 13.6, -2], sh(c[0], 1.35)),
                Bx([2.2, 7, 4.5], [15.2, 3, 7.5], '#111'), Bx([2.2, 7, 4.5], [15.2, 3, -7.5], '#111'), Bx([2, 2.4, 9], [15.2, -5, 0], '#111'),
                Bx([2, 3.4, 5], [15.1, -2, 11.5], sh('#ff8fb8', 1), { e: 0.3 }), Bx([2, 3.4, 5], [15.1, -2, -11.5], '#ff8fb8', { e: 0.3 }),
            ],
            squish: true,
        }),
        duck: (c) => ({
            prims: [
                Sp([30, 22, 22], [-2, -2, 0], c[0]), Sp(D(15), [8, 8, 0], c[0]), Sp([8, 3.6, 8], [16, 6.5, 0], c[1]),
                Sp(D(2.6), [13.8, 10, 4.3], '#111'), Sp(D(2.6), [13.8, 10, -4.3], '#111'),
                Cy(4.5, 0.3, 8, [-17, 1, 0], c[0], { rz: 1.2, t: 8 }),
                Sp([14, 8, 3], [-3, -1, 11.5], sh(c[0], 0.88), { g: 'wr' }), Sp([14, 8, 3], [-3, -1, -11.5], sh(c[0], 0.88), { g: 'wl' }),
            ],
            groups: { wr: { at: [-3, 0, 9], mode: 'flap', axis: 'x', speed: 9, amp: -0.5 }, wl: { at: [-3, 0, -9], mode: 'flap', axis: 'x', speed: 9, amp: 0.5 } },
        }),
        cat: (c) => {
            const t1 = limb([-12, -4, 0], [-0.6, 0.6, 0], 10, 3, 2.6, c[0]);
            const t2 = limb(t1.end, [-0.3, 1, 0], 10, 2.6, 2.2, c[0]);
            return [
                Sp([26, 22, 22], [-3, -4, 0], c[0]), Sp([22, 19, 24], [8, 6, 0], c[0]),
                Cy(5.4, 0.3, 9, [8, 16.5, 7.6], c[0], { sc: [0.5, 1, 1], rx: -0.2, t: 8 }), Cy(5.4, 0.3, 9, [8, 16.5, -7.6], c[0], { sc: [0.5, 1, 1], rx: 0.2, t: 8 }),
                Cy(3, 0.2, 6, [9.4, 16, 7.6], c[2], { sc: [0.4, 1, 1], rx: -0.2, t: 8 }), Cy(3, 0.2, 6, [9.4, 16, -7.6], c[2], { sc: [0.4, 1, 1], rx: 0.2, t: 8 }),
                Sp([8, 6, 10], [17.5, 3.5, 0], c[1]), Sp(D(2.6), [21, 5, 0], c[2]),
                Sp([2.4, 5, 3.4], [17.6, 8.5, 5.2], '#111'), Sp([2.4, 5, 3.4], [17.6, 8.5, -5.2], '#111'),
                Bx([2, 8, 1.6], [-1, 6.8, 0], sh(c[0], 0.82)), Bx([2, 8, 1.6], [-5, 5.6, 0], sh(c[0], 0.82)),
                t1.prim, t2.prim, Sp(D(4.6), [t2.end[0], t2.end[1], 0], c[1]),
            ];
        },
        bunny: (c) => [
            Sp([26, 24, 24], [-2, -3, 0], c[0]), Sp([20, 18, 20], [8, 7, 0], c[0]),
            Sp([6, 24, 5], [5, 22, 5.4], c[0], { rx: -0.14, rz: 0.12 }), Sp([6, 24, 5], [5, 22, -5.4], c[0], { rx: 0.14, rz: 0.12 }),
            Sp([3, 18, 2], [6.2, 22, 5.4], c[1], { rx: -0.14, rz: 0.12 }), Sp([3, 18, 2], [6.2, 22, -5.4], c[1], { rx: 0.14, rz: 0.12 }),
            Sp(D(9), [-15, -3, 0], '#ffffff'), Sp(D(2.8), [17.8, 7, 0], c[1]),
            Sp(D(2.8), [16.4, 10, 4.6], '#111'), Sp(D(2.8), [16.4, 10, -4.6], '#111'),
            Sp([8, 4, 6], [4, -14.5, 6], c[0]), Sp([8, 4, 6], [4, -14.5, -6], c[0]),
        ],
        robot: (c) => ({
            prims: [
                Bx([22, 18, 20], [0, -5, 0], c[0]), Bx([20, 15, 20], [0, 10.5, 0], c[0]), Bx([1.6, 8, 14], [10.4, 10.5, 0], c[2]),
                Bx([1.8, 3.6, 3.6], [11.4, 11, 3.6], c[1], { e: 0.9 }), Bx([1.8, 3.6, 3.6], [11.4, 11, -3.6], c[1], { e: 0.9 }), Bx([1.6, 1.4, 8], [11.3, 6.6, 0], c[1], { e: 0.6 }),
                Cy(1, 1, 7, [0, 21.5, 0], c[2]), Sp(D(3.6), [0, 26, 0], c[1], { e: 0.9, g: 'a' }),
                Bx([5, 12, 5], [0, -3, 14], c[2]), Bx([5, 12, 5], [0, -3, -14], c[2]), Sp(D(5.6), [0, -10, 14], c[0]), Sp(D(5.6), [0, -10, -14], c[0]),
                Cy(7, 2, 5, [0, -16.5, 0], '#ff9f1c', { e: 0.9, g: 'f' }),
            ],
            groups: { a: { at: [0, 26, 0], mode: 'pulse', speed: 6, amp: 0.25 }, f: { at: [0, -16.5, 0], mode: 'pulse', speed: 20, amp: 0.3 } },
        }),
        drone: (c) => {
            const prims = [
                Bx([18, 7, 18], [0, 0, 0], c[0]), Bx([40, 2, 3], [0, 1, 0], c[0], { ry: 0.785 }), Bx([40, 2, 3], [0, 1, 0], c[0], { ry: -0.785 }),
                Sp(D(7), [9.5, -2, 0], '#111'), Sp(D(3.6), [12.8, -2, 0], c[2], { e: 0.8 }),
                Sp(D(2.6), [-8, 3, 5], c[1], { e: 1 }), Sp(D(2.6), [-8, 3, -5], c[2], { e: 1 }),
            ];
            const groups = {};
            [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz], i) => {
                const x = 14.1 * sx, z = 14.1 * sz, n = 'r' + i;
                prims.push(Cy(3, 3, 4, [x, 3, z], '#4a5163'));
                prims.push(Bx([17, 0.8, 2.4], [x, 5.8, z], c[1], { g: n }), Bx([2.4, 0.8, 17], [x, 5.8, z], c[2], { g: n }));
                groups[n] = { at: [x, 5.8, z], mode: 'spin', axis: 'y', speed: (i % 2 ? -1 : 1) * 38 };
            });
            return { prims, groups };
        },
        dragon: (c) => {
            const t1 = limb([-16, -3, 0], [-1, 0.1, 0], 9, 4.6, 3, c[0]);
            const t2 = limb(t1.end, [-1, 0.45, 0], 9, 3, 1.4, c[0]);
            const hr = (sg) => limb([11, 13.5, sg * 5], [-0.4, 1, sg * 0.3], 7, 2.5, 0.3, c[1]);
            return {
                prims: [
                    Sp([30, 22, 20], [-3, -3, 0], c[0]), Sp([24, 9, 13], [-3, -8.4, 0], c[1]),
                    Sp([18, 15, 16], [13, 6, 0], c[0]), Sp([9, 7, 10], [21, 4, 0], c[0]),
                    Sp([3.2, 4.4, 3.4], [19, 9.5, 5.6], '#ffe066'), Sp([3.2, 4.4, 3.4], [19, 9.5, -5.6], '#ffe066'),
                    Sp([1.4, 3.6, 1.6], [20.4, 9.5, 5.9], '#111'), Sp([1.4, 3.6, 1.6], [20.4, 9.5, -5.9], '#111'),
                    hr(1).prim, hr(-1).prim,
                    Cy(3.2, 0.3, 6, [-9, 9.6, 0], c[2], { t: 6 }), Cy(3.2, 0.3, 6, [-3, 10, 0], c[2], { t: 6 }), Cy(3, 0.3, 6, [3, 9.4, 0], c[2], { t: 6 }),
                    Bx([14, 1.2, 18], [-4, 6.4, 18], c[1], { g: 'wr' }), Bx([14, 1.2, 18], [-4, 6.4, -18], c[1], { g: 'wl' }),
                    t1.prim, t2.prim, Cy(3, 0.3, 6, [t2.end[0] - 2, t2.end[1], 0], c[2], { rz: Math.PI / 2, t: 6 }),
                ],
                groups: { wr: { at: [-4, 6, 8], mode: 'flap', axis: 'x', speed: 10, amp: -0.55, base: -0.2 }, wl: { at: [-4, 6, -8], mode: 'flap', axis: 'x', speed: 10, amp: 0.55, base: 0.2 } },
            };
        },
        balloon: (c) => [
            Sp([30, 36, 30], [0, 6, 0], c[0]), Cy(0.8, 3.4, 4, [0, -12.4, 0], c[0]), Sp([6, 10, 4], [-3, 14, 10], '#ffffff', { e: 0.5 }),
            Cy(0.45, 0.45, 24, [0, -26, 0], c[1]),
            Sp(D(2.8), [14.2, 8, 4.5], '#111'), Sp(D(2.8), [14.2, 8, -4.5], '#111'), Bx([1.5, 1.6, 7], [14.8, 3, 0], '#111'),
        ],
        cloud: (c) => ({
            prims: [
                Sp([24, 16, 20], [0, 0, 0], c[0]), Sp(D(15), [-8, 3, 3], c[0]), Sp(D(16), [7, 4, -4], c[0]), Sp(D(14), [-1, 7, -4], c[0]), Sp([30, 8, 22], [0, -4.5, 0], c[1]),
                Sp(D(2.8), [11.6, 3, 5], '#111'), Sp(D(2.8), [11.6, 3, -5], '#111'),
                Sp([1.6, 3, 4.5], [11.2, -1, 8.5], '#ffb3c6'), Sp([1.6, 3, 4.5], [11.2, -1, -8.5], '#ffb3c6'), Bx([1.2, 1.4, 5], [12, -0.8, 0], '#111'),
                Sp([3, 5, 3], [3, -12, 3], '#7ac7ff', { g: 'd' }), Sp([3, 5, 3], [-5, -12, -3], '#7ac7ff', { g: 'd' }),
            ],
            groups: { d: { at: [0, -12, 0], mode: 'bob', speed: 6, amp: 1.8 } },
        }),
        bee: (c) => ({
            prims: [
                Sp([26, 20, 20], [0, 0, 0], c[0]),
                Cy(9.8, 9.8, 3.2, [-4, 0, 0], c[1], { rz: Math.PI / 2 }), Cy(10, 10, 3.2, [3.5, 0, 0], c[1], { rz: Math.PI / 2 }),
                Sp(D(11), [14, 1, 0], c[1]),
                Sp(D(3.8), [18, 2.8, 3.6], '#ffffff'), Sp(D(3.8), [18, 2.8, -3.6], '#ffffff'), Sp(D(1.8), [19.7, 2.8, 3.7], '#111'), Sp(D(1.8), [19.7, 2.8, -3.7], '#111'),
                Cy(0.5, 0.5, 6, [17, 8, 2.5], c[1], { rz: -0.5 }), Cy(0.5, 0.5, 6, [17, 8, -2.5], c[1], { rz: -0.5 }),
                Cy(2.4, 0.2, 6, [-16, 0, 0], c[1], { rz: Math.PI / 2, t: 6 }),
                Sp([13, 1.6, 9], [-1, 9, 7], c[2], { g: 'wr' }), Sp([13, 1.6, 9], [-1, 9, -7], c[2], { g: 'wl' }),
            ],
            groups: { wr: { at: [-1, 8.6, 2.5], mode: 'flap', axis: 'x', speed: 30, amp: -0.7 }, wl: { at: [-1, 8.6, -2.5], mode: 'flap', axis: 'x', speed: 30, amp: 0.7 } },
        }),
        penguin: (c) => [
            Sp([24, 32, 22], [0, 0, 0], c[0]), Sp([14, 24, 16], [4.8, -1.5, 0], c[1]),
            Sp(D(3.8), [9.2, 9, 4.6], '#ffffff'), Sp(D(3.8), [9.2, 9, -4.6], '#ffffff'), Sp(D(1.9), [10.8, 9, 4.7], '#111'), Sp(D(1.9), [10.8, 9, -4.7], '#111'),
            Cy(3.2, 0.3, 6, [13, 6.5, 0], c[2], { rz: -Math.PI / 2, t: 8 }),
            Bx([3, 14, 6], [0, 0, 13.5], c[0], { rx: -0.35 }), Bx([3, 14, 6], [0, 0, -13.5], c[0], { rx: 0.35 }),
            Sp([8, 2.8, 6], [3, -16.5, 4.5], c[2]), Sp([8, 2.8, 6], [3, -16.5, -4.5], c[2]),
        ],
        pumpkin: (c) => [
            Sp([26, 24, 28], [0, 0, 0], c[0]), Sp([24, 24, 18], [0, 0, 9], sh(c[0], 0.9)), Sp([24, 24, 18], [0, 0, -9], sh(c[0], 0.9)),
            Cy(2.8, 2.2, 6, [0, 13.5, 0], c[1], { rz: 0.2 }),
            Bx([2, 4.8, 4.4], [13.6, 3, 6], c[2], { e: 0.9 }), Bx([2, 4.8, 4.4], [13.6, 3, -6], c[2], { e: 0.9 }), Bx([2, 2.8, 12], [14.2, -4.6, 0], c[2], { e: 0.9 }),
        ],
        ufo: (c) => {
            const prims = [
                Sp([44, 12, 44], [0, -1, 0], c[0]), Sp([20, 16, 20], [0, 3, 0], c[1], { sl: 0.55, e: 0.2 }), Sp(D(6), [0, 4, 0], '#7bff6a'),
                Cy(9, 2, 8, [0, -11, 0], c[2], { e: 0.6 }),
            ];
            for (let k = 0; k < 6; k++) { const a = k * TAU / 6; prims.push(Sp(D(3.4), [20 * Math.cos(a), -1, 20 * Math.sin(a)], k % 2 ? c[2] : '#ff5d73', { e: 0.9, g: 'ring' })); }
            return { prims, groups: { ring: { at: [0, -1, 0], mode: 'spin', axis: 'y', speed: 2.2 } } };
        },
        snowman: (c) => [
            Sp(D(20), [0, -8, 0], c[0]), Sp(D(15), [0, 5.5, 0], c[0]), Sp(D(11), [0, 16.5, 0], c[0]),
            Cy(1.8, 0.2, 7, [8.6, 16.5, 0], c[1], { rz: -Math.PI / 2, t: 8 }),
            Sp(D(1.9), [5.3, 18.5, 2.6], '#111'), Sp(D(1.9), [5.3, 18.5, -2.6], '#111'),
            Sp(D(2.2), [7.6, 6.5, 0], '#111'), Sp(D(2.2), [8.6, 1.5, 0], '#111'),
            To(5.8, 1.7, [0, 11.2, 0], c[2]), Bx([3.4, 9, 1.8], [4, 6.6, -4.6], c[2]),
            Cy(0.7, 0.5, 12, [0, 7.5, 11], '#5b3a1e', { ...along([0.3, 0.6, 1]) }), Cy(0.7, 0.5, 12, [0, 7.5, -11], '#5b3a1e', { ...along([0.3, 0.6, -1]) }),
        ],
        cactus: (c) => [
            Cy(8, 10, 8, [0, -13.5, 0], c[1]),
            Cy(7, 7, 24, [0, 2.5, 0], c[0]), Sp(D(14), [0, 14.5, 0], c[0]),
            Cy(2.8, 2.8, 8, [0, 1, 9], c[0], { rx: Math.PI / 2 }), Cy(2.8, 2.8, 9, [0, 5.5, 12.5], c[0]), Sp(D(5.6), [0, 10, 12.5], c[0]),
            Cy(2.8, 2.8, 8, [0, -2, -9], c[0], { rx: Math.PI / 2 }), Cy(2.8, 2.8, 8, [0, 1.5, -12.5], c[0]), Sp(D(5.6), [0, 5.5, -12.5], c[0]),
            Sp(D(6.4), [0, 19, 0], c[2]), Sp(D(3), [0, 21.4, 0], '#ffd23f'),
            Sp(D(2.4), [6.6, 6, 3], '#111'), Sp(D(2.4), [6.6, 6, -3], '#111'), Bx([1.2, 1.4, 5], [7, 2, 0], '#111'),
        ],
        ghost: (c) => {
            const prims = [Sp([26, 26, 26], [0, 5, 0], c[0], { e: 0.3 }), Cy(13, 13, 12, [0, -4, 0], c[0], { e: 0.3 })];
            for (let k = 0; k < 6; k++) { const a = k * TAU / 6; prims.push(Sp(D(8.5), [11.4 * Math.cos(a), -9.5, 11.4 * Math.sin(a)], c[0], { e: 0.3 })); }
            prims.push(Sp([3.2, 7, 4.6], [12.2, 7, 5], c[1]), Sp([3.2, 7, 4.6], [12.2, 7, -5], c[1]), Sp([2.2, 5, 4], [12.8, -0.5, 0], c[1]));
            prims.push(Sp([4, 10, 4], [0, 0, 14.5], c[0], { e: 0.3, rx: -0.4 }), Sp([4, 10, 4], [0, 0, -14.5], c[0], { e: 0.3, rx: 0.4 }));
            return prims;
        },
        rocket: (c) => {
            const prims = [
                Cy(8, 8, 26, [0, 0, 0], c[0], { rz: -Math.PI / 2 }), Cy(8, 0.4, 13, [19.5, 0, 0], c[1], { rz: -Math.PI / 2 }),
                Sp(D(6.4), [4, 7.6, 0], c[2], { e: 0.45 }), To(3.3, 0.9, [4, 7.4, 0], c[1]),
                Cy(0.4, 5.5, 12, [-19, 0, 0], '#ff9f1c', { rz: -Math.PI / 2, e: 0.9, g: 'f' }), Cy(0.3, 3, 9, [-17.5, 0, 0], '#ffe066', { rz: -Math.PI / 2, e: 1, g: 'f' }),
            ];
            for (let k = 0; k < 3; k++) { const a = k * TAU / 3 + Math.PI / 2; prims.push(Bx([8, 10, 1.8], [-9, 9.5 * Math.cos(a), 9.5 * Math.sin(a)], c[1], { rx: a })); }
            return { prims, groups: { f: { at: [-14, 0, 0], mode: 'pulse', speed: 22, amp: 0.22 } } };
        },
        eye: (c) => ({
            prims: [
                Sp(D(26), [0, 0, 0], c[0]), Sp([3, 14, 14], [12.4, 0, 0], c[1]), Sp([3.2, 7, 7], [13.2, 0, 0], '#111'), Sp(D(2.8), [14.2, 3, 3.5], '#ffffff'),
                Sp([16, 2, 10], [-2, 5, 17], c[2], { g: 'wr' }), Sp([16, 2, 10], [-2, 5, -17], c[2], { g: 'wl' }),
            ],
            groups: { wr: { at: [-2, 4, 9], mode: 'flap', axis: 'x', speed: 12, amp: -0.6 }, wl: { at: [-2, 4, -9], mode: 'flap', axis: 'x', speed: 12, amp: 0.6 } },
        }),
        star: (c) => {
            const prims = [Sp([9, 14, 14], [0, 0, 0], c[0], { e: 0.45, g: 'pts' })];
            for (let k = 0; k < 5; k++) { const a = k * TAU / 5; prims.push(Cy(5.2, 0.3, 14, [0, 14 * Math.cos(a), 14 * Math.sin(a)], k % 2 ? c[1] : c[0], { sc: [0.55, 1, 1], rx: a, e: 0.45, t: 8, g: 'pts' })); }
            prims.push(Sp(D(2.8), [4.6, 1.5, 3.2], '#111'), Sp(D(2.8), [4.6, 1.5, -3.2], '#111'), Bx([1.2, 1.2, 5], [4.8, -2.4, 0], '#111'),
                Sp([1.4, 3, 3], [4.2, -1, 6.4], '#ff8fb8'), Sp([1.4, 3, 3], [4.2, -1, -6.4], '#ff8fb8'));
            return { prims, groups: { pts: { at: [0, 0, 0], mode: 'spin', axis: 'x', speed: 1.1 } } };
        },
        crystal: (c) => {
            const prims = [
                Cy(10, 0.3, 16, [0, 8, 0], c[0], { e: 0.35, t: 6 }), Cy(10, 0.3, 16, [0, -8, 0], c[0], { e: 0.35, t: 6, rx: Math.PI }),
                Sp(D(2.8), [8.9, 2, 3.4], '#111'), Sp(D(2.8), [8.9, 2, -3.4], '#111'),
            ];
            for (let k = 0; k < 3; k++) { const a = k * TAU / 3; prims.push(Cy(2.6, 0.2, 8, [18 * Math.cos(a), 0, 18 * Math.sin(a)], k % 2 ? c[2] : c[1], { e: 0.6, t: 5, g: 'orb' })); }
            return { prims, groups: { orb: { at: [0, 0, 0], mode: 'spin', axis: 'y', speed: 1.8 } } };
        },
    };

    // ---------------------------------------------------------------------------------------------
    // ДЕТАЛИ СКИНОВ (брейнрот и др.): примитивы в осях ТОЙ части тела, к которой крепятся (центр части — начало, нос +X, y вверх, +Z — вправо).
    // Части: head (скруглённая коробка 44×44×50; детали сажаются HEAD_FIT), chest (короб 35×56×58, спина x = −17.5), belt (33×16×52), handL/handR (20×18×20),
    // footL/footR (38×9.5×24). back: true — деталь за спиной (в плоской иконке рисуется под фигурой).
    // ---------------------------------------------------------------------------------------------
    const ATTACH = { belt: 0, chest: 1, head: 2, handL: 5, handR: 8, footL: 11, footR: 14 };
    const ACC = {
        hood: (c) => ({ back: true, prims: [Sp([26, 22, 50], [-14, 27, 0], c[0]), Sp([22, 16, 40], [-12, 33, 0], sh(c[0], 0.82))] }),
        straw: (c) => [Cy(30, 30, 2, [0, 16, 0], c[0]), Cy(18, 16, 13, [0, 22.5, 0], c[0]), Cy(18.6, 17.6, 3.4, [0, 18.4, 0], c[1])],
        plume: (c) => [
            Bx([34, 3, 3.4], [0, 22.4, 0], '#5b6572'),
            Sp([6, 18, 6], [-2, 29, 0], c[0], { rz: 0.35 }), Sp([5.5, 15, 5.5], [-8, 28, 0], sh(c[0], 0.85), { rz: 0.9 }), Sp([5, 13, 5], [-13, 25, 0], sh(c[0], 0.72), { rz: 1.3 }),
        ],
        cape: (c) => ({ back: true, prims: [Bx([2.4, 62, 62], [-19.4, -5, 0], c[0]), Bx([4, 6, 68], [-19, 26, 0], c[1]), Bx([4, 2.6, 66], [-19, -34, 0], c[1])] }),
        sharkfin: (c) => ({ back: true, prims: [Cy(10, 0.3, 32, [-22, 23, 0], c[0], { t: 3, sc: [0.32, 1, 1.25], rz: 0.35 }), Cy(5, 0.3, 15, [-20.5, 12, 0], sh(c[0], 1.2), { t: 3, sc: [0.3, 1, 1.2], rz: 0.3 })] }),
        sharktail: (c) => ({ back: true, prims: [Cy(7, 0.3, 22, [-27, 1.5, 0], c[0], { t: 3, sc: [0.3, 1, 1.2], rz: 1.15 }), Cy(5, 0.3, 14, [-23, -6.5, 0], c[0], { t: 3, sc: [0.3, 1, 1.2], rz: 2.1 })] }),
        sneaker: (c) => [
            Bx([42, 3.4, 36], [1, -5.2, 0], c[0]), Bx([14, 9, 35], [-11, 2.5, 0], c[1]), Sp([14, 8, 33], [15, 0.5, 0], c[0]),
            Bx([20, 1.6, 34.6], [1, 3.2, 0], c[1]), Bx([5, 1, 18], [9, 5.4, 0], c[0]),
        ],
        bat: (c) => [Cy(4.6, 1.9, 38, [0, -13, 0], c[0], { rz: -0.2, t: 14 }), Cy(2.2, 2.2, 11, [-1.4, 4.2, 0], c[1], { rz: -0.2 }), Sp(D(4.4), [-2.2, 10, 0], c[1])],
        planewings: (c) => {
            const out = [Bx([18, 2.4, 20], [-22, 10, 0], c[0]), Cy(4.4, 4.4, 6, [-22, 8, 0], '#444b57', { rz: Math.PI / 2 })];
            for (const sg of [-1, 1]) {
                out.push(Bx([20, 2.4, 38], [-23, 16, sg * 27], c[0], { ry: -sg * 0.3, rx: -sg * 0.5 }), Cy(5.2, 5.2, 2.8, [-23.2, 17.4, sg * 27], c[1], { rx: -sg * 0.5 }),
                    Cy(3.4, 3.4, 13, [-21, 9, sg * 17], '#444b57', { rz: Math.PI / 2 }));
            }
            return { back: true, prims: out };
        },
        crocotail: (c) => {
            const a = limb([-15, -1, 0], [-1, -0.1, 0], 14, 7, 4.5, c[0], { t: 6 });
            const b = limb(a.end, [-1, 0.3, 0], 14, 4.5, 1.4, c[0], { t: 6 });
            return { back: true, prims: [a.prim, b.prim, Bx([13, 17, 2.2], [-19, 11, 0], c[1], { rz: 0.3 })] };
        },
        crocoeyes: (c) => {
            const out = [];
            for (const sg of [-1, 1]) out.push(Sp(D(10), [5, 22.6, sg * 8], c[0]), Sp(D(6), [8.6, 24, sg * 8], c[1]), Sp([2, 4.4, 2.4], [11.2, 24, sg * 8], '#111111'));
            return out;
        },
        monkeyears: (c) => {
            const out = [];
            for (const sg of [-1, 1]) out.push(Sp([3.6, 12, 11], [-1, 3, sg * 23.5], c[0]), Sp([2.6, 8, 7.4], [0.5, 3, sg * 23.8], c[1]));
            return out;
        },
        bananapeel: (c) => {
            const out = [Cy(2.8, 2.2, 6, [0, 24, 0], c[1], { t: 8 })];
            for (let k = 0; k < 3; k++) {
                const a = k * TAU / 3 + 0.5, ca = Math.cos(a), sa = Math.sin(a);
                const f1 = limb([3 * ca, 21.5, 3 * sa], [ca * 0.85, 0.45, sa * 0.85], 11, 3.8, 2.4, c[0]);
                const f2 = limb(f1.end, [ca * 0.45, -0.85, sa * 0.45], 11, 2.4, 1, c[0]);
                out.push(f1.prim, f2.prim);
            }
            return out;
        },
        elephantears: (c) => {
            const out = [];
            for (const sg of [-1, 1]) out.push(Sp([3.5, 26, 24], [-2, 3, sg * 30.5], c[0]), Sp([2.5, 19, 17], [-0.3, 2, sg * 30.5], c[1]));
            return out;
        },
        trunk: (c) => {
            const a = limb([20, -12, 0], [0.7, -0.6, 0], 10, 5, 4.2, c[0]);
            const b = limb(a.end, [0.3, -1, 0], 11, 4.2, 3.4, c[0]);
            const d = limb(b.end, [-0.4, -1, 0], 10, 3.4, 2.6, c[0]);
            return [a.prim, b.prim, d.prim, Sp(D(5.4), d.end, c[0])];
        },
        cactusflower: (c) => [Sp(D(8), [0, 25, 0], c[0]), Sp(D(3.6), [0, 28, 0], c[1]), Sp(D(5), [6, 22, 5], c[0]), Sp(D(5), [-5, 22, -6], c[0])],
        leaves: (c) => [
            Sp(D(22), [0, 29, 0], c[0]), Sp(D(17), [-9, 25, 9], c[1]), Sp(D(17), [-9, 25, -9], c[1]), Sp(D(15), [8, 26, -9], c[0]), Sp(D(15), [8, 26, 9], c[1]), Sp(D(13), [0, 38, 0], c[1]),
        ],
        bigfoot: (c) => [Bx([56, 10, 46], [5, 0, 0], c[0]), Bx([10, 9, 12], [28, 0.5, -14], c[1]), Bx([10, 9, 12], [28, 0.5, 0], c[1]), Bx([10, 9, 12], [28, 0.5, 14], c[1])],
        bush: (c) => [Sp(D(11), [0, -3, 0], c[0]), Sp(D(8), [3, -1, 4], sh(c[0], 1.12)), Sp(D(7), [-3, -2, -4], sh(c[0], 0.88))],
        tutu: (c) => [Cy(40, 22, 5, [0, 0, 0], c[0]), Cy(45, 29, 2.6, [0, -3, 0], c[1]), To(31, 1.8, [0, 3.2, 0], c[0])],
        cuphat: (c) => [
            Cy(18, 18, 1.6, [0, 21.8, 0], c[0]), Cy(11, 15, 17, [0, 31, 0], c[0]), Cy(14.4, 14.4, 1, [0, 39.3, 0], c[1]),
            Sp([27, 5, 27], [0, 40, 0], c[2]), To(5.2, 1.5, [0, 31, 16.5], c[0], { rz: Math.PI / 2 }),
        ],
        ninjaband: (c) => [
            Cy(21.8, 21.8, 4.4, [0, 14.8, 0], c[0]),
            Bx([18, 2.4, 4], [-27, 14, 2.6], c[0], { ry: 0.3, rz: 0.25 }), Bx([16, 2.4, 4], [-26, 11.4, -3.6], c[0], { ry: -0.35, rz: -0.2 }),
        ],
        katana: (c) => ({ back: true, prims: [
            Bx([2.2, 58, 3], [-20.6, -2, -6], c[0], { rx: 0.5 }), Bx([2.4, 2.6, 11], [-20.6, 23.5, 7.9], c[1], { rx: 0.5 }), Bx([3.6, 13, 4.6], [-20.6, 29.2, 11], c[1], { rx: 0.5 }),
        ] }),
    };
    /** Форма детали -> { prims, groups?, back? }. */
    const accDef = (a) => {
        const f = ACC[a.k];
        if (!f) return null;
        const r = f(a.c || []);
        return Array.isArray(r) ? { prims: r } : r;
    };

    // ---------------------------------------------------------------------------------------------
    // ЧАСТИЦЫ следа: форма — белый рисунок на прозрачном холсте 64×64 (тонируется цветом частицы)
    // ---------------------------------------------------------------------------------------------
    const TRAIL_TEX = {
        glow(g) { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.7)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); },
        puff(g) {
            for (const [x, y, r] of [[32, 34, 18], [22, 38, 13], [43, 37, 14], [30, 25, 12], [40, 27, 10]]) {
                const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.7, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
                g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
            }
        },
        ring(g) {
            g.fillStyle = 'rgba(255,255,255,.2)'; g.beginPath(); g.arc(32, 32, 24, 0, TAU); g.fill();
            g.strokeStyle = '#fff'; g.lineWidth = 5; g.beginPath(); g.arc(32, 32, 24, 0, TAU); g.stroke();
            g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.arc(32, 32, 15, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
        },
        star(g) {
            g.fillStyle = '#fff'; g.beginPath();
            for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 13 : 29; if (i) g.lineTo(32 + Math.cos(a) * r, 34 + Math.sin(a) * r); else g.moveTo(32 + Math.cos(a) * r, 34 + Math.sin(a) * r); }
            g.closePath(); g.fill();
        },
        spark(g) {
            g.fillStyle = '#fff'; g.beginPath(); g.moveTo(32, 3); g.quadraticCurveTo(35, 29, 61, 32); g.quadraticCurveTo(35, 35, 32, 61); g.quadraticCurveTo(29, 35, 3, 32); g.quadraticCurveTo(29, 29, 32, 3); g.fill();
            const r = g.createRadialGradient(32, 32, 0, 32, 32, 14); r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(14, 14, 36, 36);
        },
        heart(g) {
            g.fillStyle = '#fff'; g.beginPath(); g.moveTo(32, 56);
            g.bezierCurveTo(2, 36, 8, 6, 32, 20); g.bezierCurveTo(56, 6, 62, 36, 32, 56); g.closePath(); g.fill();
            g.fillStyle = 'rgba(0,0,0,.12)'; g.beginPath(); g.ellipse(41, 33, 9, 12, 0.3, 0, TAU); g.fill();
        },
        flake(g) {
            g.strokeStyle = '#fff'; g.lineWidth = 4; g.lineCap = 'round';
            for (let k = 0; k < 3; k++) {
                const a = k * Math.PI / 3; g.beginPath(); g.moveTo(32 - Math.cos(a) * 27, 32 - Math.sin(a) * 27); g.lineTo(32 + Math.cos(a) * 27, 32 + Math.sin(a) * 27); g.stroke();
                for (const sg of [-1, 1]) { const bx = 32 + Math.cos(a) * 17 * sg, by = 32 + Math.sin(a) * 17 * sg; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(a + 0.9 * sg) * 8, by + Math.sin(a + 0.9 * sg) * 8); g.moveTo(bx, by); g.lineTo(bx + Math.cos(a - 0.9 * sg) * 8, by + Math.sin(a - 0.9 * sg) * 8); g.stroke(); }
            }
        },
        leaf(g) {
            g.fillStyle = '#fff'; g.beginPath(); g.moveTo(6, 56); g.bezierCurveTo(2, 20, 30, 4, 58, 8); g.bezierCurveTo(60, 36, 34, 60, 6, 56); g.closePath(); g.fill();
            g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 3; g.beginPath(); g.moveTo(8, 54); g.lineTo(46, 20); g.stroke();
        },
        petal(g) {
            const r = g.createRadialGradient(32, 38, 2, 32, 34, 28); r.addColorStop(0, '#fff'); r.addColorStop(1, 'rgba(255,255,255,.75)');
            g.fillStyle = r; g.beginPath(); g.moveTo(32, 6); g.bezierCurveTo(60, 20, 52, 54, 32, 58); g.bezierCurveTo(12, 54, 4, 20, 32, 6); g.fill();
        },
        square(g) { g.fillStyle = '#fff'; g.fillRect(8, 14, 48, 36); },
        note(g) {
            g.fillStyle = '#fff'; g.beginPath(); g.ellipse(22, 49, 13, 9, -0.45, 0, TAU); g.fill();
            g.strokeStyle = '#fff'; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(32, 46); g.lineTo(32, 10); g.stroke();
            g.beginPath(); g.moveTo(32, 10); g.quadraticCurveTo(50, 18, 46, 36); g.stroke();
        },
        coin(g) {
            g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 28, 0, TAU); g.fill();
            g.globalCompositeOperation = 'destination-out'; g.lineWidth = 4; g.beginPath(); g.arc(32, 32, 20, 0, TAU); g.stroke();
            g.fillRect(29, 18, 6, 28); g.globalCompositeOperation = 'source-over';
        },
        drop(g) {
            const r = g.createRadialGradient(28, 40, 2, 32, 38, 24); r.addColorStop(0, '#fff'); r.addColorStop(1, 'rgba(255,255,255,.85)');
            g.fillStyle = r; g.beginPath(); g.moveTo(32, 4); g.bezierCurveTo(40, 22, 54, 30, 54, 42); g.arc(32, 42, 22, 0, Math.PI, false); g.bezierCurveTo(10, 30, 24, 22, 32, 4); g.fill();
            g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.ellipse(24, 40, 4, 7, 0.4, 0, TAU); g.fill();
        },
        shard(g) {
            g.fillStyle = '#fff'; g.beginPath(); g.moveTo(32, 2); g.lineTo(50, 24); g.lineTo(32, 62); g.lineTo(14, 24); g.closePath(); g.fill();
            g.fillStyle = 'rgba(0,0,0,.14)'; g.beginPath(); g.moveTo(32, 2); g.lineTo(50, 24); g.lineTo(32, 30); g.closePath(); g.fill();
            g.strokeStyle = 'rgba(0,0,0,.2)'; g.lineWidth = 2; g.beginPath(); g.moveTo(14, 24); g.lineTo(50, 24); g.stroke();
        },
        wisp(g) {
            const r = g.createRadialGradient(24, 30, 0, 24, 30, 22); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = r; g.fillRect(0, 8, 50, 44);
            const t = g.createLinearGradient(30, 0, 64, 0); t.addColorStop(0, 'rgba(255,255,255,.8)'); t.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = t; g.beginPath(); g.moveTo(26, 20); g.quadraticCurveTo(46, 28, 64, 40); g.quadraticCurveTo(46, 38, 26, 42); g.closePath(); g.fill();
        },
        bolt(g) {
            g.fillStyle = '#fff'; g.beginPath(); g.moveTo(36, 2); g.lineTo(14, 34); g.lineTo(28, 34); g.lineTo(22, 62); g.lineTo(52, 24); g.lineTo(36, 24); g.lineTo(44, 2); g.closePath(); g.fill();
        },
        flame(g) {
            const r = g.createLinearGradient(0, 4, 0, 62); r.addColorStop(0, 'rgba(255,255,255,.95)'); r.addColorStop(0.7, 'rgba(255,255,255,.8)'); r.addColorStop(1, 'rgba(255,255,255,.1)');
            g.fillStyle = r; g.beginPath(); g.moveTo(32, 3); g.bezierCurveTo(40, 22, 56, 30, 52, 46); g.bezierCurveTo(50, 60, 14, 60, 12, 46); g.bezierCurveTo(10, 34, 24, 28, 32, 3); g.fill();
        },
    };

    // ---------------------------------------------------------------------------------------------
    // Постоянные данные
    // ---------------------------------------------------------------------------------------------
    const RARITY_COLOR = { common: '#9aa3b2', uncommon: '#2EC4B6', rare: '#4CC9F0', epic: '#7B61FF', legendary: '#FFB703' };
    // Фигура героя для иконок — части спереди, как у модели (Noob.PARTS): зона, x центра (зеркально ±), низ, ширина, высота,
    // зеркало, скругление (доля меньшей стороны: руки и ноги — капсулы), сужение книзу (торс).
    /** @type {Array<Array<any>>} */
    const FIG = [
        ['thigh', 14.5, 37.5, 25, 33, 1, 0.5], ['shin', 14.5, 9, 22, 31, 1, 0.5], ['foot', 14.5, 0, 25, 10, 1, 0.42],
        ['belt', 0, 69, 52, 16, 0, 0.42], ['chest', 0, 84, 58, 56, 0, 0.24, 0.9],
        ['sleeve', 38, 102, 20, 38, 1, 0.5], ['arm', 38, 73, 18, 30, 1, 0.5], ['hand', 38, 58, 20, 18, 1, 0.5],
    ];
    const HEAD_C = 166;   // центр головы над землёй (px модели)
    const HEAD_K = 1.1;   // голова крупнее остального тела (Noob.HEAD_K): шляпы и детали головы — тем же масштабом
    // Детали героя на иконке (цвета — Noob.HERO; в 3D это меши модели)
    const HERO2D = { hair: '#603a22', tuft: '#7e502e', phones: '#36c46e', phonesDark: '#205c3e', hood: '#d4403c', string: '#faf6f0', packDark: '#287444', sole: '#ef6b5a' };
    /** Посадка шляп и деталей головы (рассчитаны на цилиндр r 21, верх y = 21) на голову-коробку 44×44×50: масштаб по x, y, z и подъём. */
    const HEAD_FIT = [1.2, 1, 1.3, 1];
    /** Точки крепления деталей на фигуре иконки: центр части (px модели над землёй; x — вправо по экрану при взгляде спереди). */
    const ANCHOR = { head: [0, HEAD_C], chest: [0, 112], belt: [0, 77], handR: [-38, 67], handL: [38, 67], footR: [-14.5, 5], footL: [14.5, 5] };
    /** Куда надевается предмет: слот (у brainrot — skin), иначе вкладка. */
    const kindOf = (it) => (it && (it.slot || it.tab)) || '';

    return {
        TAU, RARITY_COLOR, HATS, PETS, FACES, ACC, PATTERNS, TRAIL_TEX, ZONES, ZONE_PARTS, ATTACH, HEAD_FIT, CLASSIC, headPrims, resolveSkin, kindOf,
        /** Слоты Shop.look(). */
        SLOTS: ['skin', 'face', 'hat', 'trail', 'pet'],
        /** Включить частицы следа в меню (примерка следа, пока открыт магазин). Ставит ShopUI. */
        trailInMenu: false,
        /** Поворот плоскостей-рисунков вокруг Y (рад): при нём картинка на груди читается спереди (+X). */
        DECAL_YAW: Math.PI / 2,

        // =========================================================================================
        // Состояние
        // =========================================================================================
        /** @type {any} */ _game: null,
        /** @type {any} */ _model: null,
        /** @type {any} */ _look: {},
        /** @type {any} */ _cur: {},
        /** @type {any} */ _orig: null,
        /** @type {any} */ _own: { skin: null, face: null, hat: null, pet: null, trail: null },
        _t: 0,
        /** @type {any} */ _byIdMap: null,
        /** @type {Map<string, HTMLCanvasElement>} */ _iconCache: new Map(),
        /** @type {Map<string, HTMLCanvasElement>} */ _shapeCache: new Map(),

        /** Предмет каталога по id (из Shop или напрямую из SHOP_ITEMS). */
        find(id) {
            if (!id) return null;
            if (typeof id === 'object') return id;
            if (typeof Shop !== 'undefined' && typeof Shop.item === 'function') { const it = Shop.item(id); if (it) return it; }
            if (!this._byIdMap) {
                this._byIdMap = new Map();
                if (typeof SHOP_ITEMS !== 'undefined') for (const it of SHOP_ITEMS) this._byIdMap.set(it.id, it);
            }
            return this._byIdMap.get(id) || null;
        },

        /** Пути готовых картинок предмета (литералы из каталога): для предзагрузки и проверки. */
        sources(item) {
            const it = this.find(item);
            const out = [];
            if (!it) return out;
            const a = it.art || {};
            if (it.icon) out.push(it.icon);
            if (a.img) out.push(a.img);
            if (a.decal && a.decal.src) out.push(a.decal.src);
            return out;
        },
        /** Поставить картинки предметов на загрузку (items — список записей или id); cb — после загрузки каждой. */
        preload(items, cb) {
            for (const x of items || []) for (const s of this.sources(x)) loadImg(s, cb || (() => {}));
        },

        /** Проверка данных против форм: [{ id, problem }] — пусто, если у каждого предмета есть чем его нарисовать. */
        validate(items) {
            const list = items || (typeof SHOP_ITEMS !== 'undefined' ? SHOP_ITEMS : []);
            const bad = [];
            const png = (s) => typeof s === 'string' && /^assets\/[A-Za-z0-9_\-\/.]+\.webp$/.test(s);
            for (const it of list) {
                const a = it.art, kind = kindOf(it);
                if (!a) { bad.push({ id: it.id, problem: 'нет art' }); continue; }
                if (it.icon != null && !png(it.icon)) bad.push({ id: it.id, problem: 'icon не путь к assets/*.webp' });
                if (kind === 'skin') {
                    for (const z of ZONES) {
                        const v = a[z];
                        if (v && typeof v === 'object' && v.k && !PATTERNS[v.k]) bad.push({ id: it.id, problem: 'нет узора ' + v.k });
                    }
                    if (a.decal && !(a.decal.text || png(a.decal.src))) bad.push({ id: it.id, problem: 'decal без text и без пути src' });
                    for (const ac of a.acc || []) {
                        if (!ACC[ac.k]) bad.push({ id: it.id, problem: 'нет детали ' + ac.k });
                        for (const on of [].concat(ac.on)) if (!(on in ATTACH)) bad.push({ id: it.id, problem: 'нет части тела ' + on });
                    }
                } else if (kind === 'face') { if (!(a.img ? png(a.img) : FACES[a.k])) bad.push({ id: it.id, problem: 'нет лица ' + (a.img || a.k) }); }
                else if (kind === 'hat') { if (!HATS[a.k]) bad.push({ id: it.id, problem: 'нет шляпы ' + a.k }); }
                else if (kind === 'pet') { if (!PETS[a.k]) bad.push({ id: it.id, problem: 'нет питомца ' + a.k }); }
                else if (kind === 'trail') {
                    if (!TRAIL_TEX[a.tex]) bad.push({ id: it.id, problem: 'нет формы частицы ' + a.tex });
                    if (a.img != null && !png(a.img)) bad.push({ id: it.id, problem: 'img не путь к assets/*.webp' });
                } else bad.push({ id: it.id, problem: 'неизвестный слот ' + kind });
            }
            return bad;
        },

        /** Определение формы шляпы/питомца: { prims, groups?, squish? }. */
        shapeDef(item) {
            const it = this.find(item);
            if (!it || !it.art) return null;
            const kind = kindOf(it);
            const table = kind === 'hat' ? HATS : kind === 'pet' ? PETS : null;
            const fn = table && table[it.art.k];
            if (!fn) return null;
            const r = fn(it.art.c || []);
            return Array.isArray(r) ? { prims: r } : r;
        },

        // =========================================================================================
        // Применение к Нубу
        // =========================================================================================
        /** Надетое -> вид Нуба. look: { skin, face, hat, trail, pet } (id или null). */
        apply(game, look) {
            this._game = game || this._game;
            this._look = Object.assign({}, look || {});
            const g = this._game;
            if (!g || !g.model || !g.model.parts) return;
            const model = g.model;
            if (model !== this._model) {
                this._dropAll();
                this._model = model;
                this._cur = {};
                this._orig = { mats: model.parts.map((p) => p.mesh.material), face: model.face ? model.face.material : null };
            }
            const L = this._look, cur = this._cur;
            const run = (slot, fn) => {
                const id = L[slot] || null;
                if (cur[slot] === id && cur[slot] !== undefined) return;
                cur[slot] = id;
                try { fn(id); } catch (e) { console.warn('Cosmetics: ' + slot + ' «' + id + '»:', e); }
            };
            run('skin', (id) => this._applySkin(g, id));
            run('face', (id) => this._applyFace(g, id));
            run('hat', (id) => this._applyHat(g, id));
            run('pet', (id) => this._applyPet(g, id));
            run('trail', (id) => this._applyTrail(g, id));
            this._syncHeadAcc();
            // детали героя: только на стартовом скине; под шляпой — без вихров и дуги наушников; нос — у лица по умолчанию
            if (typeof Noob !== 'undefined' && Noob.dress) {
                const sk = this.find(L.skin), fc = this.find(L.face);
                Noob.dress(model, { hero: !sk || !!sk.default, hat: !!this._own.hat, face: !fc || !!fc.default });
            }
        },

        _scene(game) {
            const m = game && game.model;
            if (m && m.root && typeof m.root.getScene === 'function') return m.root.getScene();
            const v = game && game.app && game.app.location && game.app.location.view;
            return v ? v.scene : null;
        },
        _view(game) { return game && game.app && game.app.location ? game.app.location.view : null; },

        _dropAll() {
            this._free('skin'); this._free('face'); this._free('hat'); this._free('pet'); this._free('trail');
            this._model = null;
        },

        /** Освободить собственные ресурсы слота (меши, материалы, текстуры, частицы). */
        _free(slot) {
            const o = this._own[slot];
            if (!o) return;
            this._own[slot] = null;
            const safe = (fn) => { try { fn(); } catch (e) { /* уже освобождено вместе со сценой */ } };
            const view = this._game ? this._view(this._game) : null;
            for (const r of o.roots || (o.root ? [o.root] : [])) {
                safe(() => { if (typeof World3D !== 'undefined' && view) World3D.removeObject(view, r); else r.dispose(false, false); });
            }
            for (const m of o.mats || []) safe(() => m.dispose(false, false));
            for (const t of o.texs || []) safe(() => t.dispose());
            if (o.handle) safe(() => o.handle.stop());
        },

        /** Шляпа надета — детали скина на голове (чашка, повязка, уши) прячутся, чтобы не торчали сквозь неё. */
        _syncHeadAcc() {
            const S = this._own.skin;
            if (!S || !S.headRoots) return;
            const hide = !!this._own.hat;
            for (const r of S.headRoots) { try { r.setEnabled(!hide); } catch (e) { /* освобождён */ } }
        },

        // ---- скин --------------------------------------------------------------------------
        _applySkin(game, id) {
            this._free('skin');
            const model = game.model, parts = model.parts, scene = this._scene(game);
            parts.forEach((p, i) => { p.mesh.material = this._orig.mats[i]; });
            const item = this.find(id);
            if (!item || item.default || !item.art || !scene) return;
            const art = item.art;
            const zones = resolveSkin(art);
            const own = { mats: [], texs: [], roots: [], anims: [], headRoots: [] };
            const cache = new Map();
            for (const zone of ZONES) {
                const z = zones[zone], key = zoneKey(z);
                let mat = cache.get(key);
                if (!mat) {
                    mat = this._zoneMaterial(scene, z, zone, zone === 'head', own, ZONE_PARTS[zone][0]);
                    cache.set(key, mat);
                }
                for (const i of ZONE_PARTS[zone]) parts[i].mesh.material = mat;
            }
            this._own.skin = own;
            const hp = headPrims(zones.head);
            if (hp.length) this._addHeadParts(game, own, hp);
            if (art.decal) this._addDecal(game, own, art.decal);
            for (const a of art.acc || []) this._addAcc(game, own, a);
        },

        _zoneMaterial(scene, z, zone, isHead, own, partIndex) {
            const base = this._orig.mats[partIndex] || this._orig.mats[0];
            const m = new BABYLON.StandardMaterial('cos-skin-' + zone, scene);
            m.specularColor = base && base.specularColor ? base.specularColor.clone() : new BABYLON.Color3(0.08, 0.08, 0.08);
            m.specularPower = base ? base.specularPower : 64;
            m.metadata = Object.assign({ toonGroup: 'actor' }, base ? base.metadata : null);
            const textured = !isHead && !!z.k;   // у головы общий материал на всех гранях: волосы, повязка и забрало — детали (headPrims)
            const col = BABYLON.Color3.FromHexString(z.c);
            if (textured) {
                const W = 64, H = 64;
                const tex = new BABYLON.DynamicTexture('cos-skin-tex-' + zone, { width: W, height: H }, scene, true);
                const g = texCtx(tex);
                paintZone(g, W, H, z);
                tex.update(true);
                m.diffuseTexture = tex;
                m.diffuseColor = new BABYLON.Color3(1, 1, 1);
                // свечение зоны или мягкая подсветка (в тени против солнца персонаж не сереет)
                const e = z.e > 0 ? z.e : FILL;
                m.emissiveTexture = tex; m.emissiveColor = new BABYLON.Color3(e, e, e);
                own.texs.push(tex);
            } else {
                m.diffuseColor = col;
                m.emissiveColor = col.scale(z.e > 0 ? z.e : FILL);
            }
            if (typeof World3D !== 'undefined' && World3D.applyMaterialConstants) World3D.applyMaterialConstants(m);
            own.mats.push(m);
            return m;
        },

        /** Рисунок на груди (и на спине, если d.back): плоскости с прозрачной текстурой на передней и задней грани верхней части торса. */
        _addDecal(game, own, d) {
            const scene = this._scene(game), chest = game.model.parts[1].mesh;
            if (!scene || !chest) return;
            const size = 256;
            const root = new BABYLON.Mesh('cos-decal', scene);
            root.parent = chest;
            const tex = new BABYLON.DynamicTexture('cos-decal-tex', { width: size, height: size }, scene, true);
            const paint = () => {
                const g = texCtx(tex);
                g.clearRect(0, 0, size, size);
                const c = drawDecal(d, size);
                if (c) g.drawImage(c, 0, 0);
                tex.hasAlpha = true;
                tex.update(true);
                return !!c;
            };
            if (!paint() && d.src) loadImg(d.src, () => { if (this._own.skin === own) paint(); });
            const m = new BABYLON.StandardMaterial('cos-decal-m', scene);
            m.diffuseTexture = tex;
            m.useAlphaFromDiffuseTexture = true;
            m.specularColor = new BABYLON.Color3(0, 0, 0);
            m.diffuseColor = new BABYLON.Color3(1, 1, 1);
            m.zOffset = -2;
            m.metadata = { toonGroup: 'actor' };
            const sz = d.s || 46;
            for (const side of d.back ? [1, -1] : [1]) {
                const plane = BABYLON.MeshBuilder.CreatePlane('cos-decal-p', { size: sz, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
                plane.parent = root;
                plane.material = m;
                plane.isPickable = false;
                plane.position.set(side * 17.9, d.dy || 0, 0);
                plane.rotation.y = side > 0 ? this.DECAL_YAW : this.DECAL_YAW + Math.PI;
            }
            if (typeof World3D !== 'undefined') World3D.addObject(this._view(game), root, 'actor', { castShadow: false, ink: false, outline: false });
            if (typeof World3D !== 'undefined' && World3D.applyMaterialConstants) World3D.applyMaterialConstants(m);
            m.specularColor = new BABYLON.Color3(0, 0, 0);
            own.mats.push(m); own.texs.push(tex); own.roots.push(root);
        },

        /** Волосы, повязка, забрало, полоски головы скина (headPrims): примитивы прямо в осях головы, без посадки HEAD_FIT и не прячутся под шляпой. */
        _addHeadParts(game, own, prims) {
            const scene = this._scene(game), head = game.model.parts[2] && game.model.parts[2].mesh;
            if (!scene || !head) return;
            const o = this._assemble(scene, { prims }, 'cos-head', head);
            if (typeof World3D !== 'undefined') World3D.addObject(this._view(game), o.root, 'actor');
            own.mats.push(...o.mats); own.roots.push(o.root);
        },

        /** Деталь скина (из ACC) на часть тела (ATTACH): a = { on, k, c }. */
        _addAcc(game, own, a) {
            const def = accDef(a), scene = this._scene(game);
            if (!def || !scene) return;
            for (const on of [].concat(a.on)) {
                const part = game.model.parts[ATTACH[on]];
                if (!part) continue;
                const o = this._assemble(scene, def, 'cos-acc-' + on, part.mesh);
                if (on === 'head') this._fitHead(o.root);
                if (typeof World3D !== 'undefined') World3D.addObject(this._view(game), o.root, 'actor');
                own.mats.push(...o.mats); own.roots.push(o.root); own.anims.push(...o.anims);
                if (on === 'head') own.headRoots.push(o.root);
            }
        },

        // ---- лицо --------------------------------------------------------------------------
        _applyFace(game, id) {
            this._free('face');
            const face = game.model.face, scene = this._scene(game);
            if (!face || !scene) return;
            const item = this.find(id);
            const art = item && item.art;
            if (!item || item.default || !art || !(art.img || FACES[art.k])) { face.material = this._orig.face; return; }
            const W = 256, H = 144;
            const tex = new BABYLON.DynamicTexture('cos-face-tex', { width: W, height: H }, scene, true);
            const own = { mats: [], texs: [tex] };
            const paint = () => {
                const g = texCtx(tex);
                g.clearRect(0, 0, W, H);
                const ok = drawFace(g, W, H, art);
                tex.hasAlpha = true;
                tex.update(true);
                return ok;
            };
            if (!paint() && art.img) loadImg(art.img, () => { if (this._own.face === own) paint(); });
            const m = new BABYLON.StandardMaterial('cos-face', scene);
            m.diffuseTexture = tex;
            m.useAlphaFromDiffuseTexture = true;
            m.specularColor = new BABYLON.Color3(0, 0, 0);
            m.diffuseColor = new BABYLON.Color3(1, 1, 1);
            m.zOffset = -2;
            m.metadata = { toonGroup: 'actor' };
            if (typeof World3D !== 'undefined' && World3D.applyMaterialConstants) World3D.applyMaterialConstants(m);
            face.material = m;
            own.mats.push(m);
            this._own.face = own;
        },

        // ---- сборка 3D из примитивов -------------------------------------------------------
        /**
         * Собрать меши определения формы под родителем. Возвращает { root, holder, mats, anims, squish }.
         * root — корень (его регистрируем в World3D); holder — внутренний узел (приседание слайма).
         */
        _assemble(scene, def, name, parent) {
            const root = new BABYLON.Mesh(name, scene);
            if (parent) root.parent = parent;
            const holder = new BABYLON.Mesh(name + '-h', scene);
            holder.parent = root;
            const mats = new Map();
            const getMat = (p) => {
                const key = (p.c || '#fff') + '|' + (p.e || 0);
                let m = mats.get(key);
                if (!m) {
                    m = new BABYLON.StandardMaterial(name + '-m', scene);
                    const col = BABYLON.Color3.FromHexString(p.c || '#ffffff');
                    m.diffuseColor = col;
                    m.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);
                    if (p.e) m.emissiveColor = col.scale(p.e);
                    mats.set(key, m);
                }
                return m;
            };
            const pivots = {};
            const anims = [];
            for (const gname of Object.keys(def.groups || {})) {
                const gd = def.groups[gname];
                const n = new BABYLON.Mesh(name + '-' + gname, scene);
                n.parent = holder;
                n.position.set(gd.at[0], gd.at[1], gd.at[2]);
                pivots[gname] = n;
                anims.push({ node: n, mode: gd.mode, axis: gd.axis || 'y', speed: gd.speed || 1, amp: gd.amp || 0, base: gd.base || 0, at: gd.at, ph: Math.random() * TAU });
            }
            for (const p of def.prims) {
                let mesh;
                if (p.k === 'box') mesh = BABYLON.MeshBuilder.CreateBox(name + '-b', { width: p.s[0], height: p.s[1], depth: p.s[2] }, scene);
                else if (p.k === 'cyl') mesh = BABYLON.MeshBuilder.CreateCylinder(name + '-c', { height: p.h, diameterBottom: p.r * 2, diameterTop: (p.rt != null ? p.rt : p.r) * 2, tessellation: p.t || 16 }, scene);
                else if (p.k === 'rbox') mesh = typeof Geo !== 'undefined' ? Geo.roundBox(scene, name + '-r', p.s[0], p.s[1], p.s[2], p.r || 6, 2) : BABYLON.MeshBuilder.CreateBox(name + '-r', { width: p.s[0], height: p.s[1], depth: p.s[2] }, scene);
                else if (p.k === 'sph') mesh = BABYLON.MeshBuilder.CreateSphere(name + '-s', { diameterX: p.s[0], diameterY: p.s[1], diameterZ: p.s[2], segments: 10, slice: p.sl || 1 }, scene);
                else if (p.k === 'patch' && typeof Geo !== 'undefined') mesh = Geo.roundPatch(scene, name + '-p', HEAD_BOX[0], HEAD_BOX[1], HEAD_BOX[2], HEAD_BOX[3], p.s[2] / 2, p.y0, p.y1, 0.35, 14, 4);
                else if (p.k === 'patch') mesh = BABYLON.MeshBuilder.CreateBox(name + '-b', { width: p.s[0], height: p.s[1], depth: p.s[2] }, scene);
                else mesh = BABYLON.MeshBuilder.CreateTorus(name + '-t', { diameter: p.R * 2, thickness: p.r * 2, tessellation: 24 }, scene);
                const piv = p.g && pivots[p.g];
                const at = piv ? def.groups[p.g].at : [0, 0, 0];
                mesh.parent = piv || holder;
                if (p.k === 'patch' && typeof Geo !== 'undefined') mesh.position.set(-at[0], -at[1], -at[2]);   // построена сразу в осях головы
                else mesh.position.set(p.p[0] - at[0], p.p[1] - at[1], p.p[2] - at[2]);
                mesh.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
                if (p.sc) mesh.scaling.set(p.sc[0], p.sc[1], p.sc[2]);
                mesh.material = getMat(p);
                mesh.isPickable = false;
            }
            return { root, holder, mats: [...mats.values()], anims, squish: !!def.squish };
        },

        /** Анимации групп (кручение, взмах, покачивание, пульс) и приседание. */
        _animate(o, dt) {
            if (!o || !o.anims) return;
            const t = this._t;
            for (const a of o.anims) {
                if (a.mode === 'spin') a.node.rotation[a.axis] += a.speed * dt;
                else if (a.mode === 'flap') a.node.rotation[a.axis] = a.base + a.amp * Math.sin(t * a.speed + a.ph);
                else if (a.mode === 'bob') a.node.position.y = a.at[1] + a.amp * Math.sin(t * a.speed + a.ph);
                else if (a.mode === 'pulse') a.node.scaling.y = 1 + a.amp * Math.sin(t * a.speed + a.ph);
            }
            if (o.squish && o.holder) { const s = 0.07 * Math.sin(t * 5.5); o.holder.scaling.set(1 + s, 1 - s, 1 + s); }
        },

        /** Посадить шляпу или деталь на голову-коробку (HEAD_FIT). */
        _fitHead(root) {
            root.scaling.set(HEAD_FIT[0], HEAD_FIT[1], HEAD_FIT[2]);
            root.position.y = HEAD_FIT[3];
        },

        // ---- шляпа -------------------------------------------------------------------------
        _applyHat(game, id) {
            this._free('hat');
            const scene = this._scene(game), head = game.model.parts[2] && game.model.parts[2].mesh;
            const def = id ? this.shapeDef(id) : null;
            if (!def || !scene || !head) return;
            const o = this._assemble(scene, def, 'cos-hat', head);
            this._fitHead(o.root);
            if (typeof World3D !== 'undefined') World3D.addObject(this._view(game), o.root, 'actor');
            this._own.hat = { roots: [o.root], mats: o.mats, texs: [], anims: o.anims, holder: o.holder, squish: false };
        },

        // ---- питомец -----------------------------------------------------------------------
        _applyPet(game, id) {
            this._free('pet');
            const scene = this._scene(game);
            const def = id ? this.shapeDef(id) : null;
            if (!def || !scene) return;
            const o = this._assemble(scene, def, 'cos-pet', null);
            if (typeof World3D !== 'undefined') World3D.addObject(this._view(game), o.root, 'actor');
            const p = this._runnerPos(game);
            o.root.position.set(p[0], p[1] + 60, p[2]);
            this._own.pet = { root: o.root, roots: [o.root], mats: o.mats, texs: [], anims: o.anims, holder: o.holder, squish: o.squish, pos: null, yaw: 0, fwd: [0, 1] };
        },

        // ---- след --------------------------------------------------------------------------
        _applyTrail(game, id) {
            this._free('trail');
            const item = this.find(id);
            const fx = game.app && game.app.fx;
            if (!item || !item.art || !fx) return;
            const a = item.art;
            const scene = this._scene(game);
            const k = this._trailK(game);
            const p = this._runnerPos(game);
            const h = fx.create({
                name: 'cos-trail', position: [p[0], p[1] + 5 * k, p[2]], rate: 0, capacity: Math.ceil(a.rate * a.life[1] * 1.5) + 8, texture: a.img,
                life: a.life, size: a.size.map((v) => v * k), speed: a.speed.map((v) => v * k), direction: a.dir, gravity: a.grav.map((v) => v * k),
                color: a.c, color2: a.c2 || a.c, alpha: a.a != null ? a.a : 1, blend: a.blend, spin: a.spin, colorGradient: a.grad,
                box: [[-9 * k, 0, -9 * k], [9 * k, 3 * k, 9 * k]],
            });
            if (!h) return;
            const texs = [];
            if (!a.img) {
                const tc = new BABYLON.DynamicTexture('cos-trail-tex', { width: 64, height: 64 }, scene, false);
                const g = texCtx(tc);
                g.clearRect(0, 0, 64, 64);
                TRAIL_TEX[a.tex](g);
                tc.hasAlpha = true;
                tc.update(true);
                h.system.particleTexture = tc;
                texs.push(tc);
            }
            this._own.trail = { handle: h, texs, mats: [], art: a, k, on: false, wide: false, check: 0 };
        },

        /** Масштаб частиц и питомца по росту Нуба (от 1 до ~6: очень высокий Нуб тянет за собой крупный след). */
        _trailK(game) { return Math.pow(clamp(this._height(game) / 184, 1, 9), 0.78); },
        _height(game) { return game && typeof game.runnerHeight === 'function' ? Number(game.runnerHeight()) || 184 : 184; },
        _runnerPos(game) {
            if (game && typeof game.runnerPos === 'function') { const p = game.runnerPos(); if (p) return p; }
            const r = game && game.model && game.model.root;
            return r ? [r.position.x, r.position.y, r.position.z] : [0, 0, 0];
        },

        // =========================================================================================
        // Кадр
        // =========================================================================================
        /** Каждый кадр: питомец, след, анимация. */
        update(dt, game) {
            const g = game || this._game;
            if (!g || !g.model) return;
            this._game = g;
            if (g.model !== this._model) this.apply(g, this._look);
            dt = clamp(dt || 0, 0, 0.1);
            this._t += dt;
            try {
                this._animate(this._own.hat, dt);
                this._animate(this._own.skin, dt);
                this._updatePet(dt, g);
                this._updateTrail(dt, g);
            } catch (e) { console.warn('Cosmetics.update:', e); }
        },

        /** Курс Нуба в плоскости (out = [вперёд x, вперёд z]) по повороту нижней части торса. false — курс неясен (лежит). */
        _heading(game, out) {
            const q = game.model.parts[0] && game.model.parts[0].mesh.rotationQuaternion;
            if (!q) return false;
            const ux = q.x, uy = q.y, uz = q.z, w = q.w, v = [1, 0, 0];
            const cx = uy * v[2] - uz * v[1], cy = uz * v[0] - ux * v[2], cz = ux * v[1] - uy * v[0];
            const f = [v[0] + 2 * (w * cx + (uy * cz - uz * cy)), v[1] + 2 * (w * cy + (uz * cx - ux * cz)), v[2] + 2 * (w * cz + (ux * cy - uy * cx))];
            const l = Math.hypot(f[0], f[2]);
            if (l < 0.35) return false;
            out[0] = f[0] / l; out[1] = f[2] / l;
            return true;
        },

        _updatePet(dt, game) {
            const P = this._own.pet;
            if (!P) return;
            const pos = this._runnerPos(game), H = this._height(game);
            const k = Math.pow(clamp(H / 184, 0.85, 9), 0.82);
            this._heading(game, P.fwd);
            const fx = P.fwd[0], fz = P.fwd[1];
            const rx = -fz, rz = fx;   // вправо от курса: f × up
            const runner = game.runner;
            const half = runner && typeof runner.halfWidth === 'function' ? runner.halfWidth() : 52 * clamp(H / 184, 0.6, 9) * 0.55 + 40;
            const side = half + 26 * k, up = H * 0.58 + Math.sin(this._t * 2.4) * 5 * k;
            const target = [pos[0] + rx * side - fx * 12 * k, pos[1] + up, pos[2] + rz * side - fz * 12 * k];
            const r = P.root;
            if (!P.pos) P.pos = target.slice();
            const kf = 1 - Math.exp(-dt * 6.5);
            const far = Math.hypot(P.pos[0] - target[0], P.pos[2] - target[2]) > 900 + H * 2;
            for (let i = 0; i < 3; i++) P.pos[i] = far ? target[i] : P.pos[i] + (target[i] - P.pos[i]) * kf;
            r.position.set(P.pos[0], P.pos[1], P.pos[2]);
            r.scaling.set(k, k, k);
            const want = Math.atan2(-fz, fx);
            let d = want - P.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
            P.yaw += d * (1 - Math.exp(-dt * 8));
            r.rotation.y = P.yaw;
            P.holder.rotation.z = Math.sin(this._t * 2.4 + 1) * 0.06;
            this._animate(P, dt);
        },

        _updateTrail(dt, game) {
            const T = this._own.trail;
            if (!T) return;
            const fx = game.app && game.app.fx;
            if (!fx) return;
            // fx.clear() (смена карты) гасит все системы — собираем след заново
            T.check -= dt;
            if (T.check <= 0) {
                T.check = 0.5;
                let alive = false;
                for (const e of fx.effects) if (e.system === T.handle.system) { alive = true; break; }
                if (!alive) { this._cur.trail = undefined; this._free('trail'); this.apply(game, this._look); return; }
            }
            const pos = this._runnerPos(game), k = this._trailK(game), a = T.art;
            T.handle.setPosition([pos[0], pos[1] + 5 * k, pos[2]]);
            const run = game.state === 'play';
            const play = run || (this.trailInMenu && game.state !== 'win' && game.state !== 'lose');
            if (play !== T.on) { T.on = play; T.handle.setRate(play ? a.rate : 0); }
            // в меню (примерка) Нуб стоит на месте, а камера смотрит спереди: частицы вокруг ног шире, чтобы их было видно
            const wide = !run;
            if (Math.abs(k - T.k) > 0.06 * T.k || wide !== T.wide) {
                T.k = k; T.wide = wide;
                const s = T.handle.system, w = (wide ? 42 : 9) * k;
                s.minSize = a.size[0] * k; s.maxSize = a.size[1] * k;
                s.minEmitPower = a.speed[0] * k; s.maxEmitPower = a.speed[1] * k;
                s.gravity.set(a.grav[0] * k, a.grav[1] * k, a.grav[2] * k);
                s.minEmitBox.set(-w, 0, -w); s.maxEmitBox.set(w, 3 * k, w);
            }
        },

        // =========================================================================================
        // ИКОНКИ (2D, процедурно или из готовых картинок)
        // =========================================================================================
        /** Холст-заготовка зоны скина 48×48 (кэш). */
        _zoneTile(z) {
            const key = 'z' + zoneKey(z);
            let c = this._shapeCache.get(key);
            if (!c) { c = mkCanvas(48, 48); paintZone(ctxOf(c), 48, 48, z); this._shapeCache.set(key, c); }
            return c;
        },
        /** Холст лица 256×144 (кэш); null, пока картинка лица грузится. art — { k } или { img }. */
        _faceTile(art) {
            if (!art) return null;
            const key = 'f' + (art.img || art.k);
            let c = this._shapeCache.get(key);
            if (!c) {
                const t = mkCanvas(256, 144);
                if (!drawFace(ctxOf(t), 256, 144, art)) return null;
                c = t;
                this._shapeCache.set(key, c);
            }
            return c;
        },
        _partTile(g, z, x, y, w, h, rf, taper) {
            const r = Math.min(w, h) * (rf == null ? 0.12 : rf);
            g.save();
            if (taper && taper < 1) {   // торс: трапеция со скруглёнными углами, уже книзу
                const i = w * (1 - taper) / 2, P = [[x, y], [x + w, y], [x + w - i, y + h], [x + i, y + h]];
                g.beginPath(); g.moveTo(x + w / 2, y);
                for (let k = 1; k <= 4; k++) { const a = P[k % 4], b = P[(k + 1) % 4]; g.arcTo(a[0], a[1], b[0], b[1], r); }
                g.closePath();
            } else rrect(g, x, y, w, h, r);
            g.clip();
            if (z.k) g.drawImage(this._zoneTile(z), x, y, w, h); else { g.fillStyle = z.c; g.fillRect(x, y, w, h); }
            const sd = g.createLinearGradient(x, 0, x + w, 0);
            sd.addColorStop(0, 'rgba(255,255,255,.2)'); sd.addColorStop(0.5, 'rgba(255,255,255,0)'); sd.addColorStop(1, 'rgba(0,0,0,.2)');
            g.fillStyle = sd; g.fillRect(x, y, w, h);
            g.restore();
        },

        /**
         * Фигура в скине спереди: ox — центр по x, oy — земля по y (px холста), s — px на единицу модели. faceArt — { k } | { img } | null.
         * Стартовый скин (skin = null или art.hero) — герой: волосы, наушники, худи с капюшоном, лямки рюкзака; opt.hat — шляпа надета
         * (вихры и дуга наушников под ней не рисуются).
         */
        _drawFigure(g, skin, faceArt, ox, oy, s, opt) {
            const zones = resolveSkin(skin), hero = !skin || !!skin.hero;
            for (const [zone, cx, yb, w, h, mir, rf, tp] of FIG) {
                for (const sg of mir ? [-1, 1] : [1]) this._partTile(g, zones[zone], ox + (mir ? sg * cx : cx - w / 2) * s - (mir ? w * s / 2 : 0), oy - (yb + h) * s, w * s, h * s, rf, tp);
            }
            if (hero) this._drawHeroBody(g, ox, oy, s);
            else for (const sg of [-1, 1]) { g.fillStyle = '#e8e8ee'; rrect(g, ox + (sg * 14.5 - 13) * s, oy - 3.4 * s, 26 * s, 3.4 * s, 1.6 * s); g.fill(); }
            if (skin && skin.decal) {
                const c = drawDecal(skin.decal, 128);
                if (c) { const sz = (skin.decal.s || 46) * s; g.drawImage(c, ox - sz / 2, oy - (112 + (skin.decal.dy || 0)) * s - sz / 2, sz, sz); }
            }
            const nose = hero && (!faceArt || faceArt.k === 'smile');
            this._drawHead(g, zones.head, faceArt, ox, oy - HEAD_C * s, s * HEAD_K, { hero, nose, hat: !!(opt && opt.hat) });
        },

        /** Худи героя спереди: подошвы кед, манжеты, карман, лямки рюкзака, воротник-капюшон, шнурки (координаты — как у модели). */
        _drawHeroBody(g, ox, oy, s) {
            const X = (x) => ox + x * s, Y = (y) => oy - y * s, C = HERO2D;
            const box = (col, x, y, w, h, r) => { g.fillStyle = col; rrect(g, X(x), Y(y), w * s, h * s, r * s); g.fill(); };
            for (const sg of [-1, 1]) {
                box(C.sole, sg * 14.5 - 13, 3.4, 26, 3.4, 1.6);
                box(C.hood, sg * 38 - 9.75, 80, 19.5, 4.6, 2.2);
                box(C.packDark, sg * 16.5 - 3, 140, 6, 41, 2);
            }
            box(C.hood, -14, 107.5, 28, 13, 4);
            g.fillStyle = C.hood; g.beginPath(); g.ellipse(ox, Y(138.5), 23 * s, 5 * s, 0, 0, TAU); g.fill();
            g.strokeStyle = C.string; g.lineWidth = 2.4 * s; g.lineCap = 'round';
            for (const sg of [-1, 1]) {
                g.beginPath(); g.moveTo(X(sg * 5.5), Y(135)); g.lineTo(X(sg * 6), Y(120.5)); g.stroke();
                g.fillStyle = C.string; g.beginPath(); g.arc(X(sg * 6), Y(119.4), 1.9 * s, 0, TAU); g.fill();
            }
        },

        /** Волосы и наушники героя спереди (пряди — Noob.STRANDS): back — затылочная часть до головы, иначе — поверх. */
        _drawHeroHair(g, hx, hy, s, hat, back) {
            const X = (z) => hx + z * s, Y = (y) => hy - y * s, C = HERO2D;
            /** @type {any[]} */
            const all = typeof Noob !== 'undefined' && Noob.STRANDS ? Noob.STRANDS.slice().sort((a, b) => a[0][0] - b[0][0]) : [];
            // прядь спереди: лист от основания к кончику; смотрящая на зрителя — кружок
            const leaf = (b, d, h, w, dots) => {
                const L = Math.hypot(d[0], d[1], d[2]) || 1;
                const tz = b[2] + d[2] / L * h, ty = b[1] + d[1] / L * h;
                const vx = tz - b[2], vy = ty - b[1], vl = Math.hypot(vx, vy);
                g.fillStyle = C.tuft;
                if (vl < w * 0.5) { if (dots) { g.beginPath(); g.arc(X(b[2]), Y(b[1]), w * 0.5 * s, 0, TAU); g.fill(); } return; }
                const nx = -vy / vl * w / 2, ny = vx / vl * w / 2;
                g.beginPath(); g.moveTo(X(b[2] + nx), Y(b[1] + ny));
                g.quadraticCurveTo(X(b[2] + nx * 0.5 + vx * 0.6), Y(b[1] + ny * 0.5 + vy * 0.6), X(tz), Y(ty));
                g.quadraticCurveTo(X(b[2] - nx * 0.5 + vx * 0.6), Y(b[1] - ny * 0.5 + vy * 0.6), X(b[2] - nx), Y(b[1] - ny));
                g.closePath(); g.fill();
            };
            if (back) {   // за головой: затылок (виден по бокам) и задние пряди (торчат над макушкой)
                g.fillStyle = C.hair; rrect(g, X(-26), Y(22), 52 * s, 32 * s, 9 * s); g.fill();
                if (!hat) for (const [b, d, h, w] of all) if (b[0] < 0) leaf(b, d, h, w, false);
                return;
            }
            // шапка волос: сверху до линии лба (по центру выше — там лоб)
            g.fillStyle = C.hair; g.beginPath();
            g.moveTo(X(-26), Y(10)); g.lineTo(X(-26), Y(18)); g.quadraticCurveTo(X(-26), Y(25), X(-19), Y(25));
            g.lineTo(X(19), Y(25)); g.quadraticCurveTo(X(26), Y(25), X(26), Y(18)); g.lineTo(X(26), Y(10));
            g.quadraticCurveTo(X(0), Y(19), X(-26), Y(10)); g.closePath(); g.fill();
            if (!hat) {
                // дуга наушников — поверх шапки волос, под чёлкой (чёлка ложится поверх дуги, как в 3D)
                const band = () => {
                    g.lineCap = 'round';
                    for (const [col, lw] of /** @type {[string, number][]} */ ([[C.phonesDark, 6.4], [C.phones, 4.6]])) {
                        g.strokeStyle = col; g.lineWidth = lw * s; g.beginPath();
                        for (let i = 0; i <= 18; i++) { const a = i / 18 * Math.PI, px = X(29.5 * Math.cos(a)), py = Y(3 + 33 * Math.sin(a)); if (i) g.lineTo(px, py); else g.moveTo(px, py); }
                        g.stroke();
                    }
                };
                band();
                for (const [b, d, h, w] of all) if (b[0] >= 0) leaf(b, d, h, w, true);
            }
            for (const sg of [-1, 1]) {   // амбушюры, чашки и крышки чашек
                g.fillStyle = C.phonesDark; rrect(g, X(sg > 0 ? 24.2 : -27.2), Y(10), 3 * s, 18 * s, 1.4 * s); g.fill();
                g.fillStyle = C.phones; rrect(g, X(sg > 0 ? 25.5 : -33.5), Y(11.5), 8 * s, 21 * s, 4 * s); g.fill();
                rrect(g, X(sg > 0 ? 33.5 : -35.9), Y(8), 2.4 * s, 14 * s, 1.1 * s); g.fill();
            }
        },

        /** Голова спереди (скруглённая коробка 50 × 44, лицо — наклейка 40 × 22.5): (hx, hy) — центр; opt — { hero, nose, hat }. */
        _drawHead(g, z, faceArt, hx, hy, s, opt) {
            const o = opt || {};
            const w = 50 * s, h = 44 * s, x = hx - w / 2, y = hy - h / 2, r = 17.5 * s;
            if (o.hero) this._drawHeroHair(g, hx, hy, s, o.hat, true);
            g.save(); rrect(g, x, y, w, h, r); g.clip();
            g.fillStyle = z.c; g.fillRect(x, y, w, h);
            const row = (yy) => hy - yy * s;
            if (z.hair) { g.fillStyle = z.hair; g.fillRect(x, y, w, row(Math.max(9.6, z.hairY != null ? z.hairY : 9.6)) - y); }
            if (z.band) { g.fillStyle = z.band[2]; g.fillRect(hx - 20 * s, row(z.band[1]), 40 * s, (z.band[1] - z.band[0]) * s); }
            if (z.visor) { g.fillStyle = z.visor[2]; g.fillRect(x, row(z.visor[1]), w, (z.visor[1] - z.visor[0]) * s); }
            if (z.stripes) {
                g.fillStyle = z.stripes[1];
                const n = z.stripes[0];
                for (let i = 0; i < n; i++) g.fillRect(hx + (i - (n - 1) / 2) * w * 0.2 - w * 0.03, y, w * 0.06, h * 0.17);
            }
            const sd = g.createLinearGradient(x, 0, x + w, 0);
            sd.addColorStop(0, 'rgba(255,255,255,.22)'); sd.addColorStop(0.55, 'rgba(255,255,255,0)'); sd.addColorStop(1, 'rgba(0,0,0,.2)');
            g.fillStyle = sd; g.fillRect(x, y, w, h);
            g.restore();
            const tile = faceArt ? this._faceTile(faceArt) : null;
            if (tile) g.drawImage(tile, hx - 20 * s, hy - 10.3 * s, 40 * s, 22.5 * s);
            if (o.nose) {
                g.fillStyle = sh(z.c, 0.9); g.beginPath(); g.ellipse(hx, hy + 2.2 * s, 3.8 * s, 2.8 * s, 0, 0, TAU); g.fill();
                g.fillStyle = 'rgba(255,255,255,.45)'; g.beginPath(); g.ellipse(hx - 1 * s, hy + 1.3 * s, 1.3 * s, 0.9 * s, 0, 0, TAU); g.fill();
            }
            if (o.hero) this._drawHeroHair(g, hx, hy, s, o.hat, false);
        },

        /** Окончательная картинка: тёмная обводка силуэта (толщина th px) и сама картинка. */
        _outlined(src, th) {
            const out = mkCanvas(src.width, src.height), g = ctxOf(out);
            const sil = mkCanvas(src.width, src.height), sg = ctxOf(sil);
            sg.drawImage(src, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = '#1B1B3A'; sg.fillRect(0, 0, src.width, src.height);
            for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; g.drawImage(sil, Math.cos(a) * th, Math.sin(a) * th); }
            g.drawImage(src, 0, 0);
            return out;
        },

        /** Нарисовать иконку предмета в холст size×size (px холста). */
        _drawIcon(it, size) {
            const src = mkCanvas(size, size), g = ctxOf(src);
            const pad = size * 0.09, avail = size - pad * 2;
            const a = it.art || {}, kind = kindOf(it);
            if (it.icon) {
                const t = trimmed(it.icon);
                if (t) { const sc = Math.min(avail / t.width, avail / t.height); g.drawImage(t, (size - t.width * sc) / 2, (size - t.height * sc) / 2, t.width * sc, t.height * sc); }
                return src;
            }
            if (kind === 'skin') {
                const s = avail / 218;
                this._drawFigure(g, a, { k: 'smile' }, size / 2, size - pad - 2 * s, s);
            } else if (kind === 'face') {
                const classic = resolveSkin(null).head;
                const s = avail / 74;
                const hx = size / 2, hy = size / 2 + 8 * s;
                this._drawHead(g, classic, null, hx, hy, s, { hero: true });
                const tile = this._faceTile(a);   // на иконке лицо крупнее, чем на голове (×1.2), чтобы читалось в карточке
                if (tile) g.drawImage(tile, hx - 24 * s, hy - 12.6 * s, 48 * s, 27 * s);
            } else if (kind === 'hat') {
                const def = this.shapeDef(it);
                const head = { k: 'rbox', s: [44, 44, 50], r: 10, p: [0, 0, 0], c: CLASSIC.head };
                const hatPrims = def ? def.prims : [];
                const pitch = 0.2;
                const b1 = drawPrims(g, [head], { s: 1, ox: 0, oy: 0, pitch, dry: true }), b2 = drawPrims(g, hatPrims, { s: 1, ox: 0, oy: 0, pitch, dry: true, fit: HEAD_FIT });
                const box = { x0: Math.min(b1.x0, b2.x0), y0: Math.min(b1.y0, b2.y0), x1: Math.max(b1.x1, b2.x1), y1: Math.max(b1.y1, b2.y1) };
                const sc = Math.min(avail / (box.x1 - box.x0), avail / (box.y1 - box.y0));
                const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
                const ox = size / 2 - cx * sc, oy = size / 2 - cy * sc;
                // голова (с лицом-наклейкой на передней грани), затем шляпа поверх
                drawPrims(g, [head], { s: sc, ox, oy, pitch });
                const tile = this._faceTile({ k: 'smile' });
                if (tile) g.drawImage(tile, ox - 20 * sc, oy - (10.3 * Math.cos(pitch) - 22.4 * Math.sin(pitch)) * sc, 40 * sc, 22.5 * Math.cos(pitch) * sc + 0.5);
                drawPrims(g, hatPrims, { s: sc, ox, oy, pitch, fit: HEAD_FIT });
            } else if (kind === 'pet') {
                const def = this.shapeDef(it);
                const prims = def ? def.prims : [];
                const o = { s: 1, ox: 0, oy: 0, yaw: 0.62, pitch: 0.22, dry: true };
                const box = drawPrims(g, prims, o);
                const sc = Math.min(avail / (box.x1 - box.x0), avail / (box.y1 - box.y0));
                const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
                drawPrims(g, prims, { ...o, s: sc, ox: size / 2 - cx * sc, oy: size / 2 - cy * sc, dry: false });
            } else if (kind === 'trail') {
                this._drawTrailIcon(g, a, size);
            }
            return src;
        },

        /** Плитка частицы следа: текстура из assets/fx (img) или своя форма; умножена на цвет. */
        _particleTile(a, color) {
            const base = a.img ? loadImg(a.img) : null;
            if (base) return tinted(base, color, 64, 64);
            const tile = mkCanvas(64, 64);
            TRAIL_TEX[a.tex](ctxOf(tile));
            return tinted(tile, color, 64, 64);
        },

        /** Цвет частицы следа в долях жизни t (0..1). */
        _trailColor(a, t) {
            if (a.grad) {
                let prev = a.grad[0];
                for (const st of a.grad) { if (st[0] >= t) { const span = Math.max(0.0001, st[0] - prev[0]); return mix(prev[1], st[1], clamp((t - prev[0]) / span, 0, 1)); } prev = st; }
                return a.grad[a.grad.length - 1][1];
            }
            return mix(a.c, a.c2 || a.c, (t * 3.7) % 1);
        },

        /** Иконка следа: тёмная плитка и цепочка частиц по дуге. */
        _drawTrailIcon(g, a, size) {
            const bg = g.createLinearGradient(0, 0, size, size);
            bg.addColorStop(0, '#2d2d63'); bg.addColorStop(1, '#16162f');
            g.fillStyle = bg; rrect(g, size * 0.06, size * 0.06, size * 0.88, size * 0.88, size * 0.2); g.fill();
            const n = 7;
            g.save(); rrect(g, size * 0.06, size * 0.06, size * 0.88, size * 0.88, size * 0.2); g.clip();
            for (let i = 0; i < n; i++) {
                const t = i / (n - 1);
                const x = size * (0.2 + 0.62 * t), y = size * (0.72 - 0.42 * t + 0.1 * Math.sin(t * 6.3 + 0.6));
                const d = size * (0.2 + 0.26 * t) * (a.tex === 'puff' || a.tex === 'glow' ? 1.25 : 1);
                const col = this._particleTile(a, this._trailColor(a, 1 - t));
                g.globalAlpha = 0.6 + 0.4 * t;
                g.save(); g.translate(x, y); g.rotate(a.spin ? (i * 1.7 - 2) * 0.5 : 0); g.drawImage(col, -d / 2, -d / 2, d, d); g.restore();
            }
            g.restore();
        },

        /**
         * Иконка предмета для карточки: <canvas> размером px × px (CSS), нарисован процедурно (или из готовой картинки предмета)
         * и кэшируется. Если картинка ещё грузится — холст перерисует себя сам. item — запись каталога или id.
         */
        icon(item, px) {
            const it = this.find(item);
            const css = px || 96;
            const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
            const size = Math.round(css * dpr);
            const out = mkCanvas(size, size);
            out.style.width = css + 'px'; out.style.height = css + 'px';
            if (!it) return out;
            const key = it.id + '@' + size;
            const paint = () => {
                let cached = this._iconCache.get(key);
                if (!cached) {
                    NEEDS.on = true; NEEDS.list.length = 0;
                    let img;
                    try { img = this._drawIcon(it, size); } catch (e) { console.warn('Cosmetics.icon:', it.id, e); img = mkCanvas(size, size); }
                    NEEDS.on = false;
                    const need = NEEDS.list.slice();
                    cached = this._outlined(img, Math.max(1.2, size / 48));
                    if (need.length) {
                        for (const s of need) loadImg(s, paint);   // перерисуем, как только картинка загрузится
                    } else this._iconCache.set(key, cached);
                }
                const g = ctxOf(out);
                g.clearRect(0, 0, size, size);
                g.drawImage(cached, 0, 0);
            };
            paint();
            return out;
        },

        /**
         * «Зеркало»: Нуб целиком в надетом (look — Shop.look()): скин с рисунком и деталями, лицо, шляпа, питомец рядом и частицы
         * следа за ногами. Холст px × px (CSS); не кэшируется (look меняется при примерке), готовые картинки подгружает сам.
         */
        portrait(look, px) {
            const L = look || {};
            const css = px || 160;
            const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
            const W = Math.round(css * dpr), Hh = W;
            const out = mkCanvas(W, Hh);
            out.style.width = css + 'px'; out.style.height = css + 'px';
            const skin = this.find(L.skin), face = this.find(L.face), hat = this.find(L.hat), pet = this.find(L.pet), trail = this.find(L.trail);
            const paint = () => {
                NEEDS.on = true; NEEDS.list.length = 0;
                const src = mkCanvas(W, Hh), g = ctxOf(src);
                const s = Hh / 262, ox = W * 0.44, oy = Hh * 0.96;
                const skinArt = skin ? skin.art : null;
                const accs = [];
                for (const ac of (skinArt && skinArt.acc) || []) { const def = accDef(ac); if (def) for (const on of [].concat(ac.on)) accs.push({ def, on }); }
                const drawAcc = (e) => { const an = ANCHOR[e.on]; if (an) drawPrims(g, e.def.prims, { s: e.on === 'head' ? s * HEAD_K : s, ox: ox + an[0] * s, oy: oy - an[1] * s, pitch: 0.06, fit: e.on === 'head' ? HEAD_FIT : undefined }); };
                if (trail && trail.art) {
                    for (let i = 0; i < 5; i++) {
                        const col = this._particleTile(trail.art, this._trailColor(trail.art, i / 5));
                        const d = (14 + i * 3) * s * 1.6;
                        g.globalAlpha = 0.95 - i * 0.15;
                        g.drawImage(col, ox - 38 * s - i * 17 * s - d / 2, oy - (10 + i * 7 + (i % 2) * 6) * s - d / 2, d, d);
                    }
                    g.globalAlpha = 1;
                }
                for (const e of accs) if (e.def.back) drawAcc(e);
                this._drawFigure(g, skinArt, face && !face.default ? face.art : { k: 'smile' }, ox, oy, s, { hat: !!hat });
                for (const e of accs) if (!e.def.back && !(e.on === 'head' && hat)) drawAcc(e);
                if (hat) {
                    const def = this.shapeDef(hat);
                    if (def) drawPrims(g, def.prims, { s: s * HEAD_K, ox, oy: oy - HEAD_C * s, pitch: 0.06, fit: HEAD_FIT });
                }
                if (pet) {
                    const def = this.shapeDef(pet);
                    if (def) drawPrims(g, def.prims, { s: s * 0.95, ox: ox + 92 * s, oy: oy - 120 * s, yaw: 0.5, pitch: 0.16 });
                }
                NEEDS.on = false;
                const need = NEEDS.list.slice();
                for (const n of need) loadImg(n, paint);
                const c = ctxOf(out);
                c.clearRect(0, 0, W, Hh);
                c.drawImage(this._outlined(src, Math.max(1.4, W / 90)), 0, 0);
            };
            paint();
            return out;
        },
    };
})();
