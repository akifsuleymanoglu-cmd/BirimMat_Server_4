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

// 1. MARKET ARAMA VE MARKA TEMİZLEME
app.get('/api/ara', async (req, res) => {
    try {
        const arananUrun = String(req.query.q || '').trim().replace(/\s+/g, ' ').slice(0, 100);
        const il = String(req.query.il || '').trim();
        const ilce = String(req.query.ilce || '').trim();
        const mahalle = String(req.query.mahalle || '').trim();

        if (!arananUrun || arananUrun.length < 2) return res.status(400).json({ success: false, message: 'Geçerli bir ürün adı girin.' });

        let lat = 41.0082; 
        let lon = 28.9784; 

        if (il || ilce || mahalle) {
            const koordinat = await geoapifyKoordinatBul(mahalle, ilce, il);
            if (koordinat) { lat = koordinat.lat; lon = koordinat.lon; }
        }

        const cacheKey = 'ara:' + normalize(arananUrun) + ':' + lat.toFixed(3) + ':' + lon.toFixed(3);
        const onbellek = cacheGet(cacheKey);
        if (onbellek && req.query.yenile !== '1') return res.json({ success: true, query: arananUrun, cached: true, results: onbellek });

        const hamSonuclar = await karmaArama(arananUrun, lat, lon);
        if (hamSonuclar.length === 0) return res.status(404).json({ success: false, message: 'Eşleşen fiyat bulunamadı.' });

        let filtrelenmisSonuclar = [];
        hamSonuclar.forEach(item => {
            const marketAdi = normalize(item.market); 
            const resimUrl = (item.productImage || '').toLowerCase();
            const aranacakMetin = marketAdi + " " + resimUrl; 

            let anaMarka = "Diğer Market";
            if (aranacakMetin.includes('migros')) anaMarka = 'Migros';
            else if (aranacakMetin.includes('a101')) anaMarka = 'A101';
            else if (aranacakMetin.includes('bim')) anaMarka = 'BİM';
            else if (aranacakMetin.includes('sok') || aranacakMetin.includes('şok')) anaMarka = 'Şok';
            else if (aranacakMetin.includes('carrefour')) anaMarka = 'CarrefourSA';
            else if (aranacakMetin.includes('hakmar')) anaMarka = 'Hakmar';
            else anaMarka = item.market.trim(); 

            const fiyatSayi = parseFloat(String(item.price).replace(/[^\d,]/g, '').replace(',', '.')) || 999999;
            filtrelenmisSonuclar.push({ ...item, market: anaMarka, fiyatSayi });
        });

        const gorulenler = new Set();
        filtrelenmisSonuclar = filtrelenmisSonuclar.filter(item => {
            const kilit = normalize(item.market) + "|" + normalize(item.title) + "|" + item.price;
            if (gorulenler.has(kilit)) return false;
            gorulenler.add(kilit);
            return true;
        });

        filtrelenmisSonuclar.sort((a, b) => a.fiyatSayi - b.fiyatSayi);

        const finalSonuclar = filtrelenmisSonuclar.map((item, index) => ({
            id: index + 1, title: item.title, price: item.price, unitPrice: item.unitPrice,
            market: item.market, kaynak: item.kaynak, storeIcon: item.storeIcon || '🛒', link: item.link,
            isBulk: !!item.isBulk, supheli: !!item.supheli, benzer: !!item.benzer, guncelleme: item.guncelleme,
            marketLogo: marketLogoBul(item.market),
            productImage: item.productImage
        }));

        cacheSet(cacheKey, finalSonuclar);
        res.json({ success: true, query: arananUrun, results: finalSonuclar });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Sunucu hatası oluştu.' });
    }
});

