'use client';

import { useEffect, useState } from 'react';
import { Download, Eye, File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Presentation, CalendarDays, X, type LucideIcon } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useI18n } from '@/components/I18nProvider';
import { attachmentKind, formatBytes, isPreviewable, type AttachmentKind } from '@/lib/mail-view-state';

const KIND_ICON: Record<AttachmentKind, LucideIcon> = {
    image: FileImage, pdf: FileText, doc: FileText, sheet: FileSpreadsheet, slides: Presentation, archive: FileArchive,
    audio: FileAudio, video: FileVideo, text: FileText, calendar: CalendarDays, other: File,
};

/**
 * El proxy /api/assets sirve con Content-Disposition: attachment y CSP sandbox (seguridad), asi que un <iframe src=url>
 * no muestra el PDF. Se descarga con fetch y se muestra desde un blob: (solo si el tipo real es application/pdf).
 */
function usePdfBlobUrl(url: string | null | undefined, enabled: boolean) {
    const [state, setState] = useState<{ src: string | null; error: boolean; loading: boolean }>({ src: null, error: false, loading: false });
    useEffect(() => {
        if (!enabled || !url) { setState({ src: null, error: false, loading: false }); return; }
        let cancelled = false;
        let objectUrl: string | null = null;
        setState({ src: null, error: false, loading: true });
        fetch(url)
            .then(async (res) => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const blob = await res.blob();
                if (blob.type !== 'application/pdf') throw new Error('not a pdf');
                objectUrl = URL.createObjectURL(blob);
                if (!cancelled) setState({ src: objectUrl, error: false, loading: false });
            })
            .catch(() => { if (!cancelled) setState({ src: null, error: true, loading: false }); });
        return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [url, enabled]);
    return state;
}

export interface AttachmentLike {
    id?: string;
    filename?: string | null;
    mimeType?: string | null;
    size?: number | null;
    url?: string | null;
}

/**
 * Adjuntos de un mensaje: icono por tipo, nombre, tamano, descarga y previsualizacion de imagenes y PDF en un dialogo.
 * Las URL ya vienen firmadas del servidor (GET /api/emails/[id]).
 */
export function AttachmentList({ attachments, confirmDownload }: {
    attachments: AttachmentLike[];
    /** Remitente externo no confiable: pide confirmacion antes de descargar; `proceed` hace la descarga real. */
    confirmDownload?: ((att: AttachmentLike, proceed: () => void) => void) | null;
}) {
    const { t, intlLocale } = useI18n();
    const [preview, setPreview] = useState<AttachmentLike | null>(null);
    if (!attachments || attachments.length === 0) return null;

    const guardDownload = (att: AttachmentLike) => (e: { preventDefault: () => void }) => {
        if (!confirmDownload || !att.url) return;
        e.preventDefault();
        const url = att.url;
        confirmDownload(att, () => {
            const a = document.createElement('a');
            a.href = url;
            if (att.filename) a.download = att.filename;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            document.body.appendChild(a);
            a.click();
            a.remove();
        });
    };

    const previewKind = preview ? attachmentKind(preview.mimeType, preview.filename) : null;
    const pdf = usePdfBlobUrl(preview?.url, previewKind === 'pdf');

    return (
        <section aria-label={t('mailView.attachments.title', { n: attachments.length })} className="mt-6 border-t border-border pt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(attachments.length === 1 ? 'mailView.attachments.titleOne' : 'mailView.attachments.titleMany', { n: attachments.length })}
            </h3>
            <ul className="flex flex-wrap gap-2">
                {attachments.map((att, i) => {
                    const kind = attachmentKind(att.mimeType, att.filename);
                    const Icon = KIND_ICON[kind];
                    const name = att.filename || t('mailView.attachments.unnamed');
                    const size = formatBytes(att.size, intlLocale);
                    const canPreview = Boolean(att.url) && isPreviewable(kind, att.mimeType, att.filename);
                    return (
                        <li key={att.id || `${name}-${i}`} data-attachment-kind={kind} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2 text-card-foreground">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                            <span className="flex min-w-0 max-w-[14rem] flex-col">
                                <span className="truncate text-sm font-medium" title={name}>{name}</span>
                                {size && <span className="text-xs text-muted-foreground">{size}</span>}
                            </span>
                            {canPreview && (
                                <button
                                    type="button"
                                    onClick={() => setPreview(att)}
                                    aria-label={t('mailView.attachments.preview', { name })}
                                    title={t('mailView.attachments.previewShort')}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                                >
                                    <Eye className="h-4 w-4" aria-hidden="true" />
                                </button>
                            )}
                            <a
                                href={att.url || undefined}
                                download={att.filename || undefined}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={guardDownload(att)}
                                aria-disabled={!att.url}
                                aria-label={t('mailView.attachments.download', { name })}
                                title={t('mailView.attachments.downloadShort')}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
                            >
                                <Download className="h-4 w-4" aria-hidden="true" />
                            </a>
                        </li>
                    );
                })}
            </ul>

            <Modal
                open={preview !== null}
                onClose={() => setPreview(null)}
                panelClassName="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border shadow-xl"
            >
                {({ titleId }) => preview && (
                    <>
                        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                            <h2 id={titleId} className="truncate text-sm font-semibold">{preview.filename}</h2>
                            <div className="flex shrink-0 items-center gap-1">
                                <a
                                    href={preview.url || undefined}
                                    download={preview.filename || undefined}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={guardDownload(preview)}
                                    className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    <Download className="h-4 w-4" aria-hidden="true" /> {t('mailView.attachments.downloadShort')}
                                </a>
                                <button
                                    type="button"
                                    onClick={() => setPreview(null)}
                                    aria-label={t('common.close')}
                                    className="rounded-md p-1.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    <X className="h-4 w-4" aria-hidden="true" />
                                </button>
                            </div>
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto bg-muted p-2">
                            {previewKind === 'image' ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={preview.url || ''} alt={preview.filename || ''} className="mx-auto max-h-[75vh] max-w-full object-contain" />
                            ) : pdf.src ? (
                                <iframe src={pdf.src} title={preview.filename || ''} className="h-[75vh] w-full rounded-md border-0 bg-background" />
                            ) : (
                                <p role={pdf.error ? 'alert' : 'status'} className="p-6 text-center text-sm text-muted-foreground">
                                    {pdf.error ? t('mailView.attachments.previewFailed') : t('common.loading')}
                                </p>
                            )}
                        </div>
                    </>
                )}
            </Modal>
        </section>
    );
}
