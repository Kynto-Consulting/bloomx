/** Coincidencia de marcas: dominios legitimos, nombre visible y parecidos (distancia de edicion). Puro. */
import { BRANDS, MIN_LOOKALIKE_LEN, type Brand } from './brands';
import { RISKY_TLDS } from './lexicon';
import { decodePunycodeHost, levenshtein, normalizeText, registrable, tldOf, foldHomoglyphs } from './text';

const SERVICE_WORDS = /\b(support|security|team|account|billing|alert|alerts|notification|notifications|service|services|help|verification|verify|customer|payments?|no ?reply|soporte|seguridad|equipo|cuenta|servicio|servicios|atencion|cliente|notificaciones|pagos|suporte|conta|atendimento|seguranca|notificacoes|pagamentos|official|oficial|delivery|shipping|tracking|envios?|entrega|rastreio|logistica|express|parcel)\b/;
const BAIT = 'support|secure|security|login|signin|verify|verification|account|accounts|billing|help|service|update|alert|team|online|mail|id|pay|payment|wallet|recovery|center|centre|care|customer|web|portal|cloud|access|auth';

export function isLegitBrandDomain(brand: Brand, host: string): boolean {
    const r = registrable(host.toLowerCase());
    if (brand.domains?.includes(r)) return true;
    const parts = r.split('.');
    const sld = parts[0];
    const tld = tldOf(r);
    if (RISKY_TLDS.has(tld)) return false;
    return brand.labels.includes(sld);
}

/** Marca a la que el nombre visible dice pertenecer (nombre == marca o marca + palabra de servicio). */
export function brandInDisplayName(name: string): Brand | null {
    const n = normalizeText(name).replace(/[^a-z0-9 ._@-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!n) return null;
    for (const b of BRANDS) {
        for (const token of b.names) {
            if (!token) continue;
            const re = new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`);
            if (!re.test(n)) continue;
            const stripped = n.replace(re, ' ').replace(/\b(com|net|org|the|de|da|do|of|la|el)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
            if (stripped === '' || SERVICE_WORDS.test(stripped)) return b;
        }
    }
    return null;
}

const LEET: Record<string, string> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i' };
export function leetFold(s: string): string {
    return foldHomoglyphs(s.toLowerCase()).replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/[013457@$!8]/g, (c) => LEET[c] ?? c);
}

export interface Lookalike { brand: Brand; kind: 'edit' | 'segment' | 'bait' | 'subdomain' | 'leet' }

/** ¿Este host imita a una marca sin ser suyo? */
export function lookalikeBrand(host: string): Lookalike | null {
    let h = host.toLowerCase();
    if (h.split('.').some((x) => x.startsWith('xn--'))) {
        const uni = foldHomoglyphs(decodePunycodeHost(h));
        if (uni !== h && uni.split('.').every((x) => /^[a-z0-9-]+$/.test(x))) {
            for (const b of BRANDS) if (b.labels.some((l) => l.length >= 4 && registrable(uni).split('.')[0] === l)) return { brand: b, kind: 'leet' };
            h = uni;
        }
    }
    if (!h.includes('.')) return null;
    const r = registrable(h);
    const parts = r.split('.');
    const sld = parts[0];
    const sldFold = leetFold(sld);
    const hostLabels = h.split('.').slice(0, -1);
    for (const b of BRANDS) {
        if (isLegitBrandDomain(b, h)) continue;
        for (const label of b.labels) {
            if (label.length < 4) continue;
            const segs = sldFold.split('-');
            if (segs.includes(label) && sld !== label) return { brand: b, kind: 'segment' };
            if (new RegExp(`^(?:${label}(?:${BAIT})|(?:${BAIT})${label})$`).test(sldFold)) return { brand: b, kind: 'bait' };
            // marca como subdominio de otro dominio: paypal.com.seguro-login.xyz
            if (hostLabels.slice(0, -1).includes(label) && label.length >= 5) return { brand: b, kind: 'subdomain' };
            if (label.length >= MIN_LOOKALIKE_LEN) {
                if (sldFold === label && sld !== label) return { brand: b, kind: 'leet' };
                const max = label.length >= 8 ? 2 : 1;
                const d = levenshtein(sldFold, label, max);
                if (d >= 1 && d <= max && Math.abs(sld.length - label.length) <= max) return { brand: b, kind: 'edit' };
            }
        }
    }
    return null;
}
