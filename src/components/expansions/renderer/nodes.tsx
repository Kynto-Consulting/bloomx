'use client';

import React, { useContext, useEffect, useState } from 'react';
import { coerceProps } from '@/lib/expansions/ui-schema';
import { safeImageSrc } from '@/lib/expansions/safe-url';
import { toBackendContext } from '@/lib/expansions/context';
import { Stack, Row, Grid, Card, Section, Divider, Spacer } from '../kit/Layout';
import { Text, Heading, Code, Link, Markdown, IconGlyph } from '../kit/Typography';
import { Button, IconButton, ButtonGroup, Menu, type KitA11y } from '../kit/Actions';
import { Badge, Chip, Avatar, Stat, Progress, Skeleton, Empty, Alert, Callout, Spinner } from '../kit/Feedback';
import { BarChart, Sparkline, Donut } from '../kit/Charts';
import { Dialog, ModalFrame, DrawerPanel, KitPopover, Tooltip } from '../kit/Overlays';
import { Table, List, ListItem } from '../kit/Data';
import { Tabs, Accordion, Wizard } from '../kit/Navigation';
import { ExtensionErrorState } from '../kit/ExtensionError';
import { FOCUS_RING_CLASS } from '../kit/tokens';
import { ToolbarIconButton, ToolbarMenuRow, glyphFor } from '../toolbar/ToolbarButtons';
import { primaryLoadingKey, type ActionRunner } from './actions';
import { ExtensionStateContext, WizardContext, getPath, useExtensionState, type WizardContextType } from './state';
import { FieldNode, FIELD_TYPES, FormNode } from './forms';

/** Entorno que InnerJsonRenderer entrega a cada nodo (estado, acciones, recursion). */
export interface NodeEnv {
    context: Record<string, any>;
    state: Record<string, any>;
    setState: (key: string, value: any) => void;
    run: ActionRunner;
    /** Renderiza una lista de nodos (o uno solo) con el contexto dado (por defecto el del nodo). */
    renderChildren: (list: any, ctx?: Record<string, any>) => React.ReactNode;
    renderNode: (node: any, ctx?: Record<string, any>) => React.ReactNode;
}

export interface KitNodeProps {
    type: string;
    /** Props sin resolver (contienen las acciones y las plantillas). */
    raw: Record<string, any>;
    /** Props con `${...}` ya resueltas. */
    resolved: Record<string, any>;
    children?: any[];
    env: NodeEnv;
}

export const asList = (value: unknown): any[] => (Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []);
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined);

// ------------------------------------------------------------------ piezas con estado propio
function SetVar({ name, value }: { name?: string; value: any }) {
    const { getState, setState } = useExtensionState();
    useEffect(() => {
        if (name && value !== undefined && getPath(getState(), name) !== value) setState(name, value);
    }, [name, value, getState, setState]);
    return null;
}

function WizardNode({ raw, r, env }: { raw: Record<string, any>; r: Record<string, any>; env: NodeEnv }) {
    const [step, setStep] = useState(0);
    const rawSteps = asList(raw.steps);
    const total = rawSteps.length;
    const wizard: WizardContextType = {
        step,
        total,
        next: () => setStep((current) => Math.min(current + 1, Math.max(total - 1, 0))),
        prev: () => setStep((current) => Math.max(current - 1, 0)),
    };
    const steps = rawSteps.map((rawStep, i) => ({
        title: text(r.steps?.[i]?.title) ?? text(rawStep?.title),
        description: text(r.steps?.[i]?.description),
        content: env.renderChildren(asList(rawStep?.content)),
    }));
    return (
        <WizardContext.Provider value={wizard}>
            <Wizard
                steps={steps}
                step={Math.min(step, Math.max(total - 1, 0))}
                onStepChange={setStep}
                nav={r.nav}
                backLabel={text(r.backLabel)}
                nextLabel={text(r.nextLabel)}
                finishLabel={text(r.finishLabel)}
                onFinish={raw.onFinish ? () => { void env.run(raw.onFinish, null); } : undefined}
            />
        </WizardContext.Provider>
    );
}

