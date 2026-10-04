import { PBKDF2_ITERATIONS } from './constants';
import { CryptoCache } from './types';

export default class CryptoEngine {
	private vectorSize: number;
	private saltSize: number;

	constructor(vectorSize: number, saltSize: number) {
		this.vectorSize = vectorSize;
		this.saltSize = saltSize;
	}

	public async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
		const encoder = new TextEncoder();
		const passwordBytes = encoder.encode(password);

		const baseKey = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey']);

		return await crypto.subtle.deriveKey(
			{
				name: 'PBKDF2',
				salt: new Uint8Array(salt),
				iterations: PBKDF2_ITERATIONS,
				hash: 'SHA-512',
			},
			baseKey,
			{ name: 'AES-GCM', length: 256 },
			false,
			['encrypt', 'decrypt']
		);
	}

	public async encrypt(data: Uint8Array, cryptoCache: CryptoCache): Promise<Uint8Array> {
		const vector = crypto.getRandomValues(new Uint8Array(this.vectorSize));
		const salt = cryptoCache.salt;
		const key = cryptoCache.key;

		const encryptedBuffer = await crypto.subtle.encrypt({name: 'AES-GCM', iv: vector}, key, data as BufferSource);

		const encryptedBytes = new Uint8Array(encryptedBuffer);
		const finalBytes = new Uint8Array(vector.length + salt.length + encryptedBytes.length);

		finalBytes.set(vector, 0);
		finalBytes.set(salt, vector.length);
		finalBytes.set(encryptedBytes, vector.length + salt.length);

		return finalBytes;
	}
	
	public async decrypt(encryptedBytes: Uint8Array, key: CryptoKey): Promise<Uint8Array | null> {
		try {
			const vector = encryptedBytes.slice(0, this.vectorSize);
			const encryptedTextBytes = encryptedBytes.slice(this.vectorSize + this.saltSize);
			
			const decryptedBuffer = await crypto.subtle.decrypt({name: 'AES-GCM', iv: vector}, key, encryptedTextBytes);

			return new Uint8Array(decryptedBuffer);
		} catch {
			return null;
		}
	}
}