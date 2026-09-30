'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { useTheme } from '@/components/ThemeProvider';
import { buildMailThemeCss, readMailTokens } from '@/lib/mail-theme';
import { analyzeLink, describeLinkRisk, registrableDomain, TWO_LEVEL_SUFFIXES } from '@/lib/link-safety';
import { assetCspSource } from '@/lib/cid-display';

/** Textos del estado de carga / error (i18n los aporta quien usa el componente; sin ellos no hay UI de error). */
export interface SafeIframeLabels {
    title?: string;
    loading: string;
    failed: string;
    retry: string;
    viewText: string;
    viewHtml: string;
}

interface SafeIframeProps {
    html: string;
    className?: string;
    /** Bloquea imagenes remotas (anti tracking pixel). Por defecto false para no cambiar la UX. */
    blockRemoteImages?: boolean;
    /**
     * Fuentes CSP (`https://origen/api/assets/`) de imagenes propias (adjuntos inline firmados) que se permiten aunque las
     * remotas esten bloqueadas. Se validan de nuevo aqui: solo se admite el proxy /api/assets de un origen http(s).
     */
    trustedImageSources?: string[];
    /** Textos para el esqueleto de carga y el error con "Reintentar" / "Ver texto plano". */
    labels?: SafeIframeLabels;
    /** Milisegundos sin recibir la altura del documento antes de considerar que fallo (por defecto 5000). */
    loadTimeoutMs?: number;
    /**
     * Endurecimiento de remitentes externos: los enlaces http(s) cuyo dominio registrable difiere de `senderDomain` NO se abren solos;
     * el documento avisa al lector (`onGuardedLink`) con el destino completo para que pida confirmacion. Sin esto, comportamiento normal.
     */
    linkGuard?: { senderDomain: string } | null;
    onGuardedLink?: (href: string) => void;
}

const IFRAME_CSS = `
* { box-sizing: border-box; }
html { width: 100%; max-width: 100%; overflow-x: hidden; }
body { margin: 0; padding: 0; width: 100%; max-width: 100%; overflow-x: hidden; }
#content { display: block; padding: 1px; width: 100%; max-width: 100%; overflow-x: auto; overflow-y: hidden; }
.bx-linkwarn {
    display: inline-block; margin: 0 0 0 4px; padding: 0 5px; font-size: 11px; line-height: 1.6;
    color: var(--bx-warn-text); background: var(--bx-warn-bg); border: 1px solid var(--bx-warn-border); border-radius: 4px;
    text-decoration: none; word-break: break-all; font-weight: 600;
}
`;

