import { describe, test, expect } from 'vitest';
import CryptoEngine from './CryptoEngine';
import { SALT_SIZE, VECTOR_SIZE } from './constants';
import type { CryptoCache } from './types';

const engine = new CryptoEngine(VECTOR_SIZE, SALT_SIZE);

async function makeCache(password: string, salt?: Uint8Array): Promise<CryptoCache> {
    const s = salt ?? crypto.getRandomValues(new Uint8Array(SALT_SIZE));
    const key = await engine.deriveKey(password, s);
    return { password, salt: s, key };
}

// ==================== deriveKey ====================
describe('CryptoEngine.deriveKey', () => {
    test('same password + salt produce functionally identical keys', async () => {
        const salt = new Uint8Array(SALT_SIZE).fill(7);
        const key1 = await engine.deriveKey('pwd', salt);
        const key2 = await engine.deriveKey('pwd', salt);

        const data = new TextEncoder().encode('hello');
        const iv = crypto.getRandomValues(new Uint8Array(VECTOR_SIZE));
        const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key1, data);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key2, cipher);
        expect(new TextDecoder().decode(plain)).toBe('hello');
    });

    test('different passwords produce incompatible keys', async () => {
        const salt = new Uint8Array(SALT_SIZE).fill(7);
        const key1 = await engine.deriveKey('pwd1', salt);
        const key2 = await engine.deriveKey('pwd2', salt);

        const data = new TextEncoder().encode('hello');
        const iv = crypto.getRandomValues(new Uint8Array(VECTOR_SIZE));
        const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key1, data);

        await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key2, cipher))
            .rejects.toThrow();
    });

    test('different salts produce incompatible keys', async () => {
        const salt1 = new Uint8Array(SALT_SIZE).fill(1);
        const salt2 = new Uint8Array(SALT_SIZE).fill(2);
        const key1 = await engine.deriveKey('pwd', salt1);
        const key2 = await engine.deriveKey('pwd', salt2);

        const data = new TextEncoder().encode('hello');
        const iv = crypto.getRandomValues(new Uint8Array(VECTOR_SIZE));
        const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key1, data);

        await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key2, cipher))
            .rejects.toThrow();
    });

    test('unicode password works', async () => {
        const salt = new Uint8Array(SALT_SIZE).fill(3);
        const key = await engine.deriveKey('🔑 пароль 秘密', salt);
        expect(key).toBeDefined();
    });

    test('empty password works', async () => {
        const salt = new Uint8Array(SALT_SIZE).fill(3);
        const key = await engine.deriveKey('', salt);
        expect(key).toBeDefined();
    });

    test('very long password works', async () => {
        const salt = new Uint8Array(SALT_SIZE).fill(3);
        const key = await engine.deriveKey('a'.repeat(10_000), salt);
        expect(key).toBeDefined();
    });
});

// ==================== encrypt / decrypt ====================
describe('CryptoEngine.encrypt / decrypt', () => {
    test('roundtrip', async () => {
        const cache = await makeCache('pwd');
        const data = new TextEncoder().encode('hello world');
        const cipher = await engine.encrypt(data, cache);
        const plain = await engine.decrypt(cipher, cache.key);
        expect(plain).toEqual(data);
    });

    test('output structure = [vector 12][salt 16][ciphertext + tag 16]', async () => {
        const cache = await makeCache('pwd');
        const data = new TextEncoder().encode('hello');
        const cipher = await engine.encrypt(data, cache);

        expect(cipher.length).toBe(VECTOR_SIZE + SALT_SIZE + data.length + 16);
        expect(cipher.slice(VECTOR_SIZE, VECTOR_SIZE + SALT_SIZE)).toEqual(cache.salt);
    });

    test('each encryption uses unique IV', async () => {
        const cache = await makeCache('pwd');
        const data = new TextEncoder().encode('same');
        const c1 = await engine.encrypt(data, cache);
        const c2 = await engine.encrypt(data, cache);

        expect(c1).not.toEqual(c2);
        const iv1 = c1.slice(0, VECTOR_SIZE);
        const iv2 = c2.slice(0, VECTOR_SIZE);
        expect(iv1).not.toEqual(iv2);
    });

    test('empty data roundtrip', async () => {
        const cache = await makeCache('pwd');
        const cipher = await engine.encrypt(new Uint8Array(0), cache);
        const plain = await engine.decrypt(cipher, cache.key);
        expect(plain).toEqual(new Uint8Array(0));
    });

    test('decrypt with wrong key returns null', async () => {
        const c1 = await makeCache('pwd1');
        const c2 = await makeCache('pwd2');
        const cipher = await engine.encrypt(new TextEncoder().encode('secret'), c1);
        expect(await engine.decrypt(cipher, c2.key)).toBeNull();
    });

    test('decrypt corrupted ciphertext returns null', async () => {
        const cache = await makeCache('pwd');
        const cipher = await engine.encrypt(new TextEncoder().encode('hello'), cache);
        const last = cipher.length - 1;
        cipher[last] = (cipher[last] ?? 0) ^ 0xff;
        expect(await engine.decrypt(cipher, cache.key)).toBeNull();
    });

    test('decrypt truncated data (only vector) returns null', async () => {
        const cache = await makeCache('pwd');
        const tiny = new Uint8Array(VECTOR_SIZE);
        expect(await engine.decrypt(tiny, cache.key)).toBeNull();
    });

    test('large data (1 MB) roundtrip', async () => {
        const cache = await makeCache('pwd');
        const data = new Uint8Array(1_000_000);
        for (let i = 0; i < data.length; i += 65_536) {
            const chunk = new Uint8Array(Math.min(65_536, data.length - i));
            crypto.getRandomValues(chunk);
            data.set(chunk, i);
        }
        const cipher = await engine.encrypt(data, cache);
        const plain = await engine.decrypt(cipher, cache.key);
        expect(plain).toEqual(data);
    }, 30_000);
});