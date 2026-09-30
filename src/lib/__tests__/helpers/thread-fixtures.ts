// Banco SINTETICO de correos para probar los hilos: una CONVERSACION mixta de 8 mensajes ida y vuelta entre proveedores (con el asunto
// cambiando a mitad) y OTRA conversacion distinta con el mismo asunto raiz. Cada mensaje se genera como un MIME completo (RFC 5322) con las
// cabeceras Message-ID / In-Reply-To / References, el formato de Message-ID y las extras (Thread-Index, X-Mailer, User-Agent) tipicos de
// cada cliente segun sus patrones publicos, y con un cuerpo HTML/texto que cita al anterior como lo hace ese cliente.
//
// Personas y dominios FICTICIOS (.test). Determinista: sin aleatoriedad ni fechas reales. Lo usan los tests unitarios, los pg y el seed E2E.

export type Provider = 'gmail' | 'outlook.com' | 'bloomx' | 'apple' | 'thunderbird' | 'yahoo' | 'proton' | 'titan' | 'zoho' | 'outlook-desktop' | 'icloud' | 'plain';

export interface FixtureMsg {
    key: string;
    thread: 'A' | 'B';
    provider: Provider;
    /** 'out' = lo enviamos nosotros (carpeta sent). */
    direction: 'in' | 'out';
    from: string;
    to: string;
    cc?: string;
    subject: string;
    date: Date;
    /** Message-ID sin <>. */
    mid: string;
    inReplyTo: string | null;
    /** References tal como las emite ese cliente (puede estar recortada o vacia). */
    refs: string[];
    mime: string;
    /** HTML y texto del cuerpo (los mismos que van en el MIME). */
    html: string;
    text: string;
}

export const OWNER = 'me@bloomx.test';

const PEOPLE: Record<string, { name: string; email: string }> = {
    alice: { name: 'Alice Gómez', email: 'alice@gmail.test' },
    bob: { name: 'Bob Ruiz', email: 'bob@outlook.test' },
    me: { name: 'Yo Mismo', email: OWNER },
    carol: { name: 'Carol Díaz', email: 'carol@apple.test' },
    dave: { name: 'Dave Soto', email: 'dave@thunder.test' },
    erin: { name: 'Erin Vega', email: 'erin@yahoo.test' },
    frank: { name: 'Frank Paz', email: 'frank@proton.test' },
    hank: { name: 'Hank Mora', email: 'hank@titan.test' },
    gina: { name: 'Gina Lara', email: 'gina@zoho.test' },
    ivan: { name: 'Iván Cruz', email: 'ivan@desktop.test' },
    judy: { name: 'Judy Ríos', email: 'judy@icloud.test' },
    kim: { name: 'Kim Rey', email: 'kim@plain.test' },
};
const fmt = (k: string) => `${PEOPLE[k].name} <${PEOPLE[k].email}>`;
const enc = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const encAddr = (k: string) => (/^[\x20-\x7e]*$/.test(PEOPLE[k].name) ? fmt(k) : `${enc(PEOPLE[k].name)} <${PEOPLE[k].email}>`);
const rfcDate = (d: Date) => d.toUTCString().replace('GMT', '+0000');