// Script propio (unico permitido por CSP via nonce). No contiene datos del correo.
// Altura: se envia al iniciar, al terminar de cargar (load), ante cualquier cambio de tamano del contenido (ResizeObserver),
// al cargar/fallar imagenes y fuentes, al cambiar el ancho y, como red de seguridad, por sondeo suave (500 ms).
// El plegado de citas NO vive aqui: lo hace el lector (quoted-html.ts) para no duplicar botones ni ocultar todo el mensaje.
const IFRAME_SCRIPT = `
(function () {
    var last = -1, timer = 0;
    function measure() {
        var c = document.getElementById('content');
        if (!c) return 0;
        return Math.ceil(Math.max(c.getBoundingClientRect().height, c.scrollHeight || 0));
    }
    function post(force, phase) {
        var h = measure();
        if (!force && h === last) return;
        last = h;
        try { window.parent.postMessage({ type: 'bloomx-resize', token: TOKEN, height: h, phase: phase || 'tick' }, '*'); } catch (e) { /* noop */ }
    }
    function schedule() {
        if (timer) return;
        timer = setTimeout(function () { timer = 0; post(false); }, 30);
    }
    function regDomain(host) {
        var l = String(host || '').toLowerCase().replace(/^www[.]/, '').split('.').filter(Boolean);
        if (l.length <= 2) return l.join('.');
        return (typeof GUARD !== 'undefined' && GUARD && GUARD.suffixes.indexOf(l.slice(-2).join('.')) >= 0) ? l.slice(-3).join('.') : l.slice(-2).join('.');
    }
    function guardLink(e, target) {
        if (typeof GUARD === 'undefined' || !GUARD || !target || !target.href) return false;
        var u;
        try { u = new URL(target.href); } catch (err) { return false; }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
        if (regDomain(u.hostname) === GUARD.sender) return false;
        e.preventDefault();
        try { window.parent.postMessage({ type: 'bloomx-link', token: TOKEN, href: String(u.href).slice(0, 4000) }, '*'); } catch (err) { /* noop */ }
        return true;
    }
    document.addEventListener('auxclick', function (e) {
        var t = e.target && e.target.closest ? e.target.closest('a') : null;
        if (t) guardLink(e, t);
    });
    document.addEventListener('click', function (e) {
        var target = e.target && e.target.closest ? e.target.closest('a') : null;
        if (target && guardLink(e, target)) return;
        if (target) {
            target.target = '_blank';
            target.rel = 'noopener noreferrer nofollow';
        }
    });
    post(true, 'init');
    window.addEventListener('load', function () {
        post(true, 'load');
        setTimeout(function () { post(false); }, 120);
        setTimeout(function () { post(false); }, 600);
    });
    window.addEventListener('resize', schedule);
    document.addEventListener('load', schedule, true);
    document.addEventListener('error', schedule, true);
    var c = document.getElementById('content');
    if (window.ResizeObserver && c) {
        var ro = new ResizeObserver(schedule);
        ro.observe(c);
        ro.observe(document.body);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
    setInterval(function () { post(false); }, 500);
})();
`;

/**
 * Tema del correo derivado de los tokens del tema activo (ver `@/lib/mail-theme`): papel, texto,
 * enlaces (--link), citas, tipografia y avisos. 'invert' (defecto) o 'paper' (invert + hue-rotate con colores
 * pre-invertidos e imagenes re-invertidas). Solo se concatenan colores calculados por nosotros.
 */
function buildThemeCss(scheme: 'light' | 'dark', invertMode: boolean): string {
    const tokens = readMailTokens(typeof document !== 'undefined' ? document.documentElement : null, scheme);
    return buildMailThemeCss(tokens, scheme, invertMode);
}

/**
 * Anti-phishing: junto a cada enlace sospechoso (el texto muestra otro dominio, punycode, IP,
 * credenciales en la URL, acortador) se anade el dominio REAL de destino. Se trabaja sobre HTML ya
 * sanitizado, con un <template> inerte, y el texto del aviso se inserta con textContent.
 */
function annotateSuspiciousLinks(safeHtml: string): string {
    if (typeof document === 'undefined') return safeHtml;
    try {
        const tpl = document.createElement('template');
        tpl.innerHTML = safeHtml;
        tpl.content.querySelectorAll('a[href]').forEach((a) => {
            const risk = analyzeLink(a.textContent || '', a.getAttribute('href') || '');
            if (!risk) return;
            const reason = describeLinkRisk(risk);
            a.setAttribute('title', `Destino real: ${risk.host} (${reason})`);
            const badge = document.createElement('span');
            badge.className = 'bx-linkwarn';
            badge.textContent = `⚠ ${risk.host}`;
            a.after(badge);
        });
        return tpl.innerHTML;
    } catch {
        return safeHtml;
    }
}

