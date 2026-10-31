// tarif_sepeti.js - Tarif malzemelerini BİRLEŞTİRİR (aynı malzemeyi toplar) ve gereken kadar ürün hesaplar.
// Örn: "1 çay bardağı + 2 su bardağı + 3 yemek kaşığı zeytinyağı" = 545 ml -> 1 adet 1 Lt şişe (3 şişe değil)
const { enUygunUrunBul, norm } = require('./malzeme');

// Ölçü birimleri (Türk mutfağı ölçüleri; yaklaşık değerlerdir)
const BIRIMLER = [
    ['su bardagi', 200, 'hacim'], ['cay bardagi', 100, 'hacim'], ['kahve fincani', 60, 'hacim'],
    ['yemek kasigi', 15, 'hacim'], ['tatli kasigi', 10, 'hacim'], ['cay kasigi', 5, 'hacim'],
    ['tutam', 0.5, 'hacim'], ['bardak', 200, 'hacim'],
    ['litre', 1000, 'hacim'], ['lt', 1000, 'hacim'], ['ml', 1, 'hacim'], ['l', 1000, 'hacim'],
    ['kg', 1000, 'agirlik'], ['gram', 1, 'agirlik'], ['gr', 1, 'agirlik'], ['g', 1, 'agirlik'],
    ['adet', 1, 'adet'], ['dis', 1, 'dis'], ['bas', 1, 'bas']
];

// Özkütle (g/ml) ve tercih edilen ölçü türü. Uygulamadaki Dönüştürücü kataloğuyla aynı değerler.
const YOGUNLUK = {
    'zeytinyagi': [0.92, 'hacim'], 'sivi yag': [0.92, 'hacim'], 'aycicek yagi': [0.92, 'hacim'],
    'sut': [1.03, 'hacim'], 'sirke': [1.01, 'hacim'], 'bal': [1.42, 'agirlik'],
    'tuz': [1.2, 'agirlik'], 'seker': [0.85, 'agirlik'], 'un': [0.59, 'agirlik'], 'pirinc': [0.85, 'agirlik'],
    'bulgur': [0.8, 'agirlik'], 'mercimek': [0.8, 'agirlik'], 'karabiber': [0.45, 'agirlik'],
    'domates salcasi': [1.15, 'agirlik'], 'biber salcasi': [1.15, 'agirlik']
};

// Tane başına ortalama ağırlık (gram) - TAHMİNİ değerler
const ADET_GRAM = [['kemer patlican', 130], ['patlican', 200], ['sivri biber', 30], ['dolmalik biber', 100],
    ['biber', 35], ['domates', 150], ['sogan', 150], ['patates', 150], ['havuc', 100], ['kabak', 200],
    ['limon', 100], ['salatalik', 120], ['elma', 180], ['sarimsak', 40]];   // sarımsak: 1 baş
const DIS_GRAM = { sarimsak: 4 };                                          // sarımsak: 1 diş

const SIFAT = new Set(['dogranmis', 'rendelenmis', 'ince', 'kalin', 'kucuk', 'orta', 'buyuk', 'boy', 'taze',
    'yarim', 'ezilmis', 'haslanmis', 'kiyilmis', 'dilimlenmis', 'isteye', 'bagli', 'yaklasik']);
const SENONIM = { 'toz seker': 'seker', 'sofra tuzu': 'tuz', 'siyah biber': 'karabiber', 'ayciceği yagi': 'aycicek yagi' };
const UCRETSIZ = new Set(['su', 'sicak su', 'kaynar su', 'ilik su', 'soguk su', 'buz']);

