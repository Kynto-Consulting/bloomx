function canonicalAddress(email: string): string {
    const [local, domain] = String(email || '').toLowerCase().trim().split('@');
    if (!domain) return String(email || '').toLowerCase().trim();
    const base = local.replace(/\./g, '');
    const plus = base.indexOf('+');
    return `${plus === -1 ? base : base.substring(0, plus)}@${domain}`;
}

/** Extrae el sufijo de alias (`usuario+sufijo@dominio`) si el destinatario pertenece a este usuario. */
export function aliasSuffixFor(userEmail: string, recipient: string): string | null {
    const raw = String(recipient || '').trim().toLowerCase();
    const at = raw.lastIndexOf('@');
    if (at <= 0) return null;
    if (canonicalAddress(raw) !== canonicalAddress(userEmail)) return null;
    const local = raw.slice(0, at);
    const plus = local.indexOf('+');
    if (plus === -1) return null;
    const suffix = local.slice(plus + 1);
    return suffix || null;
}
