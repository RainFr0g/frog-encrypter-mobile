import { TFile, TFolder, Notice, Menu, WorkspaceLeaf, TextFileView } from 'obsidian';
import { EncryptedFile, EncryptedNote, IFrogEncrypter } from '../utils/types';
import { getEncryptPasswordModal } from '../modals/EncryptPasswordModal';
import { getDecryptPasswordModal } from '../modals/DecryptPasswordModal';
import { CryptoService } from '../utils/CryptoService';
import { FrogView } from './views/FrogView';
import { MdencView } from './views/MdencView';
import { formatBytes } from '../utils/mics';
import { CHUNK_SIZE, FILE_ENCRYPTED_EXTENSION, FILE_VIEW_TYPE, JSON_SIZE_BYTES, MD_ENCRYPTED_EXTENSION, MD_VIEW_TYPE } from '../utils/constants';
import { buildEncryptedNote, decryptNoteCipher, getJsonFooterFromBinary, persistPasswordAndCache, probeSavedPasswords, shouldCompress } from './helpers/EncryptHelper';
import { StorageService } from '../utils/StorageService';
import { PasswordManager } from '../utils/PasswordManager';
import { CancellableNotice, throwIfAborted } from '../utils/CancellableNotice';


export class FileEncrypt {
	private plugin: IFrogEncrypter;

	constructor(plugin: IFrogEncrypter) {
		this.plugin = plugin;

		plugin.registerView(MD_VIEW_TYPE, (leaf) => new MdencView(leaf, plugin));
		plugin.registerView(FILE_VIEW_TYPE, (leaf) => new FrogView(leaf, plugin));
		plugin.registerExtensions([MD_ENCRYPTED_EXTENSION], MD_VIEW_TYPE);
		plugin.registerExtensions([FILE_ENCRYPTED_EXTENSION], FILE_VIEW_TYPE);

		plugin.registerEvent(
			plugin.app.workspace.on('file-menu', (menu, selectedItem) => {
				if (selectedItem instanceof TFile) 
					this.onFileContextMenu(menu, selectedItem);

				if (selectedItem instanceof TFolder) 
					menu.addItem((item) => item
							.setTitle('New encrypted note')
							.setIcon('file-lock')
							.onClick(() => this.createNewEncryptedNoteInFolder(selectedItem))
					);
			})
		);
		
		plugin.addCommand({id: 'frog-lock-encrypted-files', name: 'Lock all encrypted notes and files', callback: ()=> this.closeEncryptedLeaves(plugin)});
		plugin.addCommand({id: 'frog-new-encrypted-note', name: 'Create new encrypted note', callback: async () => await this.createNewEncryptedNoteInFolder(this.getDefaultNoteFolder())});
		plugin.addRibbonIcon('shield-check', 'Lock all encrypted notes and files', ()=> this.closeEncryptedLeaves(plugin)); 
		plugin.addRibbonIcon('file-lock', 'Create new encrypted note',  async () => await this.createNewEncryptedNoteInFolder(this.getDefaultNoteFolder()));
	}

	private async closeEncryptedLeaves(plugin: IFrogEncrypter): Promise<void> {
		const { workspace } = plugin.app;

		const leavesToClose: WorkspaceLeaf[] = [];
		workspace.iterateAllLeaves((leaf) => {
			const viewType = leaf.view?.getViewType?.();
			if (viewType === MD_VIEW_TYPE || viewType === FILE_VIEW_TYPE) 
				leavesToClose.push(leaf);
		});

		if (leavesToClose.length === 0) {
			new Notice('ℹ️ No encrypted leaves are open');
			return;
		}
		for (let i = leavesToClose.length - 1; i >= 0; i--) {
			const leaf = leavesToClose[i]!;
			const view = leaf.view;

			if (view instanceof TextFileView) 
				await view.save();

			leaf.detach();
		}
    	new Notice(`🔒 Locked ${leavesToClose.length} encrypted ${leavesToClose.length === 1 ? 'leaf' : 'leaves'}`);
	}

	private onFileContextMenu(menu: Menu, file: TFile): void {
		if (file.extension === MD_ENCRYPTED_EXTENSION) 
			menu.addItem((item) => item
					.setTitle('Decrypt note')
					.setIcon('lock-open')
					.onClick(() => this.decryptNote(file))
			);
		else if (file.extension === FILE_ENCRYPTED_EXTENSION) 
			menu.addItem((item) => item
					.setTitle('Decrypt file')
					.setIcon('lock-open')
					.onClick(() => this.decryptFile(file))
			);
		else if (file.extension === 'md') 
			menu.addItem((item) => item
					.setTitle('Encrypt note')
					.setIcon('lock')
					.onClick(() => this.encryptNote(file))
			);
		else 
			menu.addItem((item) => item
					.setTitle('Encrypt file')
					.setIcon('lock')
					.onClick(() => this.encryptFile(file))
			);
		
	}


