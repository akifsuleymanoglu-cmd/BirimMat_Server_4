// yardimcilar.js - Yardımcı Fonksiyonlar

function normalize(text) {
    return String(text == null ? '' : text)
        .replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase().replace(/\u0307/g, '')
        .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u')
        .replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[’‘`´]/g, "'");
}

// 🛠️ Market Logolarını Bulma Fonksiyonu
function marketLogoBul(marketAdi) {
    if (!marketAdi) return 'https://cdn-icons-png.flaticon.com/512/1170/1170678.png';
    const ad = normalize(marketAdi);
    
    // Clearbit Logo API kullanarak resmi logoları çekiyoruz
    if (ad.includes('migros')) return 'https://logo.clearbit.com/migros.com.tr';
    if (ad.includes('a101')) return 'https://logo.clearbit.com/a101.com.tr';
    if (ad.includes('sok') || ad.includes('şok')) return 'https://logo.clearbit.com/sokmarket.com.tr';
    if (ad.includes('bim')) return 'https://logo.clearbit.com/bim.com.tr';
    if (ad.includes('carrefour')) return 'https://logo.clearbit.com/carrefoursa.com';
    if (ad.includes('hakmar')) return 'https://logo.clearbit.com/hakmar.com.tr';
    if (ad.includes('tarim kredi') || ad.includes('tarım kredi')) return 'https://logo.clearbit.com/tarimkredi.org.tr';
    
    // Diğerleri için genel bir alışveriş sepeti ikonu döndür
    return 'https://cdn-icons-png.flaticon.com/512/1170/1170678.png'; 
}

module.exports = {
    normalize,
    marketLogoBul
};
