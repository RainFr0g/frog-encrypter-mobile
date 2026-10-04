import { SettingsService } from '../settings/SettingsService';
import { CryptoCache } from './types';

interface PasswordEntry {
	expiresAt: number;
	caches: Map<string, CryptoKey>; 		
}

export class PasswordManager {
	private static passwords: Map<string, PasswordEntry> | null = null;
	private static mainWindow: Window | null = null;
	private static activeTimeoutId: number | null = null;

	public static init(): void {
		this.passwords = new Map<string, PasswordEntry>();
		this.mainWindow = window;
	}

	public static getCachedCryptoKey(password: string, salt:  Uint8Array): CryptoKey | null {
		if (!SettingsService.getRememberPasswords() || !this.passwords)
			return null;

		const entry = this.passwords.get(password);
		if (!entry) 
			return null;

		const saltHex = this.saltToHex(salt);
		return entry.caches.get(saltHex) ?? null;
	}

	public static storeCache(cache: CryptoCache): void {
		if (!SettingsService.getRememberPasswords() || !this.passwords)
			return;
		
		const entry = this.passwords.get(cache.password);
		if(!entry)
			return;

		const saltHex = this.saltToHex(cache.salt);
		entry.caches.set(saltHex, cache.key);
	}

	private static saltToHex(salt: Uint8Array): string {
		return Array.from(salt, b => b.toString(16).padStart(2, '0')).join('');
	}

	public static addPassword(password: string): void {
		if (!SettingsService.getRememberPasswords() || !this.passwords)
			return;

		const ttlMs = SettingsService.getPasswordTtlMinutes() * 60 * 1000;
		const expiresAt = Date.now() + ttlMs;

		const existing = this.passwords.get(password);
		if (existing) 
			this.passwords.delete(password);

		this.passwords.set(password, {
			expiresAt,
			caches: existing?.caches ?? new Map<string, CryptoKey>()
		});
		this.rearrangeScheduler();
	}

	public static getLastPassword(): string {
		if (!this.passwords || this.passwords.size === 0 ||	!SettingsService.getAutofillLastPassword())
			return '';

		if (this.removeExpiredPasswords()) 
			this.rearrangeScheduler();

		if (this.passwords.size === 0) 
			return '';

		const lastPassword = [...this.passwords.keys()].pop();
		return lastPassword ?? '';
	}

	public static getAllActivePasswords(): string[] {
		if (!this.passwords || this.passwords.size === 0) 
			return [];
		
		if (this.removeExpiredPasswords()) 
			this.rearrangeScheduler();

		return [...this.passwords.keys()].reverse();
	}

	public static rearrangeExpireTime(): void {
		if (!this.passwords || this.passwords.size === 0) 
			return;

		const newExpireTime = Date.now() + SettingsService.getPasswordTtlMinutes() * 60 * 1000;

		for (const value of this.passwords.values()) 
			if (value.expiresAt > newExpireTime) 
				value.expiresAt = newExpireTime;
		
		this.rearrangeScheduler();
	}

	private static removeExpiredPasswords(): boolean {
		if (!this.passwords || this.passwords.size === 0) 
			return false;

		const now = Date.now();
		let hasExpired = false;

		for (const [password, value] of this.passwords) {
			if(now < value.expiresAt)
				break;

			this.passwords.delete(password);
			hasExpired = true;
		}
		return hasExpired;
	}

	private static rearrangeScheduler(): void {
		if (!this.passwords || !this.mainWindow) 
			return;

		if (this.activeTimeoutId !== null) {
			this.mainWindow.clearTimeout(this.activeTimeoutId);
			this.activeTimeoutId = null;
		}
		
		if (this.passwords.size === 0) 
			return;

		this.removeExpiredPasswords();
		if (this.passwords.size === 0) 
			return;

		const firstEntry = this.passwords.entries().next();
		if (firstEntry.done) 
			return;

		const [, firstEntryValue] = firstEntry.value;

		const delay = Math.max(0, firstEntryValue.expiresAt - Date.now());
		this.activeTimeoutId = this.mainWindow.setTimeout(() => {
			this.rearrangeScheduler();
		}, delay);
	}

	public static clearPasswords(): void {
		if (!this.passwords) 
			return;

		this.passwords.clear();
		this.rearrangeScheduler();
	}

	public static unInit(): void {
		if (this.activeTimeoutId !== null && this.mainWindow) {
			this.mainWindow.clearTimeout(this.activeTimeoutId);
			this.activeTimeoutId = null;
		}

		if (this.passwords) 
			this.passwords.clear();

		this.passwords = null;
		this.mainWindow = null;
	}
}