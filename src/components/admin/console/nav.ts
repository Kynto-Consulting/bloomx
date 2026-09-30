import {
    Activity, Building2, FileClock, LayoutDashboard, Link2, Mail, Puzzle, ShieldCheck, UserCircle, Users, Database, ArrowLeftRight, ShieldAlert,
    type LucideIcon,
} from 'lucide-react';

/** Secciones de la consola (una sola fuente de verdad para la navegacion, el breadcrumb y la busqueda global). */
export type NavId = 'overview' | 'users' | 'accounts' | 'mail' | 'domain' | 'extensions' | 'security' | 'audit' | 'retention' | 'transfer' | 'spam' | 'profile';
export type NavGroup = 'overview' | 'people' | 'mail' | 'platform' | 'account';

export interface NavItem {
    id: NavId;
    href: string;
    icon: LucideIcon;
    group: NavGroup;
}

export const NAV_ITEMS: readonly NavItem[] = [
    { id: 'overview', href: '/admin', icon: LayoutDashboard, group: 'overview' },
    { id: 'users', href: '/admin/users', icon: Users, group: 'people' },
    { id: 'accounts', href: '/admin/accounts', icon: Link2, group: 'people' },
    { id: 'mail', href: '/admin/mail', icon: Mail, group: 'mail' },
    { id: 'domain', href: '/admin/domain', icon: Building2, group: 'platform' },
    { id: 'extensions', href: '/admin/extensions', icon: Puzzle, group: 'platform' },
    { id: 'security', href: '/admin/security', icon: ShieldCheck, group: 'platform' },
    { id: 'audit', href: '/admin/audit', icon: FileClock, group: 'platform' },
    { id: 'retention', href: '/admin/retention', icon: Database, group: 'platform' },
    { id: 'transfer', href: '/admin/transfer', icon: ArrowLeftRight, group: 'mail' },
    { id: 'spam', href: '/admin/spam', icon: ShieldAlert, group: 'mail' },
    { id: 'profile', href: '/admin/profile', icon: UserCircle, group: 'account' },
];

export const NAV_GROUP_ORDER: readonly NavGroup[] = ['overview', 'people', 'mail', 'platform', 'account'];

export function isActiveHref(pathname: string, href: string): boolean {
    if (href === '/admin') return pathname === '/admin';
    return pathname === href || pathname.startsWith(`${href}/`);
}

export function navItemFor(pathname: string): NavItem | undefined {
    // La mas especifica primero (por longitud de href).
    return [...NAV_ITEMS].sort((a, b) => b.href.length - a.href.length).find((n) => isActiveHref(pathname, n.href));
}

/** Destinos de la busqueda global que no son secciones: ajustes concretos (clave i18n bajo admin.console.shell.search.settings). */
export interface SearchTarget {
    id: string;
    href: string;
    /** Clave i18n completa. */
    labelKey: string;
    /** Palabras extra (minusculas, sin acentos) para que coincida "mfa", "2fa", "clave", "dns"... */
    keywords: string;
    icon: LucideIcon;
}

export const SEARCH_TARGETS: readonly SearchTarget[] = [
    ...NAV_ITEMS.map((n) => ({ id: `nav:${n.id}`, href: n.href, labelKey: `admin.console.shell.nav.${n.id}`, keywords: n.id, icon: n.icon })),
    { id: 's:password', href: '/admin/profile#password', labelKey: 'admin.console.shell.search.settings.password', keywords: 'contrasena password clave', icon: UserCircle },
    { id: 's:mfa', href: '/admin/profile#mfa', labelKey: 'admin.console.shell.search.settings.mfa', keywords: 'mfa 2fa totp dos pasos two-factor recuperacion recovery', icon: ShieldCheck },
    { id: 's:signing', href: '/admin/profile#signing-key', labelKey: 'admin.console.shell.search.settings.signingKey', keywords: 'firma ed25519 signing key clave publica dominio', icon: ShieldCheck },
    { id: 's:sessions', href: '/admin/profile#sessions', labelKey: 'admin.console.shell.search.settings.sessions', keywords: 'sesiones sessions cerrar logout', icon: Activity },
    { id: 's:theme', href: '/admin/domain?tab=colors', labelKey: 'admin.console.shell.search.settings.theme', keywords: 'tema theme colores colors marca brand logo', icon: Building2 },
    { id: 's:landing', href: '/admin/domain?tab=landing', labelKey: 'admin.console.shell.search.settings.landing', keywords: 'landing acceso login portada', icon: Building2 },
    { id: 's:suppression', href: '/admin/mail#suppression', labelKey: 'admin.console.shell.search.settings.suppression', keywords: 'supresion suppression rebotes bounce quejas complaints baja', icon: Mail },
    { id: 's:dns', href: '/admin/mail#dns', labelKey: 'admin.console.shell.search.settings.dns', keywords: 'dns spf dkim dmarc', icon: Mail },
    { id: 's:retention', href: '/admin/retention', labelKey: 'admin.console.shell.search.settings.retentionPolicy', keywords: 'retencion retention spam papelera trash purgar', icon: Database },
    { id: 's:transfer', href: '/admin/transfer', labelKey: 'admin.console.shell.search.settings.transfer', keywords: 'importar exportar import export mbox eml pst takeout gmail outlook thunderbird migrar backup respaldo', icon: ArrowLeftRight },
    { id: 's:spam', href: '/admin/spam', labelKey: 'admin.console.shell.search.settings.spam', keywords: 'spam antispam filtro filter bloqueados bloqueo permitidos remitentes senders blocklist allowlist externos external phishing suplantacion', icon: ShieldAlert },
    { id: 's:createUser', href: '/admin/users?create=1', labelKey: 'admin.console.shell.search.settings.createUser', keywords: 'crear usuario create user nuevo alta', icon: Users },
];

export function normalizeSearch(input: string): string {
    return input.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
