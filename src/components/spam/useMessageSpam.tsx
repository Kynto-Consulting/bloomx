'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '@/components/I18nProvider';
import { classifyForDisplay, linkLeavesSender, senderAddressOf, type DisplayVerdict, type ExternalPolicy } from './external-display';
import { useExternalPolicy } from './useExternalPolicy';
import { useSpamExplain, type ExplainState } from './useSpamExplain';
import { AttachmentConfirmDialog, LinkConfirmDialog } from './ExternalConfirmDialogs';

const OUTGOING = new Set(['drafts', 'sent', 'scheduled']);

export interface MessageSpam {
    policy: ExternalPolicy | null;
    verdict: DisplayVerdict;
    explain: ExplainState;
    /** Se aviso de externo (politica activa + externo no confiable o suplantacion). */
    warn: boolean;
    linkGuard: { senderDomain: string } | null;
    onGuardedLink: (href: string) => void;
    /** Para AttachmentList: null cuando no hay que pedir confirmacion. */
    confirmDownload: ((att: { filename?: string | null }, proceed: () => void) => void) | null;
    /** Dialogos de confirmacion (enlaces y adjuntos): renderizar una vez por mensaje. */
    dialogs: ReactNode;
}

/**
 * Estado de spam/externo de UN mensaje del lector: politica compartida + veredicto guardado por el servidor (carga perezosa solo si el
 * mensaje esta expandido) + endurecimiento (confirmar enlaces y adjuntos) para remitentes externos no confiables.
 */
export function useMessageSpam({ id, from, folder, own, expanded }: { id: string; from: string; folder?: string | null; own?: ReadonlySet<string>; expanded: boolean }): MessageSpam {
    const { t } = useI18n();
    const policy = useExternalPolicy();
    const address = senderAddressOf(from);
    const mine = address && own?.has(address) ? address : null;
    const outgoing = OUTGOING.has(String(folder ?? '')) || mine !== null;
    const explain = useSpamExplain(id, expanded && !outgoing);
    const stored = explain.status === 'ready' && explain.data.scored ? { colleagueSpoof: explain.data.colleagueSpoof, firstTime: explain.data.firstTime } : null;
    const verdict = useMemo(
        () => (outgoing ? classifyForDisplay(null, from) : classifyForDisplay(policy, from, mine, stored)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [outgoing, policy, from, mine, stored?.colleagueSpoof, stored?.firstTime],
    );
    const warn = verdict.warn && policy?.enabled === true;

    const [link, setLink] = useState<string | null>(null);
    const [download, setDownload] = useState<{ name: string; proceed: () => void } | null>(null);

    const senderDomain = address.split('@')[1] || '';
    const linkGuard = warn && policy?.hardenLinks && senderDomain ? { senderDomain } : null;
    const onGuardedLink = useCallback((href: string) => {
        // Defensa adicional: solo se pregunta por enlaces http(s) que de verdad salen del dominio del remitente.
        if (senderDomain && linkLeavesSender(href, senderDomain)) setLink(href);
    }, [senderDomain]);
    const confirmDownload = warn && policy?.hardenAttachments
        ? (att: { filename?: string | null }, proceed: () => void) => setDownload({ name: att.filename || t('mailView.attachments.unnamed'), proceed })
        : null;

    const dialogs = (link !== null || download !== null) ? (
        <>
            <LinkConfirmDialog
                href={link}
                sender={senderDomain}
                onOpen={(href) => { setLink(null); try { window.open(href, '_blank', 'noopener,noreferrer'); } catch { /* bloqueado */ } }}
                onCancel={() => setLink(null)}
            />
            <AttachmentConfirmDialog
                name={download ? download.name : null}
                onProceed={() => { const d = download; setDownload(null); d?.proceed(); }}
                onCancel={() => setDownload(null)}
            />
        </>
    ) : null;

    return { policy, verdict, explain, warn, linkGuard, onGuardedLink, confirmDownload, dialogs };
}
