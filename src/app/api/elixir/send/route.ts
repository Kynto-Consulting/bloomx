import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { resend } from '@/lib/resend';
import { prisma } from '@/lib/prisma';

type Row = Record<string, string>;

type SenderConfig = {
    fromName?: string;
    fromEmail?: string;
    cc?: string;
    bcc?: string;
};

type SendPayload = {
    rows: Row[];
    template: string;
    subject: string;
    recipientColumn: string;
    senderConfig?: SenderConfig;
};

// ── Full Liquid engine (mirrors page.tsx) ─────────────────────────────────────

function formatDate(d: Date, fmt: string): string {
    const mo = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const mos = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dy = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const dys = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return fmt
        .replace(/%Y/g, String(d.getFullYear())).replace(/%y/g, String(d.getFullYear()).slice(-2))
        .replace(/%m/g, String(d.getMonth()+1).padStart(2,'0')).replace(/%d/g, String(d.getDate()).padStart(2,'0'))
        .replace(/%e/g, String(d.getDate())).replace(/%B/g, mo[d.getMonth()]).replace(/%b/g, mos[d.getMonth()])
        .replace(/%A/g, dy[d.getDay()]).replace(/%a/g, dys[d.getDay()])
        .replace(/%H/g, String(d.getHours()).padStart(2,'0')).replace(/%I/g, String(d.getHours()%12||12).padStart(2,'0'))
        .replace(/%M/g, String(d.getMinutes()).padStart(2,'0')).replace(/%S/g, String(d.getSeconds()).padStart(2,'0'))
        .replace(/%p/g, d.getHours()<12?'AM':'PM');
}

function applyFilter(value: string, f: string): string {
    f = f.trim();
    if (f === 'upcase') return value.toUpperCase();
    if (f === 'downcase') return value.toLowerCase();
    if (f === 'capitalize') return value ? value[0].toUpperCase() + value.slice(1) : '';
    if (f === 'strip') return value.trim();
    if (f === 'lstrip') return value.trimStart();
    if (f === 'rstrip') return value.trimEnd();
    if (f === 'strip_html') return value.replace(/<[^>]*>/g, '');
    if (f === 'newline_to_br') return value.replace(/\n/g, '<br>');
    if (f === 'escape') return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    if (f === 'url_encode') return encodeURIComponent(value);
    if (f === 'size') return String(value.length);
    if (f === 'reverse') return value.split('').reverse().join('');
    if (f === 'abs') return String(Math.abs(parseFloat(value)));
    if (f === 'ceil') return String(Math.ceil(parseFloat(value)));
    if (f === 'floor') return String(Math.floor(parseFloat(value)));
    if (f === 'round') return String(Math.round(parseFloat(value)));

    let m: RegExpMatchArray | null;
    if ((m = f.match(/^truncate:\s*(\d+)(?:,\s*["']([^"']*)["'])?$/))) {
        const n = parseInt(m[1]); const e2 = m[2] ?? '...';
        return value.length > n ? value.slice(0, Math.max(0, n - e2.length)) + e2 : value;
    }
    if ((m = f.match(/^truncatewords:\s*(\d+)(?:,\s*["']([^"']*)["'])?$/))) {
        const words = value.split(/\s+/); const n = parseInt(m[1]); const e2 = m[2] ?? '...';
        return words.length > n ? words.slice(0, n).join(' ') + e2 : value;
    }
    if ((m = f.match(/^replace:\s*["']([^"']*)["'],\s*["']([^"']*)["']$/))) return value.split(m[1]).join(m[2]);
    if ((m = f.match(/^replace_first:\s*["']([^"']*)["'],\s*["']([^"']*)["']$/))) return value.replace(m[1], m[2]);
    if ((m = f.match(/^remove:\s*["']([^"']*)["']$/))) return value.split(m[1]).join('');
    if ((m = f.match(/^prepend:\s*["']([^"']*)["']$/))) return m[1] + value;
    if ((m = f.match(/^append:\s*["']([^"']*)["']$/))) return value + m[1];
    if ((m = f.match(/^default:\s*["']([^"']*)["']$/))) return value && value.trim() ? value : m[1];
    if ((m = f.match(/^round:\s*(\d+)$/))) return parseFloat(value).toFixed(parseInt(m[1]));
    if ((m = f.match(/^times:\s*([\d.]+)$/))) return String(parseFloat(value) * parseFloat(m[1]));
    if ((m = f.match(/^plus:\s*([\d.]+)$/))) return String(parseFloat(value) + parseFloat(m[1]));
    if ((m = f.match(/^minus:\s*([\d.]+)$/))) return String(parseFloat(value) - parseFloat(m[1]));
    if ((m = f.match(/^divided_by:\s*([\d.]+)$/))) return String(parseFloat(value) / parseFloat(m[1]));
    if ((m = f.match(/^modulo:\s*([\d.]+)$/))) return String(parseFloat(value) % parseFloat(m[1]));
    if ((m = f.match(/^date:\s*["']([^"']*)["']$/))) { const d = new Date(value); return isNaN(d.getTime()) ? value : formatDate(d, m[1]); }
    return value;
}

