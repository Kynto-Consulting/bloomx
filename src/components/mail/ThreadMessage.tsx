'use client';

import { memo, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronUp, Clock, Forward, ImageOff, Paperclip, Reply, ReplyAll, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/I18nProvider';
import { SafeIframe } from '@/components/ui/SafeIframe';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { resolveInlineCidImages } from '@/lib/cid-display';
import { extractEmailOnly, splitAddressList } from '@/lib/email-utils';
import type { AuthVerdict, EmailAuthentication } from '@/lib/email-auth';
import { senderAddress, senderName } from '@/lib/mail-list-view';
import { summarizeRecipients } from '@/lib/mail-view-state';
import {
    allowForEmail, allowForSender, hasRemoteImages, isRemoteImagesAllowed, type RemoteImagePolicy,
} from '@/lib/remote-images';
import { InviteCard } from './InviteCard';
import { isLegacyEmptyPlaceholder, looksLikeAuthReport } from '@/lib/mail-empty-body';
import type { JoinLinkResult } from '@/lib/calendar/join-link';
import { Avatar } from './ui';
import { AttachmentList } from './AttachmentList';
import { useMessageSpam } from '@/components/spam/useMessageSpam';
import { SpamReaderNotices } from '@/components/spam/SpamReaderNotices';
import { htmlHasVisibleContent, splitQuotedHtml } from './quoted-html';
import type { DedupeResult } from './thread-dedupe';
import type { EmailDetails, InvitePreview } from './reader-types';

const VERDICT_KEYS: Record<AuthVerdict, string> = {
    pass: 'mailView.auth.verdict.pass',
    fail: 'mailView.auth.verdict.fail',
    softfail: 'mailView.auth.verdict.softfail',
    neutral: 'mailView.auth.verdict.neutral',
    none: 'mailView.auth.verdict.none',
    temperror: 'mailView.auth.verdict.temperror',
    permerror: 'mailView.auth.verdict.permerror',
    unknown: 'mailView.auth.verdict.unknown',
};

const SUMMARY_KEYS = {
    verified: 'mailView.auth.verified',
    partial: 'mailView.auth.partial',
    failed: 'mailView.auth.failed',
    unknown: 'mailView.auth.unknown',
} as const;

/** Insignia de autenticacion SPF/DKIM/DMARC (solo informativa; ver src/lib/email-auth.ts). */
function AuthBadge({ auth }: { auth?: EmailAuthentication | null }) {
    const { t } = useI18n();
    if (!auth) return null;
    const detail = `SPF: ${t(VERDICT_KEYS[auth.spf])} · DKIM: ${t(VERDICT_KEYS[auth.dkim])} · DMARC: ${t(VERDICT_KEYS[auth.dmarc])}`
        + (auth.trusted ? '' : ` · ${t('mailView.auth.untrustedHeaders')}`);
    const cfg = {
        verified: { Icon: ShieldCheck, cls: 'border-success/40 bg-success/10 text-success' },
        partial: { Icon: ShieldQuestion, cls: 'border-warning/40 bg-warning/10 text-warning' },
        failed: { Icon: ShieldAlert, cls: 'border-destructive/40 bg-destructive/10 text-destructive' },
        unknown: { Icon: ShieldQuestion, cls: 'border-border bg-muted text-muted-foreground' },
    }[auth.summary];
    const Icon = cfg.Icon;
    const untrusted = !auth.trusted && auth.summary === 'verified';
    const text = untrusted ? t('mailView.auth.verifiedUntrusted') : t(SUMMARY_KEYS[auth.summary]);
    const mark = (v: AuthVerdict, strict: boolean) => (v === 'pass' ? '✓' : v === 'fail' || (!strict && v === 'softfail') ? '✗' : '?');
    return (
        <span
            className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', untrusted ? 'border-warning/40 bg-warning/10 text-warning' : cfg.cls)}
            title={detail}
            aria-label={`${t('mailView.auth.label')}: ${text}. ${detail}`}
        >
            <Icon className="h-3 w-3" aria-hidden="true" />
            {text}
            <span className="hidden font-normal md:inline">
                SPF {mark(auth.spf, false)} DKIM {mark(auth.dkim, true)} DMARC {mark(auth.dmarc, true)}
            </span>
        </span>
    );
}

function addressNames(value?: string | null): string[] {
    return splitAddressList(value).map((entry) => senderName(entry) || extractEmailOnly(entry)).filter(Boolean);
}

interface Props {
    item: EmailDetails;
    index: number;
    expanded: boolean;
    /** El mensaje llego sin leer: se resalta (aunque ya se haya marcado como leido al abrirlo). */
    wasUnread: boolean;
    imagePolicy: RemoteImagePolicy;
    onImagePolicy: (next: RemoteImagePolicy) => void;
    onToggle: (id: string) => void;
    onReply: (item: EmailDetails) => void;
    onReplyAll: (item: EmailDetails) => void;
    onForward: (item: EmailDetails) => void;
    inviteBusy: boolean;
    calendarBusy: boolean;
    onInvite: (emailId: string, response: 'accepted' | 'tentative' | 'declined') => void;
    onAddToCalendar: (emailId: string, invite: InvitePreview) => void;
    /** Direcciones propias (se muestran como "yo"). */
    own: Set<string>;
    /** Decide boton / texto / nada para el enlace de reunion de una invitacion (ver lib/calendar/join-link). */
    resolveJoin: (invite: InvitePreview) => JoinLinkResult;
    /** Resultado del deduplicado del historial en el hilo (ver thread-dedupe.ts). Sin el, el historial siempre va plegado. */
    dedupe?: DedupeResult;
    /** Interruptor "ocultar historial repetido": con el, un historial que NO coincide con el hilo se muestra abierto y marcado. */
    hideDuplicates?: boolean;
    /** Accion existente del lector "No es spam" (la usa el banner "Por que" de la carpeta spam). */
    onNotSpam?: () => void;
}

function ThreadMessageInner({
    item, index, expanded, wasUnread, imagePolicy, onImagePolicy, onToggle, onReply, onReplyAll, onForward,
    inviteBusy, calendarBusy, onInvite, onAddToCalendar, own, resolveJoin, dedupe, hideDuplicates, onNotSpam,
}: Props) {
    const { t, intlLocale } = useI18n();
    const [details, setDetails] = useState(false);
    const [quotedOverride, setQuotedOverride] = useState<boolean | null>(null);
    const email = item.email;

    const fullDate = useMemo(() => {
        const d = new Date(email.createdAt);
        if (Number.isNaN(d.getTime())) return '';
        try { return new Intl.DateTimeFormat(intlLocale, { dateStyle: 'full', timeStyle: 'short' }).format(d); } catch { return d.toISOString(); }
    }, [email.createdAt, intlLocale]);
    const shortDate = useMemo(() => {
        const d = new Date(email.createdAt);
        if (Number.isNaN(d.getTime())) return '';
        try { return new Intl.DateTimeFormat(intlLocale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(d); } catch { return ''; }
    }, [email.createdAt, intlLocale]);

    const isMine = own.has(senderAddress(email.from));
    const displayName = isMine ? t('mailView.me') : (senderName(email.from) || email.from);
    const toNames = addressNames(email.to).map((n) => (own.has(n.toLowerCase()) ? t('mailView.me') : n));
    const toSummary = summarizeRecipients(toNames, 2);

    // --- Contenido (solo si esta expandido) ---
    const cleanHtml = useMemo(() => (expanded ? sanitizeHtml(item.content || '') : ''), [expanded, item.content]);
    const split = useMemo(() => (expanded ? splitQuotedHtml(cleanHtml) : null), [expanded, cleanHtml]);
    // Abierto por decision del usuario; si no, solo cuando el interruptor de duplicados esta apagado o el historial no coincide con el hilo.
    const autoOpen = hideDuplicates !== undefined && (!hideDuplicates || dedupe?.status === 'unmatched');
    const showQuoted = quotedOverride ?? autoOpen;
    const unmatchedNote = Boolean(split) && hideDuplicates === true && dedupe?.status === 'unmatched';
    const shownHtml = split && !showQuoted ? split.main : cleanHtml;
    // Regla de oro: nunca un area en blanco. Si el HTML no tiene nada visible se muestra el extracto o un aviso.
    const emptyBody = useMemo(() => expanded && (!htmlHasVisibleContent(cleanHtml) || isLegacyEmptyPlaceholder(item.content)), [expanded, cleanHtml, item.content]);
    const realAttachments = Array.isArray(email.attachments) ? email.attachments : [];
    const authReport = emptyBody && looksLikeAuthReport(email.subject, realAttachments);
    const bodyLabels = useMemo(() => ({
        title: t('mailView.body.title'), loading: t('mailView.body.loading'), failed: t('mailView.body.failed'),
        retry: t('mailView.body.retry'), viewText: t('mailView.body.viewText'), viewHtml: t('mailView.body.viewHtml'),
    }), [t]);
    const remoteAllowed = isRemoteImagesAllowed(imagePolicy, email.id, email.from);
    const remoteBlocked = expanded && !remoteAllowed && hasRemoteImages(shownHtml);
    // `cid:` -> URL firmada del adjunto inline. Se calcula DESPUES de hasRemoteImages: las imagenes propias no cuentan como remotas.
    const cidResolved = useMemo(
        () => (expanded ? resolveInlineCidImages(shownHtml, email.attachments, typeof window !== 'undefined' ? window.location.origin : undefined) : { html: '', sources: [] as string[] }),
        [expanded, shownHtml, email.attachments],
    );

    const invite = item.invitePreview;
    const joinLink = invite ? resolveJoin(invite) : ({ kind: 'none' } as JoinLinkResult);
    const fmtInvite = (value?: string | null) => {
        if (!value) return '';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return value;
        return new Intl.DateTimeFormat(intlLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
    };

    const spam = useMessageSpam({ id: email.id, from: email.from, folder: email.folder, own, expanded });
    const attachmentCount = Array.isArray(email.attachments) ? email.attachments.length : 0;
    const headerId = `msg-head-${email.id}`;
    const bodyId = `msg-body-${email.id}`;

    return (
        <article
            data-message-id={email.id}
            data-unread={wasUnread || undefined}
            aria-label={t('mailView.message.aria', { name: displayName, date: shortDate })}
            className={cn(
                'relative border-b border-border transition-colors',
                expanded ? 'bg-background' : 'bg-muted/30 hover:bg-muted/50',
                wasUnread && 'border-l-4 border-l-primary bg-unread text-unread-foreground',
            )}
        >
            <button
                type="button"
                id={headerId}
                aria-expanded={expanded}
                aria-controls={bodyId}
                onClick={() => onToggle(email.id)}
                className="flex w-full min-w-0 items-start gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
                <Avatar from={email.from} className="h-9 w-9 text-xs" />
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-baseline gap-2">
                        <span className={cn('truncate text-sm', wasUnread || expanded ? 'font-semibold' : 'font-medium text-muted-foreground')}>{displayName}</span>
                        {expanded && <span className="hidden truncate text-xs text-muted-foreground sm:inline">&lt;{senderAddress(email.from)}&gt;</span>}
                        {wasUnread && <span className="shrink-0 rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">{t('mailView.message.new')}</span>}
                    </span>
                    {!expanded && <span className="truncate text-xs text-muted-foreground">{email.snippet || t('mailView.message.clickToExpand')}</span>}
                    {expanded && (
                        <span className="truncate text-xs text-muted-foreground">
                            {t('mailView.recipients.to')}: {toSummary.shown.join(', ')}{toSummary.extra > 0 ? ` +${toSummary.extra}` : ''}
                        </span>
                    )}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {attachmentCount > 0 && <Paperclip className="h-3.5 w-3.5" aria-label={t(attachmentCount === 1 ? 'emailList.row.attachmentOne' : 'emailList.row.attachmentMany', { n: attachmentCount })} />}
                    <span className="whitespace-nowrap">{shortDate}</span>
                    {expanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                </span>
            </button>

            {expanded && (
                <div id={bodyId} role="region" aria-labelledby={headerId} className="min-w-0 px-4 pb-6 sm:pl-16">
                    {/* Destinatarios expandibles */}
                    <div className="-mt-2 mb-3">
                        <button
                            type="button"
                            aria-expanded={details}
                            onClick={() => setDetails((v) => !v)}
                            className="inline-flex items-center gap-1 rounded text-xs font-medium text-link hover:text-link-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            {details ? t('mailView.recipients.hide') : t('mailView.recipients.show')}
                            {details ? <ChevronUp className="h-3 w-3" aria-hidden="true" /> : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
                        </button>
                        {details && (
                            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/40 p-3 text-xs" data-recipients-details>
                                <dt className="font-medium text-muted-foreground">{t('mailView.recipients.from')}</dt>
                                <dd className="min-w-0 break-words">{email.from}</dd>
                                <dt className="font-medium text-muted-foreground">{t('mailView.recipients.to')}</dt>
                                <dd className="min-w-0 break-words">{splitAddressList(email.to).join(', ') || '—'}</dd>
                                {email.cc ? (<><dt className="font-medium text-muted-foreground">{t('mailView.recipients.cc')}</dt><dd className="min-w-0 break-words">{splitAddressList(email.cc).join(', ')}</dd></>) : null}
                                {email.bcc ? (<><dt className="font-medium text-muted-foreground">{t('mailView.recipients.bcc')}</dt><dd className="min-w-0 break-words">{splitAddressList(email.bcc).join(', ')}</dd></>) : null}
                                <dt className="font-medium text-muted-foreground">{t('mailView.recipients.date')}</dt>
                                <dd>{fullDate}</dd>
                                {email.replyTo ? (<><dt className="font-medium text-muted-foreground">{t('mailView.transport.replyTo')}</dt><dd className="min-w-0 break-words">{email.replyTo}</dd></>) : null}
                                {item.transport?.mailedBy ? (<><dt className="font-medium text-muted-foreground">{t('mailView.transport.mailedBy')}</dt><dd className="min-w-0 break-words">{item.transport.mailedBy}</dd></>) : null}
                                {item.transport?.signedBy ? (<><dt className="font-medium text-muted-foreground">{t('mailView.transport.signedBy')}</dt><dd className="min-w-0 break-words">{item.transport.signedBy}</dd></>) : null}
                                {item.transport?.provider ? (<><dt className="font-medium text-muted-foreground">{t('mailView.transport.provider')}</dt><dd className="min-w-0 break-words">{item.transport.provider}</dd></>) : null}
                                {item.transport && item.transport.encrypted !== null ? (
                                    <>
                                        <dt className="font-medium text-muted-foreground">{t('mailView.transport.encryption')}</dt>
                                        <dd className={cn('min-w-0 break-words', item.transport.encrypted ? 'text-success' : 'text-warning')}>
                                            {item.transport.encrypted
                                                ? (item.transport.tlsVersion
                                                    ? t('mailView.transport.encryptedWith', { tls: [item.transport.tlsVersion, item.transport.cipher].filter(Boolean).join(' · ') })
                                                    : t('mailView.transport.encrypted'))
                                                : t('mailView.transport.notEncrypted')}
                                        </dd>
                                    </>
                                ) : null}
                                {item.transport?.originServer ? (<><dt className="font-medium text-muted-foreground">{t('mailView.transport.origin')}</dt><dd className="min-w-0 break-words">{item.transport.originServer}</dd></>) : null}
                                {item.transport?.receivedBy ? (<><dt className="font-medium text-muted-foreground">{t('mailView.transport.receivedBy')}</dt><dd className="min-w-0 break-words">{item.transport.receivedBy}</dd></>) : null}
                                {item.authentication ? (
                                    <>
                                        <dt className="font-medium text-muted-foreground">{t('mailView.transport.authentication')}</dt>
                                        <dd className="min-w-0 break-words">SPF {t(VERDICT_KEYS[item.authentication.spf])} · DKIM {t(VERDICT_KEYS[item.authentication.dkim])} · DMARC {t(VERDICT_KEYS[item.authentication.dmarc])}</dd>
                                    </>
                                ) : null}
                                {item.transport?.messageId ? (<><dt className="font-medium text-muted-foreground">{t('mailView.transport.messageId')}</dt><dd className="min-w-0 break-all text-[11px] text-muted-foreground">{item.transport.messageId}</dd></>) : null}
                            </dl>
                        )}
                        {item.authentication && <div className="mt-2"><AuthBadge auth={item.authentication} /></div>}
                    </div>

                    <SpamReaderNotices id={email.id} from={email.from} folder={email.folder} spam={spam} onNotSpam={onNotSpam} />

                    {invite && (
                        <InviteCard
                            invite={invite}
                            response={item.inviteResponse}
                            joinLink={joinLink}
                            whenText={invite.startsAt ? `${fmtInvite(invite.startsAt)}${invite.endsAt ? ` - ${fmtInvite(invite.endsAt)}` : ''}` : ''}
                            busy={inviteBusy}
                            calendarBusy={calendarBusy}
                            onRespond={(r) => onInvite(email.id, r)}
                            onAddToCalendar={() => onAddToCalendar(email.id, invite)}
                        />
                    )}

                    {remoteBlocked && (
                        <div role="status" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2 text-xs text-foreground">
                            <ImageOff className="h-4 w-4 shrink-0" aria-hidden="true" />
                            <span className="min-w-[180px] flex-1">{t('mailView.images.blocked')}</span>
                            <button type="button" onClick={() => onImagePolicy(allowForEmail(imagePolicy, email.id))} className="rounded-full border border-border bg-background px-3 py-1 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('mailView.images.load')}</button>
                            <button type="button" onClick={() => onImagePolicy(allowForSender(imagePolicy, email.from))} className="rounded-full border border-border bg-background px-3 py-1 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('mailView.images.always')}</button>
                        </div>
                    )}

                    {emptyBody ? (
                        <div data-mail-empty className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-sm text-foreground">
                            <p>
                                {realAttachments.length > 0
                                    ? t(realAttachments.length === 1 ? 'mailView.body.onlyAttachmentOne' : 'mailView.body.onlyAttachmentMany', { n: realAttachments.length })
                                    : (email.snippet && email.snippet !== '(No content)' ? email.snippet : t('mailView.body.empty'))}
                            </p>
                            {authReport && <p data-mail-auth-report className="mt-1 text-xs text-muted-foreground">{t('mailView.body.authReport')}</p>}
                        </div>
                    ) : (
                        <SafeIframe html={cidResolved.html} blockRemoteImages={!remoteAllowed} trustedImageSources={cidResolved.sources} labels={bodyLabels} linkGuard={spam.linkGuard} onGuardedLink={spam.onGuardedLink} />
                    )}

                    {unmatchedNote && (
                        <p role="note" data-quote-unmatched className="mt-2 text-xs text-muted-foreground">{t('mailView.quote.unmatched')}</p>
                    )}

                    {split && (
                        <button
                            type="button"
                            aria-expanded={showQuoted}
                            aria-label={showQuoted ? t('mailView.quote.hide') : t('mailView.quote.show')}
                            title={showQuoted ? t('mailView.quote.hide') : t('mailView.quote.show')}
                            onClick={() => setQuotedOverride(!showQuoted)}
                            data-quote-toggle
                            className="mt-2 inline-flex h-6 min-w-8 items-center justify-center rounded border border-border bg-chip px-2 text-xs font-bold tracking-widest text-chip-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            …
                        </button>
                    )}

                    {emptyBody && realAttachments.length > 0 ? (
                        <div data-mail-empty-attachments className="mt-3 rounded-xl border border-primary/40 bg-card p-2">
                            <AttachmentList attachments={realAttachments} confirmDownload={spam.confirmDownload} />
                        </div>
                    ) : (
                        <AttachmentList attachments={realAttachments} confirmDownload={spam.confirmDownload} />
                    )}

                    {index > 0 && (
                        <div className="mt-6 flex flex-wrap gap-2">
                            <button type="button" onClick={() => onReply(item)} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Reply className="h-4 w-4" aria-hidden="true" /> {t('mailView.reply.reply')}</button>
                            <button type="button" onClick={() => onReplyAll(item)} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ReplyAll className="h-4 w-4" aria-hidden="true" /> {t('mailView.reply.replyAll')}</button>
                            <button type="button" onClick={() => onForward(item)} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Forward className="h-4 w-4" aria-hidden="true" /> {t('mailView.reply.forward')}</button>
                        </div>
                    )}
                </div>
            )}
            {spam.dialogs}
        </article>
    );
}

export const ThreadMessage = memo(ThreadMessageInner);
