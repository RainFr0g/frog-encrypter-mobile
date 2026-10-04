declare module 'obsidian' {
    interface Vault {
        getConfig(key: string): unknown;
        setConfig(key: string, value: unknown): void;
    }
}

declare global {
	interface Window {
		require(module: 'electron'): {remote?: {dialog: ElectronDialog}; dialog: ElectronDialog;};
		require(module: 'fs'): typeof import('fs');
		require(module: 'path'): typeof import('path');
		require(module: 'os'): { homedir(): string };
		require(module: 'buffer'): {
			Buffer: {
				alloc(size: number): Uint8Array;
				from(data: string, encoding: string): Uint8Array;
				readUInt32LE(offset: number): number;
				writeUInt32LE(value: number, offset: number): void;
			};
		};
	}
}

export interface ElectronDialog {
	showOpenDialog(options: ElectronOpenDialogOptions): Promise<ElectronOpenDialogResult>;
	showSaveDialog(options: ElectronSaveDialogOptions): Promise<ElectronSaveDialogResult>;
}

interface ElectronSaveDialogOptions {
	title: string;
	defaultPath?: string;
	properties?: string[];
	filters?: Array<{ name: string; extensions: string[] }>;
}

interface ElectronSaveDialogResult {
	canceled: boolean;
	filePath?: string;
}

interface ElectronOpenDialogOptions {
	title: string;
	properties: string[];
	filters?: Array<{ name: string; extensions: string[] }>;
}

interface ElectronOpenDialogResult {
	canceled: boolean;
	filePaths: string[];
}