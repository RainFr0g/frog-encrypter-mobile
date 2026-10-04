import { describe, test, expect, vi, beforeEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// ==================== Controllable settings state ====================
type SettingsState = {
    mode: 'always' | 'never' | 'by_extension';
    extensions: Map<string, boolean>;
};

const settingsState: SettingsState = vi.hoisted(() => ({
    mode: 'never',
    extensions: new Map<string, boolean>(),
}));

// ==================== Mocks ====================
vi.mock('../../utils/StorageService', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    return { StorageService: { fs, path } };
});

vi.mock('../../settings/SettingsService', () => ({
    SettingsService: {
        getCompressionMode: () => settingsState.mode,
        getCompressibleExtensions: () => settingsState.extensions,
        addCompressibleExtension: (ext: string, val: boolean) => {
            settingsState.extensions.set(ext, val);
            return Promise.resolve();
        },
    },
}));

vi.mock('../../utils/PasswordManager', () => ({
    PasswordManager: {
        storeCache: () => { /* no-op */ },
    },
}));

// ==================== Imports (after mocks) ====================
import {
    buildEncryptedNote,
    decryptNoteCipher,
    getJsonFooterFromBinary,
    shouldCompress,
} from './EncryptHelper';
import { CryptoService } from '../../utils/CryptoService';
import { StorageService } from '../../utils/StorageService';
import { OTHER_EXTENSIONS } from '../../utils/constants';
import type { EncryptedNote } from '../../utils/types';

beforeEach(() => {
    settingsState.mode = 'never';
    settingsState.extensions.clear();
});

// ==================== shouldCompress ====================
describe('shouldCompress', () => {
    test('"always" mode returns true regardless of extension', () => {
        settingsState.mode = 'always';
        expect(shouldCompress('txt')).toBe(true);
        expect(shouldCompress('png')).toBe(true);
        expect(shouldCompress('unknown')).toBe(true);
    });

    test('"never" mode returns false regardless of extension', () => {
        settingsState.mode = 'never';
        expect(shouldCompress('txt')).toBe(false);
        expect(shouldCompress('png')).toBe(false);
        expect(shouldCompress('unknown')).toBe(false);
    });

    test('by_extension uses known extension value', () => {
        settingsState.mode = 'by_extension';
        settingsState.extensions.set('txt', true);
        settingsState.extensions.set('png', false);
        expect(shouldCompress('txt')).toBe(true);
        expect(shouldCompress('png')).toBe(false);
    });

    test('by_extension falls back to OTHER_EXTENSIONS for unknown', () => {
        settingsState.mode = 'by_extension';
        settingsState.extensions.set(OTHER_EXTENSIONS, true);
        expect(shouldCompress('unknown')).toBe(true);

        settingsState.extensions.set(OTHER_EXTENSIONS, false);
        expect(shouldCompress('unknown')).toBe(false);
    });

    test('by_extension defaults to true and registers OTHER_EXTENSIONS', () => {
        settingsState.mode = 'by_extension';
        expect(shouldCompress('unknown')).toBe(true);
        expect(settingsState.extensions.get(OTHER_EXTENSIONS)).toBe(true);
    });

    test('extension lookup is case-insensitive and trimmed', () => {
        settingsState.mode = 'by_extension';
        settingsState.extensions.set('png', false);
        expect(shouldCompress('PNG')).toBe(false);
        expect(shouldCompress(' png ')).toBe(false);
        expect(shouldCompress('Png')).toBe(false);
    });
});

