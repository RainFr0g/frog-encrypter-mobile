import { Notice, Menu, Editor, MarkdownView } from 'obsidian';
import { IFrogEncrypter } from '../../utils/types';
import { CryptoService } from '../../utils/CryptoService';
import { getEncryptPasswordModal } from '../../modals/EncryptPasswordModal';
import { getEncryptInsertPasswordModal } from '../../modals/EncryptInsertPasswordModal';
import { getDecryptPasswordModal } from '../../modals/DecryptPasswordModal';
import { getDecryptResultModal } from '../../modals/DecryptResultModal';
import { persistPasswordAndCache, probeSavedPasswords } from './EncryptHelper';
import { SECRET_START, SECRET_END, SECRET_REGEX} from '../../utils/constants'
import { isValidBase64 } from '../../utils/misc';
import { PasswordManager } from '../../utils/PasswordManager';

export class InplaceEncryptHelper {

    static init(plugin: IFrogEncrypter): void {
        plugin.registerEvent(
            plugin.app.workspace.on(
                'editor-menu',
                (menu: Menu, editor: Editor) => {
                    this.onEditorContextMenu(plugin, menu, editor);
                }
            )
        );

        plugin.addCommand({ id: 'frog-encrypt-selection', name: 'Encrypt selection', icon: 'lock',
            editorCheckCallback: (checking: boolean, editor: Editor) => {
                if (!editor.somethingSelected())
                    return false;
                if (!checking)
                    void this.showSelectedEncryptModal(plugin, editor);

                return true;
            }
        });

        plugin.addCommand({id: 'frog-insert-encrypt', name: 'Insert encrypted text', icon: 'lock-keyhole',
            editorCallback: async (editor: Editor) => {
                await this.showInsertEncryptModal(plugin, editor);
            }
        });
    }
    
    static getSecretIcon(plugin: IFrogEncrypter, encryptedText: string): HTMLElement {
        const element = createSpan();
        element.className = 'frog-secret-icon';
        element.setAttribute('data-encrypted-text', encryptedText);

        element.addEventListener('mousedown', (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
        });

        element.addEventListener('mouseup', (event: MouseEvent) => {
            if (event.button !== 0) 
                return;
            void this.showDecryptModal(plugin, encryptedText);
        });

        element.addEventListener('contextmenu', (event: MouseEvent) => {
            event.preventDefault();
            this.openDecryptContextMenuAt(plugin, event, encryptedText);
        });

        return element;
    }

    private static openDecryptContextMenuAt(plugin: IFrogEncrypter, event: MouseEvent, encryptedText: string): void {
        const menu = new Menu();
        menu.addItem((item) =>
            item
                .setTitle('Decrypt')
                .setIcon('lock-keyhole-open')
                .onClick(() => void this.showDecryptModal(plugin, encryptedText))
        );
        menu.addItem((item) =>
            item
                .setTitle('Decrypt and copy')
                .setIcon('copy')
                .onClick(() => void this.showDecryptModal(plugin, encryptedText, true))
        );
        menu.showAtPosition({ x: event.clientX, y: event.clientY });
    }

    private static onEditorContextMenu(plugin: IFrogEncrypter, menu: Menu, editor: Editor): void {
        const hasSelection = editor.somethingSelected();

        menu.addItem((item) =>
            item
                .setTitle('Encrypt selection')
                .setIcon('lock-keyhole')
                .setDisabled(!hasSelection)
                .onClick(() =>  void this.showSelectedEncryptModal(plugin, editor))
        );
        menu.addItem((item) =>
            item
                .setTitle('Insert encrypted text')
                .setIcon('pencil')
                .onClick(() =>
                    void this.showInsertEncryptModal(plugin, editor))
        );
    }

    private static async showSelectedEncryptModal(plugin: IFrogEncrypter, editor: Editor): Promise<void> {
        const selectedText = editor.getSelection();
        if (!selectedText) {
            new Notice('❌ Select some text first!');
            return;
        }

        const { password, hint, hasConfirmed } = await getEncryptPasswordModal(plugin.app)
        if (!hasConfirmed) 
            return;

        const encryptedText = await this.encryptAndFormatText(selectedText, password, hint);
        editor.replaceSelection(encryptedText);
    }

    private static async showInsertEncryptModal(plugin: IFrogEncrypter, editor: Editor): Promise<void> {
        const { textToEncrypt, password, hint, hasConfirmed } = await getEncryptInsertPasswordModal(plugin.app);
        if (!hasConfirmed) 
            return;
        
        const encryptedText = await this.encryptAndFormatText(textToEncrypt, password, hint);
        editor.replaceSelection(encryptedText);
    }

    private static async encryptAndFormatText(textToEncrypt: string, password: string, hint: string = ''): Promise<string> {
        const crypto = new CryptoService();
        const encryptedText = await crypto.encryptToBase64(textToEncrypt, password, true);
        
        const cryptoCache = crypto.getCurrentCache();
        if(cryptoCache)
            PasswordManager.storeCache(cryptoCache);

        const hintRow = hint !== '' ? `${hint} ` : '';
        const result = `${SECRET_START}${hintRow}${encryptedText}${SECRET_END}`;
        return result;
    }

