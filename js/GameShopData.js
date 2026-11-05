// GameShopData.js — каталог магазина Tall Noob Run, награды Daily Gift и секторы колеса.
// Контракт — docs/shop-contract.md. Только данные: логику ведут Shop.js / DailyGift.js / Wheel.js, вид предметов на Нубе и в
// карточках рисует GameCosmetics.js по полю `art` (оно читается ТАМ, в Shop.js его никто не трогает).
//
// ПРЕДМЕТ: { id, tab, slot?, name: { ru, en }, rarity, price: { coins } | { ads: 1..5 }, default?, exclusive?, noWheel?, icon?, art }
//   Вкладки: brainrot (первая, магазин открывается на ней) | skin | face | hat | trail | pet. Предметы brainrot лежат в слоте skin — надеваются вместо скина.
//   Основные 5 вкладок: 20+ предметов, ≈35% за монеты, ≈65% за рекламу (1–5 просмотров) — это проверяет Shop.validate().
//   brainrot — особое требование пользователя: 9 скинов ТОЛЬКО за рекламу, 3–7 просмотров (больше обычного лимита 1–5), поэтому
//   Shop.validate() видит в этой вкладке ровно три вида «замечаний»: tabItems (9 < 20), split (0% за монеты), adsRange (6 и 7 просмотров).
//   noWheel: true — такой предмет не выдаётся случайным призом колеса и подарка дня (их приёмник наград — ShopUI.sink()).
//   icon — готовая картинка карточки (путь литералом), иначе иконку рисует Cosmetics.icon.
//   art для вкладок (подробно — шапка GameCosmetics.js):
//     skin  — зоны тела: head, chest, belt, sleeve, arm, hand, thigh, shin, foot; зона — '#цвет' или { c, k, c2, c3, n, e }
//             (k — узор: stripes, vstripes, band, plaid, dots, camo, tiger, spots, flames, gradient, galaxy, pixel,
//             rainbow, grid, scales, circuit, patches, argyle; e — свечение). Голова: { c, hair, hairY, band, visor, stripes }.
//             decal — рисунок на груди и спине { src | text, c (тон), s (размер), dy, back }; acc — детали из примитивов на частях тела.
//     face  — { k: ключ рисунка в Cosmetics.FACES } или { img: путь к картинке лица }
//     hat   — { k: ключ в Cosmetics.HATS, c: [цвета] }
//     pet   — { k: ключ в Cosmetics.PETS, c: [цвета] }
//     trail — параметры частиц: tex (форма), img (текстура частицы вместо формы), c, c2, blend, rate, life, size, speed, dir, grav, spin, grad, a
// Числа цен и награды — здесь же (Constants.js этому агенту править нельзя): забег даёт ≈ 40–120 монет, первая покупка (120)
// — после 2–3 забегов, самая дорогая вещь (1800) — цель на 3–4 недели с подарком дня и колесом.

/** @type {any[]} */
const SHOP_TABS = [
    { id: 'brainrot', icon: 'brainrot', special: true, name: { ru: 'Брейнрот', en: 'Brainrot' } },
    { id: 'skin', icon: 'skin', name: { ru: 'Скины', en: 'Skins' } },
    { id: 'face', icon: 'face', name: { ru: 'Лица', en: 'Faces' } },
    { id: 'hat', icon: 'hat', name: { ru: 'Шляпы', en: 'Hats' } },
    { id: 'trail', icon: 'trail', name: { ru: 'Следы', en: 'Trails' } },
    { id: 'pet', icon: 'pet', name: { ru: 'Питомцы', en: 'Pets' } },
];

