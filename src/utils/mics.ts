import { HINT_MAX_BYTES } from "./constants";

export function getTimeStamp(): string {
	return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function bytesToBase64(bytes: Uint8Array): string {
	const size = 0x7fff;
	let binary = '';
	for (let i = 0; i < bytes.length; i += size) 
		binary += String.fromCharCode(...bytes.subarray(i, i + size));
	
	return btoa(binary).replace(/=+$/, '');
}

export function base64ToBytes(base64: string): Uint8Array {
	const padding = base64.length % 4;
	const normalized = padding ? base64 + '='.repeat(4 - padding) : base64;
	const binary = atob(normalized);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) 
		bytes[i] = binary.charCodeAt(i);

	return bytes;
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = bytes.buffer;
    if (buffer instanceof ArrayBuffer) 
        return buffer;
	
    throw new Error('Uint8Array.buffer is not ArrayBuffer');
}

function hintHash(bytes: Uint8Array): number {
	let hash = 0x811C9DC5;
	for (const byte of bytes) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193);
	}
	return hash & 0xFFFF;
}

export function encodeHint(text: string): string {
	if (!text) 
		return '';

	const bytes = truncateUtf8(new TextEncoder().encode(text), HINT_MAX_BYTES);

	const hash = hintHash(bytes);
	const payload = new Uint8Array(3 + bytes.length);
	payload[0] = bytes.length;
	payload[1] = (hash >>> 8) & 0xFF;
	payload[2] = hash & 0xFF;
	payload.set(bytes, 3);

	return bytesToBase64(payload);
}

export function decodeHint(base64: string): string {
	try {
		const bytes = base64ToBytes(base64);
		if (bytes.length < 3) 
			return '';

		const length = bytes[0]!;
		if (bytes.length !== 3 + length) 
			return '';

		const expectedHash = (bytes[1]! << 8) | bytes[2]!;
		const textBytes = bytes.subarray(3);
		if (hintHash(textBytes) !== expectedHash) 
			return '';

		return new TextDecoder().decode(textBytes);
	} catch {
		return '';
	}
}

export function truncateUtf8(bytes: Uint8Array, maxBytes: number): Uint8Array {
	if (bytes.length <= maxBytes) 
		return bytes;

	const decoder = new TextDecoder('utf-8', { fatal: true });
	let truncated = bytes.slice(0, maxBytes);

	while (truncated.length > 0) {
		try {
			decoder.decode(truncated);
			return truncated;
		} catch {
			truncated = truncated.slice(0, -1);
		}
	}

	return truncated;
}

export function isValidBase64(base64: string): boolean {
    const normalized = base64.replace(/\s/g, '');
    if (!normalized) 
        return false;

    if (!/^[A-Za-z0-9+/]*$/.test(normalized)) 
        return false;

    const padding = normalized.length % 4;
    const paddedLength = padding ? normalized.length + (4 - padding) : normalized.length;
    if (paddedLength % 4 !== 0) 
        return false;

    return true;
}

export function bytesEquals(a: Uint8Array | null, b: Uint8Array | null): boolean {
	if (!a || !b) 
		return false;
	if (a.length !== b.length) 
		return false;

	for (let i = 0; i < a.length; i++) 
		if (a[i] !== b[i]) return false;
	
	return true;
}

export function formatBytes(bytes: number): string {
	const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
	let unitIndex = 0;

	while (bytes >= 1024 && unitIndex < units.length - 1) {
		bytes /= 1024;
		unitIndex++;
	}

	const digits = unitIndex === 0 ? 0 : 1;

	return `${bytes.toFixed(digits)} ${units[unitIndex]}`;
}

export function safeEndIndex(data: string, end: number): number {
	let endIndex = Math.min(end, data.length);

	if (endIndex > 0 && endIndex < data.length && isHighSurrogate(data.charCodeAt(endIndex - 1))) 
		endIndex += 1;
	

	return endIndex;
}

function isHighSurrogate(c: number): boolean {
	return c >= 0xd800 && c <= 0xdbff;
}

export function nextFrame(): Promise<void> {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
