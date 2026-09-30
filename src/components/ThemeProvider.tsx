'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { useSession } from '@/components/SessionProvider';
import { useCache } from '@/contexts/CacheContext';
import {
    APPEARANCE_SETTINGS_KEY,
    DEFAULT_LIGHT_THEME,
    MAIL_DARK_STORAGE_KEY,
    THEMES,
    THEME_COOKIE,
    THEME_STORAGE_KEY,
    THEME_UPDATED_KEY,
    buildBrandCss,
    getTheme,
    isMailDarkMode,
    isThemePreference,
    resolveTheme,
    type MailDarkMode,
    type ThemeDefinition,
    type ThemePreference,
} from '@/lib/themes';

/**
 * Proveedor de temas.
 *
 *  - Estado: preferencia del usuario ('system' o id de tema) + tema resuelto.
 *  - Aplicacion: atributos data-theme / data-theme-pref / data-scheme en <html>.
 *    El primer pintado lo resuelve el script bloqueante de layout.tsx (sin FOUC);
 *    este proveedor solo mantiene el DOM sincronizado despues.
 *  - Persistencia: cookie (para SSR) + localStorage (respaldo y sync entre pestanas)
 *    + user.expansionSettings['core-appearance'] en BD (sync entre dispositivos).
 *  - Marca del dominio: si config.theme cambia respecto al SSR, se re-inyecta el CSS de marca.
 */

const CACHE_KEY_ALL = 'system:expansion-settings-full';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

interface Appearance {
    theme: ThemePreference;
    mailDarkMode: MailDarkMode;
    updatedAt: number;
}

export interface ThemeContextValue {
    /** Todos los temas disponibles (registro unico). */
    themes: readonly ThemeDefinition[];
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

function readInitialPreference(): ThemePreference {
    const attr = document.documentElement.getAttribute('data-theme-pref');
    return isThemePreference(attr) ? attr : 'system';
}

// ---------------------------------------------------------------------------
// Proveedor
// ---------------------------------------------------------------------------

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const { config, isLoading } = useDomainConfig();
    const { status } = useSession();
    const { getData, setData } = useCache();

    const [preference, setPreferenceState] = useState<ThemePreference>('system');
    const [resolvedId, setResolvedId] = useState<string>(DEFAULT_LIGHT_THEME);
    const [mailDarkMode, setMailDarkModeState] = useState<MailDarkMode>('paper');

    const prefRef = useRef<ThemePreference>('system');
    const mailRef = useRef<MailDarkMode>('paper');
    const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const serverLoadedFor = useRef<string | null>(null);

    // ---- aplicar preferencia -------------------------------------------------
    const apply = useCallback((pref: ThemePreference, animate: boolean) => {
        const resolved = resolveTheme(pref, systemPrefersDark());
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

        const initial = readInitialPreference();
        apply(initial, false);
        // Si la preferencia vive solo en localStorage (cookie borrada), restaurar cookie para el proximo SSR.
        const ls = safeGet(THEME_STORAGE_KEY);
        if (isThemePreference(ls) && ls === initial) writeCookie(initial);
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

    // ---- marca del dominio: reinyectar CSS si difiere del SSR ----------------
    useEffect(() => {
        if (isLoading || !config?.theme) return;
        const css = buildBrandCss(config.theme);
        const ssr = document.getElementById('bx-brand');
        let live = document.getElementById('bx-brand-live') as HTMLStyleElement | null;
        if (ssr && ssr.textContent === css) {
            live?.remove();
            return;
        }
        if (!live) {
            live = document.createElement('style');
            live.id = 'bx-brand-live';
            document.head.appendChild(live);
        }
        if (live.textContent !== css) live.textContent = css;
        // El fondo pudo cambiar (tema claro con neutros de marca): refrescar theme-color.
        applyToDom(resolveTheme(prefRef.current, systemPrefersDark()), prefRef.current, false);
    }, [config, isLoading]);

    useEffect(() => () => { if (syncTimer.current) clearTimeout(syncTimer.current); }, []);

    const resolvedTheme = getTheme(resolvedId) ?? lightTheme;
    const value = useMemo<ThemeContextValue>(() => ({
        themes: THEMES,
        preference,
        resolvedTheme,
        scheme: resolvedTheme.scheme,
        setPreference,
        mailDarkMode,
        setMailDarkMode,
        getAppearance,
    }), [preference, resolvedTheme, setPreference, mailDarkMode, setMailDarkMode, getAppearance]);

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
