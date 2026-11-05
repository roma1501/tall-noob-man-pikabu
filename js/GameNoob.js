// GameNoob.js — герой (15 частей, жёсткий риг) — скелет, меши, прямая кинематика и IK ног.
// Свой мультяшный вид, не Roblox: крупная круглая голова с вихрами и наушниками, худи с капюшоном и шнурками,
// рюкзак, джинсы, кеды; руки и ноги — скруглённые «капсулы», торс сужается к поясу. Детали героя прячутся
// под другими скинами магазина и у боссов (Noob.dress). Скелет — свои суставы (не Rig.js): позу каждый кадр
// пишет Motion Matching (GameMotion.js) или рэгдолл.
//
// Поза: { hips: [x, y, z] — таз в системе корня (корень — точка на земле между стопами, курс персонажа),
//         rot: Float64Array(15·4) — локальные повороты суставов относительно родителя }.
// Покой (все повороты единичные) — персонаж стоит прямо, руки вдоль тела, нос по +X, правая рука +Z.
// Оси сустава совпадают с осями модели: поворот вокруг Z (+) уводит висящую конечность ВПЕРЁД,
// торс (смотрит вверх) — НАЗАД; вокруг X (+) висящая конечность уходит влево (−Z); вокруг Y (+) — поворот влево.
//
// Мир (World): pos — Float64Array(15·3), rot — Float64Array(15·4) — мировые положения и повороты суставов.

