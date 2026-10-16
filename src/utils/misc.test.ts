import { describe, test, expect } from 'vitest';
import {
    bytesToBase64,
    base64ToBytes,
    encodeHint,
    decodeHint,
    truncateUtf8,
    isValidBase64,
    bytesEquals,
    formatBytes,
    safeEndIndex,
    getTimeStamp,
} from './misc';
import { HINT_MAX_BYTES } from './constants';

// ==================== base64 ====================
describe('base64 roundtrip', () => {
    test('empty buffer', () => {
        const original = new Uint8Array(0);
        expect(base64ToBytes(bytesToBase64(original))).toEqual(original);
    });

    test('all lengths 1..256', () => {
        for (let len = 1; len <= 256; len++) {
            const original = new Uint8Array(len);
            for (let i = 0; i < len; i++) original[i] = (i * 31 + 7) % 256;
            expect(base64ToBytes(bytesToBase64(original))).toEqual(original);
        }
    });

    test('large random buffer (100 KB)', () => {
        const original = new Uint8Array(100_000);
        for (let i = 0; i < original.length; i += 65_536) {
            const chunk = new Uint8Array(Math.min(65_536, original.length - i));
            crypto.getRandomValues(chunk);
            original.set(chunk, i);
        }
        expect(base64ToBytes(bytesToBase64(original))).toEqual(original);
    });

    test('bytesToBase64 never produces padding "="', () => {
        for (let len = 0; len < 100; len++) {
            const bytes = new Uint8Array(len);
            expect(bytesToBase64(bytes)).not.toContain('=');
        }
    });
});

// ==================== hints ====================
describe('encodeHint / decodeHint', () => {
    test('empty roundtrips to empty', () => {
        expect(encodeHint('')).toBe('');
        expect(decodeHint('')).toBe('');
    });

    test('simple ascii', () => {
        expect(decodeHint(encodeHint('my hint'))).toBe('my hint');
    });

    test('cyrillic', () => {
        expect(decodeHint(encodeHint('подсказка'))).toBe('подсказка');
    });

    test('emoji', () => {
        expect(decodeHint(encodeHint('🔑 key 🔒'))).toBe('🔑 key 🔒');
    });

    test('long hint truncated to HINT_MAX_BYTES', () => {
        const long = 'a'.repeat(HINT_MAX_BYTES + 100);
        const decoded = decodeHint(encodeHint(long));
        expect(decoded.length).toBe(HINT_MAX_BYTES);
    });

    test('corrupted base64 → empty', () => {
        expect(decodeHint('!!!not-base64!!!')).toBe('');
    });

    test('invalid payload → empty', () => {
        expect(decodeHint('AAAA')).toBe('');
    });

    test('flipped hash byte → empty', () => {
        const encoded = encodeHint('test');
        const bytes = base64ToBytes(encoded);
        bytes[1] = (bytes[1] ?? 0) ^ 0xff;
        expect(decodeHint(bytesToBase64(bytes))).toBe('');
    });
});

// ==================== validation ====================
describe('isValidBase64', () => {
    test('valid base64 without padding', () => {
        expect(isValidBase64('SGVsbG8')).toBe(true);
        expect(isValidBase64('AAAA')).toBe(true);
        expect(isValidBase64('AQAB')).toBe(true);
    });

    test('empty is invalid', () => {
        expect(isValidBase64('')).toBe(false);
    });

    test('padding "=" rejected (our format has none)', () => {
        expect(isValidBase64('SGVsbG8=')).toBe(false);
    });

    test('invalid characters rejected', () => {
        expect(isValidBase64('Hello!')).toBe(false);
        expect(isValidBase64('🔒')).toBe(false);
    });

    test('whitespace is normalized', () => {
        expect(isValidBase64('SGVs bG8')).toBe(true);
    });

    test('bytesToBase64 output always passes isValidBase64 (non-empty)', () => {
        for (let len = 1; len < 200; len++) {
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) bytes[i] = i % 256;
            expect(isValidBase64(bytesToBase64(bytes))).toBe(true);
        }
    });
});

// ==================== safeEndIndex ====================
describe('safeEndIndex', () => {
    test('does not split surrogate pairs', () => {
        const text = 'aaaa🔒bbbb';   // 🔒 at 4-5
        expect(safeEndIndex(text, 5)).toBe(6);
    });

    test('returns end when no surrogate', () => {
        expect(safeEndIndex('abcdef', 3)).toBe(3);
    });

    test('clamps to length', () => {
        expect(safeEndIndex('abc', 100)).toBe(3);
    });

    test('zero returns zero', () => {
        expect(safeEndIndex('abc', 0)).toBe(0);
    });

    test('end at last position', () => {
        expect(safeEndIndex('abc', 3)).toBe(3);
    });
});

// ==================== truncateUtf8 ====================
describe('truncateUtf8', () => {
    test('short input unchanged', () => {
        const bytes = new TextEncoder().encode('hello');
        expect(truncateUtf8(bytes, 100)).toEqual(bytes);
    });

    test('ascii truncation to max', () => {
        const bytes = new TextEncoder().encode('a'.repeat(300));
        expect(truncateUtf8(bytes, 255).length).toBe(255);
    });

    test('does not split multi-byte utf8 sequence', () => {
        const bytes = new TextEncoder().encode('привет мир');
        expect(truncateUtf8(bytes, 5).length).toBe(4);
    });

    test('zero max returns empty', () => {
        const bytes = new TextEncoder().encode('hello');
        expect(truncateUtf8(bytes, 0).length).toBe(0);
    });
});

// ==================== formatBytes ====================
describe('formatBytes', () => {
    test('formats units correctly', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(1023)).toBe('1023 B');
        expect(formatBytes(1024)).toBe('1.0 KB');
        expect(formatBytes(1536)).toBe('1.5 KB');
        expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
        expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    });
});

// ==================== bytesEquals ====================
describe('bytesEquals', () => {
    test('equal arrays', () => {
        expect(bytesEquals(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    });

    test('different content', () => {
        expect(bytesEquals(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    });

    test('different length', () => {
        expect(bytesEquals(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    });

    test('nulls are not equal', () => {
        expect(bytesEquals(null, null)).toBe(false);
        expect(bytesEquals(null, new Uint8Array())).toBe(false);
        expect(bytesEquals(new Uint8Array(), null)).toBe(false);
    });

    test('empty arrays are equal', () => {
        expect(bytesEquals(new Uint8Array(), new Uint8Array())).toBe(true);
    });
});

// ==================== getTimeStamp ====================
describe('getTimeStamp', () => {
    test('matches YYYY-MM-DDTHH-MM-SS format', () => {
        expect(getTimeStamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
    });

    test('has no forbidden filesystem characters', () => {
        const ts = getTimeStamp();
        expect(ts).not.toContain(':');
        expect(ts).not.toContain('.');
    });
});