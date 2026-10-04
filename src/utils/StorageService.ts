import { ElectronDialog } from './electron';
import { IFrogEncrypter, PackIndex } from './types';

export class StorageService {
	private static get dialog(): ElectronDialog {
		const electron = window.require('electron');
		return (electron.remote ? electron.remote.dialog : electron.dialog);
	}
	private static get os() {
		return window.require('os');
	}
	public static get path() {
		return window.require('path');
	}
	public static get fs() {
		return window.require('fs');
	}

	static getUniqueVaultPath(plugin: IFrogEncrypter, path: string): string {
		return this.buildUniquePath(path, (p) => plugin.app.vault.getAbstractFileByPath(p) !== null);
	}

	static getUniqueDiskPath(path: string): string {
		return this.buildUniquePath(path, (p) => StorageService.fs.existsSync(p));
	}

	private static buildUniquePath(path: string, exists: (p: string) => boolean): string {
		if (!exists(path)) return path;

		const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
		const dot = path.lastIndexOf('.');
		const hasExt = dot > slash;
		const body = hasExt ? path.slice(0, dot) : path;
		const ext = hasExt ? path.slice(dot) : '';

		let i = 1;
		while (exists(`${body} (${i})${ext}`)) 
			i++;

		return `${body} (${i})${ext}`;
	}

	static async openDialog(title: string, properties: string[], extensions?: Array<{ name: string; extensions: string[] }>): Promise<string[] | null> {
		try {
			const result = await StorageService.dialog.showOpenDialog({ title, properties, filters: extensions });
			return result.canceled ? null : result.filePaths;
		} catch {
			return null;
		}
	}

	static async openSaveDialog(title: string, defaultFileName: string, filters?: Array<{ name: string; extensions: string[] }>): Promise<string | null> {
		try {
			const result = await StorageService.dialog.showSaveDialog({
				title, 
				defaultPath: defaultFileName,
				filters: filters ?? [{ name: 'Frog Pack', extensions: ['fpack']}]
			});
			return result.canceled ? null : (result.filePath ?? null);
		} catch { 
			return null;
		}
	}

	static createDiskFolder(folderPath: string, created: Set<string>): void {
		if (created.has(folderPath)) 
			return;

		const fs = window.require('fs');

		if (!fs.existsSync(folderPath)) 
			fs.mkdirSync(folderPath, { recursive: true });
		
		created.add(folderPath);
	}
	
	static getVaultPath(plugin: IFrogEncrypter): string {
		const adapter = plugin.app.vault.adapter as { basePath?: string };
		return adapter.basePath ?? '';
	}

	static getVaultOptions(plugin: IFrogEncrypter): Record<string, string> {
		const options: Record<string, string> = {};
		const configDir = plugin.app.vault.configDir;

		try {
			const homeDir = this.os.homedir();

			const possiblePaths = [
				this.path.join(homeDir, configDir, 'obsidian.json'),
				this.path.join(homeDir, 'AppData', 'Roaming', 'obsidian', 'obsidian.json'),
				this.path.join(homeDir, 'Library', 'Application Support', 'obsidian', 'obsidian.json'),
				this.path.join(homeDir, '.config', 'obsidian', 'obsidian.json')
			];

			for (const configPath of possiblePaths) {
				if (this.fs.existsSync(configPath)) {
					const configContent = this.fs.readFileSync(configPath, 'utf-8');
					const config = JSON.parse(configContent) as {vaults?: Record<string, { path: string }>};

					if (config.vaults) {
						for (const vaultData of Object.values(config.vaults)) {
							if (vaultData.path) {
								const vaultName = vaultData.path.split(/[\\/]/).pop() ?? 'Unknown';
								options[vaultData.path] = vaultName;
							}
						}
					}
				}
			}
		} catch (error) {
			console.error('Failed to get vault options:', error);
		}

		return options;
	}
	
	public static scanPaths(paths: string[],
		fileList: Array<{
			fullPath: string;
			archivePath: string;
			size: number;
		}>, folderPaths: PackIndex['folderPaths'], parentArchivePath: string = ''
	): void {
		for (const p of paths) {
			const stat = this.fs.statSync(p);
			const name = this.path.basename(p);

			const archivePath = parentArchivePath ? this.path.join(parentArchivePath, name)	: name;

			if (stat.isDirectory()) {
				const entries = this.fs.readdirSync(p, { withFileTypes: true });
				folderPaths.push(archivePath);
				
				const nestedPaths = entries.map((e) => this.path.join(p, e.name));
				this.scanPaths(nestedPaths, fileList, folderPaths, archivePath);
			} else 
				fileList.push({ fullPath: p, archivePath: archivePath, size: stat.size });
		}
	}
}