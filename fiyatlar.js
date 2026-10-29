const axios = require('axios');

async function marketFiyatiAra(arananUrun, lat, lon, distance = 15) {
    try {
        console.log(`🔎 [API] Aranıyor: "${arananUrun}" (Konum: ${lat}, ${lon}, Mesafe: ${distance}km)`);
        
        const response = await axios.post('https://api.marketfiyati.org.tr/api/v2/search', {
            keywords: arananUrun,
            latitude: lat,
            longitude: lon,
            distance: distance, 
            size: 50
        }, { timeout: 10000 });

        const icerik = response.data.content || [];
        console.log(`📊 [API] ${icerik.length} ham ürün bulundu.`);

        const hamListe = [];

        icerik.forEach(item => {
            const baslik = item.productName || item.title || 'Bilinmeyen Ürün';
            const resim = item.imageUrl || null;

            if (item.productDepotInfoList && item.productDepotInfoList.length > 0) {
                item.productDepotInfoList.forEach(market => {
                    let subeAdi = market.marketName || market.market || market.depotName || market.storeName || market.merchantName || market.name;
                    if (!subeAdi || subeAdi.trim() === '') {
                        const u = (resim || '').toLowerCase();
                        if (u.includes('migros')) subeAdi = 'Migros';
                        else if (u.includes('a101')) subeAdi = 'A101';
                        else if (u.includes('carrefour')) subeAdi = 'CarrefourSA';
                        else if (u.includes('bim')) subeAdi = 'BİM';
                        else if (u.includes('sok')) subeAdi = 'Şok';
                        else subeAdi = 'Bilinmeyen Şube';
                    }

                    hamListe.push({
                        title: baslik,
                        price: market.price ? `${market.price} TL` : '0 TL',
                        market: subeAdi, 
                        unitPrice: market.unitPrice ? `${market.unitPrice} TL/${market.unitName || 'Adet'}` : null,
                        link: `https://marketfiyati.org.tr/`,
                        kaynak: 'marketfiyati',
                        productImage: resim
                    });
                });
            } else {
                let subeAdi = item.marketName || item.market || 'Bilinmeyen Şube';
                hamListe.push({
                    title: baslik,
                    price: item.price ? `${item.price} TL` : '0 TL',
                    market: subeAdi,
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

async function karmaArama(arananUrun, lat, lon, distance) {
    const hamListe = await marketFiyatiAra(arananUrun, lat, lon, distance);
    if (hamListe.length === 0) return [];
    durum.marketfiyati.basarili++;
    return hamListe;
}

module.exports = { karmaArama, durumRapor };
