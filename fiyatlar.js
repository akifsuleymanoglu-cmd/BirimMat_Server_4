const axios = require('axios');

async function marketFiyatiAra(arananUrun) {
    try {
        console.log(`🔎 [API] Market Fiyatı aranıyor: "${arananUrun}"`);
        
        const response = await axios.post('https://api.marketfiyati.org.tr/api/v2/search', {
            keywords: arananUrun,
            latitude: 41.0082,
            longitude: 28.9784,
            distance: 10,
            size: 50
        }, { timeout: 10000 });

        const icerik = response.data.content || [];
        console.log(`📊 [API] ${icerik.length} ham ürün bulundu.`);

        const hamListe = [];

        icerik.forEach(item => {
            const baslik = item.productName || item.title || 'Bilinmeyen Ürün';
            const resim = item.imageUrl || null;

            // Resim linkinden market tahmini yapma fonksiyonu
            const resimdenMarketBul = (url) => {
                if (!url) return null;
                const u = url.toLowerCase();
                if (u.includes('migros')) return 'Migros';
                if (u.includes('a101')) return 'A101';
                if (u.includes('carrefour')) return 'CarrefourSA';
                if (u.includes('bim')) return 'BİM';
                if (u.includes('sok')) return 'Şok';
                if (u.includes('hakmar')) return 'Hakmar';
                return null;
            };

            if (item.productDepotInfoList && item.productDepotInfoList.length > 0) {
                item.productDepotInfoList.forEach(market => {
                    // 🛠️ BÜTÜN OLASI ALAN İSİMLERİNİ DENE
                    let marketAdi = market.marketName || market.market || market.depotName || market.storeName || market.merchantName || market.name;
                    
                    // Eğer API'den isim gelmediyse, resim linkinden bulmayı dene
                    if (!marketAdi || marketAdi.trim() === '') {
                        marketAdi = resimdenMarketBul(resim) || 'Bilinmeyen Market';
                    }

                    hamListe.push({
                        title: baslik,
                        price: market.price ? `${market.price} TL` : '0 TL',
                        market: marketAdi,
                        unitPrice: market.unitPrice ? `${market.unitPrice} TL/${market.unitName || 'Adet'}` : null,
                        link: `https://marketfiyati.org.tr/`,
                        kaynak: 'marketfiyati',
                        productImage: resim
                    });
                });
            } else {
                hamListe.push({
                    title: baslik,
                    price: item.price ? `${item.price} TL` : '0 TL',
                    market: resimdenMarketBul(resim) || item.marketName || item.market || 'Bilinmeyen Market',
                    unitPrice: null,
                    link: `https://marketfiyati.org.tr/`,
                    kaynak: 'marketfiyati',
                    productImage: resim
                });
            }
        });

        return hamListe;

    } catch (error) {
        console.error('❌ MarketFiyati API Hatası:', error.message);
        return [];
    }
}

const durum = { marketfiyati: { basarili: 0, hatali: 0 } };
const durumRapor = () => JSON.parse(JSON.stringify(durum));

async function karmaArama(arananUrun) {
    const hamListe = await marketFiyatiAra(arananUrun);
    if (hamListe.length === 0) return [];

    durum.marketfiyati.basarili++;
    return hamListe;
}

module.exports = { karmaArama, durumRapor };
