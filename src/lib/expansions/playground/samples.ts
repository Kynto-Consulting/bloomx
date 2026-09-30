/**
 * Manifests de ejemplo del playground: uno completo en formato nuevo y tres heredados (simplificados) para ver la
 * migracion automatica (COLUMN, className, variant "primary", DATA_TABLE, TABS/TAB_ITEM, component: "MODAL"...).
 */
import { EXAMPLE_BACKEND, EXAMPLE_CONTEXT, flattenExamples } from '../ui-examples';

export interface PlaygroundSample {
    id: string;
    group: 'manifest' | 'legacy' | 'component';
    title: string;
    text: string;
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

const MANIFEST_NEW = {
    manifestVersion: '1.0',
    id: 'playground-demo',
    name: 'Demo del playground',
    version: '1.0.0',
    description: 'Manifest de ejemplo en el formato actual (props semanticas, sin estilos).',
    permissions: ['READ_EMAIL'],
    api: { runtime: 'nodejs', entry: 'server.js', functions: { getSummary: { handler: 'getSummary' }, saveNote: { handler: 'saveNote' } } },
    state: { summary: null, note: '' },
    mounts: [
        {
            point: 'EMAIL_FOOTER',
            component: {
                type: 'CARD',
                props: { title: 'Asistente', description: '${context.subject}', icon: 'Sparkles' },
                children: [
                    { type: 'TEXT', props: { content: 'De: ${context.from}', variant: 'muted', size: 'xs' } },
                    { type: 'BUTTON', props: { label: 'Resumir', icon: 'Wand2', loading: '${state.$loading.getSummary}', onClick: { action: 'CALL_BACKEND', function: 'getSummary', args: { text: '${context.emailContent}' }, resultKey: 'summary' } } },
                    { type: 'CONDITIONAL', props: { condition: '${state.$error.getSummary}', true: [{ type: 'ALERT', props: { tone: 'danger', message: '${state.$error.getSummary}' } }] } },
                    { type: 'CONDITIONAL', props: { condition: '${state.summary}', true: [{ type: 'CALLOUT', props: { tone: 'info', title: 'Resumen' }, children: [{ type: 'TEXT', props: { content: '${state.summary.text}' } }] }] } },
                    { type: 'BUTTON', props: { label: 'Ver detalle', variant: 'outline', onClick: { action: 'OPEN_OVERLAY', targetId: 'detalle' } } },
                ],
            },
        },
        {
            point: 'COMPOSER_TOOLBAR',
            component: { type: 'BUTTON', props: { label: 'Insertar saludo', variant: 'soft', icon: 'Hand', onClick: [{ action: 'INSERT_CONTENT', content: '<p>Hola ${context.fromName | default:"equipo"},</p>' }, { action: 'SET_SUBJECT', subject: 'Re: ${context.subject}' }] } },
        },
    ],
    overlays: {
        detalle: {
            type: 'MODAL',
            props: { title: 'Detalle', description: 'Overlay del manifest', width: 'md' },
            children: [
                { type: 'FORM', props: { fields: [{ name: 'note', label: 'Nota', type: 'textarea', required: true }], submitLabel: 'Guardar', successMessage: 'Nota guardada', onSubmit: { action: 'CALL_BACKEND', function: 'saveNote', onSuccess: { action: 'CLOSE_OVERLAY' } } } },
            ],
        },
    },
};

const LEGACY_COLUMN = {
    manifestVersion: '1.0',
    id: 'legacy-column',
    name: 'Heredado: COLUMN y className',
    version: '0.9.0',
    permissions: ['READ_EMAIL'],
    mounts: [
        {
            point: 'EMAIL_READER_SIDEBAR',
            component: {
                type: 'COLUMN',
                props: {
                    className: 'p-4 space-y-2 border rounded',
                    children: [
                        { type: 'TEXT', props: { content: 'Panel heredado', variant: 'h4', className: 'font-bold' } },
                        { type: 'TEXT', props: { content: '${context.subject}', variant: 'body' } },
                        { type: 'BUTTON', props: { label: 'Accion principal', variant: 'primary', className: 'w-full', onClick: { action: 'TOAST', message: 'Hecho', variant: 'success' } } },
                        { type: 'BUTTON', props: { label: 'Secundaria', variant: 'secondary', onClick: { action: 'TOAST', message: 'Secundaria' } } },
                        { type: 'SEPARATOR' },
                        { type: 'TEXT', props: { content: 'Algo salio mal', variant: 'error' } },
                    ],
                },
            },
        },
    ],
};

const LEGACY_TABLE = {
    manifestVersion: '1.0',
    id: 'legacy-table',
    name: 'Heredado: DATA_TABLE',
    version: '0.9.0',
    permissions: ['READ_EMAIL'],
    api: { runtime: 'nodejs', entry: 'server.js', functions: { getRows: { handler: 'getRows' } } },
    mounts: [
        {
            point: 'SIDEBAR_PANEL',
            component: {
                type: 'COLUMN',
                props: {
                    gap: 2,
                    children: [
                        { type: 'BUTTON', props: { label: 'Cargar', variant: 'default', onClick: { action: 'CALL_BACKEND', function: 'getRows', onSuccess: { action: 'SET_STATE', key: 'rows', value: '${result.rows}' } } } },
                        { type: 'ALERT', props: { variant: 'warning', description: 'Datos de ejemplo simulados' } },
                        {
                            type: 'DATA_TABLE',
                            props: {
                                className: 'mt-2',
                                data: '${state.rows}',
                                columns: [{ key: 'name', label: 'Nombre' }, { key: 'email', label: 'Correo' }, { key: 'status', label: 'Estado', format: 'badge' }],
                            },
                        },
                        { type: 'BADGE', props: { label: 'Beta', variant: 'secondary' } },
                    ],
                },
            },
        },
    ],
};

const LEGACY_MODAL = {
    manifestVersion: '1.0',
    id: 'legacy-settings',
    name: 'Heredado: mount con component "MODAL"',
    version: '0.9.0',
    mounts: [
        {
            point: 'SETTINGS_PANEL',
            component: 'MODAL',
            props: {
                title: 'Ajustes heredados',
                width: '500px',
                children: [
                    {
                        type: 'TABS',
                        props: { children: [] },
                        children: [
                            { type: 'TAB_ITEM', props: { label: 'General' }, children: [{ type: 'INPUT', props: { label: 'Nombre', bindTo: 'name', multiline: true, className: 'w-full' } }] },
                            { type: 'TAB_ITEM', props: { label: 'Avanzado' }, children: [{ type: 'FLEX', props: { direction: 'row', gap: 8, align: 'center', children: [{ type: 'TOGGLE', props: { label: 'Activar', bindTo: 'enabled' } }] } }] },
                        ],
                    },
                ],
            },
        },
    ],
};

const nodeSamples = (): PlaygroundSample[] => flattenExamples().map((e) => ({ id: e.id, group: 'component' as const, title: `${e.type} - ${e.title}`, text: pretty(e.node) }));

export const PLAYGROUND_SAMPLES: PlaygroundSample[] = [
    { id: 'manifest', group: 'manifest', title: 'Manifest completo (formato nuevo)', text: pretty(MANIFEST_NEW) },
    { id: 'legacy-column', group: 'legacy', title: 'Heredado: COLUMN, className y variant "primary"', text: pretty(LEGACY_COLUMN) },
    { id: 'legacy-table', group: 'legacy', title: 'Heredado: DATA_TABLE y variantes antiguas', text: pretty(LEGACY_TABLE) },
    { id: 'legacy-modal', group: 'legacy', title: 'Heredado: component "MODAL", TABS/TAB_ITEM y FLEX', text: pretty(LEGACY_MODAL) },
    ...nodeSamples(),
];

export const DEFAULT_SAMPLE_ID = 'manifest';

export function findSample(id: string): PlaygroundSample | undefined {
    return PLAYGROUND_SAMPLES.find((s) => s.id === id);
}

export const DEFAULT_CONTEXT_TEXT = pretty(EXAMPLE_CONTEXT);
export const DEFAULT_SCRIPT_TEXT = pretty(EXAMPLE_BACKEND);