function ButtonNode({ r, raw, env, a11y, onPressExtra, forceLoading }: { r: Record<string, any>; raw: Record<string, any>; env: NodeEnv; a11y?: KitA11y; onPressExtra?: () => void; forceLoading?: boolean }) {
    const mode = env.context?.toolbarButtonMode as 'compact' | 'menu' | undefined;
    const key = primaryLoadingKey(raw.onClick);
    // El boton muestra solo su estado de carga (y se bloquea) mientras su CALL_BACKEND/CALL_API esta en curso.
    const loading = forceLoading ?? (r.loading !== undefined ? Boolean(r.loading) : key ? Boolean(getPath(env.state, `$loading.${key}`)) : false);
    const label = text(r.label) ?? 'Action';
    const onPress = () => { onPressExtra?.(); if (raw.onClick) void env.run(raw.onClick, null); };
    // Barras de acciones (EMAIL/COMPOSER/CALENDAR/CONTACTS_TOOLBAR): presentacion compacta unica, sin tono primario (ver toolbar/).
    if (mode === 'compact' || mode === 'menu') {
        const meta = (env.context?.toolbarMeta ?? {}) as { label?: string; description?: string; extensionIcon?: string; dot?: boolean };
        const shown = meta.label || label;
        const glyph = glyphFor(text(r.icon) || meta.extensionIcon, shown);
        if (mode === 'menu') return <ToolbarMenuRow label={shown} description={meta.description} glyph={glyph} loading={loading} disabled={r.disabled} onPress={onPress} />;
        return <ToolbarIconButton label={shown} hint={meta.description} glyph={glyph} loading={loading} disabled={r.disabled} dot={meta.dot} onPress={onPress} a11y={a11y} />;
    }
    return (
        <Button
            label={label}
            icon={text(r.icon)}
            iconPosition={r.iconPosition}
            tone={r.tone}
            variant={r.variant}
            size={r.size}
            fullWidth={r.fullWidth}
            align={r.align}
            loading={loading}
            disabled={r.disabled}
            submit={r.submit}
            showLabel={r.showLabel}
            onPress={onPress}
            a11y={a11y}
        />
    );
}

/** Disparador de un POPOVER: el kit le inyecta `onPress` y `a11y` (clonado). */
function PopoverTrigger({ node, env, ctx, onPress, a11y }: { node: any; env: NodeEnv; ctx: Record<string, any>; onPress?: () => void; a11y?: KitA11y }) {
    const { state } = useContext(ExtensionStateContext);
    if (node?.type === 'BUTTON' || node?.type === 'ICON_BUTTON') {
        const props = node.props ?? {};
        if (node.type === 'ICON_BUTTON') return <IconButton icon={text(props.icon)} label={text(props.label) ?? 'Menu'} tone={props.tone} variant={props.variant} size={props.size} onPress={onPress} a11y={a11y} />;
        return <ButtonNode r={props} raw={props} env={{ ...env, context: ctx, state }} a11y={a11y} onPressExtra={onPress} />;
    }
    return <Button label={text(node?.props?.label) ?? '...'} variant="outline" onPress={onPress} a11y={a11y} />;
}

function ImageButton({ r, raw, env }: { r: Record<string, any>; raw: Record<string, any>; env: NodeEnv }) {
    const src = safeImageSrc(r.src);
    if (!src) return null;
    return (
        <button
            type="button"
            onClick={() => { if (raw.onClick) void env.run(raw.onClick, null); }}
            className={`block w-full overflow-hidden rounded-md transition-opacity hover:opacity-80 ${FOCUS_RING_CLASS}`}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={text(r.alt) ?? ''} className="h-auto w-full object-cover" />
        </button>
    );
}

function DebugNode({ r, env }: { r: Record<string, any>; env: NodeEnv }) {
    // Solo desarrollo: el contexto puede contener el correo abierto.
    if (process.env.NODE_ENV === 'production') return null;
    return (
        <details className="max-h-40 overflow-auto rounded-md border border-border bg-muted p-2 text-xs text-foreground">
            <summary className="cursor-pointer font-semibold text-muted-foreground">Debug</summary>
            <pre>{JSON.stringify({ context: toBackendContext(env.context), state: env.state, props: r }, null, 2)}</pre>
        </details>
    );
}

