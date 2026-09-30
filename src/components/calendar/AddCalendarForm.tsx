'use client';

import React, { useState } from 'react';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { Plus, Database, Calendar, Globe, Check } from 'lucide-react';
import { useGlobalWindow } from '@/contexts/GlobalWindowContext';
import { useI18n } from '@/components/I18nProvider';
import { regionName } from '@/lib/i18n/format';

const DEFAULT_HOLIDAY_PROVIDERS = ['PE', 'US', 'GB', 'MX', 'ES', 'AR', 'CO'];

export function AddCalendarForm({ isGoogleLinked, onLocalCreate, onToggleHolidayProvider, currentHolidayProviders = [] }: { 
    isGoogleLinked: boolean, 
    onLocalCreate: () => void,
    onToggleHolidayProvider: (code: string) => void,
    currentHolidayProviders: string[]
}) {
    const { closeWindow } = useGlobalWindow();
    const { t, intlLocale } = useI18n();
    const [addedProviders, setAddedProviders] = useState<string[]>(currentHolidayProviders);

    const handleToggleProvider = (code: string) => {
        setAddedProviders(prev => 
            prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
        );
        onToggleHolidayProvider(code);
    };

    return (
        <div className="flex flex-col h-full bg-muted/50">
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                
                <section>
                    <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        {t('calendar.add.localTitle')}
                    </h3>
                    <div className="bg-card border border-border rounded-lg overflow-hidden">
                        <button 
                            onClick={() => {
                                closeWindow('add-calendar');
                                onLocalCreate();
                            }} 
                            className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded bg-primary/15 flex flex-shrink-0 items-center justify-center text-primary">
                                    <Database className="w-4 h-4" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-foreground/80">{t('calendar.add.createLocal')}</p>
                                    <p className="text-xs text-muted-foreground">{t('calendar.add.createLocalHelp')}</p>
                                </div>
                            </div>
                            <Plus className="w-4 h-4 text-muted-foreground" />
                        </button>
                    </div>
                </section>

                <section>
                    <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        {t('calendar.add.importTitle')}
                    </h3>
                    <div className="bg-card border border-border rounded-lg p-2 min-h-[60px] flex flex-col gap-2">
                        {/* 
                          We use a mount point here. Any extension providing sync features
                          will inject buttons or logic over this mount point.
                        */}
                        <ExtensionLoader 
                            mountPoint="CALENDAR_ADD_SOURCES" 
                            context={{ isGoogleLinked }} 
                        />
                        <div className="text-xs text-muted-foreground italic px-2 py-1">
                            {t('calendar.add.moreProviders')}
                        </div>
                    </div>
                </section>

                <section>
                    <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        {t('calendar.add.holidaysTitle')}
                    </h3>
                    <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col">
                        {DEFAULT_HOLIDAY_PROVIDERS.map(code => {
                            const isAdded = addedProviders.includes(code);
                            return (
                                <button
                                    type="button"
                                    aria-pressed={isAdded}
                                    key={code}
                                    onClick={() => handleToggleProvider(code)}
                                    className={`w-full flex items-center justify-between p-3 border-b last:border-b-0 border-border/60 transition-colors text-left ${isAdded ? 'hover:bg-muted' : 'hover:bg-muted/50'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded bg-success/15 flex flex-shrink-0 items-center justify-center text-success">
                                            <Globe className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-foreground/80">{t('calendar.add.holidaysIn', { country: regionName(code, intlLocale) })}</p>
                                            <p className="text-xs text-muted-foreground">{t('calendar.add.holidaysFor', { code })}</p>
                                        </div>
                                    </div>
                                    {isAdded ? <Check className="w-5 h-5 text-success" /> : <Plus className="w-4 h-4 text-muted-foreground" />}
                                </button>
                            );
                        })}
                    </div>
                </section>

            </div>
        </div>
    );
}
