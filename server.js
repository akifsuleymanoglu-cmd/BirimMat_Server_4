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

// =====================================================================
// KATMAN 1: TÜRKİYEAPI (Resmi ve Yerli Veri - Öncelikli)
// =====================================================================
async function turkiyeApiKoordinatBul(mahalle, ilce, il) {
    try {
        // 1. İl ID'sini bul
        const ilRes = await axios.get(`https://api.turkiyeapi.dev/v2/provinces?name=${encodeURIComponent(il)}`, { timeout: 5000 });
        const bulunanIl = ilRes.data.data?.[0];
        if (!bulunanIl) return null;

        // 2. İlçe ID'sini bul
        const ilceRes = await axios.get(`https://api.turkiyeapi.dev/v2/districts?provinceId=${bulunanIl.id}&name=${encodeURIComponent(ilce)}`, { timeout: 5000 });
        const bulunanIlce = ilceRes.data.data?.[0];
        if (!bulunanIlce) return null;

        // 3. Mahalle ID'sini bul ve koordinatları al
        const mahRes = await axios.get(`https://api.turkiyeapi.dev/v2/neighborhoods?districtId=${bulunanIlce.id}&name=${encodeURIComponent(mahalle)}`, { timeout: 5000 });
        const bulunanMahalle = mahRes.data.data?.[0];

        if (bulunanMahalle && bulunanMahalle.latitude && bulunanMahalle.longitude) {
            return { lat: parseFloat(bulunanMahalle.latitude), lon: parseFloat(bulunanMahalle.longitude), kaynak: 'TürkiyeAPI (Mahalle)' };
        }

        // Mahalle bulunamazsa ilçe merkezini döndür
        if (bulunanIlce.latitude && bulunanIlce.longitude) {
            return { lat: parseFloat(bulunanIlce.latitude), lon: parseFloat(bulunanIlce.longitude), kaynak: 'TürkiyeAPI (İlçe)' };
        }
        return null;
    } catch (error) {
        console.error('TürkiyeAPI hatası:', error.message);
        return null;
    }
}

// =====================================================================
// KATMAN 2: GEOAPIFY (Ücretsiz, Kredi Kartsız, 3000 İstek/Gün)
// =====================================================================
async function geoapifyKoordinatBul(mahalle, ilce, il) {
    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) {
        console.log('Geoapify API anahtarı bulunamadı (GEOAPIFY_API_KEY).');
        return null;
    }
    try {
        let adresMetni = "";
        if (mahalle) adresMetni += `${mahalle} Mahallesi, `;
        if (ilce) adresMetni += `${ilce}, `;
        if (il) adresMetni += `${il}, `;
        adresMetni += "Türkiye";

        const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(adresMetni)}&filter=countrycode:tr&limit=1&apiKey=${apiKey}`;
        const response = await axios.get(url, { timeout: 6000 });

        if (response.data && response.data.features && response.data.features.length > 0) {
            const feature = response.data.features[0];
            const props = feature.properties;
            return { lat: props.lat, lon: props.lon, kaynak: 'Geoapify' };
        }
        return null;
    } catch (error) {
        console.error('Geoapify hatası:', error.message);
        return null;
    }
}

// =====================================================================
// KATMAN 3: OPENSTREETMAP (Son Yedek Plan)
// =====================================================================
async function openStreetMapKoordinatBul(ilce, il) {
    try {
        let adresMetni = "";
        if (ilce) adresMetni += `${ilce}, `;
        if (il) adresMetni += `${il}, `;
        adresMetni += "Türkiye";

        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(adresMetni)}&format=json&limit=1`;
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'BirimMat-App-TUBITAK' },
            timeout: 5000
        });

        if (response.data && response.data.length > 0) {
            return { lat: parseFloat(response.data[0].lat), lon: parseFloat(response.data[0].lon), kaynak: 'OpenStreetMap' };
        }
        return null;
    } catch (error) {
        return null;
    }
}

// =====================================================================
// MERKEZİ KONUM BULUCU (Tüm Katmanları Sırayla Dener)
// =====================================================================
async function konumBul(mahalle, ilce, il) {
    let koordinat = await turkiyeApiKoordinatBul(mahalle, ilce, il);
    if (koordinat) return koordinat;

    koordinat = await geoapifyKoordinatBul(mahalle, ilce, il);
    if (koordinat) return koordinat;

    if (ilce || il) {
        koordinat = await openStreetMapKoordinatBul(ilce, il);
        if (koordinat) return koordinat;
    }
    return null;
}

app.get('/api/ara', async (req, res) => {
    try {
        const arananUrun = String(req.query.q || '').trim().replace(/\s+/g, ' ').slice(0, 100);
        const il = String(req.query.il || '').trim();
        const ilce = String(req.query.ilce || '').trim();
        const mahalle = String(req.query.mahalle || '').trim();

        if (!arananUrun || arananUrun.length < 2) return res.status(400).json({ success: false, message: 'Geçerli bir ürün adı girin.' });

        let lat = 39.9207;
        let lon = 32.8540;
        let konumKaynagi = "Varsayılan";

        let distance = 50;
        if (mahalle) distance = 5;
        else if (ilce) distance = 15;

        if (il || ilce || mahalle) {
            const koordinat = await konumBul(mahalle, ilce, il);
            if (koordinat) {
                lat = koordinat.lat;
                lon = koordinat.lon;
                konumKaynagi = koordinat.kaynak;
                console.log(`📍 Konum Bulundu (${konumKaynagi}): ${mahalle} ${ilce} ${il} -> (${lat}, ${lon}) | Mesafe: ${distance}km`);
            } else {
                console.log(`⚠️ Hiçbir servis konumu bulamadı, varsayılan merkez kullanılıyor.`);
            }
        }

        const cacheKey = 'ara:' + normalize(arananUrun) + ':' + lat.toFixed(3) + ':' + lon.toFixed(3) + ':' + distance;
        const onbellek = cacheGet(cacheKey);

        if (onbellek && req.query.yenile !== '1') return res.json({ success: true, query: arananUrun, cached: true, results: onbellek });

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
    } catch (error) { res.status(502).json({ success: false, message: 'Tarif siteleri şu an erişilemiyor.' }); }
});

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
            } else { sonuclar.push({ arananAd: urunAdi, guncelFiyat: null, market: null }); }
        }
        res.json({ success: true, sonuclar: sonuclar });
    } catch (error) { res.status(500).json({ success: false, message: 'Sunucu hatası.' }); }
});

app.get('/api/saglik', (req, res) => {
    res.json({ success: true, uptimeSn: Math.round(process.uptime()), bellekMB: Math.round(process.memoryUsage().rss / 1048576), fiyatKaynaklari: fiyatDurum(), tarifKaynaklari: tarifDurum() });
});

app.use((req, res) => res.status(404).json({ success: false, message: 'Bulunamadı.' }));

if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => { console.log(`🚀 Sunucu Aktif: http://localhost:${PORT}`); });
}

module.exports = app;
