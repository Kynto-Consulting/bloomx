'use client';

import React, { useEffect, useRef, useState } from 'react';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { useTheme } from '@/components/ThemeProvider';
import { invert, normalizeHex } from '@/lib/color';
import { analyzeLink, describeLinkRisk } from '@/lib/link-safety';

interface SafeIframeProps {
    html: string;
    className?: string;
    /** Bloquea imagenes remotas (anti tracking pixel). Por defecto false para no cambiar la UX. */
    blockRemoteImages?: boolean;
}

const IFRAME_CSS = `
* { box-sizing: border-box; }
html { width: 100%; max-width: 100%; overflow-x: hidden; }
body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #1a1a1a;
    width: 100%;
    max-width: 100%;
    overflow-x: hidden;
    word-break: break-word;
    overflow-wrap: anywhere;
}
table { width: 100% !important; max-width: 100% !important; table-layout: fixed; }
th, td { word-break: break-word; overflow-wrap: anywhere; }
img { max-width: 100%; height: auto; }
a { color: #2563eb; text-decoration: underline; word-break: break-word; overflow-wrap: anywhere; }
pre, code { white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; }
blockquote { margin: 0 0 0 .8ex; border-left: 1px #999 solid; padding-left: 1ex; max-width: 100%; }
.gmail_quote_toggle {
    display: inline-flex; align-items: center; justify-content: center;
    width: 32px; height: 24px; background-color: #f3f4f6; border: 1px solid #d1d5db;
    border-radius: 4px; cursor: pointer; margin: 8px 0; color: #6b7280;
    font-weight: bold; font-size: 12px; position: relative; z-index: 50;
}
.bx-linkwarn {
    display: inline-block; margin: 0 0 0 4px; padding: 0 5px; font-size: 11px; line-height: 1.6;
    color: #92400e; background: #fef3c7; border: 1px solid #f59e0b; border-radius: 4px;
    text-decoration: none; word-break: break-all; font-weight: 600;
}
#content { display: block; padding: 1px; width: 100%; max-width: 100%; overflow-x: hidden; }
`;

// Script propio (unico permitido por CSP via nonce). No contiene datos del correo.
const IFRAME_SCRIPT = `
function updateHeight() {
    var content = document.getElementById('content');
    if (!content) return;
    window.parent.postMessage({ type: 'bloomx-resize', token: TOKEN, height: content.scrollHeight }, '*');
}

function setupQuotes() {
    try {
        var content = document.getElementById('content');
        if (!content) return;
        var quotes = content.querySelectorAll('.gmail_quote, blockquote, [class*="gmail_quote"]');
        var firstQuote = quotes[0];
        if (firstQuote && !firstQuote.dataset.processed) {
            firstQuote.dataset.processed = 'true';
            var prev = firstQuote.previousElementSibling;
            var attribution = null;
            var attempts = 3;
            while (prev && attempts > 0) {
                var text = prev.textContent.trim().toLowerCase();
                if (!text && prev.innerHTML.trim() === '<br>') {
                    prev = prev.previousElementSibling;
                    attempts--;
                    continue;
                }
                if (
                    prev.classList.contains('gmail_attr') ||
                    text.includes('wrote:') ||
                    (text.includes('wrote') && text.includes('on ')) ||
                    text.includes('schrieb:') ||
                    text.includes('escribi\\u00f3:') ||
                    text.includes('enviado desde')
                ) {
                    attribution = prev;
                }
                break;
            }
            var elementsToToggle = [firstQuote];
            if (attribution) elementsToToggle.push(attribution);
            elementsToToggle.forEach(function (el) { el.style.setProperty('display', 'none', 'important'); });

            var btn = document.createElement('div');
            btn.className = 'gmail_quote_toggle';
            btn.textContent = '\\u2022\\u2022\\u2022';
            btn.title = 'Show quoted text';
            btn.style.cssText = 'display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 24px; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; color: #4b5563; font-weight: bold; font-size: 14px; margin: 8px 0; user-select: none; z-index: 50;';
            btn.onclick = function (e) {
                e.preventDefault();
                e.stopPropagation();
                var isHidden = firstQuote.style.display === 'none';
                elementsToToggle.forEach(function (el) { el.style.display = isHidden ? 'block' : 'none'; });
                btn.textContent = isHidden ? 'Close' : '\\u2022\\u2022\\u2022';
                btn.style.width = isHidden ? 'auto' : '32px';
                btn.style.padding = isHidden ? '0 8px' : '0';
                updateHeight();
                setTimeout(updateHeight, 50);
                setTimeout(updateHeight, 200);
            };
            var insertPoint = attribution || firstQuote;
            if (insertPoint.parentNode) insertPoint.parentNode.insertBefore(btn, insertPoint);
        }
    } catch (e) { /* noop */ }
}

document.addEventListener('click', function (e) {
    var target = e.target && e.target.closest ? e.target.closest('a') : null;
    if (target) {
        target.target = '_blank';
        target.rel = 'noopener noreferrer nofollow';
    }
});

setupQuotes();
window.addEventListener('load', function () {
    setupQuotes();
    updateHeight();
    setTimeout(updateHeight, 100);
});

var contentEl = document.getElementById('content');
if (contentEl && window.ResizeObserver) {
    new ResizeObserver(function () { updateHeight(); }).observe(contentEl);
    new ResizeObserver(function () { updateHeight(); }).observe(document.body);
}
`;

