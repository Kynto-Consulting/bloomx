'use client';

import type { Locale } from '../_content/types';

/**
 * Diagramas SVG en linea. Solo usan tokens de tema (fill-*, stroke-*, text-*): se adaptan a cualquier tema de empresa.
 * Cada diagrama va dentro de <figure> con <figcaption> y role="img" + <title>/<desc> como alternativa textual.
 */

const T = {
    es: {
        arch: {
            title: 'Arquitectura: N frontends, un backend compartido',
            desc: 'Varios frontends Next.js firman sus peticiones con su clave Ed25519 hacia un backend compartido. El backend verifica la firma con la clave pública registrada del dominio. Cada frontend y el backend usan sus propios servicios: PostgreSQL, almacenamiento S3, Resend y Upstash opcional. Resend entrega el correo entrante por webhook a cada frontend.',
            fe: 'Frontends (Next.js)',
            feA: 'empresa-a.com',
            feB: 'empresa-b.com',
            feN: '… cualquier dominio',
            feSub: 'NEXTAUTH_SECRET propio',
            be: 'Backend compartido',
            beL: ['Firma Ed25519 por dominio', 'Modo legado (sin clave)', 'CORS * sin cookies', 'register-domain / verify-domain', 'Extensiones (worker_threads)'],
            signed: 'peticiones firmadas',
            bridge: 'puente firmado (services.mail)',
            svc: 'Servicios (credenciales propias de cada instancia)',
            svcL: 'PostgreSQL · S3/B2/R2 · Resend · Upstash (opcional)',
            hook: 'webhooks entrantes y de eventos',
            resend: 'Resend',
        },
        sign: {
            title: 'Firma de una petición (protocolo v1)',
            desc: 'El frontend calcula sha256 del cuerpo, construye la cadena canónica, la firma con Ed25519 y envía tres cabeceras. El backend busca la clave pública del dominio, comprueba ventana de tiempo, nonce y firma, y ejecuta.',
            steps: [
                ['1. Cuerpo', 'sha256(body) en hex'],
                ['2. Cadena canónica', 'BLOOMX-SIG-V1 + método + ruta + …'],
                ['3. Firma', 'Ed25519 con la clave privada'],
                ['4. Cabeceras', 'X-BloomX-Signature / Timestamp / Nonce'],
                ['5. Backend', 'clave pública del dominio'],
                ['6. Verifica', '±120 s, nonce único, firma'],
            ],
        },
        mail: {
            title: 'Flujo del correo',
            desc: 'Entrante: el remitente envía a tu dominio, Resend recibe y llama por webhook al frontend, que guarda en base de datos y adjuntos en almacenamiento y avisa a la interfaz por SSE. Saliente: la interfaz llama a la API del frontend, que envía por Resend.',
            in: [['Remitente', 'envía a tu dominio'], ['Resend', 'recibe (MX)'], ['Webhook', 'POST /api/webhooks/resend; firma Svix si hay secreto'], ['Datos', 'Postgres (correo) y almacenamiento (adjuntos)'], ['Interfaz', 'SSE / recarga']],
            out: [['Interfaz', 'redactar y enviar'], ['POST /api/emails', 'Idempotency-Key, DLP, límites'], ['Resend', 'API de envío'], ['Destinatario', 'SPF / DKIM / DMARC']],
            lin: 'Entrante',
            lout: 'Saliente',
        },
    },
    en: {
        arch: {
            title: 'Architecture: N frontends, one shared backend',
            desc: 'Several Next.js frontends sign their requests with their own Ed25519 key towards a shared backend. The backend verifies the signature with the domain public key. Each frontend and the backend use their own services: PostgreSQL, S3 storage, Resend and optional Upstash. Resend delivers inbound mail by webhook to each frontend.',
            fe: 'Frontends (Next.js)',
            feA: 'company-a.com',
            feB: 'company-b.com',
            feN: '… any domain',
            feSub: 'own NEXTAUTH_SECRET',
            be: 'Shared backend',
            beL: ['Per-domain Ed25519 signature', 'Legacy mode (no key)', 'CORS * without cookies', 'register-domain / verify-domain', 'Extensions (worker_threads)'],
            signed: 'signed requests',
            bridge: 'signed bridge (services.mail)',
            svc: 'Services (each instance uses its own credentials)',
            svcL: 'PostgreSQL · S3/B2/R2 · Resend · Upstash (optional)',
            hook: 'inbound and event webhooks',
            resend: 'Resend',
        },
        sign: {
            title: 'Signing a request (protocol v1)',
            desc: 'The frontend computes sha256 of the body, builds the canonical string, signs it with Ed25519 and sends three headers. The backend looks up the domain public key, checks time window, nonce and signature, then runs the request.',
            steps: [
                ['1. Body', 'sha256(body) in hex'],
                ['2. Canonical string', 'BLOOMX-SIG-V1 + method + path + …'],
                ['3. Signature', 'Ed25519 with the private key'],
                ['4. Headers', 'X-BloomX-Signature / Timestamp / Nonce'],
                ['5. Backend', 'domain public key'],
                ['6. Verify', '±120 s, unique nonce, signature'],
            ],
        },
        mail: {
            title: 'Mail flow',
            desc: 'Inbound: the sender writes to your domain, Resend receives it and calls the frontend webhook, which stores the message in the database and attachments in storage and notifies the UI through SSE. Outbound: the UI calls the frontend API, which sends through Resend.',
            in: [['Sender', 'writes to your domain'], ['Resend', 'receives (MX)'], ['Webhook', 'POST /api/webhooks/resend; Svix signature if secret set'], ['Data', 'Postgres (message) and storage (attachments)'], ['UI', 'SSE / refresh']],
            out: [['UI', 'compose and send'], ['POST /api/emails', 'Idempotency-Key, DLP, limits'], ['Resend', 'sending API'], ['Recipient', 'SPF / DKIM / DMARC']],
            lin: 'Inbound',
            lout: 'Outbound',
        },
    },
} as const;

