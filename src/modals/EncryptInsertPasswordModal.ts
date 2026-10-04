import { App, Modal, Notice, Setting, TextComponent } from 'obsidian';
import { SettingsService } from '../settings/SettingsService';
import { PasswordManager } from '../utils/PasswordManager';
import { enforceHintByteLimit, matchAnimation, mismatchAnimation, setupEnterAsTab } from './EncryptPasswordModal';
import { encodeHint } from '../utils/mics';

export function getEncryptInsertPasswordModal(app: App) {
	return new Promise<{ textToEncrypt: string; password: string; hint: string; hasConfirmed: boolean; }>((resolve) => {
		new EncryptInsertPasswordModal(app,
			async (textToEncrypt, password, hint, hasConfirmed) => {
				resolve({ textToEncrypt,password, hint,	hasConfirmed,});
			},
		);
	});
}

class EncryptInsertPasswordModal extends Modal {
	private textToEncrypt: string;
	private password: string;
	private hint: string;
	private hasConfirmed: boolean;
	private callback: (textToEncrypt: string, password: string, hint: string, hasConfirmed: boolean) => Promise<void>;

	constructor(app: App, callback: (textToEncrypt: string, password: string, hint: string, hasConfirmed: boolean) => Promise<void>) {
		super(app);
		this.textToEncrypt = '';
		this.password = '';
		this.hint = '';
		this.callback = callback;
		this.hasConfirmed = false;
		this.open();
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;

		let confirmRow: Setting | null = null;
		let textAreaInput: HTMLTextAreaElement;
		let passwordInput: TextComponent;
		let confirmInput: TextComponent;
		let hintInput: TextComponent;

		titleEl.setText('Encrypting');
		
		// =================== INSERT TEXT AREA =======================================================================
		const textContainer = contentEl.createDiv();
		textContainer.addClass('frog-decrypt-result-container');

		textAreaInput = textContainer.createEl('textarea', {
			cls: 'frog-modal-textarea',
		});

		// =================== PASSWORD ROW =======================================================================
		new Setting(contentEl)
			.setName('Password:')
			.addButton((button) => {
				button.buttonEl.tabIndex = -1;
				button.setIcon('eye-off');
				button.onClick(() => {
					if (passwordInput instanceof TextComponent) {
						if (passwordInput.inputEl.type == 'password') {
							passwordInput.inputEl.type = 'text';
							button.setIcon('eye');
							button.setCta();
						} else {
							passwordInput.inputEl.type = 'password';
							button.setIcon('eye-off');
							button.removeCta();
						}
					}
				});
			})
			.addText((text) => {
				passwordInput = text;
				text.inputEl.type = 'password';
				text.inputEl.value = PasswordManager.getLastPassword();
				setupEnterAsTab(this.containerEl, text.inputEl);
			});

		// =================== CONFIRM PASSWORD ROW =======================================================================
		if (SettingsService.getConfirmPassword()) {
			confirmRow = new Setting(contentEl)
				.setName('Confirm password:')
				.addButton((button) => {
					button.buttonEl.tabIndex = -1;
					button.setIcon('eye-off');
					button.onClick(() => {
						if (confirmInput instanceof TextComponent) {
							if (confirmInput.inputEl.type == 'password') {
								confirmInput.inputEl.type = 'text';
								button.setIcon('eye');
								button.setCta();
							} else {
								confirmInput.inputEl.type = 'password';
								button.setIcon('eye-off');
								button.removeCta();
							}
						}
					});
				})
				.addText((text) => {
					confirmInput = text;
					text.inputEl.type = 'password';
					setupEnterAsTab(this.containerEl, text.inputEl);
					text.onChange(() => {
						if (confirmRow && text.getValue() == passwordInput?.getValue())
							matchAnimation(confirmRow);
					});
				});
		}

		// =================== HINT ROW =======================================================================
		new Setting(contentEl).setName('Hint:').addText((text) => {
			hintInput = text;
			text.inputEl.placeholder = 'Optional';
			text.onChange((value) => {
				enforceHintByteLimit(text.inputEl, value);
			});
			setupEnterAsTab(this.containerEl, text.inputEl);
		});

		// =================== CONFIRM BUTTON =======================================================================
		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText('Confirm')
				.setCta()
				.onClick(() => {
					const password = passwordInput?.getValue() ?? '';
					if (confirmRow) {
						const confirmPassword = confirmInput?.getValue() ?? '';

						if (password != confirmPassword) {
							new Notice("❌ The passwords don't match!");
							mismatchAnimation(confirmRow);
							return;
						}
					}
					PasswordManager.addPassword(password);
					this.textToEncrypt = textAreaInput?.value ?? '';
					this.password = passwordInput?.getValue() ?? '';
					this.hint = hintInput?.getValue() ?? '';
					this.hasConfirmed = true;
					this.close();
				})
		);
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
		
		const base64Hint = encodeHint(this.hint);
		void this.callback(this.textToEncrypt, this.password, base64Hint, this.hasConfirmed);
	}
}