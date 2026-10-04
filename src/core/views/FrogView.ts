import { TFile, Notice, FileView, WorkspaceLeaf } from 'obsidian';
import { EncryptedFile, IFrogEncrypter } from '../../utils/types';
import { getDecryptPasswordModal } from '../../modals/DecryptPasswordModal';
import { CryptoService } from '../../utils/CryptoService';
import { StorageService } from '../../utils/StorageService';
import { FILE_ENCRYPTED_EXTENSION, FILE_VIEW_TYPE, MIME_TYPES } from '../../utils/constants';
import { getJsonFooterFromBinary, persistPasswordAndCache, probeSavedPasswords } from '../helpers/EncryptHelper';

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
		const notice = new Notice('🔓 Decrypting…', 0);

		try {
            const fullFilePath = StorageService.path.join(StorageService.getVaultPath(this.plugin), file.path);
            const fileJsonFooter = getJsonFooterFromBinary<EncryptedFile>(fullFilePath);
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

			const plain = await this.decryptAllChunks(crypto, fullFilePath, fileJsonFooter, password);
			if (!plain) {
				new Notice('❌ Decryption failed!');
				this.leaf.detach();
				return;
			}

            if (!cache)
                persistPasswordAndCache(crypto, password);

			this.renderContent(this.extension, plain);
		} finally {
			notice.hide();
		}
	}

	private async decryptAllChunks(crypto: CryptoService, path: string, jsonFooter: EncryptedFile, password: string): Promise<Uint8Array | null> {
		const pieces: Uint8Array[] = [];
		let currentPos = 0;
		const readFd = StorageService.fs.openSync(path, 'r');

		for (const chunkSize of jsonFooter.chunkSizes) {
            const chunkBuf = new Uint8Array(chunkSize);
            StorageService.fs.readSync(readFd, chunkBuf, 0, chunkSize, currentPos);
			currentPos += chunkSize;

			const decryptedData = await crypto.decrypt(chunkBuf, password, jsonFooter.isCompressed);
			if (!decryptedData){
				StorageService.fs.closeSync(readFd);
				return null;
			}
			pieces.push(decryptedData);
		}
        StorageService.fs.closeSync(readFd);
        
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
		const copy = new Uint8Array(bytes.byteLength);
		copy.set(bytes);
		const blob = new Blob([copy], { type: mime });
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