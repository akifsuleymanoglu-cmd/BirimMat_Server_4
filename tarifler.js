// tarifler.js - Sadece Yemek.com üzerinden çalışan hızlı tarif bulucu
const axios = require('axios');
const cheerio = require('cheerio');
const { normalize } = require('./yardimcilar');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const YASAK_YOLLAR = [
    '/ara/', '/arama', '/kategori/', '/yazar/', '/yazarlar/', '/uye/', '/video/',
    '/page/', '/sayfa/', '/etiket/', '/profil/', '/sozluk/'
];

const slugla = (s) => normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const KAYNAKLAR = [
    {
        ad: 'Yemek.com',
        alan: 'yemek.com',
        dogrudan: (q) => {
            const s = slugla(q);
            return s ? [`https://yemek.com/tarif/${s}/`] : [];
        },
        aramaUrl: (q) => `https://yemek.com/arama/?q=${encodeURIComponent(q)}`,
        tarifMi: (u) => /^\/tarif\/[^/]+\/?$/.test(u.pathname)
    }
];

async function htmlAl(url) {
    try {
        const r = await axios.get(url, {
            headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'tr-TR,tr;q=0.9' },
            timeout: 8000,
            responseType: 'text'
        });
        return typeof r.data === 'string' ? r.data : '';
    } catch (e) { return null; }
}

function tarifLinkiBul(html, kaynak, tabanUrl, sorgu) {
    const $ = cheerio.load(html);
    const kelimeler = normalize(sorgu).split(/\s+/).filter((k) => k.length >= 3);
    const goruldu = new Set();
    const adaylar = [];

    $('a[href]').each((i, a) => {
        let u;
        try { u = new URL($(a).attr('href'), tabanUrl); } catch (e) { return; }
        const host = u.hostname.replace(/^www\./, '');
        if (!(host === kaynak.alan || host.endsWith('.' + kaynak.alan))) return;
        if (u.pathname.length < 5 || YASAK_YOLLAR.some((y) => u.pathname.includes(y)) || !kaynak.tarifMi(u)) return;

        u.hash = '';
        const link = u.href;
        if (goruldu.has(link)) return;
        goruldu.add(link);

        const hedef = normalize(u.pathname + ' ' + $(a).text());
        const puan = kelimeler.length ? kelimeler.filter((k) => hedef.includes(k)).length : 1;
        adaylar.push({ link, puan, sira: adaylar.length });
    });

    adaylar.sort((a, b) => b.puan - a.puan || a.sira - b.sira);
    return adaylar.length && adaylar[0].puan > 0 ? adaylar[0].link : null;
}

const metinTemizle = (s) => cheerio.load(String(s || ''), null, false).text().replace(/\s+/g, ' ').trim();
const tekil = (liste) => [...new Set(liste.map(metinTemizle).filter(Boolean))];

function adimCoz(x) {
    if (!x) return [];
    if (typeof x === 'string') return [x];
    if (Array.isArray(x)) return x.flatMap(adimCoz);
    if (x.itemListElement) return adimCoz(x.itemListElement);
    return x.text ? [x.text] : x.name ? [x.name] : [];
}

function receteCoz(html) {
    const $ = cheerio.load(html);
    const dugumler = [];
    const gez = (n) => {
        if (!n) return;
        if (Array.isArray(n)) return n.forEach(gez);
        if (typeof n === 'object') { dugumler.push(n); if (n['@graph']) gez(n['@graph']); }
    };
    $('script[type="application/ld+json"]').each((i, el) => { try { gez(JSON.parse($(el).contents().text())); } catch (e) { } });
    
    const recete = dugumler.find((n) => Array.isArray(n['@type']) ? n['@type'].includes('Recipe') : n['@type'] === 'Recipe');

    let baslik = '', malzemeler = [], adimlar = [];
    if (recete) {
        baslik = metinTemizle(recete.name);
        malzemeler = tekil([].concat(recete.recipeIngredient || []));
        adimlar = tekil(adimCoz(recete.recipeInstructions));
    }
    if (!baslik) baslik = metinTemizle($('h1').first().text()) || 'İsimsiz Tarif';

    return { baslik, malzemeler: malzemeler.slice(0, 30), adimlar: adimlar.slice(0, 20) };
}

const detayGecerliMi = (d) => d && (d.malzemeler.length > 0 || d.adimlar.length > 0);

async function kaynaktanAl(kaynak, sorgu) {
    for (const adres of kaynak.dogrudan ? kaynak.dogrudan(sorgu) : []) {
        const html = await htmlAl(adres);
        if (html) { const d = receteCoz(html); if (detayGecerliMi(d)) return { tarifAdi: d.baslik, malzemeler: d.malzemeler, adimlar: d.adimlar, link: adres }; }
    }

    const aramaUrl = kaynak.aramaUrl(sorgu);
    const aramaHtml = await htmlAl(aramaUrl);
    if (!aramaHtml) return null;

    const tarifLinki = tarifLinkiBul(aramaHtml, kaynak, aramaUrl, sorgu);
    if (!tarifLinki) return null;

    const tarifHtml = await htmlAl(tarifLinki);
    if (!tarifHtml) return null;
    const d = receteCoz(tarifHtml);
    if (!detayGecerliMi(d)) return null;

    return { tarifAdi: d.baslik, malzemeler: d.malzemeler, adimlar: d.adimlar, link: tarifLinki };
}

async function tarifBul(sorgu) {
    for (const kaynak of KAYNAKLAR) {
        try {
            const sonuc = await kaynaktanAl(kaynak, sorgu);
            if (sonuc) return { ...sonuc, kaynak: kaynak.ad };
        } catch (e) { }
    }
    return null;
}

const durumRapor = () => KAYNAKLAR.map((k) => ({ kaynak: k.ad, atlaniyor: false, tekrarDenemeSn: 0 }));
module.exports = { tarifBul, durumRapor };
