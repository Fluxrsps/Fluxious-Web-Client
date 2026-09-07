/**
 * The rich text editor and its toolbar.
 *
 * Built on TipTap, which the site already uses for its markdown editor, but on `@tiptap/core`
 * directly rather than the Vue binding: plugin panels mount plain DOM, and a plugin should not
 * have to pull in the page's framework to show a text box.
 *
 * The toolbar is built from a table of buttons so adding one is a line rather than a block, and so
 * the active-state refresh can walk the same table instead of a hand-written list.
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import { Color, FontFamily, TextStyle } from '@tiptap/extension-text-style';

/** Offered in the colour picker; the client's own palette rather than a full colour wheel. */
const COLOURS: [string, string][] = [
    ['Default', ''],
    ['White', '#e8e2d6'],
    ['Yellow', '#ffff00'],
    ['Orange', '#ff981f'],
    ['Red', '#ff4444'],
    ['Green', '#4caf50'],
    ['Cyan', '#7fd4d4'],
];

const FONTS: [string, string][] = [
    ['Default', ''],
    ['RuneScape', 'RuneScape'],
    ['Sans', 'Inter, sans-serif'],
    ['Serif', 'Georgia, serif'],
    ['Mono', '"Courier New", monospace'],
];

interface ToolbarButton {
    label: string;
    title: string;
    /** Name TipTap knows the mark or node by, for the active-state check. */
    active: string;
    run(editor: Editor): void;
}

const BUTTONS: ToolbarButton[] = [
    { label: 'B', title: 'Bold', active: 'bold', run: (e) => e.chain().focus().toggleBold().run() },
    { label: 'I', title: 'Italic', active: 'italic', run: (e) => e.chain().focus().toggleItalic().run() },
    { label: 'U', title: 'Underline', active: 'underline', run: (e) => e.chain().focus().toggleUnderline().run() },
    { label: 'S', title: 'Strikethrough', active: 'strike', run: (e) => e.chain().focus().toggleStrike().run() },
    {
        label: 'H1',
        title: 'Heading',
        active: 'heading',
        run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
        label: 'H2',
        title: 'Subheading',
        active: 'heading',
        run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    { label: '•', title: 'Bullet list', active: 'bulletList', run: (e) => e.chain().focus().toggleBulletList().run() },
    { label: '1.', title: 'Numbered list', active: 'orderedList', run: (e) => e.chain().focus().toggleOrderedList().run() },
    { label: '"', title: 'Quote', active: 'blockquote', run: (e) => e.chain().focus().toggleBlockquote().run() },
    { label: '</>', title: 'Code block', active: 'codeBlock', run: (e) => e.chain().focus().toggleCodeBlock().run() },
];

export interface NotesEditorHandle {
    /** Root element holding toolbar and editor; append it wherever the panel wants. */
    element: HTMLElement;
    getHTML(): string;
    setHTML(html: string): void;
    focus(): void;
    destroy(): void;
}

/**
 * Builds an editor.
 *
 * `onChange` fires on every edit; the caller decides how often that reaches storage. Editing is a
 * keystroke-rate event and the config store writes to localStorage synchronously, so writing on
 * each one would touch the disk per character.
 */
export function createNotesEditor(onChange: () => void): NotesEditorHandle {
    const root = document.createElement('div');
    root.className = 'flx-notes__editorwrap';

    const toolbar = document.createElement('div');
    toolbar.className = 'flx-notes__toolbar';

    const surface = document.createElement('div');
    surface.className = 'flx-notes__surface';

    root.append(toolbar, surface);

    const editor = new Editor({
        element: surface,
        extensions: [
            StarterKit,
            Underline,
            TextStyle,
            Color,
            FontFamily,
            Placeholder.configure({ placeholder: 'Write a note…' }),
        ],
        content: '',
        onUpdate: onChange,
    });

    const buttonEls: [ToolbarButton, HTMLButtonElement][] = [];

    for (const button of BUTTONS) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'flx-notes__tool';
        el.textContent = button.label;
        el.title = button.title;
        // Without this the editor loses its selection the moment the button takes focus, and the
        // command then applies to nothing.
        el.addEventListener('mousedown', (e) => e.preventDefault());
        el.addEventListener('click', () => {
            button.run(editor);
            refresh();
        });
        toolbar.appendChild(el);
        buttonEls.push([button, el]);
    }

    const colour = document.createElement('select');
    colour.className = 'flx-notes__select';
    colour.title = 'Text colour';
    for (const [label, value] of COLOURS) {
        colour.add(new Option(label, value));
    }
    colour.addEventListener('change', () => {
        const value = colour.value;
        value
            ? editor.chain().focus().setColor(value).run()
            : editor.chain().focus().unsetColor().run();
    });

    const font = document.createElement('select');
    font.className = 'flx-notes__select';
    font.title = 'Font';
    for (const [label, value] of FONTS) {
        font.add(new Option(label, value));
    }
    font.addEventListener('change', () => {
        const value = font.value;
        value
            ? editor.chain().focus().setFontFamily(value).run()
            : editor.chain().focus().unsetFontFamily().run();
    });

    toolbar.append(colour, font);

    /** Lights the buttons whose mark or node the cursor is inside. */
    function refresh(): void {
        for (const [button, el] of buttonEls) {
            const active =
                button.label === 'H1'
                    ? editor.isActive('heading', { level: 1 })
                    : button.label === 'H2'
                      ? editor.isActive('heading', { level: 2 })
                      : editor.isActive(button.active);

            el.classList.toggle('flx-notes__tool--active', active);
        }
    }

    editor.on('selectionUpdate', refresh);
    editor.on('transaction', refresh);

    return {
        element: root,
        getHTML: () => editor.getHTML(),
        setHTML: (html: string) => {
            // `false` so loading a note is not pushed onto the undo stack as an edit.
            editor.commands.setContent(html, { emitUpdate: false });
            refresh();
        },
        focus: () => editor.commands.focus(),
        destroy: () => editor.destroy(),
    };
}