/** @type {any[]} */
const SHOP_ITEMS = (() => {
    /** @type {any[]} */
    const items = [];
    const coins = (n) => ({ coins: n });
    const ads = (n) => ({ ads: n });
    /** Предмет: вкладка, id, название ru/en, редкость, цена, art, остальные поля. */
    const add = (tab, id, ru, en, rarity, price, art, extra) => {
        items.push({ id: tab + '_' + id, tab, name: { ru, en }, rarity, price, art, ...extra });
    };
    /** Зона скина с узором: цвет, узор, второй цвет, { c3, n, e }. */
    const P = (c, k, c2, o) => ({ c, k, c2, ...o });
    /** Рисунок на груди (и спине, если back): src — картинка-маска (тонируется цветом c) или text. */
    const Dc = (src, c, o) => ({ src, c, ...o });
    /** Деталь на части тела: on — часть (или список), k — форма из Cosmetics.ACC, c — цвета. */
    const Ac = (on, k, c) => ({ on, k, c });
    /** Скин брейнрота: только за рекламу (3–7), слот skin, не выпадает на колесе и в подарке дня. */
    const brain = (id, ru, en, rarity, n, icon, art) => add('brainrot', id, ru, en, rarity, ads(n), art, { slot: 'skin', noWheel: true, icon });

    // ===========================================================================================
    // СКИНЫ: схемы цветов, узоры, рисунки на груди и детали — не перекраска одного цвета.
    // ===========================================================================================
    // Стартовый вид — герой: коралловое худи, синие джинсы, белые кеды (как Noob.COLORS); hero — волосы, наушники и рюкзак
    // на иконке (в 3D это детали модели).
    add('skin', 'classic', 'Классика', 'Classic', 'common', null,
        Object.assign({ head: '#f7c8a4', chest: '#f0544c', belt: '#d4403c', sleeve: '#f0544c', arm: '#f0544c', hand: '#f7c8a4', thigh: '#2f3f66', shin: '#2f3f66', foot: '#faf7f2' }, { hero: true }), { default: true });
    // --- за монеты (9)
    add('skin', 'lumber', 'Лесоруб', 'Lumberjack', 'common', coins(180), {
        head: { c: '#f1c27d', hair: '#6b3f1d' }, chest: P('#b3261e', 'plaid', '#1c1c1c'), belt: '#3b2a20',
        sleeve: P('#b3261e', 'plaid', '#1c1c1c'), hand: '#f1c27d', thigh: '#3d5a80', foot: '#5b3a1e' });
    add('skin', 'astro', 'Космонавт', 'Astronaut', 'common', coins(260), {
        head: { c: '#eef2f7', visor: [-9, 12, '#bfe6ff'] }, chest: '#f4f6fa', belt: '#cfd6e0',
        sleeve: '#f4f6fa', hand: '#ff8c42', thigh: '#f4f6fa', foot: '#ff8c42',
        decal: Dc('assets/textures/decals/astro.webp', null, { s: 38, back: true }) });
    add('skin', 'hoodie', 'Худи', 'Hoodie Kid', 'uncommon', coins(340), {
        head: { c: '#f1c27d', hair: '#3b2a20', hairY: 10 }, chest: '#e63946', belt: '#b82a37', sleeve: '#e63946', hand: '#f1c27d',
        thigh: '#2b3a55', foot: '#ffffff', decal: Dc('assets/textures/decals/hoodie.webp', '#ff9aa3', { s: 54, dy: -2 }),
        acc: [Ac('chest', 'hood', ['#e63946'])] });
    add('skin', 'farmer', 'Фермер', 'Farmer', 'uncommon', coins(440), {
        head: { c: '#f1c27d' }, chest: '#c0392b', belt: '#35609e', sleeve: '#c0392b', hand: '#f1c27d', thigh: '#4a78c0', foot: '#5b3a1e',
        decal: Dc('assets/textures/decals/overalls.webp', '#4a78c0', { s: 58, dy: -2 }), acc: [Ac('head', 'straw', ['#f0d27a', '#c0392b'])] });
    add('skin', 'pirate', 'Пират', 'Pirate', 'uncommon', coins(560), {
        head: { c: '#f1c27d', hair: '#c62828', hairY: 10.5 }, chest: P('#f5f5f5', 'stripes', '#1b2a4a', { n: 7 }), belt: '#5b3a1e',
        sleeve: '#f5f5f5', arm: '#f1c27d', hand: '#f1c27d', thigh: '#4a3426', foot: '#1c1c1c' });
    add('skin', 'ninja', 'Ниндзя', 'Ninja', 'rare', coins(740), {
        head: { c: '#16161d', band: [-6, 9, '#f1c27d'] }, chest: '#1a1a24', belt: '#d62828', sleeve: '#1a1a24', thigh: '#1a1a24', foot: '#2a2a35' });
    add('skin', 'zombie', 'Зомби', 'Zombie', 'rare', coins(920), {
        head: { c: '#7fb069', hair: '#2f3e2c', hairY: 10 }, chest: P('#566573', 'patches', '#3d4852'), belt: '#3d4852', sleeve: '#566573',
        arm: '#7fb069', hand: '#7fb069', thigh: '#3f6c9b', shin: P('#3f6c9b', 'patches', '#2f4f73'), foot: '#2f2f2f',
        decal: Dc('assets/textures/decals/bandage.webp', '#e9e1c8', { s: 44, back: true }) });
    add('skin', 'robot', 'Робот', 'Robot', 'epic', coins(1200), {
        head: { c: '#b8c4d0', visor: [-9, 12, '#37e2ff'] }, chest: '#8d99a6', belt: '#4a5568',
        sleeve: '#aab4c0', arm: P('#8d99a6', 'circuit', '#37e2ff', { e: 0.25 }), hand: '#3a4452', thigh: '#8d99a6',
        shin: P('#8d99a6', 'circuit', '#37e2ff', { e: 0.25 }), foot: '#3a4452',
        decal: Dc('assets/textures/decals/robot.webp', '#4fe6ff', { s: 52, back: true }) });
    add('skin', 'lava', 'Лавовый голем', 'Lava Golem', 'epic', coins(1600), {
        head: { c: '#ff9a1f', hair: '#2b1b17', hairY: 8 }, chest: P('#2b1b17', 'flames', '#ff7a18', { c3: '#ffd23f', e: 0.35 }), belt: '#ff7a18',
        sleeve: P('#2b1b17', 'flames', '#ff7a18', { c3: '#ffd23f', e: 0.35 }), arm: '#2b1b17', hand: '#ff7a18',
        thigh: P('#2b1b17', 'flames', '#ff7a18', { c3: '#ffd23f', e: 0.35 }), shin: '#2b1b17', foot: '#ff7a18' });
    // --- за рекламу (17): 1 просмотр — обычные, 5 — легендарные
    add('skin', 'candy', 'Леденец', 'Candy Cane', 'common', ads(1), {
        head: { c: '#ffe3ef', hair: '#ff7eb6', hairY: 11 }, chest: P('#ffffff', 'vstripes', '#ff7eb6', { n: 6 }), belt: '#ff7eb6',
        sleeve: '#ff7eb6', arm: '#ffffff', hand: '#ff7eb6', thigh: P('#ff7eb6', 'vstripes', '#ffffff', { n: 4 }), foot: '#ffffff',
        decal: Dc('assets/textures/decals/heart.webp', '#ff4d8d', { s: 28, back: true }) });
    add('skin', 'bee', 'Пчёлка', 'Bumblebee', 'common', ads(1), {
        head: { c: '#ffd23f', stripes: [4, '#1b1b1b'] }, chest: P('#ffd23f', 'stripes', '#1b1b1b', { n: 6 }), belt: '#1b1b1b',
        sleeve: '#1b1b1b', arm: '#ffd23f', hand: '#1b1b1b', thigh: P('#ffd23f', 'stripes', '#1b1b1b', { n: 4 }), foot: '#1b1b1b' });
    add('skin', 'zebra', 'Зебра', 'Zebra', 'uncommon', ads(2), {
        head: { c: '#ffffff', hair: '#1b1b1b', hairY: 11 }, chest: P('#ffffff', 'vstripes', '#1b1b1b', { n: 8 }), belt: '#1b1b1b',
        sleeve: P('#ffffff', 'vstripes', '#1b1b1b', { n: 4 }), arm: '#ffffff', hand: '#1b1b1b', thigh: P('#ffffff', 'vstripes', '#1b1b1b', { n: 6 }), foot: '#1b1b1b' });
    add('skin', 'cow', 'Корова', 'Cow', 'uncommon', ads(2), {
        head: { c: '#ffffff', hair: '#2b2b2b', hairY: 11 }, chest: P('#ffffff', 'spots', '#2b2b2b'), belt: '#ffffff',
        sleeve: P('#ffffff', 'spots', '#2b2b2b'), arm: '#ffd1dc', hand: '#ffb3c6', thigh: P('#ffffff', 'spots', '#2b2b2b'), shin: '#ffffff', foot: '#2b2b2b' });
    add('skin', 'mermaid', 'Русалка', 'Mermaid', 'uncommon', ads(2), {
        head: { c: '#f1c27d', hair: '#1fb5a3', hairY: 9 }, chest: P('#ff8fb8', 'scales', '#ff5d99'), belt: '#1fb5a3',
        sleeve: '#f1c27d', hand: '#f1c27d', thigh: P('#1fb5a3', 'scales', '#0e8f84'), foot: '#0e8f84' });
    add('skin', 'suit', 'Деловой костюм', 'Business Suit', 'uncommon', ads(2), {
        head: { c: '#f1c27d', hair: '#1b1b1b', hairY: 10 }, chest: '#ffffff', belt: '#1f1f2b', sleeve: '#1f1f2b', hand: '#f1c27d', thigh: '#1f1f2b', foot: '#111111',
        decal: Dc('assets/textures/decals/tie.webp', '#d62828', { s: 40, dy: -2 }) });
    add('skin', 'camo', 'Камуфляж', 'Camo Soldier', 'rare', ads(3), {
        head: { c: '#d9b38c', hair: '#4b5320', hairY: 8 }, chest: P('#6b7a3a', 'camo', '#3f4a21', { c3: '#8b9a5b' }), belt: '#3a3a2a',
        sleeve: P('#6b7a3a', 'camo', '#3f4a21', { c3: '#8b9a5b' }), hand: '#d9b38c', thigh: P('#6b7a3a', 'camo', '#3f4a21', { c3: '#8b9a5b' }), foot: '#2f2a22' });
    add('skin', 'tiger', 'Тигр', 'Tiger', 'rare', ads(3), {
        head: { c: '#ff9f1c', stripes: [3, '#1b1b1b'] }, chest: P('#ff9f1c', 'tiger', '#1b1b1b'), belt: '#ffdd99',
        sleeve: P('#ff9f1c', 'tiger', '#1b1b1b'), arm: '#ff9f1c', hand: '#ffe8c2', thigh: P('#ff9f1c', 'tiger', '#1b1b1b'), foot: '#ffe8c2' });
    add('skin', 'clown', 'Клоун', 'Clown', 'rare', ads(3), {
        head: { c: '#ffffff', hair: '#ff3b30', hairY: 10.5 }, chest: '#ffe14d', belt: '#2e86ff',
        sleeve: P('#2e86ff', 'dots', '#ffe14d'), arm: '#ffe14d', hand: '#ffffff', thigh: P('#ff3b30', 'vstripes', '#ffffff', { n: 4 }), foot: '#2e86ff',
        decal: Dc('assets/textures/decals/buttons.webp', '#2e86ff', { s: 40, dy: -2 }) });
    add('skin', 'skeleton', 'Скелет', 'Skeleton', 'rare', ads(3), {
        head: { c: '#f4f4f4' }, chest: '#15151d', belt: '#f4f4f4', sleeve: '#15151d', arm: '#f4f4f4', hand: '#f4f4f4', thigh: '#15151d', shin: '#f4f4f4', foot: '#f4f4f4',
        decal: Dc('assets/textures/decals/ribs.webp', '#eeeeee', { s: 52, back: true }) });
    add('skin', 'ice', 'Ледяной', 'Frosty', 'epic', ads(4), {
        head: { c: '#d6f4ff', hair: '#ffffff', hairY: 10 }, chest: P('#9fe3ff', 'gradient', '#ffffff', { e: 0.15 }), belt: '#6ccbff',
        sleeve: P('#9fe3ff', 'gradient', '#ffffff', { e: 0.15 }), arm: '#c9f1ff', hand: '#ffffff', thigh: P('#7ad4ff', 'gradient', '#e8fbff', { e: 0.15 }), foot: '#ffffff',
        decal: Dc('assets/textures/decals/snow.webp', '#ffffff', { s: 42, back: true }) });
    add('skin', 'galaxy', 'Галактика', 'Galaxy', 'epic', ads(4), {
        head: { c: '#a58bff', hair: '#1a1042', hairY: 10 }, chest: P('#1a1042', 'galaxy', '#ffffff', { c3: '#9d6bff', e: 0.3 }), belt: '#7b61ff',
        sleeve: P('#1a1042', 'galaxy', '#ffffff', { c3: '#9d6bff', e: 0.3 }), hand: '#a58bff', thigh: P('#1a1042', 'galaxy', '#ffffff', { c3: '#9d6bff', e: 0.3 }), foot: '#7b61ff',
        decal: Dc('assets/textures/decals/stars.webp', '#ffe9a8', { s: 40, back: true }) });
    add('skin', 'pixel', 'Пиксель-герой', 'Pixel Hero', 'epic', ads(4), {
        head: { c: '#ffc9a4', hair: '#3b2a5a', hairY: 12 }, chest: P('#7b4fd6', 'pixel', '#4b2a9a', { c3: '#b99bff' }), belt: '#ffd23f',
        sleeve: P('#7b4fd6', 'pixel', '#4b2a9a', { c3: '#b99bff' }), arm: '#ffc9a4', hand: '#ffc9a4', thigh: P('#2bb3a0', 'pixel', '#1b7f70', { c3: '#7be0d0' }), foot: '#3a2a5a',
        decal: Dc('assets/textures/decals/heart.webp', '#e63946', { s: 30, back: true }) });
    add('skin', 'knight', 'Рыцарь', 'Knight', 'epic', ads(4), {
        head: { c: '#c0c8d4', hair: '#5b6572', hairY: 9 }, chest: '#9aa5b5', belt: '#5b6572', sleeve: '#9aa5b5', arm: '#7f8a9a', hand: '#5b6572',
        thigh: '#7f8a9a', shin: '#9aa5b5', foot: '#5b6572', decal: Dc('assets/textures/decals/shield.webp', '#e0c46a', { s: 44, back: true }),
        acc: [Ac('head', 'plume', ['#d62828'])] });
    add('skin', 'rainbow', 'Радуга', 'Rainbow', 'legendary', ads(5), {
        head: { c: '#ffffff', hair: '#ff5d73', hairY: 11 }, chest: '#ffffff', belt: '#ffffff',
        sleeve: P('#ff4d4d', 'rainbow', '#ffffff', { e: 0.2 }), hand: '#ffffff', thigh: P('#ff4d4d', 'rainbow', '#ffffff', { e: 0.2 }), foot: '#ffffff',
        decal: Dc('assets/textures/decals/rainbow.webp', null, { s: 48, back: true }) });
    add('skin', 'neon', 'Неон', 'Neon Grid', 'legendary', ads(5), {
        head: { c: '#161633', visor: [-9, 12, '#39ff14'] }, chest: P('#0d0d1f', 'grid', '#ff2bd6', { c3: '#00f0ff', e: 0.55 }), belt: '#00f0ff',
        sleeve: P('#0d0d1f', 'grid', '#ff2bd6', { c3: '#00f0ff', e: 0.55 }), hand: '#ff2bd6', thigh: P('#0d0d1f', 'grid', '#ff2bd6', { c3: '#00f0ff', e: 0.55 }), foot: '#00f0ff',
        decal: Dc('assets/textures/decals/neon.webp', '#00f0ff', { s: 46, back: true }) });
    add('skin', 'super', 'Супергерой', 'Super Hero', 'legendary', ads(5), {
        head: { c: '#ffc9a4', band: [-1, 9, '#d62828'] }, chest: '#2d6cdf', belt: '#d62828', sleeve: '#2d6cdf', hand: '#d62828', thigh: '#2d6cdf', foot: '#d62828',
        decal: Dc('assets/textures/decals/super.webp', null, { s: 40 }), acc: [Ac('chest', 'cape', ['#d62828', '#f6c945'])] });
    // --- эксклюзивы Daily Gift (день 7 каждого круга): не продаются и не выпадают на колесе
    add('skin', 'royal', 'Королевский бегун', 'Royal Runner', 'legendary', null, {
        head: { c: '#ffc9a4', hair: '#f2c14e', hairY: 11 }, chest: P('#5b2a86', 'argyle', '#f2c14e'), belt: '#f2c14e',
        sleeve: P('#5b2a86', 'argyle', '#f2c14e'), arm: '#f6e7b4', hand: '#ffffff', thigh: '#3b1c5a', foot: '#f2c14e' }, { exclusive: 'daily' });
    add('skin', 'gold', 'Золотой бегун', 'Golden Runner', 'legendary', null, {
        head: { c: '#ffd24d', hair: '#e0a800', hairY: 11 }, chest: P('#ffd24d', 'gradient', '#c98e00', { e: 0.3 }), belt: '#fff1a8',
        sleeve: P('#ffd24d', 'gradient', '#c98e00', { e: 0.3 }), arm: '#ffd24d', hand: '#fff1a8', thigh: P('#ffd24d', 'gradient', '#c98e00', { e: 0.3 }), foot: '#fff1a8',
        decal: Dc('assets/textures/decals/badge.webp', '#fff1a8', { s: 40, back: true }) }, { exclusive: 'daily' });
    add('skin', 'crystal', 'Кристальный бегун', 'Crystal Runner', 'legendary', null, {
        head: { c: '#c9f4ff', hair: '#7be0ff', hairY: 10 }, chest: P('#6fd3ff', 'argyle', '#ffffff', { c3: '#c47bff', e: 0.3 }), belt: '#c47bff',
        sleeve: P('#6fd3ff', 'argyle', '#ffffff', { c3: '#c47bff', e: 0.3 }), arm: '#c9f4ff', hand: '#ffffff',
        thigh: P('#a67bff', 'argyle', '#ffffff', { c3: '#6fd3ff', e: 0.3 }), foot: '#6fd3ff',
        decal: Dc('assets/textures/decals/gem.webp', '#ffffff', { s: 38, back: true }) }, { exclusive: 'daily' });

    // ===========================================================================================
    // ЛИЦА: готовые рисунки пользователя (img) и свои, процедурные (k), на прозрачном холсте 256×144
    // ===========================================================================================
    add('face', 'smile', 'Улыбка', 'Classic Smile', 'common', null, { k: 'smile' }, { default: true });
    // --- за монеты (9)
    add('face', 'grin', 'Широкая улыбка', 'Big Grin', 'common', coins(120), { img: 'assets/ui/faces/grin.webp' });
    add('face', 'wink', 'Подмиг', 'Wink', 'common', coins(160), { img: 'assets/ui/faces/wink.webp' });
    add('face', 'happy', 'Радость', 'Happy', 'uncommon', coins(220), { img: 'assets/ui/faces/happy.webp' });
    add('face', 'cool', 'Крутые очки', 'Shades', 'uncommon', coins(300), { img: 'assets/ui/faces/cool.webp' });
    add('face', 'cute', 'Милашка', 'Cutie', 'rare', coins(420), { img: 'assets/ui/faces/cute.webp' });
    add('face', 'angry', 'Сердитый', 'Grumpy', 'rare', coins(560), { img: 'assets/ui/faces/angry.webp' });
    add('face', 'hearts', 'Влюблённый', 'Heart Eyes', 'rare', coins(740), { k: 'hearts' });
    add('face', 'robot', 'Робот', 'Robot', 'epic', coins(1000), { img: 'assets/ui/faces/robot.webp' });
    add('face', 'king', 'Усатый король', 'Mustache King', 'epic', coins(1300), { img: 'assets/ui/faces/king.webp' });
    // --- за рекламу (16)
    add('face', 'surprised', 'Удивление', 'Surprised', 'common', ads(1), { img: 'assets/ui/faces/surprised.webp' });
    add('face', 'sleepy', 'Сонный', 'Sleepy', 'common', ads(1), { k: 'sleepy' });
    add('face', 'sweet', 'Милая улыбка', 'Sweet Smile', 'common', ads(1), { img: 'assets/ui/faces/smile.webp' });
    add('face', 'tongue', 'Дразнилка', 'Cheeky', 'uncommon', ads(2), { k: 'tongue' });
    add('face', 'cat', 'Котик', 'Kitty', 'uncommon', ads(2), { k: 'cat' });
    add('face', 'nerd', 'Умник', 'Nerd', 'uncommon', ads(2), { k: 'nerd' });
    add('face', 'mad', 'Вне себя', 'Furious', 'rare', ads(3), { img: 'assets/ui/faces/mad.webp' });
    add('face', 'cyclops', 'Циклоп', 'Cyclops', 'rare', ads(3), { k: 'cyclops' });
    add('face', 'pirate', 'Одноглазый', 'Eye Patch', 'rare', ads(3), { k: 'pirate' });
    add('face', 'zombie', 'Зомби', 'Zombie', 'rare', ads(3), { img: 'assets/ui/faces/zombie.webp' });
    add('face', 'stars', 'Звёздный', 'Star Struck', 'epic', ads(4), { k: 'stars' });
    add('face', 'vampire', 'Вампир', 'Vampire', 'epic', ads(4), { k: 'vampire' });
    add('face', 'money', 'Богач', 'Rich', 'epic', ads(4), { k: 'money' });
    add('face', 'ninja', 'Ниндзя', 'Ninja Mask', 'epic', ads(4), { img: 'assets/ui/faces/ninja.webp' });
    add('face', 'evil', 'Злодей', 'Villain', 'legendary', ads(5), { img: 'assets/ui/faces/evil.webp' });
    add('face', 'ghost', 'Призрак', 'Spooky', 'legendary', ads(5), { k: 'ghost' });

    // ===========================================================================================
    // ШЛЯПЫ: формы из примитивов (Cosmetics.HATS[k]); c — цвета по порядку, как описано у формы
    // ===========================================================================================
    add('hat', 'cap', 'Кепка', 'Cap', 'common', coins(150), { k: 'cap', c: ['#d62828', '#9a1b1b'] });
    add('hat', 'beanie', 'Шапка с помпоном', 'Pom Beanie', 'common', coins(220), { k: 'beanie', c: ['#3a86ff', '#1d4fb5', '#ffffff'] });
    add('hat', 'bucket', 'Панама', 'Bucket Hat', 'uncommon', coins(320), { k: 'bucket', c: ['#8fbf6a', '#4d7a35'] });
    add('hat', 'top', 'Цилиндр', 'Top Hat', 'uncommon', coins(450), { k: 'top', c: ['#1b1b2a', '#c62828'] });
    add('hat', 'viking', 'Шлем викинга', 'Viking Helm', 'rare', coins(650), { k: 'viking', c: ['#aab4c0', '#f3e9d2', '#5b6572'] });
    add('hat', 'wizard', 'Колпак мага', 'Wizard Hat', 'rare', coins(950), { k: 'wizard', c: ['#4b2e83', '#f2c14e', '#ffe066'] });
    add('hat', 'crown', 'Корона', 'Crown', 'epic', coins(1400), { k: 'crown', c: ['#f6c945', '#e63946', '#4cc9f0'] });
    add('hat', 'cone', 'Дорожный конус', 'Traffic Cone', 'common', ads(1), { k: 'cone', c: ['#ff7a18', '#ffffff'] });
    add('hat', 'party', 'Праздничный колпак', 'Party Hat', 'common', ads(1), { k: 'party', c: ['#ff5d73', '#ffd23f', '#4cc9f0'] });
    add('hat', 'chef', 'Колпак повара', 'Chef Hat', 'uncommon', ads(2), { k: 'chef', c: ['#ffffff', '#e9ecf2'] });
    add('hat', 'hard', 'Каска', 'Hard Hat', 'uncommon', ads(2), { k: 'hard', c: ['#ffc21a', '#e0a000'] });
    add('hat', 'catears', 'Кошачьи ушки', 'Cat Ears', 'uncommon', ads(2), { k: 'catears', c: ['#2b2b3a', '#4a4a5e', '#ff8fb8'] });
    add('hat', 'cowboy', 'Ковбойская шляпа', 'Cowboy Hat', 'rare', ads(3), { k: 'cowboy', c: ['#a8743c', '#5b3a1e', '#f6c945'] });
    add('hat', 'duck', 'Уточка на голове', 'Rubber Duck', 'rare', ads(3), { k: 'duck', c: ['#ffd93d', '#ff8c1a'] });
    add('hat', 'santa', 'Новогодний колпак', 'Holiday Hat', 'rare', ads(3), { k: 'santa', c: ['#d62828', '#ffffff'] });
    add('hat', 'prop', 'Кепка с пропеллером', 'Propeller Cap', 'epic', ads(4), { k: 'prop', c: ['#4cc9f0', '#ff5d73', '#ffd23f'] });
    add('hat', 'mush', 'Гриб', 'Mushroom', 'epic', ads(4), { k: 'mush', c: ['#e63946', '#ffffff', '#f3e5c8'] });
    add('hat', 'horns', 'Рожки', 'Devil Horns', 'epic', ads(4), { k: 'horns', c: ['#e0182d', '#2b2b3a'] });
    add('hat', 'unicorn', 'Рог единорога', 'Unicorn Horn', 'legendary', ads(5), { k: 'unicorn', c: ['#fff1fb', '#f6c945', '#ff8fb8'] });
    add('hat', 'halo', 'Нимб', 'Halo', 'legendary', ads(5), { k: 'halo', c: ['#ffe066'] });

    // ===========================================================================================
    // СЛЕДЫ: частицы из-под ног. tex — своя форма (Cosmetics.TRAIL_TEX), img — готовая текстура частицы (assets/fx), icon — картинка карточки
    // ===========================================================================================
    add('trail', 'dust', 'Пыль', 'Dust Puffs', 'common', coins(140), {
        tex: 'puff', img: 'assets/fx/cloud_puff.webp', c: '#e6d8bb', c2: '#c9b894', blend: 'standard', a: 0.75, rate: 24, life: [0.5, 0.9], size: [12, 22], speed: [4, 14],
        dir: [[-0.5, 0.3, -0.5], [0.5, 0.9, 0.5]], grav: [0, 8, 0] });
    add('trail', 'bubbles', 'Пузырьки', 'Bubbles', 'common', coins(200), {
        tex: 'ring', c: '#bfe9ff', c2: '#ffffff', blend: 'standard', a: 0.9, rate: 16, life: [0.9, 1.6], size: [8, 16], speed: [3, 12],
        dir: [[-0.4, 0.5, -0.4], [0.4, 1, 0.4]], grav: [0, 22, 0], icon: 'assets/ui/trails/trail-blue.webp' });
    add('trail', 'sparkle', 'Искры', 'Sparkles', 'uncommon', coins(300), {
        tex: 'spark', img: 'assets/fx/star.webp', c: '#ffc21a', c2: '#ff9f1c', blend: 'standard', a: 1, rate: 38, life: [0.35, 0.8], size: [9, 16], speed: [6, 26],
        dir: [[-1, 0.2, -1], [1, 1, 1]], grav: [0, -10, 0], spin: [-4, 4], icon: 'assets/ui/trails/trail-gold.webp' });
    add('trail', 'hearts', 'Сердечки', 'Hearts', 'uncommon', coins(420), {
        tex: 'heart', img: 'assets/fx/heart.webp', c: '#ff5d8f', c2: '#ff9ec0', blend: 'standard', a: 0.95, rate: 12, life: [0.9, 1.5], size: [11, 17], speed: [6, 16],
        dir: [[-0.5, 0.6, -0.5], [0.5, 1, 0.5]], grav: [0, 14, 0] });
    add('trail', 'snow', 'Снегопад', 'Snowfall', 'rare', coins(600), {
        tex: 'flake', c: '#ffffff', c2: '#cfeaff', blend: 'standard', a: 0.95, rate: 30, life: [0.9, 1.6], size: [8, 14], speed: [4, 18],
        dir: [[-1, 0.2, -1], [1, 0.8, 1]], grav: [0, -22, 0], spin: [-2, 2] });
    add('trail', 'fire', 'Огонь', 'Flames', 'rare', coins(850), {
        tex: 'flame', c: '#ff5a1f', c2: '#ffb000', blend: 'standard', a: 0.95, rate: 50, life: [0.3, 0.65], size: [14, 24], speed: [8, 26],
        dir: [[-0.3, 0.6, -0.3], [0.3, 1, 0.3]], grav: [0, 60, 0] });
    add('trail', 'rainbow', 'Радуга', 'Rainbow', 'epic', coins(1300), {
        tex: 'glow', c: '#ffffff', blend: 'standard', a: 0.85, rate: 56, life: [0.6, 1], size: [14, 22], speed: [2, 8],
        dir: [[-0.3, 0.2, -0.3], [0.3, 0.6, 0.3]], grav: [0, 4, 0], icon: 'assets/ui/trails/trail-rainbow.webp',
        grad: [[0, '#ff4d4d'], [0.2, '#ffb84d'], [0.4, '#ffe94d'], [0.6, '#5be36b'], [0.8, '#4dc9ff'], [1, '#a06bff', 0]] });
    add('trail', 'smoke', 'Дымок', 'Smoke Puffs', 'common', ads(1), {
        tex: 'puff', img: 'assets/fx/smoke.webp', c: '#d0d3dc', c2: '#a4a9b6', blend: 'standard', a: 0.7, rate: 20, life: [0.8, 1.4], size: [14, 26], speed: [3, 12],
        dir: [[-0.4, 0.5, -0.4], [0.4, 1, 0.4]], grav: [0, 16, 0] });
    add('trail', 'leaves', 'Листопад', 'Falling Leaves', 'common', ads(1), {
        tex: 'leaf', c: '#6ab04c', c2: '#e0a030', blend: 'standard', a: 1, rate: 14, life: [1, 1.8], size: [11, 18], speed: [4, 16],
        dir: [[-1, 0.3, -1], [1, 1, 1]], grav: [0, -18, 0], spin: [-3, 3], icon: 'assets/ui/trails/trail-green.webp' });
    add('trail', 'confetti', 'Конфетти', 'Confetti', 'uncommon', ads(2), {
        tex: 'square', img: 'assets/fx/confetti.webp', c: '#ff4d6d', c2: '#4cc9f0', blend: 'standard', a: 1, rate: 40, life: [0.6, 1.2], size: [6, 11], speed: [20, 70],
        dir: [[-1, 0.6, -1], [1, 1.4, 1]], grav: [0, -110, 0], spin: [-8, 8] });
    add('trail', 'pixels', 'Пиксели', 'Pixels', 'uncommon', ads(2), {
        tex: 'square', c: '#1ed760', c2: '#00a844', blend: 'standard', a: 1, rate: 44, life: [0.5, 1], size: [5, 9], speed: [4, 16],
        dir: [[-0.6, 0.2, -0.6], [0.6, 1, 0.6]], grav: [0, -34, 0] });
    add('trail', 'notes', 'Мелодия', 'Music Notes', 'uncommon', ads(2), {
        tex: 'note', c: '#7b61ff', c2: '#ff5d73', blend: 'standard', a: 1, rate: 10, life: [1, 1.7], size: [14, 22], speed: [6, 18],
        dir: [[-0.5, 0.6, -0.5], [0.5, 1, 0.5]], grav: [0, 16, 0] });
    add('trail', 'petals', 'Лепестки', 'Petals', 'rare', ads(3), {
        tex: 'petal', c: '#ffb7d5', c2: '#ff8fb8', blend: 'standard', a: 0.95, rate: 16, life: [1, 1.7], size: [9, 15], speed: [5, 18],
        dir: [[-1, 0.3, -1], [1, 1, 1]], grav: [0, -16, 0], spin: [-3, 3] });
    add('trail', 'coins', 'Золотой дождь', 'Gold Coins', 'rare', ads(3), {
        tex: 'coin', img: 'assets/fx/coin.webp', c: '#ffffff', c2: '#ffe6a0', blend: 'standard', a: 1, rate: 9, life: [0.6, 1], size: [12, 18], speed: [30, 70],
        dir: [[-0.4, 1, -0.4], [0.4, 1.4, 0.4]], grav: [0, -150, 0], spin: [-6, 6] });
    add('trail', 'slime', 'Слизь', 'Slime Drops', 'rare', ads(3), {
        tex: 'drop', c: '#7bff6a', c2: '#2fbf4f', blend: 'standard', a: 0.95, rate: 16, life: [0.5, 0.9], size: [9, 15], speed: [10, 36],
        dir: [[-0.8, 0.4, -0.8], [0.8, 1, 0.8]], grav: [0, -120, 0] });
    add('trail', 'lightning', 'Молния', 'Lightning', 'epic', ads(4), {
        tex: 'bolt', c: '#27c4ff', c2: '#7be0ff', blend: 'standard', a: 1, rate: 18, life: [0.12, 0.3], size: [16, 30], speed: [10, 40],
        dir: [[-1, 0.2, -1], [1, 1, 1]], grav: [0, 0, 0], spin: [-6, 6] });
    add('trail', 'ice', 'Льдинки', 'Ice Shards', 'epic', ads(4), {
        tex: 'shard', img: 'assets/fx/diamond.webp', c: '#ffffff', c2: '#cfeeff', blend: 'standard', a: 0.95, rate: 20, life: [0.5, 1], size: [10, 18], speed: [8, 30],
        dir: [[-1, 0.3, -1], [1, 1, 1]], grav: [0, -40, 0], spin: [-4, 4] });
    add('trail', 'ghost', 'Призраки', 'Ghost Wisps', 'epic', ads(4), {
        tex: 'wisp', c: '#a28bff', c2: '#59d6c4', blend: 'standard', a: 0.8, rate: 14, life: [1, 1.8], size: [16, 26], speed: [3, 12],
        dir: [[-0.4, 0.5, -0.4], [0.4, 1, 0.4]], grav: [0, 20, 0], icon: 'assets/ui/trails/trail-purple.webp' });
    add('trail', 'galaxy', 'Звёздная пыль', 'Stardust', 'legendary', ads(5), {
        tex: 'spark', img: 'assets/fx/sparkle.webp', c: '#ffffff', blend: 'standard', a: 1, rate: 52, life: [0.7, 1.4], size: [8, 16], speed: [6, 30],
        dir: [[-1, 0.2, -1], [1, 1, 1]], grav: [0, 8, 0], spin: [-3, 3],
        grad: [[0, '#ff7be5'], [0.35, '#b08bff'], [0.7, '#5d86ff'], [1, '#2fd6ff', 0]] });
    add('trail', 'aurora', 'Северное сияние', 'Aurora', 'legendary', ads(5), {
        tex: 'glow', c: '#ffffff', blend: 'standard', a: 0.6, rate: 40, life: [0.9, 1.5], size: [22, 36], speed: [3, 12],
        dir: [[-0.4, 0.3, -0.4], [0.4, 1, 0.4]], grav: [0, 14, 0],
        grad: [[0, '#4dffd2'], [0.4, '#58ff8c'], [0.75, '#8a6bff'], [1, '#ff6bd6', 0]] });

    // ===========================================================================================
    // ПИТОМЦЫ: кубик-компаньон летит рядом (Cosmetics.PETS[k]); c — цвета по порядку, как описано у формы
    // ===========================================================================================
    add('pet', 'slime', 'Слайм', 'Slime Cube', 'common', coins(200), { k: 'slime', c: ['#5ad66f', '#3aa853'] });
    add('pet', 'duck', 'Утёнок', 'Duckling', 'common', coins(300), { k: 'duck', c: ['#ffd93d', '#ff8c1a'] });
    add('pet', 'cat', 'Котёнок', 'Kitten', 'uncommon', coins(420), { k: 'cat', c: ['#ff9f43', '#ffe0b8', '#ff8fb8'] });
    add('pet', 'bunny', 'Зайка', 'Bunny', 'uncommon', coins(600), { k: 'bunny', c: ['#f5f5fa', '#ffb3c6'] });
    add('pet', 'robot', 'Робот-друг', 'Bot Buddy', 'rare', coins(850), { k: 'robot', c: ['#9fb3c8', '#37e2ff', '#5b6b7d'] });
    add('pet', 'drone', 'Дрон', 'Quad Drone', 'rare', coins(1200), { k: 'drone', c: ['#2b3040', '#ff5d73', '#4cc9f0'] });
    add('pet', 'dragon', 'Дракончик', 'Baby Dragon', 'epic', coins(1800), { k: 'dragon', c: ['#3ccf6e', '#ffe08a', '#e63946'] });
    add('pet', 'balloon', 'Шарик', 'Balloon', 'common', ads(1), { k: 'balloon', c: ['#ff4d6d', '#ffffff'] });
    add('pet', 'cloud', 'Облачко', 'Little Cloud', 'common', ads(1), { k: 'cloud', c: ['#ffffff', '#cfe6ff'] });
    add('pet', 'bee', 'Пчёлка', 'Buzzy Bee', 'uncommon', ads(2), { k: 'bee', c: ['#ffd23f', '#1b1b1b', '#bfe9ff'] });
    add('pet', 'penguin', 'Пингвин', 'Penguin', 'uncommon', ads(2), { k: 'penguin', c: ['#2b3040', '#ffffff', '#ff9f1c'] });
    add('pet', 'pumpkin', 'Тыковка', 'Pumpkin', 'uncommon', ads(2), { k: 'pumpkin', c: ['#ff8c1a', '#3f8f3a', '#ffe066'] });
    add('pet', 'ufo', 'НЛО', 'Mini UFO', 'rare', ads(3), { k: 'ufo', c: ['#b9c4d4', '#7be0ff', '#ffe066'] });
    add('pet', 'snowman', 'Снеговик', 'Snowman', 'rare', ads(3), { k: 'snowman', c: ['#ffffff', '#ff7a18', '#d62828'] });
    add('pet', 'cactus', 'Кактус', 'Cactus', 'rare', ads(3), { k: 'cactus', c: ['#4caf50', '#c8693a', '#ff5d8f'] });
    add('pet', 'ghost', 'Привидение', 'Ghost', 'epic', ads(4), { k: 'ghost', c: ['#f2f4ff', '#1b1b2a'] });
    add('pet', 'rocket', 'Ракета', 'Rocket', 'epic', ads(4), { k: 'rocket', c: ['#f2f4fa', '#e63946', '#7be0ff'] });
    add('pet', 'eye', 'Глазик', 'Flying Eye', 'epic', ads(4), { k: 'eye', c: ['#ffffff', '#37c978', '#6a4bb5'] });
    add('pet', 'star', 'Звёздочка', 'Star Buddy', 'legendary', ads(5), { k: 'star', c: ['#ffd23f', '#fff3a8'] });
    add('pet', 'crystal', 'Кристальный дух', 'Crystal Spirit', 'legendary', ads(5), { k: 'crystal', c: ['#5fe0ff', '#c47bff', '#e8fbff'] });

    // ===========================================================================================
    // БРЕЙНРОТ: особые скины только за рекламу (3–7 просмотров), узнаваемые цветами, узорами и деталями на Нубе.
    // Названия — свои, описательные. Слот skin: надевается вместо скина. noWheel: не выпадает на колесе и в подарке дня.
    // ===========================================================================================
    brain('shark', 'Акула в кроссовках', 'Shark Sneaker', 'epic', 3, 'assets/ui/brainrot/brainrot-0.webp', {
        head: { c: '#7fc4e6', hair: '#5aa7d0', hairY: 11 }, chest: '#86c5e6', belt: '#eaf7ff', sleeve: '#86c5e6', arm: '#86c5e6', hand: '#86c5e6',
        thigh: '#86c5e6', shin: '#eaf7ff', foot: '#eaf7ff', decal: Dc('assets/textures/decals/stripe.webp', '#5aa7d0', { s: 26, dy: 8 }),
        acc: [Ac('chest', 'sharkfin', ['#3d7fb0']), Ac('belt', 'sharktail', ['#3d7fb0']), Ac(['footL', 'footR'], 'sneaker', ['#ffffff', '#2f80ed'])] });
    brain('drummer', 'Деревянный барабанщик', 'Wooden Drummer', 'epic', 3, 'assets/ui/brainrot/brainrot-1.webp', {
        head: { c: '#c8955a', hair: '#9b6a3a', hairY: 12 }, chest: P('#b9824b', 'vstripes', '#a2703d', { n: 10 }), belt: '#7a4f2b', sleeve: '#b9824b',
        arm: '#d9aa72', hand: '#d9aa72', thigh: '#c8955a', shin: '#b9824b', foot: '#7a4f2b',
        decal: Dc('assets/textures/decals/circle.webp', '#6e4522', { s: 24, dy: 4, back: true }), acc: [Ac('handR', 'bat', ['#e0b27a', '#7a4f2b'])] });
    brain('croco', 'Крокодил-бомбардировщик', 'Croco Bomber', 'epic', 4, 'assets/ui/brainrot/brainrot-2.webp', {
        head: { c: '#5aa02c', hair: '#3f7a1e', hairY: 12 }, chest: P('#5aa02c', 'scales', '#3f7a1e'), belt: '#e7d9a0', sleeve: '#5aa02c', arm: '#5aa02c', hand: '#e7d9a0',
        thigh: P('#5aa02c', 'scales', '#3f7a1e'), shin: '#5aa02c', foot: '#e7d9a0',
        acc: [Ac('chest', 'planewings', ['#9fb56e', '#d62828']), Ac('belt', 'crocotail', ['#5aa02c', '#d62828']), Ac('head', 'crocoeyes', ['#5aa02c', '#ffe066'])] });
    brain('banana', 'Банановый шимпанзе', 'Banana Chimp', 'epic', 4, 'assets/ui/brainrot/brainrot-7.webp', {
        head: { c: '#a8794a', hair: '#7a5230', hairY: 12 }, chest: P('#ffe14d', 'vstripes', '#f0c419', { n: 6 }), belt: '#6b4a2a', sleeve: '#ffe14d', arm: '#a8794a', hand: '#a8794a',
        thigh: '#8a5a2e', shin: '#8a5a2e', foot: '#6b4a2a', decal: Dc('assets/textures/decals/banana.webp', '#6b4a2a', { s: 30, dy: 2 }),
        acc: [Ac('head', 'monkeyears', ['#a8794a', '#f1c27d']), Ac('head', 'bananapeel', ['#ffe14d', '#6b4a2a'])] });
    brain('cactus', 'Кактус-слон', 'Cactus Elephant', 'legendary', 5, 'assets/ui/brainrot/brainrot-6.webp', {
        head: { c: '#6fbf73', hair: '#58b25f', hairY: 14 }, chest: P('#4caf50', 'vstripes', '#3d9a42', { n: 10 }), belt: '#2e7d32', sleeve: '#4caf50', arm: '#6fbf73', hand: '#6fbf73',
        thigh: '#4caf50', shin: '#6fbf73', foot: '#c8693a', decal: Dc('assets/textures/decals/dots.webp', '#d9f7c4', { s: 40, back: true }),
        acc: [Ac('head', 'elephantears', ['#58b25f', '#ffb3c6']), Ac('head', 'trunk', ['#58b25f']), Ac('head', 'cactusflower', ['#ff5d8f', '#ffd23f'])] });
    brain('tree', 'Дерево-топотун', 'Big-Foot Tree', 'legendary', 5, 'assets/ui/brainrot/brainrot-5.webp', {
        head: { c: '#a8794a', hair: '#3f9f4a', hairY: 3 }, chest: P('#8b5a2b', 'vstripes', '#6e4522', { n: 10 }), belt: '#5b3a1e', sleeve: '#8b5a2b', arm: '#8b5a2b', hand: '#52b45a',
        thigh: '#8b5a2b', shin: '#6e4522', foot: '#5b3a1e', decal: Dc('assets/textures/decals/circle.webp', '#4e3015', { s: 22, dy: 6, back: true }),
        acc: [Ac('head', 'leaves', ['#3f9f4a', '#52b45a']), Ac(['footL', 'footR'], 'bigfoot', ['#6e4522', '#5b3a1e']), Ac(['handL', 'handR'], 'bush', ['#52b45a'])] });
    brain('ballerina', 'Капучино-балерина', 'Cappuccino Ballerina', 'legendary', 6, 'assets/ui/brainrot/brainrot-3.webp', {
        head: { c: '#f3d1b8', hair: '#8a5a3a', hairY: 15 }, chest: '#ff9ec7', belt: '#ff8fc0', sleeve: '#ffe3f0', arm: '#ffe3f0', hand: '#f3d1b8',
        thigh: '#fbe9f3', shin: '#fbe9f3', foot: '#ff8fc0', decal: Dc('assets/textures/decals/heart.webp', '#ff5d99', { s: 20, dy: 4 }),
        acc: [Ac('belt', 'tutu', ['#ff9ec7', '#ffd1e6']), Ac('head', 'cuphat', ['#ffffff', '#7a4a2b', '#f3e3c6'])] });
    brain('coffeeninja', 'Кофейный ниндзя', 'Coffee Ninja', 'legendary', 7, 'assets/ui/brainrot/brainrot-4.webp', {
        head: { c: '#1a1a22', band: [-6, 9, '#f1c27d'] }, chest: '#1a1a24', belt: '#6f4e37', sleeve: '#1a1a24', thigh: '#1a1a24', foot: '#6f4e37',
        acc: [Ac('head', 'cuphat', ['#6f4e37', '#3b2416', '#f3e3c6']), Ac('head', 'ninjaband', ['#d62828']), Ac('chest', 'katana', ['#cfd6e0', '#222222'])] });
    brain('six7', 'Майка 67', 'Jersey 67', 'legendary', 7, null, {
        head: { c: '#f1c27d', hair: '#2b2b2b', hairY: 11 }, chest: '#d62828', belt: '#ffffff', sleeve: '#d62828', arm: '#f1c27d', hand: '#f1c27d',
        thigh: '#ffffff', shin: P('#ffffff', 'stripes', '#d62828', { n: 6 }), foot: '#d62828',
        decal: { text: '67', c: '#ffffff', o: '#1b1b3a', s: 52, dy: 0, back: true } });

    return items;
})();

