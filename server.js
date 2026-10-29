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

// 🛠️ SADECE TÜRKİYEAPI KULLANAN HİYERARŞİK KONUM BULUCU
async function turkiyeApiKoordinatBul(mahalle, ilce, il) {
    try {
        const temizIl = il ? normalize(il) : '';
        const temizIlce = ilce ? normalize(ilce) : '';
        const temizMahalle = mahalle ? normalize(mahalle) : '';

        // 1. İl ID'sini bul
        let ilId = null;
        const ilRes = await axios.get(`https://api.turkiyeapi.dev/api/v2/provinces?name=${encodeURIComponent(il)}`, { timeout: 5000 });
        if (ilRes.data && ilRes.data.data && ilRes.data.data.length > 0) {
            ilId = ilRes.data.data[0].id;
        }

        // 2. İlçe ID'sini bul (Eğer il varsa)
        let ilceId = null;
        if (ilId && ilce) {
            const ilceRes = await axios.get(`https://api.turkiyeapi.dev/api/v2/districts?provinceId=${ilId}&name=${encodeURIComponent(ilce)}`, { timeout: 5000 });
            if (ilceRes.data && ilceRes.data.data && ilceRes.data.data.length > 0) {
                ilceId = ilceRes.data.data[0].id;
            }
        }

        // 3. Mahalle koordinatını bul (Eğer ilçe varsa)
        if (ilceId && mahalle) {
            const mahRes = await axios.get(`https://api.turkiyeapi.dev/api/v2/neighborhoods?districtId=${ilceId}&name=${encodeURIComponent(mahalle)}`, { timeout: 5000 });
            if (mahRes.data && mahRes.data.data && mahRes.data.data.length > 0) {
                const mah = mahRes.data.data[0];
                if (mah.latitude && mah.longitude) {
                    return { lat: parseFloat(mah.latitude), lon: parseFloat(mah.longitude), kaynak: 'TürkiyeAPI (Mahalle)' };
                }
            }
        }

        // 4. Eğer mahalle bulunamazsa, İlçe merkezini kullan
        if (ilceId) {
            const ilceRes = await axios.get(`https://api.turkiyeapi.dev/api/v2/districts?provinceId=${ilId}`, { timeout: 5000 });
            const detay = ilceRes.data.data.find(d => d.id === ilceId);
            if (detay && detay.latitude && detay.longitude) {
                return { lat: parseFloat(detay.latitude), lon: parseFloat(detay.longitude), kaynak: 'TürkiyeAPI (İlçe)' };
            }
        }

        // 5. Eğer sadece il girildiyse, İl merkezini kullan
        if (ilId) {
            const ilDetayRes = await axios.get(`https://api.turkiyeapi.dev/api/v2/provinces/${ilId}`, { timeout: 5000 });
            if (ilDetayRes.data && ilDetayRes.data.data && ilDetayRes.data.data.latitude) {
                return { lat: parseFloat(ilDetayRes.data.data.latitude), lon: parseFloat(ilDetayRes.data.data.longitude), kaynak: 'TürkiyeAPI (İl)' };
            }
        }

        return null;
    } catch (error) {
        console.error('TürkiyeAPI hatası:', error.message);
        return null;
    }
}

app.get('/api/ara', async (req, res) => {
    try {
        const arananUrun = String(req.query.q || '').trim().replace(/\s+/g, ' ').slice(0, 100);
        const il = String(req.query.il || '').trim();
        const ilce = String(req.query.ilce || '').trim();
        const mahalle = String(req.query.mahalle || '').trim();

        if (!arananUrun || arananUrun.length < 2) return res.status(400).json({ success: false, message: 'Geçerli bir ürün adı girin.' });

        let lat = 39.9207; // Varsayılan Türkiye merkez
        let lon = 32.8540; 
        let konumKaynagi = "Varsayılan (Türkiye)";

        // 🛠️ Dinamik Mesafe: Mahalle girdiyse dar, ilçe girdiyse orta, il girdiyse geniş ara
        let distance = 50; 
        if (mahalle) distance = 5;      
        else if (ilce) distance = 15;   

        if (il || ilce || mahalle) {
            const koordinat = await turkiyeApiKoordinatBul(mahalle, ilce, il);
            
            if (koordinat) {
                lat = koordinat.lat;
                lon = koordinat.lon;
                konumKaynagi = koordinat.kaynak;
                console.log(`📍 Konum Bulundu (${konumKaynagi}): ${mahalle} ${ilce} ${il} -> (${lat}, ${lon}) | Mesafe: ${distance}km`);
            } else {
                console.log(`⚠️ TürkiyeAPI konumu bulamadı, varsayılan merkez kullanılıyor.`);
            }
        }

        const cacheKey = 'ara:' + normalize(arananUrun) + ':' + lat.toFixed(3) + ':' + lon.toFixed(3) + ':' + distance;
        const onbellek = cacheGet(cacheKey);
        
        if (onbellek && req.query.yenile !== '1') return res.json({ success: true, query: arananUrun, cached: true, results: onbellek });

        // TÜBİTAK API'sine dinamik mesafeyi gönder
        const hamSonuclar = await karmaArama(arananUrun, lat, lon, distance);
        
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
            const hamSonuclar = await karmaArama(urunAdi, 41.0082, 28.9784, 50);
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