/**
 * Tema del correo. Los correos HTML traen sus propios colores (casi siempre pensados
 * sobre blanco), asi que por defecto se muestran sobre "papel" blanco tambien en temas
 * oscuros ('paper'). Alternativa 'invert': invierte luminosidad conservando el tono
 * (invert + hue-rotate) y re-invierte imagenes/video para que no salgan en negativo.
 * Solo se concatenan colores calculados por nosotros, nunca datos del correo.
 */
function buildThemeCss(invertMode: boolean): string {
    if (!invertMode) return 'html { background: #ffffff; color-scheme: light; }';
    let parentBg = '#0f1115';
    try {
        const v = normalizeHex(getComputedStyle(document.documentElement).getPropertyValue('--color-background').trim());
        if (v) parentBg = v;
    } catch { /* usa el valor por defecto */ }
    return `
html { background: ${invert(parentBg)}; filter: invert(1) hue-rotate(180deg); }
img, video, picture, canvas, svg image, [style*="background-image"] { filter: invert(1) hue-rotate(180deg); }
.gmail_quote_toggle { filter: none; }`;
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
function buildDocument(rawHtml: string, nonce: string, token: string, blockRemoteImages: boolean, themeCss = ''): string {
    const safeHtml = annotateSuspiciousLinks(sanitizeHtml(rawHtml));
    const csp = [
        "default-src 'none'",
        `img-src ${blockRemoteImages ? 'data: cid:' : 'https: data: cid:'}`,
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
<style>${IFRAME_CSS}${themeCss}</style>
</head>
<body>
<div id="content">${safeHtml}</div>
<script nonce="${nonce}">
var TOKEN = ${JSON.stringify(token)};
${IFRAME_SCRIPT}
</script>
</body>
</html>`;
}

export function SafeIframe({ html, className, blockRemoteImages = false }: SafeIframeProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const tokenRef = useRef<string>('');
    const [height, setHeight] = useState('200px');
    const [srcDoc, setSrcDoc] = useState('');
    const { scheme, mailDarkMode } = useTheme();
    const invertMode = scheme === 'dark' && mailDarkMode === 'invert';

    useEffect(() => {
        // Solo en cliente (DOMPurify necesita DOM; crypto para nonce/token).
        tokenRef.current = randomToken();
        setSrcDoc(buildDocument(html || '', randomToken(), tokenRef.current, blockRemoteImages, buildThemeCss(invertMode)));
    }, [html, blockRemoteImages, invertMode]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const iframe = iframeRef.current;
            // Solo mensajes de NUESTRO iframe y con el token de este render.
            if (!iframe || event.source !== iframe.contentWindow) return;
            const data = event.data;
            if (!data || data.type !== 'bloomx-resize' || data.token !== tokenRef.current) return;
            const h = Number(data.height);
            if (!Number.isFinite(h) || h < 0) return;
            setHeight(`${Math.min(Math.ceil(h), 50000)}px`);
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    return (
        <iframe
            ref={iframeRef}
            className={className}
            style={{ width: '100%', maxWidth: '100%', height, border: 'none', overflow: 'hidden', colorScheme: 'light', borderRadius: scheme === 'dark' ? 8 : 0 }}
            title="Email Content"
            referrerPolicy="no-referrer"
            sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts"
            srcDoc={srcDoc}
        />
    );
}