function applyChain(value: string, chain: string): string {
    const filters: string[] = []; let cur = ''; let inQ = false; let qC = '';
    for (const c of chain) {
        if ((c === '"' || c === "'") && !inQ) { inQ = true; qC = c; cur += c; }
        else if (c === qC && inQ) { inQ = false; cur += c; }
        else if (c === '|' && !inQ) { filters.push(cur.trim()); cur = ''; }
        else { cur += c; }
    }
    if (cur.trim()) filters.push(cur.trim());
    return filters.filter(Boolean).reduce((v, f) => applyFilter(v, f), value);
}

function resolve(expr: string, row: Row, assigns: Row): string {
    const pi = expr.search(/\|(?![^"']*["'][^"']*$)/);
    if (pi === -1) { const k = expr.trim(); return row[k] ?? assigns[k] ?? ''; }
    const k = expr.slice(0, pi).trim();
    return applyChain(row[k] ?? assigns[k] ?? '', expr.slice(pi + 1));
}

function evalAtom(e: string, row: Row, assigns: Row): boolean {
    let m: RegExpMatchArray | null;
    if ((m = e.match(/^(.+?)\s+contains\s+"([^"]*)"$/))) return (row[m[1].trim()] ?? assigns[m[1].trim()] ?? '').toLowerCase().includes(m[2].toLowerCase());
    if ((m = e.match(/^(.+?)\s+contains\s+'([^']*)'$/))) return (row[m[1].trim()] ?? assigns[m[1].trim()] ?? '').toLowerCase().includes(m[2].toLowerCase());
    if ((m = e.match(/^(.+?)\s*==\s*"([^"]*)"$/))) return (row[m[1].trim()] ?? assigns[m[1].trim()] ?? '') === m[2];
    if ((m = e.match(/^(.+?)\s*==\s*'([^']*)'$/))) return (row[m[1].trim()] ?? assigns[m[1].trim()] ?? '') === m[2];
    if ((m = e.match(/^(.+?)\s*!=\s*"([^"]*)"$/))) return (row[m[1].trim()] ?? assigns[m[1].trim()] ?? '') !== m[2];
    if ((m = e.match(/^(.+?)\s*!=\s*'([^']*)'$/))) return (row[m[1].trim()] ?? assigns[m[1].trim()] ?? '') !== m[2];
    if ((m = e.match(/^(.+?)\s*>=\s*([\d.]+)$/))) return parseFloat(row[m[1].trim()] ?? assigns[m[1].trim()] ?? '0') >= parseFloat(m[2]);
    if ((m = e.match(/^(.+?)\s*<=\s*([\d.]+)$/))) return parseFloat(row[m[1].trim()] ?? assigns[m[1].trim()] ?? '0') <= parseFloat(m[2]);
    if ((m = e.match(/^(.+?)\s*>\s*([\d.]+)$/))) return parseFloat(row[m[1].trim()] ?? assigns[m[1].trim()] ?? '0') > parseFloat(m[2]);
    if ((m = e.match(/^(.+?)\s*<\s*([\d.]+)$/))) return parseFloat(row[m[1].trim()] ?? assigns[m[1].trim()] ?? '0') < parseFloat(m[2]);
    const v = row[e] ?? assigns[e] ?? '';
    return !!(v && v.trim() && v !== 'false' && v !== 'nil');
}

function evalCond(expr: string, row: Row, assigns: Row): boolean {
    if (/ or /.test(expr)) return expr.split(/ or /).some(p => evalCond(p.trim(), row, assigns));
    if (/ and /.test(expr)) return expr.split(/ and /).every(p => evalAtom(p.trim(), row, assigns));
    return evalAtom(expr, row, assigns);
}

function processBlocks(tpl: string, row: Row, assigns: Row): string {
    let r = tpl;
    r = r.replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, '');
    r = r.replace(/\{%-?\s*assign\s+(\w+)\s*=\s*([\s\S]+?)\s*-?%\}/g, (_, k, expr) => {
        const sm = expr.trim().match(/^["']([^"']*)["']$/);
        assigns[k] = sm ? sm[1] : resolve(expr.trim(), row, assigns); return '';
    });
    r = r.replace(/\{%-?\s*capture\s+(\w+)\s*-?%\}([\s\S]*?)\{%-?\s*endcapture\s*-?%\}/g, (_, k, body) => { assigns[k] = body.trim(); return ''; });
    r = r.replace(/\{%-?\s*unless\s+([\s\S]+?)\s*-?%\}([\s\S]*?)\{%-?\s*endunless\s*-?%\}/g, (_, cond, body) => {
        const [up, ...rest] = body.split(/\{%-?\s*else\s*-?%\}/);
        return evalCond(cond, row, assigns) ? rest.join('{% else %}') : up;
    });
    r = r.replace(/\{%-?\s*if\s+([\s\S]+?)\s*-?%\}([\s\S]*?)\{%-?\s*endif\s*-?%\}/g, (_, cond, body) => {
        const [ifPart, ...rest] = body.split(/\{%-?\s*else\s*-?%\}/);
        const segs = ifPart.split(/\{%-?\s*elsif\s+([\s\S]+?)\s*-?%\}/);
        if (evalCond(cond, row, assigns)) return segs[0];
        for (let i = 1; i < segs.length; i += 2) { if (evalCond(segs[i], row, assigns)) return segs[i+1] ?? ''; }
        return rest.join('{% else %}') ?? '';
    });
    return r;
}

function renderTemplate(template: string, row: Row): string {
    const assigns: Row = {};
    let r = processBlocks(template, row, assigns);
    r = r.replace(/\{\{-?\s*([\s\S]+?)\s*-?\}\}/g, (_, expr) => resolve(expr, row, assigns));
    return r;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const sessionUser = await getCurrentUser();
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body: SendPayload = await req.json();
    const { rows, template, subject, recipientColumn, senderConfig = {} } = body;

    if (!rows?.length) return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
    if (!template?.trim()) return NextResponse.json({ error: 'Template is empty' }, { status: 400 });
    if (!subject?.trim()) return NextResponse.json({ error: 'Subject is empty' }, { status: 400 });
    if (!recipientColumn) return NextResponse.json({ error: 'Recipient column not specified' }, { status: 400 });

    const user = await prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: { id: true, email: true, name: true },
    });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const results: { email: string; row: Row; status: 'sent' | 'error' | 'skipped'; message?: string }[] = [];

    for (const row of rows) {
        const recipientEmail = (row[recipientColumn] || '').trim();
        if (!recipientEmail.includes('@')) {
            results.push({ email: recipientEmail || '(vacío)', row, status: 'skipped', message: 'Email inválido' }); continue;
        }

        const renderedSubject = renderTemplate(subject, row);
        const renderedHtml = renderTemplate(template, row);

        const fromName = senderConfig.fromName?.trim() ? renderTemplate(senderConfig.fromName, row) : (user.name || 'User');
        const fromEmail = senderConfig.fromEmail?.trim() ? renderTemplate(senderConfig.fromEmail, row) : user.email;
        const formattedFrom = `${fromName} <${fromEmail}>`;

        const cc = senderConfig.cc?.trim()
            ? renderTemplate(senderConfig.cc, row).split(',').map(s => s.trim()).filter(s => s.includes('@'))
            : undefined;
        const bcc = senderConfig.bcc?.trim()
            ? renderTemplate(senderConfig.bcc, row).split(',').map(s => s.trim()).filter(s => s.includes('@'))
            : undefined;

        try {
            const payload: any = { from: formattedFrom, to: [recipientEmail], subject: renderedSubject, html: renderedHtml };
            if (cc?.length) payload.cc = cc;
            if (bcc?.length) payload.bcc = bcc;

            const { error } = await resend.emails.send(payload);
            if (error) { results.push({ email: recipientEmail, row, status: 'error', message: String(error) }); }
            else { results.push({ email: recipientEmail, row, status: 'sent' }); }
        } catch (e: any) {
            results.push({ email: recipientEmail, row, status: 'error', message: e?.message || 'Error desconocido' });
        }

        await new Promise(r => setTimeout(r, 500));
    }

    return NextResponse.json({ results });
}
