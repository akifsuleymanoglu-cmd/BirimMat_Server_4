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

        // 🛠️ API'den gelen veriyi esnek bir şekilde eşleştir (Hata payını sıfırlıyoruz)
        const hamListe = icerik.map(item => {
            return {
                title: item.productName || item.name || item.title || 'Bilinmeyen Ürün',
                price: item.price ? `${item.price} TL` : (item.fiyat ? `${item.fiyat} TL` : '0 TL'),
                market: item.marketName || item.market || 'Bilinmeyen Market',
                link: `https://marketfiyati.org.tr/`,
                unitPrice: item.unitPrice ? `${item.unitPrice} TL/${item.unitName || 'Adet'}` : null,
                kaynak: 'marketfiyati',
                productImage: item.imageUrl || item.image || null 
            };
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
    // Doğrudan API'ye gidip geleni döndürüyoruz, arada filtre yok.
    const hamListe = await marketFiyatiAra(arananUrun);
    if (hamListe.length === 0) return [];

    durum.marketfiyati.basarili++;
    return hamListe;
}

module.exports = { karmaArama, durumRapor };
