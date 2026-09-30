// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthLanding, type AuthLandingProps } from '../landing/AuthLanding';
import { LandingFormExtras } from '../landing/FormExtras';
import { toneForImage } from '@/lib/landing-surface';
import { contrast, mix } from '@/lib/color';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const form = React.createElement('form', { 'data-testid': 'the-form' }, React.createElement('input', { id: 'e', name: 'email' }), React.createElement(LandingFormExtras));

function render(config: unknown, extra: Partial<AuthLandingProps> = {}) {
    const props: AuthLandingProps = {
        page: 'login',
        config,
        brand: { name: 'Acme', logo: null },
        locale: 'es',
        title: 'Iniciar sesion',
        subtitle: 'Ingresa tu correo',
        tagline: 'Correo serverless',
        altLink: { href: '/register', label: 'Registrate' },
        children: form,
        ...extra,
    };
    act(() => { root.render(React.createElement(AuthLanding, props)); });
    return container;
}
const q = (sel: string) => container.querySelector(sel);
const qa = (sel: string) => Array.from(container.querySelectorAll(sel));
const rootEl = () => q('[data-landing-layout]') as HTMLElement;

describe('AuthLanding: retrocompatibilidad (sin config = diseno actual)', () => {
    for (const cfg of [undefined, null, {}, { unknown: 1 }, 'basura']) {
        it(`config ${JSON.stringify(cfg)} -> split con hero a la izquierda y panel a la derecha`, () => {
            render(cfg);
            expect(rootEl().dataset.landingLayout).toBe('split-right');
            const section = q('section[aria-label="Acme"]') as HTMLElement;
            const main = q('main#landing-form') as HTMLElement;
            expect(section).toBeTruthy();
            expect(main).toBeTruthy();
            // hero antes que el panel en el DOM y sin `order` (queda a la izquierda)
            expect(section.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(section.className).not.toContain('order-2');
            expect(section.className).toContain('bg-primary');
            expect(section.className).toContain('text-primary-foreground');
            expect(section.textContent).toContain('Correo serverless');
            expect(q('h1')?.textContent).toBe('Iniciar sesion');
            expect(q('[data-testid="the-form"]')).toBeTruthy();
            // enlace de docs (historico) y de registro
            expect(qa('a').some((a) => a.getAttribute('href') === '/docs')).toBe(true);
            expect(qa('a').some((a) => a.getAttribute('href') === '/register')).toBe(true);
        });
    }
    it('sin config no aparecen testimonios, stats, features, footer ni "powered by"', () => {
        render({});
        expect(q('figure')).toBeNull();
        expect(q('dl')).toBeNull();
        expect(q('footer')).toBeNull();
        expect(container.textContent).not.toMatch(/Powered by|Con tecnolog/);
    });
    it('sin logo se muestra el icono por defecto y nombre de marca', () => {
        render({});
        expect(qa('img')).toHaveLength(0);
        expect(container.textContent).toContain('Acme');
    });
});

describe('AuthLanding: layouts', () => {
    it('split-right: hero primero (izquierda)', () => {
        render({ layout: 'split-right' });
        expect(rootEl().dataset.landingLayout).toBe('split-right');
        expect((q('section[aria-label="Acme"]') as HTMLElement).className).not.toContain('order-2');
    });
    it('split-left: el panel va a la izquierda (order) en escritorio', () => {
        render({ layout: 'split-left' });
        expect(rootEl().dataset.landingLayout).toBe('split-left');
        expect((q('section[aria-label="Acme"]') as HTMLElement).className).toContain('order-2');
        expect((q('main#landing-form') as HTMLElement).parentElement!.className).toContain('order-1');
    });
    it('center: tarjeta centrada, sin hero lateral; titulo/subtitulo de empresa encima', () => {
        render({ layout: 'center', hero: { title: 'Bienvenido', subtitle: 'Tu correo' }, features: [{ icon: 'lock', title: 'Seguro' }] });
        expect(rootEl().dataset.landingLayout).toBe('center');
        expect(q('section[aria-label="Acme"]')).toBeNull();
        expect(q('h2')?.textContent).toBe('Bienvenido');
        expect(q('main#landing-form')).toBeTruthy();
        expect(q('ul[aria-label]')?.textContent).toContain('Seguro');
    });
    it('fullscreen-bg: el fondo cubre toda la pagina y el panel es una tarjeta', () => {
        render({ layout: 'fullscreen-bg', hero: { imageUrl: 'https://cdn.example.com/bg.jpg', title: 'Hola' } });
        expect(rootEl().dataset.landingLayout).toBe('fullscreen-bg');
        const img = q('img') as HTMLImageElement;
        expect(img.getAttribute('src')).toBe('https://cdn.example.com/bg.jpg');
        expect((q('main#landing-form > div') as HTMLElement).className).toContain('bg-card');
        expect(q('h2')?.textContent).toBe('Hola');
    });
    it('minimal: solo la tarjeta; ignora hero, features, stats y testimonios', () => {
        render({
            layout: 'minimal', hero: { title: 'NO' }, features: [{ title: 'NO-F' }], stats: [{ value: '9', label: 'NO-S' }],
            testimonials: { enabled: true, items: [{ quote: 'NO-T' }] },
        });
        expect(rootEl().dataset.landingLayout).toBe('minimal');
        expect(container.textContent).not.toMatch(/NO/);
        expect(q('h2')).toBeNull();
        expect(q('main#landing-form')).toBeTruthy();
    });
    it('forceLayout gana sobre la config y marketing=false oculta los bloques (paginas de admin)', () => {
        render({ layout: 'split-left', hero: { title: 'MK' }, features: [{ title: 'MKF' }] }, { forceLayout: 'center', marketing: false, page: 'admin-login' });
        expect(rootEl().dataset.landingLayout).toBe('center');
        expect(container.textContent).not.toMatch(/MK/);
    });
    it('panelWidth se aplica como variable CSS acotada', () => {
        render({ panelWidth: 480 });
        expect((q('[style*="--landing-panel"]') as HTMLElement).style.getPropertyValue('--landing-panel')).toBe('480px');
        render({ panelWidth: 99999 });
        expect((q('[style*="--landing-panel"]') as HTMLElement).style.getPropertyValue('--landing-panel')).toBe('560px');
    });
    it('hero movil: por defecto oculto (solo marca); banner lo muestra', () => {
        render({});
        expect((q('section[aria-label="Acme"]') as HTMLElement).className).toContain('hidden');
        render({ hero: { mobile: 'banner' } });
        expect((q('section[aria-label="Acme"]') as HTMLElement).className).not.toMatch(/(^| )hidden( |$)/);
    });
    it('logo.position=panel/header saca la marca del hero', () => {
        render({ logo: { position: 'header' } });
        expect(q('header')).toBeTruthy();
        render({ logo: { position: 'panel' } });
        expect(q('section[aria-label="Acme"]')?.textContent).not.toContain('Acme');
    });
});

describe('AuthLanding: testimonios', () => {
    const items = [{ quote: 'Excelente servicio', author: 'Ana', role: 'CTO' }, { quote: 'Muy seguro', author: 'Luis' }];
    it('enabled=false (o ausente) no muestra nada aunque haya items', () => {
        render({ testimonials: { items } });
        expect(container.textContent).not.toContain('Excelente servicio');
        render({ testimonials: { enabled: false, items } });
        expect(container.textContent).not.toContain('Excelente servicio');
    });
    it('cards: todas las opiniones como blockquote/figure', () => {
        render({ testimonials: { enabled: true, style: 'cards', items } });
        expect(qa('figure')).toHaveLength(2);
        expect(qa('blockquote').map((b) => b.textContent)).toEqual(['Excelente servicio', 'Muy seguro']);
    });
    it('quote: solo la primera', () => {
        render({ testimonials: { enabled: true, style: 'quote', items } });
        expect(qa('blockquote')).toHaveLength(1);
        expect(container.textContent).toContain('Excelente servicio');
        expect(container.textContent).not.toContain('Muy seguro');
    });
    it('carousel: region accesible, un slide, controles con etiqueta y navegacion', () => {
        render({ testimonials: { enabled: true, style: 'carousel', items } });
        const region = q('[role="region"][aria-roledescription="carousel"]') as HTMLElement;
        expect(region).toBeTruthy();
        expect(region.getAttribute('aria-label')).toBeTruthy();
        expect(qa('blockquote')).toHaveLength(1);
        const next = qa('button').find((b) => b.getAttribute('aria-label') === 'Opinión siguiente') as HTMLButtonElement;
        expect(next).toBeTruthy();
        act(() => { next.click(); });
        expect(container.textContent).toContain('Muy seguro');
    });
    it('el carrusel NO avanza solo con prefers-reduced-motion', () => {
        vi.useFakeTimers();
        try {
            const mm = vi.fn().mockImplementation((query: string) => ({ matches: query.includes('reduce'), addEventListener() { }, removeEventListener() { } }));
            vi.stubGlobal('matchMedia', mm);
            (window as any).matchMedia = mm;
            render({ testimonials: { enabled: true, style: 'carousel', items } });
            act(() => { vi.advanceTimersByTime(30000); });
            expect(container.textContent).toContain('Excelente servicio');
            expect(container.textContent).not.toContain('Muy seguro');
        } finally {
            vi.unstubAllGlobals();
            vi.useRealTimers();
        }
    });
    it('sin author ni avatar no inventa datos', () => {
        render({ testimonials: { enabled: true, style: 'cards', items: [{ quote: 'Solo cita' }] } });
        expect(q('figcaption')).toBeNull();
    });
    it('avatar: <img alt="" loading=lazy referrerpolicy=no-referrer>', () => {
        render({ testimonials: { enabled: true, items: [{ quote: 'q', author: 'A', avatarUrl: 'https://cdn.example.com/a.png' }] } });
        const img = q('figure img') as HTMLImageElement;
        expect(img.getAttribute('alt')).toBe('');
        expect(img.getAttribute('loading')).toBe('lazy');
        expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    });
});

describe('AuthLanding: i18n (config.i18n[locale] > config base > diccionario)', () => {
    const cfg = {
        hero: { title: 'Titulo base' },
        form: { title: 'Form base' },
        i18n: { en: { heroTitle: 'English title', formTitle: 'English form' } },
    };
    it('es: usa el texto base de empresa', () => {
        render(cfg, { locale: 'es' });
        expect(q('h2')?.textContent).toBe('Titulo base');
        expect(q('h1')?.textContent).toBe('Form base');
    });
    it('en: el texto por idioma gana', () => {
        render(cfg, { locale: 'en' });
        expect(q('h2')?.textContent).toBe('English title');
        expect(q('h1')?.textContent).toBe('English form');
    });
    it('sin texto de empresa: cae al diccionario (props)', () => {
        render({ i18n: { en: { heroTitle: 'x' } } }, { locale: 'es' });
        expect(q('h1')?.textContent).toBe('Iniciar sesion');
        expect(q('section[aria-label="Acme"]')?.textContent).toContain('Correo serverless');
    });
    it('config.locale fuerza el idioma de la landing', () => {
        render({ ...cfg, locale: 'en' }, { locale: 'es' });
        expect(q('h2')?.textContent).toBe('English title');
        expect(rootEl().getAttribute('lang')).toBe('en');
    });
    it('la clave/registro usan su propio titulo', () => {
        render({ form: { title: 'Login', registerTitle: 'Alta' } }, { page: 'register', title: 'Crear cuenta' });
        expect(q('h1')?.textContent).toBe('Alta');
    });
});

describe('AuthLanding: documentacion', () => {
    it('docs.visible=false: sin ningun enlace a /docs (hero, movil ni pie)', () => {
        render({ docs: { visible: false, showInFooter: true }, footer: { text: 'pie' } });
        expect(qa('a').some((a) => (a.getAttribute('href') || '').startsWith('/docs'))).toBe(false);
    });
    it('landingLink=false quita solo el enlace de la pantalla', () => {
        render({ docs: { landingLink: false } });
        expect(qa('a').some((a) => a.getAttribute('href') === '/docs')).toBe(false);
    });
    it('showInFooter=true anade el enlace en el pie', () => {
        render({ docs: { landingLink: false, showInFooter: true } });
        const footerLinks = qa('footer a').map((a) => a.getAttribute('href'));
        expect(footerLinks).toContain('/docs');
    });
});

describe('AuthLanding: registro, formulario y pie', () => {
    it('registration.enabled=false: registro cierra con mensaje de empresa y sin formulario', () => {
        render({ registration: { enabled: false, message: 'Solo por invitacion' } }, { page: 'register' });
        expect(q('[role="status"]')?.textContent).toBe('Solo por invitacion');
        expect(q('[data-testid="the-form"]')).toBeNull();
    });
    it('registration.enabled=false sin mensaje usa el texto por defecto y oculta el enlace de registro en login', () => {
        render({ registration: { enabled: false } }, { page: 'register' });
        expect(q('[role="status"]')?.textContent).toMatch(/registro/i);
        render({ registration: { enabled: false } }, { page: 'login' });
        expect(qa('a').some((a) => a.getAttribute('href') === '/register')).toBe(false);
        expect(q('[data-testid="the-form"]')).toBeTruthy();
    });
    it('form.showRegisterLink=false oculta el enlace', () => {
        render({ form: { showRegisterLink: false } });
        expect(qa('a').some((a) => a.getAttribute('href') === '/register')).toBe(false);
    });
    it('remember/forgot/google solo se muestran si la empresa los activa Y la pagina aporta la accion', () => {
        const actions = { forgotHref: '/forgot', onGoogle: () => { }, remember: { checked: false, onChange: () => { } } };
        render({}, { actions });
        expect(container.textContent).not.toMatch(/Olvidaste|Google|Recordarme/);
        render({ form: { showForgotLink: true, showGoogle: true, showRememberMe: true } });
        expect(container.textContent).not.toMatch(/Olvidaste|Google|Recordarme/);
        render({ form: { showForgotLink: true, showGoogle: true, showRememberMe: true } }, { actions });
        expect(container.textContent).toMatch(/Olvidaste/);
        expect(container.textContent).toMatch(/Google/);
        expect(container.textContent).toMatch(/Recordarme/);
    });
    it('pie: texto, enlaces (https con noopener), legales y powered by', () => {
        render({
            footer: { text: 'Acme S.A.', links: [{ label: 'Estado', url: 'https://status.example.com' }, { label: 'Ayuda', url: '/help' }], showPoweredBy: true },
            legal: { termsUrl: '/terms', privacyUrl: 'https://example.com/privacy' },
        });
        const f = q('footer') as HTMLElement;
        expect(f.textContent).toContain('Acme S.A.');
        expect(f.textContent).toContain('Términos');
        expect(f.textContent).toContain('Privacidad');
        expect(f.textContent).toContain('Bloomx');
        const ext = qa('footer a').find((a) => a.getAttribute('href') === 'https://status.example.com/') as HTMLAnchorElement;
        expect(ext.getAttribute('rel')).toContain('noopener');
        expect(ext.getAttribute('rel')).toContain('noreferrer');
        expect(qa('footer a').find((a) => a.getAttribute('href') === '/help')).toBeTruthy();
    });
    it('un enlace javascript: hostil jamas llega al DOM', () => {
        render({ footer: { links: [{ label: 'x', url: 'javascript:alert(1)' }] }, legal: { termsUrl: 'javascript:alert(1)' } });
        expect(container.innerHTML).not.toMatch(/javascript:/i);
    });
});

describe('AuthLanding: seguridad y accesibilidad', () => {
    it('HTML en textos se muestra como texto, no como marcado', () => {
        render({ hero: { title: '<img src=x onerror=alert(1)>Hola' } });
        expect(q('h2')?.textContent).toBe('Hola');
        expect(container.querySelector('[onerror]')).toBeNull();
    });
    it('imagenes: <img> con referrerpolicy, sin CSS url() y solo https', () => {
        render({ hero: { imageUrl: 'https://cdn.example.com/h.jpg', imageAlt: 'Oficina' }, logo: { light: 'https://cdn.example.com/l.png' } });
        for (const img of qa('img') as HTMLImageElement[]) {
            expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
            expect(img.src.startsWith('https://')).toBe(true);
        }
        expect(container.innerHTML).not.toMatch(/url\(/);
        expect(q('section img')?.getAttribute('alt')).toBe('Oficina');
    });
    it('imagen http o data: se descarta (no se pide ningun recurso)', () => {
        render({ hero: { imageUrl: 'http://cdn.example.com/h.jpg' }, background: { type: 'image', imageUrl: 'data:image/png;base64,AAAA' } });
        expect(qa('img')).toHaveLength(0);
    });
    it('landmarks: un <main> unico con el h1, enlace de salto y secciones con nombre', () => {
        render({ footer: { text: 'pie' } });
        expect(qa('main')).toHaveLength(1);
        expect(q('main h1')).toBeTruthy();
        expect(q('a[href="#landing-form"]')).toBeTruthy();
        expect(q('footer')).toBeTruthy();
    });
    it('vista previa: enlaces inertes y sin enlace de salto', () => {
        render({ footer: { links: [{ label: 'x', url: 'https://a.com' }] } }, { preview: true });
        expect(q('a[href="#landing-form"]')).toBeNull();
        for (const a of qa('a')) expect(a.getAttribute('href')).toBe('#');
    });
    it('imagen de hero: el velo aplicado garantiza AA aunque overlay sea 0', () => {
        render({ hero: { imageUrl: 'https://cdn.example.com/h.jpg', overlay: 0 } });
        const scrim = q('[data-landing-scrim]') as HTMLElement;
        expect(scrim).toBeTruthy();
        const alpha = Number(scrim.getAttribute('data-landing-scrim'));
        expect(alpha).toBeGreaterThanOrEqual(toneForImage(0).scrim);
        expect(contrast('#ffffff', mix('#ffffff', '#000000', alpha))).toBeGreaterThanOrEqual(4.5);
    });
    it('degradado claro: el texto del hero pasa a oscuro con contraste AA', () => {
        render({ hero: { gradient: { from: '#fde68a', to: '#fef3c7', angle: 90 }, title: 'Hola' } });
        const section = q('section[aria-label="Acme"]') as HTMLElement;
        const color = section.style.color;
        expect(color).toBeTruthy();
        expect(section.style.backgroundImage).toContain('linear-gradient(90deg, rgb(253, 230, 138), rgb(254, 243, 199))');
        expect(section.className).not.toContain('text-primary-foreground');
    });
    it('color de fondo de pagina claro/oscuro en center: texto calculado sobre la superficie', () => {
        render({ layout: 'center', background: { type: 'color', color: '#0f172a' }, hero: { title: 'T' } });
        const surface = q('[data-landing-layout] > div') as HTMLElement;
        expect(surface.style.backgroundColor).toBeTruthy();
        expect(surface.style.color).toBeTruthy();
    });
    it('logo con variantes claro/oscuro usa dark:hidden / hidden dark:block', () => {
        render({ logo: { light: 'https://cdn.example.com/l.png', dark: 'https://cdn.example.com/d.png', position: 'panel' } });
        const imgs = qa('img') as HTMLImageElement[];
        expect(imgs).toHaveLength(2);
        expect(imgs[0].className).toContain('dark:hidden');
        expect(imgs[1].className).toContain('dark:block');
    });
    it('el formulario no se remonta al re-renderizar (no pierde el foco/valor)', () => {
        render({});
        const input = q('#e') as HTMLInputElement;
        input.value = 'a@b.c';
        render({});
        expect(q('#e')).toBe(input);
        expect((q('#e') as HTMLInputElement).value).toBe('a@b.c');
    });
});