/** Message-ID por cliente (formatos publicos conocidos; contenido ficticio). */
const MID: Record<string, string> = {
    gmail: 'CAF3mYxQ0p1n6ZgA4JrK2v9xX0t5Q7bC3D4hNw=Yb1V8jLmR3sA@mail.gmail.com',
    'outlook.com': 'DM6PR07MB4523A1B2C3D4E5F60718293A4B5C6D@DM6PR07MB4523.namprd07.prod.outlook.com',
    bloomx: '5b0e1f3a-7c1d-4f6e-9a2b-3c4d5e6f7081@bloomx.test',
    apple: '7E3B9C1A-1B2C-4D5E-8F90-A1B2C3D4E5F6@me.com',
    thunderbird: '1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809@thunder.test',
    yahoo: '1234567890.4567890.1788000000000@mail.yahoo.com',
    proton: 'Xq7Lw2mV0aBcDeFgHiJkLmNoPqRsTuVwXyZ01234567890AbCdEfGh==@proton.test',
    titan: '0.0.2.1A2B.1e5a7b3c9d0f4a2.1e5a7b3c9d1@mailer.titan.test',
    zoho: '17f1a2b3c4d.1a2b3c4d5e6f7081.0f1e2d3c4b5a6978@mail.zoho.test',
    'outlook-desktop': 'AS8PR03MB7412C0FFEE0123456789ABCDEF0123@AS8PR03MB7412.eurprd03.prod.outlook.com',
    icloud: 'A1B2C3D4-0000-4111-8222-333344445555@icloud.test',
    plain: 'plain-20260904T121500.1@plain.test',
};
const mid = (provider: Provider, n: number) => {
    // Un Message-ID distinto por mensaje, conservando el formato del cliente
    const base = MID[provider];
    const at = base.lastIndexOf('@');
    const local = base.slice(0, at);
    const domain = base.slice(at + 1);
    const salt = String(n).padStart(2, '0');
    return `${local.slice(0, Math.max(4, local.length - 2))}${salt}@${domain}`;
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripHtml = (h: string) => h.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|blockquote)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();

interface Prev { from: string; date: Date; html: string; email: string; name: string; subject: string; to: string }

/** Cuerpo HTML que cita al anterior con la estructura del cliente. */
function bodyFor(provider: Provider, reply: string, prev: Prev | null): { html: string; text: string } {
    if (!prev) {
        const html = `<div dir="ltr">${esc(reply)}</div>`;
        return { html, text: reply };
    }
    const when = prev.date.toISOString().replace('T', ' ').slice(0, 16);
    const who = `${prev.name} &lt;${prev.email}&gt;`;
    let html: string;
    switch (provider) {
        case 'gmail':
            html = `<div dir="ltr">${esc(reply)}</div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">On ${when}, ${who} wrote:<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">${prev.html}</blockquote></div>`;
            break;
        case 'bloomx':
            html = `<p>${esc(reply)}</p><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">El ${when}, ${who} escribió:<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">${prev.html}</blockquote></div>`;
            break;
        case 'outlook.com':
            html = `<div>${esc(reply)}</div><hr style="display:inline-block;width:98%" tabindex="-1"><div id="divRplyFwdMsg" dir="ltr"><font face="Calibri, sans-serif" style="font-size:11pt" color="#000000"><b>From:</b> ${who}<br><b>Sent:</b> ${when}<br><b>To:</b> ${esc(prev.to)}<br><b>Subject:</b> ${esc(prev.subject)}</font><div>&nbsp;</div></div><div>${prev.html}</div>`;
            break;
        case 'outlook-desktop':
            html = `<div class="WordSection1"><p class="MsoNormal">${esc(reply)}</p><p class="MsoNormal">&nbsp;</p><div><div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0in 0in 0in"><p class="MsoNormal"><b>From:</b> ${who}<br><b>Sent:</b> ${when}<br><b>To:</b> ${esc(prev.to)}<br><b>Subject:</b> ${esc(prev.subject)}</p></div></div>${prev.html}</div>`;
            break;
        case 'apple':
        case 'icloud':
            html = `<div>${esc(reply)}</div><br><blockquote type="cite"><div>On ${when}, ${who} wrote:</div><br><div>${prev.html}</div></blockquote>`;
            break;
        case 'thunderbird':
            html = `<p>${esc(reply)}</p><div class="moz-cite-prefix">On ${when}, ${prev.name} wrote:<br></div><blockquote type="cite" cite="mid:${prev.email}">${prev.html}</blockquote>`;
            break;
        case 'yahoo':
            html = `<div>${esc(reply)}</div><div class="yahoo_quoted" id="yahoo_quoted_1234"><div style="font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:13px;color:#26282a">On ${when}, ${who} wrote:</div><div><br></div><div>${prev.html}</div></div>`;
            break;
        case 'proton':
            html = `<div>${esc(reply)}</div><div class="protonmail_quote">On ${when}, ${who} wrote:<br><blockquote class="protonmail_quote" type="cite">${prev.html}</blockquote></div>`;
            break;
        case 'titan':
            html = `<div>${esc(reply)}</div><div class="titan-quote">On ${when}, ${who} wrote:<blockquote class="titan-blockquote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${prev.html}</blockquote></div>`;
            break;
        case 'zoho':
            html = `<div>${esc(reply)}</div><div class="zmail_extra"><br></div><div class="zmail_quote"> ---- On ${when} ${who} wrote ---- <br><blockquote>${prev.html}</blockquote></div>`;
            break;
        default: {
            const quoted = stripHtml(prev.html).split('\n').map((l) => `> ${l}`).join('\n');
            const text = `${reply}\n\nOn ${when}, ${prev.name} <${prev.email}> wrote:\n${quoted}\n`;
            return { html: '', text };
        }
    }
    const t = `${reply}\n\nOn ${when}, ${prev.name} <${prev.email}> wrote:\n${stripHtml(prev.html).split('\n').map((l) => `> ${l}`).join('\n')}\n`;
    return { html, text: t };
}

