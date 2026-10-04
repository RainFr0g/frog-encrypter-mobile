import { describe, test, expect } from 'vitest';
import { CryptoService } from './CryptoService';
import { base64ToBytes, bytesToBase64 } from './mics';
import { SALT_SIZE, VECTOR_SIZE } from './constants';

// ==================== Basic roundtrips ====================
describe('CryptoService roundtrips', () => {
    test('empty string', async () => {
        const crypto = new CryptoService();
        const enc = await crypto.encryptToBase64('', 'pass', false);
        expect(await crypto.decryptToString(enc, 'pass', false)).toBe('');
    });

    test('ascii', async () => {
        const crypto = new CryptoService();
        const enc = await crypto.encryptToBase64('Hello, world!', 'pass', false);
        expect(await crypto.decryptToString(enc, 'pass', false)).toBe('Hello, world!');
    });

    test('unicode', async () => {
        const crypto = new CryptoService();
        const original = '🔒 Привет мир 🔑 秘密';
        const enc = await crypto.encryptToBase64(original, 'пароль', false);
        expect(await crypto.decryptToString(enc, 'пароль', false)).toBe(original);
    });

    test('100 KB', async () => {
        const crypto = new CryptoService();
        const original = 'x'.repeat(100_000);
        const enc = await crypto.encryptToBase64(original, 'pass', false);
        expect(await crypto.decryptToString(enc, 'pass', false)).toBe(original);
    });

    test('with compression', async () => {
        const crypto = new CryptoService();
        const original = 'a'.repeat(10_000);
        const enc = await crypto.encryptToBase64(original, 'pass', true);
        expect(await crypto.decryptToString(enc, 'pass', true)).toBe(original);
    });

    test('Uint8Array input', async () => {
        const crypto = new CryptoService();
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const enc = await crypto.encrypt(data, 'pass', false);
        expect(await crypto.decrypt(enc, 'pass', false)).toEqual(data);
    });

    test('decrypt of Uint8Array input (not base64)', async () => {
        const crypto = new CryptoService();
        const enc = await crypto.encrypt(new TextEncoder().encode('data'), 'pass', false);
        // decrypt accepts Uint8Array directly
        const plain = await crypto.decrypt(enc, 'pass', false);
        expect(new TextDecoder().decode(plain!)).toBe('data');
    });
});

// ==================== Errors ====================
describe('CryptoService error handling', () => {
    test('wrong password returns null', async () => {
        const crypto = new CryptoService();
        const enc = await crypto.encryptToBase64('secret', 'correct', false);
        expect(await crypto.decryptToString(enc, 'wrong', false)).toBeNull();
    });

    test('corrupted ciphertext returns null', async () => {
        const crypto = new CryptoService();
        const enc = await crypto.encryptToBase64('secret', 'pass', false);
        const bytes = base64ToBytes(enc);
        const last = bytes.length - 1;
        bytes[last] = (bytes[last] ?? 0) ^ 0xff;
        expect(await crypto.decryptToString(bytesToBase64(bytes), 'pass', false)).toBeNull();
    });

    test('truncated ciphertext returns null', async () => {
        const crypto = new CryptoService();
        const enc = await crypto.encryptToBase64('secret', 'pass', false);
        const truncated = base64ToBytes(enc).slice(0, 10);
        expect(await crypto.decryptToString(bytesToBase64(truncated), 'pass', false)).toBeNull();
    });
});

// ==================== IV uniqueness ====================
describe('CryptoService IV uniqueness', () => {
    test('same data encrypted twice → different ciphertext', async () => {
        const crypto = new CryptoService();
        const a = await crypto.encryptToBase64('same', 'pass', false);
        const b = await crypto.encryptToBase64('same', 'pass', false);
        expect(a).not.toBe(b);
    });

    test('cross-instance decrypt', async () => {
        const c1 = new CryptoService();
        const enc = await c1.encryptToBase64('data', 'pass', false);

        const c2 = new CryptoService();
        expect(await c2.decryptToString(enc, 'pass', false)).toBe('data');
    });

    test('compressed is smaller than uncompressed for repetitive data', async () => {
        const crypto = new CryptoService();
        const original = 'a'.repeat(100_000);
        const compressed = await crypto.encryptToBase64(original, 'pass', true);
        const uncompressed = await crypto.encryptToBase64(original, 'pass', false);
        expect(compressed.length).toBeLessThan(uncompressed.length);
    });
});

// ==================== Cache behavior ====================
describe('CryptoService cache', () => {
    test('getCurrentCache returns null initially', () => {
        const crypto = new CryptoService();
        expect(crypto.getCurrentCache()).toBeNull();
    });

    test('encrypt populates cache', async () => {
        const crypto = new CryptoService();
        await crypto.encryptToBase64('data', 'pwd', false);
        const cache = crypto.getCurrentCache();
        expect(cache).not.toBeNull();
        expect(cache!.password).toBe('pwd');
        expect(cache!.salt.length).toBe(SALT_SIZE);
    });

    test('decrypt populates cache with extracted salt', async () => {
        const c1 = new CryptoService();
        const enc = await c1.encryptToBase64('data', 'pwd', false);

        const bytes = base64ToBytes(enc);
        const expectedSalt = bytes.slice(VECTOR_SIZE, VECTOR_SIZE + SALT_SIZE);

        const c2 = new CryptoService();
        expect(c2.getCurrentCache()).toBeNull();
        await c2.decryptToString(enc, 'pwd', false);

        const cache = c2.getCurrentCache();
        expect(cache).not.toBeNull();
        expect(cache!.salt).toEqual(expectedSalt);
    });

    test('setCache manually overrides', () => {
        const crypto = new CryptoService();
        const salt = new Uint8Array(SALT_SIZE).fill(5);
        const fakeKey = {} as CryptoKey;
        crypto.setCache('manual', salt, fakeKey);

        const cache = crypto.getCurrentCache();
        expect(cache!.password).toBe('manual');
        expect(cache!.salt).toEqual(salt);
        expect(cache!.key).toBe(fakeKey);
    });

    test('encrypt with different password resets salt', async () => {
        const crypto = new CryptoService();
        await crypto.encryptToBase64('a', 'pwd1', false);
        const cache1 = crypto.getCurrentCache();

        await crypto.encryptToBase64('b', 'pwd2', false);
        const cache2 = crypto.getCurrentCache();

        expect(cache1!.salt).not.toEqual(cache2!.salt);
        expect(cache2!.password).toBe('pwd2');
    });

    test('encrypt with same password keeps same salt', async () => {
        const crypto = new CryptoService();
        await crypto.encryptToBase64('a', 'pwd', false);
        const cache1 = crypto.getCurrentCache();

        await crypto.encryptToBase64('b', 'pwd', false);
        const cache2 = crypto.getCurrentCache();

        expect(cache1!.salt).toEqual(cache2!.salt);
    });

    test('decrypt resets cache on failure', async () => {
        const crypto = new CryptoService();
        await crypto.encryptToBase64('data', 'correct', false);
        const enc = await crypto.encryptToBase64('data', 'wrong', false);

        // Cache is 'wrong' now, decrypt with 'correct' fails and resets
        await crypto.decryptToString(enc, 'correct', false);
        expect(crypto.getCurrentCache()).toBeNull();
    });
});