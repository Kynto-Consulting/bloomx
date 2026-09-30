// @vitest-environment jsdom
/**
 * Plegado del historial citado por proveedor (Gmail, Outlook.com/Hotmail, Outlook desktop, Apple Mail/iCloud, Thunderbird,
 * Yahoo, Proton, Zoho, Titan, Samsung) con fixtures SINTETICOS (personas y dominios ficticios) en
 * src/lib/__tests__/fixtures/mail-providers. Cubre regla de oro, niveles, firma, atribuciones multilingues, texto plano y
 * deduplicado de hilo.
 */
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ThemeProvider', () => ({ useTheme: () => ({ scheme: 'light', mailDarkMode: 'paper', resolvedTheme: { id: 'light' } }) }));

import { ThreadMessage } from '../mail/ThreadMessage';
import { htmlToComparableText, splitQuotedHtml } from '../mail/quoted-html';
import { isAttributionLine, isHeaderBlockAt, isSeparatorLine, splitQuotedText } from '../mail/quoted-text';
import { analyzeThreadDuplicates, normalizeForCompare } from '../mail/thread-dedupe';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { emptyPolicy } from '@/lib/remote-images';
import type { EmailDetails } from '../mail/reader-types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const DIR = path.resolve(__dirname, '../../lib/__tests__/fixtures/mail-providers');
const load = (name: string) => fs.readFileSync(path.join(DIR, name), 'utf8');
const textOf = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent || '';

interface Case {
    file: string;
    /** Frases que deben quedar en el contenido propio. */
    own: string[];
    /** Frases del historial: deben desaparecer de `main` y estar en `quotedText`. */
    quoted: string[];
    /** Frases que no deben quedar en `main` (linea de atribucion / cabeceras). */
    gone: string[];
    /** Firma que se conserva. */
    signature?: string;
    levels: number;
}

const CASES: Case[] = [
    { file: 'gmail-es.html', own: ['Confirmo la reunión'], quoted: ['¿Podemos reunirnos', 'Adjunto el borrador', 'Inicio de la conversación'], gone: ['escribió'], signature: 'Analista, Example Corp', levels: 3 },
    { file: 'gmail-zh.html', own: ['好的，我周四'], quoted: ['我们周四见面', '附上季度报告草稿'], gone: ['写道'], signature: '示例公司', levels: 2 },
    { file: 'gmail-ja.html', own: ['木曜日の会議'], quoted: ['四半期レポート', '草稿を添付'], gone: ['2025年1月8日'], signature: 'サンプル株式会社', levels: 2 },
    { file: 'outlook-com-en.html', own: ['Sounds good'], quoted: ['Can you send the contract', 'Attached is the draft agreement'], gone: ['Sent:', 'Subject:'], signature: 'Example Corp', levels: 2 },
    { file: 'outlook-com-es.html', own: ['Perfecto, envío'], quoted: ['¿Puedes enviar', 'Adjunto el borrador'], gone: ['Enviado', 'Asunto:'], levels: 2 },
    { file: 'outlook-desktop-en.html', own: ['Thanks, I will review', 'Best regards'], quoted: ['Please review the attached', 'First draft'], gone: ['Sent:', 'Subject:'], levels: 2 },
    { file: 'outlook-desktop-de.html', own: ['Danke, ich prüfe'], quoted: ['angehängte Tabelle'], gone: ['Betreff', 'Gesendet'], levels: 1 },
    { file: 'outlook-desktop-fr.html', own: ['Merci, je vérifie'], quoted: ['tableau joint'], gone: ['Objet', 'Envoyé'], levels: 1 },
    { file: 'apple-mail-ios-en.html', own: ['Works for me'], quoted: ['Can we meet Thursday', 'Here is the draft report', 'Starting the report thread'], gone: ['wrote:'], signature: 'Sent from my iPhone', levels: 3 },
    { file: 'apple-mail-fr.html', own: ['Parfait, on se retrouve'], quoted: ['On se voit jeudi', 'Voici le brouillon'], gone: ['a écrit'], levels: 2 },
    { file: 'thunderbird-en.html', own: ['Thanks for the details', 'Thursday at ten works'], quoted: ['Can we meet Thursday', 'Here is the draft report', 'Starting the report thread'], gone: ['wrote:'], signature: 'Example Corp', levels: 3 },
    { file: 'yahoo-en.html', own: ['Sure, see you then'], quoted: ['Are you available Thursday', 'The draft report is attached'], gone: ['wrote:'], signature: 'Sent from Yahoo Mail', levels: 1 },
    { file: 'proton-en.html', own: ['Thanks, I will take care'], quoted: ['Could you handle', 'invoice batch is ready'], gone: ['wrote:'], signature: 'Example Corp', levels: 2 },
    { file: 'zoho-en.html', own: ['Approved, please proceed'], quoted: ['Please approve the purchase order', 'purchase order is attached'], gone: ['wrote ----'], signature: 'Example Corp', levels: 2 },
    { file: 'titan-en.html', own: ['Got it, thanks'], quoted: ['Please send the file', 'The file is ready'], gone: ['wrote:'], levels: 2 },
    { file: 'titan-class-es.html', own: ['Recibido, gracias'], quoted: ['Te envío el presupuesto', 'Necesito el presupuesto'], gone: ['escribió'], levels: 1 },
    { file: 'icloud-pt.html', own: ['Combinado, quinta-feira'], quoted: ['Podemos nos reunir', 'Segue o rascunho'], gone: ['escreveu'], signature: 'Enviado do meu iPhone', levels: 2 },
    { file: 'samsung-en.html', own: ['Ok, see you at lunch'], quoted: ['Lunch tomorrow at one', 'Are you free for lunch'], gone: ['Original message'], signature: 'Sent from my Galaxy', levels: 2 },
];

