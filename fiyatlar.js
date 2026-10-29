// fiyatlar.js - TÜBİTAK Market Fiyatı API'sini kullanan motor
const axios = require('axios');
const { esnekAlakaFiltresi, cekirdekSorgu, sirala, topluPaketMi, birimFiyatHesapla } = require('./yardimcilar');

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
        
        const hamListe = icerik.map(item => ({
            title: item.productName,
            price: item.price ? `${item.price} TL` : '0 TL',
            market: item.marketName || 'Bilinmeyen Market',
            link: `https://marketfiyati.org.tr/`,
            unitPrice: item.unitPrice ? `${item.unitPrice} TL/${item.unitName}` : null,
            kaynak: 'marketfiyati',
            productImage: item.imageUrl || item.productImage || item.image || null 
        }));

        console.log(`📊 [API] ${hamListe.length} ham ürün bulundu.`);
        return hamListe;

    } catch (error) {
        console.error('❌ MarketFiyati API Hatası:', error.message);
        return [];
    }
}

const durum = { marketfiyati: { basarili: 0, hatali: 0 } };
const durumRapor = () => JSON.parse(JSON.stringify(durum));

async function karmaArama(arananUrun) {
    const zaman = new Date().toISOString();
    const hamListe = await marketFiyatiAra(arananUrun);
    if (hamListe.length === 0) return [];

    durum.marketfiyati.basarili++;
    
    const sonuclar = hamListe.filter((i) => i && i.title && i.price).map((i) => ({
        ...i,
        isBulk: typeof i.isBulk === 'boolean' ? i.isBulk : topluPaketMi(i.title),
        unitPrice: i.unitPrice || birimFiyatHesapla(i.title, i.price) || null,
        storeIcon: '🛒',
        link: i.link || '#',
        guncelleme: i.guncelleme || zaman
    }));

    return sonuclar;
}

module.exports = { karmaArama, durumRapor };