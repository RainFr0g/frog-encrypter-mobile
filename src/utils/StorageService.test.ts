import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import * as nodeOs from 'node:os';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { StorageService } from './StorageService';

let testDir: string;

beforeAll(() => {
    (globalThis as { window?: unknown }).window = {
        require: (module: string) => {
            if (module === 'fs') return nodeFs;
            if (module === 'path') return nodePath;
            if (module === 'os') return nodeOs;
            throw new Error(`Unknown module: ${module}`);
        },
    };
    testDir = join(tmpdir(), `frog-storage-${randomUUID()}`);
    nodeFs.mkdirSync(testDir, { recursive: true });
});

afterAll(() => {
    delete (globalThis as { window?: unknown }).window;
    try { nodeFs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('StorageService.getUniqueDiskPath', () => {
    test('returns path unchanged when file does not exist', () => {
        const path = join(testDir, 'unique.txt');
        expect(StorageService.getUniqueDiskPath(path)).toBe(path);
    });

    test('adds (1) when file exists', () => {
        const path = join(testDir, 'collision.txt');
        nodeFs.writeFileSync(path, 'x');
        expect(StorageService.getUniqueDiskPath(path)).toBe(
            join(testDir, 'collision (1).txt')
        );
    });

    test('increments (2), (3), ... for multiple collisions', () => {
        const path = join(testDir, 'multi.txt');
        nodeFs.writeFileSync(path, 'x');
        nodeFs.writeFileSync(join(testDir, 'multi (1).txt'), 'x');
        nodeFs.writeFileSync(join(testDir, 'multi (2).txt'), 'x');
        expect(StorageService.getUniqueDiskPath(path)).toBe(
            join(testDir, 'multi (3).txt')
        );
    });

    test('handles file with no extension', () => {
        const path = join(testDir, 'noext');
        nodeFs.writeFileSync(path, 'x');
        expect(StorageService.getUniqueDiskPath(path)).toBe(
            join(testDir, 'noext (1)')
        );
    });

    test('handles file with multiple dots', () => {
        const path = join(testDir, 'archive.tar.gz');
        nodeFs.writeFileSync(path, 'x');
        expect(StorageService.getUniqueDiskPath(path)).toBe(
            join(testDir, 'archive.tar (1).gz')
        );
    });

    test('handles dot in directory name', () => {
        const subdir = join(testDir, 'my.folder');
        nodeFs.mkdirSync(subdir, { recursive: true });
        const path = join(subdir, 'file.txt');
        nodeFs.writeFileSync(path, 'x');
        expect(StorageService.getUniqueDiskPath(path)).toBe(
            join(subdir, 'file (1).txt')
        );
    });

    test('handles unicode filename', () => {
        const path = join(testDir, 'file-🔒.txt');
        nodeFs.writeFileSync(path, 'x');
        expect(StorageService.getUniqueDiskPath(path)).toBe(
            join(testDir, 'file-🔒 (1).txt')
        );
    });

    test('handles file without extension but with dot in name', () => {
        const path = join(testDir, 'my.backup');
        nodeFs.writeFileSync(path, 'x');
        expect(StorageService.getUniqueDiskPath(path)).toBe(
            join(testDir, 'my (1).backup')
        );
    });
});