/**
 * Daily Gift, дни 1–6 (7-й день — эксклюзивный скин из SHOP_ITEMS с exclusive: 'daily', порядок каталога). Монеты нарастают,
 * на днях 4 и 6 добавляется случайный предмет; «x2 за рекламу» удваивает монеты и число предметов.
 * @type {any[]}
 */
const DAILY_REWARDS = [
    { coins: 60 },
    { coins: 90 },
    { coins: 130 },
    { coins: 180, randomItems: 1, maxRarity: 'uncommon' },
    { coins: 250 },
    { coins: 350, randomItems: 1, maxRarity: 'epic' },
];

/**
 * Колесо фортуны: 8 равных секторов (сектор 0 — под стрелкой в покое, дальше по часовой). Монеты — 6 секторов, косметика — 2
 * (случайный предмет на сутки; уже имеющийся Wheel заменяет монетами). weight — вес выпадения; color — цвет сектора в окне.
 * Среднее ≈ 53 монеты за вращение (4 вращения в день: 1 бесплатное + 3 за рекламу). Скины брейнрота на колесе не выпадают.
 * @type {any[]}
 */
const WHEEL_SECTORS = [
    { coins: 20, weight: 22, color: '#FFD23F' },
    { coins: 80, weight: 11, color: '#4CC9F0' },
    { randomItem: true, maxRarity: 'uncommon', weight: 7, color: '#7B61FF' },
    { coins: 40, weight: 20, color: '#FF5D73' },
    { coins: 200, weight: 4, color: '#FFD23F' },
    { coins: 60, weight: 17, color: '#2EC4B6' },
    { randomItem: true, maxRarity: 'epic', weight: 3, color: '#7B61FF' },
    { coins: 400, weight: 1.5, color: '#FF5D73' },
];
