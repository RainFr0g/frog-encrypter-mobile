import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores } from 'eslint/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
	globalIgnores([
		'node_modules',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'result/main.js',
		'move-results.js',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
						'manifest.json',
						'vitest.config.mts'
					],
				},
				tsconfigRootDir: __dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		rules: {
			'obsidianmd/ui/sentence-case': 'off',
		},
	},{
    files: ['**/*.test.ts', 'src/__tests__/**/*.ts', 'vitest.config.mts'],
    rules: {
        'obsidianmd/no-global-this': 'off',
        '@typescript-eslint/unbound-method': 'off',
    	},
	},{
		files: ['vitest.config.mts', 'eslint.config.mts'],
		rules: {
			'obsidianmd/no-plugin-as-component': 'off',
			'obsidianmd/no-global-this': 'off',
			'@typescript-eslint/unbound-method': 'off',
		},
	},
);