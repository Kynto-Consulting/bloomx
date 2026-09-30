/**
 * Corpus SINTETICO etiquetado (es/en/pt) para medir el motor. Todo el texto, dominios y direcciones son inventados aqui: no hay
 * correos ni personas reales. Generacion determinista (PRNG con semilla) a partir de plantillas y fragmentos, repartida en
 * varios archivos (corpus-core, corpus-ham-a/b, corpus-spam-a/b) para mantenerlos pequenos.
 */
import { Gen, mulberry32, type Sample } from './corpus-core';
import { hamCarriersBanks, hamInvites, hamMarketing, hamNoAuthSmall } from './corpus-ham-b';
import { hamCorporate, hamInvoices, hamNewsletters, hamNotifications, hamPersonal } from './corpus-ham-a';
import { spamAdvanceFee, spamBankPhishing, spamCredential, spamPharmaAdult } from './corpus-spam-a';
import { spamCrypto, spamHardMinimal, spamHomograph, spamMalwareInvoice, spamMarketing, spamShipping, spamSpoof } from './corpus-spam-b';

export { CORPUS_NOW, type Label, type Lang, type Sample } from './corpus-core';

export function buildHam(): Sample[] {
    const g = new Gen();
    return [...hamNewsletters(g), ...hamPersonal(g), ...hamInvoices(g), ...hamNotifications(g), ...hamCorporate(g), ...hamCarriersBanks(g), ...hamMarketing(g), ...hamNoAuthSmall(g), ...hamInvites(g)];
}

export function buildSpam(): Sample[] {
    const g = new Gen();
    g.r = mulberry32(777);
    return [...spamBankPhishing(g), ...spamCredential(g), ...spamAdvanceFee(g), ...spamPharmaAdult(g), ...spamCrypto(g), ...spamMalwareInvoice(g), ...spamShipping(g), ...spamSpoof(g), ...spamMarketing(g), ...spamHardMinimal(g), ...spamHomograph(g)];
}

export function buildCorpus(): { ham: Sample[]; spam: Sample[] } {
    return { ham: buildHam(), spam: buildSpam() };
}
