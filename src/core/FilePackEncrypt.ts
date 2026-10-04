import { Notice } from 'obsidian';
import { CryptoService } from '../utils/CryptoService';
import { StorageService } from '../utils/StorageService';
import { getEncryptPasswordModal } from '../modals/EncryptPasswordModal';
import { IFrogEncrypter, PackFooter, PackIndex } from '../utils/types';
import { getDecryptPasswordModal } from '../modals/DecryptPasswordModal';
import { formatBytes } from '../utils/mics';
import { CHUNK_SIZE, JSON_SIZE_BYTES, COMPRESS_INDEX } from '../utils/constants';
import { getJsonFooterFromBinary, persistPasswordAndCache, probeSavedPasswords, shouldCompress } from './helpers/EncryptHelper';
import { PasswordManager } from '../utils/PasswordManager';
import { CancellableNotice, throwIfAborted } from '../utils/CancellableNotice';

export class FilePackEncrypt {
	
	static async packAndEncryptItems(plugin: IFrogEncrypter, selectedPaths: string | string[], outputFullPath: string): Promise<boolean> {
		const { password, hint, hasConfirmed } = await getEncryptPasswordModal(plugin.app);
		if (!hasConfirmed) 
			return false;
		
		const crypto = new CryptoService();
		const overallStart = Date.now();
		const notice = new CancellableNotice('📦 Scanning files...');

		let writeStream: ReturnType<typeof StorageService.fs.createWriteStream> | null = null;
		let success = false;

		try {
			const paths = Array.isArray(selectedPaths) ? selectedPaths : [selectedPaths];
			const fileList: Array<{ fullPath: string; archivePath: string; size: number }> = [];
			const folderPaths: PackIndex['folderPaths'] = [];

			StorageService.scanPaths(paths, fileList, folderPaths);

			if (fileList.length === 0 && folderPaths.length === 0) {
				new Notice('❌ Nothing to pack!');
				return false;
			}

			const totalOriginalSize = fileList.reduce((sum, f) => sum + f.size, 0);
			const originalSize = formatBytes(totalOriginalSize);
			notice.setMessage(`📦 ${fileList.length} files, ${originalSize}. Encrypting...`);
			
			writeStream = StorageService.fs.createWriteStream(outputFullPath, { highWaterMark: CHUNK_SIZE * 2 });
			const ws = writeStream;

			const indexFiles: PackIndex['files'] = [];
			let processedSize = 0;

			for (const file of fileList) {
				throwIfAborted(notice.signal);

				const readStream = StorageService.fs.createReadStream(file.fullPath, { highWaterMark: CHUNK_SIZE });
				try {
					const chunkSizes: number[] = [];
					const lastDotIndex = file.fullPath.lastIndexOf('.');
					const fileExtension = lastDotIndex !== -1 ? file.fullPath.slice(lastDotIndex + 1) : '';
					const isCompressed = shouldCompress(fileExtension);

					for await (const chunk of readStream) {
						throwIfAborted(notice.signal);

						const data = new Uint8Array(chunk as Uint8Array);

						const encryptedData = await crypto.encrypt(data, password, isCompressed);
						const canContinue = ws.write(encryptedData);
						if (!canContinue) 
							await new Promise<void>((resolve) => ws.once('drain', resolve));

						chunkSizes.push(encryptedData.length);

						processedSize += data.length;
						const pct = totalOriginalSize > 0 ? Math.round((processedSize / totalOriginalSize) * 100) : 100;
						notice.setMessage(`🔐 Encrypting... ${pct}% (${originalSize})`);
					}
					indexFiles.push({ path: file.archivePath, isCompressed, chunkSizes });
				} finally {
					readStream.destroy();
				}
			}

			const packIndex: PackIndex = { files: indexFiles, folderPaths, totalOriginalSize };
			const indexJson = JSON.stringify(packIndex);
			const isIndexCompress = COMPRESS_INDEX;
			const indexEncrypted = await crypto.encryptToBase64(indexJson, password, isIndexCompress);

			const cryptoCache = crypto.getCurrentCache();
			if (cryptoCache)
				PasswordManager.storeCache(cryptoCache);

			const footer: PackFooter = { hint, isIndexCompressed: isIndexCompress, index: indexEncrypted };
			const footerJson = JSON.stringify(footer);
			const footerBytes = new TextEncoder().encode(footerJson);
			const footerSize = footerBytes.length;

			const canContinueFooterBytes = ws.write(footerBytes);
			if (!canContinueFooterBytes)
				await new Promise<void>((resolve) => ws.once('drain', resolve));

			const sizeBuf = new Uint8Array(JSON_SIZE_BYTES);
			new DataView(sizeBuf.buffer).setUint32(0, footerSize, true);

			const canContinueSizeBytes = ws.write(sizeBuf);
			if (!canContinueSizeBytes)
				await new Promise<void>((resolve) => ws.once('drain', resolve));

			await new Promise<void>((resolve, reject) => {
				ws.on('finish', resolve);
				ws.on('error', reject);
				ws.end();
			});
			success = true;

			const encryptedByteSize = StorageService.fs.statSync(outputFullPath).size;
			const elapsed = ((Date.now() - overallStart) / 1000).toFixed(1);
			const encryptedSize = formatBytes(encryptedByteSize);

			let message = `📦 Packed ${fileList.length} files (${originalSize} → ${encryptedSize}) in ${elapsed}s`;
			if (folderPaths.length > 0)
				message += `\n📁 ${folderPaths.length} folders included`;

			new Notice(message, 8000);
			return true;
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				new Notice('⛔ Packing cancelled', 4000);
			} else {
				console.error(error);
				new Notice('❌ Packing failed!');
			}
			return false;
		} finally {
			if (writeStream && !writeStream.writableFinished)
				writeStream.destroy();

			if (!success)
				try { StorageService.fs.unlinkSync(outputFullPath); } catch { /* ignore */ }

			notice.hide();
		}
	}

	static async decryptAndUnpack(plugin: IFrogEncrypter, packPath: string, outputPath: string): Promise<boolean> {
		const crypto = new CryptoService();
		let readFd: number | null = null;
		let notice: CancellableNotice | null = null;

		try {
			const fileSize = StorageService.fs.statSync(packPath).size;
			const packJson = getJsonFooterFromBinary<PackFooter>(packPath);
			if (!packJson) {
				new Notice('❌ Corrupted .fpack: invalid JSON!');
				return false;
			}

			const cache = await probeSavedPasswords(crypto, packJson.index, packJson.isIndexCompressed);
			const { password, hasConfirmed } = !cache ? await getDecryptPasswordModal(plugin.app, packJson.hint) : { password: cache.password, hasConfirmed: true };
			if (!hasConfirmed) 
				return false;

			const overallStart = Date.now();

			const decryptedIndex = !cache ? await crypto.decryptToString(packJson.index, password, packJson.isIndexCompressed) : cache.result;
			if (!decryptedIndex) {
				new Notice('❌ Decryption failed!');
				return false;
			}

			if (!cache)
				persistPasswordAndCache(crypto, password);

			let index: PackIndex;
			try {
				index = JSON.parse(decryptedIndex) as PackIndex;
			} catch {
				new Notice('❌ Corrupted .fpack: invalid JSON index!');
				return false;
			}

			const createdFolders = new Set<string>();
			for (const folderPath of index.folderPaths) {
				const full = StorageService.path.join(outputPath, folderPath);
				StorageService.createDiskFolder(full, createdFolders);
			}

			readFd = StorageService.fs.openSync(packPath, 'r');
			let currentPos = 0;
			let processedOriginal = 0;
			const originalSize = formatBytes(index.totalOriginalSize);
			const failedFiles: string[] = [];

			notice = new CancellableNotice('🔓 Decrypting...');

			for (const file of index.files) {
				throwIfAborted(notice.signal);

				notice.setMessage(`📄 Extracting ${file.path}...`);

				const rawPath = StorageService.path.join(outputPath, file.path);
				const destPath = StorageService.getUniqueDiskPath(rawPath);
				const writeStream = StorageService.fs.createWriteStream(destPath, { highWaterMark: CHUNK_SIZE * 2 });
			    writeStream.on('error', () => { /* ignore */ });
				let success = false;

				try {
					for (const chunkSize of file.chunkSizes) {
						throwIfAborted(notice.signal);

						const chunkBuf = new Uint8Array(chunkSize);
						StorageService.fs.readSync(readFd, chunkBuf, 0, chunkSize, currentPos);
						currentPos += chunkSize;

						const decryptedBytes = await crypto.decrypt(chunkBuf, password, file.isCompressed);
						if (!decryptedBytes) 
							throw new Error('DECRYPTION_FAILED');	

						processedOriginal += decryptedBytes.length;
						const pct = index.totalOriginalSize > 0 ? Math.round((processedOriginal / index.totalOriginalSize) * 100) : 100;
						notice.setMessage(`🔓 Extracting... ${pct}% (${originalSize})`);

						const canContinue = writeStream.write(decryptedBytes);
						if (!canContinue) 
							await new Promise<void>((resolve) => writeStream.once('drain', resolve));
					}

					await new Promise<void>((resolve, reject) => {
						writeStream.on('finish', resolve);
						writeStream.on('error', reject);
						writeStream.end();
					});
					success = true;
				} catch (e) {
					if (e instanceof DOMException && e.name === 'AbortError') 
						throw e;

					console.error(e);
					failedFiles.push(file.path);

					if (e instanceof Error && e.message === 'DECRYPTION_FAILED') 
						new Notice(`❌ Decryption failed: ${file.path}`);
					else 
						new Notice(`❌ Failed to extract: ${file.path}`);
				} finally {
					if (!writeStream.writableFinished) 
						writeStream.destroy();

					await new Promise<void>((resolve) => {
						if (writeStream.closed) 
							resolve();
						else 
							writeStream.once('close', resolve);
					});

					if (!success) 
						try { StorageService.fs.unlinkSync(destPath); } catch { /* ignore */ }
				}
			}

			const elapsed = ((Date.now() - overallStart) / 1000).toFixed(1);
			const encryptedSize = formatBytes(fileSize);
			const succeededCount = index.files.length - failedFiles.length;

			let message = `✅ Extracted ${succeededCount} of ${index.files.length} files (${encryptedSize} → ${originalSize}) in ${elapsed}s`;
			if (index.folderPaths.length > 0)
				message += `\n📁 ${index.folderPaths.length} folders restored`;
			if (failedFiles.length > 0)
				message += `\n❌ ${failedFiles.length} file(s) failed`;

			new Notice(message, 8000);
			return failedFiles.length === 0;

		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				new Notice('⛔ Unpacking cancelled', 4000);
			} else {
				console.error(error);
				new Notice('❌ Unpacking failed!');
			}
			return false;
		} finally {
			if (readFd !== null)
				try { StorageService.fs.closeSync(readFd); } catch { /* already closed */ }

			notice?.hide();
		}
	}
}