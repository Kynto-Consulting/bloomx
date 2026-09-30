'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { TagInput } from '@/components/ui/TagInput';
import { useI18n } from '@/components/I18nProvider';

type MailGroupsSettingsProps = {
    settings: {
        groups?: Record<string, string[]>;
    };
    onSave: (newSettings: { groups: Record<string, string[]> }) => Promise<void> | void;
};

type DraftGroup = {
    key: string;
    alias: string;
    members: string[];
};

function normalizeAlias(alias: string) {
    const trimmed = alias.trim().toLowerCase();
    if (!trimmed) {
        return '';
    }

    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function buildDraftGroups(groups?: Record<string, string[]>) {
    return Object.entries(groups || {}).map(([alias, members]) => ({
        key: alias,
        alias,
        members: Array.isArray(members) ? members : [],
    }));
}

export function MailGroupsSettings({ settings, onSave }: MailGroupsSettingsProps) {
    const { t } = useI18n();
    const [draftGroups, setDraftGroups] = useState<DraftGroup[]>(() => buildDraftGroups(settings?.groups));

    // Ultimo contenido conocido (llegado de fuera o ya guardado): evita el bucle guardar -> settings nuevos -> reconstruir -> guardar.
    const lastRef = useRef(JSON.stringify(settings?.groups ?? {}));

    useEffect(() => {
        const incoming = JSON.stringify(settings?.groups ?? {});
        if (incoming === lastRef.current) return;
        lastRef.current = incoming;
        setDraftGroups(buildDraftGroups(settings?.groups));
    }, [settings]);

    const normalizedGroups = useMemo(() => {
        return draftGroups.reduce<Record<string, string[]>>((accumulator, group) => {
            const alias = normalizeAlias(group.alias);
            if (!alias || group.members.length === 0) {
                return accumulator;
            }

            accumulator[alias] = group.members;
            return accumulator;
        }, {});
    }, [draftGroups]);

    useEffect(() => {
        const next = JSON.stringify(normalizedGroups);
        if (next === lastRef.current) return;
        lastRef.current = next;
        void onSave({ groups: normalizedGroups });
    }, [normalizedGroups, onSave]);

    return (
        <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 rounded-2xl border bg-card p-4">
                <div>
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Users className="h-4 w-4" aria-hidden="true" /> {t('mailGroups.title')}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {t('mailGroups.help')}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => setDraftGroups((current) => [...current, { key: crypto.randomUUID(), alias: '', members: [] }])}
                    className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-muted/50"
                >
                    <Plus className="h-4 w-4" aria-hidden="true" /> {t('mailGroups.add')}
                </button>
            </div>

            {draftGroups.length === 0 && (
                <div className="rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
                    {t('mailGroups.empty')}
                </div>
            )}

            {draftGroups.map((group, index) => (
                <div key={group.key} className="space-y-3 rounded-2xl border bg-card p-4">
                    <div className="flex items-center justify-between gap-3">
                        <input
                            value={group.alias}
                            onChange={(event) => {
                                const nextAlias = event.target.value;
                                setDraftGroups((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, alias: nextAlias } : entry));
                            }}
                            placeholder={t('mailGroups.aliasPlaceholder')}
                            aria-label={t('mailGroups.aliasLabel')}
                            className="h-11 flex-1 rounded-xl border px-3 text-sm"
                        />
                        <button
                            type="button"
                            aria-label={group.alias ? t('mailGroups.removeGroup', { alias: group.alias }) : t('mailGroups.removeGroupUnnamed')}
                            onClick={() => setDraftGroups((current) => current.filter((_, entryIndex) => entryIndex !== index))}
                            className="rounded-xl border px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-muted/50"
                        >
                            {t('mailGroups.remove')}
                        </button>
                    </div>

                    <TagInput
                        value={group.members}
                        onChange={(members) => {
                            setDraftGroups((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, members } : entry));
                        }}
                        placeholder={t('mailGroups.addRecipients')}
                        ariaLabel={t('mailGroups.membersLabel', { alias: group.alias || t('mailGroups.membersUnnamed') })}
                        suggestionEndpoint="/api/contacts/suggestions"
                        className="rounded-2xl border px-3 py-2"
                    />
                </div>
            ))}
        </div>
    );
}