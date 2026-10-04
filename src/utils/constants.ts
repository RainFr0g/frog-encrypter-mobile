export const VECTOR_SIZE = 12;
export const SALT_SIZE = 16;
export const PBKDF2_ITERATIONS = 200_000;
export const HINT_MAX_BYTES = 255;					// 1 Byte

export const CHUNK_SIZE = 4 * 1024 * 1024;          // 4 MB
export const JSON_SIZE_BYTES = 4;                   // 4 Bytes

export const MD_ENCRYPTED_EXTENSION = 'mdenc';
export const FILE_ENCRYPTED_EXTENSION = 'fenc';
export const MD_VIEW_TYPE = 'frog-mdenc-view';
export const FILE_VIEW_TYPE = 'frog-file-view';

export const SECRET_SYMBOL = '🔒';
export const SECRET_START = SECRET_SYMBOL + 'secret ';
export const SECRET_END = SECRET_SYMBOL;
export const SECRET_REGEX = new RegExp(`${SECRET_START}[^${SECRET_SYMBOL}\\r\\n]*${SECRET_END}`, 'gu');

export const COMPRESS_INDEX = true;

export const OTHER_EXTENSIONS = ' OTHER_EXTENSIONS';

export const MIME_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	bmp: 'image/bmp',
	svg: 'image/svg+xml',
	webp: 'image/webp',
	avif: 'image/avif',
	gif: 'image/gif',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	m4a: 'audio/mp4',
	flac: 'audio/flac',
	oga: 'audio/ogg',
	ogg: 'audio/ogg',
	opus: 'audio/opus',
	'3gp': 'audio/3gpp',
	mp4: 'video/mp4',
	webm: 'video/webm',
	mov: 'video/quicktime',
	mkv: 'video/x-matroska',
	ogv: 'video/ogg',
	pdf: 'application/pdf',
	canvas: 'application/json',
};