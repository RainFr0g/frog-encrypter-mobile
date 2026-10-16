import { App, Modal, Notice, Setting, TextComponent } from 'obsidian';
import { SettingsService } from '../settings/SettingsService';
import { PasswordManager } from '../utils/PasswordManager';
import { encodeHint, truncateUtf8 } from '../utils/misc';
import { HINT_MAX_BYTES } from '../utils/constants';

export function getEncryptPasswordModal(app: App) {
	return new Promise<{ password: string; hint: string; hasConfirmed: boolean; }>((resolve) => {
		new EncryptPasswordModal(app, async (password, hint, hasConfirmed) => {
			resolve({ password, hint, hasConfirmed });
		});
	});
}

class EncryptPasswordModal extends Modal {
	private password: string;
	private hint: string;
	private hasConfirmed: boolean;
	private callback: (password: string, hint: string, hasConfirmed: boolean) => Promise<void>;

	constructor(app: App, callback: (password: string, hint: string, hasConfirmed: boolean) => Promise<void>) {
		super(app);
		this.password = '';
		this.hint = '';
		this.hasConfirmed = false;
		this.callback = callback;
		this.open();
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;

		let confirmRow: Setting | null = null;
		let passwordInput: TextComponent;
		let confirmInput: TextComponent;
		let hintInput: TextComponent;
		
		titleEl.setText('Encrypting');
		contentEl.createDiv();

		// =================== PASSWORD ROW =======================================================================
		new Setting(contentEl)
			.setName('Password:')
			.addButton((button) => {
				button.buttonEl.tabIndex = -1;
				button.setIcon('eye-off');
				button.onClick(() => {
					if (passwordInput instanceof TextComponent && passwordInput.inputEl.type == 'password') {
						passwordInput.inputEl.type = 'text';
						button.setIcon('eye');
						button.setCta();
					} else {
						passwordInput.inputEl.type = 'password';
						button.setIcon('eye-off');
						button.removeCta();
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
		if (SettingsService.getConfirmPassword())
			confirmRow = new Setting(contentEl)
				.setName('Confirm password:')
				.addButton((button) => {
					button.buttonEl.tabIndex = -1;
					button.setIcon('eye-off');
					button.onClick(() => {
						if (confirmInput instanceof TextComponent && confirmInput.inputEl.type == 'password') {
							confirmInput.inputEl.type = 'text';
							button.setIcon('eye');
							button.setCta();
						} else {
							confirmInput.inputEl.type = 'password';
							button.setIcon('eye-off');
							button.removeCta();
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
					this.password = passwordInput?.getValue() ?? '';
					this.hint = hintInput?.getValue() ?? '';
					this.hasConfirmed = true;
					this.close();
				}),
		);
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();

		const base64Hint = encodeHint(this.hint);
		void this.callback(this.password, base64Hint, this.hasConfirmed);
	}
}

export function matchAnimation(settingControl: Setting): void {
	const animationClass = 'frogenc-confirm-match';
	if (settingControl.settingEl.classList.contains(animationClass)) 
		return;

	settingControl.settingEl.addClass(animationClass);
	window.setTimeout(() => {
		settingControl.settingEl.removeClass(animationClass);
	}, 300);
}


export function mismatchAnimation(settingControl: Setting): void {
	const animationClass = 'frogenc-confirm-mismatch';
	if (settingControl.settingEl.classList.contains(animationClass)) 
		return;

	settingControl.settingEl.addClass(animationClass);
	window.setTimeout(() => {
		settingControl.settingEl.removeClass(animationClass);
	}, 500);
}

export function enforceHintByteLimit(inputEl: HTMLInputElement, value: string): void {
	const bytes = new TextEncoder().encode(value);
	if (bytes.length <= HINT_MAX_BYTES) 
		return;

	const truncatedText = new TextDecoder().decode(truncateUtf8(bytes, HINT_MAX_BYTES));

	const cursor = inputEl.selectionStart ?? truncatedText.length;
	const newCursor = Math.min(cursor, truncatedText.length);

	inputEl.value = truncatedText;
	inputEl.setSelectionRange(newCursor, newCursor);
}

export function setupEnterAsTab(containerEl: HTMLElement, inputEl: HTMLInputElement): void {
	inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter') {
			e.preventDefault();

			const focusableElements = Array.from(
				containerEl.querySelectorAll<HTMLElement>(
					'input:not([tabindex="-1"]), button:not([tabindex="-1"]), [focusable="true"]',
				),
			);

			const currentIndex = focusableElements.indexOf(inputEl);
			if (focusableElements && currentIndex !== -1 &&	currentIndex < focusableElements.length - 1) {
				const nextElement = focusableElements[currentIndex + 1];
				if (nextElement) 
				nextElement.focus();
			}
		}
	});
}