/** Texto plano legible de un HTML ya saneado (sin style/script/title). Para la vista "texto plano" del error. */
export function htmlToReadableText(safeHtml: string): string {
    if (typeof document === 'undefined') return '';
    try {
        const tpl = document.createElement('template');
        tpl.innerHTML = safeHtml;
        tpl.content.querySelectorAll('style,script,title,template,noscript,head').forEach((n) => n.remove());
        tpl.content.querySelectorAll('br').forEach((n) => n.replaceWith('\n'));
        tpl.content.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,h5,h6,blockquote').forEach((n) => n.append('\n'));
        return (tpl.content.textContent || '').replace(/[ \t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    } catch {
        return '';
    }
}

function randomToken(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Construye el documento aislado. Defensa en profundidad:
 *  1. HTML re-sanitizado con DOMPurify (idempotente si ya venia sanitizado).
 *  2. iframe sandbox SIN allow-same-origin: origen opaco, sin acceso a cookies,
 *     localStorage ni DOM de la app aunque existiera un bypass del sanitizador.
 *  3. CSP en el documento: solo nuestro script (nonce), sin conexiones, sin
 *     frames, sin formularios, sin CSS/fuentes/imagenes fuera de HTTPS.
 */
function buildDocument(safeHtml: string, nonce: string, token: string, blockRemoteImages: boolean, themeCss = '', trustedImageSources: string[] = [], guardDomain = ''): string {
    const trusted = Array.from(new Set(trustedImageSources.map((s) => assetCspSource(s)).filter((s): s is string => !!s)));
    const csp = [
        "default-src 'none'",
        `img-src ${blockRemoteImages ? ['data:', 'cid:', ...trusted].join(' ') : 'https: data: cid:'}`,
        "style-src 'unsafe-inline'",
        'font-src data:',
        `script-src 'nonce-${nonce}'`,
        "connect-src 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "form-action 'none'",
    ].join('; ');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${IFRAME_CSS}${themeCss}</style>
</head>
<body>
<div id="content">${annotateSuspiciousLinks(safeHtml)}</div>
<script nonce="${nonce}">
var TOKEN = ${JSON.stringify(token)};
var GUARD = ${guardDomain ? JSON.stringify({ sender: guardDomain, suffixes: Array.from(TWO_LEVEL_SUFFIXES) }).replace(/</g, '\\u003c') : 'null'};
${IFRAME_SCRIPT}
</script>
</body>
</html>`;
}

/** Alto inicial (esqueleto) hasta recibir la primera medida real. */
const INITIAL_HEIGHT = 96;

interface BuiltDoc { id: number; srcDoc: string; token: string; safeHtml: string }

export function SafeIframe({ html, className, blockRemoteImages = false, trustedImageSources, labels, loadTimeoutMs = 5000, linkGuard, onGuardedLink }: SafeIframeProps) {
    const guardDomain = linkGuard?.senderDomain ? registrableDomain(linkGuard.senderDomain) : '';
    const guardCbRef = useRef(onGuardedLink);
    guardCbRef.current = onGuardedLink;
    const trustedKey = (trustedImageSources || []).join(' ');
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const tokenRef = useRef<string>('');
    const idRef = useRef(0);
    const loadedOnceRef = useRef(false);
    const [height, setHeight] = useState(INITIAL_HEIGHT);
    const [doc, setDoc] = useState<BuiltDoc | null>(null);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const [asText, setAsText] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const { scheme, mailDarkMode, resolvedTheme } = useTheme();
    const themeId = resolvedTheme?.id;
    const invertMode = scheme === 'dark' && mailDarkMode === 'invert';
    const isEmpty = !String(html || '').trim();

    useEffect(() => {
        // Solo en cliente (DOMPurify necesita DOM; crypto para nonce/token).
        if (isEmpty) { setDoc(null); return; }
        try {
            const token = randomToken();
            tokenRef.current = token;
            const safeHtml = sanitizeHtml(html);
            const srcDoc = buildDocument(safeHtml, randomToken(), token, blockRemoteImages, buildThemeCss(scheme, invertMode), trustedKey ? trustedKey.split(' ') : [], guardDomain);
            idRef.current += 1;
            setReady(loadedOnceRef.current); // ya se mostro algo antes: se conserva la altura previa sin esqueleto
            setFailed(false);
            setDoc({ id: idRef.current, srcDoc, token, safeHtml });
        } catch (error) {
            console.error('SafeIframe: no se pudo construir el documento', error);
            setFailed(true);
        }
    }, [html, isEmpty, blockRemoteImages, invertMode, scheme, themeId, trustedKey, attempt, guardDomain]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const iframe = iframeRef.current;
            // Solo mensajes de NUESTRO iframe y con el token de este render.
            if (!iframe || event.source !== iframe.contentWindow) return;
            const data = event.data;
            if (data && data.type === 'bloomx-link' && data.token === tokenRef.current) {
                if (typeof data.href === 'string' && /^https?:\/\//i.test(data.href)) guardCbRef.current?.(data.href.slice(0, 4000));
                return;
            }
            if (!data || data.type !== 'bloomx-resize' || data.token !== tokenRef.current) return;
            const h = Number(data.height);
            if (!Number.isFinite(h) || h < 0) return;
            if (h > 0) setHeight(Math.min(Math.ceil(h), 50000));
            // "Listo" con la primera altura real (>0) o al terminar de cargar el documento.
            if (h > 0 || data.phase === 'load') {
                loadedOnceRef.current = true;
                setReady(true);
                setFailed(false);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // Sin altura en `loadTimeoutMs`: error con "Reintentar" (o, sin textos, se muestra con una altura razonable).
    useEffect(() => {
        if (!doc || ready) return undefined;
        const timer = setTimeout(() => {
            if (labels) setFailed(true);
            else { setHeight((h) => Math.max(h, 200)); setReady(true); }
        }, loadTimeoutMs);
        return () => clearTimeout(timer);
    }, [doc, ready, labels, loadTimeoutMs]);

    const retry = useCallback(() => {
        loadedOnceRef.current = false;
        setAsText(false);
        setAttempt((n) => n + 1);
    }, []);

    if (isEmpty) return null;

    const dark = scheme === 'dark' && !invertMode;
    // El marco de 1px (box-sizing: border-box) no debe robar alto al documento.
    const showSkeleton = !ready && !failed;

    if (failed && labels) {
        const text = doc ? htmlToReadableText(doc.safeHtml) : htmlToReadableText(sanitizeHtml(html));
        return (
            <div role="alert" data-mail-body-error className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
                <p>{labels.failed}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={retry} className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{labels.retry}</button>
                    {text && (
                        <button type="button" aria-pressed={asText} onClick={() => setAsText((v) => !v)} className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{asText ? labels.viewHtml : labels.viewText}</button>
                    )}
                </div>
                {asText && text && <pre className="mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-code p-3 text-xs text-code-foreground">{text}</pre>}
            </div>
        );
    }

    return (
        <div className="relative" data-mail-body data-state={ready ? 'ready' : 'loading'} aria-busy={!ready}>
            {showSkeleton && (
                <div role="status" className="absolute inset-0 z-10 flex flex-col gap-2 overflow-hidden rounded-lg bg-background p-1">
                    <span className="sr-only">{labels?.loading}</span>
                    <div aria-hidden="true" className="h-3 w-3/4 rounded bg-muted motion-safe:animate-pulse" />
                    <div aria-hidden="true" className="h-3 w-full rounded bg-muted motion-safe:animate-pulse" />
                    <div aria-hidden="true" className="h-3 w-2/3 rounded bg-muted motion-safe:animate-pulse" />
                </div>
            )}
            {doc && (
                <iframe
                    key={doc.id}
                    ref={iframeRef}
                    className={className}
                    style={{
                        width: '100%', maxWidth: '100%', height: `${height + (dark ? 2 : 0)}px`, display: 'block', overflow: 'hidden', colorScheme: 'light',
                        border: dark ? '1px solid var(--color-border)' : 'none', borderRadius: dark ? 12 : 0,
                    }}
                    title={labels?.title || 'Email Content'}
                    referrerPolicy="no-referrer"
                    sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts"
                    srcDoc={doc.srcDoc}
                />
            )}
        </div>
    );
}
