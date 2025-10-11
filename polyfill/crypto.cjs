// Copy
// Sağlam polyfill: Node sürümün ne olursa olsun getRandomValues garanti.
try {
  const { randomFillSync, webcrypto } = require('node:crypto');

  // globalThis.crypto yoksa oluştur
  if (!globalThis.crypto) globalThis.crypto = {};

  // getRandomValues yoksa ekle (TypedArray zorunlu)
  if (typeof globalThis.crypto.getRandomValues !== 'function') {
    globalThis.crypto.getRandomValues = function getRandomValues(typedArray) {
      if (
        !typedArray ||
        typeof typedArray.length !== 'number' ||
        typedArray.BYTES_PER_ELEMENT === undefined
      ) {
        throw new TypeError('Expected an integer TypedArray');
      }
      return randomFillSync(typedArray);
    };
    // console.log('[polyfill-crypto] getRandomValues -> randomFillSync ile sağlandı');
  }

  // Bazı paketler crypto.subtle isteyebilir; varsa webcrypto.subtle'ı geçir
  if (!globalThis.crypto.subtle && webcrypto && webcrypto.subtle) {
    globalThis.crypto.subtle = webcrypto.subtle;
  }
} catch (err) {
  console.warn('[polyfill-crypto] polyfill yüklenemedi:', err && err.message);
}
