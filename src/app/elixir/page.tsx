'use client';

import { useState, useCallback, useRef, useMemo, useEffect, lazy, Suspense } from 'react';
const LiquidEditor = lazy(() => import('@/components/elixir/LiquidEditor').then(m => ({ default: m.LiquidEditor })));
import { useDomainConfig } from '@/hooks/useDomainConfig';
import { renderTemplate } from '@/lib/liquid';
import { Sidebar as AppSidebar } from '@/components/Sidebar';
import {
    Upload, FileSpreadsheet, Mail, Send, Eye, ChevronDown, ChevronUp,
    X, Plus, Zap, Filter, CheckCircle, AlertCircle, Menu,
    RotateCcw, Variable, Table2, Hash, Calendar, Type,
    Download, FolderOpen, Maximize2, Minimize2, PanelTopClose
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, string>;
type ColumnType = 'text' | 'number' | 'date';

type FilterOp =
    | 'notempty' | 'empty' | 'eq' | 'neq' | 'contains' | 'notcontains'  // text
    | 'gt' | 'lt' | 'gte' | 'lte' | 'between'                            // number
    | 'date_before' | 'date_after' | 'date_between'                       // date
    | 'date_this_week' | 'date_this_month' | 'date_this_year';            // date relative

type FilterValue = {
    column: string;
    columnType: ColumnType;
    op: FilterOp;
    value: string;
    value2?: string;
};

type SenderConfig = {
    fromName: string;
    fromEmail: string;
    cc: string;
    bcc: string;
};

type SendResult = {
    email: string;
    row: Row;
    status: 'sent' | 'error' | 'skipped';
    message?: string;
};

type FolderEntry = { name: string; handle: FileSystemFileHandle };

// ─────────────────────────────────────────────────────────────────────────────
// Column type detection
// ─────────────────────────────────────────────────────────────────────────────

function detectColumnType(rows: Row[], col: string): ColumnType {
    const sample = rows.slice(0, 20).map(r => (r[col] || '').trim()).filter(Boolean);
    if (sample.length === 0) return 'text';
    const numOk = sample.filter(v => !isNaN(Number(v)) && v !== '').length;
    if (numOk / sample.length >= 0.8) return 'number';
    const dateRe = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/;
    const dateOk = sample.filter(v => dateRe.test(v) && !isNaN(Date.parse(v))).length;
    if (dateOk / sample.length >= 0.6) return 'date';
    return 'text';
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV Parser
// ─────────────────────────────────────────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: Row[] } {
    const lines: string[] = [];
    let current = '';
    let inQuote = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            if (inQuote && text[i + 1] === '"') { current += '"'; i++; }
            else { inQuote = !inQuote; }
        } else if ((ch === '\n' || ch === '\r') && !inQuote) {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            lines.push(current); current = '';
        } else { current += ch; }
    }
    if (current) lines.push(current);

    const splitLine = (line: string): string[] => {
        const fields: string[] = []; let f = ''; let q = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') { if (q && line[i + 1] === '"') { f += '"'; i++; } else { q = !q; } }
            else if (c === ',' && !q) { fields.push(f.trim()); f = ''; }
            else { f += c; }
        }
        fields.push(f.trim());
        return fields;
    };

    const nonEmpty = lines.filter(l => l.trim());
    if (nonEmpty.length === 0) return { headers: [], rows: [] };
    const headers = splitLine(nonEmpty[0]).map(h => h.replace(/^"|"$/g, '').trim());
    const rows = nonEmpty.slice(1).map(line => {
        const vals = splitLine(line);
        const row: Row = {};
        headers.forEach((h, i) => { row[h] = (vals[i] ?? '').replace(/^"|"$/g, '').trim(); });
        return row;
    });
    return { headers, rows };
}



// ─────────────────────────────────────────────────────────────────────────────
// Filter logic
// ─────────────────────────────────────────────────────────────────────────────

