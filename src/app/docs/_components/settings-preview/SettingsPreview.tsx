'use client';

import { useMemo, useState } from 'react';
import { UserDirectoryContext, UserMapEditor, UserSelect, type DirUser, type UserDirectory } from '@/components/admin/extensions/UserFields';
import { useI18n } from '@/components/I18nProvider';
import { isUserMap, type UserMapValue } from '@/lib/admin/extensions-config';
import { normalizeSettingsSchema, userMapValue } from '@/lib/expansions/settings-schema';

/**
 * Vista previa INTERACTIVA de los campos de ajustes `user`, `users` y `userMap` (los mismos componentes de la consola de administracion),
 * alimentada por un directorio en memoria: sin red, sin sesion y sin datos reales. Muestra tambien lo que recibe `ctx.settings`.
 */

const NAMES = ['Ana Ruiz', 'Bruno Díaz', 'Carla Mena', 'Diego Soto', 'Elena Paz', 'Fabio Luna', 'Gema Vidal', 'Hugo Ríos', 'Inés Mora', 'Jaime Cruz', 'Karen Lara', 'Luis Prieto'];
const USERS: DirUser[] = NAMES.map((name, i) => ({
    id: `usr_${(i + 1).toString().padStart(3, '0')}`,
    email: `${name.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}@example.com`,
    name,
    disabled: i === 7,
    level: i === 0 ? 3 : 0,
    levelName: i === 0 ? 'admin' : 'user',
}));

const directory: UserDirectory = {
    async page({ q, page = 0, limit = 20, filter }) {
        const needle = (q ?? '').trim().toLowerCase();
        const all = USERS.filter((u) => (!needle || u.email.includes(needle) || (u.name ?? '').toLowerCase().includes(needle)) && (filter?.minLevel === undefined || u.level >= filter.minLevel));
        const users = all.slice(page * limit, page * limit + limit);
        return { users, total: all.length, page, limit, hasMore: (page + 1) * limit < all.length };
    },
    async byIds(ids) {
        return { users: USERS.filter((u) => ids.includes(u.id)), missing: ids.filter((id) => !USERS.some((u) => u.id === id)) };
    },
};

const schema = normalizeSettingsSchema({
    fields: [
        { key: 'owner', type: 'user', label: { es: 'Responsable', en: 'Owner' }, filter: { minLevel: 3 } },
        { key: 'recipients', type: 'users', label: { es: 'Destinatarios', en: 'Recipients' }, maxItems: 5 },
        { key: 'digest', type: 'userMap', valueType: 'boolean', default: false, label: { es: 'Recibe el resumen', en: 'Gets the digest' } },
        { key: 'quota', type: 'userMap', valueType: 'number', min: 1, max: 100, integer: true, default: 10, label: { es: 'Límite diario', en: 'Daily limit' } },
    ],
});
const f = (key: string) => schema.fields.find((x) => x.key === key)!;

export function SettingsPreview() {
    const { locale } = useI18n();
    const es = locale === 'es';
    const [owner, setOwner] = useState<string>('');
    const [recipients, setRecipients] = useState<string[]>(['usr_002']);
    const [digest, setDigest] = useState<UserMapValue>({ usr_001: true, usr_003: true, usr_099: true });
    const [quota, setQuota] = useState<UserMapValue>({ usr_002: '25' });
    const asSettings = useMemo(() => ({
        owner: owner || undefined,
        recipients,
        digest,
        quota: Object.fromEntries(Object.entries(quota).map(([k, v]) => [k, Number(v)])),
    }), [owner, recipients, digest, quota]);
    const probe = 'usr_005';
    const L = {
        title: es ? 'Vista previa de los campos de usuario' : 'User field preview',
        note: es ? 'Datos de ejemplo en memoria (un usuario desactivado, uno eliminado). Los controles son los de la consola de administración.' : 'In-memory sample data (one disabled user, one deleted). The controls are the ones from the admin console.',
        received: es ? 'Lo que recibe el server.js' : 'What server.js receives',
        resolved: `ctx.settings.forUser('digest', '${probe}') -> ${String(userMapValue(f('digest'), digest, probe))} ${es ? '(sin entrada: usa default)' : '(no entry: uses default)'}`,
    };
    const labelOf = (key: string) => {
        const label = f(key).label;
        return typeof label === 'string' ? label : (label as Record<string, string>)[locale] ?? (label as Record<string, string>).en ?? key;
    };
    return (
        <UserDirectoryContext.Provider value={directory}>
            <section aria-label={L.title} className="not-prose space-y-5 rounded-xl border border-border bg-card p-4 text-card-foreground" data-testid="settings-preview">
                <div>
                    <h3 className="text-sm font-semibold">{L.title}</h3>
                    <p className="text-xs text-muted-foreground">{L.note}</p>
                </div>
                <div className="space-y-1.5">
                    <p className="text-sm font-medium">{labelOf('owner')} <code className="text-xs text-muted-foreground">user</code></p>
                    <UserSelect field={f('owner')} multi={false} value={owner} onChange={(v) => setOwner(typeof v === 'string' ? v : '')} editable inputId="pv-owner" />
                </div>
                <div className="space-y-1.5">
                    <p className="text-sm font-medium">{labelOf('recipients')} <code className="text-xs text-muted-foreground">users</code></p>
                    <UserSelect field={f('recipients')} multi value={recipients} onChange={(v) => setRecipients(Array.isArray(v) ? v : [])} editable inputId="pv-recipients" />
                </div>
                <div className="space-y-1.5">
                    <p className="text-sm font-medium">{labelOf('digest')} <code className="text-xs text-muted-foreground">userMap · boolean</code></p>
                    <UserMapEditor field={f('digest')} value={digest} onChange={setDigest} editable inputId="pv-digest" />
                </div>
                <div className="space-y-1.5">
                    <p className="text-sm font-medium">{labelOf('quota')} <code className="text-xs text-muted-foreground">userMap · number</code></p>
                    <UserMapEditor field={f('quota')} value={isUserMap(quota) ? quota : {}} onChange={setQuota} editable inputId="pv-quota" />
                </div>
                <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{L.received}</p>
                    <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs" data-testid="preview-settings-json">{JSON.stringify(asSettings, null, 2)}</pre>
                    <p className="font-mono text-xs text-muted-foreground">{L.resolved}</p>
                </div>
            </section>
        </UserDirectoryContext.Provider>
    );
}