/** @satisfies {Record<string, any>} */
const Geo = {
    _wind: 0,   // знак обхода лицевых граней Babylon (вычисляется один раз по эталонному кубу)

    // Обход граней Babylon в этой сцене: dot(cross(p1−p0, p2−p0), n) у его куба.
    winding(scene) {
        if (this._wind) return this._wind;
        const ref = BABYLON.MeshBuilder.CreateBox('geo-ref', { size: 1 }, scene);
        const p = ref.getVerticesData(BABYLON.VertexBuffer.PositionKind), n = ref.getVerticesData(BABYLON.VertexBuffer.NormalKind);
        const ix = ref.getIndices();
        const a = ix[0] * 3, b = ix[1] * 3, c = ix[2] * 3;
        const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
        const cr = GM.cross([0, 0, 0], e1, e2);
        this._wind = (cr[0] * n[a] + cr[1] * n[a + 1] + cr[2] * n[a + 2]) >= 0 ? 1 : -1;
        ref.dispose();
        return this._wind;
    },

    // Построитель: вершины + треугольники с правильным обходом (по нормали).
    builder(scene) {
        const w = this.winding(scene);
        const pos = [], nor = [], uv = [], idx = [];
        return {
            pos, nor, uv, idx,
            vert(x, y, z, nx, ny, nz, u, v) { pos.push(x, y, z); nor.push(nx, ny, nz); uv.push(u, v); return pos.length / 3 - 1; },
            tri(a, b, c) {
                const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
                const e1x = pos[b * 3] - ax, e1y = pos[b * 3 + 1] - ay, e1z = pos[b * 3 + 2] - az;
                const e2x = pos[c * 3] - ax, e2y = pos[c * 3 + 1] - ay, e2z = pos[c * 3 + 2] - az;
                const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
                const nx = nor[a * 3] + nor[b * 3] + nor[c * 3], ny = nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1], nz = nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2];
                const s = (cx * nx + cy * ny + cz * nz) >= 0 ? 1 : -1;
                if (s === w) idx.push(a, b, c); else idx.push(a, c, b);
            },
            quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); },
            mesh(name) {
                const m = new BABYLON.Mesh(name, scene);
                const vd = new BABYLON.VertexData();
                vd.positions = pos; vd.normals = nor; vd.uvs = uv; vd.indices = idx;
                vd.applyToMesh(m);
                return m;
            },
        };
    },

    // Коробка с UV в мировых единицах (повтор текстуры каждые tile px) — площадки, стены, ящики.
    box(scene, name, sx, sy, sz, tile) {
        const B = this.builder(scene);
        const hx = sx / 2, hy = sy / 2, hz = sz / 2, t = tile || 200;
        // грань: нормаль, оси u и v в мире, их полуразмеры
        /** @type {any[]} */
        const faces = [
            [[1, 0, 0], [0, 0, -1], [0, 1, 0], hz, hy, hx], [[-1, 0, 0], [0, 0, 1], [0, 1, 0], hz, hy, hx],
            [[0, 1, 0], [1, 0, 0], [0, 0, -1], hx, hz, hy], [[0, -1, 0], [1, 0, 0], [0, 0, 1], hx, hz, hy],
            [[0, 0, 1], [1, 0, 0], [0, 1, 0], hx, hy, hz], [[0, 0, -1], [-1, 0, 0], [0, 1, 0], hx, hy, hz],
        ];
        for (const [n, u, v, hu, hv, hn] of faces) {
            const ids = [];
            for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                const x = n[0] * hn + u[0] * hu * su + v[0] * hv * sv;
                const y = n[1] * hn + u[1] * hu * su + v[1] * hv * sv;
                const z = n[2] * hn + u[2] * hu * su + v[2] * hv * sv;
                ids.push(B.vert(x, y, z, n[0], n[1], n[2], (hu * su + hu) / t, (hv * sv + hv) / t));
            }
            B.quad(ids[0], ids[1], ids[2], ids[3]);
        }
        return B.mesh(name);
    },

    // Скруглённая коробка (части героя): радиус r, m отсчётов на скругление; taper — ширина по z внизу (доля верха,
    // 1 — без сужения): торс шире в плечах, чем в поясе.
    roundBox(scene, name, sx, sy, sz, r, m, taper) {
        const B = this.builder(scene);
        const tp = taper || 1, fb = (1 - tp) / sy;   // f(y) = tp + fb·(y + sy/2): z·f, нормаль — обратной транспонированной
        const h = [sx / 2, sy / 2, sz / 2];
        r = Math.min(r, h[0] * 0.95, h[1] * 0.95, h[2] * 0.95);
        const inner = [h[0] - r, h[1] - r, h[2] - r];
        const samples = (k) => {    // координаты вдоль оси k: скругление, середина, скругление
            const out = [];
            for (let i = 0; i <= m; i++) out.push(-inner[k] - r * Math.cos(i * Math.PI / 2 / m));
            for (let i = 0; i <= m; i++) out.push(inner[k] + r * Math.sin(i * Math.PI / 2 / m));
            return out;
        };
        const S = [samples(0), samples(1), samples(2)];
        // грань: ось нормали a и знак, оси сетки b, c
        for (const [a, sgn, b, c] of [[0, 1, 2, 1], [0, -1, 2, 1], [1, 1, 0, 2], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 0, 1]]) {
            const sb = S[b], sc = S[c], grid = [];
            for (let i = 0; i < sb.length; i++) {
                const row = [];
                for (let j = 0; j < sc.length; j++) {
                    const p = [0, 0, 0];
                    p[a] = sgn * h[a]; p[b] = sb[i]; p[c] = sc[j];
                    const cl = [GM.clamp(p[0], -inner[0], inner[0]), GM.clamp(p[1], -inner[1], inner[1]), GM.clamp(p[2], -inner[2], inner[2])];
                    const d = [p[0] - cl[0], p[1] - cl[1], p[2] - cl[2]];
                    GM.norm(d, d);
                    const y = cl[1] + d[1] * r, z = cl[2] + d[2] * r, f = tp + fb * (y + h[1]);
                    const n = [d[0], d[1] - (z * fb / f) * d[2], d[2] / f];
                    GM.norm(n, n);
                    row.push(B.vert(cl[0] + d[0] * r, y, z * f, n[0], n[1], n[2], i / (sb.length - 1), j / (sc.length - 1)));
                }
                grid.push(row);
            }
            for (let i = 0; i < sb.length - 1; i++) for (let j = 0; j < sc.length - 1; j++) {
                B.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
            }
        }
        return B.mesh(name);
    },

    // Наклейка на передней грани (+X) скруглённой коробки sx×sy×sz (радиус r) по её поверхности: прямоугольник z ±hw,
    // y0..y1 переносится на скругление (по краям лицо огибает голову, а не висит плоскостью), lift — зазор над поверхностью.
    roundPatch(scene, name, sx, sy, sz, r, hw, y0, y1, lift, nu, nv) {
        const B = this.builder(scene);
        const h = [sx / 2, sy / 2, sz / 2];
        r = Math.min(r, h[0] * 0.95, h[1] * 0.95, h[2] * 0.95);
        const inner = [h[0] - r, h[1] - r, h[2] - r], grid = [];
        for (let i = 0; i <= nu; i++) {
            const z = hw - 2 * hw * i / nu, row = [];
            for (let j = 0; j <= nv; j++) {
                const y = y0 + (y1 - y0) * j / nv;
                const cl = [inner[0], GM.clamp(y, -inner[1], inner[1]), GM.clamp(z, -inner[2], inner[2])];
                const d = [h[0] - cl[0], y - cl[1], z - cl[2]];
                GM.norm(d, d);
                row.push(B.vert(cl[0] + d[0] * (r + lift), cl[1] + d[1] * (r + lift), cl[2] + d[2] * (r + lift), d[0], d[1], d[2], i / nu, j / nv));
            }
            grid.push(row);
        }
        for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) B.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
        return B.mesh(name);
    },

    // Тело вращения вокруг Y: профиль [{ r, y, nr, ny }] снизу вверх.
    lathe(scene, name, profile, seg) {
        const B = this.builder(scene);
        const rings = [];
        for (let k = 0; k < profile.length; k++) {
            const p = profile[k], ring = [];
            for (let i = 0; i <= seg; i++) {
                const a = i / seg * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
                ring.push(B.vert(p.r * ca, p.y, p.r * sa, p.nr * ca, p.ny, p.nr * sa, i / seg, k / (profile.length - 1)));
            }
            rings.push(ring);
        }
        for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < seg; i++) {
            const a = rings[k][i], b = rings[k][i + 1], c = rings[k + 1][i + 1], d = rings[k + 1][i];
            if (profile[k].r < 1e-6) B.tri(a, c, d);
            else if (profile[k + 1].r < 1e-6) B.tri(a, b, c);
            else B.quad(a, b, c, d);
        }
        return B.mesh(name);
    },

    // Профиль головы-цилиндра со скруглёнными торцами (для тел вращения).
    headProfile(R, H, b, steps) {
        const out = [{ r: 0, y: -H / 2, nr: 0, ny: -1 }];
        for (let i = 0; i <= steps; i++) {
            const a = -Math.PI / 2 + i / steps * Math.PI / 2;
            out.push({ r: R - b + b * Math.cos(a), y: -H / 2 + b + b * Math.sin(a), nr: Math.cos(a), ny: Math.sin(a) });
        }
        for (let i = 0; i <= steps; i++) {
            const a = i / steps * Math.PI / 2;
            out.push({ r: R - b + b * Math.cos(a), y: H / 2 - b + b * Math.sin(a), nr: Math.cos(a), ny: Math.sin(a) });
        }
        out.push({ r: 0, y: H / 2, nr: 0, ny: 1 });
        return out;
    },

    // Плоская наклейка лица на передней грани (+X): ширина ±hw по z, высота y0..y1; u слева направо для смотрящего в лицо.
    faceDecal(scene, name, x, hw, y0, y1) {
        const B = this.builder(scene);
        const a = B.vert(x, y0, hw, 1, 0, 0, 0, 0), b = B.vert(x, y0, -hw, 1, 0, 0, 1, 0);
        const c = B.vert(x, y1, -hw, 1, 0, 0, 1, 1), d = B.vert(x, y1, hw, 1, 0, 0, 0, 1);
        B.quad(a, b, c, d);
        return B.mesh(name);
    },

    // Наклейка на цилиндр (лицо): дуга от −half до +half вокруг +X, высота y0..y1.
    cylDecal(scene, name, R, half, y0, y1, segU, segV) {
        const B = this.builder(scene);
        const grid = [];
        for (let i = 0; i <= segU; i++) {
            const a = -half + i / segU * 2 * half, ca = Math.cos(a), sa = Math.sin(a), row = [];
            for (let j = 0; j <= segV; j++) {
                const y = y0 + (y1 - y0) * j / segV;
                row.push(B.vert(R * ca, y, R * sa, ca, 0, sa, 1 - i / segU, j / segV));
            }
            grid.push(row);
        }
        for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) B.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
        return B.mesh(name);
    },
};

