
// This file should match the backend JSON schema for extensions
// Ideally imported from a shared package, but for now duplicated here.

export type MountPoint =
    | 'EMAIL_TOOLBAR'
    | 'SIDEBAR_HEADER'
    | 'SIDEBAR_FOOTER'
    | 'COMPOSER_TOOLBAR'
    | 'CALENDAR_HEADER'
    | 'CALENDAR_SIDEBAR'
    | 'CONTACTS_HEADER'
    | 'CONTACTS_SIDEBAR'
    | 'SETTINGS_TAB'
    | 'OVERLAY';

export type ComponentType =
    | 'BUTTON'
    | 'MODAL'
    | 'PANEL'
    | 'FORM'
    | 'INPUT'
    | 'TEXT'
    | 'CARD'
    | 'TABS'
    | 'ROW'
    | 'COLUMN'
    | 'CONDITIONAL'
    | 'LINK'
    | 'TOGGLE_GROUP'
    | 'UPLOAD'
    | 'WIZARD'
    | 'SELECT';

export interface ExtensionAction {
    action: 'CALL_BACKEND' | 'CALL_API' | 'OPEN_OVERLAY' | 'TOAST' | 'INSERT_CONTENT' | 'navigate' | 'SET_STATE' | 'NEXT_STEP' | 'PREV_STEP';
    function?: string;
    targetId?: string; // For overlay
    message?: string; // For toast
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    params?: any;
    args?: any;
    key?: string;
    value?: any;
    emitEvent?: string;
    debounce?: number;
    onSuccess?: ExtensionAction;
}

export interface ExtensionComponent {
    type: ComponentType;
    props: Record<string, any>; // e.g. label, variant, onClick -> ExtensionAction
    children?: ExtensionComponent[];
}

export interface ExtensionMount {
    point: MountPoint;
    component: ExtensionComponent;
    priority?: number;
}

export interface ExtensionManifest {
    id: string;
    name: string;
    description: string;
    version: string;
    permissions: string[];
    mounts: ExtensionMount[];
    // ... other backend fields like intercepts not needed in frontend types usually
}