function applyFilters(rows: Row[], filters: FilterValue[]): Row[] {
    const now = new Date();
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    return rows.filter(row =>
        filters.every(f => {
            const raw = (row[f.column] ?? '').trim();

            // Universal ops
            if (f.op === 'notempty') return raw !== '';
            if (f.op === 'empty') return raw === '';

            if (f.columnType === 'number') {
                const n = parseFloat(raw);
                const v1 = parseFloat(f.value);
                const v2 = parseFloat(f.value2 ?? '0');
                if (isNaN(n)) return false;
                switch (f.op) {
                    case 'eq': return n === v1;
                    case 'neq': return n !== v1;
                    case 'gt': return n > v1;
                    case 'lt': return n < v1;
                    case 'gte': return n >= v1;
                    case 'lte': return n <= v1;
                    case 'between': return n >= v1 && n <= v2;
                    default: return true;
                }
            }

            if (f.columnType === 'date') {
                const d = new Date(raw);
                if (isNaN(d.getTime())) return false;
                const d1 = f.value ? new Date(f.value) : null;
                const d2 = f.value2 ? new Date(f.value2) : null;
                switch (f.op) {
                    case 'date_before': return d1 ? d < d1 : true;
                    case 'date_after': return d1 ? d > d1 : true;
                    case 'date_between': return d1 && d2 ? d >= d1 && d <= d2 : true;
                    case 'date_this_week': return d >= startOfWeek;
                    case 'date_this_month': return d >= startOfMonth;
                    case 'date_this_year': return d >= startOfYear;
                    default: return true;
                }
            }

            // Text ops
            const cell = raw.toLowerCase();
            const val = f.value.toLowerCase();
            switch (f.op) {
                case 'eq': return cell === val;
                case 'neq': return cell !== val;
                case 'contains': return cell.includes(val);
                case 'notcontains': return !cell.includes(val);
                default: return true;
            }
        })
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Default template (Liquid / Ample Market syntax)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TEMPLATE = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">Hola, {{nombre | default: "ahí"}} 👋</h2>

  <p style="color: #444; line-height: 1.6;">
    Esperamos que estés teniendo una excelente semana.
  </p>

  {% if empresa %}
  <p style="color: #444;">
    Vi que en <strong>{{empresa}}</strong> están trabajando en {{asunto | default: "proyectos interesantes"}}.
  </p>
  {% else %}
  <p style="color: #444;">
    Quería conectarme contigo directamente.
  </p>
  {% endif %}

  <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; margin: 20px 0;">
    <p style="margin: 0; color: #555;">{{mensaje | default: "Tenemos algo que podría interesarte."}}</p>
  </div>

  {% if cargo contains "Director" %}
  <p style="color: #444;">
    Como Director, seguramente valoras las soluciones que ahorran tiempo.
  </p>
  {% endif %}

  <p style="color: #888; font-size: 14px;">
    Saludos,<br/>
    El equipo
  </p>
</div>`;

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

// System variables injected into every Liquid template
const SYSTEM_VAR_KEYS = [
    { key: 'brand_name',   label: 'Nombre marca',    desc: 'config.displayName' },
    { key: 'brand_color',  label: 'Color primario',   desc: 'config.theme.primaryColor' },
    { key: 'brand_logo',   label: 'Logo URL',         desc: 'config.logo' },
    { key: 'current_date', label: 'Fecha hoy',        desc: '15 de enero de 2025' },
    { key: 'current_day',  label: 'Día semana',       desc: 'miércoles' },
    { key: 'current_month',label: 'Mes actual',       desc: 'enero' },
    { key: 'current_year', label: 'Año actual',       desc: '2025' },
];

export default function ElixirPage() {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'data' | 'template' | 'send'>('data');

    // Domain config for brand system vars + theme
    const { config: domainConfig } = useDomainConfig();
    const brandColor = domainConfig.theme?.primaryColor;

    // Data state
    const [headers, setHeaders] = useState<string[]>([]);
    const [allRows, setAllRows] = useState<Row[]>([]);
    const [columnTypes, setColumnTypes] = useState<Record<string, ColumnType>>({});
    const [filters, setFilters] = useState<FilterValue[]>([]);
    const [recipientColumn, setRecipientColumn] = useState<string>('');
    const [isDragging, setIsDragging] = useState(false);
    const [fileName, setFileName] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [folderFiles, setFolderFiles] = useState<FolderEntry[]>([]);
    const [folderName, setFolderName] = useState<string>('');

    // Sender config
    const [senderConfig, setSenderConfig] = useState<SenderConfig>({
        fromName: '',
        fromEmail: '',
        cc: '',
        bcc: '',
    });

    // Template state
    const [subject, setSubject] = useState<string>('Hola {{nombre | default: "ahí"}} — Una pregunta rápida');
    const [templateHtml, setTemplateHtml] = useState<string>(DEFAULT_TEMPLATE);
    const [previewRowIndex, setPreviewRowIndex] = useState(0);

    // Send state
    const [sending, setSending] = useState(false);
    const [results, setResults] = useState<SendResult[]>([]);

    // Import/export
    const importTemplateRef = useRef<HTMLInputElement>(null);

    const handleExportLiquid = () => {
        const blob = new Blob([templateHtml], { type: 'text/plain' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = 'template.liquid'; a.click();
    };

    const handleExportBundle = () => {
        const bundle = JSON.stringify({ version: 1, subject, template: templateHtml, senderConfig }, null, 2);
        const blob = new Blob([bundle], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = 'elixir-campaign.json'; a.click();
    };

    const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const text = await file.text();
        try {
            if (file.name.endsWith('.json')) {
                const bundle = JSON.parse(text);
                if (bundle.template) setTemplateHtml(bundle.template);
                if (bundle.subject) setSubject(bundle.subject);
                if (bundle.senderConfig) setSenderConfig(bundle.senderConfig);
                toast.success('Campaña importada desde JSON');
            } else {
                // .liquid or .html — treat as raw template
                setTemplateHtml(text);
                toast.success('Plantilla importada');
            }
        } catch {
            toast.error('Error al leer el archivo');
        }
        e.target.value = '';
    };

    const filteredRows = useMemo(() => applyFilters(allRows, filters), [allRows, filters]);

    const validRecipients = useMemo(() => {
        if (!recipientColumn) return [];
        return filteredRows.filter(r => (r[recipientColumn] || '').trim().includes('@'));
    }, [filteredRows, recipientColumn]);

    useEffect(() => {
        if (headers.length === 0) return;
        const emailCol = headers.find(h => /email|correo|mail|e-mail/i.test(h));
        if (emailCol) setRecipientColumn(emailCol);
        else setRecipientColumn(headers[0]);
    }, [headers]);

    // ── File handling ──────────────────────────────────────────────────────

    const loadFile = useCallback(async (file: File) => {
        setFileName(file.name);
        setResults([]);
        try {
            let h: string[] = [];
            let r: Row[] = [];
            if (file.name.match(/\.csv$/i) || file.type === 'text/csv') {
                const text = await file.text();
                ({ headers: h, rows: r } = parseCSV(text));
            } else {
                const XLSX = await import('xlsx');
                const buffer = await file.arrayBuffer();
                const wb = XLSX.read(buffer, { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                if (data.length === 0) { toast.error('El archivo Excel está vacío'); return; }
                h = (data[0] as any[]).map(String);
                r = data.slice(1).map(rowArr => {
                    const row: Row = {};
                    h.forEach((col, i) => { row[col] = String((rowArr as any[])[i] ?? ''); });
                    return row;
                });
            }
            setHeaders(h);
            setAllRows(r);
            setFilters([]);
            // detect column types
            const types: Record<string, ColumnType> = {};
            h.forEach(col => { types[col] = detectColumnType(r, col); });
            setColumnTypes(types);
            toast.success(`${r.length} filas cargadas`);
        } catch (e) {
            toast.error('Error al leer el archivo');
            console.error(e);
        }
    }, []);

    // ── File System Access API ─────────────────────────────────────────────
    const hasFSA = typeof window !== 'undefined' && 'showOpenFilePicker' in window;

    const openFilePicker = useCallback(async () => {
        if (!hasFSA) { fileInputRef.current?.click(); return; }
        try {
            const [fh] = await (window as any).showOpenFilePicker({
                types: [{ description: 'CSV o Excel', accept: { 'text/csv': ['.csv'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'application/vnd.ms-excel': ['.xls'] } }],
                multiple: false,
            });
            await loadFile(await fh.getFile());
        } catch (e: any) { if (e?.name !== 'AbortError') toast.error('Error al abrir archivo'); }
    }, [hasFSA, loadFile]);

    const openFolderPicker = useCallback(async () => {
        if (!('showDirectoryPicker' in window)) {
            toast.error('Acceso a carpetas requiere Chrome o Edge'); return;
        }
        try {
            const dir = await (window as any).showDirectoryPicker({ mode: 'read' });
            const entries: FolderEntry[] = [];
            for await (const [name, handle] of dir.entries()) {
                if (handle.kind === 'file' && /\.(csv|xlsx|xls)$/i.test(name))
                    entries.push({ name, handle });
            }
            entries.sort((a, b) => a.name.localeCompare(b.name));
            setFolderFiles(entries);
            setFolderName(dir.name);
            if (entries.length === 0) toast.info('Sin archivos CSV/Excel en la carpeta');
            else toast.success(`${entries.length} archivos en "${dir.name}"`);
        } catch (e: any) { if (e?.name !== 'AbortError') toast.error('Error al acceder a la carpeta'); }
    }, []);

    const loadFolderFile = useCallback(async (entry: FolderEntry) => {
        try { await loadFile(await entry.handle.getFile()); }
        catch { toast.error(`Error al abrir ${entry.name}`); }
    }, [loadFile]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) loadFile(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) loadFile(file);
    };

    // ── Filters ───────────────────────────────────────────────────────────

    const addFilter = () => {
        const col = headers[0] || '';
        const colType = columnTypes[col] || 'text';
        const defaultOp: FilterOp = colType === 'number' ? 'gt' : colType === 'date' ? 'date_after' : 'notempty';
        setFilters(prev => [...prev, { column: col, columnType: colType, op: defaultOp, value: '' }]);
    };

    const updateFilter = (index: number, update: Partial<FilterValue>) => {
        setFilters(prev => prev.map((f, i) => {
            if (i !== index) return f;
            const next = { ...f, ...update };
            // reset op if column changes
            if (update.column && update.column !== f.column) {
                const ct = columnTypes[update.column] || 'text';
                next.columnType = ct;
                next.op = ct === 'number' ? 'gt' : ct === 'date' ? 'date_after' : 'notempty';
                next.value = '';
                next.value2 = '';
            }
            return next;
        }));
    };

    const removeFilter = (index: number) => setFilters(prev => prev.filter((_, i) => i !== index));

    // ── Send ──────────────────────────────────────────────────────────────

    const handleSend = async () => {
        if (validRecipients.length === 0) { toast.error('No hay destinatarios válidos'); return; }
        if (!subject.trim()) { toast.error('Asunto vacío'); return; }
        setSending(true);
        setResults([]);
        setActiveTab('send');
        try {
            const res = await fetch('/api/elixir/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    rows: validRecipients,
                    template: templateHtml,
                    subject,
                    recipientColumn,
                    senderConfig,
                    systemVars,
                }),
            });
            const data = await res.json();
            if (!res.ok) { toast.error(data.error || 'Error al enviar'); return; }
            setResults(data.results || []);
            const sent = (data.results as SendResult[]).filter(r => r.status === 'sent').length;
            const failed = (data.results as SendResult[]).filter(r => r.status === 'error').length;
            toast.success(`${sent} enviados${failed > 0 ? `, ${failed} fallidos` : ''}`);
        } catch { toast.error('Error de red al enviar'); }
        finally { setSending(false); }
    };

    // System vars — built from domain config + current date
    const systemVars = useMemo(() => {
        const now = new Date();
        return {
            brand_name:    domainConfig.displayName || domainConfig.name || '',
            brand_color:   domainConfig.theme?.primaryColor || '',
            brand_logo:    domainConfig.logo || '',
            current_date:  now.toLocaleDateString('es-PE', { year: 'numeric', month: 'long', day: 'numeric' }),
            current_day:   now.toLocaleDateString('es-PE', { weekday: 'long' }),
            current_month: now.toLocaleDateString('es-PE', { month: 'long' }),
            current_year:  String(now.getFullYear()),
        };
    }, [domainConfig]);

    const previewRow = useMemo(() => ({ ...systemVars, ...(filteredRows[previewRowIndex] || {}) }), [systemVars, filteredRows, previewRowIndex]);
    const previewSubject = renderTemplate(subject, previewRow);
    const previewHtml = renderTemplate(templateHtml, previewRow);

    return (
        <div className="flex h-screen bg-background overflow-hidden">
            <AnimatePresence>
                {isSidebarOpen && (
                    <>
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={() => setIsSidebarOpen(false)} />
                        <motion.div initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
                            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                            className="fixed left-0 top-0 z-50 h-full w-64 md:hidden">
                            <AppSidebar onClose={() => setIsSidebarOpen(false)} />
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            <div className="hidden md:flex w-64 shrink-0 border-r border-border">
                <AppSidebar />
            </div>

            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0">
                    <button onClick={() => setIsSidebarOpen(true)} className="md:hidden p-2 rounded-md hover:bg-muted text-muted-foreground">
                        <Menu className="h-5 w-5" />
                    </button>
                    <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center"
                            style={brandColor ? { backgroundColor: `${brandColor}1a` } : undefined}>
                            <Zap className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-sm font-semibold">Elixir</h1>
                            <p className="text-xs text-muted-foreground">Envío masivo · sintaxis Liquid</p>
                        </div>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                        {allRows.length > 0 && (
                            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
                                {validRecipients.length} / {allRows.length} destinatarios
                            </span>
                        )}
                        <button
                            onClick={handleSend}
                            disabled={sending || validRecipients.length === 0}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                                "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95",
                                "disabled:opacity-50 disabled:cursor-not-allowed"
                            )}
                        >
                            {sending
                                ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><RotateCcw className="h-4 w-4" /></motion.div>
                                : <Send className="h-4 w-4" />
                            }
                            {sending ? 'Enviando...' : 'Enviar campaña'}
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-border px-4 shrink-0 bg-background">
                    {([
                        { id: 'data', label: 'Datos', icon: Table2 },
                        { id: 'template', label: 'Plantilla', icon: Variable },
                        { id: 'send', label: 'Resultados', icon: CheckCircle },
                    ] as { id: 'data' | 'template' | 'send'; label: string; icon: any }[]).map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors",
                                activeTab === tab.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                            )}>
                            <tab.icon className="h-4 w-4" />
                            {tab.label}
                            {tab.id === 'send' && results.length > 0 && (
                                <span className="ml-1 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{results.length}</span>
                            )}
                        </button>
                    ))}
                </div>

                <div className="flex-1 min-h-0 overflow-hidden">
                    {activeTab === 'data' && (
                        <DataTab
                            headers={headers} allRows={allRows} filteredRows={filteredRows}
                            filters={filters} columnTypes={columnTypes}
                            recipientColumn={recipientColumn} fileName={fileName}
                            isDragging={isDragging} fileInputRef={fileInputRef}
                            folderFiles={folderFiles} folderName={folderName}
                            hasFSA={hasFSA}
                            onDrop={handleDrop}
                            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                            onDragLeave={() => setIsDragging(false)}
                            onFileClick={openFilePicker}
                            onFileChange={handleFileChange}
                            onOpenFolder={openFolderPicker}
                            onLoadFolderFile={loadFolderFile}
                            onAddFilter={addFilter}
                            onUpdateFilter={updateFilter}
                            onRemoveFilter={removeFilter}
                            onSetRecipientColumn={setRecipientColumn}
                        />
                    )}
                    {activeTab === 'template' && (
                        <TemplateTab
                            headers={headers} filteredRows={filteredRows}
                            subject={subject} templateHtml={templateHtml}
                            previewRowIndex={previewRowIndex}
                            previewSubject={previewSubject} previewHtml={previewHtml}
                            senderConfig={senderConfig}
                            systemVarKeys={SYSTEM_VAR_KEYS}
                            importTemplateRef={importTemplateRef}
                            onSenderConfigChange={setSenderConfig}
                            onSubjectChange={setSubject}
                            onTemplateChange={setTemplateHtml}
                            onPreviewRowChange={setPreviewRowIndex}
                            onExportLiquid={handleExportLiquid}
                            onExportBundle={handleExportBundle}
                            onImportClick={() => importTemplateRef.current?.click()}
                            onImportFile={handleImportFile}
                        />
                    )}
                    {activeTab === 'send' && (
                        <SendTab results={results} sending={sending} validRecipients={validRecipients} />
                    )}
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// DataTab
// ─────────────────────────────────────────────────────────────────────────────

function DataTab({
    headers, allRows, filteredRows, filters, columnTypes, recipientColumn, fileName,
    isDragging, fileInputRef, folderFiles, folderName, hasFSA,
    onDrop, onDragOver, onDragLeave,
    onFileClick, onFileChange, onOpenFolder, onLoadFolderFile,
    onAddFilter, onUpdateFilter, onRemoveFilter, onSetRecipientColumn,
}: {
    headers: string[];
    allRows: Row[];
    filteredRows: Row[];
    filters: FilterValue[];
    columnTypes: Record<string, ColumnType>;
    recipientColumn: string;
    fileName: string;
    isDragging: boolean;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    folderFiles: FolderEntry[];
    folderName: string;
    hasFSA: boolean;
    onDrop: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onFileClick: () => void;
    onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onOpenFolder: () => void;
    onLoadFolderFile: (entry: FolderEntry) => void;
    onAddFilter: () => void;
    onUpdateFilter: (i: number, u: Partial<FilterValue>) => void;
    onRemoveFilter: (i: number) => void;
    onSetRecipientColumn: (col: string) => void;
}) {
    const typeIcon = (t: ColumnType) =>
        t === 'number' ? <Hash className="h-3 w-3" /> : t === 'date' ? <Calendar className="h-3 w-3" /> : <Type className="h-3 w-3" />;

    return (
        <div className="flex h-full min-h-0">
            {/* Left panel */}
            <div className="w-72 shrink-0 border-r border-border flex flex-col overflow-y-auto">
                {/* Upload */}
                <div className="p-4 border-b border-border">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Archivo</p>

                    {/* Drag-drop zone */}
                    <div
                        onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave} onClick={onFileClick}
                        className={cn(
                            "border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all",
                            isDragging ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30 hover:bg-muted/30"
                        )}
                    >
                        <FileSpreadsheet className="h-7 w-7 mx-auto mb-2 text-muted-foreground" />
                        {fileName
                            ? <p className="text-sm font-medium truncate">{fileName}</p>
                            : <>
                                <p className="text-sm font-medium">Abrir archivo</p>
                                <p className="text-xs text-muted-foreground mt-0.5">CSV · XLSX — o arrastra aquí</p>
                            </>
                        }
                    </div>
                    <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFileChange} />

                    {/* Folder picker button */}
                    <button
                        onClick={onOpenFolder}
                        className="mt-2 w-full flex items-center justify-center gap-2 text-xs px-3 py-2 rounded-lg border border-dashed border-border hover:border-primary/40 hover:bg-muted/30 transition-all text-muted-foreground hover:text-foreground"
                    >
                        <FolderOpen className="h-3.5 w-3.5" />
                        {folderName ? `📁 ${folderName}` : 'Abrir carpeta…'}
                        {!hasFSA && <span className="text-[10px] opacity-60">(requiere Chrome/Edge)</span>}
                    </button>

                    {allRows.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-2 text-center">{allRows.length} filas · {headers.length} columnas</p>
                    )}
                </div>

                {/* Folder file list */}
                {folderFiles.length > 0 && (
                    <div className="border-b border-border">
                        <p className="px-4 pt-3 pb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                            Archivos en carpeta ({folderFiles.length})
                        </p>
                        <div className="max-h-40 overflow-y-auto">
                            {folderFiles.map(entry => (
                                <button
                                    key={entry.name}
                                    onClick={() => onLoadFolderFile(entry)}
                                    className={cn(
                                        "flex items-center gap-2 w-full text-left px-4 py-2 text-xs hover:bg-muted/50 transition-colors",
                                        fileName === entry.name && "bg-primary/8 text-primary font-medium"
                                    )}
                                >
                                    <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <span className="truncate">{entry.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Recipient column */}
                {headers.length > 0 && (
                    <div className="p-4 border-b border-border">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Columna de email</p>
                        <select
                            value={recipientColumn} onChange={e => onSetRecipientColumn(e.target.value)}
                            className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                            {headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                    </div>
                )}

                {/* Filters */}
                {headers.length > 0 && (
                    <div className="p-4 flex-1">
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filtros</p>
                            <button onClick={onAddFilter} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium">
                                <Plus className="h-3.5 w-3.5" />Agregar
                            </button>
                        </div>

                        {filters.length === 0
                            ? (
                                <div className="text-center py-4 border border-dashed border-border rounded-lg">
                                    <Filter className="h-5 w-5 mx-auto text-muted-foreground/50 mb-1" />
                                    <p className="text-xs text-muted-foreground">Sin filtros activos</p>
                                </div>
                            )
                            : (
                                <div className="flex flex-col gap-2">
                                    {filters.map((f, i) => (
                                        <FilterRow
                                            key={i} filter={f} headers={headers} columnTypes={columnTypes}
                                            onUpdate={u => onUpdateFilter(i, u)}
                                            onRemove={() => onRemoveFilter(i)}
                                        />
                                    ))}
                                </div>
                            )
                        }

                        {filters.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-3 text-center">
                                {filteredRows.length} de {allRows.length} filas coinciden
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* Data table */}
            <div className="flex-1 min-w-0 overflow-auto">
                {allRows.length === 0
                    ? (
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                            <Upload className="h-12 w-12 mb-3 opacity-30" />
                            <p className="text-sm font-medium">Sin datos cargados</p>
                            <p className="text-xs mt-1 opacity-60">Sube un CSV o Excel para comenzar</p>
                        </div>
                    )
                    : (
                        <table className="w-full text-xs border-collapse">
                            <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                                <tr>
                                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground border-b border-border w-10">#</th>
                                    {headers.map(h => (
                                        <th key={h} className={cn(
                                            "px-3 py-2 text-left font-semibold border-b border-border whitespace-nowrap",
                                            h === recipientColumn ? "text-primary" : "text-muted-foreground"
                                        )}>
                                            <span className="flex items-center gap-1">
                                                {h === recipientColumn
                                                    ? <Mail className="h-3 w-3" />
                                                    : typeIcon(columnTypes[h] || 'text')
                                                }
                                                {h}
                                            </span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRows.slice(0, 200).map((row, ri) => (
                                    <tr key={ri} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                                        <td className="px-3 py-1.5 text-muted-foreground/50">{ri + 1}</td>
                                        {headers.map(h => (
                                            <td key={h} className="px-3 py-1.5 max-w-[200px] truncate">{row[h]}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )
                }
                {filteredRows.length > 200 && (
                    <p className="text-xs text-center text-muted-foreground py-3">Mostrando 200 de {filteredRows.length} filas</p>
                )}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// FilterRow — smart per type
// ─────────────────────────────────────────────────────────────────────────────

const TEXT_OPS: { value: FilterOp; label: string }[] = [
    { value: 'notempty', label: 'No vacío' },
    { value: 'empty', label: 'Vacío' },
    { value: 'eq', label: 'Igual a' },
    { value: 'neq', label: 'Distinto de' },
    { value: 'contains', label: 'Contiene' },
    { value: 'notcontains', label: 'No contiene' },
];

const NUMBER_OPS: { value: FilterOp; label: string }[] = [
    { value: 'notempty', label: 'No vacío' },
    { value: 'empty', label: 'Vacío' },
    { value: 'eq', label: '= igual' },
    { value: 'neq', label: '≠ distinto' },
    { value: 'gt', label: '> mayor que' },
    { value: 'gte', label: '≥ mayor o igual' },
    { value: 'lt', label: '< menor que' },
    { value: 'lte', label: '≤ menor o igual' },
    { value: 'between', label: 'Entre' },
];

const DATE_OPS: { value: FilterOp; label: string }[] = [
    { value: 'notempty', label: 'No vacío' },
    { value: 'empty', label: 'Vacío' },
    { value: 'date_after', label: 'Después de' },
    { value: 'date_before', label: 'Antes de' },
    { value: 'date_between', label: 'Entre fechas' },
    { value: 'date_this_week', label: 'Esta semana' },
    { value: 'date_this_month', label: 'Este mes' },
    { value: 'date_this_year', label: 'Este año' },
];

function FilterRow({
    filter, headers, columnTypes, onUpdate, onRemove,
}: {
    filter: FilterValue;
    headers: string[];
    columnTypes: Record<string, ColumnType>;
    onUpdate: (u: Partial<FilterValue>) => void;
    onRemove: () => void;
}) {
    const ops = filter.columnType === 'number' ? NUMBER_OPS : filter.columnType === 'date' ? DATE_OPS : TEXT_OPS;
    const needsValue = !['notempty', 'empty', 'date_this_week', 'date_this_month', 'date_this_year'].includes(filter.op);
    const needsSecondValue = filter.op === 'between' || filter.op === 'date_between';
    const inputType = filter.columnType === 'number' ? 'number' : filter.columnType === 'date' ? 'date' : 'text';

    const typeLabel = filter.columnType === 'number' ? '#' : filter.columnType === 'date' ? '📅' : 'T';

    return (
        <div className="bg-muted/30 rounded-lg p-2 border border-border/50 space-y-1.5">
            <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground bg-muted rounded px-1">{typeLabel}</span>
                <select
                    value={filter.column}
                    onChange={e => onUpdate({ column: e.target.value })}
                    className="flex-1 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                >
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <button onClick={onRemove} className="p-1 text-muted-foreground hover:text-red-500 transition-colors">
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
            <select
                value={filter.op}
                onChange={e => onUpdate({ op: e.target.value as FilterOp })}
                className="w-full text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            >
                {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {needsValue && (
                <input
                    type={inputType}
                    value={filter.value}
                    onChange={e => onUpdate({ value: e.target.value })}
                    placeholder={filter.op === 'between' || filter.op === 'date_between' ? 'Desde...' : 'Valor...'}
                    className="w-full text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
            )}
            {needsSecondValue && (
                <input
                    type={inputType}
                    value={filter.value2 || ''}
                    onChange={e => onUpdate({ value2: e.target.value })}
                    placeholder="Hasta..."
                    className="w-full text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// TemplateTab
// ─────────────────────────────────────────────────────────────────────────────

function TemplateTab({
    headers, filteredRows, subject, templateHtml, previewRowIndex,
    previewSubject, previewHtml, senderConfig, systemVarKeys, importTemplateRef,
    onSenderConfigChange, onSubjectChange, onTemplateChange, onPreviewRowChange,
    onExportLiquid, onExportBundle, onImportClick, onImportFile,
}: {
    headers: string[];
    filteredRows: Row[];
    subject: string;
    templateHtml: string;
    previewRowIndex: number;
    previewSubject: string;
    previewHtml: string;
    senderConfig: SenderConfig;
    systemVarKeys: typeof SYSTEM_VAR_KEYS;
    importTemplateRef: React.RefObject<HTMLInputElement | null>;
    onSenderConfigChange: (c: SenderConfig) => void;
    onSubjectChange: (v: string) => void;
    onTemplateChange: (v: string) => void;
    onPreviewRowChange: (i: number) => void;
    onExportLiquid: () => void;
    onExportBundle: () => void;
    onImportClick: () => void;
    onImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [configCollapsed, setConfigCollapsed] = useState(false);
    const [configHeight, setConfigHeight] = useState(340);
    const [isEditorFullscreen, setIsEditorFullscreen] = useState(false);
    const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

    const insertVar = (varName: string) => onTemplateChange(templateHtml + `{{${varName}}}`);
    const sc = senderConfig;
    const set = (k: keyof SenderConfig) => (v: string) => onSenderConfigChange({ ...sc, [k]: v });

    const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
        dragRef.current = { startY: e.clientY, startHeight: configHeight };
        e.currentTarget.setPointerCapture(e.pointerId);
    };
    const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragRef.current) return;
        const newH = Math.max(80, Math.min(640, dragRef.current.startHeight + e.clientY - dragRef.current.startY));
        setConfigHeight(newH);
    };
    const handleDragEnd = () => { dragRef.current = null; };

    useEffect(() => {
        if (!isEditorFullscreen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsEditorFullscreen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isEditorFullscreen]);

    return (
        <div className="flex h-full min-h-0">
            {/* Editor side */}
            <div className="flex-1 flex flex-col min-w-0 border-r border-border overflow-hidden">

                {/* Import/Export toolbar */}
                <div className="px-4 py-2 border-b border-border shrink-0 flex items-center gap-2 bg-background">
                    <input ref={importTemplateRef} type="file" accept=".liquid,.html,.json" className="hidden" onChange={onImportFile} />
                    <button
                        onClick={onImportClick}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors font-medium"
                    >
                        <FolderOpen className="h-3.5 w-3.5" />
                        Importar
                    </button>
                    <div className="relative">
                        <button
                            onClick={() => setShowExportMenu(v => !v)}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors font-medium"
                        >
                            <Download className="h-3.5 w-3.5" />
                            Exportar
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </button>
                        <AnimatePresence>
                            {showExportMenu && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                                    <motion.div
                                        initial={{ opacity: 0, y: -4, scale: 0.97 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: -4, scale: 0.97 }}
                                        transition={{ duration: 0.12 }}
                                        className="absolute top-full left-0 mt-1 w-52 bg-popover border border-border rounded-xl shadow-lg z-50 p-1"
                                    >
                                        <button
                                            onClick={() => { onExportLiquid(); setShowExportMenu(false); }}
                                            className="flex flex-col w-full text-left px-3 py-2.5 rounded-lg hover:bg-muted transition-colors"
                                        >
                                            <span className="text-xs font-semibold font-mono">.liquid</span>
                                            <span className="text-[11px] text-muted-foreground">Solo plantilla HTML+Liquid</span>
                                        </button>
                                        <button
                                            onClick={() => { onExportBundle(); setShowExportMenu(false); }}
                                            className="flex flex-col w-full text-left px-3 py-2.5 rounded-lg hover:bg-muted transition-colors"
                                        >
                                            <span className="text-xs font-semibold font-mono">.json</span>
                                            <span className="text-[11px] text-muted-foreground">Bundle completo (asunto + plantilla + config)</span>
                                        </button>
                                    </motion.div>
                                </>
                            )}
                        </AnimatePresence>
                    </div>
                    <span className="text-[11px] text-muted-foreground">Acepta .liquid · .html · .json</span>
                    <button
                        type="button"
                        onClick={() => setConfigCollapsed(v => !v)}
                        title={configCollapsed ? 'Mostrar configuración' : 'Ocultar configuración'}
                        className="ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground"
                    >
                        <PanelTopClose className="h-3.5 w-3.5" />
                        {configCollapsed ? 'Config' : 'Ocultar'}
                    </button>
                </div>

                {/* Collapsible config area */}
                <div
                    className="overflow-y-auto shrink-0 transition-all"
                    style={{ height: configCollapsed ? 0 : configHeight, minHeight: 0 }}
                >

                {/* Sender config */}
                <div className="px-4 py-3 border-b border-border bg-muted/10 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Configuración de envío</p>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] text-muted-foreground block mb-1">Nombre remitente</label>
                            <input value={sc.fromName} onChange={e => set('fromName')(e.target.value)}
                                placeholder="{{nombre}} (tu empresa)"
                                className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                        </div>
                        <div>
                            <label className="text-[10px] text-muted-foreground block mb-1">Email remitente</label>
                            <input value={sc.fromEmail} onChange={e => set('fromEmail')(e.target.value)}
                                placeholder="tu@empresa.com"
                                className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                        </div>
                        <div>
                            <label className="text-[10px] text-muted-foreground block mb-1">CC (copia)</label>
                            <input value={sc.cc} onChange={e => set('cc')(e.target.value)}
                                placeholder="cc@empresa.com · admite {{columna}}"
                                className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                        </div>
                        <div>
                            <label className="text-[10px] text-muted-foreground block mb-1">BCC (copia oculta)</label>
                            <input value={sc.bcc} onChange={e => set('bcc')(e.target.value)}
                                placeholder="bcc@empresa.com · admite {{columna}}"
                                className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                        </div>
                    </div>
                </div>

                {/* Subject */}
                <div className="px-4 py-3 border-b border-border shrink-0">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Asunto</label>
                    <input type="text" value={subject} onChange={e => onSubjectChange(e.target.value)}
                        className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-ring font-medium"
                        placeholder="Hola {{nombre | default: 'ahí'}} — admite Liquid" />
                </div>

                {/* Variables */}
                <div className="px-4 py-2 border-b border-border shrink-0 bg-muted/20 space-y-2">
                    {headers.length > 0 && (
                        <div>
                            <p className="text-[10px] text-muted-foreground mb-1 font-semibold uppercase tracking-wider">Columnas del archivo</p>
                            <div className="flex flex-wrap gap-1.5">
                                {headers.map(h => (
                                    <button key={h} onClick={() => insertVar(h)}
                                        className="text-xs bg-primary/8 text-primary border border-primary/25 px-2 py-0.5 rounded-full hover:bg-primary/15 transition-colors font-mono">
                                        {`{{${h}}}`}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    <div>
                        <p className="text-[10px] text-muted-foreground mb-1 font-semibold uppercase tracking-wider">Variables del sistema</p>
                        <div className="flex flex-wrap gap-1.5">
                            {systemVarKeys.map(v => (
                                <button key={v.key} onClick={() => insertVar(v.key)} title={v.label}
                                    className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full hover:bg-amber-100 transition-colors font-mono">
                                    {`{{${v.key}}}`}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Syntax reference */}
                <details className="border-b border-border shrink-0 bg-amber-50/60 group">
                    <summary className="px-4 py-2 text-xs text-amber-800 font-semibold cursor-pointer select-none flex items-center gap-1">
                        <span>Referencia sintaxis Liquid (Ample Market)</span>
                        <ChevronDown className="h-3 w-3 group-open:rotate-180 transition-transform ml-auto" />
                    </summary>
                    <div className="px-4 pb-3 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[11px] text-amber-700 font-mono leading-relaxed">
                        <span className="col-span-2 text-[10px] font-bold text-amber-900 mt-1 uppercase tracking-wider">Variables</span>
                        <span>{`{{campo}}`} → valor directo</span>
                        <span>{`{{campo | default: "texto"}}`} → fallback</span>
                        <span>{`{{ now | date: "%B %d, %Y" }}`} → fecha actual</span>
                        <span>{`{{brand_name}} {{today}}`} → sistema</span>

                        <span className="col-span-2 text-[10px] font-bold text-amber-900 mt-1.5 uppercase tracking-wider">Filtros de texto</span>
                        <span>{`| upcase / downcase / capitalize`}</span>
                        <span>{`| strip / lstrip / rstrip / strip_html`}</span>
                        <span>{`| truncate: 50 / truncatewords: 10`}</span>
                        <span>{`| replace: "old", "new"`}</span>
                        <span>{`| remove: "x" / remove_first: "x"`}</span>
                        <span>{`| prepend: "Hola " / append: "!"`}</span>
                        <span>{`| escape / url_encode / url_decode`}</span>
                        <span>{`| base64_encode / base64_decode`}</span>
                        <span>{`| size / first / last / reverse`}</span>
                        <span>{`| slice: 0, 5`}</span>

                        <span className="col-span-2 text-[10px] font-bold text-amber-900 mt-1.5 uppercase tracking-wider">Filtros de array</span>
                        <span>{`| split: ","` } → crea array</span>
                        <span>{`| join: " / "`} → une array</span>
                        <span>{`| sort / sort_natural / uniq`}</span>
                        <span>{`| compact / flatten`}</span>
                        <span>{`| first / last / size / reverse`}</span>
                        <span>{`| sum / min / max`}</span>

                        <span className="col-span-2 text-[10px] font-bold text-amber-900 mt-1.5 uppercase tracking-wider">Filtros numéricos</span>
                        <span>{`| plus: 10 / minus: 5`}</span>
                        <span>{`| times: 2 / divided_by: 3`}</span>
                        <span>{`| round: 2 / ceil / floor / abs`}</span>
                        <span>{`| modulo: 7 / at_least: 0 / at_most: 100`}</span>

                        <span className="col-span-2 text-[10px] font-bold text-amber-900 mt-1.5 uppercase tracking-wider">Filtros de fecha</span>
                        <span>{`| date: "%B %d, %Y"`}</span>
                        <span>{`| date: "%d/%m/%Y"`}</span>
                        <span>{`%Y %m %d %H %M %S %B %b %A %p`}</span>
                        <span>{`{{ now | date: "..." }}` } → hoy</span>

                        <span className="col-span-2 text-[10px] font-bold text-amber-900 mt-1.5 uppercase tracking-wider">Cadena de filtros</span>
                        <span className="col-span-2">{`{{campo | upcase | truncate: 20 | append: "..."}}`}</span>

                        <span className="col-span-2 text-[10px] font-bold text-amber-900 mt-1.5 uppercase tracking-wider">Control de flujo</span>
                        <span>{`{% if campo %} … {% endif %}`}</span>
                        <span>{`{% unless campo %} … {% endunless %}`}</span>
                        <span>{`{% if a == "X" %} … {% else %} … {% endif %}`}</span>
                        <span>{`{% if a contains "X" %} … {% endif %}`}</span>
                        <span>{`{% if a > 100 and b != "Y" %} … {% endif %}`}</span>
                        <span>{`{% if a or b %} … {% elsif c %} … {% endif %}`}</span>
                        <span>{`{% case x %}{% when "a" %}…{% when "b" %}…{% else %}…{% endcase %}`}</span>
                        <span>{`{% when "a" or "b" %}` } → múltiples valores</span>

                        <span className="col-span-2 text-[10px] font-bold text-amber-900 mt-1.5 uppercase tracking-wider">Bucles for</span>
                        <span>{`{% assign items = campo | split: "," %}`}</span>
                        <span>{`{% for x in items %}{{x}}{% endfor %}`}</span>
                        <span>{`{% for i in (1..5) %}{{i}}{% endfor %}`}</span>
                        <span>{`for … limit:3 offset:1 reversed`}</span>
                        <span>{`forloop.index / index0 / first / last`}</span>
                        <span>{`forloop.length / rindex / rindex0`}</span>
                        <span>{`{% break %} / {% continue %}`}</span>
                        <span>{`{% for x in arr %}…{% else %}vacío{% endfor %}`}</span>

                        <span className="col-span-2 text-[10px] font-bold text-amber-900 mt-1.5 uppercase tracking-wider">Asignación y captura</span>
                        <span>{`{% assign x = campo | upcase %}`}</span>
                        <span>{`{% capture x %}texto {{campo}}{% endcapture %}`}</span>
                        <span>{`{% increment ctr %} / {% decrement ctr %}`}</span>
                        <span>{`{% cycle "odd", "even" %}`}</span>
                    </div>
                </details>

                </div>{/* end collapsible config area */}

                {/* Drag resize handle */}
                {!configCollapsed && (
                    <div
                        className="h-1.5 bg-border hover:bg-primary/40 cursor-ns-resize shrink-0 transition-colors select-none"
                        onPointerDown={handleDragStart}
                        onPointerMove={handleDragMove}
                        onPointerUp={handleDragEnd}
                    />
                )}

                {/* Liquid Code Editor (CodeMirror 6) */}
                {isEditorFullscreen ? (
                    <div className="fixed inset-0 z-50 bg-background flex flex-col">
                        <LiquidEditor
                            value={templateHtml}
                            onChange={onTemplateChange}
                            variables={headers}
                            className="flex-1 min-h-0"
                            isFullscreen={true}
                            onToggleFullscreen={() => setIsEditorFullscreen(false)}
                        />
                    </div>
                ) : (
                    <div className="flex-1 min-h-0 overflow-hidden">
                        <Suspense fallback={
                            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                                Cargando editor...
                            </div>
                        }>
                            <LiquidEditor
                                value={templateHtml}
                                onChange={onTemplateChange}
                                variables={headers}
                                className="h-full"
                                isFullscreen={false}
                                onToggleFullscreen={() => setIsEditorFullscreen(true)}
                            />
                        </Suspense>
                    </div>
                )}
            </div>

            {/* Preview side */}
            <div className="w-[420px] shrink-0 flex flex-col bg-gray-50">
                <div className="px-4 py-3 border-b border-border bg-background shrink-0">
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Vista previa</p>
                        {filteredRows.length > 0 && (
                            <div className="flex items-center gap-2">
                                <button onClick={() => onPreviewRowChange(Math.max(0, previewRowIndex - 1))}
                                    disabled={previewRowIndex <= 0} className="p-1 rounded hover:bg-muted disabled:opacity-30">
                                    <ChevronUp className="h-3.5 w-3.5" />
                                </button>
                                <span className="text-xs text-muted-foreground">Fila {previewRowIndex + 1} / {filteredRows.length}</span>
                                <button onClick={() => onPreviewRowChange(Math.min(filteredRows.length - 1, previewRowIndex + 1))}
                                    disabled={previewRowIndex >= filteredRows.length - 1} className="p-1 rounded hover:bg-muted disabled:opacity-30">
                                    <ChevronDown className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {filteredRows.length === 0
                    ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                            <Eye className="h-8 w-8 mb-2 opacity-30" />
                            <p className="text-sm">Sin datos para previsualizar</p>
                            <p className="text-xs mt-1 opacity-60">Carga un archivo primero</p>
                        </div>
                    )
                    : (
                        <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
                            {/* Sender preview */}
                            {(senderConfig.fromName || senderConfig.fromEmail || senderConfig.cc || senderConfig.bcc) && (
                                <div className="bg-white rounded-xl border border-border overflow-hidden text-xs">
                                    <div className="bg-gray-50 px-4 py-2 border-b border-border">
                                        <p className="font-semibold text-muted-foreground">Cabeceras del email</p>
                                    </div>
                                    <div className="divide-y divide-border/50">
                                        {senderConfig.fromName && (
                                            <div className="flex px-4 py-2 gap-2">
                                                <span className="text-muted-foreground w-20 shrink-0">De (nombre):</span>
                                                <span className="font-medium">{renderTemplate(senderConfig.fromName, filteredRows[previewRowIndex] || {})}</span>
                                            </div>
                                        )}
                                        {senderConfig.fromEmail && (
                                            <div className="flex px-4 py-2 gap-2">
                                                <span className="text-muted-foreground w-20 shrink-0">De (email):</span>
                                                <span className="font-mono">{renderTemplate(senderConfig.fromEmail, filteredRows[previewRowIndex] || {})}</span>
                                            </div>
                                        )}
                                        {senderConfig.cc && (
                                            <div className="flex px-4 py-2 gap-2">
                                                <span className="text-muted-foreground w-20 shrink-0">CC:</span>
                                                <span className="font-mono">{renderTemplate(senderConfig.cc, filteredRows[previewRowIndex] || {})}</span>
                                            </div>
                                        )}
                                        {senderConfig.bcc && (
                                            <div className="flex px-4 py-2 gap-2">
                                                <span className="text-muted-foreground w-20 shrink-0">BCC:</span>
                                                <span className="font-mono">{renderTemplate(senderConfig.bcc, filteredRows[previewRowIndex] || {})}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Email mock */}
                            <div className="bg-white rounded-xl shadow-sm border border-border overflow-hidden">
                                <div className="bg-gray-100 px-4 py-3 border-b border-border">
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span className="font-medium text-foreground">Asunto:</span>
                                        <span className="truncate">{previewSubject || '(sin asunto)'}</span>
                                    </div>
                                </div>
                                <div className="p-4 text-sm" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                            </div>

                            {/* Row values */}
                            {headers.length > 0 && (
                                <div className="bg-white rounded-xl border border-border overflow-hidden">
                                    <div className="px-4 py-2 bg-gray-50 border-b border-border">
                                        <p className="text-xs font-semibold text-muted-foreground">Valores de la fila</p>
                                    </div>
                                    <div className="divide-y divide-border/50">
                                        {headers.map(h => (
                                            <div key={h} className="flex px-4 py-2 gap-3">
                                                <span className="text-xs font-mono text-primary shrink-0 w-32 truncate">{h}</span>
                                                <span className="text-xs text-foreground truncate">{filteredRows[previewRowIndex]?.[h] || '—'}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                }
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// SendTab
// ─────────────────────────────────────────────────────────────────────────────

function SendTab({ results, sending, validRecipients }: {
    results: SendResult[];
    sending: boolean;
    validRecipients: Row[];
}) {
    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'error').length;

    if (sending) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4">
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
                    <Zap className="h-10 w-10 text-primary" />
                </motion.div>
                <p className="text-sm font-medium">Enviando campaña...</p>
                <p className="text-xs text-muted-foreground">{validRecipients.length} destinatarios</p>
            </div>
        );
    }

    if (results.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Send className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm font-medium">Sin resultados todavía</p>
                <p className="text-xs mt-1 opacity-60">Configura datos y plantilla, luego envía</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex gap-4 p-4 border-b border-border shrink-0">
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <div>
                        <p className="text-lg font-bold text-green-700">{sent}</p>
                        <p className="text-xs text-green-600">Enviados</p>
                    </div>
                </div>
                {failed > 0 && (
                    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                        <AlertCircle className="h-5 w-5 text-red-600" />
                        <div>
                            <p className="text-lg font-bold text-red-700">{failed}</p>
                            <p className="text-xs text-red-600">Fallidos</p>
                        </div>
                    </div>
                )}
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                        <tr>
                            <th className="px-4 py-2 text-left font-semibold text-muted-foreground border-b border-border">Email</th>
                            <th className="px-4 py-2 text-left font-semibold text-muted-foreground border-b border-border">Estado</th>
                            <th className="px-4 py-2 text-left font-semibold text-muted-foreground border-b border-border">Mensaje</th>
                        </tr>
                    </thead>
                    <tbody>
                        {results.map((r, i) => (
                            <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                                <td className="px-4 py-2 font-mono">{r.email}</td>
                                <td className="px-4 py-2">
                                    <span className={cn(
                                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
                                        r.status === 'sent' ? "bg-green-100 text-green-700" :
                                            r.status === 'error' ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"
                                    )}>
                                        {r.status === 'sent' && <CheckCircle className="h-3 w-3" />}
                                        {r.status === 'error' && <AlertCircle className="h-3 w-3" />}
                                        {r.status === 'sent' ? 'Enviado' : r.status === 'error' ? 'Error' : 'Omitido'}
                                    </span>
                                </td>
                                <td className="px-4 py-2 text-muted-foreground">{r.message || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
