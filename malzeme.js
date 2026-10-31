// malzeme.js - Tarif malzemesi -> doğru market ürünü eşleştirme
const { fiyatCevir } = require('./sepet');

// SADECE BİLDİĞİMİZ ZİNCİR MARKETLER (Abiler)
const IZIN_VERILEN_MARKETLER = ['a101', 'bim', 'migros', 'sok', 'carrefour', 'hakmar', 'tarim kredi', 'mopas'];

function norm(t) {
    return String(t || '').toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
        .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
        .replace(/[’‘`´]/g, "'");
}

const yuvarla = (x) => Math.round(x * 100) / 100;
const BOYUT_RE = /(\d+(?:[.,]\d+)?)\s*(kg|gr|g|litre|lt|l|ml|cl)\b/;
const BOYUT_RE_G = new RegExp(BOYUT_RE.source, 'g');

function boyutBul(metin) {
    const m = norm(metin).match(BOYUT_RE);
    if (!m) return null;
    const d = parseFloat(m[1].replace(',', '.'));
    switch (m[2]) {
        case 'kg': return { tur: 'agirlik', deger: d * 1000 };
        case 'g': case 'gr': return { tur: 'agirlik', deger: d };
        case 'l': case 'lt': case 'litre': return { tur: 'hacim', deger: d * 1000 };
        case 'cl': return { tur: 'hacim', deger: d * 10 };
        case 'ml': return { tur: 'hacim', deger: d };
        default: return null;
    }
}

function boyutYaz(b) {
    if (b.tur === 'agirlik') return b.deger >= 1000 ? `${b.deger / 1000} kg` : `${b.deger} gr`;
    return b.deger >= 1000 ? `${b.deger / 1000} lt` : `${b.deger} ml`;
}

function kelimeler(metin) {
    return norm(metin).replace(BOYUT_RE_G, ' ').replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/).filter(Boolean);
}

function topluPaketMi(metin) {
    const t = norm(metin);
    return /\bkoli\b/.test(t) || /\b\d+\s*'?\s*(li|lu)\b/.test(t) || /\b\d+\s*x\s*\d/.test(t) ||
           /\bx\s*\d+\b/.test(t) || /\b\d+\s*(adet|paket)\b/.test(t);
}

const ISLENMIS = new Set(['ketcap', 'sos', 'sosu', 'corba', 'konserve', 'konservesi', 'tursu', 'tursuluk',
    'kurutulmus', 'cips', 'aroma', 'mayonez', 'hardal', 'pure', 'makarna', 'ezme', 'jole', 'dondurma',
    'cikolata', 'biskuvi', 'gofret', 'icecek', 'nektar', 'suyu', 'kremasi', 'tohumu']);
const CESIT = new Set(['mor', 'kirmizi', 'yesil', 'sivri', 'dolmalik', 'cherry', 'cheri', 'ceri', 'kapya', 'arpacik']);

function enUygunUrunBul(arananMetin, sonuclar, secenek = {}) {
    const sorgu = kelimeler(arananMetin);
    if (sorgu.length === 0) return { urun: null, neden: 'Boş arama' };
    const sorguSet = new Set(sorgu);
    const arananBoyut = boyutBul(arananMetin);
    const sorguToplu = topluPaketMi(arananMetin);

    const adaylar = [];
    const elenenler = [];
    
    for (const item of sonuclar || []) {
        if (!item || !item.title) continue;
        const fiyat = fiyatCevir(item.price);
        if (fiyat >= 999999) continue;

        // 🚀 YEREL ESNAF FİLTRESİ: Sadece bildiğimiz zincir marketler
        const urunMarket = norm(item.market || '');
        if (!IZIN_VERILEN_MARKETLER.some(m => urunMarket.includes(m))) {
            ret('zincir market değil'); 
            continue; 
        }

        const gelen = kelimeler(item.title);
        const gelenSet = new Set(gelen);
        const ret = (neden) => elenenler.push(`${item.title} (${neden})`);

        if (!sorgu.every((k) => gelenSet.has(k))) { ret('kelime tutmuyor'); continue; }
        const islenmis = gelen.find((k) => ISLENMIS.has(k) && !sorguSet.has(k));
        if (islenmis) { ret(`işlenmiş ürün: ${islenmis}`); continue; }
        const adetModu = !!(secenek.gerekli && secenek.gerekli.tur === 'adet');
        if (topluPaketMi(item.title) && !sorguToplu && !adetModu) { ret('çoklu paket'); continue; }

        const gb = boyutBul(item.title);
        let tier = 0;
        let uyari = null;
        let paket = null;
        if (secenek.gerekli) {
            const g = secenek.gerekli;
            if (adetModu) {
                const eslesme = norm(item.title).match(/(\d+)\s*(?:'?\s*(?:li|lu)\b|adet)/);
                const kac = eslesme ? parseInt(eslesme[1], 10) : 1;
                const n = Math.max(1, Math.ceil(g.deger / kac - 1e-9));
                paket = { adet: n, boyut: `${kac} adet`, odenecek: yuvarla(n * fiyat), tarifMaliyeti: yuvarla((g.deger / kac) * fiyat) };
            } else if (gb) {
                let ihtiyac = g.deger;
                if (gb.tur !== g.tur) {
                    if (!secenek.yogunluk) { ret('birim türü uyumsuz'); continue; }
                    ihtiyac = g.tur === 'hacim' ? g.deger * secenek.yogunluk : g.deger / secenek.yogunluk;
                }
                const n = Math.max(1, Math.ceil(ihtiyac / gb.deger - 1e-9));
                paket = { adet: n, boyut: boyutYaz(gb), odenecek: yuvarla(n * fiyat), tarifMaliyeti: yuvarla((ihtiyac / gb.deger) * fiyat) };
            } else {
                tier = 2; uyari = 'Başlıkta miktar yok';
                paket = { adet: 1, boyut: null, odenecek: fiyat, tarifMaliyeti: null };
            }
        } else if (arananBoyut) {
            if (!gb || gb.tur !== arananBoyut.tur) { tier = 2; uyari = 'Başlıkta miktar yok'; }
            else {
                const oran = gb.deger / arananBoyut.deger;
                if (Math.abs(oran - 1) <= 0.005) tier = 0;
                else if (oran >= 0.5 && oran <= 2) { tier = 1; uyari = `Boyut farklı: ${boyutYaz(gb)} (aranan ${boyutYaz(arananBoyut)})`; }
                else { ret('boyut çok farklı'); continue; }
            }
        }

        const cesit = gelen.filter((k) => CESIT.has(k) && !sorguSet.has(k));
        const cesitUyari = cesit.length > 0 ? `Çeşit farkı: ${cesit.join(' ')}` : null;
        const ekstra = gelen.filter((k) => !sorguSet.has(k) && !/^\d+$/.test(k)).length;
        const birimFiyat = gb ? fiyat / (gb.deger / 1000) : null;

        adaylar.push({
            item, tier, ekstra, fiyat, birimFiyat,
            cesit: cesit.length > 0,
            uyarilar: [uyari, cesitUyari].filter(Boolean),
            paket,
            anahtar: paket ? paket.odenecek : (birimFiyat !== null ? birimFiyat : fiyat)
        });
    }

    adaylar.sort((a, b) => a.tier - b.tier || Number(a.cesit) - Number(b.cesit) ||
                           a.anahtar - b.anahtar || a.ekstra - b.ekstra);

    if (adaylar.length === 0) {
        return { urun: null, neden: 'Uygun ürün bulunamadı', elenenler: elenenler.slice(0, 6) };
    }
    const sec = (a) => ({
        title: a.item.title, price: a.item.price, market: a.item.market, link: a.item.link,
        productImage: a.item.productImage, paket: a.paket || undefined, birimFiyat: a.birimFiyat !== null ? Number(a.birimFiyat.toFixed(2)) : null
    });
    const en = adaylar[0];
    return {
        urun: sec(en),
        guven: en.tier === 0 && !en.cesit && en.ekstra <= 2 ? 'yuksek' : 'orta',
        uyari: en.uyarilar.length ? en.uyarilar.join(' | ') : null,
        alternatifler: adaylar.slice(1, 3).map(sec),
        elenenler: elenenler.slice(0, 6)
    };
}

function sorguVaryantlari(metin) {
    const bosluk = (s) => s.replace(/\s+/g, ' ').trim();
    const boyutsuz = bosluk(String(metin).replace(/\d+(?:[.,]\d+)?\s*(?:kg|gr|g|litre|lt|l|ml|cl)\b/gi, ''));
    return [...new Set([bosluk(String(metin)), boyutsuz].filter((s) => s.length >= 2))];
}

async function havuz(liste, limit, fn) {
    const sonuc = new Array(liste.length);
    let sira = 0;
    await Promise.all(Array.from({ length: Math.min(limit, liste.length) }, async () => {
        while (true) { const k = sira++; if (k >= liste.length) break; sonuc[k] = await fn(liste[k]); }
    }));
    return sonuc;
}

async function malzemeleriEslestir(malzemeler, aramaFonksiyonu) {
    const tekil = new Map();
    for (const m of malzemeler) {
        const ad = String(typeof m === 'string' ? m : (m && m.baslik) || '').trim();
        if (!ad) continue;
        const k = norm(ad).replace(/\s+/g, ' ');
        const kayit = tekil.get(k) || { ad, tekrar: 0 };
        kayit.tekrar++;
        tekil.set(k, kayit);
    }
    return havuz([...tekil.values()], 2, async ({ ad, tekrar }) => {
        const toplam = [];
        const goruldu = new Set();
        for (const sorgu of sorguVaryantlari(ad)) {
            let ham = [];
            try { ham = (await aramaFonksiyonu(sorgu, 41.0082, 28.9784)) || []; }
            catch (e) { console.error(`❌ Malzeme araması hatası (${sorgu}):`, e.message); }
            for (const x of ham) {
                const kilit = `${x.market}|${x.title}|${x.price}`;
                if (!goruldu.has(kilit)) { goruldu.add(kilit); toplam.push(x); }
            }
        }
        const sonuc = enUygunUrunBul(ad, toplam);
        console.log(`🥕 Malzeme "${ad}": ham=${toplam.length}, ${sonuc.urun ? 'bulundu: ' + sonuc.urun.title : 'BULUNAMADI'}`);
        return { aranan: ad, tekrar, bulundu: !!sonuc.urun, ...sonuc };
    });
}

module.exports = { malzemeleriEslestir, enUygunUrunBul, sorguVaryantlari, norm, boyutBul, boyutYaz };
