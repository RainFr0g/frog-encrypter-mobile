import 'obsidian';

declare module 'obsidian' {
    interface Vault {
        getConfig(key: string): unknown;
        setConfig(key: string, value: unknown): void;
    }
}