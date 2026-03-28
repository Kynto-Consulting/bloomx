import React from 'react';

export type ClientExpansionMountPoint =
    | 'COMPOSER_OVERLAY' | 'SIDEBAR_PANEL' | 'EMAIL_TOOLBAR' | 'EMAIL_FOOTER' | 'SIDEBAR_HEADER'
    | 'COMPOSER_INIT' | 'COMPOSER_TOOLBAR' | 'EMAIL_HEADER' | 'SIDEBAR_FOOTER'
    | 'CALENDAR_HEADER' | 'CALENDAR_SIDEBAR' | 'CONTACTS_HEADER' | 'CONTACTS_SIDEBAR'
    | 'SETTINGS_TAB' | 'CUSTOM_SETTINGS_TAB' | 'SLASH_COMMAND' | 'EXTENSION_PAGE'
    | 'BEFORE_SEND_HANDLER'
    | 'ON_BODY_CHANGE_HANDLER' | 'ON_SUBJECT_CHANGE_HANDLER' | 'ON_RECIPIENTS_CHANGE_HANDLER'
    | 'ON_OPEN_HANDLER' | 'ON_CLOSE_HANDLER'
    | 'INBOX_BANNER' | 'EMAIL_BODY_FOOTER' | 'COMPOSE_FOOTER'
    | 'CONTEXT_MENU' | 'NOTIFICATION' | 'PAGE';

export type ExpansionPriority = 'HIGH' | 'NORMAL' | 'LOW' | 'MONITOR';

export interface ClientExpansionContext {
    // Context provided to the component
    emailId?: string;
    emailContent?: string;
    subject?: string;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    sender?: {
        email?: string;
        name?: string;
    };

    // Actions provided to the component (Renamed: No 'on' prefix for actions)
    setBody?: (content: string) => void;
    appendBody?: (content: string) => void;
    prependBody?: (content: string) => void;
    insertBody?: (content: string) => void;
    setSubject?: (subject: string) => void;
    setSummary?: (content: string) => void;
    setSuggestions?: (suggestions: string[]) => void;
    setTo?: (recipients: string[]) => void;
    setCc?: (recipients: string[]) => void;
    setBcc?: (recipients: string[]) => void;
    addRecipient?: (email: string, type?: 'to' | 'cc' | 'bcc') => void;
    removeRecipient?: (email: string, type?: 'to' | 'cc' | 'bcc') => void;
    addAttachment?: (attachment: any) => void;

    // UI Actions
    openPopover?: (anchor: HTMLElement | DOMRect, content: React.ReactNode, options?: { width?: number | string, header?: boolean }) => void;
    openOverlay?: (content: React.ReactNode) => void;
    uploadAttachment?: (file: File) => Promise<any>;
    close?: () => void;
    toast?: (message: string, type?: 'success' | 'error' | 'info') => void;
    showConfetti?: () => void;

    // Secure Storage Access
    secureSave?: (key: string, value: any) => Promise<void>;
    secureLoad?: (key: string) => Promise<any | null>;
    secureClear?: (key: string) => Promise<void>;

    [key: string]: any;
}

export interface ClientExpansionMount {
    point: ClientExpansionMountPoint;
    Component?: React.ComponentType<{ context: ClientExpansionContext }>;
    execute?: (context: ClientExpansionContext) => void;
    title?: string; // For CUSTOM_SETTINGS_TAB
    icon?: any; // React Component for tab icon
    slashCommand?: {
        key: string;
        description: string;
        arguments?: string;
    };
    routePath?: string; // For EXTENSION_PAGE (e.g. "decrypt" -> /extensions/decrypt)

    // For Event Handlers (Signature depends on mount point)
    // - ON_BODY_CHANGE_HANDLER: (content: string) => Promise<string | void>
    // - ON_SUBJECT_CHANGE_HANDLER: (subject: string) => Promise<string | void>
    // - ON_RECIPIENTS_CHANGE_HANDLER: (recipients: {to, cc, bcc}) => Promise<{to?, cc?, bcc?} | void>
    // - BEFORE_SEND_HANDLER: (details: { to: string[], subject: string, body: string, cc: string[], bcc: string[] }) => Promise<{to?, cc?, bcc?, subject?, body?} | void>
    handler?: (payload: any) => Promise<any | void>;
    priority?: ExpansionPriority;
}

export interface ClientExpansion {
    id: string; // Matches Server Expansion ID if paired

    // Multiple mount points supported
    mounts: Array<ClientExpansionMount>;

    // Configurable Settings Interface
    SettingsComponent?: React.ComponentType<{
        settings: any;
        onSave: (newSettings: any) => Promise<void> | void;
        saving?: boolean;
    }>;
    defaultSettings?: any;
    label?: string; // For the settings list
}
