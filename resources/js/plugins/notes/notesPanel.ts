/**
 * The Notes panel: one note, always ready to type in.
 *
 * Ported from `NotesPanel.java`, which is a single plain text area saving on blur. The difference
 * is that the editor is rich text, so the note can have headings, lists and colour.
 *
 * Plain DOM throughout: plugin panels mount into an element, so a plugin never imports the page's
 * UI framework. See `ui/clientToolbar`.
 */
import type { PluginPanel } from '../ui/clientToolbar';
import { createNotesEditor, type NotesEditorHandle } from './notesEditor';
import { loadNote, saveNote } from './notesStore';
import './notesPanel.css';

/** Quiet period after typing before the note is written. */
const SAVE_DEBOUNCE_MS = 600;

export class NotesPanel implements PluginPanel {
    private editor: NotesEditorHandle | null = null;

    private saveTimer: number | null = null;
    private detach: (() => void) | null = null;

    mount(host: HTMLElement): void {
        const root = document.createElement('div');
        root.className = 'flx-notes';

        this.editor = createNotesEditor(() => this.queueSave());
        this.editor.setHTML(loadNote());

        root.append(this.editor.element);
        host.appendChild(root);

        // Writing on blur is the original's behaviour and worth keeping: the debounce covers
        // typing, this covers clicking straight from the editor to something else.
        const onBlur = () => this.flush();
        root.addEventListener('focusout', onBlur);
        this.detach = () => root.removeEventListener('focusout', onBlur);
    }

    unmount(): void {
        // Anything typed inside the debounce window would otherwise be lost on close.
        this.flush();
        this.detach?.();
        this.detach = null;
        this.editor?.destroy();
        this.editor = null;
    }

    private queueSave(): void {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
        }

        this.saveTimer = window.setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
    }

    private flush(): void {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }

        if (this.editor) {
            saveNote(this.editor.getHTML());
        }
    }
}