    private static async showDecryptModal(plugin: IFrogEncrypter, textToDecrypt: string, isCopyMode: boolean = false): Promise<void> {
        const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) 
            return;

        const encryptedContent = this.parseEncryptedText(textToDecrypt);
        if (!encryptedContent.isValid) {
            new Notice('❌ Failed to parse secret: invalid format!');
            return;
        }

        const crypto = new CryptoService();
        const cache = await probeSavedPasswords(crypto, encryptedContent.cipher, true);
        const { password, hasConfirmed } = !cache ? await getDecryptPasswordModal(plugin.app, encryptedContent.hint) : {password: cache.password, hasConfirmed: true};
        if (!hasConfirmed) 
            return;

        const decryptedText = !cache ? await crypto.decryptToString(encryptedContent.cipher, password, true) : cache.result;
        if (decryptedText === null) {
            new Notice('❌ Decryption failed!');
            return;
        }

        if (!cache)
		    persistPasswordAndCache(crypto, password);

        if (isCopyMode) {
            await navigator.clipboard.writeText(decryptedText);
            new Notice('✅ Copied to clipboard!');
            return;
        }
        await this.showDecryptedText(plugin, decryptedText, encryptedContent.hint, password, textToDecrypt);
    }

    private static async showDecryptedText(plugin: IFrogEncrypter, decryptedText: string, hint: string, password: string, oldSecretBlock: string): Promise<void> {
        const {editedDecryptedText, isDecryptionRequired, isSaveRequired, hasConfirmed}= await getDecryptResultModal( plugin.app, decryptedText);
        if (!hasConfirmed) 
            return;

        const editor = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
        if (!editor) 
            return;
        

        const originalCursor = editor.getCursor();
        const fullText = editor.getValue();
                
        let foundIndex = fullText.indexOf(oldSecretBlock);
                
        if (foundIndex === -1) {
            const oldCipher = oldSecretBlock
                .replace(new RegExp(`^${SECRET_START}`), '')
                .replace(new RegExp(`${SECRET_END}$`), '')
                .trim();

            const regex = SECRET_REGEX;
            let match;
            while ((match = regex.exec(fullText)) !== null) {
                const currentBlock = match[0];
                const currentCipher = currentBlock
                    .replace(new RegExp(`^${SECRET_START}`), '')
                    .replace(new RegExp(`${SECRET_END}$`), '')
                    .trim();
                
                if (currentCipher === oldCipher) {
                    foundIndex = match.index;
                    break;
                }
            }
        }

        let textToInsert: string;
        if (isDecryptionRequired) 
            textToInsert = editedDecryptedText;
        else if (isSaveRequired) 
            textToInsert = await this.encryptAndFormatText(editedDecryptedText, password, hint);
        else 
            return;
        

        if (foundIndex === -1) {
            editor.replaceSelection(textToInsert);
            new Notice(isDecryptionRequired ? '🔓 Decrypted!' : '🔒 Encrypted and saved!');
                    
            const newCursor = editor.getCursor();
            editor.setCursor(newCursor);
            return;
        }

        const beforeText = fullText.substring(0, foundIndex);
        const lines = beforeText.split('\n');
        const line = lines.length - 1;
        const ch = lines[lines.length - 1]?.length ?? 0;

        const fromPosition = { line, ch };
        const toPosition = { line, ch: ch + oldSecretBlock.length };

        editor.setSelection(fromPosition, toPosition);
        editor.replaceSelection(textToInsert);
                
        const newTextLength = textToInsert.length;

        if (originalCursor.line === line && originalCursor.ch >= ch) {
            const newCh = ch + newTextLength;
            editor.setCursor({ line, ch: newCh });
        } else 
            editor.setCursor(originalCursor);
        
        new Notice(isDecryptionRequired ? '🔓 Decrypted!' : '🔒 Encrypted and saved!');
    }

    private static parseEncryptedText(encryptedText: string): { cipher: string; hint: string; isValid: boolean } {
        const invalid = { cipher: '', hint: '', isValid: false };

        const regexMultiple = new RegExp(`${SECRET_START}[\\s\\S]*?${SECRET_END}[\\s\\S]*?${SECRET_START}`);
        if (regexMultiple.test(encryptedText)) 
            return invalid;

        if (!encryptedText.startsWith(SECRET_START) || !encryptedText.endsWith(SECRET_END)) 
            return invalid;

        const content = encryptedText.slice(SECRET_START.length, -SECRET_END.length).trim();

        let hint = '';
        let cipher = content;
        const spaceIndex = content.indexOf(' ');
        if (spaceIndex !== -1) {
            hint = content.slice(0, spaceIndex);
            cipher = content.slice(spaceIndex + 1).trim();
        }

        if (!cipher || !isValidBase64(cipher)) 
            return invalid;

        return { cipher, hint, isValid: true };
    }
}