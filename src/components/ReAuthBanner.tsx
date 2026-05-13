'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, RefreshCw, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { useReAuth, type ReAuthRequest } from '@/contexts/ReAuthContext';

// ─── Provider meta ────────────────────────────────────────────────────────────

const PROVIDER_META: Record<string, { label: string; color: string; logo: React.ReactNode }> = {
    google: {
        label: 'Google',
        color: 'bg-white border border-slate-200',
        logo: (
            <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden>
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
        ),
    },
    zoom: {
        label: 'Zoom',
        color: 'bg-blue-50 border border-blue-200',
        logo: (
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="#2D8CFF" aria-hidden>
                <path d="M24 12c0 6.627-5.373 12-12 12S0 18.627 0 12 5.373 0 12 0s12 5.373 12 12zm-6.793-4.5H8.793C7.246 7.5 6 8.746 6 10.293v5.414l2.793-2.086v1.086c0 .828.672 1.5 1.5 1.5h6.414c.828 0 1.5-.672 1.5-1.5v-5.414l-2.793 2.086v-1.086c0-.828-.672-1.5-1.5-1.5H6.793z" />
            </svg>
        ),
    },
    slack: {
        label: 'Slack',
        color: 'bg-purple-50 border border-purple-200',
        logo: (
            <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden>
                <path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52z" />
                <path fill="#36C5F0" d="M15.165 5.042a2.527 2.527 0 0 1 2.523-2.52A2.527 2.527 0 0 1 20.21 5.042v6.313a2.528 2.528 0 0 1-2.523 2.52 2.527 2.527 0 0 1-2.523-2.52V5.042z" />
                <path fill="#2EB67D" d="M15.165 2.522A2.528 2.528 0 0 1 17.688 0a2.528 2.528 0 0 1 2.522 2.522v2.52h-2.522a2.528 2.528 0 0 1-2.523-2.52z" />
                <path fill="#ECB22E" d="M8.688 15.165a2.528 2.528 0 0 1-2.523 2.523H0a2.528 2.528 0 0 1-2.523-2.523 2.527 2.527 0 0 1 2.523-2.52h6.165a2.527 2.527 0 0 1 2.523 2.52z" />
            </svg>
        ),
    },
};

function getProviderMeta(provider: string) {
    return PROVIDER_META[provider] ?? {
        label: provider.charAt(0).toUpperCase() + provider.slice(1),
        color: 'bg-slate-50 border border-slate-200',
        logo: <span className="w-4 h-4 rounded-full bg-slate-400 inline-block" />,
    };
}

// ─── Single card ──────────────────────────────────────────────────────────────