// ==================== buildEncryptedNote / decryptNoteCipher ====================
describe('buildEncryptedNote / decryptNoteCipher', () => {
    test('roundtrip small content', async () => {
        const crypto = new CryptoService();
        const json = await buildEncryptedNote(crypto, 'Hello, world!', 'pass', 'hint', 'md');
        const note = JSON.parse(json) as EncryptedNote;

        const crypto2 = new CryptoService();
        expect(await decryptNoteCipher(crypto2, note.cipherList, 'pass', note.isCompressed))
            .toBe('Hello, world!');
    });

    test('roundtrip empty content', async () => {
        const crypto = new CryptoService();
        const json = await buildEncryptedNote(crypto, '', 'pass', '', 'md');
        const note = JSON.parse(json) as EncryptedNote;

        const crypto2 = new CryptoService();
        expect(await decryptNoteCipher(crypto2, note.cipherList, 'pass', note.isCompressed)).toBe('');
    });

    test('roundtrip unicode', async () => {
        const crypto = new CryptoService();
        const content = '🔒 Secret Секрет 🔑 秘密';
        const json = await buildEncryptedNote(crypto, content, 'pass', 'hint', 'md');
        const note = JSON.parse(json) as EncryptedNote;

        const crypto2 = new CryptoService();
        expect(await decryptNoteCipher(crypto2, note.cipherList, 'pass', note.isCompressed))
            .toBe(content);
    });

    test('multi-chunk content splits into multiple cipherList entries', async () => {
        const crypto = new CryptoService();
        const content = 'x'.repeat(10_000_000);
        const json = await buildEncryptedNote(crypto, content, 'pass', '', 'txt');
        const note = JSON.parse(json) as EncryptedNote;

        expect(note.cipherList.length).toBeGreaterThan(1);

        const crypto2 = new CryptoService();
        expect(await decryptNoteCipher(crypto2, note.cipherList, 'pass', note.isCompressed))
            .toBe(content);
    }, 30_000);

    test('wrong password returns null', async () => {
        const crypto = new CryptoService();
        const json = await buildEncryptedNote(crypto, 'secret', 'correct', '', 'md');
        const note = JSON.parse(json) as EncryptedNote;

        const crypto2 = new CryptoService();
        expect(await decryptNoteCipher(crypto2, note.cipherList, 'wrong', note.isCompressed))
            .toBeNull();
    });

    test('hint is preserved in output JSON', async () => {
        const crypto = new CryptoService();
        const json = await buildEncryptedNote(crypto, 'data', 'pass', 'my hint', 'md');
        const note = JSON.parse(json) as EncryptedNote;
        expect(note.hint).toBe('my hint');
    });

    test('extension is encrypted (not plaintext)', async () => {
        const crypto = new CryptoService();
        const json = await buildEncryptedNote(crypto, 'data', 'pass', '', 'md');
        const note = JSON.parse(json) as EncryptedNote;
        expect(note.extension).not.toBe('md');
        expect(note.extension.length).toBeGreaterThan(0);
    });
});

// ==================== getJsonFooterFromBinary ====================
describe('getJsonFooterFromBinary', () => {
    function writeTestFile(prefix: Uint8Array, footer: object): string {
        const path = join(tmpdir(), `frog-test-${randomUUID()}.bin`);
        const footerBytes = new TextEncoder().encode(JSON.stringify(footer));
        const sizeBuf = new Uint8Array(4);
        new DataView(sizeBuf.buffer).setUint32(0, footerBytes.length, true);

        const combined = new Uint8Array(prefix.length + footerBytes.length + 4);
        combined.set(prefix, 0);
        combined.set(footerBytes, prefix.length);
        combined.set(sizeBuf, prefix.length + footerBytes.length);

        StorageService.fs.writeFileSync(path, Buffer.from(combined));
        return path;
    }

    test('reads valid footer', () => {
        const footer = { hint: 'test', isCompressed: false, extension: 'abc', chunkSizes: [1, 2, 3] };
        const path = writeTestFile(new Uint8Array([1, 2, 3, 4, 5]), footer);
        try {
            expect(getJsonFooterFromBinary<typeof footer>(path)).toEqual(footer);
        } finally {
            StorageService.fs.unlinkSync(path);
        }
    });

    test('reads footer from empty prefix', () => {
        const footer = { only: 'footer' };
        const path = writeTestFile(new Uint8Array(0), footer);
        try {
            expect(getJsonFooterFromBinary<typeof footer>(path)).toEqual(footer);
        } finally {
            StorageService.fs.unlinkSync(path);
        }
    });

    test('returns null for file < 4 bytes', () => {
        const path = join(tmpdir(), `frog-test-tiny-${randomUUID()}.bin`);
        StorageService.fs.writeFileSync(path, Buffer.from([0x00, 0x01]));
        try {
            expect(getJsonFooterFromBinary(path)).toBeNull();
        } finally {
            StorageService.fs.unlinkSync(path);
        }
    });

    test('returns null for invalid JSON footer', () => {
        const path = join(tmpdir(), `frog-test-bad-${randomUUID()}.bin`);
        const badJson = new TextEncoder().encode('not-json-at-all');
        const sizeBuf = new Uint8Array(4);
        new DataView(sizeBuf.buffer).setUint32(0, badJson.length, true);
        StorageService.fs.writeFileSync(path, Buffer.concat([Buffer.from(badJson), Buffer.from(sizeBuf)]));
        try {
            expect(getJsonFooterFromBinary(path)).toBeNull();
        } finally {
            StorageService.fs.unlinkSync(path);
        }
    });

    test('returns null when jsonSize exceeds file size', () => {
        const path = join(tmpdir(), `frog-test-huge-${randomUUID()}.bin`);
        const sizeBuf = new Uint8Array(4);
        // claim footer is 1 MB, but file is only 4 bytes
        new DataView(sizeBuf.buffer).setUint32(0, 1_000_000, true);
        StorageService.fs.writeFileSync(path, Buffer.from(sizeBuf));
        try {
            expect(getJsonFooterFromBinary(path)).toBeNull();
        } finally {
            StorageService.fs.unlinkSync(path);
        }
    });
});