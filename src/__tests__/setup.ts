if (typeof globalThis.crypto === 'undefined') 
    throw new Error('Web Crypto API is not available. Node.js 20+ is required.');
