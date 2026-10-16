import { TFile, Notice, FileView, WorkspaceLeaf } from 'obsidian';
import { EncryptedFile, IFrogEncrypter } from '../../utils/types';
import { getDecryptPasswordModal } from '../../modals/DecryptPasswordModal';
import { CryptoService } from '../../utils/CryptoService';
import { FILE_ENCRYPTED_EXTENSION, FILE_VIEW_TYPE, MIME_TYPES } from '../../utils/constants';
import { getJsonFooterFromBinary, persistPasswordAndCache, probeSavedPasswords } from '../helpers/EncryptHelper';
import { formatBytes, toArrayBuffer } from '../../utils/misc';
import { CancellableNotice, throwIfAborted } from '../../utils/CancellableNotice';

export class FrogView extends FileView {
	private plugin: IFrogEncrypter;
	private hint = '';
	private extension = '';
	private objectUrl: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: IFrogEncrypter) {
		super(leaf);
		this.plugin = plugin;
	}
	
	getViewType(): string {
		return FILE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return (this.file?.name.replace(`.${FILE_ENCRYPTED_EXTENSION}`, '') ?? 'Encrypted file');
	}

	getIcon(): string {
		const mime = MIME_TYPES[this.extension];

		if(mime?.startsWith('image'))
			return 'image';
		if(mime?.startsWith('audio'))
			return 'audio';
		if(mime?.startsWith('video'))
			return 'video';

		return 'file-lock';
	}

	async onLoadFile(file: TFile): Promise<void> {
		this.revokeObjectUrl();
		this.hint = '';
		this.extension = '';
		this.contentEl.empty();

		const crypto = new CryptoService();
    	const notice = new CancellableNotice('📂 Reading file...');
		notice.hideButton();
		
		try {
			const fileBuffer = await this.plugin.app.vault.readBinary(file);
			throwIfAborted(notice.signal);

			const fileBytes = new Uint8Array(fileBuffer);

			const fileJsonFooter = getJsonFooterFromBinary<EncryptedFile>(fileBytes);
			if (!fileJsonFooter) {
				new Notice('❌ Failed to parse: invalid JSON!');
				this.leaf.detach();
				return;
			}
			this.hint = fileJsonFooter.hint;

			const cache = await probeSavedPasswords(crypto, fileJsonFooter.extension, fileJsonFooter.isCompressed);
			const { password, hasConfirmed } = !cache ? await getDecryptPasswordModal(this.plugin.app, this.hint) : {password : cache.password, hasConfirmed: true};
			if (!hasConfirmed) {
				this.leaf.detach();
				return;
			}
			
			const extension = !cache ? await crypto.decryptToString(fileJsonFooter.extension, password, fileJsonFooter.isCompressed) : cache.result;
			if(extension === null) {
				new Notice('❌ Decryption failed!');
				this.leaf.detach();
				return;
			}
			this.extension = extension;

			notice.setMessage('🔓 Decrypting...');
			notice.showButton();
			const plain = await this.decryptAllChunks(crypto, fileBytes, fileJsonFooter, password, notice);
			if (!plain) {
				new Notice('❌ Decryption failed!');
				this.leaf.detach();
				return;
			}
			
			if (!cache) 
				persistPasswordAndCache(crypto, password);

			this.renderContent(this.extension, plain);
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError')
				new Notice('⛔ Decryption cancelled', 4000);
			else {
				console.error(e);
				new Notice('❌ Decryption failed!');
			}
			this.leaf.detach();
		} finally {
			notice.hide();
		}
	}

	private async decryptAllChunks(crypto: CryptoService, fileBytes: Uint8Array, jsonFooter: EncryptedFile, password: string, notice: CancellableNotice): Promise<Uint8Array | null> {
		const pieces: Uint8Array[] = [];
		let currentPos = 0;
		let processedCipher = 0;

		const payloadSize = jsonFooter.chunkSizes.reduce((a, b) => a + b, 0);
		const encryptedSize = formatBytes(fileBytes.length);

		for (const chunkSize of jsonFooter.chunkSizes) {
			throwIfAborted(notice.signal);

			const chunkBuf = fileBytes.slice(currentPos, currentPos + chunkSize);
			currentPos += chunkSize;
			processedCipher += chunkSize;

			const decryptedData = await crypto.decrypt(chunkBuf, password, jsonFooter.isCompressed);
			if (!decryptedData)
				return null;

			pieces.push(decryptedData);

			const pct = payloadSize > 0 ? Math.min(100, Math.round((processedCipher / payloadSize) * 100)) : 100;
			notice.setMessage(`🔓 Decrypting... ${pct}% (${encryptedSize})`);
			await nextFrame();
		}

		if(pieces.length === 0)
			return null;

		const total = pieces.reduce((previousValue, currentValue) => previousValue + currentValue.length, 0);
		const out = new Uint8Array(total);
		let offset = 0;
		for (const piece of pieces) {
			out.set(piece, offset);
			offset += piece.length;
		}
		return out;
	}

	private renderContent(type: string, bytes: Uint8Array): void {
		this.contentEl.empty();
		this.revokeObjectUrl();

		const mime = MIME_TYPES[type] || 'application/octet-stream';

		if (mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/')) {
			this.renderBlobMedia(mime, bytes);
			return;
		}

		this.contentEl.createEl('h5', {
			text: "📄 Preview not available for this file type. Decrypt the file to open it.",
			cls: 'frog-unavailable-view'
		});
	}

	private renderBlobMedia(mime: string, bytes: Uint8Array): void {
		const blob = new Blob([toArrayBuffer(bytes)], { type: mime });
		this.objectUrl = URL.createObjectURL(blob);

		if (mime.startsWith('image/')) {
			this.contentEl.createEl('img', {
				cls: 'frog-image-view',
				attr: {
					src: this.objectUrl
				}
			});
			return;
		}

		if (mime.startsWith('audio/')) {
			this.contentEl.createEl('audio', {
				cls: 'frog-audio-view',
				attr: {
					src: this.objectUrl,
					controls: 'true'
				}
				
			});
			return;
		}

		this.contentEl.createEl('video', {
			cls: 'frog-video-view',
			attr: {
				src: this.objectUrl,
				controls: 'true'
			},
		});
	}

	async save(): Promise<void> {
		void 0;
	}

	private revokeObjectUrl(): void {
		if (this.objectUrl) {
			URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = null;
		}
	}

	async onUnloadFile(_file: TFile): Promise<void> {
		this.revokeObjectUrl();
		this.hint = '';
		this.extension = '';
		this.contentEl.empty();
	}
}