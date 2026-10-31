// server.js - BirimMat backend (Render). Fiyat motoru: fiyatlar.js, tarifler: tarifler.js, sepet: sepet.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const yardimcilar = require('./yardimcilar');
const { tarifBul, durumRapor: tarifDurum } = require('./tarifler');
const { karmaArama, durumRapor: fiyatDurum } = require('./fiyatlar');
const { sepetiOptimizeEt, fiyatCevir, ayniUrunMu } = require('./sepet');
const { malzemeleriEslestir } = require('./malzeme');
const { tarifSepetiHazirla } = require('./tarif_sepeti');

const normalize = yardimcilar.normalize;
// yardimcilar.js'te marketLogoBul yoksa sunucu çökmesin
const marketLogoBul = typeof yardimcilar.marketLogoBul === 'function' ? yardimcilar.marketLogoBul : () => null;

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ARA_CACHE_SURESI = 3 * 60 * 1000;
const VARSAYILAN_KONUM = { lat: 41.0082, lon: 28.9784 };

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '10kb' }));

// ---------- Önbellek ----------
const cache = new Map();
function cacheGet(key) {
    const kayit = cache.get(key);
    if (!kayit) return null;
    if (Date.now() - kayit.zaman > kayit.sure) { cache.delete(key); return null; }
    return kayit.veri;
}
function cacheSet(key, veri, sure = ARA_CACHE_SURESI) {
    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    cache.set(key, { zaman: Date.now(), sure, veri });
}

