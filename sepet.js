// sepet.js - Gelişmiş Zıt-Anlam ve Renk Filtreli Akıllı Arama Motoru

function norm(t) {
    return String(t || '').toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
        .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
        .replace(/[’‘`´]/g, "'");
}

function fiyatCevir(f) {
    if (typeof f === 'number') return isFinite(f) ? f : 999999;
    let t = String(f || '').replace(/[^0-9,.]/g, '');
    if (!t) return 999999;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const n = parseFloat(t);
    return isNaN(n) ? 999999 : n;
}

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

function topluPaketMi(metin) {
    const t = norm(metin);
    return /\bkoli\b/.test(t) || /\b\d+\s*'?\s*(li|lu)\b/.test(t) || /\b\d+\s*x\s*\d+/.test(t) ||
           /\bx\s*\d+\b/.test(t) || /\b\d+\s*(adet|paket)\b/.test(t);
}

function kelimeler(metin) {
    return norm(metin).replace(BOYUT_RE_G, ' ').replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/).filter((k) => k.length > 0);
}

const YOKSAYILACAK_KELIMELER = new Set(['adet', 'li', 'lu', 'x', 'tane', 'kek', 'bisküvi', 'gram', 'gr', 'boy', 'kuru', 'taze', 'büyük', 'küçük', 'orta']);
function temizKelimeler(metin) {
    return kelimeler(metin).filter(k => !YOKSAYILACAK_KELIMELER.has(k));
}

// 🚀 EN AKILLI FİLTRE: Zıt Anlamlı ve Renk Çakışmalarını Engeller
function ayniUrunMu(arananBaslik, gelenBaslik) {
    const arananLower = norm(arananBaslik);
    const gelenLower = norm(gelenBaslik);

    // 1. RENK VE TÜR ÇAKIŞMA FİLTRESİ (Zıt olanları reddet)
    const zitKelimeler = {
        'toz': ['esmer', 'kup', 'pudra', 'kesme'],
        'esmer': ['toz', 'beyaz'],
        'kirmizi': ['yesil', 'sari', 'siyah'],
        'yesil': ['kirmizi', 'sari', 'siyah'],
        'sari': ['kirmizi', 'yesil', 'siyah'],
        'beyaz': ['esmer', 'siyah'],
        'siyah': ['beyaz', 'kirmizi', 'yesil']
    };

    for (let kelime in zitKelimeler) {
        // Eğer aranan üründe bu kelime varsa (Örn: toz)
        if (arananLower.includes(kelime)) {
            let zitlar = zitKelimeler[kelime];
            for (let i = 0; i < zitlar.length; i++) {
                // Gelen üründe zıttı varsa (Örn: esmer) -> REDDET!
                if (gelenLower.includes(zitlar[i])) return false;
            }
        }
    }

    // 2. GENEL YASAKLI KELİMELER
    const yasakli = ['zeytin', 'salça', 'çikolata', 'krem', 'şampuan', 'çay', 'kahve', 'deterjan', 'bisküvi', 'kraker', 'köfte', 'sucuk', 'turşu', 'turşuluk', 'dondurulmuş'];
    for (let y of yasakli) {
        if (!arananLower.includes(y) && gelenLower.includes(y)) return false;
    }

    // 3. KELİME EŞLEŞMESİ
    const aranan = temizKelimeler(arananBaslik);
    const gelen = temizKelimeler(gelenBaslik);
    if (aranan.length === 0) return false;
    
    const gelenSet = new Set(gelen);
    const kelimeTamam = aranan.every((k) =>
        gelenSet.has(k) || (k.length >= 5 && gelen.some((g) => g.startsWith(k))));
    if (!kelimeTamam) return false;

    // 4. MİKTAR KONTROLÜ (Aranan miktarın %90'ından az olamaz)
    const ab = boyutBul(arananBaslik);
    const gb = boyutBul(gelenBaslik);
    if (ab && gb) {
        if (gb.tur !== ab.tur) return false;
        if (gb.deger < (ab.deger * 0.90) || gb.deger > (ab.deger * 3)) return false;
    } else if (ab && !gb) {
        return false; 
    }

    // 5. TOPLU PAKET KONTROLÜ
    if (topluPaketMi(arananBaslik) !== topluPaketMi(gelenBaslik)) return false;
    
    return true;
}

const MARKET_DESENLERI = [
    ['Migros', /migros/], ['A101', /a101/], ['BİM', /(^|[^a-z0-9])bim([^a-z0-9]|$)/],
    ['Şok', /(^|[^a-z0-9])sok([^a-z0-9]|$)|sokmarket/], ['CarrefourSA', /carrefour/],
    ['Hakmar', /hakmar/], ['Tarım Kredi', /tarim_kredi|tarim kredi/],
    ['Mopaş', /mopas|mopaş/], ['Onur Market', /onur/]
];
const TUM_MARKETLER = ['A101', 'Migros', 'BİM', 'Şok', 'CarrefourSA', 'Hakmar', 'Tarım Kredi', 'Mopaş', 'Onur Market'];

function anaMarka(item) {
    for (const alan of [item.market, item.marketLogo, item.productImage]) {
        const t = norm(alan);
        if (!t) continue;
        for (const [ad, re] of MARKET_DESENLERI) if (re.test(t)) return ad;
    }
    return null;
}

async function havuz(liste, limit, fn) {
    const sonuc = new Array(liste.length);
    let sira = 0;
    await Promise.all(Array.from({ length: Math.min(limit, liste.length) }, async () => {
        while (true) {
            const k = sira++;
            if (k >= liste.length) break;
            sonuc[k] = await fn(liste[k]);
        }
    }));
    return sonuc;
}

async function sepetiOptimizeEt(istenenUrunler, aramaFonksiyonu) {
    const basliklar = istenenUrunler.map((u) => (typeof u === 'string' ? u : (u && u.baslik) || '')).map((s) => String(s).trim()).filter(Boolean);

    const aramaSonuclari = await havuz(basliklar, 3, async (baslik) => {
        let ham = [];
        try { ham = (await aramaFonksiyonu(baslik, 41.0082, 28.9784)) || []; }
        catch (e) { console.error(`❌ Hata (${baslik}):`, e.message); }

        const marketBazli = {};
        for (const item of ham) {
            if (!item || !item.title || item.price === undefined) continue;
            // 🚀 AKILLI FİLTRE BURADA ÇALIŞIYOR
            if (!ayniUrunMu(baslik, item.title)) continue;
            
            const market = anaMarka(item);
            if (!market) continue;
            
            const fiyatSayi = fiyatCevir(item.price);
            if (fiyatSayi >= 999999) continue;
            
            if (!marketBazli[market] || fiyatSayi < marketBazli[market].fiyatSayi) {
                marketBazli[market] = { title: item.title, price: item.price, fiyatSayi };
            }
        }
        return marketBazli;
    });

    const marketVerisi = {};
    TUM_MARKETLER.forEach(m => { marketVerisi[m] = {}; });

    const hibritSepet = [];
    const bulunamayanlar = [];
    let hibritToplam = 0;

    basliklar.forEach((baslik, i) => {
        const marketBazli = aramaSonuclari[i];
        let enUcuz = null;
        
        for (const [market, kayit] of Object.entries(marketBazli)) {
            if (!marketVerisi[market]) marketVerisi[market] = {}; 
            marketVerisi[market][baslik] = kayit;
            
            if (!enUcuz || kayit.fiyatSayi < enUcuz.fiyatSayi) {
                enUcuz = { ...kayit, market, urunAdi: baslik };
            }
        }
        
        if (enUcuz) {
            hibritSepet.push({ urunAdi: baslik, market: enUcuz.market, title: enUcuz.title, price: enUcuz.price });
            hibritToplam += enUcuz.fiyatSayi;
        } else {
            bulunamayanlar.push(baslik); 
        }
    });

    const liste = [];
    for (const market of TUM_MARKETLER) {
        let toplam = 0; const bulunan = []; const eksik = [];
        for (const baslik of basliklar) {
            const kayit = marketVerisi[market][baslik];
            if (kayit) { toplam += kayit.fiyatSayi; bulunan.push(kayit); } 
            else { eksik.push(baslik); }
        }
        if (bulunan.length > 0) {
            liste.push({ market, toplam: toplam.toFixed(2) + ' TL', toplamSayi: toplam, bulunanUrunler: bulunan, eksikUrunler: eksik, tamSepet: eksik.length === 0 });
        }
    }
    liste.sort((a, b) => a.eksikUrunler.length - b.eksikUrunler.length || a.toplamSayi - b.toplamSayi);

    return {
        success: true,
        hibrit: { sepet: hibritSepet, toplam: hibritToplam.toFixed(2) + ' TL', bulunamayanlar },
        tekMarketler: liste
    };
}

module.exports = { sepetiOptimizeEt, fiyatCevir, ayniUrunMu };
