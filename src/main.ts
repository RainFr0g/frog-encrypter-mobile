import { Notice, Plugin } from 'obsidian';
import { IFrogEncrypter } from './utils/types';
import { PasswordManager } from './utils/PasswordManager';
import { SettingsService } from './settings/SettingsService';
import { InplaceEncrypt } from './core/InplaceEncrypt';
import { FileEncrypt } from './core/FileEncrypt';
import { MdencView } from './core/views/MdencView';

export default class FrogEncrypter extends Plugin implements IFrogEncrypter {

	async onload() {
		await SettingsService.init(this);
		PasswordManager.init();

		new InplaceEncrypt(this);
		new FileEncrypt(this);
		
		this.addRibbonIcon('eraser', 'Clear saved passwords', ()=> {
			PasswordManager.clearPasswords(); 
			new Notice('✅ All passwords have been cleared!',1500);
		});
		this.addCommand({id: 'frog-clear-saved-password', name: 'Clear saved passwords', callback: ()=> {
			PasswordManager.clearPasswords(); 
			new Notice('✅ All passwords have been cleared!',1500);
		}});
	}
	
	onunload() {
		PasswordManager.unInit();
		SettingsService.unInit();
		MdencView.forceRemoveSetViewStateGuard();
	}
}