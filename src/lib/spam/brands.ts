/** Marcas suplantables: nombres a vigilar en el nombre visible y dominios/etiquetas que SI les corresponden. */

export interface Brand {
    id: string;
    /** Tokens normalizados (sin acentos, minusculas) que aparecen en el nombre visible. */
    names: string[];
    /** Etiquetas (segunda etiqueta del dominio registrable) que le pertenecen, con cualquier TLD no riesgoso. */
    labels: string[];
    /** Dominios registrables exactos adicionales. */
    domains?: string[];
}

export const BRANDS: readonly Brand[] = [
    { id: 'paypal', names: ['paypal'], labels: ['paypal', 'paypal-communication'] },
    { id: 'microsoft', names: ['microsoft', 'outlook', 'office 365', 'office365', 'onedrive', 'sharepoint', 'xbox', 'skype'], labels: ['microsoft', 'office', 'office365', 'outlook', 'live', 'microsoftonline', 'onedrive', 'sharepoint', 'xbox', 'skype', 'azure', 'windows', 'hotmail', 'msn'] },
    { id: 'google', names: ['google', 'gmail', 'youtube'], labels: ['google', 'gmail', 'youtube', 'googlemail', 'goo', 'withgoogle', 'gstatic'] },
    { id: 'apple', names: ['apple', 'icloud', 'itunes', 'app store'], labels: ['apple', 'icloud', 'itunes'] },
    { id: 'amazon', names: ['amazon', 'amazon prime', 'aws'], labels: ['amazon', 'amazonaws', 'amazonses', 'aws', 'primevideo'] },
    { id: 'netflix', names: ['netflix'], labels: ['netflix'] },
    { id: 'meta', names: ['facebook', 'instagram', 'whatsapp'], labels: ['facebook', 'facebookmail', 'instagram', 'whatsapp', 'meta', 'fb'] },
    { id: 'linkedin', names: ['linkedin'], labels: ['linkedin'] },
    { id: 'x', names: ['twitter'], labels: ['twitter', 'x'] },
    { id: 'dhl', names: ['dhl'], labels: ['dhl'] },
    { id: 'fedex', names: ['fedex'], labels: ['fedex'] },
    { id: 'ups', names: ['ups'], labels: ['ups'] },
    { id: 'usps', names: ['usps'], labels: ['usps'] },
    { id: 'correos', names: ['correos'], labels: ['correos'] },
    { id: 'correios', names: ['correios'], labels: ['correios'] },
    { id: 'docusign', names: ['docusign'], labels: ['docusign'] },
    { id: 'dropbox', names: ['dropbox'], labels: ['dropbox', 'dropboxmail'] },
    { id: 'adobe', names: ['adobe'], labels: ['adobe'] },
    { id: 'coinbase', names: ['coinbase'], labels: ['coinbase'] },
    { id: 'binance', names: ['binance'], labels: ['binance'] },
    { id: 'steam', names: ['steam'], labels: ['steampowered', 'steamcommunity', 'valvesoftware'] },
    { id: 'spotify', names: ['spotify'], labels: ['spotify'] },
    { id: 'mercadolibre', names: ['mercado libre', 'mercadolibre', 'mercado pago', 'mercadopago'], labels: ['mercadolibre', 'mercadopago', 'mercadolivre'] },
    { id: 'bbva', names: ['bbva'], labels: ['bbva'] },
    { id: 'santander', names: ['santander'], labels: ['santander', 'santanderbank'] },
    { id: 'bancolombia', names: ['bancolombia'], labels: ['bancolombia'] },
    { id: 'itau', names: ['itau'], labels: ['itau'] },
    { id: 'bradesco', names: ['bradesco'], labels: ['bradesco'] },
    { id: 'bancodobrasil', names: ['banco do brasil'], labels: ['bb'], domains: ['bancodobrasil.com.br'] },
    { id: 'caixa', names: ['caixa economica', 'caixa economica federal'], labels: ['caixa'] },
    { id: 'banorte', names: ['banorte'], labels: ['banorte'] },
    { id: 'citi', names: ['citibank', 'citibanamex', 'banamex'], labels: ['citi', 'citibank', 'citibanamex', 'banamex'] },
    { id: 'hsbc', names: ['hsbc'], labels: ['hsbc'] },
    { id: 'scotiabank', names: ['scotiabank'], labels: ['scotiabank'] },
    { id: 'interbank', names: ['interbank'], labels: ['interbank'] },
    { id: 'bcp', names: ['banco de credito', 'viabcp'], labels: ['viabcp', 'bcp'], domains: ['bcp.com.pe'] },
    { id: 'davivienda', names: ['davivienda'], labels: ['davivienda'] },
    { id: 'nubank', names: ['nubank'], labels: ['nubank'] },
    { id: 'wellsfargo', names: ['wells fargo'], labels: ['wellsfargo'] },
    { id: 'chase', names: ['chase bank', 'jpmorgan'], labels: ['chase', 'jpmorgan'] },
    { id: 'bankofamerica', names: ['bank of america'], labels: ['bankofamerica', 'bofa'] },
    { id: 'amex', names: ['american express'], labels: ['americanexpress', 'aexp'] },
    { id: 'visa', names: [], labels: ['visa'] },
    { id: 'mastercard', names: ['mastercard'], labels: ['mastercard'] },
    { id: 'sunat', names: ['sunat'], labels: ['sunat'] },
    { id: 'sat', names: ['sat mexico', 'servicio de administracion tributaria'], labels: ['sat'] },
    { id: 'afip', names: ['afip'], labels: ['afip'] },
];

/** Etiquetas prohibidas por si solas como identidad de marca al comparar (evita falsos positivos por palabras cortas). */
export const MIN_LOOKALIKE_LEN = 6;
