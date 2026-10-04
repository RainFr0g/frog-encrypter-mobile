import { ButtonComponent, PluginSettingTab, Setting, SettingDefinitionItem, apiVersion } from 'obsidian';
import { compressionMode, IFrogEncrypter } from '../utils/types';
import { FilePackEncrypt } from '../core/FilePackEncrypt';
import { SettingsService } from './SettingsService';
import { PasswordManager } from '../utils/PasswordManager';
import { StorageService } from '../utils/StorageService';
import { getTimeStamp } from '../utils/mics';
import { CompressionExtensionModal } from '../modals/CompressionExtensionModal';

export class FrogPluginSettingTab extends PluginSettingTab {
	private plugin: IFrogEncrypter;

	private vaultVars: {
		selectVaultPath: string | null;
		outputPath: string | null;
	} = { selectVaultPath: null, outputPath: null };

	private encryptPackVars: {
		selectedPaths: string[] | null;
		outputPath: string | null;
		isFolderMode: boolean;
	} = { selectedPaths: null, outputPath: null, isFolderMode: false };

	private decryptPackVars: {
		selectedPath: string | null;
		outputPath: string | null;
	} = { selectedPath: null, outputPath: null };

	constructor(plugin: IFrogEncrypter) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	// =========================================================================
	// DECLARATIVE API (Obsidian 1.13+)
	// =========================================================================
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: '🔒 General encryption settings',
				items: [
					{
						name: 'Confirm password',
						desc: 'Re-enter your new password to verify it matches and ensure there are no accidental typos.',
						control: { type: 'toggle', key: 'confirmPassword' }
					},
					{
						name: 'Remember password',
						desc: 'Saves your password to bypass entry for a set period or until the app is closed.',
						control: { type: 'toggle', key: 'rememberPasswordsInMemory' }
					},
					{
						name: 'Autofill recent password',
						desc: 'Automatically autofill the most recently used successful password when creating a new encrypted block.',
						control: { type: 'toggle', key: 'autofillLastPassword' },
						visible: () => SettingsService.getRememberPasswords()
					},
					{
						name: 'Password lifetime',
						desc: 'The time in minutes that the password will be available after it is entered (minimum 1 min).',
						control: { type: 'text', key: 'passwordTtlMinutes' },
						visible: () => SettingsService.getRememberPasswords()
					}
				]
			},
			{
				type: 'group',
				heading: '📦 Pack Encryption .fpack',
				items: [
					{
						name: 'Encrypted vault backup',
						desc: 'Select a vault to create a password-protected, encrypted backup copy',
						render: (setting) => this.renderVaultPack(setting)
					},
					{
						name: 'Encrypt external files',
						desc: 'Select files from your device to secure with encryption',
						render: (setting) => this.renderEncryptPack(setting)
					},
					{
						name: 'Decrypt .fpack file',
						desc: 'Select and decrypt encrypted .fpack files',
						render: (setting) => this.renderDecryptPack(setting)
					}
				]
			},
			{
				type: 'group',
				heading: '🗜 Compression settings',
				items: [
					{
						name: 'Compression mode',
						desc: 'Choose how to compress files before encryption',
						render: (setting) => this.renderCompression(setting)
					}
				]
			}
		];
	}

	getControlValue(key: string): unknown {
		switch (key) {
			case 'confirmPassword':
				return SettingsService.getConfirmPassword();
			case 'rememberPasswordsInMemory':
				return SettingsService.getRememberPasswords();
			case 'autofillLastPassword':
				return SettingsService.getAutofillLastPassword();
			case 'passwordTtlMinutes':
				return SettingsService.getPasswordTtlMinutes().toString();
			default:
				return undefined;
		}
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		switch (key) {
			case 'confirmPassword':
				await SettingsService.setConfirmPassword(value as boolean);
				break;

			case 'rememberPasswordsInMemory': {
				const enabled = value as boolean;
				await SettingsService.setRememberPasswordsInMemory(enabled);
				if (!enabled)
					PasswordManager.clearPasswords();
				
				this.refreshSettings();
				break;
			}

			case 'autofillLastPassword':
				await SettingsService.setAutofillLastPassword(value as boolean);
				break;

			case 'passwordTtlMinutes': {
				const numeric = typeof value === 'number' ? value : parseInt(value as string) || 1;
				await SettingsService.setPasswordTtlMinutes(numeric > 525600 ? 525600 : numeric);
				PasswordManager.rearrangeExpireTime();
				break;
			}
		}
	}

	// =========================================================================
	// LEGACY API (Obsidian < 1.13)
	// =========================================================================
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ==================== GENERAL SETTINGS ====================
		new Setting(containerEl)
			.setHeading()
			.setName('🔒 General encryption settings');

		new Setting(containerEl)
			.setName('Confirm password')
			.setDesc('Re-enter your new password to verify it matches and ensure there are no accidental typos.')
			.addToggle((toggle) => {
				toggle.setValue(SettingsService.getConfirmPassword());
				toggle.onChange(async (value) => {
					await SettingsService.setConfirmPassword(value);
				});
			});

		new Setting(containerEl)
			.setName('Remember password')
			.setDesc('Saves your password to bypass entry for a set period or until the app is closed.')
			.addToggle((toggle) => {
				toggle.setValue(SettingsService.getRememberPasswords());
				toggle.onChange(async (value) => {
					updateShowPasswordLifetime(value);
					await SettingsService.setRememberPasswordsInMemory(value);
					if (!value)
						PasswordManager.clearPasswords();
				});
			});

		const autofillLastPassword = new Setting(containerEl)
			.setName('Autofill recent password')
			.setDesc('Automatically autofill the most recently used successful password when creating a new encrypted block.')
			.addToggle((toggle) => {
				toggle.setValue(SettingsService.getAutofillLastPassword());
				toggle.onChange(async (value) => {
					await SettingsService.setAutofillLastPassword(value);
				});
			});

		const passwordLifetime = new Setting(containerEl)
			.setName('Password lifetime')
			.setDesc('The time in minutes that the password will be available after it is entered (minimum 1 min).')
			.addText((text) => {
				text.setValue(SettingsService.getPasswordTtlMinutes().toString());
				text.onChange(async (value) => {
					const numericValue = parseInt(value) || 1;
					await SettingsService.setPasswordTtlMinutes(numericValue > 525600 ? 525600 : numericValue);
					PasswordManager.rearrangeExpireTime();
				});
				text.inputEl.type = 'number';
			});

		const updateShowPasswordLifetime = (rememberPassword: boolean) => {
			if (rememberPassword) {
				passwordLifetime.settingEl.show();
				autofillLastPassword.settingEl.show();
			} else {
				passwordLifetime.settingEl.hide();
				autofillLastPassword.settingEl.hide();
			}
		};

		updateShowPasswordLifetime(SettingsService.getRememberPasswords());

		// ==================== FILE PACK ====================
		new Setting(containerEl)
			.setHeading()
			.setName('📦 Pack Encryption .fpack');

		const vaultSetting = new Setting(containerEl)
			.setName('Encrypted vault backup')
			.setDesc('Select a vault to create a password-protected, encrypted backup copy');
		this.renderVaultPack(vaultSetting);

		const encryptSetting = new Setting(containerEl)
			.setName(this.encryptPackVars.isFolderMode ? 'Encrypt external folders' : 'Encrypt external files')
			.setDesc(this.encryptPackVars.isFolderMode
				? 'Select and encrypt folders, including all nested files'
				: 'Select files from your device to secure with encryption');
		this.renderEncryptPack(encryptSetting);

		const decryptSetting = new Setting(containerEl)
			.setName('Decrypt .fpack file')
			.setDesc('Select and decrypt encrypted .fpack files');
		this.renderDecryptPack(decryptSetting);

		// ==================== COMPRESSION SETTINGS ====================
		new Setting(containerEl)
			.setHeading()
			.setName('🗜 Compression settings');

		const compressionSetting = new Setting(containerEl)
			.setName('Compression mode')
			.setDesc('Choose how to compress files before encryption');
		this.renderCompression(compressionSetting);
	}

	// =========================================================================
	// SHARED RENDER HELPERS
	// =========================================================================

	// -------------------- VAULT PACK --------------------
	private renderVaultPack(setting: Setting): void {
		const buttons: { output: ButtonComponent | null; encrypt: ButtonComponent | null; } = { output: null, encrypt: null };
		const vars = this.vaultVars;

		setting
			.addDropdown((dropdown) => {
				dropdown.addOptions(StorageService.getVaultOptions(this.plugin));

				if (vars.selectVaultPath) 
					dropdown.setValue(vars.selectVaultPath);
				 else 
					vars.selectVaultPath = dropdown.getValue();
				

				dropdown.onChange((value) => {
					vars.selectVaultPath = value;
					if (buttons.output?.buttonEl.disabled)
						buttons.output.setCta().setDisabled(false);
				});
			})
			.addButton((button) => {
				buttons.output = button
					.setButtonText('Output file')
					.onClick(async () => {
						const out = await StorageService.openSaveDialog(
							'Select a folder and name your encrypted file',
							`Packed ${getTimeStamp()}`
						);
						if (!out)
							return;

						vars.outputPath = out;
						button.setTooltip(out);
						button.removeCta();
						buttons.encrypt?.setDisabled(false).setCta();
						buttons.encrypt?.setTooltip(`Vault to encrypt: ${vars.selectVaultPath ?? ''}`);
					});

				if (!vars.selectVaultPath)
					button.setDisabled(true);
				else if (vars.outputPath)
					button.setTooltip(vars.outputPath).removeCta();
				else
					button.setCta().setDisabled(false);
			})
			.addButton((button) => {
				buttons.encrypt = button
					.setButtonText('Encrypt')
					.onClick(async () => {
						const ok = await FilePackEncrypt.packAndEncryptItems(
							this.plugin,
							vars.selectVaultPath ?? '',
							vars.outputPath ?? ''
						);
						if (!ok)
							return;

						button.setDisabled(true).removeCta();
						buttons.output?.setCta();
					});

				if (vars.outputPath)
					button.setCta().setDisabled(false);
				else
					button.setDisabled(true);
			});
	}

	// -------------------- ENCRYPT PACK --------------------
	private renderEncryptPack(setting: Setting): void {
		const buttons: {
			select: ButtonComponent | null;
			output: ButtonComponent | null;
			encrypt: ButtonComponent | null;
		} = { select: null, output: null, encrypt: null };
		const vars = this.encryptPackVars;

		setting
			.addExtraButton((extraButton) => {
				extraButton.setTooltip('Change encryption mode');
				extraButton.onClick(() => {
					vars.isFolderMode = !vars.isFolderMode;

					const nameEl = setting.settingEl.querySelector('.setting-item-name');
					const descEl = setting.settingEl.querySelector('.setting-item-description');
					if (nameEl) 
						nameEl.textContent = vars.isFolderMode ? 'Encrypt external folders' : 'Encrypt external files'; 
					if (descEl) 
						descEl.textContent = vars.isFolderMode ? 'Select and encrypt folders, including all nested files' : 'Select files from your device to secure with encryption';
					

					buttons.select?.setButtonText(vars.isFolderMode ? 'Select folders' : 'Select files');
				});
			})
			.addButton((button) => {
				buttons.select = button
					.setButtonText(vars.isFolderMode ? 'Select folders' : 'Select files')
					.onClick(async () => {
						const title = `Select ${vars.isFolderMode ? 'folders' : 'files'} to encrypt`;
						const properties = [ vars.isFolderMode ? 'openDirectory' : 'openFile', 'multiSelections'];

						const paths = await StorageService.openDialog(title, properties);
						if (!paths)
							return;

						vars.selectedPaths = paths;
						button.setTooltip(paths.join('\n'));
						button.removeCta();

						if (buttons.output?.buttonEl.disabled)
							buttons.output.setDisabled(false).setCta();
					});

				if (vars.selectedPaths?.length) {
					button.setTooltip(vars.selectedPaths.join('\n'));
					button.removeCta();
				} else 
					button.setCta();
			})
			.addButton((button) => {
				buttons.output = button
					.setButtonText('Output file')
					.onClick(async () => {
						const out = await StorageService.openSaveDialog(
							'Select a folder and name your encrypted file',
							`Packed ${getTimeStamp()}`
						);
						if (!out)
							return;

						vars.outputPath = out;
						button.setTooltip(out);
						button.removeCta();
						buttons.encrypt?.setDisabled(false).setCta();
					});

				if (!vars.selectedPaths?.length)
					button.setDisabled(true);
				else if (vars.outputPath)
					button.setTooltip(vars.outputPath).removeCta();
				else
					button.setCta().setDisabled(false);
			})
			.addButton((button) => {
				buttons.encrypt = button
					.setButtonText('Encrypt')
					.onClick(async () => {
						const ok = await FilePackEncrypt.packAndEncryptItems(this.plugin, vars.selectedPaths ?? '', vars.outputPath ?? '');
						if (!ok)
							return;

						button.setDisabled(true).removeCta();
						buttons.output?.setDisabled(true);
						buttons.select?.setCta();
					});

				if (vars.outputPath)
					button.setCta().setDisabled(false);
				else
					button.setDisabled(true);
			});
	}

	// -------------------- DECRYPT PACK --------------------
	private renderDecryptPack(setting: Setting): void {
		const buttons: {
			select: ButtonComponent | null;
			output: ButtonComponent | null;
			decrypt: ButtonComponent | null;
		} = { select: null, output: null, decrypt: null };
		const vars = this.decryptPackVars;

		setting
			.addButton((button) => {
				buttons.select = button
					.setButtonText('Select .fpack')
					.onClick(async () => {
						const extensions = [{ name: 'Frog Pack', extensions: ['fpack'] }];
						const paths = await StorageService.openDialog(
							'Select a .fpack file to decrypt',
							['openFile'],
							extensions
						);
						if (!paths)
							return;

						const selected = paths[0] ?? null;
						if (!selected)
							return;

						vars.selectedPath = selected;
						button.setTooltip(selected);
						button.removeCta();

						if (buttons.output?.buttonEl.disabled)
							buttons.output.setDisabled(false).setCta();
					});

				if (vars.selectedPath) {
					button.setTooltip(vars.selectedPath);
					button.removeCta();
				} else 
					button.setCta();
			})
			.addButton((button) => {
				buttons.output = button
					.setButtonText('Output folder')
					.onClick(async () => {
						const paths = await StorageService.openDialog('Select a folder to decrypt', ['openDirectory']);
						if (!paths)
							return;

						const out = paths[0] ?? null;
						if (!out)
							return;

						vars.outputPath = out;
						button.setTooltip(out);
						button.removeCta();
						buttons.decrypt?.setDisabled(false).setCta();
					});

				if (!vars.selectedPath)
					button.setDisabled(true);
				else if (vars.outputPath)
					button.setTooltip(vars.outputPath).removeCta();
				else
					button.setCta().setDisabled(false);
			})
			.addButton((button) => {
				buttons.decrypt = button
					.setButtonText('Decrypt')
					.onClick(async () => {
						const ok = await FilePackEncrypt.decryptAndUnpack(this.plugin, vars.selectedPath ?? '', vars.outputPath ?? '');
						if (!ok)
							return;

						button.setDisabled(true).removeCta();
						buttons.output?.setDisabled(true);
						buttons.select?.setCta();
					});

				if (vars.outputPath)
					button.setCta().setDisabled(false);
				else
					button.setDisabled(true);
			});
	}

	// -------------------- COMPRESSION --------------------
	private renderCompression(setting: Setting): void {
		let compressionButton: ButtonComponent | null = null;

		setting
			.addDropdown((dropdown) => {
				const modes: Record<compressionMode, string> = {
					always: 'Always compress',
					never: 'Never compress',
					by_extension: 'Compress by extension',
				};
				dropdown.addOptions(modes);
				dropdown.setValue(SettingsService.getCompressionMode());
				dropdown.onChange(async (value) => {
					await SettingsService.setCompressionMode(value as compressionMode);

					if (!compressionButton)
						return;

					if (value === 'by_extension') {
						compressionButton.setCta();
						compressionButton.buttonEl.disabled = false;
					} else {
						compressionButton.removeCta();
						compressionButton.buttonEl.disabled = true;
					}
				});
			})
			.addButton((button) => {
				compressionButton = button
					.setButtonText('Configure extensions')
					.onClick(() => {
						new CompressionExtensionModal(this.app).open();
					});

				if (SettingsService.getCompressionMode() !== 'by_extension') {
					button.buttonEl.disabled = true;
					button.removeCta();
				} else 
					button.setCta();
				
			});
	}

	// =========================================================================
	// HELPERS
	// =========================================================================
	private refreshSettings(): void {
		const tab = this as unknown as VersionedSettingTab;

		if (this.isModernObsidian()) 
			tab.refreshDomState?.();
		else 
			tab.display?.();
		
	}

	private isModernObsidian(): boolean {
		const [major = 0, minor = 0] = apiVersion.split('.').map(Number);
		return major > 1 || (major === 1 && minor >= 13);
	}
}

interface VersionedSettingTab {
	display?: () => void;
	refreshDomState?: () => void;
}