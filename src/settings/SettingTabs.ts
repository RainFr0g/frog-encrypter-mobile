import { ButtonComponent, PluginSettingTab, Setting, SettingDefinitionItem, apiVersion } from 'obsidian';
import { compressionMode, IFrogEncrypter } from '../utils/types';
import { SettingsService } from './SettingsService';
import { PasswordManager } from '../utils/PasswordManager';
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