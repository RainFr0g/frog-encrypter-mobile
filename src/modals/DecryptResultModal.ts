import { App, MarkdownView, Modal, Notice, Setting } from 'obsidian';

export async function getDecryptResultModal(app: App, decryptedText: string) {
	return new Promise<{ editedDecryptedText: string; isDecryptionRequired: boolean; isSaveRequired: boolean; hasConfirmed: boolean; }>((resolve) => {
			new DecryptResultModal(app, decryptedText,
				async (editedDecryptedText, isDecryptionRequired,isSaveRequired,hasConfirmed) => {
					resolve({ editedDecryptedText, isDecryptionRequired, isSaveRequired, hasConfirmed });
				},
			);
		},
	);
}

class DecryptResultModal extends Modal {
    private readonly decryptedText: string;
    private editedDecryptedText: string;
    private isDecryptionRequired: boolean;
    private isSaveRequired: boolean;
    private hasConfirmed: boolean;
	private callback: (editedDecryptedText: string, isDecryptionRequired: boolean, isSaveRequired: boolean, hasConfirmed: boolean) => Promise<void>;
	
	constructor(app: App, decryptedText: string,
		callback: (editedDecryptedText: string, isDecryptionRequired: boolean, isSaveRequired: boolean, hasConfirmed: boolean)=> Promise<void>
	) {
		super(app);
		this.decryptedText = decryptedText;
        this.editedDecryptedText = '';
        this.isDecryptionRequired = false;
        this.isSaveRequired = false;
        this.hasConfirmed = false;
		this.callback = callback;
		this.open();
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText('Decryption result');
		
		const activeViewMode = this.app.workspace.getActiveViewOfType(MarkdownView)?.getMode();

		// =================== RESULT TEXT AREA =======================================================================
		const resultContainer = contentEl.createDiv();
		resultContainer.addClass('frog-decrypt-result-container');

		const textAreaEl = resultContainer.createEl('textarea', {
			text: this.decryptedText,
			cls: 'frog-modal-textarea'
		});

		// =================== BUTTON ROW =======================================================================
		const buttonRow = new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText('Copy').onClick(async () => {
					await navigator.clipboard.writeText(textAreaEl.value);
					new Notice('✅ Copied to clipboard!');
				})
			);

		if(activeViewMode === 'source')
			buttonRow.addButton((button) =>
				button
				.setButtonText('Save changes')
				.setCta()
				.onClick(() => {
					this.isDecryptionRequired = false;
					this.isSaveRequired = true;
					this.editedDecryptedText = textAreaEl.value;
                    this.hasConfirmed = true;
					this.close();
				}))
				.addButton((button) =>
				button.setButtonText('Decrypt it')
					.setWarning()
					.onClick(() => {
						this.isDecryptionRequired = true;
						this.isSaveRequired = false;
						this.editedDecryptedText = textAreaEl.value;
                        this.hasConfirmed = true;
						this.close();
					})
			);
	}


	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();

		void this.callback(this.editedDecryptedText, this.isDecryptionRequired, this.isSaveRequired, this.hasConfirmed);
	}
}
