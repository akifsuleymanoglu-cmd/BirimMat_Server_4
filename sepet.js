// sepet.js - Gelişmiş Alaka Düzeyi (Relevance Score) ve Ağırlıklı Sıralama Motoru

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

// 🚀 GELİŞMİŞ ALGORİTMA: Kelime Eşleşme Puanı Hesaplama (0 - 100)
function urunSkoruHesapla(arananBaslik, gelenBaslik) {
    const arananLower = norm(arananBaslik);
    const gelenLower = norm(gelenBaslik);
    
    let skor = 0;
    const arananKelimeler = arananLower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(k => k.length > 1);
    const gelenKelimeler = gelenLower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(k => k.length > 1);
    
    if (arananKelimeler.length === 0) return 0;

    // 1. Kelime Eşleşmeleri (+20 Puan)
    let eslesenKelime = 0;
    for (let ak of arananKelimeler) {
        if (gelenKelimeler.some(gk => gk === ak || gk.startsWith(ak) || ak.startsWith(gk))) {
            eslesenKelime++;
            skor += 20; 
        }
    }
    // Eğer aranan kelimelerin yarısından azı eşleştiyse direkt 0 ver (alakasız ürün)
    if (eslesenKelime < arananKelimeler.length * 0.5) return 0;

    // 2. Zıt Anlamlı / Çeldirici Kelime Cezası (-50 Puan)
    const renkler = ['kirmizi', 'yesil', 'sari', 'siyah', 'beyaz', 'mor', 'turuncu', 'esmer', 'kahverengi'];
    for (let renk of renkler) {
        // Aranan üründe renk yok ama gelen üründe varsa ağır ceza kes!
        if (gelenLower.includes(renk) && !arananLower.includes(renk)) {
            skor -= 50; 
        }
    }
    
    const yasakli = ['zeytin', 'salca', 'cikolata', 'krem', 'sampuan', 'cay', 'kahve', 'deterjan', 'biskuvi', 'kraker', 'kofte', 'sucuk', 'tursu', 'dondurulmus'];
    for (let y of yasakli) {
        if (gelenLower.includes(y) && !arananLower.includes(y)) {
            skor -= 40;
        }
    }

    // 3. Gramaj / Hacim Uyumu (+30 Puan veya -30 Ceza)
    const ab = boyutBul(arananBaslik);
    const gb = boyutBul(gelenBaslik);
    
    if (ab && gb) {
        if (gb.tur === ab.tur) {
            // Aranan miktar ile gelen miktar birbirine çok yakınsa (+30)
            if (Math.abs(gb.deger - ab.deger) < (ab.deger * 0.1)) skor += 30;
            // Gelen miktar arananın %90'ından azsa veya 3 katından fazlaysa (-30)
            else if (gb.deger < (ab.deger * 0.90) || gb.deger > (ab.deger * 3)) skor -= 30;
            else skor += 10; // Farklı ama kabul edilebilir aralıkta
        } else {
            skor -= 20; // Biri ağırlık biri hacimse ceza
        }
    } else if (ab && !gb) {
        skor -= 20; // Arananın gramajı var ama gelenin yok
    }

    // 4. Tam Eşleşme Bonusu (+50 Puan)
    if (gelenLower.includes(arananLower)) skor += 50;

    return Math.max(0, skor); // Skor eksiye düşmesin
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
            
            // 🚀 SİHİR BURADA: Her ürün için bir kalite puanı hesaplıyoruz
            const skor = urunSkoruHesapla(baslik, item.title);
            
            // Eğer ürünün puanı çok düşükse (alakasızsa) direkt atla (Örn: 40 puan altı)
            if (skor < 40) continue; 

            const market = anaMarka(item);
            if (!market) continue;
            
            const fiyatSayi = fiyatCevir(item.price);
            if (fiyatSayi >= 999999) continue;
            
            // Eğer bu markette bu ürünün daha önce kaydedilmiş bir sürümü yoksa VEYA 
            // yeni gelen ürünün SKORU daha yüksekse, bu ürünü kaydet.
            if (!marketBazli[market] || skor > marketBazli[market].skor || (skor === marketBazli[market].skor && fiyatSayi < marketBazli[market].fiyatSayi)) {
                marketBazli[market] = { title: item.title, price: item.price, fiyatSayi, skor };
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

module.exports = { sepetiOptimizeEt, fiyatCevir };
