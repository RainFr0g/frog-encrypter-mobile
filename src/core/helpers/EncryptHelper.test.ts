import { describe, test, expect, vi, beforeEach } from 'vitest';

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
vi.mock('obsidian', () => ({
    Notice: class {
        constructor(public message: string, public timeout?: number) {}
        hide() {}
        setMessage(msg: string) { this.message = msg; }
    }
}));

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
import { buildEncryptedNote, decryptNoteCipher, shouldCompress } from './EncryptHelper';
import { CryptoService } from '../../utils/CryptoService';
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