// ---------- Geoapify ile konum ----------
async function geoapifyKoordinatBul(mahalle, ilce, il) {
    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) return null;
    try {
        let adres = '';
        if (mahalle) adres += `${mahalle} Mahallesi, `;
        if (ilce) adres += `${ilce}, `;
        if (il) adres += `${il}, `;
        adres += 'Türkiye';
        const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(adres)}&filter=countrycode:tr&limit=1&apiKey=${apiKey}`;
        const response = await axios.get(url, { timeout: 6000 });
        const f = response.data && response.data.features;
        if (f && f.length > 0) return { lat: f[0].properties.lat, lon: f[0].properties.lon };
        return null;
    } catch (error) {
        console.error('Geoapify Hatası:', error.message);
        return null;
    }
}

// Şube adından / görsel adresinden ana markayı bulur
function anaMarkaBul(item) {
    const market = normalize(String(item.market || ''));
    const resim = String(item.productImage || '').toLowerCase();
    const metin = market + ' ' + resim;
    if (metin.includes('migros')) return 'Migros';
    if (metin.includes('a101')) return 'A101';
    if (metin.includes('bim')) return 'BİM';
    if (metin.includes('sok') || metin.includes('şok')) return 'Şok';
    if (metin.includes('carrefour')) return 'CarrefourSA';
    if (metin.includes('hakmar')) return 'Hakmar';
    if (metin.includes('tarim_kredi') || metin.includes('tarım kredi')) return 'Tarım Kredi';
    if (metin.includes('mopas') || metin.includes('mopaş')) return 'Mopaş';
    if (metin.includes('onur')) return 'Onur Market';
    return String(item.market || '').trim() || 'Diğer Market';
}

// ================================================================
// 1. MARKET ARAMA (/api/ara)
// ================================================================
app.get('/api/ara', async (req, res) => {
    try {
        const arananUrun = String(req.query.q || '').trim().replace(/\s+/g, ' ').slice(0, 100);
        const il = String(req.query.il || '').trim();
        const ilce = String(req.query.ilce || '').trim();
        const mahalle = String(req.query.mahalle || '').trim();

        if (arananUrun.length < 2) {
            return res.status(400).json({ success: false, message: 'Geçerli bir ürün adı girin.' });
        }

        let { lat, lon } = VARSAYILAN_KONUM;
        if (il || ilce || mahalle) {
            const koordinat = await geoapifyKoordinatBul(mahalle, ilce, il);
            if (koordinat) {
                lat = koordinat.lat;
                lon = koordinat.lon;
                console.log(`📍 Konum Bulundu: ${mahalle} ${ilce} ${il} -> (${lat}, ${lon})`);
            }
        }

        const cacheKey = 'ara:' + normalize(arananUrun) + ':' + lat.toFixed(3) + ':' + lon.toFixed(3);
        const onbellek = cacheGet(cacheKey);
        if (onbellek && req.query.yenile !== '1') {
            return res.json({ success: true, query: arananUrun, cached: true, results: onbellek });
        }

        const hamSonuclar = (await karmaArama(arananUrun, lat, lon)) || [];
        if (hamSonuclar.length === 0) {
            return res.status(404).json({ success: false, message: 'Eşleşen fiyat bulunamadı.' });
        }

        // Ana markayı bul, fiyatı doğru oku
        let sonuclar = hamSonuclar.map((item) => ({
            ...item,
            market: anaMarkaBul(item),
            fiyatSayi: fiyatCevir(item.price)   // eski kod noktayı siliyordu: 57.5 -> 575
        }));

        // Aynı market + ürün + fiyat tekrarlarını temizle
        const gorulenler = new Set();
        sonuclar = sonuclar.filter((item) => {
            const kilit = normalize(item.market) + '|' + normalize(String(item.title || '')) + '|' + item.price;
            if (gorulenler.has(kilit)) return false;
            gorulenler.add(kilit);
            return true;
        });

        sonuclar.sort((a, b) => a.fiyatSayi - b.fiyatSayi);

        const finalSonuclar = sonuclar.map((item, index) => ({
            id: index + 1, title: item.title, price: item.price, unitPrice: item.unitPrice,
            market: item.market, kaynak: item.kaynak, storeIcon: item.storeIcon || '🛒', link: item.link,
            isBulk: !!item.isBulk, supheli: !!item.supheli, benzer: !!item.benzer, guncelleme: item.guncelleme,
            marketLogo: marketLogoBul(item.market),
            productImage: item.productImage
        }));

        cacheSet(cacheKey, finalSonuclar);
        res.json({ success: true, query: arananUrun, results: finalSonuclar });
    } catch (error) {
        console.error('❌ /api/ara hatası:', error);
        res.status(500).json({ success: false, message: 'Sunucu hatası oluştu.', detay: error.message });
    }
});

// ================================================================
// 2. AKILLI SEPET (/api/sepet-optimize)  -> mantık sepet.js içinde
// ================================================================
app.post('/api/sepet-optimize', async (req, res) => {
    try {
        const istenen = Array.isArray(req.body.urunler) ? req.body.urunler.slice(0, 30) : [];
        if (istenen.length === 0) return res.status(400).json({ success: false, message: 'Sepet boş.' });
        res.json(await sepetiOptimizeEt(istenen, karmaArama));
    } catch (error) {
        console.error('❌ Sepet hatası:', error);
        res.status(500).json({ success: false, message: 'Sepet hesaplanırken hata oluştu.', detay: error.message });
    }
});

// ================================================================
// 2b. TARİF MALZEMESİ EŞLEŞTİRME (/api/malzeme-eslestir) -> mantık malzeme.js içinde
// ================================================================
app.post('/api/malzeme-eslestir', async (req, res) => {
    try {
        const liste = Array.isArray(req.body.malzemeler) ? req.body.malzemeler.slice(0, 40) : [];
        if (liste.length === 0) return res.status(400).json({ success: false, message: 'Malzeme listesi boş.' });
        res.json({ success: true, sonuclar: await malzemeleriEslestir(liste, karmaArama) });
    } catch (error) {
        console.error('❌ Malzeme eşleştirme hatası:', error);
        res.status(500).json({ success: false, message: 'Malzemeler eşleştirilemedi.', detay: error.message });
    }
});

// ================================================================
// 2c. TARİF SEPETİ (/api/tarif-sepeti): aynı malzemeleri birleştirir, gereken kadar ürün hesaplar
//     Body: { "satirlar": ["1 çay bardağı zeytinyağı", "2 su bardağı zeytinyağı", ...] }
// ================================================================
app.post('/api/tarif-sepeti', async (req, res) => {
    try {
        const ham = req.body.satirlar || req.body.malzemeler;
        const satirlar = Array.isArray(ham) ? ham.map(String).slice(0, 60) : [];
        if (satirlar.length === 0) return res.status(400).json({ success: false, message: 'Malzeme listesi boş.' });
        res.json({ success: true, ...(await tarifSepetiHazirla(satirlar, karmaArama)) });
    } catch (error) {
        console.error('❌ Tarif sepeti hatası:', error);
        res.status(500).json({ success: false, message: 'Tarif sepeti hesaplanamadı.', detay: error.message });
    }
});

// ================================================================
// 3. ŞEF TARİF MODÜLÜ (/api/tarif)
// ================================================================
app.get('/api/tarif', async (req, res) => {
    try {
        const yemekAdi = String(req.query.q || '').trim().replace(/\s+/g, ' ').slice(0, 100);
        if (yemekAdi.length < 2) return res.status(400).json({ success: false, message: 'Geçerli bir yemek adı girin.' });

        const cacheKey = 'tarif:' + normalize(yemekAdi);
        const onbellek = cacheGet(cacheKey);
        if (onbellek) return res.json(onbellek);

        const sonuc = await tarifBul(yemekAdi);
        if (!sonuc) return res.status(404).json({ success: false, message: 'Tarif bulunamadı.' });

        const yanit = {
            success: true, query: yemekAdi, tarifAdi: sonuc.tarifAdi, malzemeler: sonuc.malzemeler,
            adimlar: sonuc.adimlar, link: sonuc.link, kaynak: sonuc.kaynak
        };
        cacheSet(cacheKey, yanit, 10 * 60 * 1000);
        res.json(yanit);
    } catch (error) {
        console.error('❌ /api/tarif hatası:', error.message);
        res.status(502).json({ success: false, message: 'Tarif siteleri şu an erişilemiyor.' });
    }
});

// ================================================================
// 4. FİYAT TAKİP (/api/fiyat-kontrol)
// ================================================================
app.post('/api/fiyat-kontrol', async (req, res) => {
    try {
        const urunler = Array.isArray(req.body.urunler) ? req.body.urunler.slice(0, 30) : [];
        const sonuclar = [];
        for (const urunAdi of urunler) {
            let ham = [];
            try { ham = (await karmaArama(urunAdi, VARSAYILAN_KONUM.lat, VARSAYILAN_KONUM.lon)) || []; }
            catch (e) { console.error(`❌ Fiyat kontrol (${urunAdi}):`, e.message); }
            // Önce aynı ürün olan (marka + miktar tutan) sonuçların en ucuzunu al; yoksa ilk sonucu kullan
            const ayni = ham.filter((x) => x && ayniUrunMu(urunAdi, x.title));
            const iyi = ayni.length > 0
                ? ayni.reduce((a, b) => (fiyatCevir(b.price) < fiyatCevir(a.price) ? b : a))
                : ham[0];
            sonuclar.push(iyi
                ? { arananAd: urunAdi, guncelFiyat: iyi.price, market: iyi.market }
                : { arananAd: urunAdi, guncelFiyat: null, market: null });
        }
        res.json({ success: true, sonuclar });
    } catch (error) {
        console.error('❌ /api/fiyat-kontrol hatası:', error);
        res.status(500).json({ success: false, message: 'Sunucu hatası.' });
    }
});

// ================================================================
// 5. SAĞLIK KONTROLÜ VE BAŞLATMA
// ================================================================
app.get('/api/saglik', (req, res) => {
    res.json({
        success: true,
        uptimeSn: Math.round(process.uptime()),
        bellekMB: Math.round(process.memoryUsage().rss / 1048576),
        fiyatKaynaklari: fiyatDurum(),
        tarifKaynaklari: tarifDurum()
    });
});

app.use((req, res) => res.status(404).json({ success: false, message: 'Bulunamadı.' }));

// Beklenmedik hatalar sunucuyu sessizce düşürmesin
process.on('unhandledRejection', (r) => console.error('⚠️ Yakalanmamış Promise hatası:', r));
process.on('uncaughtException', (e) => console.error('⚠️ Yakalanmamış istisna:', e));

if (require.main === module) {
    const sunucu = app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Sunucu Aktif: http://localhost:${PORT}`);
        console.log('⚡ Akıllı Sepet ve Geoapify entegrasyonu hazır.');
    });
    sunucu.on('error', (err) => {
        console.error(err.code === 'EADDRINUSE' ? `❌ ${PORT} portu kullanımda.` : `❌ Sunucu hatası: ${err.message}`);
        process.exit(1);
    });
}

module.exports = app;
