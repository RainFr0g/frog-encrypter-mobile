import { App, Modal, Setting, TextComponent } from 'obsidian';
import { decodeHint } from '../utils/mics';

export async function getDecryptPasswordModal(app: App, hint: string, ) {
	return new Promise<{ password: string; hasConfirmed: boolean }>( (resolve) => {
			new DecryptPasswordModal(app, hint,
				async (password, hasConfirmed) => {
					resolve({ password, hasConfirmed });
				}
			);
		},
	);
}

class DecryptPasswordModal extends Modal {
	private hint: string;
	private password: string;
	private hasConfirmed: boolean;
	private callback: (password: string, hasConfirmed: boolean) => Promise<void>;

	private passwordInput!: TextComponent;

	constructor(app: App, hint: string, callback: (password: string, hasConfirmed: boolean) => Promise<void>) {
		super(app);
		this.hint = hint;
		this.password = '';
		this.hasConfirmed = false;
		this.callback = callback;
		this.open();
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText('Decrypting');
		contentEl.createDiv();

		// =================== PASSWORD ROW =======================================================================
		new Setting(contentEl)
			.setName('Password:')
			.addButton((button) => {
				button.buttonEl.tabIndex = -1;
				button.setIcon('eye-off').onClick(() => {
					if (this.passwordInput.inputEl.type == 'password') {
						this.passwordInput.inputEl.type = 'text';
						button.setIcon('eye');
						button.setCta();
					} else {
						this.passwordInput.inputEl.type = 'password';
						button.setIcon('eye-off');
						button.removeCta();
					}
				});
			})
			.addText((text) => {
				text.inputEl.type = 'password';
				text.setPlaceholder(decodeHint(this.hint));
				this.setupEnterAsConfirm(text.inputEl);
				this.passwordInput = text;
			});

		// =================== CONFIRM BUTTON =======================================================================
		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText('Confirm')
				.setCta()
				.onClick(() => {
					this.password = this.passwordInput.getValue();
					this.hasConfirmed = true;
					this.close();
				}),
		);
	}

	private setupEnterAsConfirm(inputEl: HTMLInputElement): void {
		inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();

				this.password = this.passwordInput.getValue();
				this.hasConfirmed = true;
				this.close();
			}
		});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();

		void this.callback(this.password, this.hasConfirmed);
	}
}