function toBase64Lines(s: string): string {
    return (Buffer.from(s, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
}

/** Thread-Index de Outlook/Exchange (22 bytes de cabecera + 5 por respuesta), ficticio pero con la estructura real. */
function threadIndex(replies: number, thread: 'A' | 'B'): string {
    // El GUID de la cabecera (bytes 6..22) identifica la conversacion: distinto por hilo
    const head = Buffer.from(thread === 'A' ? '01DA5B7C9D2E4F60718293A4B5C6D7E8F901' : '01DA5B7C9D2EAA11BB22CC33DD44EE55FF66', 'hex').subarray(0, 22);
    const kids = Buffer.alloc(5 * replies, 0x11);
    return Buffer.concat([head, kids]).toString('base64');
}

interface Spec {
    key: string; thread: 'A' | 'B'; provider: Provider; from: string; to: string[]; cc?: string[]; subject: string; when: string;
    parent: string | null; refsMode: 'full' | 'trimmed' | 'none'; reply: string; n: number;
}

const SPECS: Spec[] = [
    // ---- Conversacion A: 8 mensajes, asunto cambia a mitad (A5 y A6) ----
    { key: 'A1', thread: 'A', provider: 'gmail', from: 'alice', to: ['me', 'bob'], subject: 'Presupuesto 2027', when: '2026-09-01T09:00:00Z', parent: null, refsMode: 'full', reply: 'Hola, adjunto la primera propuesta de presupuesto 2027.', n: 1 },
    { key: 'A2', thread: 'A', provider: 'outlook.com', from: 'bob', to: ['alice', 'me'], subject: 'RE: Presupuesto 2027', when: '2026-09-01T10:00:00Z', parent: 'A1', refsMode: 'full', reply: 'Gracias Alice, lo reviso y te digo.', n: 2 },
    { key: 'A3', thread: 'A', provider: 'bloomx', from: 'me', to: ['alice', 'bob'], subject: 'Re: Presupuesto 2027', when: '2026-09-01T11:00:00Z', parent: 'A2', refsMode: 'full', reply: 'Me parece bien, sumo el rubro de capacitacion.', n: 3 },
    { key: 'A4', thread: 'A', provider: 'apple', from: 'carol', to: ['alice', 'bob', 'me'], subject: 'Re: Presupuesto 2027', when: '2026-09-01T12:00:00Z', parent: 'A3', refsMode: 'full', reply: 'Yo tambien estoy de acuerdo.', n: 4 },
    { key: 'A5', thread: 'A', provider: 'thunderbird', from: 'dave', to: ['carol', 'me'], subject: 'Re: Presupuesto 2027 - versión final', when: '2026-09-01T13:00:00Z', parent: 'A4', refsMode: 'full', reply: 'Cambio el titulo: esta es la version final.', n: 5 },
    { key: 'A6', thread: 'A', provider: 'yahoo', from: 'erin', to: ['dave', 'me'], subject: 'Cierre trimestral', when: '2026-09-02T09:00:00Z', parent: 'A5', refsMode: 'full', reply: 'Cerramos el trimestre con estas cifras.', n: 6 },
    { key: 'A7', thread: 'A', provider: 'proton', from: 'frank', to: ['erin', 'me'], subject: 'Re: Cierre trimestral', when: '2026-09-02T11:00:00Z', parent: 'A6', refsMode: 'trimmed', reply: 'Confirmo las cifras del cierre.', n: 7 },
    { key: 'A8', thread: 'A', provider: 'titan', from: 'hank', to: ['frank', 'me'], subject: 'Re: Cierre trimestral', when: '2026-09-02T12:00:00Z', parent: 'A7', refsMode: 'none', reply: 'Aprobado por mi parte.', n: 8 },
    // ---- Conversacion B: OTRA, con el mismo asunto raiz y otras personas ----
    { key: 'B1', thread: 'B', provider: 'zoho', from: 'gina', to: ['me'], subject: 'Presupuesto 2027', when: '2026-09-03T09:00:00Z', parent: null, refsMode: 'full', reply: 'Buenas, presupuesto 2027 del area comercial.', n: 9 },
    { key: 'B2', thread: 'B', provider: 'bloomx', from: 'me', to: ['gina'], subject: 'Re: Presupuesto 2027', when: '2026-09-03T10:00:00Z', parent: 'B1', refsMode: 'full', reply: 'Recibido, lo reviso hoy.', n: 10 },
    { key: 'B3', thread: 'B', provider: 'outlook-desktop', from: 'ivan', to: ['gina', 'me'], subject: 'RE: Presupuesto 2027', when: '2026-09-03T11:00:00Z', parent: 'B2', refsMode: 'full', reply: 'Agrego las cifras de ventas.', n: 11 },
    { key: 'B4', thread: 'B', provider: 'icloud', from: 'judy', to: ['gina', 'me'], subject: 'Re: Presupuesto 2027', when: '2026-09-03T12:00:00Z', parent: 'B3', refsMode: 'full', reply: 'Todo claro por aqui.', n: 12 },
    { key: 'B5', thread: 'B', provider: 'plain', from: 'kim', to: ['me'], subject: 'Re: Presupuesto 2027', when: '2026-09-04T12:15:00Z', parent: 'B4', refsMode: 'full', reply: 'Sin comentarios adicionales.', n: 13 },
];

export function buildFixtureMessages(): FixtureMsg[] {
    const out: FixtureMsg[] = [];
    const byKey = new Map<string, FixtureMsg>();
    for (const s of SPECS) {
        const parent = s.parent ? byKey.get(s.parent)! : null;
        const id = mid(s.provider, s.n);
        const date = new Date(s.when);
        const chain = parent ? [...parent.refs, parent.mid] : [];
        const refs = !parent ? [] : s.refsMode === 'none' ? [] : s.refsMode === 'trimmed' ? [chain[0], ...chain.slice(-2)] : chain;
        const prev: Prev | null = parent ? { from: parent.from, date: parent.date, html: parent.html || `<div>${esc(parent.text)}</div>`, email: parent.from.match(/<([^>]+)>/)![1], name: parent.from.replace(/\s*<.*$/, ''), subject: parent.subject, to: parent.to } : null;
        const body = bodyFor(s.provider, s.reply, prev);
        const fromStr = fmt(s.from);
        const toStr = s.to.map(fmt).join(', ');
        const ccStr = s.cc ? s.cc.map(fmt).join(', ') : undefined;

        const headers: string[] = [];
        if (s.provider !== 'bloomx') headers.push(`Received: from mail.${PEOPLE[s.from].email.split('@')[1]} by mx.bloomx.test with ESMTPS; ${rfcDate(date)}`);
        headers.push(`Message-ID: <${id}>`);
        headers.push(`Date: ${rfcDate(date)}`);
        headers.push(`From: ${encAddr(s.from)}`);
        headers.push(`To: ${s.to.map(encAddr).join(', ')}`);
        if (s.cc) headers.push(`Cc: ${s.cc.map(encAddr).join(', ')}`);
        headers.push(`Subject: ${enc(s.subject)}`);
        if (parent) headers.push(`In-Reply-To: <${parent!.mid}>`);
        if (refs.length > 0) {
            // References plegada como la emiten los clientes (una linea por Message-ID largo)
            headers.push(`References: ${refs.map((r) => `<${r}>`).join('\r\n\t')}`);
        }
        if (s.provider === 'outlook.com' || s.provider === 'outlook-desktop') {
            headers.push(`Thread-Topic: ${enc(s.subject.replace(/^RE:\s*/i, ''))}`);
            headers.push(`Thread-Index: ${threadIndex(refs.length, s.thread)}`);
            headers.push('X-MS-Has-Attach:');
            headers.push('X-MS-TNEF-Correlator:');
        }
        if (s.provider === 'outlook-desktop') headers.push('X-Mailer: Microsoft Outlook 16.0');
        if (s.provider === 'apple' || s.provider === 'icloud') headers.push('X-Mailer: Apple Mail (2.3826.100.1)', 'Mime-Version: 1.0 (Mac OS X Mail 16.0)');
        if (s.provider === 'thunderbird') headers.push('User-Agent: Mozilla Thunderbird');
        if (s.provider === 'yahoo') headers.push('X-Mailer: WebService/1.1.21646 YMailNorrin');
        if (s.provider === 'gmail') headers.push('X-Gm-Message-State: AOJu0Yw0fixture');
        if (s.provider === 'proton') headers.push('X-Pm-Origin: internal', 'X-Pm-Content-Encryption: end-to-end');
        if (s.provider === 'titan') headers.push('X-Mailer: Titan Email');
        if (s.provider === 'zoho') headers.push('X-Zoho-Virus-Status: 1');
        headers.push('MIME-Version: 1.0');

        let mime: string;
        if (body.html) {
            const b = `=_fixture_${s.key}`;
            headers.push(`Content-Type: multipart/alternative; boundary="${b}"`);
            mime = `${headers.join('\r\n')}\r\n\r\n--${b}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${toBase64Lines(body.text)}\r\n--${b}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${toBase64Lines(body.html)}\r\n--${b}--\r\n`;
        } else {
            headers.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: quoted-printable');
            mime = `${headers.join('\r\n')}\r\n\r\n${body.text.replace(/=/g, '=3D').replace(/[^\x00-\x7f]/g, (c) => Buffer.from(c, 'utf8').toString('hex').replace(/(..)/g, '=$1').toUpperCase())}\r\n`;
        }
        const msg: FixtureMsg = {
            key: s.key, thread: s.thread, provider: s.provider, direction: s.from === 'me' ? 'out' : 'in', from: fromStr, to: toStr, cc: ccStr,
            subject: s.subject, date, mid: id, inReplyTo: parent ? parent.mid : null, refs, mime, html: body.html, text: body.text,
        };
        out.push(msg);
        byKey.set(s.key, msg);
    }
    return out;
}

export const FIXTURE_KEYS_A = SPECS.filter((s) => s.thread === 'A').map((s) => s.key);
export const FIXTURE_KEYS_B = SPECS.filter((s) => s.thread === 'B').map((s) => s.key);

/** Mezcla determinista (Fisher-Yates con LCG) para probar cualquier orden de llegada. */
export function shuffled<T>(list: T[], seed: number): T[] {
    const a = [...list];
    let s = seed >>> 0 || 1;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}
