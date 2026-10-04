import { compressionMode } from "../utils/types";
import { OTHER_EXTENSIONS } from "../utils/constants";
export interface Settings 
{
    confirmPassword:boolean;
    rememberPasswordsInMemory: boolean;
    autofillLastPassword: boolean;
    passwordTtlMinutes:number;
    compressionMode: compressionMode;
    compressibleExtensions: Map<string, boolean>;
}

export const DEFAULT_SETTINGS : Settings = 
{
    confirmPassword: true,
    rememberPasswordsInMemory: true,
    autofillLastPassword: true,
    passwordTtlMinutes: 5,
    compressionMode: 'by_extension',
    compressibleExtensions: new Map([[OTHER_EXTENSIONS, true], 
        ['txt', true], ['log', true], ['rtf', true], ['tex', true], ['latex', true], 
        ['js', true], ['jsx', true], ['ts', true], ['tsx', true], ['css', true], 
        ['scss', true], ['html', true], ['htm', true], ['py', true], ['rb', true], 
        ['go', true], ['rs', true], ['java', true], ['c', true], ['cpp', true], 
        ['h', true], ['php', true], ['swift', true], ['kt', true], ['lua', true], 
        ['r', true], ['m', true], ['sh', true], ['bash', true], ['json', true], 
        ['csv', true], ['xml', true], ['yaml', true], ['yml', true], ['toml', true], 
        ['ini', true],['cfg', true],['md', true],['canvas', true],

        ['png', false], ['jpg',false], ['jpeg', false], ['gif', false], ['webp', false], ['avif', false], ['bmp', false],
        ['svg', false], ['mp3', false], ['wav', false], ['m4a', false], ['aac', false], ['flac', false], ['oga', false], ['ogg', false], ['opus', false],
        ['3gp', false], ['wma', false], ['aiff', false], ['alac', false],
        ['mp4', false], ['webm', false], ['mov', false], ['mkv', false], ['ogv', false], ['avi', false], ['wmv', false], ['flv', false],
        ['m4v', false], ['3gpp', false], ['pdf', false], ['docx', false], ['xlsx', false], ['pptx', false], ['odt', false], ['ods', false], ['odp', false],
        ['zip', false], ['rar', false], ['7z', false], ['gz', false], ['bz2', false], ['xz', false], ['tar', false],
        ['exe', false], ['dll', false], ['so', false], ['dylib', false], ['apk', false], ['ipa', false]])
    }