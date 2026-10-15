import { IFrogEncrypter } from './types';

export class StorageService {

	static getUniqueVaultPath(plugin: IFrogEncrypter, path: string): string {
		return this.buildUniquePath(path, (p) => plugin.app.vault.getAbstractFileByPath(p) !== null);
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
}