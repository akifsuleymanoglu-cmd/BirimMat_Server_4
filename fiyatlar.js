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

        // API'den gelen her bir ürünü döngüye al
        icerik.forEach(item => {
            const baslik = item.productName || item.title || 'Bilinmeyen Ürün';
            const resim = item.imageUrl || null;

            // 🛠️ API'de fiyatlar ve marketler 'productDepotInfoList' içinde gelir
            if (item.productDepotInfoList && item.productDepotInfoList.length > 0) {
                item.productDepotInfoList.forEach(market => {
                    hamListe.push({
                        title: baslik,
                        price: market.price ? `${market.price} TL` : '0 TL',
                        market: market.marketName || market.market || 'Bilinmeyen Market',
                        unitPrice: market.unitPrice ? `${market.unitPrice} TL/${market.unitName || 'Adet'}` : null,
                        link: `https://marketfiyati.org.tr/`,
                        kaynak: 'marketfiyati',
                        productImage: resim
                    });
                });
            } else {
                // Eğer iç içe liste yoksa (nadiren de olsa), eski yöntemle dene
                hamListe.push({
                    title: baslik,
                    price: item.price ? `${item.price} TL` : '0 TL',
                    market: item.marketName || item.market || 'Bilinmeyen Market',
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
