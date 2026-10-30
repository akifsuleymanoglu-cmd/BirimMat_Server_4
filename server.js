const express = require('express');
const cors = require('cors');
const axios = require('axios');
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

// 🛠️ GEOAPIFY İLE KONUM BULMA (İsteğe Bağlı)
async function geoapifyKoordinatBul(mahalle, ilce, il) {
    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) return null;
    try {
        let adresMetni = "";
        if (mahalle) adresMetni += `${mahalle} Mahallesi, `;
        if (ilce) adresMetni += `${ilce}, `;
        if (il) adresMetni += `${il}, `;
        adresMetni += "Türkiye";

        const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(adresMetni)}&filter=countrycode:tr&limit=1&apiKey=${apiKey}`;
        const response = await axios.get(url, { timeout: 6000 });

        if (response.data && response.data.features && response.data.features.length > 0) {
            const props = response.data.features[0].properties;
            return { lat: props.lat, lon: props.lon };
        }
        return null;
    } catch (error) { return null; }
}

app.get('/api/ara', async (req, res) => {
    try {
        const arananUrun = String(req.query.q || '').trim().replace(/\s+/g, ' ').slice(0, 100);
        const il = String(req.query.il || '').trim();
        const ilce = String(req.query.ilce || '').trim();
        const mahalle = String(req.query.mahalle || '').trim();

        if (!arananUrun || arananUrun.length < 2) return res.status(400).json({ success: false, message: 'Geçerli bir ürün adı girin.' });

        let lat = 41.0082; // Varsayılan İstanbul
        let lon = 28.9784; 

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
        
        if (onbellek && req.query.yenile !== '1') return res.json({ success: true, query: arananUrun, cached: true, results: onbellek });

        const hamSonuclar = await karmaArama(arananUrun, lat, lon);
        
        if (hamSonuclar.length === 0) return res.status(404).json({ success: false, message: 'Eşleşen fiyat bulunamadı.' });

        // 🛠️ MARKA TEMİZLEYİCİ VE EN UCUZ FİYAT BULUCU
        let markayaGoreEnUcuz = new Map();

        hamSonuclar.forEach(item => {
            const marketAdi = normalize(item.market); 
            let anaMarka = "Bilinmeyen Market";

            // Gelen şube isminin içinden ana markayı bul
            if (marketAdi.includes('migros')) anaMarka = 'Migros';
            else if (marketAdi.includes('a101')) anaMarka = 'A101';
            else if (marketAdi.includes('bim')) anaMarka = 'BİM';
            else if (marketAdi.includes('sok') || marketAdi.includes('şok')) anaMarka = 'Şok';
            else if (marketAdi.includes('carrefour')) anaMarka = 'CarrefourSA';
            else if (marketAdi.includes('hakmar')) anaMarka = 'Hakmar';
            else if (marketAdi.includes('tarim kredi') || marketAdi.includes('tarım kredi')) anaMarka = 'Tarım Kredi';
            else if (marketAdi.includes('mopas') || marketAdi.includes('mopaş')) anaMarka = 'Mopaş';
            else if (marketAdi.includes('onur')) anaMarka = 'Onur Market';
            else {
                anaMarka = item.market.split(' ')[0]; // Bilinmeyen markaysa ilk kelimeyi al
            }

            // Fiyatı sayıya çevir (En ucuzu bulmak için)
            const fiyatSayi = parseFloat(String(item.price).replace(/[^\d,]/g, '').replace(',', '.')) || 999999;

            // Aynı markadan daha ucuzu geldiyse onu kaydet
            if (!markayaGoreEnUcuz.has(anaMarka) || fiyatSayi < markayaGoreEnUcuz.get(anaMarka).fiyatSayi) {
                markayaGoreEnUcuz.set(anaMarka, { ...item, market: anaMarka, fiyatSayi });
            }
        });

        // Listedekileri fiyata göre ucuzdan pahalıya sırala
        let filtrelenmisSonuclar = Array.from(markayaGoreEnUcuz.values());
        filtrelenmisSonuclar.sort((a, b) => a.fiyatSayi - b.fiyatSayi);

        if (filtrelenmisSonuclar.length === 0) {
            return res.status(404).json({ success: false, message: 'Eşleşen fiyat bulunamadı.' });
        }

        const finalSonuclar = filtrelenmisSonuclar.map((item, index) => ({
            id: index + 1, 
            title: item.title, 
            price: item.price, 
            unitPrice: item.unitPrice,
            market: item.market, // Artık sadece ana marka (Migros, A101 vs.)
            kaynak: item.kaynak, 
            storeIcon: item.storeIcon || '🛒', 
            link: item.link,
            isBulk: !!item.isBulk, 
            supheli: !!item.supheli, 
            benzer: !!item.benzer, 
            guncelleme: item.guncelleme,
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