// "2 su bardağı zeytinyağı" -> { miktar: 2, birim: 'su bardagi', ad: 'zeytinyagi' }
function malzemeSatiriCoz(satir) {
    let s = norm(satir).replace(/\(.*?\)/g, ' ').replace(/(\d)([a-z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
    let miktar = null;
    const m = s.match(/^(yarim|bir|\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?)\s+(.*)$/);
    let kalan = s;
    if (m) {
        const q = m[1].replace(/\s+/g, '');
        if (q === 'yarim') miktar = 0.5;
        else if (q === 'bir') miktar = 1;
        else if (q.includes('/')) { const [a, b] = q.split('/'); miktar = parseFloat(a) / parseFloat(b); }
        else if (q.includes('-')) miktar = parseFloat(q.split('-')[1].replace(',', '.'));  // aralıkta üst değer
        else miktar = parseFloat(q.replace(',', '.'));
        kalan = m[2];
    }
    let birim = null;
    for (const [ad, , tur] of BIRIMLER) {
        if (kalan === ad || kalan.startsWith(ad + ' ')) { birim = ad; kalan = kalan.slice(ad.length).trim(); break; }
    }
    const adKelimeleri = kalan.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((k) => k && !SIFAT.has(k));
    let ad = adKelimeleri.join(' ');
    ad = SENONIM[ad] || ad;
    return { satir, miktar, birim, ad };
}

function yogunlukBul(ad) { return YOGUNLUK[ad] || null; }

function adetGram(ad, birim) {
    if (birim === 'dis') return DIS_GRAM[Object.keys(DIS_GRAM).find((k) => ad.includes(k))] || null;
    const k = ADET_GRAM.find(([anahtar]) => ad.includes(anahtar));
    return k ? k[1] : null;
}

function yaz(tur, deger) {
    const r = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
    if (tur === 'hacim') return deger >= 1000 ? `${r(deger / 1000)} lt` : `${r(deger)} ml`;
    if (tur === 'agirlik') return deger >= 1000 ? `${r(deger / 1000)} kg` : `${r(deger)} gr`;
    return `${r(deger)} adet`;
}

// Aynı malzemeyi toplar
function malzemeleriBirlestir(satirlar) {
    const grup = new Map();
    for (const satir of satirlar) {
        const c = malzemeSatiriCoz(String(satir || ''));
        if (!c.ad) continue;
        const g = grup.get(c.ad) || { ad: c.ad, satirlar: [], ml: 0, gram: 0, adet: 0, belirsiz: false };
        g.satirlar.push(c.satir);
        const b = BIRIMLER.find(([ad]) => ad === c.birim);
        const q = c.miktar === null ? null : c.miktar;
        if (q === null || !b) {
            if (q === null || c.birim === null) g.belirsiz = true;       // "tuz" gibi miktarsız satır
            if (q !== null && !b) g.adet += q;                          // "3 tane domates" gibi
        } else if (b[2] === 'hacim') g.ml += q * b[1];
        else if (b[2] === 'agirlik') g.gram += q * b[1];
        else {                                                         // adet / diş / baş
            const gr = adetGram(c.ad, b[2] === 'adet' ? 'adet' : b[2]);
            if (gr) g.gram += q * gr; else g.adet += q;
        }
        grup.set(c.ad, g);
    }

    return [...grup.values()].map((g) => {
        const y = yogunlukBul(g.ad);
        const yog = y ? y[0] : null;
        let tur = null, deger = 0;
        if (g.ml > 0 || g.gram > 0) {
            const tercih = y ? y[1] : (g.gram > 0 && g.ml === 0 ? 'agirlik' : (g.ml > 0 && g.gram === 0 ? 'hacim' : 'agirlik'));
            if (tercih === 'hacim') { tur = 'hacim'; deger = g.ml + (g.gram / (yog || 1)); }
            else { tur = 'agirlik'; deger = g.gram + g.ml * (yog || 1); }
        } else if (g.adet > 0) { tur = 'adet'; deger = g.adet; }
        return {
            ad: g.ad, satirlar: g.satirlar, tekrar: g.satirlar.length, ucretsiz: UCRETSIZ.has(g.ad),
            belirsiz: g.belirsiz && deger === 0, yogunluk: yog,
            gerekli: tur ? { tur, deger: Math.round(deger * 100) / 100 } : null,
            toplamYazi: tur ? yaz(tur, deger) : null
        };
    });
}

async function havuz(liste, limit, fn) {
    const sonuc = new Array(liste.length);
    let sira = 0;
    await Promise.all(Array.from({ length: Math.min(limit, liste.length) }, async () => {
        while (true) { const k = sira++; if (k >= liste.length) break; sonuc[k] = await fn(liste[k]); }
    }));
    return sonuc;
}

// Birleştirilmiş malzemeler için ürün bulur; ödenecek tutarı ve tarifteki payın maliyetini hesaplar
async function tarifSepetiHazirla(satirlar, aramaFonksiyonu) {
    const malzemeler = malzemeleriBirlestir(satirlar);
    const sonuclar = await havuz(malzemeler, 2, async (m) => {
        if (m.ucretsiz) return { ...m, bulundu: false, neden: 'Ücretsiz (su)' };
        let ham = [];
        try { ham = (await aramaFonksiyonu(m.ad, 41.0082, 28.9784)) || []; }
        catch (e) { console.error(`❌ Tarif malzemesi araması hatası (${m.ad}):`, e.message); }
        const secenek = m.gerekli ? { gerekli: m.gerekli, yogunluk: m.yogunluk } : {};
        const r = enUygunUrunBul(m.ad, ham, secenek);
        console.log(`🧾 ${m.ad}: ${m.tekrar} satır -> ${m.toplamYazi || 'miktar belirsiz'} | ${r.urun ? r.urun.title : 'BULUNAMADI'}`);
        return { ...m, bulundu: !!r.urun, ...r };
    });

    let alisveris = 0, tarifMaliyeti = 0;
    const bulunamayan = [];
    for (const s of sonuclar) {
        if (s.ucretsiz) continue;
        if (!s.bulundu) { bulunamayan.push(s.ad); continue; }
        const fiyat = s.urun.paket ? s.urun.paket.odenecek : null;
        if (fiyat !== null && fiyat !== undefined) alisveris += fiyat;
        if (s.urun.paket && s.urun.paket.tarifMaliyeti) tarifMaliyeti += s.urun.paket.tarifMaliyeti;
    }
    return {
        malzemeler: sonuclar,
        toplamlar: {
            alisveris: Math.round(alisveris * 100) / 100,          // markete gidince ödenecek (paket sayısı x fiyat)
            tarifMaliyeti: Math.round(tarifMaliyeti * 100) / 100,   // sadece tarifte kullanılan miktarın maliyeti
            bulunamayan
        }
    };
}

module.exports = { malzemeSatiriCoz, malzemeleriBirlestir, tarifSepetiHazirla };
