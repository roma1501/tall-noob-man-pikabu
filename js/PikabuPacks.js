// @ts-nocheck
// PikabuPacks.js — наборы за рубли в сборке Пикабу Игр (js/PikabuShop.js). Цены и названия товаров — в Студии
// (каталог CSV: coins_s 19 ₽, coins_m 49 ₽, coins_l 99 ₽, starter 29 ₽, no_ads 59 ₽), здесь — что игрок получает.
// Валюта магазина — монеты (Shop.addCoins), предметы набора — лучшие «за рекламу» из каталога Shop.
PikabuShop.setup({
    colors: ['#ffca28', '#ff7043'],
    ready: () => !!(typeof Shop !== 'undefined' && Shop.state && Shop.items().length),
    visible: () => Game.state === 'menu',
    persist: () => Shop._save('pikabu'),
    button: { corner: 'tr', x: 12, y: 74 },
    packs: [
        { id: 'coins_s', type: 'consumable', icon: '🪙', name: 'Горсть монет', desc: '800 монет на облики, лица и героев', grant: () => Shop.addCoins(800) },
        { id: 'coins_m', type: 'consumable', icon: '💰', name: 'Мешок монет', desc: '2 500 монет', grant: () => Shop.addCoins(2500) },
        { id: 'coins_l', type: 'consumable', icon: '🏆', name: 'Сундук монет', desc: '6 000 монет — хватит на самые дорогие предметы', best: true, grant: () => Shop.addCoins(6000) },
        {
            id: 'starter', type: 'non_consumable', icon: '🥷', name: 'Кофейный ниндзя', best: 'Один раз',
            desc: '1 000 монет, герой «Кофейный ниндзя», радужный облик и лицо «Злодей»',
            grant: () => Shop.addCoins(1000),
            apply: () => PikabuShop.shopGrant(['brainrot_coffeeninja', 'skin_rainbow', 'face_evil']),
        },
        { id: 'no_ads', type: 'non_consumable', icon: '🚫', name: 'Без рекламы', desc: 'Убирает рекламу между забегами навсегда. Награды за рекламу остаются', noAds: true },
    ],
});