function chartData(value: unknown): Array<{ label?: string; value?: number; tone?: any }> {
    return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
}

// ------------------------------------------------------------------ despachador
export function KitNode({ type, raw, resolved, children, env }: KitNodeProps): React.ReactElement | null {
    const r = coerceProps(type, resolved);
    if (r.hidden) return null;
    const ctx = env.context;
    const kids = () => env.renderChildren(children);
    const press = (def: any, extra?: Record<string, any>) => (def ? () => { void env.run(def, null, extra); } : undefined);

    if (FIELD_TYPES.has(type)) return <FieldNode type={type} raw={raw} r={r} env={env} />;
    if (type === 'FORM') return <FormNode raw={raw} r={r} env={env} children={children} />;

    switch (type) {
        // --- layout
        case 'STACK': return <Stack gap={r.gap} align={r.align} justify={r.justify} wrap={r.wrap} padding={r.padding} fullWidth={r.fullWidth}>{kids()}</Stack>;
        case 'ROW': return <Row gap={r.gap} align={r.align} justify={r.justify} wrap={r.wrap} padding={r.padding}>{kids()}</Row>;
        case 'GRID': return <Grid columns={r.columns} gap={r.gap} maxHeight={r.maxHeight}>{kids()}</Grid>;
        case 'CARD':
            return (
                <Card title={text(r.title)} description={text(r.description)} icon={text(r.icon)} tone={r.tone} variant={r.variant} density={r.density} footer={raw.footer ? env.renderChildren(asList(raw.footer)) : undefined}>
                    {kids()}
                </Card>
            );
        case 'SECTION': return <Section title={text(r.title)} description={text(r.description)} collapsible={r.collapsible} defaultOpen={r.defaultOpen} gap={r.gap}>{kids()}</Section>;
        case 'DIVIDER': return <Divider label={text(r.label)} orientation={r.orientation} spacing={r.spacing} />;
        case 'SPACER': return <Spacer size={r.size} />;

        // --- tipografia
        case 'TEXT': return <Text content={text(resolved.content)} variant={r.variant} tone={r.tone} size={r.size} weight={r.weight} align={r.align} truncate={r.truncate} lines={r.lines} mono={r.mono}>{children?.length ? kids() : undefined}</Text>;
        case 'HEADING': return <Heading content={text(resolved.content)} level={r.level} size={r.size} tone={r.tone} align={r.align} />;
        case 'CODE': return <Code content={text(r.content) ?? text(r.code)} block={r.block} copyable={r.copyable} language={r.language} />;
        case 'LINK': return <Link label={text(r.label)} url={text(r.url)} tone={r.tone} onPress={press(raw.onClick)} />;
        case 'MARKDOWN': return <Markdown content={text(resolved.content)} size={r.size} />;
        case 'ICON': return <IconGlyph name={text(r.name)} size={r.size} tone={r.tone} label={text(r.label)} />;

        // --- acciones
        case 'BUTTON': return <ButtonNode r={r} raw={raw} env={env} />;
        case 'ICON_BUTTON': {
            if (ctx?.toolbarButtonMode) return <ButtonNode r={r} raw={raw} env={env} />;
            const key = primaryLoadingKey(raw.onClick);
            return <IconButton icon={text(r.icon)} label={text(r.label) ?? 'Action'} tone={r.tone} variant={r.variant} size={r.size} loading={r.loading !== undefined ? Boolean(r.loading) : key ? Boolean(getPath(env.state, `$loading.${key}`)) : false} disabled={r.disabled} onPress={press(raw.onClick)} />;
        }
        case 'BUTTON_GROUP': return <ButtonGroup attached={r.attached} gap={r.gap} wrap={r.wrap} align={r.align}>{kids()}</ButtonGroup>;
        case 'MENU': {
            const items = (Array.isArray(r.items) ? r.items : []).map((item: any) => ({
                label: text(item?.label), icon: text(item?.icon), tone: item?.tone, disabled: Boolean(item?.disabled), separator: Boolean(item?.separator),
                onPress: item?.onClick ? () => { void env.run(item.onClick, null); } : undefined,
            }));
            // En una barra de acciones el menu es un boton de icono ghost y neutro, como el resto.
            const bar = Boolean(ctx?.toolbarButtonMode);
            return <Menu label={text(r.label)} icon={text(r.icon)} tone={bar ? 'neutral' : r.tone} variant={bar ? 'ghost' : r.variant} size={bar ? 'sm' : r.size} showLabel={bar ? false : r.showLabel} align={bar ? 'end' : r.align} items={items} />;
        }
        case 'IMAGE_BUTTON': return <ImageButton r={r} raw={raw} env={env} />;
        case 'SMART_REPLY_CHIPS': {
            const suggestions = (Array.isArray(resolved.suggestions) ? resolved.suggestions : []).filter((s: unknown) => typeof s === 'string' && s);
            if (suggestions.length === 0) return null;
            return (
                <Row gap={2} wrap>
                    {suggestions.map((suggestion: string, index: number) => (
                        <Chip key={`${suggestion}-${index}`} label={suggestion} onPress={() => { void env.run(raw.onSelect, null, { value: suggestion }); }} />
                    ))}
                </Row>
            );
        }

        // --- datos
        case 'TABLE': {
            const selectedKeys = r.bind ? getPath(env.state, r.bind) : undefined;
            return (
                <Table
                    columns={Array.isArray(r.columns) ? r.columns : []}
                    rows={Array.isArray(r.rows) ? r.rows : Array.isArray(r.data) ? r.data : []}
                    rowKey={r.rowKey}
                    selectable={r.selectable}
                    selected={Array.isArray(selectedKeys) ? selectedKeys : r.bind ? [] : undefined}
                    onSelectionChange={(keys) => { if (r.bind) env.setState(r.bind, keys); if (raw.onSelect) void env.run(raw.onSelect, null, { value: keys }); }}
                    pageSize={r.pageSize}
                    density={r.density}
                    emptyText={text(r.emptyText)}
                    loading={r.loading}
                    caption={text(r.caption)}
                    actions={(Array.isArray(r.actions) ? r.actions : []).map((action: any) => ({
                        label: text(action?.label) ?? 'Action', icon: text(action?.icon), tone: action?.tone,
                        onPress: (row: Record<string, unknown>) => { if (action?.onClick) void env.run(action.onClick, null, { row }); },
                    }))}
                    onRowPress={raw.onRowClick ? (row) => { void env.run(raw.onRowClick, null, { row }); } : undefined}
                />
            );
        }
        case 'LIST': {
            const items = Array.isArray(r.items) ? r.items : null;
            const content = raw.itemTemplate && items
                ? items.map((item: any, i: number) => <React.Fragment key={i}>{env.renderNode(raw.itemTemplate, { ...ctx, item, index: i })}</React.Fragment>)
                : kids();
            return <List columns={r.columns} gap={r.gap} variant={r.variant} maxHeight={r.maxHeight} empty={raw.empty ? env.renderNode(raw.empty) : undefined}>{content}</List>;
        }
        case 'LIST_ITEM': return <ListItem title={text(r.title)} description={text(r.description)} meta={text(r.meta)} icon={text(r.icon)} tone={r.tone} selected={r.selected} onPress={press(raw.onClick)}>{children?.length ? kids() : undefined}</ListItem>;
        case 'TABS': return <TabsNode raw={raw} r={r} env={env} children={children} />;
        case 'TAB_ITEM': case 'CASE': case 'DEFAULT': return <>{kids()}</>;
        case 'ACCORDION': {
            const sections = asList(raw.sections).map((section, i) => ({ title: text(r.sections?.[i]?.title) ?? text(section?.title), defaultOpen: Boolean(section?.defaultOpen), content: env.renderChildren(asList(section?.content)) }));
            return <Accordion sections={sections} multiple={r.multiple} />;
        }
        case 'ACCORDION_ITEM': return <Accordion sections={[{ title: text(r.title), content: kids() }]} />;
        case 'WIZARD': return <WizardNode raw={raw} r={r} env={env} />;

        // --- feedback
        case 'BADGE': return <Badge label={text(r.label)} tone={r.tone} variant={r.variant} size={r.size}>{r.label === undefined && children?.length ? kids() : undefined}</Badge>;
        case 'CHIP': return <Chip label={text(r.label)} tone={r.tone} icon={text(r.icon)} selected={r.selected} removable={r.removable} onPress={press(raw.onClick)} onRemove={press(raw.onRemove)} />;
        case 'AVATAR': return <Avatar src={text(r.src)} name={text(r.name)} initials={text(r.initials)} alt={text(r.alt)} size={r.size} tone={r.tone} />;
        case 'STAT': return <Stat label={text(r.label)} value={text(r.value)} delta={text(r.delta)} trend={r.trend} description={text(r.description)} icon={text(r.icon)} tone={r.tone} />;
        case 'PROGRESS': return <Progress value={r.value} max={r.max} label={text(r.label)} tone={r.tone} size={r.size} showValue={r.showValue} indeterminate={r.indeterminate} />;
        case 'SKELETON': return <Skeleton variant={r.variant} lines={r.lines} size={r.size} />;
        case 'EMPTY': return <Empty icon={text(r.icon)} title={text(r.title)} description={text(r.description)} actionLabel={raw.action ? (text(r.actionLabel) ?? 'Action') : undefined} onAction={press(raw.action)}>{children?.length ? kids() : undefined}</Empty>;
        case 'ALERT': return <AlertNode r={r} resolved={resolved} env={env} children={children} />;
        case 'CALLOUT': return <Callout tone={r.tone} title={text(r.title)} icon={text(r.icon)}>{kids()}</Callout>;
        case 'LOADING': return <Spinner label={text(r.label)} size={r.size} />;

        // --- overlays
        case 'MODAL': case 'DRAWER': return <OverlayNode type={type} raw={raw} r={r} env={env} children={children} />;
        case 'POPOVER': {
            const triggerNode = raw.trigger && !Array.isArray(raw.trigger) ? raw.trigger : Array.isArray(raw.trigger) ? raw.trigger[0] : null;
            return (
                <KitPopover trigger={triggerNode ? <PopoverTrigger node={triggerNode} env={env} ctx={ctx} /> : undefined} triggerLabel={text(r.triggerLabel)} title={text(r.title)} align={r.align}>
                    {kids()}
                </KitPopover>
            );
        }
        case 'TOOLTIP': return <Tooltip text={text(r.text)}><span className="inline-flex">{kids()}</span></Tooltip>;

        // --- graficos
        case 'BAR_CHART': return <BarChart data={chartData(r.data)} orientation={r.orientation} showValues={r.showValues} height={r.height} tone={r.tone} title={text(r.title)} />;
        case 'SPARKLINE': return <Sparkline values={Array.isArray(r.values) ? r.values : []} tone={r.tone} height={r.height} area={r.area} label={text(r.label)} />;
        case 'DONUT': return <Donut data={chartData(r.data)} centerLabel={text(r.centerLabel)} size={r.size} showLegend={r.showLegend} title={text(r.title)} />;

        // --- logica
        case 'CONDITIONAL': return <>{env.renderChildren(asList(resolved.condition ? raw.true : raw.false))}</>;
        case 'CONDITION': {
            const truthy = Array.isArray(children) ? children : asList(raw.true);
            return <>{env.renderChildren(resolved.if ? truthy : asList(raw.false ?? raw.else))}</>;
        }
        case 'FOR_EACH': {
            const items = resolved.items;
            if (!Array.isArray(items) || items.length === 0) return raw.empty ? <>{env.renderNode(raw.empty)}</> : null;
            const alias = text(resolved.as) || 'item';
            const indexAlias = text(resolved.index) || 'index';
            return <>{items.map((item: any, idx: number) => <React.Fragment key={idx}>{env.renderNode(raw.template, { ...ctx, [alias]: item, [indexAlias]: idx })}</React.Fragment>)}</>;
        }
        case 'REPEAT': {
            const count = resolved.count;
            const loopItems: any[] = Array.isArray(resolved.items) ? resolved.items : typeof count === 'number' ? Array.from({ length: Math.max(0, Math.min(count, 200)) }, (_, i) => i) : [];
            const alias = text(resolved.as) || 'item';
            const indexAlias = text(resolved.index) || 'index';
            return <>{loopItems.map((item, i) => <React.Fragment key={i}>{env.renderChildren(children, { ...ctx, [alias]: item, [indexAlias]: i })}</React.Fragment>)}</>;
        }
        case 'SWITCH': {
            if (raw.cases && typeof raw.cases === 'object') {
                const matched = raw.cases[String(resolved.value)] ?? raw.default;
                return matched ? <>{env.renderChildren(asList(matched))}</> : null;
            }
            const cases = (children ?? []).filter((child: any) => child?.type === 'CASE');
            const match = cases.find((child: any) => child.props?.value === resolved.value) ?? (children ?? []).find((child: any) => child?.type === 'DEFAULT');
            return match ? <>{env.renderNode(match)}</> : null;
        }
        case 'SET_VAR': return <SetVar name={text(r.name)} value={resolved.value} />;
        case 'HEADLESS': return null;
        case 'DEBUG': return <DebugNode r={r} env={env} />;
        case '__EXTENSION_ERROR__': return <ExtensionErrorState extensionId={text(raw.extensionId)} issues={Array.isArray(raw.issues) ? raw.issues : []} />;

        default:
            if (process.env.NODE_ENV !== 'production') console.warn(`[JsonRenderer] Componente desconocido: ${type}`);
            return null;
    }
}

