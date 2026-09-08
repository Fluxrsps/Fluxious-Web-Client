/**
 * The Developer Tools panel, following `DevToolsPanel.java`.
 *
 * A column of toggle buttons, which is what the desktop plugin puts in its window. Plain DOM rather
 * than a component, like every plugin panel here — a plugin never has to import the page's framework
 * to contribute one.
 */
import type { PluginPanel } from '../ui/clientToolbar';
import { setToggle, toggles, TOGGLE_LABELS, type ToggleName } from './devToolsState';

export class DevToolsPanel implements PluginPanel {
    private buttons = new Map<ToggleName, HTMLButtonElement>();

    mount(host: HTMLElement): void {
        this.buttons.clear();
        host.replaceChildren();

        const column = document.createElement('div');

        column.className = 'flx-devtools';

        for (const { key, label } of TOGGLE_LABELS) {
            const button = document.createElement('button');

            button.type = 'button';
            button.className = 'flx-devtools__toggle';
            button.textContent = label;
            button.addEventListener('click', () => {
                setToggle(key, !toggles[key]);
                this.paint();
            });

            this.buttons.set(key, button);
            column.appendChild(button);
        }

        const note = document.createElement('p');

        note.className = 'flx-devtools__note';
        note.textContent = 'Not remembered between sessions.';
        column.appendChild(note);

        host.appendChild(column);
        this.paint();
    }

    unmount(): void {
        this.buttons.clear();
    }

    /** Reflects the live state, so a toggle changed elsewhere still reads correctly here. */
    private paint(): void {
        for (const [key, button] of this.buttons) {
            button.classList.toggle('flx-devtools__toggle--on', toggles[key]);
            button.setAttribute('aria-pressed', String(toggles[key]));
        }
    }
}
