'use client';

import React from 'react';
import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { Plus, Database, Calendar } from 'lucide-react';
import { useGlobalWindow } from '@/contexts/GlobalWindowContext';

export function AddCalendarForm({ isGoogleLinked, onLocalCreate }: { isGoogleLinked: boolean, onLocalCreate: () => void }) {
    const { closeWindow } = useGlobalWindow();

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

            </div>
        </div>
    );
}
