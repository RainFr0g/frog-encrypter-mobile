import { App, Modal, Notice, ButtonComponent } from 'obsidian';
import { SettingsService } from '../settings/SettingsService';
import { OTHER_EXTENSIONS } from '../utils/constants';

export class CompressionExtensionModal extends Modal {
	private compressibleExtensions: Map<string,boolean>;
	private compressSelectEl!: HTMLSelectElement;
	private skipSelectEl!: HTMLSelectElement;

	constructor(app: App) {
		super(app);
		this.compressibleExtensions = SettingsService.getCompressibleExtensions();
	}
    
	onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        const listsContainer = contentEl.createDiv({ cls: 'frog-compress-lists' });
       
		// =================== LEFT CONTAINER =======================================================================
        const leftContainer = listsContainer.createDiv({ cls: 'frog-compress-column' });
        leftContainer.createDiv({ text: 'Compress', cls: 'frog-compress-header' });

        this.compressSelectEl = leftContainer.createEl('select', {
            attr: { multiple: 'multiple' },
            cls: 'frog-compress-list',
        });
        this.compressSelectEl.addEventListener('change', ()=>
            this.clearSelection(this.skipSelectEl));

        const transferButtons = listsContainer.createDiv({ cls: 'frog-compress-buttons' });

        new ButtonComponent(transferButtons)
            .setIcon('move-right')
            .setTooltip('Move selected to skip compression')
            .onClick(() =>
                this.moveSelected(false)
            );
            
        new ButtonComponent(transferButtons)
            .setIcon('move-left')
            .setTooltip('Move selected to compress')
            .onClick(() =>
                this.moveSelected(true)
            );

        new ButtonComponent(transferButtons)
            .setIcon('trash')
            .setTooltip('Delete selected')
            .onClick(() => 
                this.deleteSelected()
            );

            
		// =================== RIGHT CONTAINER =======================================================================
        const rightContainer = listsContainer.createDiv({ cls: 'frog-compress-column' });
        rightContainer.createDiv({ text: 'Skip compress', cls: 'frog-compress-header' });

        this.skipSelectEl = rightContainer.createEl('select', {
            attr: { multiple: 'multiple'},
            cls: 'frog-compress-list',
        });
        this.skipSelectEl.addEventListener('change', ()=>this.clearSelection(this.compressSelectEl));


		// =================== INPUT ROW =============================================================================
        const addRow = contentEl.createDiv({ cls: 'frog-compress-add-row' });

        const inputEl = addRow.createEl('input', {
            type: 'text',
            placeholder: 'Enter extension (e.g., txt, md)',
            cls: 'frog-extension-input',
        });

        inputEl.addEventListener('input', () => {
            const cleaned = inputEl.value.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cleaned !== inputEl.value) 
                inputEl.value = cleaned;
        });

        new ButtonComponent(addRow)
            .setButtonText('Add to compress')
            .setCta()
            .onClick(() => {
                this.addExtension(inputEl.value, true);
                inputEl.value = '';
            });

        new ButtonComponent(addRow)
            .setButtonText('Add to skip')
            .setCta()
            .onClick(() => {
                this.addExtension(inputEl.value, false);
                inputEl.value = '';
            });

        this.refreshList();
	}

    private clearSelection(selectEl: HTMLSelectElement):void{
        Array.from(selectEl.selectedOptions).forEach(option => {
            option.selected = false;
        });
    }

	private refreshList() {
        this.compressSelectEl.empty();
        this.skipSelectEl.empty();
        
        const compressFragment = createFragment();
        const skipFragment = createFragment();

        const extensionArr = Array.from(this.compressibleExtensions.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        for(const [extension, toCompress] of extensionArr){
            const fragment = toCompress ? compressFragment : skipFragment;
            fragment.appendChild(new Option(extension,extension));
        }
        
        this.compressSelectEl.appendChild(compressFragment);
        this.skipSelectEl.appendChild(skipFragment);
	}

	private moveSelected(toCompress: boolean) {
        const fromSelectEl = toCompress ? this.skipSelectEl : this.compressSelectEl;

        for(const option of Array.from(fromSelectEl.selectedOptions)) 
            if(option.selected)
                this.compressibleExtensions.set(option.value, toCompress);
        
        this.refreshList();
	}

	private addExtension(newExtesion: string, toCompress: boolean) {
        if (newExtesion === '') 
            return;
        
		if (this.compressibleExtensions.has(newExtesion)) {
			new Notice('❌ This extension is already in the list!');
			return;
		} 
        
        this.compressibleExtensions.set(newExtesion, toCompress);
        this.refreshList();
	}

	private deleteSelected() {
        for(const option of Array.from(this.compressSelectEl.options)) 
            if(option.selected && option.value !== OTHER_EXTENSIONS) 
                this.compressibleExtensions.delete(option.value);

        for(const option of Array.from(this.skipSelectEl.options)) 
            if(option.selected && option.value !== OTHER_EXTENSIONS) 
                this.compressibleExtensions.delete(option.value);
            
        this.refreshList();
	}
    

	onClose() {
        void SettingsService.setCompressibleExtensions(this.compressibleExtensions);

		const { contentEl } = this;
		contentEl.empty();
	}
}
