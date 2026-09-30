/**
 * HTML -> texto plano (puro, sin DOM, isomorfo). Lo usa el servidor para generar la alternativa text/plain
 * coherente de cada correo enviado y el redactor para la version texto de la cita.
 *
 * - Bloques (p, div, li, h1-6, tr...) producen saltos de linea; <br> un salto forzado; li se marca con "- ".
 * - Enlaces: "texto (url)" cuando el texto no es ya la URL.
 * - Imagenes: "[alt]" si tienen alt.
 * - <blockquote> (anidado) -> lineas prefijadas con "> " por nivel ("> > "). La atribucion ("El ..., X escribio:",
 *   div.gmail_attr) es una linea normal anterior a la cita.
 * - <style>, <script>, <head>, comentarios (incluidos los condicionales de Outlook) se descartan.
 */
import { decodeEntities, getAttr, tokenizeHtml } from '@/lib/html-tokenize';

export interface HtmlToPlainTextOptions {
    /** Longitud maxima del resultado; si se supera se corta en un salto de linea y se anade "...". */
    maxLength?: number;
}

const SKIP_TAGS = new Set(['script', 'style', 'head', 'title', 'template', 'noscript', 'svg', 'math', 'select', 'textarea', 'button']);
/** Bloques que solo exigen empezar linea nueva. */
const LINE_BLOCKS = new Set(['div', 'section', 'article', 'header', 'footer', 'nav', 'aside', 'main', 'tr', 'dt', 'dd', 'dl', 'address', 'figure', 'figcaption', 'form', 'fieldset', 'center', 'thead', 'tbody', 'tfoot', 'caption', 'details', 'summary']);
/** Bloques separados por una linea en blanco. */
const PARA_BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'pre']);
const HR_LINE = '________________________________';

interface Line { depth: number; text: string }

function normalizeUrlForCompare(v: string): string {
    return v.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase();
}

