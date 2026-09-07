/**
 * Notes settings, ported from `NotesConfig.java`.
 *
 * One hidden item. The note text is stored through the config system rather than beside it, which
 * is what gives it persistence for free — but it is edited in the panel, not in a settings field,
 * so it must not appear in the settings list.
 */
import type { ConfigGroup } from '../types';

export const CONFIG_GROUP_KEY = 'notes';

export const notesConfig: ConfigGroup = {
    group: CONFIG_GROUP_KEY,
    items: [
        {
            type: 'string',
            keyName: 'notesData',
            name: '',
            description: '',
            position: 1,
            defaultValue: '',
            hidden: true,
        },
    ],
};
