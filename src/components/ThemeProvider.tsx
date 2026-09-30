'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { useSession } from '@/components/SessionProvider';
import { useCache } from '@/contexts/CacheContext';
import {
    APPEARANCE_SETTINGS_KEY,
    DEFAULT_LIGHT_THEME,
    DEFAULT_THEME_POLICY,
    MAIL_DARK_STORAGE_KEY,
    THEMES,
    THEME_COOKIE,
    THEME_STORAGE_KEY,
    THEME_UPDATED_KEY,
    getAvailableThemeIds,
    getTheme,
    getThemePolicy,
    isMailDarkMode,
    isThemePreference,
    resolvePreference,
    resolveThemeId,
    type MailDarkMode,
    type ThemeDefinition,
    type ThemePolicy,
    type ThemePreference,
} from '@/lib/themes';
import { buildBrandCss, buildBrandThemes, getSelectableThemes, getThemeOverride, type BrandThemes } from '@/lib/brand-theme';
import { sanitizeThemeConfig, type DomainThemeConfig } from '@/lib/theme-config';

/**
 * Proveedor de temas.
 *
 *  - Estado: preferencia del usuario ('system' o id de tema) + tema resuelto.
 *  - Aplicacion: atributos data-theme / data-theme-pref / data-scheme en <html>.
 *    El primer pintado lo resuelve el script bloqueante de layout.tsx (sin FOUC);
 *    este proveedor solo mantiene el DOM sincronizado despues.
 *  - Persistencia: cookie (para SSR) + localStorage (respaldo y sync entre pestanas)
 *    + user.expansionSettings['core-appearance'] en BD (sync entre dispositivos).
 *  - Marca del dominio: config.theme se sanea y genera brand-light / brand-dark (brand-theme.ts). Si difiere del SSR
 *    se re-inyecta el CSS. La politica de la empresa (defaultMode / allowedThemes / lockBrand) decide que temas se
 *    ofrecen y cual se usa cuando el usuario aun no eligio (resolvePreference).
 */

const CACHE_KEY_ALL = 'system:expansion-settings-full';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

interface Appearance {
    theme: ThemePreference;
    mailDarkMode: MailDarkMode;
    updatedAt: number;
}

export interface ThemeContextValue {
    /** Temas ELEGIBLES en orden: los de la empresa primero (brand-light / brand-dark) y despues los genericos permitidos. */
    themes: readonly ThemeDefinition[];
    /** Temas de empresa generados (null si la empresa no define colores) con sus avisos de contraste. */
    brandThemes: BrandThemes | null;
    /** Politica vigente (defaultMode / allowedThemes / lockBrand). */
    policy: ThemePolicy;
    /** Lo que eligio el usuario: 'system' o un id de tema. */
    preference: ThemePreference;
    /** Tema realmente aplicado (resuelve 'system'). */
    resolvedTheme: ThemeDefinition;
    scheme: 'light' | 'dark';
    setPreference: (pref: ThemePreference) => void;
    /** Como se muestran los correos HTML cuando el tema es oscuro. */
    mailDarkMode: MailDarkMode;
    setMailDarkMode: (mode: MailDarkMode) => void;
    /** Snapshot para guardar en expansionSettings desde otros formularios (SettingsModal). */
    getAppearance: () => Appearance;
}

const lightTheme = getTheme(DEFAULT_LIGHT_THEME)!;

const ThemeContext = createContext<ThemeContextValue>({
    themes: THEMES,
    brandThemes: null,
    policy: DEFAULT_THEME_POLICY,
    preference: 'system',
    resolvedTheme: lightTheme,
    scheme: 'light',
    setPreference: () => { },
    mailDarkMode: 'paper',
    setMailDarkMode: () => { },
    getAppearance: () => ({ theme: 'system', mailDarkMode: 'paper', updatedAt: 0 }),
});

export const useTheme = () => useContext(ThemeContext);

