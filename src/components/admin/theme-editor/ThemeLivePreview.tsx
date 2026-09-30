'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Monitor, Moon, Smartphone, Sun, Tablet } from 'lucide-react';
import type { DomainThemeConfig, ThemeMode } from '@/lib/theme-config';
import { useI18n } from '@/components/I18nProvider';
import { ComposeMock, DialogMock, InboxMock, UiKitMock } from './mockups';
import { previewCssVars } from './preview-style';
import { Segmented } from './ui';

export type PreviewDevice = 'desktop' | 'tablet' | 'mobile';
export type PreviewScene = 'inbox' | 'compose' | 'dialog' | 'ui';

/** Tamano logico de cada dispositivo; el marco se escala para caber en el panel. */
export const THEME_PREVIEW_DEVICES: Record<PreviewDevice, { width: number; height: number }> = {
    desktop: { width: 1040, height: 620 },
    tablet: { width: 768, height: 640 },
    mobile: { width: 390, height: 680 },
};

interface Props {
    theme: DomainThemeConfig;
    name: string;
    logo?: string;
    mode: ThemeMode;
    onModeChange: (m: ThemeMode) => void;
    device?: PreviewDevice;
    onDeviceChange?: (d: PreviewDevice) => void;
    scene?: PreviewScene;
    onSceneChange?: (s: PreviewScene) => void;
    className?: string;
}

/**
 * Vista previa FIEL del tema: maquetas de la app (bandeja, lector, redactar, modal, componentes) dentro de un
 * contenedor aislado al que se aplican las variables CSS del tema elegido (mismos tokens y clases que la app).
 */
export function ThemeLivePreview({ theme, name, logo, mode, onModeChange, device: deviceProp, onDeviceChange, scene: sceneProp, onSceneChange, className }: Props) {
    const { t } = useI18n();
    const uid = useId();
    const [deviceState, setDevice] = useState<PreviewDevice>('desktop');
    const [sceneState, setScene] = useState<PreviewScene>('inbox');
    const device = deviceProp ?? deviceState;
    const scene = sceneProp ?? sceneState;
    const dims = THEME_PREVIEW_DEVICES[device];

    const style = useMemo(() => previewCssVars(mode, theme, name), [mode, theme, name]);

    const outerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);
    useEffect(() => {
        const el = outerRef.current;
        if (!el) return;
        const measure = () => setScale(Math.min(1, el.clientWidth / dims.width) || 1);
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [dims.width]);

    const mockProps = { t, name, logo, compact: device === 'mobile' };
    return (
        <div className={className} data-testid="theme-live-preview">
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <Segmented<PreviewDevice>
                    label={t('themeEditor.device.label')}
                    value={device}
                    onChange={(d) => { setDevice(d); onDeviceChange?.(d); }}
                    options={[
                        { id: 'desktop', label: t('themeEditor.device.desktop'), icon: <Monitor className="h-4 w-4" aria-hidden="true" /> },
                        { id: 'tablet', label: t('themeEditor.device.tablet'), icon: <Tablet className="h-4 w-4" aria-hidden="true" /> },
                        { id: 'mobile', label: t('themeEditor.device.mobile'), icon: <Smartphone className="h-4 w-4" aria-hidden="true" /> },
                    ]}
                />
                <Segmented<ThemeMode>
                    label={t('themeEditor.mode.label')}
                    value={mode}
                    onChange={onModeChange}
                    options={[
                        { id: 'light', label: t('themeEditor.mode.light'), icon: <Sun className="h-4 w-4" aria-hidden="true" /> },
                        { id: 'dark', label: t('themeEditor.mode.dark'), icon: <Moon className="h-4 w-4" aria-hidden="true" /> },
                    ]}
                />
                <Segmented<PreviewScene>
                    label={t('themeEditor.scene.label')}
                    value={scene}
                    onChange={(s) => { setScene(s); onSceneChange?.(s); }}
                    options={(['inbox', 'compose', 'dialog', 'ui'] as const).map((s) => ({ id: s, label: t(`themeEditor.scene.${s}`) }))}
                />
            </div>
            <div ref={outerRef} className="w-full overflow-hidden rounded-lg border border-border bg-muted" style={{ height: dims.height * scale }}>
                <div
                    role="group"
                    aria-label={t('themeEditor.preview.frame', { mode: t(`themeEditor.mode.${mode}`) })}
                    aria-describedby={`${uid}-note`}
                    data-scheme={mode}
                    data-preview-device={device}
                    data-preview-scene={scene}
                    style={{
                        ...style,
                        width: dims.width,
                        height: dims.height,
                        transform: `scale(${scale})`,
                        transformOrigin: 'top left',
                        backgroundColor: 'var(--color-background)',
                        color: 'var(--color-foreground)',
                        fontFamily: 'var(--font-body)',
                        overflow: 'hidden',
                    }}
                    className="text-foreground"
                    inert
                >
                    {scene === 'inbox' && <InboxMock {...mockProps} />}
                    {scene === 'compose' && <ComposeMock {...mockProps} />}
                    {scene === 'dialog' && <DialogMock {...mockProps} />}
                    {scene === 'ui' && <UiKitMock {...mockProps} />}
                </div>
            </div>
            <p id={`${uid}-note`} className="mt-2 text-xs text-muted-foreground">{t('themeEditor.preview.note')}</p>
        </div>
    );
}
