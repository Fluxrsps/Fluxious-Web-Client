/**
 * Reading and writing the note.
 *
 * One note, in the single hidden `notes.notesData` config value, as the desktop plugin stores it.
 * The difference is that the editor is rich text, so what is stored is HTML rather than plain
 * text — which means {@link loadNote} has to cope with values written by something other than the
 * current editor.
 */
import { readValue, writeValue } from '../configStore';
import { notesConfig } from './notesConfig';

const NOTES_KEY = 'notesData';

/**
 * The note, whatever shape it was last written in.
 *
 * Three cases, all of them real: HTML from this editor, a JSON envelope from the multi-note
 * version this replaced, and plain text from the original plugin. Losing somebody's note to a
 * format change is the one outcome worth writing code to avoid.
 */
export function loadNote(): string {
    const raw = String(readValue(notesConfig, NOTES_KEY) ?? '');

    if (!raw.trim()) {
        return '';
    }

    // A JSON envelope: take the note it had selected, or the first one.
    if (raw.trimStart().startsWith('{')) {
        try {
            const parsed = JSON.parse(raw) as { notes?: { id: string; html?: string }[]; activeId?: string };

            if (Array.isArray(parsed.notes) && parsed.notes.length > 0) {
                const active = parsed.notes.find((note) => note.id === parsed.activeId) ?? parsed.notes[0];

                return active.html ?? '';
            }
        } catch {
            // Not JSON after all; fall through and treat it as text.
        }
    }

    // Already HTML from this editor.
    if (/^\s*<(p|h[1-6]|ul|ol|blockquote|pre)\b/i.test(raw)) {
        return raw;
    }

    return textToParagraphs(raw);
}

export function saveNote(html: string): void {
    writeValue(notesConfig, NOTES_KEY, html);
}

/** Wraps plain text as paragraphs, escaping it so a stray angle bracket is not read as markup. */
function textToParagraphs(text: string): string {
    return text
        .split(/\r?\n/)
        .map((line) => {
            const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            return `<p>${escaped || '<br>'}</p>`;
        })
        .join('');
}