	private async encryptNote(file: TFile): Promise<void> {
		const content = await this.plugin.app.vault.read(file);

		const { password, hint, hasConfirmed } = await getEncryptPasswordModal(this.plugin.app);
		if (!hasConfirmed) 
			return;

		const crypto = new CryptoService();
		const encryptedText = await buildEncryptedNote(crypto, content, password, hint, file.extension);

		const candidate = file.path.replace(new RegExp(`\\.${file.extension}$`, 'i'), `.${MD_ENCRYPTED_EXTENSION}`);
		const newPath = StorageService.getUniqueVaultPath(this.plugin, candidate);

		await this.plugin.app.vault.create(newPath, encryptedText);
		await this.plugin.app.vault.delete(file);
		const name = newPath.split('/').pop() ?? newPath;
		new Notice(`🔒 Encrypted as ${name}`);
	}

	private async decryptNote(file: TFile): Promise<void> {
		const rawContent = await this.plugin.app.vault.read(file);

		let contentJson: EncryptedNote;
		try {
			contentJson = JSON.parse(rawContent) as EncryptedNote;
		} catch {
			new Notice('❌ Failed to parse: invalid JSON');
			return;
		}
		
		const crypto = new CryptoService();
		const cache = await probeSavedPasswords(crypto, contentJson.extension, contentJson.isCompressed);
		const { password, hasConfirmed } = !cache ?  await getDecryptPasswordModal(this.plugin.app,	contentJson.hint) : {password: cache.password, hasConfirmed: true};
		if (!hasConfirmed) 
			return;
			
		const extension = !cache ? await crypto.decryptToString(contentJson.extension, password, contentJson.isCompressed) : cache.result;
		if (extension === null) {
			new Notice('❌ Decryption failed!');
			return;
		}

		const decryptedText = await decryptNoteCipher(crypto, contentJson.cipherList, password, contentJson.isCompressed);
		if (decryptedText === null) {
			new Notice('❌ Decryption failed!');
			return;
		}
		
		const candidate = file.path.replace(new RegExp(`\\.${file.extension}$`, 'i'),`.${extension}`);
		const newPath = StorageService.getUniqueVaultPath(this.plugin, candidate);

		await this.plugin.app.vault.create(newPath, decryptedText);
		await this.plugin.app.vault.delete(file);

		if (!cache)
			persistPasswordAndCache(crypto, password);

		new Notice(`🔓 Decrypted as ${newPath.split('/').pop()}`);
	}


