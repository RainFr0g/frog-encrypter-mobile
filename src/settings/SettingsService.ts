import { DEFAULT_SETTINGS, Settings } from './Settings';
import { FrogPluginSettingTab } from './SettingTabs';
import { compressionMode, IFrogEncrypter } from '../utils/types';

export class SettingsService {
	private static plugin: IFrogEncrypter | null = null;
	private static settings: Settings | null = null;

	public static async init(plugin: IFrogEncrypter) {
		this.plugin = plugin;
		await this.loadSettings();
		plugin.addSettingTab(new FrogPluginSettingTab(plugin));
	}

	public static getConfirmPassword(): boolean {
		if(!this.settings)
			this.settings = this.cloneDefaults();

		return this.settings.confirmPassword;
	}
	public static getRememberPasswords(): boolean {
		if(!this.settings)
			this.settings = this.cloneDefaults();

		return this.settings.rememberPasswordsInMemory;
	}
	public static getAutofillLastPassword(): boolean {
		if(!this.settings)
			this.settings = this.cloneDefaults();
			
		return this.settings.autofillLastPassword;
	}
	public static getPasswordTtlMinutes(): number {
		if(!this.settings)
			this.settings = this.cloneDefaults();
		
		return this.settings.passwordTtlMinutes;
	}
	public static getCompressionMode(): compressionMode {
		if(!this.settings)
			this.settings = this.cloneDefaults();
		
		return this.settings.compressionMode;
	}
	public static getCompressibleExtensions(): Map<string, boolean> {
		if(!this.settings)
			this.settings = this.cloneDefaults();

		return this.settings.compressibleExtensions;
	}

	public static async setConfirmPassword(confrimPassword: boolean): Promise<void> {
		if (this.settings) 
			this.settings.confirmPassword = confrimPassword;
		
		await this.saveSettings();
	}
	public static async setRememberPasswordsInMemory(rememberPasswordsInMemory: boolean): Promise<void> {
		if (this.settings)
			this.settings.rememberPasswordsInMemory = rememberPasswordsInMemory;

		await this.saveSettings();
	}
	public static async setAutofillLastPassword(autofillLastPassword: boolean): Promise<void> {
		if (this.settings) 
			this.settings.autofillLastPassword = autofillLastPassword;

		await this.saveSettings();
	}
	public static async setPasswordTtlMinutes(passwordTtlMinutes: number): Promise<void> {
		if (this.settings)
			this.settings.passwordTtlMinutes = passwordTtlMinutes;

		await this.saveSettings();
	}
	public static async setCompressionMode(compressionMode: compressionMode): Promise<void> {
		if (this.settings) 
			this.settings.compressionMode = compressionMode;

		await this.saveSettings();
	}
	public static async setCompressibleExtensions(compressionExtensions: Map<string, boolean>): Promise<void> {
		if (this.settings)
			this.settings.compressibleExtensions = compressionExtensions;

		await this.saveSettings();
	}
	public static async addCompressibleExtension(extension: string, toCompress: boolean): Promise<void> {
		if (this.settings)
			this.settings.compressibleExtensions.set(extension, toCompress);

		await this.saveSettings();
	}

	private static async loadSettings() {
		if (!this.plugin) 
			return;

		const baseSettings =  this.cloneDefaults();
		const loadData = await this.plugin.loadData() as Partial<Settings>;
		if(loadData != null && loadData.compressibleExtensions != null)
			loadData.compressibleExtensions = new Map(Object.entries(loadData.compressibleExtensions));
		this.settings = Object.assign(
			{},
			baseSettings,
			loadData,
		);
			
		if(this.settings.compressibleExtensions.size === 0)
			this.settings.compressibleExtensions = new Map(baseSettings.compressibleExtensions);
	}

	static async saveSettings() {
		if (!this.plugin || !this.settings) 
			return;
		
			const dataToSave = {
				...this.settings,
				compressibleExtensions: Object.fromEntries(this.settings.compressibleExtensions)
			};
			await this.plugin.saveData(dataToSave)
	}
	private static cloneDefaults(): Settings {
		return { ...DEFAULT_SETTINGS, compressibleExtensions: new Map(DEFAULT_SETTINGS.compressibleExtensions) };
	}
	public static unInit() {
		this.plugin = null;
		this.settings = null;
	}
}
