import { safeRegexTest } from '@/lib/rules/regex-safety';
import { redactText, totalRedactions } from './redact';
import type { AiGuardrails } from './types';

/**
 * Guardarrailes de entrada/salida. Cada uno tiene modo: off | log (solo registra la marca en AiUsage.flags) | warn (registra y
 * devuelve un aviso al llamante) | enforce (actua: redacta / bloquea / trunca). Nunca se guarda ni se devuelve el contenido detectado.
 */
export interface GuardResult {
    texts: string[];
    flags: string[];
    warnings: string[];
    /** Regla que bloquea la peticion (guardrail_blocked). */
    blocked: string | null;
    redactions: number;
}

export function applySystemPrefix(prefix: string, system: string | undefined): string {
    const p = prefix.trim();
    const s = (system ?? '').trim();
    return p && s ? `${p}\n\n${s}` : p || s;
}

export interface MailParts { subject?: string; body?: string }

/** Compone el texto de un correo respetando la politica de cuerpo. `dropped` indica que se omitio el cuerpo. */
export function applyBodyPolicy(parts: MailParts, policy: AiGuardrails['bodyPolicy']): { text: string; trimmed: boolean } {
    const subject = (parts.subject ?? '').trim();
    let body = (parts.body ?? '').trim();
    let trimmed = false;
    if (policy.mode === 'subject-only') { trimmed = body.length > 0; body = ''; }
    else if (policy.mode === 'snippet' && body.length > policy.snippetChars) { body = body.slice(0, policy.snippetChars); trimmed = true; }
    return { text: [subject && `Subject: ${subject}`, body && `Body:\n${body}`].filter(Boolean).join('\n\n'), trimmed };
}

export function runInputGuardrails(texts: string[], g: AiGuardrails): GuardResult {
    const res: GuardResult = { texts: [...texts], flags: [], warnings: [], blocked: null, redactions: 0 };
    const note = (mode: string, flag: string, warning: string) => { if (mode === 'off') return; res.flags.push(flag); if (mode === 'warn' || mode === 'enforce') res.warnings.push(warning); };

    const topics = g.blockedTopics;
    if (topics.mode !== 'off' && topics.patterns.length > 0) {
        const hit = topics.patterns.some((p) => res.texts.some((t) => safeRegexTest(p, t, 200_000)));
        if (hit) {
            res.flags.push('topic');
            if (topics.mode === 'enforce') { res.blocked = 'blocked_topic'; return res; }
            if (topics.mode === 'warn') res.warnings.push('blocked_topic');
        }
    }
    const red = g.redaction;
    if (red.mode !== 'off') {
        let total = 0;
        const next = res.texts.map((t) => {
            const r = redactText(t, red.categories);
            total += totalRedactions(r.counts);
            return red.mode === 'enforce' ? r.text : t;
        });
        if (total > 0) {
            res.redactions = red.mode === 'enforce' ? total : 0;
            note(red.mode, red.mode === 'enforce' ? `redacted:${total}` : `pii:${total}`, red.mode === 'enforce' ? 'redacted' : 'sensitive_data');
            if (red.mode === 'enforce') res.texts = next;
        }
    }
    return res;
}

export function runOutputGuardrails(text: string, g: AiGuardrails): { text: string; flags: string[]; warnings: string[]; blocked: string | null } {
    const out = g.output;
    const r = { text, flags: [] as string[], warnings: [] as string[], blocked: null as string | null };
    if (out.mode === 'off') return r;
    if (out.patterns.some((p) => safeRegexTest(p, text, 200_000))) {
        r.flags.push('output_pattern');
        if (out.mode === 'enforce') { r.blocked = 'output_pattern'; return r; }
        if (out.mode === 'warn') r.warnings.push('output_pattern');
    }
    if (text.length > out.maxChars) {
        r.flags.push('output_long');
        if (out.mode === 'enforce') r.text = text.slice(0, out.maxChars);
        else if (out.mode === 'warn') r.warnings.push('output_long');
    }
    return r;
}
