'use client';

import React, { useState } from 'react';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { Plus, Database, Calendar, Globe, Check } from 'lucide-react';
import { useGlobalWindow } from '@/contexts/GlobalWindowContext';

const DEFAULT_HOLIDAY_PROVIDERS = [
    { code: 'PE', name: 'Holidays in Peru' },
    { code: 'US', name: 'Holidays in United States' },
    { code: 'GB', name: 'Holidays in United Kingdom' },
    { code: 'MX', name: 'Holidays in Mexico' },
    { code: 'ES', name: 'Holidays in Spain' },
    { code: 'AR', name: 'Holidays in Argentina' },
    { code: 'CO', name: 'Holidays in Colombia' },
];

export function AddCalendarForm({ isGoogleLinked, onLocalCreate, onAddHolidayProvider, currentHolidayProviders = [] }: { 
    isGoogleLinked: boolean, 
    onLocalCreate: () => void,
    onAddHolidayProvider: (code: string) => void,
    currentHolidayProviders: string[]
}) {
    const { closeWindow } = useGlobalWindow();
    const [addedProviders, setAddedProviders] = useState<string[]>(currentHolidayProviders);

    const handleAddProvider = (code: string) => {
        setAddedProviders([...addedProviders, code]);
        onAddHolidayProvider(code);
    };

    return (
        <div className="flex flex-col h-full bg-slate-50">
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                
                <section>
                    <h3 className="text-[13px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
                        Local Calendars
                    </h3>
                    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                        <button 
                            onClick={() => {
                                closeWindow('add-calendar');
                                onLocalCreate();
                            }} 
                            className="w-full flex items-center justify-between p-3 hover:bg-slate-50 transition-colors text-left"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded bg-blue-100 flex flex-shrink-0 items-center justify-center text-blue-600">
                                    <Database className="w-4 h-4" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-slate-700">Create new local calendar</p>
                                    <p className="text-xs text-slate-500">Store events in your current workspace</p>
                                </div>
                            </div>
                            <Plus className="w-4 h-4 text-slate-400" />
                        </button>
                    </div>
                </section>

                <section>
                    <h3 className="text-[13px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
                        Import from Providers
                    </h3>
                    <div className="bg-white border border-slate-200 rounded-lg p-2 min-h-[60px] flex flex-col gap-2">
                        {/* 
                          We use a mount point here. Any extension providing sync features
                          will inject buttons or logic over this mount point.
                        */}
                        <ExtensionLoader 
                            mountPoint="CALENDAR_ADD_SOURCES" 
                            context={{ isGoogleLinked }} 
                        />
                        <div className="text-xs text-slate-500 italic px-2 py-1">
                            More providers can be added via the App Directory.
                        </div>
                    </div>
                </section>

                <section>
                    <h3 className="text-[13px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
                        Regional Holidays
                    </h3>
                    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
                        {DEFAULT_HOLIDAY_PROVIDERS.map(p => {
                            const isAdded = addedProviders.includes(p.code);
                            return (
                                <button 
                                    key={p.code}
                                    onClick={() => !isAdded && handleAddProvider(p.code)}
                                    disabled={isAdded}
                                    className={`w-full flex items-center justify-between p-3 border-b last:border-b-0 border-slate-100 transition-colors text-left ${isAdded ? 'bg-slate-50 cursor-default opacity-70' : 'hover:bg-slate-50'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded bg-teal-50 flex flex-shrink-0 items-center justify-center text-teal-600">
                                            <Globe className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-slate-700">{p.name}</p>
                                            <p className="text-xs text-slate-500">Public holidays for {p.code}</p>
                                        </div>
                                    </div>
                                    {isAdded ? <Check className="w-4 h-4 text-emerald-500" /> : <Plus className="w-4 h-4 text-slate-400" />}
                                </button>
                            );
                        })}
                    </div>
                </section>

            </div>
        </div>
    );
}