function ReAuthCard({ request, onReconnect, onDismiss }: {
    request: ReAuthRequest;
    onReconnect: () => void;
    onDismiss: () => void;
}) {
    const meta = getProviderMeta(request.provider);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            className="w-80 rounded-xl bg-white shadow-xl ring-1 ring-black/8 overflow-hidden"
        >
            {/* Header stripe */}
            <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-100">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="text-xs font-semibold text-amber-700 tracking-wide uppercase">
                    Permiso requerido
                </span>
                <button
                    onClick={onDismiss}
                    aria-label="Descartar"
                    className="ml-auto p-0.5 rounded-md text-amber-400 hover:text-amber-600 hover:bg-amber-100 transition-colors"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>

            <div className="px-4 py-3 space-y-3">
                {/* Provider badge */}
                <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${meta.color}`}>
                    {meta.logo}
                    {meta.label}
                </div>

                {/* Reason */}
                <p className="text-sm text-slate-700 leading-snug">
                    {request.reason}
                </p>

                {/* Requested by */}
                {request.requestedBy && (
                    <p className="text-xs text-slate-400">
                        Solicitado por <span className="font-medium text-slate-500">{request.requestedBy}</span>
                    </p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1">
                    <button
                        onClick={onReconnect}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-700 active:scale-95 transition-all"
                    >
                        <RefreshCw className="w-3 h-3" />
                        Reconectar {meta.label}
                    </button>
                    <button
                        onClick={onDismiss}
                        className="px-3 py-1.5 rounded-lg text-slate-500 text-xs font-medium hover:bg-slate-100 active:scale-95 transition-all"
                    >
                        Más tarde
                    </button>
                </div>
            </div>
        </motion.div>
    );
}

// ─── Collapsed summary card ───────────────────────────────────────────────────

function CollapsedSummaryCard({ requests, onExpand, onDismissAll }: {
    requests: ReAuthRequest[];
    onExpand: () => void;
    onDismissAll: () => void;
}) {
    const providers = [...new Set(requests.map(r => r.provider))];

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            className="w-80 rounded-xl bg-white shadow-xl ring-1 ring-black/8 overflow-hidden"
        >
            <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-100">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="text-xs font-semibold text-amber-700 tracking-wide uppercase">
                    {requests.length} conexiones necesitan atención
                </span>
                <button
                    onClick={onDismissAll}
                    aria-label="Descartar todo"
                    className="ml-auto p-0.5 rounded-md text-amber-400 hover:text-amber-600 hover:bg-amber-100 transition-colors"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>

            <div className="px-4 py-3 space-y-2">
                {providers.map(p => {
                    const meta = getProviderMeta(p);
                    const count = requests.filter(r => r.provider === p).length;
                    return (
                        <div key={p} className="flex items-center gap-2">
                            <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${meta.color}`}>
                                {meta.logo}
                                {meta.label}
                            </div>
                            <span className="text-xs text-slate-500">
                                {count === 1 ? '1 permiso' : `${count} permisos`}
                            </span>
                        </div>
                    );
                })}

                <button
                    onClick={onExpand}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 pt-1 transition-colors"
                >
                    <ChevronUp className="w-3 h-3" />
                    Ver detalles
                </button>
            </div>
        </motion.div>
    );
}

// ─── Root banner ──────────────────────────────────────────────────────────────

export function ReAuthBanner() {
    const { requests, dismiss, dismissAll } = useReAuth();
    const [expanded, setExpanded] = useState(true);

    const handleReconnect = (request: ReAuthRequest) => {
        const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/api/auth/${request.provider}?returnTo=${returnTo}`;
    };

    if (!requests.length) return null;

    // Show max 2 cards individually; if more, show the summary card.
    const INDIVIDUAL_LIMIT = 2;

    return (
        <div className="fixed bottom-4 right-4 z-[90] flex flex-col gap-2 items-end pointer-events-none">
            <AnimatePresence mode="popLayout">
                {requests.length <= INDIVIDUAL_LIMIT || expanded ? (
                    // Individual cards (newest first)
                    [...requests].reverse().map(req => (
                        <div key={req.id} className="pointer-events-auto">
                            <ReAuthCard
                                request={req}
                                onReconnect={() => handleReconnect(req)}
                                onDismiss={() => dismiss(req.id)}
                            />
                        </div>
                    ))
                ) : (
                    // Collapsed summary
                    <div key="summary" className="pointer-events-auto">
                        <CollapsedSummaryCard
                            requests={requests}
                            onExpand={() => setExpanded(true)}
                            onDismissAll={dismissAll}
                        />
                    </div>
                )}
            </AnimatePresence>

            {/* Collapse toggle when multiple cards are expanded */}
            {requests.length > INDIVIDUAL_LIMIT && expanded && (
                <motion.button
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="pointer-events-auto flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 bg-white/80 backdrop-blur-sm px-2 py-1 rounded-lg shadow ring-1 ring-black/5 transition-colors"
                    onClick={() => setExpanded(false)}
                >
                    <ChevronDown className="w-3 h-3" />
                    Colapsar
                </motion.button>
            )}
        </div>
    );
}