export function htmlToPlainText(html: string, opts: HtmlToPlainTextOptions = {}): string {
    const tokens = tokenizeHtml(String(html || ''));
    const lines: Line[] = [];
    let cur = '';
    let curDepth = 0;
    let depth = 0;
    let preDepth = 0;
    let skipName = '';
    let skipCount = 0;
    const listStack: string[] = [];
    const links: Array<{ href: string; text: string }> = [];

    let curIndent = '';
    const flush = () => {
        const t = cur.replace(/[ \t ]+/g, ' ').trim();
        if (t) lines.push({ depth: curDepth, text: curIndent + t });
        cur = '';
        curIndent = '';
    };
    const pushBlank = () => {
        const last = lines[lines.length - 1];
        if (!last) return; // nunca abre con linea en blanco
        if (last.text === '' && last.depth === depth) return;
        // Recien entrado en una cita: sin linea en blanco pegada a la atribucion.
        if (last.depth < depth) return;
        lines.push({ depth, text: '' });
    };
    const addText = (t: string) => {
        if (!t) return;
        if (!cur.trim()) curDepth = depth;
        cur += t;
        const l = links[links.length - 1];
        if (l) l.text += t;
    };
    const paraBreak = () => { flush(); pushBlank(); };

    for (const tok of tokens) {
        if (skipName) {
            if (tok.type === 'open' && tok.name === skipName && !tok.selfClosing) skipCount++;
            else if (tok.type === 'close' && tok.name === skipName) { skipCount--; if (skipCount <= 0) skipName = ''; }
            else if (skipName === 'head' && tok.type === 'open' && tok.name === 'body') skipName = '';
            continue;
        }
        if (tok.type === 'comment') continue;
        if (tok.type === 'text') {
            const decoded = decodeEntities(tok.raw).replace(/[​⁠﻿]/g, '');
            if (preDepth > 0) {
                const parts = decoded.replace(/\r\n?/g, '\n').split('\n');
                parts.forEach((p, idx) => {
                    if (idx > 0) { lines.push({ depth: curDepth, text: cur.replace(/\s+$/, '') }); cur = ''; }
                    if (!cur && !p) return;
                    if (!cur) curDepth = depth;
                    cur += p;
                    const l = links[links.length - 1];
                    if (l) l.text += p;
                });
            } else {
                addText(decoded.replace(/\s+/g, ' '));
            }
            continue;
        }
        if (tok.type === 'open') {
            const n = tok.name;
            if (SKIP_TAGS.has(n) && !tok.selfClosing) { skipName = n; skipCount = 1; continue; }
            if (n === 'br') {
                if (cur.trim()) flush();
                else { lines.push({ depth, text: '' }); cur = ''; }
                continue;
            }
            if (n === 'hr') { paraBreak(); lines.push({ depth, text: HR_LINE }); pushBlank(); continue; }
            if (n === 'img') {
                const alt = (getAttr(tok, 'alt') || '').replace(/\s+/g, ' ').trim();
                if (alt) addText(`[${alt}]`);
                continue;
            }
            if (n === 'a') { links.push({ href: (getAttr(tok, 'href') || '').trim(), text: '' }); continue; }
            if (n === 'blockquote') { flush(); depth++; continue; }
            if (n === 'ul' || n === 'ol') { if (listStack.length) flush(); else paraBreak(); listStack.push(n); continue; }
            if (n === 'li') {
                flush();
                curDepth = depth;
                curIndent = '  '.repeat(Math.max(0, listStack.length - 1));
                cur = '- ';
                continue;
            }
            if (n === 'td' || n === 'th') { if (cur.trim()) cur += ' '; continue; }
            if (n === 'pre') { paraBreak(); preDepth++; continue; }
            if (PARA_BLOCKS.has(n)) { paraBreak(); continue; }
            if (LINE_BLOCKS.has(n)) flush();
            continue;
        }
        // close
        const n = tok.name;
        if (n === 'a') {
            const l = links.pop();
            if (l) {
                const href = l.href;
                const text = l.text.replace(/\s+/g, ' ').trim();
                const isWeb = /^https?:\/\//i.test(href);
                const isMail = /^mailto:/i.test(href);
                if (isWeb || isMail) {
                    const shown = isMail ? href.replace(/^mailto:/i, '').split('?')[0] : href;
                    const same = isMail
                        ? text.toLowerCase() === shown.toLowerCase()
                        : normalizeUrlForCompare(text) === normalizeUrlForCompare(href);
                    if (!text) addText(shown);
                    else if (!same) addText(` (${shown})`);
                }
                const parent = links[links.length - 1];
                if (parent) parent.text += l.text;
            }
            continue;
        }
        if (n === 'blockquote') { flush(); if (depth > 0) depth--; pushBlank(); continue; }
        if (n === 'ul' || n === 'ol') { listStack.pop(); if (listStack.length) flush(); else paraBreak(); continue; }
        if (n === 'pre') { if (preDepth > 0) preDepth--; paraBreak(); continue; }
        if (n === 'td' || n === 'th') continue;
        if (n === 'li') { flush(); continue; }
        if (PARA_BLOCKS.has(n)) { paraBreak(); continue; }
        if (LINE_BLOCKS.has(n)) flush();
    }
    flush();

    // Colapsa blancos consecutivos y los de los extremos.
    const out: string[] = [];
    let prevBlankKey = '';
    for (const l of lines) {
        const prefix = '> '.repeat(l.depth);
        if (l.text === '') {
            const key = `b${l.depth}`;
            if (prevBlankKey === key) continue;
            prevBlankKey = key;
            out.push(prefix.trimEnd());
        } else {
            prevBlankKey = '';
            out.push(prefix + l.text);
        }
    }
    while (out.length && out[0] === '') out.shift();
    while (out.length && (out[out.length - 1] === '' || /^(?:>\s*)+$/.test(out[out.length - 1]))) out.pop();
    let text = out.join('\n');

    const max = opts.maxLength;
    if (max && max > 1 && text.length > max) {
        let cut = text.slice(0, max - 1);
        const nl = cut.lastIndexOf('\n');
        if (nl > max * 0.8) cut = cut.slice(0, nl);
        text = cut.trimEnd() + '…';
    }
    return text;
}
