/**
 * Textos por defecto de la landing (es/en) que NO pertenecen al diccionario global. Se mantienen aparte para
 * no tocar es.ts/en.ts. Los textos de empresa (config.i18n[locale] > config base) siempre ganan.
 */
import { interpolate, type Locale, type TranslateParams } from '@/lib/i18n/core';

const es = {
    'poweredBy': 'Con tecnología de {name}',
    'registrationClosed': 'El registro no está disponible en este momento. Contacta con el administrador de tu organización.',
    'terms': 'Términos',
    'privacy': 'Privacidad',
    'forgot': '¿Olvidaste tu contraseña?',
    'google': 'Continuar con Google',
    'remember': 'Recordarme en este dispositivo',
    'testimonials': 'Opiniones de clientes',
    'prevTestimonial': 'Opinión anterior',
    'nextTestimonial': 'Opinión siguiente',
    'goToTestimonial': 'Ir a la opinión {n}',
    'stats': 'Cifras',
    'features': 'Características',
    'footerNav': 'Enlaces del pie de página',
    'skipToForm': 'Ir al formulario',
    'docsHiddenTitle': 'Documentación no disponible',
    'docsHiddenText': 'Esta organización no publica la documentación. Puedes volver al acceso.',
    'docsHiddenBack': 'Volver al acceso',
    'loginLandmark': 'Acceso',
    'docsLabel': 'Documentación',
} as const;

const en: Record<keyof typeof es, string> = {
    'poweredBy': 'Powered by {name}',
    'registrationClosed': 'Registration is not available right now. Please contact your organization administrator.',
    'terms': 'Terms',
    'privacy': 'Privacy',
    'forgot': 'Forgot your password?',
    'google': 'Continue with Google',
    'remember': 'Remember me on this device',
    'testimonials': 'Customer testimonials',
    'prevTestimonial': 'Previous testimonial',
    'nextTestimonial': 'Next testimonial',
    'goToTestimonial': 'Go to testimonial {n}',
    'stats': 'Key figures',
    'features': 'Features',
    'footerNav': 'Footer links',
    'skipToForm': 'Skip to form',
    'docsHiddenTitle': 'Documentation unavailable',
    'docsHiddenText': 'This organization does not publish its documentation. You can go back to sign in.',
    'docsHiddenBack': 'Back to sign in',
    'loginLandmark': 'Sign in',
    'docsLabel': 'Docs',
};

export type LandingMessageKey = keyof typeof es;
const dict: Record<Locale, Record<LandingMessageKey, string>> = { es, en };

export function landingMessage(locale: Locale, key: LandingMessageKey, params?: TranslateParams): string {
    const table = dict[locale] || dict.es;
    return interpolate(table[key] ?? es[key] ?? key, params);
}
