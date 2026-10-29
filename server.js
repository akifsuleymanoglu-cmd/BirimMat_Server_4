const express = require('express');
const cors = require('cors');
const { normalize, marketLogoBul } = require('./yardimcilar');
const { tarifBul, durumRapor: tarifDurum } = require('./tarifler');
const { karmaArama, durumRapor: fiyatDurum } = require('./fiyatlar');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ARA_CACHE_SURESI = 3 * 60 * 1000;

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '10kb' }));

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

// 🛠️ YENİ: İstanbul İlçe Koordinatları (Harita servisi hata yapmasın diye koda gömdük)
const ILCE_KOORDINATLARI = {
    'büyükçekmece': { lat: 41.0201, lon: 28.5850 },
    'kadıköy': { lat: 40.9908, lon: 29.0270 },
    'üsküdar': { lat: 41.0263, lon: 29.0154 },
    'beşiktaş': { lat: 41.0430, lon: 29.0094 },
    'şişli': { lat: 41.0602, lon: 28.9877 },
    'fatih': { lat: 41.0186, lon: 28.9398 },
    'bakırköy': { lat: 40.9819, lon: 28.8772 },
    'beykoz': { lat: 41.1094, lon: 29.0220 },
    'maltepe': { lat: 40.9978, lon: 29.1256 },
    'kartal': { lat: 40.9068, lon: 29.1850 },
    'pendik': { lat: 40.8775, lon: 29.2342 },
    'ataşehir': { lat: 40.9922, lon: 29.1244 },
    'bahçelievler': { lat: 40.9974, lon: 28.8493 },
    'bağcılar': { lat: 41.0392, lon: 28.8567 },
    'esenyurt': { lat: 41.0343, lon: 28.6741 },
    'sultangazi': { lat: 41.1063, lon: 28.8689 },
    'gaziosmanpaşa': { lat: 41.0586, lon: 28.9091 },
    'zeytinburnu': { lat: 40.9945, lon: 28.9063 }
};

app.get('/api/ara', async (req, res) => {
    try {
        const arananUrun = String(req.query.q || '').trim().replace(/\s+/g, ' ').slice(0, 100);
        const il = String(req.query.il || '').trim();
        const ilce = String(req.query.ilce || '').trim();

        if (!arananUrun || arananUrun.length < 2) return res.status(400).json({ success: false, message: 'Geçerli bir ürün adı girin.' });

        let lat = 41.0082; // Varsayılan: İstanbul Merkez
        let lon = 28.9784; 

        // 🛠️ Konum Mantığı: Haritaya sormak yerine kodun içinden bul
        if (ilce) {
            const temizIlce = normalize(ilce);
            if (ILCE_KOORDINATLARI[temizIlce]) {
                lat = ILCE_KOORDINATLARI[temizIlce].lat;
                lon = ILCE_KOORDINATLARI[temizIlce].lon;
                console.log(`📍 Konum Kod içinden Bulundu: ${ilce} -> (${lat}, ${lon})`);
            }
        }

        const cacheKey = 'ara:' + normalize(arananUrun) + ':' + lat.toFixed(3) + ':' + lon.toFixed(3);
        const onbellek = cacheGet(cacheKey);
        
        // Eğer URL'de ?yenile=1 varsa önbelleği atla
        if (onbellek && req.query.yenile !== '1') return res.json({ success: true, query: arananUrun, cached: true, results: onbellek });

        const hamSonuclar = await karmaArama(arananUrun, lat, lon);
        
        if (hamSonuclar.length === 0) return res.status(404).json({ success: false, message: 'Eşleşen fiyat bulunamadı.' });

        const finalSonuclar = hamSonuclar.map((item, index) => ({
            id: index + 1, title: item.title, price: item.price, unitPrice: item.unitPrice,
            market: item.market, kaynak: item.kaynak, storeIcon: item.storeIcon, link: item.link,
            isBulk: !!item.isBulk, supheli: !!item.supheli, benzer: !!item.benzer, guncelleme: item.guncelleme,
            marketLogo: marketLogoBul(item.market),
            productImage: item.productImage
        }));

        cacheSet(cacheKey, finalSonuclar);
        res.json({ success: true, query: arananUrun, results: finalSonuclar });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Sunucu hatası oluştu.' });
    }
});

// Şef AI Tarif Modülü
app.get('/api/tarif', async (req, res) => {
    try {
        const yemekAdi = String(req.query.q || '').trim().replace(/\s+/g, ' ').slice(0, 100);
        if (!yemekAdi || yemekAdi.length < 2) return res.status(400).json({ success: false, message: 'Geçerli bir yemek adı girin.' });
        
        const cacheKey = 'tarif:' + normalize(yemekAdi);
        const onbellek = cacheGet(cacheKey);
        if (onbellek) return res.json(onbellek);
        
        const sonuc = await tarifBul(yemekAdi);
        if (!sonuc) return res.status(404).json({ success: false, message: 'Tarif bulunamadı.' });
        
        const yanit = { success: true, query: yemekAdi, tarifAdi: sonuc.tarifAdi, malzemeler: sonuc.malzemeler, adimlar: sonuc.adimlar, link: sonuc.link, kaynak: sonuc.kaynak };
        cacheSet(cacheKey, yanit, 10 * 60 * 1000);
        res.json(yanit);
    } catch (error) {
        res.status(502).json({ success: false, message: 'Tarif siteleri şu an erişilemiyor.' });
    }
});

// Fiyat Takip (Arka plan)
app.post('/api/fiyat-kontrol', async (req, res) => {
    try {
        const urunler = req.body.urunler || [];
        if (urunler.length === 0) return res.json({ success: true, sonuclar: [] });
        
        const sonuclar = [];
        for (const urunAdi of urunler) {
            // Arka plan kontrolü için İstanbul merkez kullanıyoruz
            const hamSonuclar = await karmaArama(urunAdi, 41.0082, 28.9784);
            if (hamSonuclar && hamSonuclar.length > 0) {
                const enIyiSonuc = hamSonuclar[0]; 
                sonuclar.push({ arananAd: urunAdi, guncelFiyat: enIyiSonuc.price, market: enIyiSonuc.market });
            } else {
                sonuclar.push({ arananAd: urunAdi, guncelFiyat: null, market: null });
            }
        }
        res.json({ success: true, sonuclar: sonuclar });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Sunucu hatası.' });
    }
});

app.get('/api/saglik', (req, res) => {
    res.json({ success: true, uptimeSn: Math.round(process.uptime()), bellekMB: Math.round(process.memoryUsage().rss / 1048576), fiyatKaynaklari: fiyatDurum(), tarifKaynaklari: tarifDurum() });
});

app.use((req, res) => res.status(404).json({ success: false, message: 'Bulunamadı.' }));

if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Sunucu Aktif: http://localhost:${PORT}`);
    });
}

module.exports = app;
