/**
 * Notes, ported from `NotesPlugin.java`.
 *
 * Adds the panel to the sidebar and takes it away again; the panel owns everything else. The
 * desktop plugin also refreshes the text on `ProfileChanged`, which has no equivalent here — the
 * browser build has one profile — so that subscription is deliberately absent rather than wired to
 * an event that never fires.
 */
import type { FluxPlugin } from '../types';
import { addNavigation, removeNavigation, type NavigationButton } from '../ui/clientToolbar';
import { notesConfig } from './notesConfig';
import { NotesPanel } from './notesPanel';

const panel = new NotesPanel();

const navButton: NavigationButton = {
    tooltip: 'Notes',
    icon: '/assets/plugins/notes_icon.png',
    priority: 7,
    panel,
};

export const notesPlugin: FluxPlugin = {
    descriptor: {
        name: 'Notes',
        description: 'Enable the Notes panel',
        tags: ['panel'],
        enabledByDefault: true,
    },

    config: notesConfig,

    startUp() {
        addNavigation(navButton);
    },

    shutDown() {
        removeNavigation(navButton);
    },
};
