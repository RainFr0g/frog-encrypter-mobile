import { CryptoService } from '../../utils/CryptoService';
import { EncryptedNote } from '../../utils/types';
import { CHUNK_SIZE, JSON_SIZE_BYTES, OTHER_EXTENSIONS, SALT_SIZE, VECTOR_SIZE } from '../../utils/constants';
import { SettingsService } from '../../settings/SettingsService';
import { PasswordManager } from '../../utils/PasswordManager';
import { base64ToBytes, safeEndIndex } from '../../utils/misc';
import { CancellableNotice, throwIfAborted } from '../../utils/CancellableNotice';
import { Notice } from 'obsidian';

export async function buildEncryptedNote(crypto: CryptoService, data:string, password: string, hint: string, extension: string): Promise<string>{
    const isCompressed = shouldCompress(extension);
    const encryptedExtension = await crypto.encryptToBase64(extension, password, isCompressed);
    const cipherList: Array<string> = new Array<string>();
    let currentPosition: number = 0;
    do {
        const endPosition = safeEndIndex(data, currentPosition + CHUNK_SIZE);
        const slicedPart = data.slice(currentPosition, endPosition);
        const cipher = await crypto.encryptToBase64(slicedPart,password, isCompressed);
        currentPosition = endPosition;
        cipherList.push(cipher);
    } while (data.length > currentPosition);
        
    const cryptoCache = crypto.getCurrentCache();
    if(cryptoCache)
        PasswordManager.storeCache(cryptoCache);

    const encryptedData : EncryptedNote = {hint, isCompressed, extension: encryptedExtension, cipherList};
    return JSON.stringify(encryptedData);
}

export function getJsonFooterFromBinary<T>(bytes: Uint8Array): T | null {
    if (bytes.length < JSON_SIZE_BYTES) 
        return null;

    const sizeOffset = bytes.length - JSON_SIZE_BYTES;
    const jsonSize = new DataView(bytes.buffer, bytes.byteOffset + sizeOffset, JSON_SIZE_BYTES).getUint32(0, true);

    if (jsonSize <= 0 || jsonSize > bytes.length - JSON_SIZE_BYTES) 
        return null;

    const jsonStart = bytes.length - JSON_SIZE_BYTES - jsonSize;
    const jsonBytes = bytes.slice(jsonStart, jsonStart + jsonSize);

    try {
        return JSON.parse(new TextDecoder().decode(jsonBytes)) as T;
    } catch {
        return null;
    }
}

export async function probeSavedPasswords(crypto: CryptoService, probeCipher: string, probeIsCompress: boolean): Promise<{ password: string; result: string } | null> {
	if (!SettingsService.getRememberPasswords()) 
		return null;

    const cipherBytes = base64ToBytes(probeCipher);
    if (cipherBytes.length < VECTOR_SIZE + SALT_SIZE + 16) 
        return null;

    const saltBytes = cipherBytes.slice(VECTOR_SIZE, VECTOR_SIZE + SALT_SIZE);
    const activePasswords = PasswordManager.getAllActivePasswords();
    const triedViaCache = new Set<string>();
        
    const notice = new CancellableNotice('🔑 Trying saved passwords...');
    let attempt = 0;
    try{
        for (const password of activePasswords) {
            const cachedKey = PasswordManager.getCachedCryptoKey(password, saltBytes);
            if (!cachedKey) 
                continue;

            triedViaCache.add(password);
            crypto.setCache(password, saltBytes, cachedKey);

            const result = await crypto.decryptToString(probeCipher, password, probeIsCompress);
            if (result !== null) 
                return { password, result };
        }
        
        for (const password of activePasswords) {
            throwIfAborted(notice.signal);

            attempt++;
            const total = activePasswords.length;
            notice.setMessage(`🔑 Trying saved passwords... ${attempt}/${total}`);

            if (triedViaCache.has(password)) 
                continue;

            const result = await crypto.decryptToString(probeCipher, password, probeIsCompress);
            if (result !== null) {
                const fresh = crypto.getCurrentCache();
                if (fresh) 
                    PasswordManager.storeCache(fresh);

                return { password, result };
            }
        }
    }catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') 
            new Notice('⛔ Password check cancelled', 2000);
		else {
			console.error(error);
			new Notice('❌ Probe failed!');
		}
		return null;
	} finally { notice.hide(); }

	return null;
}

export function persistPasswordAndCache(crypto: CryptoService, password: string): void {
    PasswordManager.addPassword(password);
    const freshCache = crypto.getCurrentCache();
    if (freshCache) 
        PasswordManager.storeCache(freshCache);
}

export async function decryptNoteCipher(crypto: CryptoService, cipherList: Array<string>, password: string, isCompressed: boolean): Promise<string | null>{
    let decryptedText = '';
    
    for(const cipher of cipherList){
        const decryptedCipher = await crypto.decryptToString(cipher, password, isCompressed);
        if(decryptedCipher === null)
            return null;
        decryptedText += decryptedCipher;
    }

    return decryptedText;
}

export function shouldCompress(extension: string): boolean {
	const compressionMode = SettingsService.getCompressionMode();
	if (compressionMode === 'always') 
		return true;
	else if (compressionMode === 'never')
		return false;

	const compressionExtensions = SettingsService.getCompressibleExtensions();
	const isExtensionCompress = compressionExtensions.get(extension.toLowerCase().trim());

	if (isExtensionCompress !== undefined) 
		return isExtensionCompress;

	const isOtherCompress = compressionExtensions.get(OTHER_EXTENSIONS);
	if (isOtherCompress === undefined) {
		void SettingsService.addCompressibleExtension(OTHER_EXTENSIONS, true);
		return true;
	}

	return isOtherCompress;
}