import { deflate, inflate } from 'pako';
import { CryptoCache } from './types';
import CryptoEngine from './CryptoEngine';
import { VECTOR_SIZE, SALT_SIZE } from './constants';
import { base64ToBytes, bytesEquals, bytesToBase64 } from './misc';

export class CryptoService {
	private engine: CryptoEngine;
	private cryptoCache: CryptoCache | null = null;

	constructor() {
		this.engine = new CryptoEngine(VECTOR_SIZE, SALT_SIZE);
	}

	public async encrypt(data: string | Uint8Array, password: string, withCompression: boolean): Promise<Uint8Array> {
		let byteData = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
		if(withCompression)
			byteData = deflate(byteData);

		if(!this.cryptoCache || this.cryptoCache.password !== password) 
			this.cryptoCache = await this.getNewCache(password);
		
		const encryptedData = await this.engine.encrypt(byteData, this.cryptoCache);
		return encryptedData;
	}

	public async encryptToBase64(data: string, password: string, withCompression: boolean): Promise<string> {
		const encryptedData = await this.encrypt(data, password, withCompression);
		const encryptedBase64 = bytesToBase64(encryptedData);

		return encryptedBase64;
	}

	public async decrypt(cipher: Uint8Array, password: string, isCompressed: boolean): Promise<Uint8Array | null> {
		if (cipher.length < VECTOR_SIZE + SALT_SIZE + 16) 
    		return null;

		const salt = cipher.slice(VECTOR_SIZE, VECTOR_SIZE + SALT_SIZE);

		if(!this.cryptoCache || this.cryptoCache.password !== password || !bytesEquals(this.cryptoCache.salt, salt)) 
			this.cryptoCache = await this.getNewCache(password, salt);
		
		let decryptedData = await this.engine.decrypt(cipher, this.cryptoCache.key);
		if (!decryptedData) {
			this.cryptoCache = null; 
			return null;
		}
		
		if (isCompressed) {
			try {
				decryptedData = inflate(decryptedData);
			} catch {
				this.cryptoCache = null;
				return null;
			}
		}

		return decryptedData;
	}
	
	public async decryptToString(cipher: string | Uint8Array, password: string, isCompressed: boolean): Promise<string | null> {
		const cipherBytes = cipher instanceof Uint8Array ? cipher : base64ToBytes(cipher);
		const decryptedData = await this.decrypt(cipherBytes, password, isCompressed);
		if (!decryptedData) 
			return null;

		const decryptedString = new TextDecoder().decode(decryptedData);
		return decryptedString;
	}

	private async getNewCache(password: string, oldSalt?: Uint8Array): Promise<CryptoCache> {

		const salt = oldSalt || crypto.getRandomValues(new Uint8Array(SALT_SIZE));
		const key = await this.engine.deriveKey(password, salt);
		const newCache: CryptoCache = { password, salt, key};

		return newCache;
	}

	public setCache(password: string, salt: Uint8Array, key: CryptoKey): void{
		this.cryptoCache =  {password, salt, key};
	}
	public getCurrentCache(): CryptoCache | null {
		return this.cryptoCache;
	}
}