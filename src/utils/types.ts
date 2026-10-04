import { Plugin } from 'obsidian';

export interface IFrogEncrypter extends Plugin {
	onload(): Promise<void>;
	onunload(): void;
}
export interface CryptoCache {
	password: string;
	salt: Uint8Array;
	key: CryptoKey;
}

export interface EncryptedNote{
	hint: string;
	isCompressed: boolean;
	extension: string;						//Base64 encrypted extension
	cipherList: Array<string>;
}

export interface EncryptedFile{
	hint: string;
	isCompressed: boolean,
	extension: string;						//Base64 encrypted extension
	chunkSizes: Array<number>;
}

export interface PackFooter {
	hint: string;
	isIndexCompressed: boolean;
	index: string; 							//Encrypted base64 string of PackIndex
}

export interface PackIndex {
	files: Array<{
		path: string;
		isCompressed: boolean;
		chunkSizes: number[];
	}>;
	folderPaths: string[];
	totalOriginalSize: number;
}


export type compressionMode = 'always' | 'never' | 'by_extension';