// 2. AKILLI SEPET (DOĞRU VE KARARLI EŞLEŞTİRME)
app.post('/api/sepet-optimize', async (req, res) => {
    try {
        const istenenUrunler = req.body.urunler || [];
        if (istenenUrunler.length === 0) return res.status(400).json({ success: false, message: 'Sepet boş.' });

        let marketVerisi = {}; 
        let hibritSepet = [];
        let hibritToplam = 0;

        for (const urunObj of istenenUrunler) {
            const aranacakBaslik = typeof urunObj === 'string' ? urunObj : (urunObj && urunObj.baslik ? urunObj.baslik : '');
            if (!aranacakBaslik) continue;

            const hamSonuclar = await karmaArama(aranacakBaslik, 41.0082, 28.9784);
            
            if (hamSonuclar && hamSonuclar.length > 0) {
                let enUcuzUrun = null;
                let enUcuzFiyat = 999999;
                
                const arananNorm = normalize(aranacakBaslik);
                // Aramadaki boyut/hacim bilgisini yakala (örn: "1 lt", "390 gr", "1.5 kg")
                const boyutMatch = arananNorm.match(/(\d+[\.,]?\d*)\s*(lt|l|ml|kg|g|gr)/);
                const arananBoyut = boyutMatch ? boyutMatch[0].replace(/\s+/g, '') : null;

                hamSonuclar.forEach(item => {
                    if (!item || !item.title || !item.price) return;
                    
                    const gelenNorm = normalize(item.title);

                    // Eğer aranan üründe belirli bir miktar/boyut varsa, sonuçta da o geçmeli (200ml / 1lt karışmasını önler)
                    if (arananBoyut) {
                        const gelenBoyutMatch = gelenNorm.match(/(\d+[\.,]?\d*)\s*(lt|l|ml|kg|g|gr)/);
                        const gelenBoyut = gelenBoyutMatch ? gelenBoyutMatch[0].replace(/\s+/g, '') : null;
                        if (gelenBoyut && gelenBoyut !== arananBoyut) return;
                    }

                    const marketAdi = normalize(String(item.market || '')); 
                    let anaMarka = "Diğer";
                    
                    const aranacakMetin = marketAdi + " " + String(item.productImage || '').toLowerCase();
                    if (aranacakMetin.includes('migros')) anaMarka = 'Migros';
                    else if (aranacakMetin.includes('a101')) anaMarka = 'A101';
                    else if (aranacakMetin.includes('bim')) anaMarka = 'BİM';
                    else if (aranacakMetin.includes('sok') || aranacakMetin.includes('şok')) anaMarka = 'Şok';
                    else if (aranacakMetin.includes('carrefour')) anaMarka = 'CarrefourSA';
                    
                    if (anaMarka === "Diğer") return; 

                    const fiyatSayi = parseFloat(String(item.price).replace(/[^\d,]/g, '').replace(',', '.')) || 999999;

                    if (!marketVerisi[anaMarka]) marketVerisi[anaMarka] = {};
                    
                    if (!marketVerisi[anaMarka][aranacakBaslik] || fiyatSayi < marketVerisi[anaMarka][aranacakBaslik].fiyatSayi) {
                        marketVerisi[anaMarka][aranacakBaslik] = { title: item.title, fiyatSayi, price: item.price };
                    }

                    if (fiyatSayi < enUcuzFiyat) {
                        enUcuzFiyat = fiyatSayi;
                        enUcuzUrun = { urunAdi: aranacakBaslik, market: anaMarka, title: item.title, price: item.price };
                    }
                });

                // Eğer tam boyut eşleşmesiyle bulunamadıysa, ilk mantıklı en ucuzu al (sepet boş kalmasın)
                if (!enUcuzUrun && hamSonuclar.length > 0) {
                    const yedekItem = hamSonuclar[0];
                    const fiyatSayi = parseFloat(String(yedekItem.price).replace(/[^\d,]/g, '').replace(',', '.')) || 0;
                    enUcuzUrun = { urunAdi: aranacakBaslik, market: yedekItem.market, title: yedekItem.title, price: yedekItem.price };
                    enUcuzFiyat = fiyatSayi;
                }

                if (enUcuzUrun) {
                    hibritSepet.push(enUcuzUrun);
                    hibritToplam += enUcuzFiyat;
                }
            }
        }

        let tekMarketListesi = [];
        const tumMarketler = ['A101', 'Migros', 'BİM', 'Şok', 'CarrefourSA'];

        tumMarketler.forEach(market => {
            if (!marketVerisi[market]) return;

            let marketToplam = 0;
            let bulunanUrunler = [];
            let eksikUrunler = [];

            istenenUrunler.forEach(urun => {
                const baslik = typeof urun === 'string' ? urun : (urun && urun.baslik ? urun.baslik : '');
                if (!baslik) return;

                if (marketVerisi[market][baslik]) {
                    marketToplam += marketVerisi[market][baslik].fiyatSayi;
                    bulunanUrunler.push(marketVerisi[market][baslik]);
                } else {
                    eksikUrunler.push(baslik);
                }
            });

            tekMarketListesi.push({
                market: market,
                toplam: marketToplam.toFixed(2) + " TL",
                toplamSayi: marketToplam,
                bulunanUrunler: bulunanUrunler,
                eksikUrunler: eksikUrunler
            });
        });

        tekMarketListesi.sort((a, b) => a.toplamSayi - b.toplamSayi);

        res.json({
            success: true,
            hibrit: { sepet: hibritSepet, toplam: hibritToplam.toFixed(2) + " TL" },
            tekMarketListesi: tekMarketListesi
        });

    } catch (error) {
        console.error('Sepet Optimizasyon Kritik Hata:', error);
        res.status(500).json({ success: false, message: 'Sunucu optimizasyon hatası: ' + error.message });
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
            const hamSonuclar = await karmaArama(urunAdi, 41.0082, 28.9784);
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