// ---------------------------------------------------------------------------
// Helpers de bajo nivel (DOM / storage). Todo protegido: storage puede lanzar.
// ---------------------------------------------------------------------------

function safeGet(key: string): string | null {
    try { return window.localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string) {
    try { window.localStorage.setItem(key, value); } catch { /* modo privado / cuota */ }
}
function systemPrefersDark(): boolean {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function writeCookie(pref: ThemePreference) {
    document.cookie = `${THEME_COOKIE}=${encodeURIComponent(pref)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

function applyToDom(theme: ThemeDefinition, pref: ThemePreference, animate: boolean) {
    const root = document.documentElement;
    if (animate) {
        root.classList.add('theme-transition');
        window.setTimeout(() => root.classList.remove('theme-transition'), 250);
    }
    root.setAttribute('data-theme', theme.id);
    root.setAttribute('data-theme-pref', pref);
    root.setAttribute('data-scheme', theme.scheme);
    root.style.colorScheme = theme.scheme;

    // Barra del navegador / PWA: sigue el fondo del tema activo.
    const bg = getComputedStyle(root).getPropertyValue('--color-background').trim();
    if (bg) {
        let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'theme-color';
            document.head.appendChild(meta);
        }
        meta.content = bg;
    }
}

/** Preferencia guardada por el usuario (cookie -> localStorage) o null si nunca eligio. */
function readStoredPreference(): ThemePreference | null {
    const m = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`));
    let v: string | null = null;
    if (m) { try { v = decodeURIComponent(m[1]); } catch { v = null; } }
    if (!v) v = safeGet(THEME_STORAGE_KEY);
    return isThemePreference(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Proveedor
// ---------------------------------------------------------------------------

interface ThemeProviderProps {
    children: React.ReactNode;
    /** Tema de empresa saneado que ya uso el servidor (evita saltos mientras /api/config carga en el cliente). */
    initialThemeConfig?: DomainThemeConfig | null;
    /** Nombre de la empresa (etiqueta de los temas brand-*). */
    brandName?: string;
}

export function ThemeProvider({ children, initialThemeConfig = null, brandName }: ThemeProviderProps) {
    const { config, isLoading } = useDomainConfig();
    const { status } = useSession();
    const { getData, setData } = useCache();

    // Configuracion de tema efectiva: la del servidor mientras carga /api/config; despues la del cliente (saneada).
    const themeCfg = useMemo<DomainThemeConfig | null>(
        () => getThemeOverride() ?? (isLoading || !config ? initialThemeConfig : sanitizeThemeConfig((config as { theme?: unknown }).theme)),
        [isLoading, config, initialThemeConfig],
    );
    const displayName = (!isLoading && config ? ((config as { displayName?: string; name?: string }).displayName || (config as { name?: string }).name) : '') || brandName || '';
    const policy = useMemo(() => getThemePolicy(themeCfg), [themeCfg]);
    const brandThemes = useMemo(() => buildBrandThemes(themeCfg, { name: displayName }), [themeCfg, displayName]);
    const selectable = useMemo(() => getSelectableThemes(brandThemes, policy), [brandThemes, policy]);
    const policyRef = useRef<ThemePolicy>(policy);
    const brandRef = useRef<BrandThemes | null>(brandThemes);
    policyRef.current = policy;
    brandRef.current = brandThemes;

    const [preference, setPreferenceState] = useState<ThemePreference>('system');
    const [resolvedId, setResolvedId] = useState<string>(DEFAULT_LIGHT_THEME);
    const [mailDarkMode, setMailDarkModeState] = useState<MailDarkMode>('paper');

    const prefRef = useRef<ThemePreference>('system');
    const mailRef = useRef<MailDarkMode>('paper');
    const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const serverLoadedFor = useRef<string | null>(null);

    // ---- aplicar preferencia -------------------------------------------------
    /** `raw` = lo que guardo el usuario (o null): se pasa por la politica vigente antes de aplicarse. */
    const apply = useCallback((raw: ThemePreference | null, animate: boolean) => {
        const pol = policyRef.current;
        const pref = resolvePreference(raw, pol);
        const id = resolveThemeId(pref, systemPrefersDark(), pol);
        const brand = brandRef.current;
        const resolved = (id === 'brand-light' ? brand?.light : id === 'brand-dark' ? brand?.dark : getTheme(id)) ?? getTheme(DEFAULT_LIGHT_THEME)!;
        prefRef.current = pref;
        setPreferenceState(pref);
        setResolvedId(resolved.id);
        applyToDom(resolved, pref, animate);
    }, []);

    // ---- sync con BD ---------------------------------------------------------
    const pushToServer = useCallback(async () => {
        try {
            const res = await fetch('/api/settings', { cache: 'no-store' });
            if (!res.ok) return; // no autenticado / error: la preferencia local sigue valiendo
            const json = await res.json();
            const current = json.expansionSettings || {};
            const appearance: Appearance = {
                theme: prefRef.current,
                mailDarkMode: mailRef.current,
                updatedAt: Number(safeGet(THEME_UPDATED_KEY)) || Date.now(),
            };
            const merged = { ...current, [APPEARANCE_SETTINGS_KEY]: appearance };
            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ expansionSettings: merged }),
            });
            // Mantiene coherente la cache que usa useExpansionSettings (evita que sobrescriba con datos viejos).
            await setData(CACHE_KEY_ALL, merged, { silent: true });
        } catch (e) {
            console.warn('[theme] no se pudo sincronizar la apariencia con el servidor', e);
        }
    }, [setData]);

    const schedulePush = useCallback(() => {
        if (status !== 'authenticated') return;
        if (syncTimer.current) clearTimeout(syncTimer.current);
        syncTimer.current = setTimeout(() => { void pushToServer(); }, 600);
    }, [status, pushToServer]);

    // ---- setters publicos ----------------------------------------------------
    const setPreference = useCallback((pref: ThemePreference) => {
        if (!isThemePreference(pref)) return;
        if (pref !== 'system' && !getAvailableThemeIds(policyRef.current).includes(pref)) return;
        writeCookie(pref);
        safeSet(THEME_STORAGE_KEY, pref);
        safeSet(THEME_UPDATED_KEY, String(Date.now()));
        apply(pref, true);
        schedulePush();
    }, [apply, schedulePush]);

    const setMailDarkMode = useCallback((mode: MailDarkMode) => {
        if (!isMailDarkMode(mode)) return;
        mailRef.current = mode;
        setMailDarkModeState(mode);
        safeSet(MAIL_DARK_STORAGE_KEY, mode);
        safeSet(THEME_UPDATED_KEY, String(Date.now()));
        schedulePush();
    }, [schedulePush]);

    const getAppearance = useCallback((): Appearance => ({
        theme: prefRef.current,
        mailDarkMode: mailRef.current,
        updatedAt: Number(safeGet(THEME_UPDATED_KEY)) || Date.now(),
    }), []);

    // ---- init desde DOM/localStorage (el script bloqueante ya pinto el tema) --
    useEffect(() => {
        const stored = safeGet(MAIL_DARK_STORAGE_KEY);
        if (isMailDarkMode(stored)) { mailRef.current = stored; setMailDarkModeState(stored); }

        const storedPref = readStoredPreference();
        apply(storedPref, false);
        // Si la preferencia vive solo en localStorage (cookie borrada), restaurar cookie para el proximo SSR.
        const ls = safeGet(THEME_STORAGE_KEY);
        if (isThemePreference(ls) && ls === storedPref) writeCookie(ls);
    }, [apply]);

    // ---- seguir cambios del SO cuando la preferencia es "system" -------------
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => { if (prefRef.current === 'system') apply('system', true); };
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, [apply]);

    // ---- sync entre pestanas -------------------------------------------------
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === THEME_STORAGE_KEY && isThemePreference(e.newValue)) {
                writeCookie(e.newValue);
                apply(e.newValue, true);
            }
            if (e.key === MAIL_DARK_STORAGE_KEY && isMailDarkMode(e.newValue)) {
                mailRef.current = e.newValue;
                setMailDarkModeState(e.newValue);
            }
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [apply]);

    // ---- cargar apariencia guardada en BD (otro dispositivo) -----------------
    useEffect(() => {
        if (status !== 'authenticated') return;
        if (serverLoadedFor.current === 'done') return;
        serverLoadedFor.current = 'done';
        let cancelled = false;
        (async () => {
            try {
                let full = await getData<any>(CACHE_KEY_ALL);
                if (!full || !full[APPEARANCE_SETTINGS_KEY]) {
                    const res = await fetch('/api/settings', { cache: 'no-store' });
                    if (!res.ok) return;
                    const json = await res.json();
                    full = json.expansionSettings || {};
                    await setData(CACHE_KEY_ALL, full, { silent: true });
                }
                const remote = full?.[APPEARANCE_SETTINGS_KEY] as Partial<Appearance> | undefined;
                if (cancelled || !remote) return;

                const localUpdated = Number(safeGet(THEME_UPDATED_KEY)) || 0;
                const remoteUpdated = Number(remote.updatedAt) || 0;
                // Gana el cambio mas reciente; si el local nunca se toco, gana el remoto.
                if (remoteUpdated > localUpdated) {
                    if (isThemePreference(remote.theme)) {
                        writeCookie(remote.theme);
                        safeSet(THEME_STORAGE_KEY, remote.theme);
                        apply(remote.theme, true);
                    }
                    if (isMailDarkMode(remote.mailDarkMode)) {
                        mailRef.current = remote.mailDarkMode;
                        setMailDarkModeState(remote.mailDarkMode);
                        safeSet(MAIL_DARK_STORAGE_KEY, remote.mailDarkMode);
                    }
                    safeSet(THEME_UPDATED_KEY, String(remoteUpdated));
                }
            } catch (e) {
                console.warn('[theme] no se pudo leer la apariencia guardada', e);
            }
        })();
        return () => { cancelled = true; };
    }, [status, getData, setData, apply]);

    // ---- marca del dominio: reinyectar CSS si difiere del SSR y re-resolver el tema -------
    useEffect(() => {
        if (isLoading) return;
        const css = buildBrandCss(themeCfg, { name: displayName });
        const ssr = document.getElementById('bx-brand') as HTMLStyleElement | null;
        let live = document.getElementById('bx-brand-live') as HTMLStyleElement | null;
        if ((ssr?.textContent ?? '') === css) {
            live?.remove();
            if (ssr) ssr.media = '';
        } else {
            // El CSS de la empresa cambio respecto al SSR (o la empresa ya no define marca): el SSR se desactiva y manda el vivo.
            if (ssr) ssr.media = 'not all';
            if (!live) {
                live = document.createElement('style');
                live.id = 'bx-brand-live';
                document.head.appendChild(live);
            }
            if (live.textContent !== css) live.textContent = css;
        }
        // La politica pudo cambiar (defaultMode / allowedThemes / lockBrand / marca): re-resolver desde lo guardado.
        apply(readStoredPreference(), false);
    }, [themeCfg, displayName, isLoading, apply]);

    useEffect(() => () => { if (syncTimer.current) clearTimeout(syncTimer.current); }, []);

    const resolvedTheme = (resolvedId === 'brand-light' ? brandThemes?.light : resolvedId === 'brand-dark' ? brandThemes?.dark : getTheme(resolvedId)) ?? lightTheme;
    const value = useMemo<ThemeContextValue>(() => ({
        themes: selectable,
        brandThemes,
        policy,
        preference,
        resolvedTheme,
        scheme: resolvedTheme.scheme,
        setPreference,
        mailDarkMode,
        setMailDarkMode,
        getAppearance,
    }), [selectable, brandThemes, policy, preference, resolvedTheme, setPreference, mailDarkMode, setMailDarkMode, getAppearance]);

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