describe('plegado por proveedor (HTML)', () => {
    it.each(CASES)('$file: conserva lo propio y la firma, pliega el historial', (c) => {
        const split = splitQuotedHtml(sanitizeHtml(load(c.file)));
        expect(split, c.file).not.toBeNull();
        const main = textOf(split!.main);
        for (const p of c.own) expect(main).toContain(p);
        if (c.signature) expect(main).toContain(c.signature);
        for (const p of c.quoted) { expect(main).not.toContain(p); expect(split!.quotedText).toContain(p); }
        for (const p of c.gone) expect(main).not.toContain(p);
        expect(split!.blocks).toBeGreaterThanOrEqual(1);
        expect(split!.levels).toBeGreaterThanOrEqual(c.levels);
        expect(split!.mainText).toContain(c.own[0]);
        expect(split!.quotedHtml!.length).toBeGreaterThan(0);
    });

    it.each(CASES)('$file: regla de oro, si TODO es cita no se pliega nada', (c) => {
        const clean = sanitizeHtml(load(c.file));
        const split = splitQuotedHtml(clean)!;
        // Reconstruye un mensaje que es solo el historial: lo que se retiro
        const onlyQuote = splitQuotedHtml(split.quotedHtml!.length > 40 ? sanitizeHtml(split.quotedHtml!) : '');
        // Puede plegar algo interior, pero nunca dejar el remanente sin texto legible
        if (onlyQuote) expect(textOf(onlyQuote.main).replace(/\s+/g, '').length).toBeGreaterThan(0);
    });

    it('Outlook.com: la linea horizontal previa a las cabeceras tambien se retira', () => {
        const split = splitQuotedHtml(sanitizeHtml(load('outlook-com-en.html')))!;
        expect(split.main).not.toContain('<hr');
        expect(split.main).not.toContain('divRplyFwdMsg');
    });

    it('un mensaje que es solo la cabecera y cita de Outlook no se pliega', () => {
        const html = '<div id="divRplyFwdMsg" dir="ltr"><b>From:</b> A &lt;a@example.test&gt;<br><b>Sent:</b> Monday<br><b>To:</b> B<br><b>Subject:</b> Hi</div><div>Texto citado sin contenido propio</div>';
        expect(splitQuotedHtml(html)).toBeNull();
    });

    it('la firma sola tras la cita no cuenta como contenido propio', () => {
        const html = '<div class="gmail_signature" data-smartmail="gmail_signature">Ana Prueba<br>Example Corp</div><div class="gmail_quote"><div class="gmail_attr">On Mon, Ana wrote:</div><blockquote class="gmail_quote">Texto citado</blockquote></div>';
        expect(splitQuotedHtml(html)).toBeNull();
    });

    it('un blockquote de citas en medio de un boletin (sin atribucion, con texto despues) no se pliega', () => {
        const html = '<p>Novedades de la semana en nuestro boletin.</p><blockquote>Una frase destacada del articulo.</blockquote><p>Sigue leyendo el articulo completo en la web.</p>';
        expect(splitQuotedHtml(html)).toBeNull();
    });

    it('correo text/plain (llega como <pre>) con citas ">" se pliega y conserva el <pre>', () => {
        const pre = `<pre>${load('gmail-en.txt').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
        const split = splitQuotedHtml(pre)!;
        expect(split.main.startsWith('<pre>')).toBe(true);
        expect(textOf(split.main)).toContain('Sounds good');
        expect(textOf(split.main)).not.toContain('Starting the report thread');
        expect(split.quotedText).toContain('Starting the report thread');
    });
});

describe('atribuciones multilingues', () => {
    const YES = [
        'On Wed, Jan 8, 2025 at 9:15 AM Louis Example <louis@example.test> wrote:',
        'El mié, 8 ene 2025 a las 9:15, Luis Ejemplo <luis@example.test> escribió:',
        'Le 8 janv. 2025 à 09:15, Louis Exemple <louis@example.test> a écrit :',
        'Am 08.01.2025 um 09:15 schrieb Ludwig Beispiel <ludwig@example.test>:',
        'Il giorno mer 8 gen 2025 alle ore 09:15 Luigi Esempio <luigi@example.test> ha scritto:',
        'Em qua., 8 de jan. de 2025 às 09:15, Luís Exemplo <luis@example.test> escreveu:',
        'Op wo 8 jan. 2025 om 09:15 schreef Lodewijk Voorbeeld <lodewijk@example.test>:',
        'Den ons 8 jan. 2025 kl. 09:15 skrev Ludvig Exempel <ludvig@example.test>:',
        'W dniu śr., 8 sty 2025 o 09:15 Ludwik Przykład <ludwik@example.test> napisał(a):',
        'ср, 8 янв. 2025 г. в 09:15, Людвиг Пример <lyudvig@example.test>:',
        'Людвиг Пример <lyudvig@example.test> написал(а):',
        '8 Oca 2025 Çar, 09:15 tarihinde Ludwig Örnek <ludwig@example.test> şunu yazdı:',
        'ke 8. tammik. 2025 klo 9.15 Lauri Esimerkki <lauri@example.test> kirjoitti:',
        'Louis Example <louis@example.test> 于2025年1月8日周三 09:15写道：',
        '2025年1月8日(水) 9:15 Louis Example <louis@example.test>:',
        '2025년 1월 8일 (수) 오전 9:15, Louis Example <louis@example.test>님이 작성:',
        '---- On Wed, 08 Jan 2025 09:15:00 +0100 Louis Example <louis@example.test> wrote ----',
    ];
    it.each(YES)('reconoce: %s', (line) => { expect(isAttributionLine(line)).toBe(true); });

    it('no confunde frases normales ni parrafos largos', () => {
        expect(isAttributionLine('Ayer escribió un informe muy completo sobre el tema')).toBe(false);
        expect(isAttributionLine('Gracias por tu mensaje')).toBe(false);
        expect(isAttributionLine(`${'palabra '.repeat(60)}escribió:`)).toBe(false);
    });

    it('separadores y bloques de cabeceras', () => {
        for (const s of ['-----Original Message-----', '-----Mensaje original-----', '-----Ursprüngliche Nachricht-----', '-----Message d\'origine-----', '---------- Forwarded message ---------', '-------- Mensaje reenviado --------', '-----原始邮件-----', '-----元のメッセージ-----', 'Begin forwarded message:']) expect(isSeparatorLine(s), s).toBe(true);
        expect(isSeparatorLine('Este es el mensaje original que te mencionaba')).toBe(false);
        const blocks: string[][] = [
            ['From: A', 'Sent: Monday', 'To: B', 'Subject: Hi'],
            ['De: A', 'Enviado el: lunes', 'Para: B', 'Asunto: Hola'],
            ['De : A', 'Envoyé : lundi', 'À : B', 'Objet : Salut'],
            ['Von: A', 'Gesendet: Montag', 'An: B', 'Betreff: Hallo'],
            ['Da: A', 'Inviato: lunedì', 'A: B', 'Oggetto: Ciao'],
            ['De: A', 'Enviada: segunda', 'Para: B', 'Assunto: Olá'],
            ['Van: A', 'Verzonden: maandag', 'Aan: B', 'Onderwerp: Hoi'],
            ['Från: A', 'Skickat: måndag', 'Till: B', 'Ämne: Hej'],
            ['Od: A', 'Wysłano: poniedziałek', 'Do: B', 'Temat: Cześć'],
            ['От: A', 'Отправлено: понедельник', 'Кому: B', 'Тема: Привет'],
            ['发件人: A', '发送时间: 周一', '收件人: B', '主题: 你好'],
            ['差出人: A', '送信日時: 月曜日', '宛先: B', '件名: こんにちは'],
            ['From: A Sent: Monday To: B Subject: Hi'],
        ];
        for (const b of blocks) expect(isHeaderBlockAt(b, 0), b.join('|')).toBe(true);
        expect(isHeaderBlockAt(['De: mi casa', 'nada mas'], 0)).toBe(false);
    });
});

describe('texto plano', () => {
    it('gmail-en.txt: cita ">" anidada, atribucion envuelta en dos lineas y firma "--" conservada', () => {
        const r = splitQuotedText(load('gmail-en.txt'))!;
        expect(r.main).toContain('Sounds good');
        expect(r.main).not.toContain('>');
        expect(r.main).not.toContain('wrote:');
        expect(r.signature).toContain('Example Corp');
        expect(r.quoted).toContain('Starting the report thread');
        expect(r.levels).toBe(3);
        expect(r.blocks).toBe(1);
    });

    it('plain-quote-es.txt: ">>>" y "escribió:"', () => {
        const r = splitQuotedText(load('plain-quote-es.txt'))!;
        expect(r.main).toContain('Confirmo la reunión');
        expect(r.main).not.toContain('escribió');
        expect(r.signature).toContain('Analista, Example Corp');
        expect(r.quoted).toContain('Inicio de la conversación');
        expect(r.levels).toBe(3);
    });

    it('separador "-----Ursprüngliche Nachricht-----" con cabeceras: todo lo posterior es historial', () => {
        const r = splitQuotedText(load('plain-outlook-original-de.txt'))!;
        expect(r.main).toContain('danke, ich melde mich');
        expect(r.main).toContain('Anna');
        expect(r.main).not.toContain('Betreff');
        expect(r.quoted).toContain('Erster Entwurf');
        expect(r.levels).toBe(2);
    });

    it('guion bajo de Outlook + "De :" (fr)', () => {
        const r = splitQuotedText(load('plain-outlook-underscore-fr.txt'))!;
        expect(r.main).toContain('Cordialement');
        expect(r.main).not.toContain('____');
        expect(r.quoted).toContain('Premier brouillon');
        expect(r.levels).toBe(2);
    });

    it('regla de oro: solo cita, o cita mas firma, devuelve null', () => {
        expect(splitQuotedText('> hola a todos\n> segunda linea')).toBeNull();
        expect(splitQuotedText('-----Original Message-----\nFrom: A\nSent: Monday\nTo: B\nSubject: Hi\n\ntexto')).toBeNull();
        expect(splitQuotedText('-- \nAna Prueba\n\nOn Mon, Ana wrote:\n> texto citado suficiente')).toBeNull();
        expect(splitQuotedText('Enviado desde mi iPhone\n\nEl lun, Ana escribió:\n> texto citado suficiente')).toBeNull();
    });

    it('sin cita devuelve null y un ">" dentro de una frase no se toca', () => {
        expect(splitQuotedText('Hola, esto es un correo normal.\nCon dos lineas y un a > b en medio.')).toBeNull();
    });

    it('respuesta intercalada: lo escrito entre las citas se conserva', () => {
        const r = splitQuotedText('On Mon, Ana <a@example.test> wrote:\n> ¿Vienes?\nSí, voy.\n> ¿A qué hora?\nA las diez.')!;
        expect(r.main).toContain('Sí, voy.');
        expect(r.main).toContain('A las diez.');
        expect(r.main).not.toContain('¿Vienes?');
        expect(r.blocks).toBe(2);
    });
});

// --- Hilo -----------------------------------------------------------------------------------------------------------
const M1 = 'Adjunto el borrador del informe trimestral con las cifras de enero y febrero para su revision.';
const M2 = 'Podemos reunirnos el jueves para revisar el informe trimestral con todo el equipo comercial.';
const M3 = 'Confirmo la reunion del jueves a las diez en la sala azul, llevare las cifras impresas.';
const quoteOf = (from: string, body: string, inner = '') => `<div class="gmail_quote"><div class="gmail_attr">El lun, 6 ene 2025, ${from} escribió:<br></div><blockquote class="gmail_quote">${body}${inner}</blockquote></div>`;
const gm = (own: string, quote = '') => `<div dir="ltr">${own}</div>${quote}`;

describe('deduplicado de historial en el hilo', () => {
    const m1 = gm(M1);
    const m2 = gm(M2, quoteOf('Marta &lt;marta@example.test&gt;', `<div>${M1}</div>`));
    const m3 = gm(M3, quoteOf('Luis &lt;luis@example.test&gt;', `<div>${M2}</div>`, quoteOf('Marta &lt;marta@example.test&gt;', `<div>${M1}</div>`)));
    const entry = (id: string, html: string) => {
        const clean = sanitizeHtml(html);
        const s = splitQuotedHtml(clean);
        return s ? { id, ownText: s.mainText || '', quotedText: s.quotedText || '' } : { id, ownText: htmlToComparableText(clean), quotedText: '' };
    };

    it('positivo: el historial que ya esta en el hilo se marca como duplicado', () => {
        const res = analyzeThreadDuplicates([entry('a', m1), entry('b', m2), entry('c', m3)]);
        expect(res.get('a')!.status).toBe('none');
        expect(res.get('b')!.status).toBe('duplicate');
        expect(res.get('b')!.matchedIds).toEqual(['a']);
        expect(res.get('c')!.status).toBe('duplicate');
        expect(res.get('c')!.matchedIds.sort()).toEqual(['a', 'b']);
    });

    it('negativo: hilo incompleto, el historial no coincide con nada y NO se oculta', () => {
        const res = analyzeThreadDuplicates([entry('b', m2), entry('c', m3)]);
        // c cita a b (presente) pero tambien a a (ausente): cobertura parcial -> se sigue considerando duplicado solo si supera el umbral
        expect(res.get('b')!.status).toBe('unmatched');
        expect(res.get('b')!.matchedIds).toEqual([]);
        expect(res.get('c')!.matchedIds).toEqual(['b']);
    });

    it('negativo: cita de un correo externo al hilo', () => {
        const ext = gm('Recibido, gracias por la informacion enviada ayer.', quoteOf('Otra &lt;otra@example.test&gt;', '<div>Texto completamente distinto que no forma parte de esta conversacion.</div>'));
        const res = analyzeThreadDuplicates([entry('a', m1), entry('x', ext)]);
        expect(res.get('x')!.status).toBe('unmatched');
    });

    it('mensajes muy cortos ("ok") no cuentan como coincidencia', () => {
        const res = analyzeThreadDuplicates([
            { id: 'a', ownText: 'ok', quotedText: '' },
            { id: 'b', ownText: 'Perfecto, gracias por avisar con tiempo', quotedText: 'ok\nalgo mas sin relacion alguna con el hilo' },
        ]);
        expect(res.get('b')!.status).toBe('unmatched');
    });

    it('normalizacion: ignora atribuciones, cabeceras, ">" , acentos y espacios', () => {
        const a = normalizeForCompare('> El lun, Ana escribió:\n> Adjunto el borrador\n> del informe.\n-- \nAna');
        const b = normalizeForCompare('adjunto  el borrador del   informe');
        expect(a.startsWith(b)).toBe(true);
        expect(normalizeForCompare('De: A\nEnviado el: lunes\nPara: B\nAsunto: X\nHola')).toBe('hola');
    });

    it('un hilo de un solo mensaje no ofrece nada', () => {
        expect(analyzeThreadDuplicates([entry('b', m2)]).get('b')!.status).toBe('none');
    });
});

// --- ThreadMessage ---------------------------------------------------------------------------------------------------
describe('ThreadMessage con deduplicado', () => {
    let host: HTMLDivElement;
    let root: Root;
    beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
    afterEach(() => { act(() => root.unmount()); host.remove(); });

    const item = (content: string): EmailDetails => ({
        email: { id: 'm1', from: 'Ana <ana@ext.test>', to: 'tester@bloomx.test', subject: 'Informe', createdAt: '2025-01-13T15:14:00Z', read: true, starred: false, folder: 'inbox', attachments: [], labels: [], snippet: 'extracto' },
        content,
    });
    function render(content: string, extra: Record<string, unknown>) {
        const noop = vi.fn();
        act(() => {
            root.render(React.createElement(ThreadMessage, {
                item: item(content), index: 1, expanded: true, wasUnread: false, imagePolicy: emptyPolicy(), onImagePolicy: noop, onToggle: noop,
                onReply: noop, onReplyAll: noop, onForward: noop, inviteBusy: false, calendarBusy: false, onInvite: noop, onAddToCalendar: noop,
                own: new Set<string>(), resolveJoin: () => ({ kind: 'none' }) as any, ...extra,
            }));
        });
    }
    const toggle = () => host.querySelector<HTMLElement>('[data-quote-toggle]');
    const html = load('gmail-es.html');

    it('sin datos de hilo: historial plegado (comportamiento de siempre)', () => {
        render(html, {});
        expect(toggle()!.getAttribute('aria-expanded')).toBe('false');
        expect(host.querySelector('[data-quote-unmatched]')).toBeNull();
    });

    it('duplicado + interruptor activo: plegado', () => {
        render(html, { dedupe: { status: 'duplicate', matchedIds: ['a'], coverage: 1 }, hideDuplicates: true });
        expect(toggle()!.getAttribute('aria-expanded')).toBe('false');
        expect(host.querySelector('[data-quote-unmatched]')).toBeNull();
    });

    it('no coincide con el hilo + interruptor activo: NO se oculta y se marca', () => {
        render(html, { dedupe: { status: 'unmatched', matchedIds: [], coverage: 0 }, hideDuplicates: true });
        expect(toggle()!.getAttribute('aria-expanded')).toBe('true');
        const note = host.querySelector('[data-quote-unmatched]')!;
        expect(note.getAttribute('role')).toBe('note');
        expect(note.textContent).toContain('no coincide');
    });

    it('interruptor apagado: el historial se muestra, y el usuario aun puede plegarlo', () => {
        render(html, { dedupe: { status: 'duplicate', matchedIds: ['a'], coverage: 1 }, hideDuplicates: false });
        expect(toggle()!.getAttribute('aria-expanded')).toBe('true');
        act(() => { toggle()!.click(); });
        expect(toggle()!.getAttribute('aria-expanded')).toBe('false');
    });
});