function Arrow() {
    return (
        <defs>
            <marker id="bx-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" className="fill-muted-foreground" />
            </marker>
        </defs>
    );
}

function wrap(text: string, max: number): string[] {
    const out: string[] = [];
    let cur = '';
    for (const word of text.split(' ')) {
        if (cur && (cur + ' ' + word).length > max) { out.push(cur); cur = word; } else cur = cur ? cur + ' ' + word : word;
    }
    if (cur) out.push(cur);
    return out;
}

function Box({ x, y, w, h, title, lines: rawLines = [], dashed, strong }: { x: number; y: number; w: number; h: number; title: string; lines?: readonly string[]; dashed?: boolean; strong?: boolean }) {
    const max = Math.max(8, Math.floor((w - 20) / 5.6));
    const lines = rawLines.flatMap((l) => wrap(l, max));
    return (
        <g>
            <rect x={x} y={y} width={w} height={h} rx={8} className={`fill-card ${strong ? 'stroke-primary' : 'stroke-border'}`} strokeWidth={strong ? 2 : 1} strokeDasharray={dashed ? '5 4' : undefined} />
            <text x={x + 10} y={y + 20} className="fill-card-foreground" fontSize={13} fontWeight={600}>{title}</text>
            {lines.map((l, i) => (
                <text key={i} x={x + 10} y={y + 38 + i * 16} className="fill-muted-foreground" fontSize={11}>{l}</text>
            ))}
        </g>
    );
}

function Line({ x1, y1, x2, y2, dashed, both }: { x1: number; y1: number; x2: number; y2: number; dashed?: boolean; both?: boolean }) {
    return <line x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray={dashed ? '4 3' : undefined} markerEnd="url(#bx-arrow)" markerStart={both ? 'url(#bx-arrow)' : undefined} />;
}

function Label({ x, y, text, anchor = 'middle' }: { x: number; y: number; text: string; anchor?: 'start' | 'middle' | 'end' }) {
    return <text x={x} y={y} textAnchor={anchor} className="fill-foreground" fontSize={11}>{text}</text>;
}

