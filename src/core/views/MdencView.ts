import { TFile, Notice, MarkdownView, WorkspaceLeaf, ViewStateResult, TextFileView} from 'obsidian';
import { EncryptedNote, IFrogEncrypter } from '../../utils/types';
import { getDecryptPasswordModal } from '../../modals/DecryptPasswordModal';
import { MD_ENCRYPTED_EXTENSION, MD_VIEW_TYPE } from '../../utils/constants';
import { buildEncryptedNote, decryptNoteCipher, persistPasswordAndCache, probeSavedPasswords } from '../helpers/EncryptHelper';
import { getEncryptPasswordModal } from '../../modals/EncryptPasswordModal';
import { CryptoService } from '../../utils/CryptoService';

export class MdencView extends MarkdownView {
	private plugin: IFrogEncrypter;
	private crypto: CryptoService | null = null;

	private password = '';
	private hint = '';
	private cachedUnencryptedData = '';
	private encryptedNote: EncryptedNote | null = null;
	private isSavingEnabled = false;
	private isSavingInProgress = false;
	private isLoadingFileInProgress = false;
	private static guardRefCount = 0;
	private static nativeSetViewState: WorkspaceLeaf['setViewState'] | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: IFrogEncrypter) {
		super(leaf);
		this.plugin = plugin;
		this.addAction('key-round', 'Change password', async () => this.changePassword());
	}

	getIcon(): string {
		return 'file-lock';
	}

	getViewType(): string {
		return MD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return (this.file?.name.replace(`.${MD_ENCRYPTED_EXTENSION}`, '') ?? 'Encrypted note');
	}

	canAcceptExtension(extension: string): boolean {
		return extension === MD_ENCRYPTED_EXTENSION;
	}

	async onLoadFile(file: TFile): Promise<void> {
		await this.closeOtherLeavesSameFile(file);
		
		this.crypto = new CryptoService();
		this.isSavingEnabled = false;
		this.password = '';
		this.hint = '';
		this.cachedUnencryptedData = '';
		this.encryptedNote = null;

		const rawContent = await this.plugin.app.vault.read(file);

		let note: EncryptedNote;
		try {
			note = JSON.parse(rawContent) as EncryptedNote;
		} catch {
			new Notice('❌ Failed to parse: invalid JSON!');
			this.leaf.detach();
			return;
		}

		if (!note.cipherList || !Array.isArray(note.cipherList)) {
			new Notice('❌ Invalid encrypted note!');
			this.leaf.detach();
			return;
		}
		
		note.hint = note.hint !== undefined ? note.hint : '';
		this.encryptedNote = note;
		this.hint = note.hint;

		const cache = await probeSavedPasswords(this.crypto, note.extension, note.isCompressed);
		const { password, hasConfirmed } = !cache ? await getDecryptPasswordModal(this.plugin.app, this.hint) : { password: cache.password, hasConfirmed: true };
		if (!hasConfirmed) {
			this.leaf.detach();
			return;
		}

		const text = await decryptNoteCipher(this.crypto, note.cipherList, password, note.isCompressed);
		if (text === null) {
			if(!cache)
				new Notice('❌ Decryption failed!');
			else
				new Notice('❌ The encryption of this file was corrupted.');
			this.leaf.detach();
			return;
		}
		if (!cache) 
			persistPasswordAndCache(this.crypto, password);
		

		await this.finishLoad(file, password, text, note);
	}

	private async finishLoad(file: TFile, password: string, text: string, note: EncryptedNote): Promise<void> {
		this.password = password;
		this.hint = note.hint;
		this.cachedUnencryptedData = text;
		this.encryptedNote = note;
		this.isLoadingFileInProgress = true;

		try {
			await super.onLoadFile(file);
		} finally {
			this.isLoadingFileInProgress = false;
		}

		super.setViewData(text, true);

		this.isSavingEnabled = true;
		this.installSetViewStateGuard();
	}
	
	private installSetViewStateGuard(): void {
		if (MdencView.nativeSetViewState === null) {
			MdencView.nativeSetViewState = Object.getOwnPropertyDescriptor( WorkspaceLeaf.prototype, 'setViewState')?.value as WorkspaceLeaf['setViewState'];

			const native = MdencView.nativeSetViewState;

			WorkspaceLeaf.prototype.setViewState = async function (this: WorkspaceLeaf, viewState, result) {
				const next = { ...viewState };

				if (next.type === 'markdown') {
					const filePath = typeof next.state === 'object' && next.state !== null && 'file' in next.state &&
						typeof (next.state as { file?: unknown }).file === 'string'
							? (next.state as { file: string }).file
							: undefined;

					const ext = filePath?.split('.').pop()?.toLowerCase();

					if (ext === MD_ENCRYPTED_EXTENSION) 
						next.type = MD_VIEW_TYPE;
					 else if (filePath === undefined && this.view?.getViewType() === MD_VIEW_TYPE) 
						next.type = MD_VIEW_TYPE;
				}

				return native.call(this, next, result);
			};
		}

		MdencView.guardRefCount++;
	}

	private async closeOtherLeavesSameFile(file: TFile): Promise<void> {
		const toClose: WorkspaceLeaf[] = [];

		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf === this.leaf) 
				return;

			if (leaf.view?.getViewType() !== MD_VIEW_TYPE) 
				return;

			const f = (leaf.view as { file?: TFile | null })?.file;
			if (f?.path === file.path) 
				toClose.push(leaf);
		});

		for (const leaf of toClose) {        
			if (leaf.view instanceof TextFileView) 
            	await leaf.view.save();

			leaf.detach();
		}
	}


	async save(clear?: boolean): Promise<void> {
		if (!this.isSavingEnabled || !this.file || this.isSavingInProgress || !this.crypto) 
			return;
		

		const currentContent = super.getViewData();
		if (currentContent == null || this.isEncryptedNoteJson(currentContent) || currentContent === this.cachedUnencryptedData) 
			return;

		this.isSavingInProgress = true;
		try {
			const json = await buildEncryptedNote(this.crypto, currentContent, this.password, this.hint, 'md');
			this.encryptedNote = JSON.parse(json) as EncryptedNote;
			this.cachedUnencryptedData = currentContent;

			await super.save(clear);
		} finally {
			this.isSavingInProgress = false;
		}
	}

	getViewData(): string {
		if (this.isSavingInProgress && this.encryptedNote)
			return JSON.stringify(this.encryptedNote, null, 2);

		return super.getViewData();
	}

	setViewData(data: string, clear: boolean): void {
		if (this.isLoadingFileInProgress) 
			return;

		if (this.isEncryptedNoteJson(data)) {
			super.setViewData(this.cachedUnencryptedData || '', clear);
			return;
		}

		super.setViewData(data, clear);
		this.cachedUnencryptedData = data;
	}

	async setState(state: Record<string, unknown>,result: ViewStateResult): Promise<void> {
		if (state['mode'] === 'preview') 
			await this.save();

		this.isSavingEnabled = false;
		try {
			await super.setState(state, result);
			super.setViewData(this.cachedUnencryptedData, false);
		} finally {
			this.isSavingEnabled = true;
		}
	}

	private async changePassword(): Promise<void> {
		if (!this.file || !this.isSavingEnabled || !this.crypto) {
			new Notice('❌ Cannot change password: note is not fully loaded!');
			return;
		}

		const currentContent = super.getViewData();
		if (currentContent == null || this.isEncryptedNoteJson(currentContent)) 
			return;

		const { password: newPassword, hint: newHint, hasConfirmed} = await getEncryptPasswordModal(this.plugin.app);
		if (!hasConfirmed) 
			return;

		this.isSavingEnabled = false;
		this.isSavingInProgress = true;

		try {
			const json = await buildEncryptedNote(this.crypto, currentContent, newPassword, newHint, 'md' );

			this.password = newPassword;
			this.hint = newHint;
			this.cachedUnencryptedData = currentContent;
			this.encryptedNote = JSON.parse(json) as EncryptedNote;
			await super.save();

			new Notice('🔑 Password changed successfully!');
		} catch (e) {
			console.error(e);
			new Notice('❌ Failed to change password!');
		} finally {
			this.isSavingInProgress = false;
			this.isSavingEnabled = true;
		}
	}

	private isEncryptedNoteJson(data: string): boolean {
    	if (data.charCodeAt(0) !== 0x7B)
			return false; 

    	try {
        	const parsed = JSON.parse(data) as Partial<EncryptedNote>;
        	return Array.isArray(parsed.cipherList);
        } catch {
			return false;
		}
	}

	async onUnloadFile(_file: TFile): Promise<void> {
		this.clear();
		this.crypto = null;
		this.isSavingEnabled = false;
		this.isSavingInProgress = false;
		this.password = '';
		this.hint = '';
		this.cachedUnencryptedData = '';
		this.encryptedNote = null;
		this.uninstallSetViewStateGuard();
	}
	
	public static forceRemoveSetViewStateGuard(): void {
		if (MdencView.nativeSetViewState) {
			WorkspaceLeaf.prototype.setViewState = MdencView.nativeSetViewState;
			MdencView.nativeSetViewState = null;
		}
		MdencView.guardRefCount = 0;
	}

	private uninstallSetViewStateGuard(): void {
		if (MdencView.guardRefCount <= 0) 
			return;

		MdencView.guardRefCount--;

		if (MdencView.guardRefCount === 0 && MdencView.nativeSetViewState) {
			WorkspaceLeaf.prototype.setViewState = MdencView.nativeSetViewState;
			MdencView.nativeSetViewState = null;
		}
	}
}
