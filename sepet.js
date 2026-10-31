// sepet.js - Akıllı Sepet, Doğru Fiyat Okuma ve Kusursuz Ürün Eşleştirme Motoru

// Türkçe karakterleri sadeleştirip küçük harfe çevirir
function norm(t) {
    return String(t || '').toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
        .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
        .replace(/[’‘`´]/g, "'");
}

// "57.5 TL" -> 57.5 | "57,50 TL" -> 57.5 | "1.234,50 TL" -> 1234.5 | 24.5 -> 24.5
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

// Başlıktaki miktarı ortak birime çevirir: hacim -> ml, ağırlık -> g
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

// "adet", "boy", "kuru" gibi eşleşmeyi bozan ama ürünün aslı olmayan kelimeler
const YOKSAYILACAK_KELIMELER = new Set(['adet', 'li', 'lu', 'x', 'tane', 'kek', 'bisküvi', 'gram', 'gr', 'boy', 'kuru', 'taze', 'büyük', 'küçük', 'orta']);
function temizKelimeler(metin) {
    return kelimeler(metin).filter(k => !YOKSAYILACAK_KELIMELER.has(k));
}

// Kusursuz Ürün Eşleştirme (Yasaklı Kelimeler ve Sıkı Gramaj Kontrolü ile)
function ayniUrunMu(arananBaslik, gelenBaslik) {
    const arananLower = norm(arananBaslik);
    const gelenLower = norm(gelenBaslik);
    
    // 🚀 YASAKLI KELİMELER (Aranan üründe yoksa, gelen üründe varsa reddet!)
    const yasakliKelimeler = [
        'zeytin', 'salça', 'çikolata', 'krem', 'şampuan', 'çay', 'kahve', 'deterjan', 
        'bisküvi', 'kraker', 'köfte', 'sucuk', 'turşu', 'turşuluk', 'dondurulmuş', 
        'şişe', 'bidon', 'oyuncak', 'kıyafet'
    ];
    
    for (let kelime of yasakliKelimeler) {
        if (!arananLower.includes(kelime) && gelenLower.includes(kelime)) {
            return false; // Aranan üründe yok ama markettekinde varsa reddet!
        }
    }

    const aranan = temizKelimeler(arananBaslik);
    const gelen = temizKelimeler(gelenBaslik);
    
    if (aranan.length === 0) return false;
    const gelenSet = new Set(gelen);
    
    // 1. Kelime Eşleşmesi (Tüm kelimeler bulunmalı)
    const kelimeTamam = aranan.every((k) =>
        gelenSet.has(k) || (k.length >= 5 && gelen.some((g) => g.startsWith(k))));
    if (!kelimeTamam) return false;

    // 2. SIKI MİKTAR (Hacim/Ağırlık) KONTROLÜ
    const ab = boyutBul(arananBaslik);
    const gb = boyutBul(gelenBaslik);

    if (ab && gb) {
        if (gb.tur !== ab.tur) return false; // Biri ağırlık biri hacimse reddet
        
        // 🚀 YENİ KURAL: Gelen ürün, aranan miktarın %90'ından daha az olamaz!
        // Örn: 700 Gr aranıyorsa, 600 Gr (%85) reddedilir. 650 Gr kabul edilir.
        // Ayrıca 3 katından fazla devasa ürünler de reddedilir.
        if (gb.deger < (ab.deger * 0.90) || gb.deger > (ab.deger * 3)) {
            return false;
        }
    } else if (ab && !gb) {
        return false; // Aranan üründe miktar var ama gelen üründe yoksa reddet
    }

    // 3. Toplu Paket Kontrolü
    if (topluPaketMi(arananBaslik) !== topluPaketMi(gelenBaslik)) return false;
    
    return true;
}

// Tüm Marketler ve Algılama Kuralları
const MARKET_DESENLERI = [
    ['Migros', /migros/],
    ['A101', /a101/],
    ['BİM', /(^|[^a-z0-9])bim([^a-z0-9]|$)/],
    ['Şok', /(^|[^a-z0-9])sok([^a-z0-9]|$)|sokmarket/],
    ['CarrefourSA', /carrefour/],
    ['Hakmar', /hakmar/],
    ['Tarım Kredi', /tarim_kredi|tarim kredi/],
    ['Mopaş', /mopas|mopaş/],
    ['Onur Market', /onur/]
];

const TUM_MARKETLER = ['A101', 'Migros', 'BİM', 'Şok', 'CarrefourSA', 'Hakmar', 'Tarım Kredi', 'Mopaş', 'Onur Market'];

// Önce market adına, bulunamazsa görsel adresine bakar
function anaMarka(item) {
    for (const alan of [item.market, item.marketLogo, item.productImage]) {
        const t = norm(alan);
        if (!t) continue;
        for (const [ad, re] of MARKET_DESENLERI) if (re.test(t)) return ad;
    }
    return null;
}

// Eşzamanlı Arama Havuzu (Sunucuyu yormadan hızlı arama yapar)
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

// ANA FONKSİYON: Sepeti Optimize Eder
async function sepetiOptimizeEt(istenenUrunler, aramaFonksiyonu) {
    // Gelen ürünleri başlık formatına çevir
    const basliklar = istenenUrunler
        .map((u) => (typeof u === 'string' ? u : (u && u.baslik) || ''))
        .map((s) => String(s).trim())
        .filter(Boolean);

    // Her ürün için, her marketteki en ucuz AYNI ürünü bul (Limit: 3 - Hız ve stabilite dengesi)
    const aramaSonuclari = await havuz(basliklar, 3, async (baslik) => {
        let ham = [];
        try { ham = (await aramaFonksiyonu(baslik, 41.0082, 28.9784)) || []; }
        catch (e) { console.error(`❌ Sepet araması hatası (${baslik}):`, e.message); }

        const marketBazli = {};
        for (const item of ham) {
            if (!item || !item.title || item.price === undefined || item.price === null) continue;
            if (!ayniUrunMu(baslik, item.title)) continue;
            
            const market = anaMarka(item);
            if (!market) continue;
            
            const fiyatSayi = fiyatCevir(item.price);
            if (fiyatSayi >= 999999) continue;
            
            // Eğer bu markette bu ürünün daha ucuzu yoksa kaydet
            if (!marketBazli[market] || fiyatSayi < marketBazli[market].fiyatSayi) {
                marketBazli[market] = { title: item.title, price: item.price, fiyatSayi };
            }
        }
        return marketBazli;
    });

    const marketVerisi = {};
    // Tüm marketleri en baştan başlatıyoruz
    TUM_MARKETLER.forEach(m => { marketVerisi[m] = {}; });

    const hibritSepet = [];
    const bulunamayanlar = [];
    let hibritToplam = 0;

    // HİBRİT SEPET HESABI (Her ürünü en ucuz olduğu marketten al)
    basliklar.forEach((baslik, i) => {
        const marketBazli = aramaSonuclari[i];
        let enUcuz = null;
        
        for (const [market, kayit] of Object.entries(marketBazli)) {
            if (!marketVerisi[market]) marketVerisi[market] = {}; 
            marketVerisi[market][baslik] = kayit; // Tek market listeleri için kaydet
            
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

    // TEK MARKET LİSTELERİ HESABI
    const liste = [];
    for (const market of TUM_MARKETLER) {
        let toplam = 0;
        const bulunan = [];
        const eksik = [];
        
        for (const baslik of basliklar) {
            const kayit = marketVerisi[market][baslik];
            if (kayit) { 
                toplam += kayit.fiyatSayi; 
                bulunan.push(kayit); 
            } else { 
                eksik.push(baslik); 
            }
        }
        
        // Sadece en az 1 ürün bulunan marketleri listeye ekle
        if (bulunan.length > 0) {
            liste.push({
                market, 
                toplam: toplam.toFixed(2) + ' TL', 
                toplamSayi: toplam,
                bulunanUrunler: bulunan, 
                eksikUrunler: eksik, 
                tamSepet: eksik.length === 0
            });
        }
    }
    
    // Sıralama: En az eksiği olanlar önce, sonra en ucuz olanlar
    liste.sort((a, b) =>
        a.eksikUrunler.length - b.eksikUrunler.length || a.toplamSayi - b.toplamSayi);

    return {
        success: true,
        hibrit: { sepet: hibritSepet, toplam: hibritToplam.toFixed(2) + ' TL', bulunamayanlar },
        tekMarketler: liste,
        tekMarketListesi: liste // Eski kodlarla uyumluluk için
    };
}

module.exports = { sepetiOptimizeEt, fiyatCevir, ayniUrunMu };