function Architecture({ locale }: { locale: Locale }) {
    const s = T[locale].arch;
    return (
        <svg viewBox="0 0 760 440" role="img" aria-labelledby="bx-arch-t bx-arch-d" className="h-auto w-full min-w-[640px]">
            <title id="bx-arch-t">{s.title}</title>
            <desc id="bx-arch-d">{s.desc}</desc>
            <Arrow />
            <text x={20} y={22} className="fill-foreground" fontSize={12} fontWeight={700}>{s.fe}</text>
            <Box x={20} y={34} w={210} h={62} title={s.feA} lines={[s.feSub, 'Ed25519 · HKDF']} />
            <Box x={20} y={122} w={210} h={62} title={s.feB} lines={[s.feSub, 'Ed25519 · HKDF']} />
            <Box x={20} y={210} w={210} h={62} title={s.feN} lines={[s.feSub, 'Ed25519 · HKDF']} dashed />
            <Box x={300} y={86} w={230} h={132} title={s.be} lines={s.beL} strong />
            <Line x1={230} y1={65} x2={300} y2={120} />
            <Line x1={230} y1={153} x2={300} y2={152} />
            <Line x1={230} y1={241} x2={300} y2={190} />
            <Label x={265} y={100} text={s.signed} />
            <Line x1={300} y1={205} x2={232} y2={258} dashed />
            <Label x={330} y={244} text={s.bridge} anchor="start" />
            <Box x={590} y={122} w={150} h={62} title={s.resend} lines={[s.hook]} />
            <path d="M590 153 C 470 150, 300 110, 232 80" className="stroke-muted-foreground fill-none" strokeWidth={1.5} strokeDasharray="4 3" markerEnd="url(#bx-arrow)" />
            <Box x={20} y={330} w={720} h={62} title={s.svc} lines={[s.svcL]} />
            <Line x1={125} y1={272} x2={125} y2={330} />
            <Line x1={415} y1={218} x2={415} y2={330} />
        </svg>
    );
}

function Steps({ locale }: { locale: Locale }) {
    const s = T[locale].sign;
    const w = 220;
    return (
        <svg viewBox="0 0 760 250" role="img" aria-labelledby="bx-sign-t bx-sign-d" className="h-auto w-full min-w-[640px]">
            <title id="bx-sign-t">{s.title}</title>
            <desc id="bx-sign-d">{s.desc}</desc>
            <Arrow />
            {s.steps.map((st, i) => {
                const row = Math.floor(i / 3);
                const col = i % 3;
                return <Box key={i} x={20 + col * (w + 20)} y={20 + row * 110} w={w} h={64} title={st[0]} lines={[st[1]]} strong={i === 2 || i === 5} />;
            })}
            <Line x1={240} y1={52} x2={260} y2={52} />
            <Line x1={480} y1={52} x2={500} y2={52} />
            <path d="M610 84 L610 100 L130 100 L130 130" className="stroke-muted-foreground fill-none" strokeWidth={1.5} markerEnd="url(#bx-arrow)" />
            <Line x1={240} y1={162} x2={260} y2={162} />
            <Line x1={480} y1={162} x2={500} y2={162} />
        </svg>
    );
}

function MailFlow({ locale }: { locale: Locale }) {
    const s = T[locale].mail;
    const rowY = (r: number) => 40 + r * 120;
    const wIn = 136;
    return (
        <svg viewBox="0 0 760 270" role="img" aria-labelledby="bx-mail-t bx-mail-d" className="h-auto w-full min-w-[640px]">
            <title id="bx-mail-t">{s.title}</title>
            <desc id="bx-mail-d">{s.desc}</desc>
            <Arrow />
            <text x={20} y={22} className="fill-foreground" fontSize={12} fontWeight={700}>{s.lin}</text>
            {s.in.map((n, i) => (
                <g key={i}>
                    <Box x={20 + i * (wIn + 16)} y={rowY(0)} w={wIn} h={84} title={n[0]} lines={[n[1]]} />
                    {i < s.in.length - 1 && <Line x1={20 + i * (wIn + 16) + wIn} y1={rowY(0) + 42} x2={20 + (i + 1) * (wIn + 16)} y2={rowY(0) + 42} />}
                </g>
            ))}
            <text x={20} y={152} className="fill-foreground" fontSize={12} fontWeight={700}>{s.lout}</text>
            {s.out.map((n, i) => (
                <g key={i}>
                    <Box x={20 + i * (wIn + 16)} y={rowY(1) + 10} w={wIn} h={84} title={n[0]} lines={[n[1]]} />
                    {i < s.out.length - 1 && <Line x1={20 + i * (wIn + 16) + wIn} y1={rowY(1) + 52} x2={20 + (i + 1) * (wIn + 16)} y2={rowY(1) + 52} />}
                </g>
            ))}
        </svg>
    );
}

export function Diagram({ id, caption, locale }: { id: 'architecture' | 'signing' | 'mail-flow'; caption: string; locale: Locale }) {
    return (
        <figure className="my-6 rounded-lg border border-border bg-background p-3">
            <div className="overflow-x-auto" tabIndex={0} aria-label={caption}>
                {id === 'architecture' && <Architecture locale={locale} />}
                {id === 'signing' && <Steps locale={locale} />}
                {id === 'mail-flow' && <MailFlow locale={locale} />}
            </div>
            <figcaption className="mt-2 text-center text-xs text-muted-foreground">{caption}</figcaption>
        </figure>
    );
}
