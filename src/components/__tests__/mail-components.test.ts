// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BulkBar, SelectionBanner } from '../mail/BulkBar';
import { ReaderToolbar } from '../mail/ReaderToolbar';
import { MailRow, type MailRowProps } from '../mail/MailRow';
import { QuickFilters } from '../mail/QuickFilters';
import { MoveMenu } from '../mail/MoveMenu';
import { ShortcutsOverlay } from '../mail/ShortcutsOverlay';
import { EmptyState } from '../mail/EmptyState';
import { ViewMenu } from '../mail/ViewMenu';
import { Avatar, AVATAR_TONE_CLASSES } from '../mail/ui';
import { AttachmentList } from '../mail/AttachmentList';
import { splitQuotedHtml } from '../mail/quoted-html';
import { SHORTCUT_DEFS } from '@/lib/shortcuts';
import { DEFAULT_MAIL_PREFS } from '@/lib/mail-prefs';
import { getTranslator } from '@/lib/i18n';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom no trae ResizeObserver (lo usa Popover).
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const t = getTranslator('es').t;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = '';
});

function render(el: ReactElement) { act(() => { root.render(el); }); }
const q = (sel: string, scope: ParentNode = document) => scope.querySelector<HTMLElement>(sel);
const qa = (sel: string, scope: ParentNode = document) => Array.from(scope.querySelectorAll<HTMLElement>(sel));
const click = (el: Element | null) => { act(() => { (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const key = (el: Element | null, k: string) => { act(() => { (el as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); }); };

const bulkProps = (folders: string[], over: Record<string, unknown> = {}) => ({
    variant: 'header' as const, count: folders.length, allSelected: false, folders, allRead: false, allStarred: false,
    onSelectAll: vi.fn(), onClear: vi.fn(), onAction: vi.fn(), onMenu: vi.fn(), ...over,
});
const bulkActions = () => qa('[data-bulk-action]').map((b) => b.dataset.bulkAction);

describe('barra de acciones masivas segun la carpeta', () => {
    it('Bandeja: archivar, papelera, spam, posponer, etiquetar, mover', () => {
        render(createElement(BulkBar, bulkProps(['inbox', 'inbox'])));
        expect(bulkActions()).toEqual(expect.arrayContaining(['archive', 'trash', 'spam', 'snooze', 'label', 'move']));
        expect(bulkActions()).not.toContain('unarchive');
    });

    it('Archivo: muestra "Mover a la bandeja de entrada" (desarchivar) y NO archivar', () => {
        const props = bulkProps(['archive']);
        render(createElement(BulkBar, props));
        expect(bulkActions()).toContain('unarchive');
        expect(bulkActions()).not.toContain('archive');
        const btn = q('[data-bulk-action="unarchive"]')!;
        expect(btn.getAttribute('aria-label')).toBe(t('emailList.actions.unarchive'));
        click(btn);
        expect(props.onAction).toHaveBeenCalledWith('unarchive');
    });

    it('Papelera: Restaurar y Eliminar definitivamente', () => {
        const props = bulkProps(['trash']);
        render(createElement(BulkBar, props));
        expect(bulkActions()).toEqual(expect.arrayContaining(['restore', 'deleteForever']));
        click(q('[data-bulk-action="deleteForever"]'));
        expect(props.onAction).toHaveBeenCalledWith('deleteForever');
    });

    it('Spam: "No es spam"', () => {
        const props = bulkProps(['spam']);
        render(createElement(BulkBar, props));
        expect(bulkActions()[0]).toBe('notSpam');
        click(q('[data-bulk-action="notSpam"]'));
        expect(props.onAction).toHaveBeenCalledWith('notSpam');
    });

    it('Borradores: solo eliminar borrador', () => {
        render(createElement(BulkBar, bulkProps(['drafts'])));
        expect(bulkActions()).toEqual(['deleteDraft']);
    });

    it('mover / etiquetar / posponer abren un menu anclado al boton (no ejecutan directamente)', () => {
        const props = bulkProps(['inbox']);
        render(createElement(BulkBar, props));
        const move = q('[data-bulk-action="move"]')!;
        click(move);
        expect(props.onMenu).toHaveBeenCalledWith('move', move);
        expect(props.onAction).not.toHaveBeenCalled();
    });

    it('el contador se anuncia (role=status, aria-live) y la barra es un toolbar con nombre', () => {
        render(createElement(BulkBar, bulkProps(['inbox', 'inbox', 'inbox'])));
        const bar = q('[role="toolbar"]')!;
        expect(bar.getAttribute('aria-label')).toBe(t('emailList.bulk.toolbar'));
        const status = q('[role="status"]', bar)!;
        expect(status.getAttribute('aria-live')).toBe('polite');
        expect(status.textContent).toBe(t('emailList.selectedCount', { n: 3 }));
    });

    it('barra inferior movil: 4 acciones maximo + "Mas" con el resto', () => {
        render(createElement(BulkBar, bulkProps(['inbox'], { variant: 'bottom' })));
        expect(qa('[data-bulk-action]').length).toBe(3); // 4 huecos: 3 acciones + "Mas"
        const more = qa('button').find((b) => b.getAttribute('aria-label') === t('emailList.bulk.more'))!;
        expect(more.getAttribute('aria-haspopup')).toBe('menu');
        click(more);
        const menu = q('[role="menu"]')!;
        expect(menu).toBeTruthy();
        expect(qa('[role="menuitem"]', menu).length).toBeGreaterThan(0);
    });

    it('seleccion de toda la carpeta: aviso con el total real (sin tope)', () => {
        const onSelectWhole = vi.fn();
        render(createElement(SelectionBanner, { loadedCount: 20, wholeCount: 500, canSelectWhole: true, wholeSelected: false, loading: false, onSelectWhole, onClear: vi.fn() }));
        const btn = qa('button').find((b) => b.textContent?.includes('500'))!;
        expect(btn.textContent).toBe(t('emailList.selection.selectWhole', { n: 500 }));
        click(btn);
        expect(onSelectWhole).toHaveBeenCalled();
    });
});

describe('barra del lector segun la carpeta', () => {
    const props = (folder: string, over: Record<string, unknown> = {}) => ({
        variant: 'top' as const, folder, read: true, starred: false, hasPrev: true, hasNext: false, threadSize: 1, allExpanded: false,
        onBack: vi.fn(), onClose: vi.fn(), onPrev: vi.fn(), onNext: vi.fn(), onAction: vi.fn(), onMenu: vi.fn(),
        onToggleStar: vi.fn(), onToggleRead: vi.fn(), onPrint: vi.fn(), onToggleExpandAll: vi.fn(), ...over,
    });
    const actions = () => qa('[data-reader-action]').map((b) => b.dataset.readerAction);

    it('Archivo: desarchivar (no archivar); Papelera: restaurar y eliminar definitivamente; Spam: no es spam', () => {
        render(createElement(ReaderToolbar, props('archive')));
        expect(actions()).toContain('unarchive');
        expect(actions()).not.toContain('archive');
        render(createElement(ReaderToolbar, props('trash')));
        expect(actions()).toEqual(expect.arrayContaining(['restore', 'deleteForever']));
        render(createElement(ReaderToolbar, props('spam')));
        expect(actions()).toContain('notSpam');
    });

    it('anterior/siguiente respetan los limites y las acciones llaman al manejador', () => {
        const p = props('inbox');
        render(createElement(ReaderToolbar, p));
        expect((q('[data-reader-action="next"]') as HTMLButtonElement).disabled).toBe(true);
        expect((q('[data-reader-action="prev"]') as HTMLButtonElement).disabled).toBe(false);
        click(q('[data-reader-action="prev"]'));
        expect(p.onPrev).toHaveBeenCalled();
        click(q('[data-reader-action="archive"]'));
        expect(p.onAction).toHaveBeenCalledWith('archive');
        click(q('[data-reader-action="star"]'));
        expect(p.onToggleStar).toHaveBeenCalled();
        const move = q('[data-reader-action="move"]')!;
        click(move);
        expect(p.onMenu).toHaveBeenCalledWith('move', move);
    });

    it('"Mas": imprimir, marcar como no leido y expandir todo (con hilo)', () => {
        const p = props('inbox', { threadSize: 3 });
        render(createElement(ReaderToolbar, p));
        click(q('[data-reader-action="more"]'));
        const labels = qa('[role="menuitem"]').map((i) => i.textContent);
        expect(labels.some((l) => l?.includes(t('mailView.toolbar.print')))).toBe(true);
        expect(labels.some((l) => l?.includes(t('emailList.actions.markUnread')))).toBe(true);
        expect(labels.some((l) => l?.includes(t('mailView.thread.expandAll')))).toBe(true);
        click(qa('[role="menuitem"]').find((i) => i.textContent?.includes(t('mailView.toolbar.print')))!);
        expect(p.onPrint).toHaveBeenCalled();
    });
});

describe('fila de la bandeja', () => {
    const email = {
        id: 'e1', from: 'Ana López <ana@x.com>', subject: 'Factura', createdAt: new Date().toISOString(), read: false, starred: false,
        snippet: 'Adjunto la factura de octubre', folder: 'inbox',
    };
    const rowProps = (over: Partial<MailRowProps> = {}): MailRowProps => ({
        email, index: 0, threadCount: 1, participants: { names: ['Ana López'], extra: 0 }, attachments: { count: 0, names: [] },
        labels: [], labelsKey: '', folder: 'inbox', density: 'comfortable', snippetLines: 1, isSelected: false, isFocused: false, isOpen: false,
        swipeRight: 'archive', swipeLeft: 'trash', swipeEnabled: false,
        onFocusRow: vi.fn(), onSelect: vi.fn(), onSelectToggle: vi.fn(), onPrefetch: vi.fn(), onAction: vi.fn(), onMenu: vi.fn(), ...over,
    });
    const rowActions = () => qa('[data-row-action]').map((b) => b.dataset.rowAction);

    it('indica no leido en el nombre accesible y muestra remitente legible, asunto y vista previa', () => {
        render(createElement(MailRow, rowProps()));
        const row = q('#email-row-e1')!;
        expect(row.getAttribute('aria-label')).toContain(t('emailList.unread'));
        expect(row.textContent).toContain('Ana López');
        expect(row.textContent).toContain('Factura');
        expect(row.textContent).toContain('Adjunto la factura');
    });

    it('sin vista previa (0 lineas) no pinta el fragmento; con 2 lineas se limita a 2', () => {
        render(createElement(MailRow, rowProps({ snippetLines: 0 })));
        expect(q('#email-row-e1')!.textContent).not.toContain('Adjunto la factura');
        render(createElement(MailRow, rowProps({ snippetLines: 2 })));
        expect(q('.line-clamp-2')).toBeTruthy();
    });

    it('acciones rapidas: Bandeja = archivar / papelera / leer / posponer / etiquetar', () => {
        render(createElement(MailRow, rowProps()));
        expect(rowActions()).toEqual(['archive', 'trash', 'markRead', 'snooze', 'label']);
    });

    it('Archivo: desarchivar; Papelera: restaurar y eliminar definitivamente; Spam: no es spam; Borradores: eliminar', () => {
        render(createElement(MailRow, rowProps({ folder: 'archive' })));
        expect(rowActions()[0]).toBe('unarchive');
        expect(rowActions()).not.toContain('archive');
        render(createElement(MailRow, rowProps({ folder: 'trash' })));
        expect(rowActions()).toEqual(expect.arrayContaining(['restore', 'deleteForever']));
        render(createElement(MailRow, rowProps({ folder: 'spam' })));
        expect(rowActions()[0]).toBe('notSpam');
        render(createElement(MailRow, rowProps({ folder: 'drafts' })));
        expect(rowActions()).toEqual(['deleteDraft']);
    });

    it('una accion rapida ejecuta la accion sin abrir el correo; etiquetar/posponer abren menu', () => {
        const p = rowProps();
        render(createElement(MailRow, p));
        click(q('[data-row-action="archive"]'));
        expect(p.onAction).toHaveBeenCalledWith('archive', 'e1');
        expect(p.onSelect).not.toHaveBeenCalled();
        const label = q('[data-row-action="label"]')!;
        click(label);
        expect(p.onMenu).toHaveBeenCalledWith('label', 'e1', label);
    });

    it('las acciones rapidas son absolutas (no cambian el flujo de la fila) y accesibles por teclado', () => {
        render(createElement(MailRow, rowProps()));
        const group = q('[role="group"]')!;
        expect(group.className).toContain('absolute');
        expect(group.getAttribute('aria-label')).toBe(t('emailList.row.quickActions'));
        expect(qa('button', group).every((b) => Boolean(b.getAttribute('aria-label')))).toBe(true);
    });

    it('adjuntos: contador y nombre en el chip y en el nombre accesible; hilo con contador', () => {
        render(createElement(MailRow, rowProps({ attachments: { count: 2, names: ['factura.pdf', 'logo.png'] }, threadCount: 3, participants: { names: ['Ana', 'Luis'], extra: 1 } })));
        const row = q('#email-row-e1')!;
        expect(row.textContent).toContain('factura.pdf');
        expect(row.textContent).toContain('+1');
        expect(row.getAttribute('aria-label')).toContain('factura.pdf, logo.png');
        expect(row.getAttribute('aria-label')).toContain(t('emailList.threadMessages', { n: 3 }));
        expect(row.textContent).toContain('Ana, Luis +1');
    });

    it('destacar y seleccionar son botones con estado', () => {
        const p = rowProps({ email: { ...email, starred: true } });
        render(createElement(MailRow, p));
        const star = qa('button').find((b) => b.getAttribute('aria-pressed') === 'true')!;
        expect(star.getAttribute('aria-label')).toBe(t('emailList.row.unstar'));
        click(star);
        expect(p.onAction).toHaveBeenCalledWith('unstar', 'e1');
        const checkbox = q('[role="checkbox"]')!;
        expect(checkbox.getAttribute('aria-checked')).toBe('false');
        click(checkbox);
        expect(p.onSelectToggle).toHaveBeenCalled();
    });

    it('las capas de swipe muestran la accion de la carpeta (desarchivar en Archivo)', () => {
        render(createElement(MailRow, rowProps({ folder: 'archive', swipeRight: 'unarchive', swipeLeft: 'trash', swipeEnabled: true })));
        const text = q('#email-row-e1')!.parentElement!.textContent!;
        expect(text).toContain(t('emailList.actions.unarchive'));
        expect(text).toContain(t('emailList.actions.trash'));
    });

    it('densidad compacta: una sola linea con asunto y vista previa juntos', () => {
        render(createElement(MailRow, rowProps({ density: 'compact' })));
        const row = q('#email-row-e1')!;
        expect(row.textContent).toContain('Factura — Adjunto la factura');
    });
});

describe('filtros rapidos', () => {
    it('chips con aria-pressed y conteos; volver a pulsar el activo vuelve a "Todos"', () => {
        const onChange = vi.fn();
        const counts = { all: 10, unread: 3, starred: 1, attachments: 0, fromMe: 2 };
        render(createElement(QuickFilters, { value: 'unread', onChange, counts }));
        const chips = qa('[data-filter]');
        expect(chips.map((c) => c.dataset.filter)).toEqual(['all', 'unread', 'starred', 'attachments', 'fromMe']);
        expect(q('[data-filter="unread"]')!.getAttribute('aria-pressed')).toBe('true');
        expect(q('[data-filter="all"]')!.getAttribute('aria-pressed')).toBe('false');
        expect(q('[data-filter="unread"]')!.textContent).toContain('3');
        click(q('[data-filter="starred"]'));
        expect(onChange).toHaveBeenLastCalledWith('starred');
        click(q('[data-filter="unread"]'));
        expect(onChange).toHaveBeenLastCalledWith('all');
    });
    it('los conteos son exactos (sin "+") y un conteo aun desconocido no pinta numero', () => {
        render(createElement(QuickFilters, { value: 'all', onChange: vi.fn(), counts: { all: 20, unread: 4, starred: null } }));
        expect(q('[data-filter="unread"]')!.textContent).toContain('4');
        expect(q('[data-filter="unread"]')!.textContent).not.toContain('+');
        expect(q('[data-filter="starred"]')!.textContent).toBe(t('emailList.filters.starred'));
        expect(q('[data-filter="attachments"]')!.textContent).toBe(t('emailList.filters.attachments'));
    });
});

describe('menu Mover a...', () => {
    const labels = [{ id: 'l1', name: 'Clientes', color: null, count: 0 }, { id: 'l2', name: 'Personal', color: null, count: 0 }];
    function mount(over: Record<string, unknown> = {}) {
        const anchor = document.createElement('button');
        document.body.appendChild(anchor);
        const anchorRef = { current: anchor };
        const props = {
            open: true, onClose: vi.fn(), anchorRef, mode: 'move' as const, currentFolder: 'inbox', labels,
            labelState: (id: string) => (id === 'l1' ? 'some' as const : 'none' as const), onMove: vi.fn(), onToggleLabel: vi.fn(), ...over,
        };
        render(createElement(MoveMenu, props));
        return { props, anchor };
    }

    it('lista todas las carpetas de destino (menos la actual) y las etiquetas con estado mixto', async () => {
        mount();
        const menu = q('[role="menu"]')!;
        expect(menu.getAttribute('aria-label')).toBe(t('emailList.menu.moveTo'));
        const items = qa('[role="menuitem"]', menu).map((i) => i.textContent);
        expect(items).toEqual([t('sidebar.folders.archive'), t('sidebar.folders.spam'), t('sidebar.folders.trash')]);
        const boxes = qa('[role="menuitemcheckbox"]', menu);
        expect(boxes.map((b) => b.getAttribute('aria-checked'))).toEqual(['mixed', 'false']);
    });

    it('en Archivo aparece "Bandeja de entrada" como destino', () => {
        mount({ currentFolder: 'archive' });
        expect(qa('[role="menuitem"]').map((i) => i.textContent)).toContain(t('sidebar.folders.inbox'));
    });

    it('elegir una carpeta mueve y cierra; alternar etiqueta NO cierra', () => {
        const { props } = mount();
        click(q('[data-menu-id="folder:archive"]'));
        expect(props.onMove).toHaveBeenCalledWith('archive');
        expect(props.onClose).toHaveBeenCalledTimes(1);
        click(q('[data-menu-id="label:l2"]'));
        expect(props.onToggleLabel).toHaveBeenCalledWith(labels[1]);
        expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it('teclado: flechas recorren, Escape cierra y no llega a los atajos globales', () => {
        const { props } = mount();
        const menu = q('[role="menu"]')!;
        const items = qa('[data-menu-item]', menu);
        items[0].focus();
        key(items[0], 'ArrowDown');
        expect(document.activeElement).toBe(items[1]);
        key(items[1], 'ArrowUp');
        expect(document.activeElement).toBe(items[0]);
        key(items[0], 'End');
        expect(document.activeElement).toBe(items[items.length - 1]);
        const windowKeys = vi.fn();
        window.addEventListener('keydown', windowKeys);
        key(items[0], 'e');
        expect(windowKeys).not.toHaveBeenCalled(); // "e" (archivar) no se cuela mientras el menu esta abierto
        window.removeEventListener('keydown', windowKeys);
        key(items[0], 'Escape');
        expect(props.onClose).toHaveBeenCalled();
    });

    it('modo etiquetas: solo etiquetas', () => {
        mount({ mode: 'label' });
        expect(qa('[role="menuitem"]').length).toBe(0);
        expect(qa('[role="menuitemcheckbox"]').length).toBe(2);
    });
});

describe('menu Vista (densidad, vista previa, orden)', () => {
    it('radios con estado y cambios inmediatos', () => {
        const onChange = vi.fn();
        render(createElement(ViewMenu, { prefs: DEFAULT_MAIL_PREFS, onChange }));
        click(q('button[aria-haspopup="menu"]'));
        const radios = qa('[role="menuitemradio"]');
        expect(radios.length).toBe(3 + 3 + 3);
        expect(qa('[role="menuitemradio"][aria-checked="true"]').map((r) => r.dataset.menuId)).toEqual(['density:comfortable', 'snippet:1', 'sort:newest']);
        click(q('[data-menu-id="density:compact"]'));
        expect(onChange).toHaveBeenCalledWith({ density: 'compact' });
        click(q('[data-menu-id="snippet:2"]'));
        expect(onChange).toHaveBeenCalledWith({ snippetLines: 2 });
        click(q('[data-menu-id="group-by-date"]'));
        expect(onChange).toHaveBeenCalledWith({ groupByDate: false });
    });
});

describe('ayuda de atajos', () => {
    it('muestra la lista REAL (un elemento por cada atajo del registro)', () => {
        render(createElement(ShortcutsOverlay, { open: true, onClose: vi.fn() }));
        const dialog = q('[role="dialog"]')!;
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        const terms = qa('dt', dialog).map((d) => d.textContent);
        expect(terms.length).toBe(SHORTCUT_DEFS.length);
        for (const d of SHORTCUT_DEFS) expect(terms).toContain(t(d.labelKey));
        const kbds = qa('kbd', dialog).map((k) => k.textContent);
        for (const k of ['E', 'Z', 'V', 'J', 'K', '?', '#']) expect(kbds).toContain(k);
    });
    it('cerrado no pinta nada', () => {
        render(createElement(ShortcutsOverlay, { open: false, onClose: vi.fn() }));
        expect(q('[role="dialog"]')).toBeNull();
    });
});

describe('estados vacios por carpeta', () => {
    it('cada carpeta tiene icono y texto propios y utiles', () => {
        const seen = new Set<string>();
        for (const folder of ['inbox', 'sent', 'drafts', 'scheduled', 'archive', 'trash', 'spam']) {
            render(createElement(EmptyState, { kind: 'folder', folder }));
            const box = q('[data-empty-kind="folder"]')!;
            expect(box.querySelector('svg')).toBeTruthy();
            expect(box.textContent).toContain(t(`emailList.empty.folders.${folder}.title`));
            seen.add(box.textContent || '');
        }
        expect(seen.size).toBe(7);
    });
    it('Archivo explica como desarchivar y Papelera como restaurar', () => {
        render(createElement(EmptyState, { kind: 'folder', folder: 'archive' }));
        expect(q('[data-empty-kind]')!.textContent).toContain('Mover a la bandeja de entrada');
        render(createElement(EmptyState, { kind: 'folder', folder: 'trash' }));
        expect(q('[data-empty-kind]')!.textContent).toContain('restaurarlos');
    });
    it('error con reintento (role=alert) y filtro sin resultados con boton para quitarlo', () => {
        const onRetry = vi.fn();
        render(createElement(EmptyState, { kind: 'error', folder: 'inbox', onRetry }));
        expect(q('[role="alert"]')).toBeTruthy();
        click(q('button'));
        expect(onRetry).toHaveBeenCalled();
        const onClear = vi.fn();
        render(createElement(EmptyState, { kind: 'filter', folder: 'inbox', onClearFilter: onClear }));
        click(q('button'));
        expect(onClear).toHaveBeenCalled();
    });
});

describe('avatar', () => {
    it('iniciales y color del par de tokens del tema (legible en cualquier paleta)', () => {
        render(createElement(Avatar, { from: 'Ana López <ana@x.com>' }));
        const el = q('[data-avatar-tone]')!;
        expect(el.textContent).toBe('AL');
        expect(el.getAttribute('aria-hidden')).toBe('true');
        const cls = AVATAR_TONE_CLASSES[Number(el.dataset.avatarTone)];
        for (const c of cls.split(' ').filter((x) => x.startsWith('bg-') || x.startsWith('text-'))) expect(el.className).toContain(c);
        // Cada par usa un token de fondo Y su *-foreground (la pareja con contraste garantizado por el contrato de temas).
        for (const tone of AVATAR_TONE_CLASSES) {
            const bg = tone.match(/bg-([a-z-]+)/)![1];
            expect(tone).toContain(`text-${bg}-foreground`);
        }
    });
});

describe('adjuntos del lector', () => {
    const atts = [
        { id: 'a1', filename: 'foto.png', mimeType: 'image/png', size: 2048, url: 'https://x.test/a1' },
        { id: 'a2', filename: 'informe.pdf', mimeType: 'application/pdf', size: 1536 * 1024, url: 'https://x.test/a2' },
        { id: 'a3', filename: 'datos.xlsx', mimeType: 'application/octet-stream', size: 100, url: 'https://x.test/a3' },
    ];
    it('icono por tipo, tamano y descarga; vista previa solo para imagen y PDF', () => {
        render(createElement(AttachmentList, { attachments: atts }));
        const items = qa('[data-attachment-kind]');
        expect(items.map((i) => i.dataset.attachmentKind)).toEqual(['image', 'pdf', 'sheet']);
        expect(items[1].textContent).toContain('1,5 MB');
        const downloads = qa('a[download]');
        expect(downloads.map((a) => a.getAttribute('href'))).toEqual(['https://x.test/a1', 'https://x.test/a2', 'https://x.test/a3']);
        const previews = qa('button[aria-label^="Vista previa"]');
        expect(previews.length).toBe(2);
    });
    it('la vista previa de una imagen abre un dialogo con la imagen y se cierra', () => {
        render(createElement(AttachmentList, { attachments: atts }));
        click(qa('button[aria-label^="Vista previa"]')[0]);
        const dialog = q('[role="dialog"]')!;
        expect(dialog).toBeTruthy();
        expect(dialog.querySelector('img')!.getAttribute('src')).toBe('https://x.test/a1');
        click(qa('button', dialog).find((b) => b.getAttribute('aria-label') === t('common.close'))!);
        expect(q('[role="dialog"]')).toBeNull();
    });
});

describe('texto citado', () => {
    it('separa el bloque citado de Gmail (con su linea de autoria) y deja lo nuevo', () => {
        const html = '<div>Gracias, lo reviso hoy.</div><div class="gmail_quote"><div class="gmail_attr">El lun, Ana escribió:</div><blockquote>Texto original largo</blockquote></div>';
        const split = splitQuotedHtml(html)!;
        expect(split.blocks).toBe(1);
        expect(split.main).toContain('Gracias, lo reviso hoy.');
        expect(split.main).not.toContain('Texto original');
        expect(split.main).not.toContain('gmail_quote');
    });
    it('blockquote[type=cite] y blockquote final tambien se pliegan; sin cita devuelve null', () => {
        expect(splitQuotedHtml('<p>Respuesta nueva larga</p><blockquote type="cite">viejo</blockquote>')!.main).not.toContain('viejo');
        expect(splitQuotedHtml('<p>Hola, esto es un correo sin ninguna cita dentro.</p>')).toBeNull();
        expect(splitQuotedHtml('<p>Respuesta nueva larga</p><blockquote>viejo</blockquote>')!.main).not.toContain('viejo');
    });
    it('si todo el correo es cita no se pliega nada', () => {
        expect(splitQuotedHtml('<div class="gmail_quote"><blockquote>solo cita de otro mensaje</blockquote></div>')).toBeNull();
    });
    it('la autoria con el texto "escribio:" tambien se retira', () => {
        const split = splitQuotedHtml('<p>Nueva respuesta larga</p><p>El 3 de enero, Luis escribió:</p><blockquote>viejo</blockquote>')!;
        expect(split.main).not.toContain('escribió');
    });
});

