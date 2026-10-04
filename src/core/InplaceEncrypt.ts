import { editorLivePreviewField } from 'obsidian';
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, WidgetType} from '@codemirror/view';
import { Extension, RangeSetBuilder } from '@codemirror/state';
import { IFrogEncrypter } from '../utils/types';
import { InplaceEncryptHelper } from './helpers/InplaceEncryptHelper';
import { SECRET_START, SECRET_REGEX } from '../utils/constants';

export class InplaceEncrypt {
    private plugin: IFrogEncrypter;

    constructor(plugin: IFrogEncrypter) {
        this.plugin = plugin;
        this.plugin.registerMarkdownPostProcessor((el) => this.processReadingView(el));
        this.plugin.registerEditorExtension(this.livePreviewExtension());

        InplaceEncryptHelper.init(plugin);
    }

    // =================== READING VIEW  =============================================================================
    private processReadingView(el: HTMLElement): void {
        const text = el.textContent || '';
        if (!text.includes(SECRET_START)) 
            return;
        
        this.replaceAllSecrets(el);
    }

    private replaceAllSecrets(el: HTMLElement): void {
        const walker = activeDocument.createTreeWalker(el,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node: Node): number => {
                    const text = node.textContent || '';
                    return text.includes(SECRET_START) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        const textNodes: Text[] = [];
        let node: Text | null;
        while ((node = walker.nextNode() as Text)) 
            textNodes.push(node);
        
        for (const textNode of textNodes) {
            const text = textNode.textContent || '';
            const parent = textNode.parentNode;
            if (!parent) 
                continue;

            const regex = SECRET_REGEX;
            let lastIndex = 0;
            let match;
            const fragment = createFragment();

            while ((match = regex.exec(text)) !== null) {
                if (match.index > lastIndex) 
                    fragment.appendChild(activeDocument.createTextNode(text.substring(lastIndex, match.index)));

                const icon = InplaceEncryptHelper.getSecretIcon(this.plugin, match[0]);
                fragment.appendChild(icon);

                lastIndex = match.index + match[0].length;
            }

            if (lastIndex < text.length) 
                fragment.appendChild(activeDocument.createTextNode(text.substring(lastIndex)));

            parent.replaceChild(fragment, textNode);
        }
    }

	// =================== LIVE PREVIEW =============================================================================
    private livePreviewExtension(): Extension {
        const plugin = this.plugin;

        return ViewPlugin.fromClass(
            class {
                decorations: DecorationSet;

                constructor(view: EditorView) {
                    this.decorations = this.buildDecorations(view);
                }

                update(update: ViewUpdate) {
                    if (!update.state.field(editorLivePreviewField)) {
                        this.decorations = Decoration.none;
                        return;
                    }

                    if (update.docChanged || update.viewportChanged || update.selectionSet) 
                        this.decorations = this.buildDecorations(update.view);
                }

                destroy(): void {}

                private buildDecorations(view: EditorView): DecorationSet {
                    if (!view.state.field(editorLivePreviewField)) 
                        return Decoration.none;
                    
                    const builder = new RangeSetBuilder<Decoration>();
                    const selection = view.state.selection;

                    for (const range of view.visibleRanges) {
                        const text = view.state.doc.sliceString(range.from, range.to);
                        
                        const regex = SECRET_REGEX;
                        let match;

                        while ((match = regex.exec(text)) !== null) {
                            const secretStart = range.from + match.index;
                            const secretEnd = range.from + match.index + match[0].length;

                            const selected = selection.ranges.some((r) => !(r.to <= secretStart || r.from >= secretEnd));
                            if (selected) 
                                continue;

                            builder.add(secretStart, secretEnd,
                                Decoration.replace({
                                    widget: new StaticWidget(InplaceEncryptHelper.getSecretIcon(plugin, match[0])),
                                    inclusive: true
                                })
                            );
                        }
                    }
                    return builder.finish();
                }
            },{
                decorations: (instance: { decorations: DecorationSet }) => instance.decorations
            }
        );
    }
}

// Widget wrapper for DOM elements
class StaticWidget extends WidgetType {
    private readonly element: HTMLElement;
    constructor(element: HTMLElement) {
        super();
        this.element = element;
    }

    toDOM(): HTMLElement {
        return this.element;
    }

    ignoreEvent(): boolean {
        return true;
    }
}