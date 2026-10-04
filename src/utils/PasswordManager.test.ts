import { describe, test, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { PasswordManager } from './PasswordManager';
import type { CryptoCache } from './types';

// ==================== Mock SettingsService ====================
vi.mock('../settings/SettingsService', () => ({
    SettingsService: {
        getRememberPasswords: vi.fn(() => true),
        getPasswordTtlMinutes: vi.fn(() => 5),
        getAutofillLastPassword: vi.fn(() => true),
    },
}));

import { SettingsService } from '../settings/SettingsService';

// ==================== Stub window ====================
beforeAll(() => {
    vi.stubGlobal('window', {
        setTimeout: (...args: unknown[]) =>
            (globalThis.setTimeout as (...a: unknown[]) => number)(...args),
        clearTimeout: (...args: unknown[]) =>
            globalThis.clearTimeout(...(args as [number | undefined])),
    });
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(SettingsService.getRememberPasswords).mockReturnValue(true);
    vi.mocked(SettingsService.getPasswordTtlMinutes).mockReturnValue(5);
    vi.mocked(SettingsService.getAutofillLastPassword).mockReturnValue(true);
    PasswordManager.init();
});

afterEach(() => {
    PasswordManager.unInit();
    vi.useRealTimers();
});

// ==================== addPassword / getAllActivePasswords ====================
describe('PasswordManager.addPassword', () => {
    test('adds password and returns it', () => {
        PasswordManager.addPassword('pwd1');
        expect(PasswordManager.getAllActivePasswords()).toContain('pwd1');
    });

    test('multiple passwords returned newest first', () => {
        PasswordManager.addPassword('first');
        PasswordManager.addPassword('second');
        PasswordManager.addPassword('third');
        expect(PasswordManager.getAllActivePasswords()).toEqual(['third', 'second', 'first']);
    });

    test('adding same password moves it to front', () => {
        PasswordManager.addPassword('a');
        PasswordManager.addPassword('b');
        PasswordManager.addPassword('a');
        expect(PasswordManager.getAllActivePasswords()[0]).toBe('a');
    });

    test('does nothing when rememberPasswords is off', () => {
        vi.mocked(SettingsService.getRememberPasswords).mockReturnValue(false);
        PasswordManager.addPassword('pwd');
        expect(PasswordManager.getAllActivePasswords()).toEqual([]);
    });
});

// ==================== TTL ====================
describe('PasswordManager TTL', () => {
    test('password persists before TTL', () => {
        PasswordManager.addPassword('pwd');
        vi.advanceTimersByTime(60_000);   // 1 min
        expect(PasswordManager.getAllActivePasswords()).toContain('pwd');
    });

    test('password expires after TTL', () => {
        PasswordManager.addPassword('pwd');
        vi.advanceTimersByTime(5 * 60 * 1000 + 1);
        expect(PasswordManager.getAllActivePasswords()).toEqual([]);
    });

    test('adding password refreshes TTL for same password', () => {
        PasswordManager.addPassword('pwd');
        vi.advanceTimersByTime(4 * 60 * 1000);   // 4 min
        PasswordManager.addPassword('pwd');       // refresh
        vi.advanceTimersByTime(4 * 60 * 1000);   // 4 more min
        expect(PasswordManager.getAllActivePasswords()).toContain('pwd');
    });
});

// ==================== clearPasswords ====================
describe('PasswordManager.clearPasswords', () => {
    test('clears all passwords', () => {
        PasswordManager.addPassword('pwd1');
        PasswordManager.addPassword('pwd2');
        PasswordManager.clearPasswords();
        expect(PasswordManager.getAllActivePasswords()).toEqual([]);
    });

    test('can add new passwords after clear', () => {
        PasswordManager.addPassword('old');
        PasswordManager.clearPasswords();
        PasswordManager.addPassword('new');
        expect(PasswordManager.getAllActivePasswords()).toEqual(['new']);
    });
});

// ==================== getLastPassword ====================
describe('PasswordManager.getLastPassword', () => {
    test('returns the last added', () => {
        PasswordManager.addPassword('first');
        PasswordManager.addPassword('last');
        expect(PasswordManager.getLastPassword()).toBe('last');
    });

    test('returns empty when autofill is off', () => {
        vi.mocked(SettingsService.getAutofillLastPassword).mockReturnValue(false);
        PasswordManager.addPassword('pwd');
        expect(PasswordManager.getLastPassword()).toBe('');
    });

    test('returns empty when no passwords', () => {
        expect(PasswordManager.getLastPassword()).toBe('');
    });
});

// ==================== cache ====================
describe('PasswordManager cache', () => {
    test('stores and retrieves crypto key by salt', () => {
        PasswordManager.addPassword('pwd');
        const salt = new Uint8Array(16).fill(42);
        const fakeKey = {} as CryptoKey;
        const cache: CryptoCache = { password: 'pwd', salt, key: fakeKey };
        PasswordManager.storeCache(cache);

        expect(PasswordManager.getCachedCryptoKey('pwd', salt)).toBe(fakeKey);
    });

    test('returns null for unknown password', () => {
        PasswordManager.addPassword('pwd');
        const salt = new Uint8Array(16).fill(42);
        expect(PasswordManager.getCachedCryptoKey('other', salt)).toBeNull();
    });

    test('returns null for unknown salt', () => {
        PasswordManager.addPassword('pwd');
        const salt1 = new Uint8Array(16).fill(1);
        const salt2 = new Uint8Array(16).fill(2);
        const fakeKey = {} as CryptoKey;
        PasswordManager.storeCache({ password: 'pwd', salt: salt1, key: fakeKey });
        expect(PasswordManager.getCachedCryptoKey('pwd', salt2)).toBeNull();
    });

    test('cache preserved across addPassword calls with same password', () => {
        PasswordManager.addPassword('pwd');
        const salt = new Uint8Array(16).fill(42);
        const fakeKey = {} as CryptoKey;
        PasswordManager.storeCache({ password: 'pwd', salt, key: fakeKey });

        PasswordManager.addPassword('pwd');
        expect(PasswordManager.getCachedCryptoKey('pwd', salt)).toBe(fakeKey);
    });

    test('storeCache does nothing when rememberPasswords is off', () => {
        PasswordManager.addPassword('pwd');
        vi.mocked(SettingsService.getRememberPasswords).mockReturnValue(false);

        const salt = new Uint8Array(16).fill(42);
        PasswordManager.storeCache({ password: 'pwd', salt, key: {} as CryptoKey });
        expect(PasswordManager.getCachedCryptoKey('pwd', salt)).toBeNull();
    });

    test('multiple salts per password stored independently', () => {
        PasswordManager.addPassword('pwd');
        const salt1 = new Uint8Array(16).fill(1);
        const salt2 = new Uint8Array(16).fill(2);
        const key1 = { id: 1 } as unknown as CryptoKey;
        const key2 = { id: 2 } as unknown as CryptoKey;

        PasswordManager.storeCache({ password: 'pwd', salt: salt1, key: key1 });
        PasswordManager.storeCache({ password: 'pwd', salt: salt2, key: key2 });

        expect(PasswordManager.getCachedCryptoKey('pwd', salt1)).toBe(key1);
        expect(PasswordManager.getCachedCryptoKey('pwd', salt2)).toBe(key2);
    });
});