function TabsNode({ raw, r, env, children }: { raw: Record<string, any>; r: Record<string, any>; env: NodeEnv; children?: any[] }) {
    const rawTabs = asList(raw.tabs);
    if (rawTabs.length === 0) return <>{env.renderChildren(children)}</>;
    const tabs = rawTabs.map((tab, i) => {
        const label = text(r.tabs?.[i]?.label) ?? text(tab?.label);
        return { label, value: text(r.tabs?.[i]?.value) ?? label, icon: text(r.tabs?.[i]?.icon), content: env.renderChildren(asList(tab?.content)) };
    });
    const bound = r.bind ? getPath(env.state, r.bind) : undefined;
    return (
        <Tabs
            tabs={tabs}
            value={typeof bound === 'string' ? bound : typeof r.value === 'string' ? r.value : undefined}
            variant={r.variant}
            onChange={(value) => { if (r.bind) env.setState(r.bind, value); if (raw.onChange) void env.run(raw.onChange, null, { value }); }}
        />
    );
}

function AlertNode({ r, resolved, env, children }: { r: Record<string, any>; resolved: Record<string, any>; env: NodeEnv; children?: any[] }) {
    const [dismissed, setDismissed] = useState(false);
    if (dismissed) return null;
    return (
        <Alert tone={r.tone} title={text(r.title)} message={text(resolved.message) ?? text(resolved.description)} icon={text(r.icon)} dismissible={r.dismissible} onClose={() => setDismissed(true)}>
            {children?.length ? env.renderChildren(children) : undefined}
        </Alert>
    );
}

/** MODAL/DRAWER: con `open`/`bind` son un dialogo propio; sin ellos, el marco del contenido de un OVERLAY. */
function OverlayNode({ type, raw, r, env, children }: { type: string; raw: Record<string, any>; r: Record<string, any>; env: NodeEnv; children?: any[] }) {
    const own = r.open !== undefined || Boolean(r.bind);
    const footer = raw.footer ? env.renderChildren(asList(raw.footer)) : undefined;
    const body = env.renderChildren(children);
    if (!own) return <ModalFrame title={text(r.title)} description={text(r.description)} icon={text(r.icon)} footer={footer}>{body}</ModalFrame>;
    const open = r.bind ? Boolean(getPath(env.state, r.bind)) : Boolean(r.open);
    const close = () => { if (r.bind) env.setState(r.bind, false); if (raw.onClose) void env.run(raw.onClose, null); };
    if (type === 'DRAWER') return <DrawerPanel open={open} onClose={close} title={text(r.title)} side={r.side} width={r.width} footer={footer}>{body}</DrawerPanel>;
    return <Dialog open={open} onClose={close} title={text(r.title)} description={text(r.description)} icon={text(r.icon)} width={r.width} footer={footer}>{body}</Dialog>;
}

export { FormNode };