	private async encryptFile(file: TFile): Promise<void> {
		const { password, hint, hasConfirmed } = await getEncryptPasswordModal(this.plugin.app);
		if (!hasConfirmed) 
			return;

		const crypto = new CryptoService();
		const notice = new CancellableNotice('🔒 Encrypting...');
		const overallStart = Date.now();

		let writeStream: ReturnType<typeof StorageService.fs.createWriteStream> | null = null;
		let destAbs: string | null = null;
		let success = false;

		try {
			const base = StorageService.getVaultPath(this.plugin);
			if (!base) {
				new Notice('❌ Streaming encryption requires a desktop (Electron) environment!');
				return;
			}

			const srcAbs = StorageService.path.join(base, file.path);
			const candidate = file.path.replace(new RegExp(`\\.${file.extension}$`, 'i'), `.${FILE_ENCRYPTED_EXTENSION}`);
			const relOut = StorageService.getUniqueVaultPath(this.plugin, candidate);
			destAbs = StorageService.path.join(base, relOut);

			const fileSize = StorageService.fs.statSync(srcAbs).size;
			const originalSize = formatBytes(fileSize);
			const isCompressed = shouldCompress(file.extension);

			const readFd = StorageService.fs.openSync(srcAbs, 'r');
			writeStream = StorageService.fs.createWriteStream(destAbs, { highWaterMark: CHUNK_SIZE * 2 });
			const ws = writeStream;

			try {
				const chunkSizes: number[] = [];
				let offset = 0;

				if (fileSize === 0) {
					const encrypted = await crypto.encrypt(new Uint8Array(0), password, isCompressed);
					chunkSizes.push(encrypted.length);
					const canContinue = ws.write(encrypted);

					if (!canContinue) 
						await new Promise<void>((resolve) => ws.once('drain', resolve));
				} else {
					while (offset < fileSize) {
						throwIfAborted(notice.signal);  

						const toRead = Math.min(CHUNK_SIZE, fileSize - offset);
						const plainBuf = new Uint8Array(toRead);
						StorageService.fs.readSync(readFd, plainBuf, 0, toRead, offset);
						offset += toRead;

						const encrypted = await crypto.encrypt(plainBuf, password, isCompressed);
						chunkSizes.push(encrypted.length);

						const pct = Math.round((offset / fileSize) * 100);
						notice.setMessage(`🔒 Encrypting... ${pct}% (${originalSize})`);

						const canContinue = ws.write(encrypted);
						if (!canContinue) 
							await new Promise<void>((resolve) => ws.once('drain', resolve));
					}
				}

				const encryptedExtension = await crypto.encryptToBase64(file.extension, password, isCompressed);

				const cryptoCache = crypto.getCurrentCache();
				if (cryptoCache)
					PasswordManager.storeCache(cryptoCache);

				const footer: EncryptedFile = { hint, isCompressed, extension: encryptedExtension, chunkSizes };
				const footerBytes = new TextEncoder().encode(JSON.stringify(footer));
				const sizeBuf = new Uint8Array(JSON_SIZE_BYTES);
				new DataView(sizeBuf.buffer).setUint32(0, footerBytes.length, true);

				const canContinueFooter = ws.write(footerBytes);
				if (!canContinueFooter) 
					await new Promise<void>((resolve) => ws.once('drain', resolve));

				const canContinueSize = ws.write(sizeBuf);
				if (!canContinueSize) 
					await new Promise<void>((resolve) => ws.once('drain', resolve));

				await new Promise<void>((resolve, reject) => {
					ws.on('finish', resolve);
					ws.on('error', reject);
					ws.end();
				});
				success = true;
			} finally {
				StorageService.fs.closeSync(readFd);
			}

			const encryptedByteSize = StorageService.fs.statSync(destAbs).size;
			const encryptedSize = formatBytes(encryptedByteSize);
			
			let deleteFailed = false;
			try {
				await this.plugin.app.vault.delete(file);
			} catch (e) {
				const code = (e as NodeJS.ErrnoException)?.code;
				if (code === 'EBUSY' || code === 'EPERM') 
					deleteFailed = true;
				else 
					throw e;
			}

			const elapsed = ((Date.now() - overallStart) / 1000).toFixed(1);
			new Notice(`🔒 Encrypted (${originalSize} → ${encryptedSize}) in ${elapsed}s`, 8000);
			if(deleteFailed)
				new Notice(`❌ Could not delete the original file — it is currently in use. Close it and delete manually.`, 10000)

		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') 
				new Notice('⛔ Encryption cancelled', 4000);
			else {
				console.error(e);
				new Notice('❌ Encryption failed!');
			}
		} finally {
			if (writeStream && !writeStream.writableFinished)
				writeStream.destroy();

			if (!success && destAbs)
				try { StorageService.fs.unlinkSync(destAbs); } catch { /* ignore */ }
			notice.hide();
		}
	}