/** @satisfies {Record<string, any>} */
const Noob = {
    // Суставы: имя, родитель (−1 — корень), смещение от родителя в покое (px).
    NAMES: ['Hips', 'Waist', 'Neck', 'ShoulderL', 'ElbowL', 'WristL', 'ShoulderR', 'ElbowR', 'WristR',
        'HipL', 'KneeL', 'AnkleL', 'HipR', 'KneeR', 'AnkleR'],
    PARENT: [-1, 0, 1, 1, 3, 4, 1, 6, 7, 0, 9, 10, 0, 12, 13],
    OFFSET: [
        0, 74, 0,      // Hips (от корня; в позе — свой hips)
        0, 10, 0,      // Waist
        0, 56, 0,      // Neck
        0, 48, -38,    // ShoulderL
        0, -30, 0,     // ElbowL
        0, -28, 0,     // WristL
        0, 48, 38,     // ShoulderR
        0, -30, 0,     // ElbowR
        0, -28, 0,     // WristR
        0, -8, -14.5,  // HipL
        0, -27, 0,     // KneeL
        0, -29, 0,     // AnkleL
        0, -8, 14.5,   // HipR
        0, -27, 0,     // KneeR
        0, -29, 0,     // AnkleR
    ],
    J: { HIPS: 0, WAIST: 1, NECK: 2, SHL: 3, ELL: 4, WRL: 5, SHR: 6, ELR: 7, WRR: 8, HIPL: 9, KNL: 10, ANL: 11, HIPR: 12, KNR: 13, ANR: 14 },
    COUNT: 15,
    /** @type {any} */ BODY1: null,   // тело без растяжения (ставится после объекта)
    THIGH: 27, SHIN: 29,           // длины бедра и голени (px)
    HIP_HEIGHT: 66,                // высота тазобедренного сустава в покое (прямые ноги)
    // Стопа: от центра подошвы до голеностопа и до носка/пятки (px, в осях стопы).
    FOOT_ANKLE: [-4, 10, 0], FOOT_HALF: 19,
    HEIGHT: 184,

    // Части: имя, сустав, форма, размер [x, y, z], центр от сустава, цвет, радиус скругления (taper — сужение торса).
    // limb — почти цилиндр (скругление ≈ половина толщины): руки и ноги тоньше торса, не квадратные блоки.
    PARTS: [
        ['LowerTorso', 0, 'box', [33, 16, 52], [0, 3, 0], 'hem', 7],
        ['UpperTorso', 1, 'torso', [35, 56, 58], [0, 28, 0], 'blue', 13],
        ['Head', 2, 'head', [44, 44, 50], [0, 24, 0], 'yellow', 17.5],
        ['UpperArmL', 3, 'limb', [20, 38, 20], [0, -11, 0], 'blue'],
        ['LowerArmL', 4, 'limb', [18, 30, 18], [0, -14, 0], 'blue'],
        ['HandL', 5, 'limb', [20, 18, 20], [0, -7, 0], 'yellow'],
        ['UpperArmR', 6, 'limb', [20, 38, 20], [0, -11, 0], 'blue'],
        ['LowerArmR', 7, 'limb', [18, 30, 18], [0, -14, 0], 'blue'],
        ['HandR', 8, 'limb', [20, 18, 20], [0, -7, 0], 'yellow'],
        ['UpperLegL', 9, 'limb', [25, 33, 25], [0, -12, 0], 'green'],
        ['LowerLegL', 10, 'limb', [22, 31, 22], [0, -14.5, 0], 'green'],
        ['FootL', 11, 'box', [38, 9.5, 24], [5, -4.25, 0], 'shoe', 4.5],
        ['UpperLegR', 12, 'limb', [25, 33, 25], [0, -12, 0], 'green'],
        ['LowerLegR', 13, 'limb', [22, 31, 22], [0, -14.5, 0], 'green'],
        ['FootR', 14, 'box', [38, 9.5, 24], [5, -4.25, 0], 'shoe', 4.5],
    ],
    HEAD_K: 1.1,   // голова крупнее (мультяшные пропорции): масштаб меша головы вместе с лицом, волосами и шляпами
    // Цвета героя: персиковая кожа, коралловое худи (кромка темнее), синие джинсы, белые кеды.
    // Ключи прежние (их перекрашивают боссы): yellow — кожа (голова, кисти), blue — худи, green — джинсы.
    COLORS: { yellow: [247, 200, 164], blue: [240, 84, 76], hem: [212, 64, 60], green: [47, 63, 102], shoe: [250, 247, 242] },
    // Пряди волос героя: [основание, направление, длина, толщина] в осях головы (по ним же рисует иконку Cosmetics).
    STRANDS: [
        [[13, 19, 5], [1, 0.95, -0.55], 23, 17], [[12, 19, -8], [1, 0.75, -0.8], 20, 15], [[12, 20, 14], [0.85, 1, 0.05], 18, 14],   // чёлка
        [[3, 22, -10], [0.15, 1, -0.45], 22, 16], [[2, 22, 9], [0.05, 1, 0.5], 21, 16], [[-7, 22, 0], [-0.55, 1, 0], 24, 18],         // макушка
        [[-14, 17, -12], [-1, 0.55, -0.5], 19, 15], [[-15, 17, 11], [-1, 0.55, 0.5], 19, 15], [[-17, 4, 0], [-0.7, -0.6, 0], 11, 13],   // затылок
        [[5, 14, -23], [0.25, 0.55, -1], 12, 12], [[5, 14, 23], [0.25, 0.55, 1], 12, 12],                                             // над ушами
    ],
    // Детали героя: волосы (шапка и вихры), наушники, капюшон, шнурки, карман, рюкзак, манжеты, подошвы кед.
    HERO: { hair: [96, 58, 34], tuft: [126, 80, 46], phones: [54, 196, 110], phonesDark: [32, 92, 62], hood: [212, 64, 60],
        string: [250, 246, 240], pack: [72, 176, 98], packDark: [40, 116, 68], sole: [239, 107, 90], soleSkin: [232, 232, 238] },

    // Тело с ростом sh и шириной sw (растяжение): длины костей, размеры и смещения частей.
    // Голова почти не растёт, кисти и стопы — слабо; ноги, руки и торс тянутся целиком.
    body(sh, sw) {
        sh = sh || 1; sw = sw || 1;
        const k = (s, f) => 1 + (s - 1) * f;
        const tH = k(sh, 1), tW = k(sw, 1), aH = k(sh, 1), aW = k(sw, 0.8), lH = k(sh, 1), lW = k(sw, 0.85);
        const hdH = k(sh, 0.12), hdW = k(sw, 0.35), haH = k(sh, 0.25), haW = k(sw, 0.6), fH = k(sh, 0.3), fW = k(sw, 0.6);
        const sx = 28 * tW + 10 * aW;
        const off = new Float64Array([
            0, 56 * lH + 10 * fH + 8 * tH, 0,
            0, 10 * tH, 0,
            0, 56 * tH, 0,
            0, 48 * tH, -sx, 0, -30 * aH, 0, 0, -28 * aH, 0,
            0, 48 * tH, sx, 0, -30 * aH, 0, 0, -28 * aH, 0,
            0, -8 * tH, -14.5 * tW, 0, -27 * lH, 0, 0, -29 * lH, 0,
            0, -8 * tH, 14.5 * tW, 0, -27 * lH, 0, 0, -29 * lH, 0,
        ]);
        const K = this.HEAD_K;
        const ps = [[tW, tH, tW], [tW, tH, tW], [hdW * K, hdH * K, hdW * K], [aW, aH, aW], [aW, aH, aW], [haW, haH, haW], [aW, aH, aW], [aW, aH, aW], [haW, haH, haW],
            [lW, lH, lW], [lW, lH, lW], [fW, fH, fW], [lW, lH, lW], [lW, lH, lW], [fW, fH, fW]];
        const po = this.PARTS.map((p, i) => {
            const o = p[4], c = ps[i];
            return i === 2 ? [0, 22 * hdH * K + 1.8, 0] : [o[0] * c[0], o[1] * c[1], o[2] * c[2]];
        });
        return { sh, sw, off, partScale: ps, partOff: po, thigh: 27 * lH, shin: 29 * lH, footHalf: 19 * fW, footAnkle: [-4 * fW, 10 * fH, 0],
            hx: lH, hy: off[1] / 74, hz: tW, leg: lH, wide: tW, height: 184 * sh };
    },

    newPose() {
        const rot = new Float64Array(this.COUNT * 4);
        for (let j = 0; j < this.COUNT; j++) rot[j * 4 + 3] = 1;
        return { hips: new Float64Array([0, 74, 0]), rot };
    },
    copyPose(o, a) { o.hips.set(a.hips); o.rot.set(a.rot); return o; },
    newWorld() { return { pos: new Float64Array(this.COUNT * 3), rot: new Float64Array(this.COUNT * 4) }; },

    // Прямая кинематика: поза + корень (позиция на земле, поворот) -> мировые суставы.
    fk(pose, rootPos, rootQ, w, body) {
        const B = body || this.BODY1, P = this.PARENT, O = B.off, wp = w.pos, wr = w.rot, lr = pose.rot;
        const q = this._fq, v = this._fv, pq = this._fpq;
        for (let j = 0; j < this.COUNT; j++) {
            const p = P[j];
            if (p < 0) {
                GM.qmul(q, rootQ, [lr[0], lr[1], lr[2], lr[3]]);
                const hv = this._fh; hv[0] = pose.hips[0] * B.hx; hv[1] = pose.hips[1] * B.hy; hv[2] = pose.hips[2] * B.hz;
                GM.qrot(v, rootQ, hv);
                wp[0] = rootPos[0] + v[0]; wp[1] = rootPos[1] + v[1]; wp[2] = rootPos[2] + v[2];
            } else {
                pq[0] = wr[p * 4]; pq[1] = wr[p * 4 + 1]; pq[2] = wr[p * 4 + 2]; pq[3] = wr[p * 4 + 3];
                const lq = this._flq; lq[0] = lr[j * 4]; lq[1] = lr[j * 4 + 1]; lq[2] = lr[j * 4 + 2]; lq[3] = lr[j * 4 + 3];
                GM.qmul(q, pq, lq);
                const off = this._fo; off[0] = O[j * 3]; off[1] = O[j * 3 + 1]; off[2] = O[j * 3 + 2];
                GM.qrot(v, pq, off);
                wp[j * 3] = wp[p * 3] + v[0]; wp[j * 3 + 1] = wp[p * 3 + 1] + v[1]; wp[j * 3 + 2] = wp[p * 3 + 2] + v[2];
            }
            GM.qnorm(q, q);
            wr[j * 4] = q[0]; wr[j * 4 + 1] = q[1]; wr[j * 4 + 2] = q[2]; wr[j * 4 + 3] = q[3];
        }
        return w;
    },
    _fh: [0, 0, 0], _fq: [0, 0, 0, 1], _fv: [0, 0, 0], _fpq: [0, 0, 0, 1], _flq: [0, 0, 0, 1], _fo: [0, 0, 0],

    getPos(w, j, o) { o[0] = w.pos[j * 3]; o[1] = w.pos[j * 3 + 1]; o[2] = w.pos[j * 3 + 2]; return o; },
    setPos(w, j, a) { w.pos[j * 3] = a[0]; w.pos[j * 3 + 1] = a[1]; w.pos[j * 3 + 2] = a[2]; },
    getRot(w, j, o) { o[0] = w.rot[j * 4]; o[1] = w.rot[j * 4 + 1]; o[2] = w.rot[j * 4 + 2]; o[3] = w.rot[j * 4 + 3]; return o; },
    setRot(w, j, q) { w.rot[j * 4] = q[0]; w.rot[j * 4 + 1] = q[1]; w.rot[j * 4 + 2] = q[2]; w.rot[j * 4 + 3] = q[3]; },
    getLocal(pose, j, o) { const r = pose.rot; o[0] = r[j * 4]; o[1] = r[j * 4 + 1]; o[2] = r[j * 4 + 2]; o[3] = r[j * 4 + 3]; return o; },
    setLocal(pose, j, q) { const r = pose.rot; r[j * 4] = q[0]; r[j * 4 + 1] = q[1]; r[j * 4 + 2] = q[2]; r[j * 4 + 3] = q[3]; },

    // Пересчитать потомков сустава j по их локальным поворотам (после правки мирового поворота/позиции j).
    fkChildren(pose, w, from, body) {
        const P = this.PARENT, O = (body || this.BODY1).off;
        const pq = this._fpq, lq = this._flq, q = this._fq, v = this._fv, off = this._fo;
        for (let j = from + 1; j < this.COUNT; j++) {
            let a = P[j], inside = false;
            while (a >= 0) { if (a === from) { inside = true; break; } a = P[a]; }
            if (!inside) continue;
            const p = P[j];
            this.getRot(w, p, pq); this.getLocal(pose, j, lq);
            GM.qmul(q, pq, lq); GM.qnorm(q, q); this.setRot(w, j, q);
            off[0] = O[j * 3]; off[1] = O[j * 3 + 1]; off[2] = O[j * 3 + 2];
            GM.qrot(v, pq, off);
            w.pos[j * 3] = w.pos[p * 3] + v[0]; w.pos[j * 3 + 1] = w.pos[p * 3 + 1] + v[1]; w.pos[j * 3 + 2] = w.pos[p * 3 + 2] + v[2];
        }
    },

    // Мировой поворот сустава -> локальный в позе (по мировому повороту родителя; корень — rootQ).
    storeLocal(pose, w, j, rootQ) {
        const p = this.PARENT[j], q = this._lq, pq = this._lpq;
        this.getRot(w, j, q);
        if (p < 0) GM.qinvmul(q, rootQ, q); else { this.getRot(w, p, pq); GM.qinvmul(q, pq, q); }
        GM.qabs(q, q);
        this.setLocal(pose, j, q);
    },
    _lq: [0, 0, 0, 1], _lpq: [0, 0, 0, 1],

    // Подошва стопы (центр, на земле) + курс стопы + тангаж (носок вниз > 0, поворот вокруг носка; < 0 — вокруг пятки)
    // -> мировой поворот стопы и положение голеностопа.
    footFrame(sole, heading, pitch, ground, outQ, outAnkle, body) {
        const B = body || this.BODY1;
        const qy = GM.qheading(this._ffq, heading), qp = GM.qz(this._ffp, -pitch);
        GM.qmul(outQ, qy, qp);
        if (ground) {   // наклон стопы по нормали земли
            const tilt = GM.qbetween(this._fft, [0, 1, 0], ground);
            GM.qmul(outQ, tilt, outQ);
        }
        const piv = this._ffv, tmp = this._ffw, H = B.footHalf;
        // опорная точка: носок или пятка (в осях стопы без тангажа), затем подошва поворачивается вокруг неё
        const s = pitch >= 0 ? H : -H;
        const base = ground ? GM.qmul(this._ffb, GM.qbetween(this._fft, [0, 1, 0], ground), qy) : qy;
        GM.qrot(piv, base, [s, 0, 0]); GM.add(piv, sole, piv);
        GM.qrot(tmp, outQ, [s, 0, 0]);
        const c = GM.sub(this._ffc, piv, tmp);   // центр подошвы после поворота
        GM.qrot(tmp, outQ, B.footAnkle);
        return GM.add(outAnkle, c, tmp);
    },
    _ffq: [0, 0, 0, 1], _ffp: [0, 0, 0, 1], _fft: [0, 0, 0, 1], _ffb: [0, 0, 0, 1], _ffv: [0, 0, 0], _ffw: [0, 0, 0], _ffc: [0, 0, 0],

    // IK ноги (два звена): бедро у сустава hip, голеностоп — в target, ось сгиба колена axis (мир, «вправо» ноги:
    // колено уходит вперёд от неё), стопа — мировой поворот footQ (null — оставить из FK). Пишет мир и локальные повороты.
    ikLeg(pose, w, side, target, axis, footQ, body) {
        const BD = body || this.BODY1;
        const J = this.J;
        const jh = side ? J.HIPR : J.HIPL, jk = jh + 1, ja = jh + 2;
        const H = this.getPos(w, jh, this._ih), A = this._ia;
        const l1 = BD.thigh, l2 = BD.shin;
        const d = GM.sub(this._id, target, H);
        let L = GM.len(d);
        const Lmax = l1 + l2 - 0.05, Lmin = Math.abs(l1 - l2) + 4;
        if (L < 1e-4) { GM.set(d, 0, -1, 0); L = 1e-4; } else GM.scale(d, d, 1 / L);
        L = GM.clamp(L, Lmin, Lmax);
        GM.adds(A, H, d, L);
        // направление колена: ось × нога (вперёд при оси «вправо» и ноге вниз)
        const b = GM.cross(this._ib, axis, d);
        if (GM.len(b) < 1e-4) GM.set(b, 1, 0, 0);
        GM.norm(b, b);
        const ca = GM.clamp((l1 * l1 + L * L - l2 * l2) / (2 * l1 * L), -1, 1), sa = Math.sqrt(1 - ca * ca);
        const K = this._ik;
        K[0] = H[0] + d[0] * l1 * ca + b[0] * l1 * sa; K[1] = H[1] + d[1] * l1 * ca + b[1] * l1 * sa; K[2] = H[2] + d[2] * l1 * ca + b[2] * l1 * sa;
        const up = this._iu, lo = this._il, dn = this._idn;
        GM.scale(dn, GM.sub(dn, K, H), 1 / l1);
        GM.qlimbZ(up, dn, axis);
        GM.scale(dn, GM.sub(dn, A, K), 1 / l2);
        GM.qlimbZ(lo, dn, axis);
        this.setRot(w, jh, up); this.setRot(w, jk, lo);
        this.setPos(w, jk, K); this.setPos(w, ja, A);
        if (footQ) this.setRot(w, ja, footQ);
        this.storeLocal(pose, w, jh, null); this.storeLocal(pose, w, jk, null); this.storeLocal(pose, w, ja, null);
    },
    // Ось сгиба колена: правая ось таза, к ней — правая ось стопы (колено над носком), но только пока стопа
    // сонаправлена с тазом: на развороте опорная стопа смотрит «по-старому», и смесь осей вырождалась бы.
    kneeAxis(o, footQ, hipsQ) {
        const a = GM.qrot(this._ka, footQ, [0, 0, 1]), b = GM.qrot(this._kb, hipsQ, [0, 0, 1]);
        const w = 0.65 * GM.smooth((a[0] * b[0] + a[2] * b[2] - 0.2) / 0.6);
        o[0] = a[0] * w + b[0] * (1 - w); o[1] = (a[1] * w + b[1] * (1 - w)) * 0.3; o[2] = a[2] * w + b[2] * (1 - w);
        return GM.norm(o, o);
    },
    _ka: [0, 0, 0], _kb: [0, 0, 0],
    _ih: [0, 0, 0], _ia: [0, 0, 0], _id: [0, 0, 0], _ib: [0, 0, 0], _ik: [0, 0, 0], _iu: [0, 0, 0, 1], _il: [0, 0, 0, 1], _idn: [0, 0, 0],

    // ---- меши ----------------------------------------------------------------------------------

    // Собрать героя в сцене: корень (единичный, в начале координат) + части-дети, мировые трансформы ставит apply().
    build(view) {
        const scene = view.scene;
        const root = new BABYLON.Mesh('noob', scene);
        const mats = {};
        const mat = (name, c) => {
            const m = new BABYLON.StandardMaterial(name, scene);
            m.diffuseColor = BABYLON.Color3.FromInts(c[0], c[1], c[2]);
            m.emissiveColor = m.diffuseColor.scale(0.16);   // мягкая подсветка: против солнца не сереет
            m.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);
            return m;
        };
        for (const k of Object.keys(this.COLORS)) mats[k] = mat('noob-' + k, this.COLORS[k]);
        const parts = [];
        let face = null;
        for (const [name, joint, kind, size, off, color, rad] of this.PARTS) {
            let mesh;
            if (kind === 'head') {
                mesh = Geo.roundBox(scene, 'noob-' + name, size[0], size[1], size[2], rad, 3);
                face = Geo.roundPatch(scene, 'noob-face', size[0], size[1], size[2], rad, 20, -12.2, 10.3, 0.4, 14, 7);   // 40×22.5 — холст 256×144
                face.material = this.faceMaterial(scene);
                face.parent = mesh;
                face.isPickable = false;
            } else if (kind === 'limb') {
                mesh = Geo.roundBox(scene, 'noob-' + name, size[0], size[1], size[2], Math.min(size[0], size[2]) * 0.47, 3);
            } else {
                mesh = Geo.roundBox(scene, 'noob-' + name, size[0], size[1], size[2], rad || 3.2, kind === 'torso' ? 3 : 2, kind === 'torso' ? 0.9 : 1);
            }
            mesh.material = mats[color];
            mesh.parent = root;
            mesh.rotationQuaternion = new BABYLON.Quaternion();
            mesh.isPickable = false;
            parts.push({ mesh, joint, off });
        }
        const hero = this.heroParts(scene, parts, mats, mat);
        World3D.addObject(view, root, 'actor');
        // у наклейки лица — без контура рёбер (иначе по её краю пошла бы рамка)
        if (face && face.edgesRenderer) face.disableEdgesRendering();
        const model = { root, parts, mats, face, hero, look: null };
        this.dress(model, { hero: true, hat: false, face: true, nose: false });
        return model;
    },

    // Детали героя — дети частей тела (растягиваются и падают вместе с ними). Куски одного цвета на одной части
    // сливаются в один меш: меньше вызовов отрисовки. Координаты — в осях части (центр части, лицо +X, верх +Y, ±Z — бока).
    heroParts(scene, parts, mats, mat) {
        const C = this.HERO, M = {};
        for (const k of Object.keys(C)) M[k] = mat('noob-hero-' + k, C[k]);
        const place = (mesh, p, r, s) => {
            mesh.position.set(p[0], p[1], p[2]);
            if (r) mesh.rotation.set(r[0], r[1], r[2]);
            if (s) mesh.scaling.set(s[0], s[1], s[2]);
            return mesh;
        };
        const rb = (s, r, p, rot) => place(Geo.roundBox(scene, 'hero-piece', s[0], s[1], s[2], r, 2), p, rot);
        const sph = (d, p, rot) => place(BABYLON.MeshBuilder.CreateSphere('hero-piece', { diameterX: d[0], diameterY: d[1], diameterZ: d[2], segments: 10 }, scene), p, rot);
        // прядь: конус от основания b в сторону dir длиной h (основание прячется в шапке волос)
        const strand = (b, dir, h, d) => {
            const m = BABYLON.MeshBuilder.CreateCylinder('hero-piece', { height: h, diameterBottom: d, diameterTop: d * 0.16, tessellation: 9 }, scene);
            const D = new BABYLON.Vector3(dir[0], dir[1], dir[2]).normalize();
            m.rotationQuaternion = new BABYLON.Quaternion();
            BABYLON.Quaternion.FromUnitVectorsToRef(BABYLON.Vector3.Up(), D, m.rotationQuaternion);
            m.position.set(b[0] + D.x * h / 2, b[1] + D.y * h / 2, b[2] + D.z * h / 2);
            return m;
        };
        const cyl = (o, p, rot) => place(BABYLON.MeshBuilder.CreateCylinder('hero-piece', o, scene), p, rot);
        const tor = (o, p, rot, s) => place(BABYLON.MeshBuilder.CreateTorus('hero-piece', o, scene), p, rot, s);
        const merge = (name, list, part, m) => {
            const out = list.length > 1 ? BABYLON.Mesh.MergeMeshes(list, true, true) : list[0];
            out.name = 'noob-' + name;
            out.material = m;
            out.parent = parts[part].mesh;
            out.isPickable = false;
            return out;
        };
        const HEAD = 2, CHEST = 1;
        // волосы: шапка и затылок (остаются под шляпой) + вихры на макушке (прячутся под шляпой)
        // шапка и затылок — эллипсоиды (не коробка): спереди край волос выше лба, сзади — до шеи
        const hair = merge('hair', [sph([48, 26, 55], [-6, 17, 0]), sph([30, 40, 54], [-8, 6, 0])], HEAD, M.hair);
        const tufts = merge('tufts', this.STRANDS.map(([b, d, h, w]) => strand(b, d, h, w)), HEAD, M.tuft);
        // наушники: дуга над головой (прячется под шляпой), чашки и мягкие амбушюры у ушей
        const arc = [];
        for (let i = 0; i <= 18; i++) { const a = i / 18 * Math.PI; arc.push(new BABYLON.Vector3(-2, 3 + 33 * Math.sin(a), 29.5 * Math.cos(a))); }
        const band = BABYLON.MeshBuilder.CreateTube('noob-phones-band', { path: arc, radius: 2.8, tessellation: 10, cap: BABYLON.Mesh.CAP_ALL }, scene);
        band.material = M.phones; band.parent = parts[HEAD].mesh; band.isPickable = false;
        const cups = merge('phones', [-1, 1].flatMap(s => [
            cyl({ diameter: 21, height: 8, tessellation: 20 }, [-1, 1, s * 29.5], [Math.PI / 2, 0, 0]),
            cyl({ diameter: 14, height: 2.4, tessellation: 18 }, [-1, 1, s * 34.3], [Math.PI / 2, 0, 0]),
        ]), HEAD, M.phones);
        const pads = merge('phones-pads', [-1, 1].map(s => cyl({ diameter: 18, height: 3, tessellation: 18 }, [-1, 1, s * 25.7], [Math.PI / 2, 0, 0])), HEAD, M.phonesDark);
        const nose = merge('nose', [sph([6, 5.5, 7.5], [22.2, -2, 0])], HEAD, mats.yellow);
        // худи: воротник-капюшон вокруг шеи, капюшон на спине, карман-кенгуру (тёмный коралл), белые шнурки
        const hood = merge('hood', [
            tor({ diameter: 34, thickness: 12, tessellation: 24 }, [-5, 26.5, 0], null, [0.85, 0.75, 1]),
            rb([10, 20, 32], 5, [-21, 18, 0]), rb([2.4, 13, 28], 1.2, [17.6, -11, 0]),
        ], CHEST, M.hood);
        const strings = merge('strings', [-1, 1].flatMap(s => [
            cyl({ diameter: 2.4, height: 15, tessellation: 8 }, [18.4, 15, s * 5.5], [0, 0, 0.06]),
            sph([3.8, 3.8, 3.8], [18.7, 7.4, s * 5.5]),
        ]), CHEST, M.string);
        // рюкзак: корпус и ручка; карман и лямки — тёмно-зелёные
        const pack = merge('pack', [rb([15, 40, 40], 6, [-24.5, 1, 0]), tor({ diameter: 11, thickness: 2.6, tessellation: 14 }, [-24, 21.5, 0], [Math.PI / 2, Math.PI / 2, 0])], CHEST, M.pack);
        const straps = merge('straps', [rb([6, 17, 28], 3, [-33, -6, 0])].concat([-1, 1].flatMap(s => [
            rb([2.6, 32, 6], 1.2, [18.2, 3, s * 16.5]), rb([38, 3.2, 6], 1.4, [-3, 28.6, s * 16.5]),
        ])), CHEST, M.packDark);
        // манжеты рукавов (у кисти) и подошвы кед со шнуровкой
        const cuffs = [4, 7].map(i => merge('cuff', [tor({ diameter: 17.5, thickness: 4.4, tessellation: 18 }, [0, -12.5, 0])], i, M.hood));
        const soles = [11, 14].map(i => merge('sole', [rb([40, 3.4, 25.5], 1.6, [0.5, -4.1, 0]), rb([10, 2, 11], 1, [7, 4.5, 0])], i, M.sole));
        return { body: [hair, cups, pads, hood, strings, pack, straps].concat(cuffs), top: [tufts, band], nose, soles, mats: M };
    },

    // Вид героя: hero — детали героя (на других скинах и у боссов прячутся), hat — шляпа (вихры и дуга наушников
    // прячутся под ней), face — лицо по умолчанию (иначе нос прячется), nose — нос без деталей героя (боссы).
    dress(model, o) {
        const L = model.look = Object.assign(model.look || {}, o || {}), H = model.hero;
        if (!H) return;
        const on = (list, v) => { for (const m of list) if (m) m.setEnabled(!!v); };
        on(H.body, L.hero);
        on(H.top, L.hero && !L.hat);
        on([H.nose], L.hero ? L.face : L.nose);
        const c = L.hero ? this.HERO.sole : this.HERO.soleSkin, m = H.mats.sole;
        m.diffuseColor = BABYLON.Color3.FromInts(c[0], c[1], c[2]);
        m.emissiveColor = m.diffuseColor.scale(0.16);
    },

    // Лицо: глаза и улыбка на прозрачном фоне.
    faceMaterial(scene) {
        const W = 256, H = 144;
        const tex = new BABYLON.DynamicTexture('noob-face-tex', { width: W, height: H }, scene, true);
        const ctx = /** @type {CanvasRenderingContext2D} */ (/** @type {any} */ (tex.getContext()));
        this.drawFace(ctx, W, H);
        tex.hasAlpha = true;
        tex.update(true);
        const m = new BABYLON.StandardMaterial('noob-face', scene);
        m.diffuseTexture = tex;
        m.useAlphaFromDiffuseTexture = true;
        m.specularColor = new BABYLON.Color3(0, 0, 0);
        m.diffuseColor = new BABYLON.Color3(1, 1, 1);
        m.zOffset = -2;
        return m;
    },

    // Лицо по умолчанию: большие карие глаза с бликами, густые брови, румянец, открытая улыбка.
    drawFace(ctx, W, H) {
        ctx.clearRect(0, 0, W, H);
        const ink = '#2a1b2e';
        for (const sx of [-1, 1]) {
            const cx = W * (0.5 + sx * 0.2), cy = H * 0.42;
            ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(cx, cy, W * 0.085, H * 0.15, 0, 0, Math.PI * 2); ctx.fill();
            ctx.lineWidth = W * 0.022; ctx.strokeStyle = ink; ctx.stroke();
            ctx.fillStyle = '#7a4a2a'; ctx.beginPath(); ctx.ellipse(cx + sx * W * 0.008, cy + H * 0.02, W * 0.058, H * 0.105, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = ink; ctx.beginPath(); ctx.ellipse(cx + sx * W * 0.01, cy + H * 0.025, W * 0.032, H * 0.06, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(cx + W * 0.022, cy - H * 0.035, W * 0.021, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(cx - W * 0.016, cy + H * 0.07, W * 0.009, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#4a2c1a'; ctx.lineWidth = W * 0.034; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(cx - W * 0.075, cy - H * 0.22); ctx.quadraticCurveTo(cx, cy - H * 0.33, cx + W * 0.075, cy - H * 0.24); ctx.stroke();
        }
        // румянец
        ctx.fillStyle = 'rgba(255,110,110,0.35)';
        for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(W * (0.5 + sx * 0.32), H * 0.66, W * 0.06, H * 0.05, 0, 0, Math.PI * 2); ctx.fill(); }
        // открытая улыбка с языком
        ctx.fillStyle = ink;
        ctx.beginPath(); ctx.moveTo(W * 0.38, H * 0.66); ctx.quadraticCurveTo(W * 0.5, H * 0.95, W * 0.62, H * 0.66); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ff7a8a';
        ctx.beginPath(); ctx.ellipse(W * 0.5, H * 0.8, W * 0.05, H * 0.045, 0, 0, Math.PI * 2); ctx.fill();
    },

    // Поставить части по мировым суставам (body — растяжение: смещения и масштаб частей).
    apply(model, w, body) {
        const B = body || this.BODY1, v = this._av, q = this._aq;
        for (let i = 0; i < model.parts.length; i++) {
            const p = model.parts[i], j = p.joint;
            this.getRot(w, j, q);
            GM.qrot(v, q, B.partOff[i]);
            p.mesh.position.set(w.pos[j * 3] + v[0], w.pos[j * 3 + 1] + v[1], w.pos[j * 3 + 2] + v[2]);
            p.mesh.rotationQuaternion.set(q[0], q[1], q[2], q[3]);
            const sc = B.partScale[i];
            p.mesh.scaling.set(sc[0], sc[1], sc[2]);
        }
    },
    _av: [0, 0, 0], _aq: [0, 0, 0, 1],
};
Noob.BODY1 = Noob.body(1, 1);