	private async decryptFile(file: TFile): Promise<void> {
		let notice: CancellableNotice | null = null;
		let writeStream: ReturnType<typeof StorageService.fs.createWriteStream> | null = null;
		let destPath: string | null = null;
		let success = false;

		try {
			const filePath = StorageService.path.join(StorageService.getVaultPath(this.plugin), file.path);
			const fileSize = StorageService.fs.statSync(filePath).size;

			const fileJson = getJsonFooterFromBinary<EncryptedFile>(filePath);
			if (!fileJson) {
				new Notice('❌ Failed to parse: invalid JSON');
				return;
			}

			const crypto = new CryptoService();
			const cache = await probeSavedPasswords(crypto, fileJson.extension, fileJson.isCompressed);
			const { password, hasConfirmed } = !cache ? await getDecryptPasswordModal(this.plugin.app, fileJson.hint) : { password: cache.password, hasConfirmed: true };
			if (!hasConfirmed) 
				return;

			const extension = !cache ? await crypto.decryptToString(fileJson.extension, password, fileJson.isCompressed) : cache.result;
			if (extension === null) {
				new Notice('❌ Decryption failed!');
				return;
			}

			const overallStart = Date.now();

			const candidate = file.path.replace(new RegExp(`\\.${FILE_ENCRYPTED_EXTENSION}$`, 'i'), `.${extension}`);
			const relOut = StorageService.getUniqueVaultPath(this.plugin, candidate);
			destPath = StorageService.path.join(StorageService.getVaultPath(this.plugin), relOut);

			const payloadSize = fileJson.chunkSizes.reduce((a, b) => a + b, 0);
			const encryptedSize = formatBytes(fileSize);

			const readFd = StorageService.fs.openSync(filePath, 'r');
			writeStream = StorageService.fs.createWriteStream(destPath, { highWaterMark: CHUNK_SIZE * 2 });
			
			writeStream.on('error', () => { /* ignore */ });
			const ws = writeStream;
			notice = new CancellableNotice('🔓 Decrypting...');

			let currentPos = 0;
			let processedPlain = 0;

			try {
				for (const chunkSize of fileJson.chunkSizes) {
					throwIfAborted(notice.signal);

					const chunkBuf = new Uint8Array(chunkSize);
					StorageService.fs.readSync(readFd, chunkBuf, 0, chunkSize, currentPos);
					currentPos += chunkSize;

					const decryptedBytes = await crypto.decrypt(chunkBuf, password, fileJson.isCompressed);
					if (decryptedBytes === null) 
						throw new Error('DECRYPTION_FAILED');

					processedPlain += decryptedBytes.length;

					const pct = payloadSize > 0 ? Math.min(100, Math.round((currentPos / payloadSize) * 100)) : 100;
					notice.setMessage(`🔓 Decrypting... ${pct}% (${encryptedSize})`);

					const canContinue = ws.write(decryptedBytes);
					if (!canContinue) 
						await new Promise<void>((resolve) => ws.once('drain', resolve));
				}

				await new Promise<void>((resolve, reject) => {
					ws.on('finish', resolve);
					ws.on('error', reject);
					ws.end();
				});
				success = true;
			} finally {
				StorageService.fs.closeSync(readFd);
			}

			await this.plugin.app.vault.delete(file);
			if (!cache)
				persistPasswordAndCache(crypto, password);

			const elapsed = ((Date.now() - overallStart) / 1000).toFixed(1);
			const plainSize = formatBytes(processedPlain);

			new Notice(`🔓 Decrypted (${encryptedSize} → ${plainSize}) in ${elapsed}s`, 8000);
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') 
				new Notice('⛔ Decryption cancelled', 4000);
			else if (e instanceof Error && e.message === 'DECRYPTION_FAILED') 
				new Notice('❌ Decryption failed: file is corrupted', 6000);
			else {
				console.error(e);
				new Notice('❌ Decryption failed!');
			}
		} finally {
			if (writeStream && !writeStream.writableFinished) 
				writeStream.destroy();

			if (writeStream) {
				const ws = writeStream;
				await new Promise<void>((resolve) => {
					if (ws.closed) resolve();
					else ws.once('close', resolve);
				});
			}

			if (!success && destPath) 
				try { StorageService.fs.unlinkSync(destPath); } catch { /* ignore */ }

			notice?.hide();
		}
	}

	private async createNewEncryptedNoteInFolder(folder: TFolder): Promise<void> {
		const { password, hint, hasConfirmed } = await getEncryptPasswordModal(this.plugin.app);
		if (!hasConfirmed)
			return;
		
		const crypto = new CryptoService();
		const encryptedText = await buildEncryptedNote(crypto, '', password, hint, 'md');

		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		const fileName = `Encrypted ${timestamp}.${MD_ENCRYPTED_EXTENSION}`;
		const fullPath = folder.path === '/' || folder.path === '' ? fileName : `${folder.path}/${fileName}`;
		const uniquePath = StorageService.getUniqueVaultPath(this.plugin, fullPath);

		const file = await this.plugin.app.vault.create(uniquePath, encryptedText);
		await this.plugin.app.workspace.getLeaf(true).openFile(file);
	}

	private getDefaultNoteFolder(): TFolder {
		const vault = this.plugin.app.vault;
		const location = vault.getConfig('newFileLocation') as string;
		
		if (location === 'folder') {
			const folderPath = vault.getConfig('newFileFolderPath') as string;
			if (folderPath) {
				const abstractFile = vault.getAbstractFileByPath(folderPath);

				if (abstractFile instanceof TFolder) 
					return abstractFile;
			}
		}
		
		return vault.getRoot();
	}
}