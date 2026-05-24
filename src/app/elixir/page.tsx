'use client';

import { useState, useCallback, useRef, useMemo, useEffect, lazy, Suspense } from 'react';
const LiquidEditor = lazy(() => import('@/components/elixir/LiquidEditor').then(m => ({ default: m.LiquidEditor })));
import { Sidebar as AppSidebar } from '@/components/Sidebar';
import {
    Upload, FileSpreadsheet, Mail, Send, Eye, ChevronDown, ChevronUp,
    X, Plus, Zap, Filter, CheckCircle, AlertCircle, Menu,
    RotateCcw, Variable, Table2, Hash, Calendar, Type,
    Download, FolderOpen
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
// Liquid Template Engine — full Ample Market compatible implementation
// ─────────────────────────────────────────────────────────────────────────────

function formatLiquidDate(d: Date, fmt: string): string {
    const mo = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const mos = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dy = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const dys = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return fmt
        .replace(/%Y/g, String(d.getFullYear()))
        .replace(/%y/g, String(d.getFullYear()).slice(-2))
        .replace(/%m/g, String(d.getMonth()+1).padStart(2,'0'))
        .replace(/%d/g, String(d.getDate()).padStart(2,'0'))
        .replace(/%e/g, String(d.getDate()))
        .replace(/%B/g, mo[d.getMonth()])
        .replace(/%b/g, mos[d.getMonth()])
        .replace(/%A/g, dy[d.getDay()])
        .replace(/%a/g, dys[d.getDay()])
        .replace(/%H/g, String(d.getHours()).padStart(2,'0'))
        .replace(/%I/g, String(d.getHours()%12||12).padStart(2,'0'))
        .replace(/%M/g, String(d.getMinutes()).padStart(2,'0'))
        .replace(/%S/g, String(d.getSeconds()).padStart(2,'0'))
        .replace(/%p/g, d.getHours()<12?'AM':'PM');
}

/** Apply a single Liquid filter to a string value */
function applyLiquidFilter(value: string, filter: string): string {
    const f = filter.trim();
    if (f === 'upcase') return value.toUpperCase();
    if (f === 'downcase') return value.toLowerCase();
    if (f === 'capitalize') return value ? value[0].toUpperCase() + value.slice(1) : '';
    if (f === 'strip') return value.trim();
    if (f === 'lstrip') return value.trimStart();
    if (f === 'rstrip') return value.trimEnd();
    if (f === 'strip_html') return value.replace(/<[^>]*>/g, '');
    if (f === 'newline_to_br') return value.replace(/\n/g, '<br>');
    if (f === 'escape') return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    if (f === 'url_encode') return encodeURIComponent(value);
    if (f === 'size') return String(value.length);
    if (f === 'reverse') return value.split('').reverse().join('');

    const truncM = f.match(/^truncate:\s*(\d+)(?:,\s*["']([^"']*)["'])?$/);
    if (truncM) {
        const n = parseInt(truncM[1]); const ellipsis = truncM[2] ?? '...';
        return value.length > n ? value.slice(0, Math.max(0, n - ellipsis.length)) + ellipsis : value;
    }
    const truncWordsM = f.match(/^truncatewords:\s*(\d+)(?:,\s*["']([^"']*)["'])?$/);
    if (truncWordsM) {
        const words = value.split(/\s+/); const n = parseInt(truncWordsM[1]); const e = truncWordsM[2] ?? '...';
        return words.length > n ? words.slice(0, n).join(' ') + e : value;
    }
    const replaceM = f.match(/^replace:\s*["']([^"']*)["'],\s*["']([^"']*)["']$/);
    if (replaceM) return value.split(replaceM[1]).join(replaceM[2]);
    const replaceFirstM = f.match(/^replace_first:\s*["']([^"']*)["'],\s*["']([^"']*)["']$/);
    if (replaceFirstM) return value.replace(replaceFirstM[1], replaceFirstM[2]);
    const removeM = f.match(/^remove:\s*["']([^"']*)["']$/);
    if (removeM) return value.split(removeM[1]).join('');
    const prependM = f.match(/^prepend:\s*["']([^"']*)["']$/);
    if (prependM) return prependM[1] + value;
    const appendM = f.match(/^append:\s*["']([^"']*)["']$/);
    if (appendM) return value + appendM[1];
    const defaultM = f.match(/^default:\s*["']([^"']*)["']$/);
    if (defaultM) return value && value.trim() ? value : defaultM[1];
    const sliceM = f.match(/^slice:\s*(-?\d+)(?:,\s*(\d+))?$/);
    if (sliceM) { const s = parseInt(sliceM[1]); const l = sliceM[2] ? parseInt(sliceM[2]) : 1; return value.slice(s, s < 0 ? undefined : s + l); }
    const dateM = f.match(/^date:\s*["']([^"']*)["']$/);
    if (dateM) { const d = new Date(value); return isNaN(d.getTime()) ? value : formatLiquidDate(d, dateM[1]); }
    const splitM = f.match(/^split:\s*["']([^"']*)["']$/);
    if (splitM) return value.split(splitM[1]).join(' '); // join with space for display
    const timesM = f.match(/^times:\s*([\d.]+)$/);
    if (timesM) return String(parseFloat(value) * parseFloat(timesM[1]));
    const plusM = f.match(/^plus:\s*([\d.]+)$/);
    if (plusM) return String(parseFloat(value) + parseFloat(plusM[1]));
    const minusM = f.match(/^minus:\s*([\d.]+)$/);
    if (minusM) return String(parseFloat(value) - parseFloat(minusM[1]));
    const dividedM = f.match(/^divided_by:\s*([\d.]+)$/);
    if (dividedM) return String(parseFloat(value) / parseFloat(dividedM[1]));
    const modM = f.match(/^modulo:\s*([\d.]+)$/);
    if (modM) return String(parseFloat(value) % parseFloat(modM[1]));
    if (f === 'abs') return String(Math.abs(parseFloat(value)));
    if (f === 'ceil') return String(Math.ceil(parseFloat(value)));
    if (f === 'floor') return String(Math.floor(parseFloat(value)));
    if (f === 'round') return String(Math.round(parseFloat(value)));
    const roundM = f.match(/^round:\s*(\d+)$/);
    if (roundM) return parseFloat(value).toFixed(parseInt(roundM[1]));

    return value; // unknown filter — passthrough
}

/** Apply a chain of filters: "upcase | truncate: 10 | append: '!'" */
function applyFilterChain(value: string, filterChain: string): string {
    // Split respecting quoted commas: split on | that are not inside quotes
    const filters: string[] = [];
    let cur = ''; let inQ = false; let qChar = '';
    for (let i = 0; i < filterChain.length; i++) {
        const c = filterChain[i];
        if ((c === '"' || c === "'") && !inQ) { inQ = true; qChar = c; cur += c; }
        else if (c === qChar && inQ) { inQ = false; cur += c; }
        else if (c === '|' && !inQ) { filters.push(cur.trim()); cur = ''; }
        else { cur += c; }
    }
    if (cur.trim()) filters.push(cur.trim());
    return filters.filter(Boolean).reduce((v, f) => applyLiquidFilter(v, f), value);
}

/** Evaluate a single Liquid condition atom (no and/or) */
function evalAtom(expr: string, row: Row, assigns: Row): boolean {
    const e = expr.trim();
    // blank / present
    if (e.endsWith(' == blank') || e.endsWith('== empty')) return !(row[e.split(/\s/)[0]] || '').trim();
    if (e.endsWith(' != blank') || e.endsWith('!= empty')) return !!(row[e.split(/\s/)[0]] || '').trim();

    const containsM = e.match(/^(.+?)\s+contains\s+"([^"]*)"$/);
    if (containsM) return (row[containsM[1].trim()] ?? assigns[containsM[1].trim()] ?? '').toLowerCase().includes(containsM[2].toLowerCase());
    const containsMs = e.match(/^(.+?)\s+contains\s+'([^']*)'$/);
    if (containsMs) return (row[containsMs[1].trim()] ?? assigns[containsMs[1].trim()] ?? '').toLowerCase().includes(containsMs[2].toLowerCase());

    const eqDQ = e.match(/^(.+?)\s*==\s*"([^"]*)"$/);
    if (eqDQ) return (row[eqDQ[1].trim()] ?? assigns[eqDQ[1].trim()] ?? '') === eqDQ[2];
    const eqSQ = e.match(/^(.+?)\s*==\s*'([^']*)'$/);
    if (eqSQ) return (row[eqSQ[1].trim()] ?? assigns[eqSQ[1].trim()] ?? '') === eqSQ[2];

    const neqDQ = e.match(/^(.+?)\s*!=\s*"([^"]*)"$/);
    if (neqDQ) return (row[neqDQ[1].trim()] ?? assigns[neqDQ[1].trim()] ?? '') !== neqDQ[2];
    const neqSQ = e.match(/^(.+?)\s*!=\s*'([^']*)'$/);
    if (neqSQ) return (row[neqSQ[1].trim()] ?? assigns[neqSQ[1].trim()] ?? '') !== neqSQ[2];

    const gtM = e.match(/^(.+?)\s*>\s*([\d.]+)$/);
    if (gtM) return parseFloat(row[gtM[1].trim()] ?? assigns[gtM[1].trim()] ?? '0') > parseFloat(gtM[2]);
    const ltM = e.match(/^(.+?)\s*<\s*([\d.]+)$/);
    if (ltM) return parseFloat(row[ltM[1].trim()] ?? assigns[ltM[1].trim()] ?? '0') < parseFloat(ltM[2]);
    const gteM = e.match(/^(.+?)\s*>=\s*([\d.]+)$/);
    if (gteM) return parseFloat(row[gteM[1].trim()] ?? assigns[gteM[1].trim()] ?? '0') >= parseFloat(gteM[2]);
    const lteM = e.match(/^(.+?)\s*<=\s*([\d.]+)$/);
    if (lteM) return parseFloat(row[lteM[1].trim()] ?? assigns[lteM[1].trim()] ?? '0') <= parseFloat(lteM[2]);

    // plain variable
    const varVal = row[e] ?? assigns[e] ?? '';
    return !!(varVal && varVal.trim() && varVal !== 'false' && varVal !== 'nil');
}

/** Evaluate Liquid condition supporting `and` / `or` */
function evalCondition(expr: string, row: Row, assigns: Row): boolean {
    // `and` has higher precedence than `or` in Liquid
    if (/ or /.test(expr)) return expr.split(/ or /).some(part => evalCondition(part.trim(), row, assigns));
    if (/ and /.test(expr)) return expr.split(/ and /).every(part => evalAtom(part.trim(), row, assigns));
    return evalAtom(expr, row, assigns);
}

/** Resolve a Liquid variable expression (with filter chain) */
function resolveExpr(expr: string, row: Row, assigns: Row): string {
    const pipeIdx = expr.search(/\|(?![^"']*["'][^"']*$)/); // first unquoted pipe
    if (pipeIdx === -1) {
        const varName = expr.trim();
        return row[varName] ?? assigns[varName] ?? '';
    }
    const varName = expr.slice(0, pipeIdx).trim();
    const chain = expr.slice(pipeIdx + 1);
    const base = row[varName] ?? assigns[varName] ?? '';
    return applyFilterChain(base, chain);
}

/** Process all Liquid block tags in a template given row data */
function processLiquidBlocks(template: string, row: Row, assigns: Row): string {
    let result = template;

    // Remove comments
    result = result.replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, '');

    // {% assign var = expr %}
    result = result.replace(/\{%-?\s*assign\s+(\w+)\s*=\s*([\s\S]+?)\s*-?%\}/g, (_, varName, expr) => {
        const strM = expr.trim().match(/^["']([^"']*)["']$/);
        if (strM) { assigns[varName] = strM[1]; }
        else { assigns[varName] = resolveExpr(expr.trim(), row, assigns); }
        return '';
    });

    // {% capture var %}...{% endcapture %}
    result = result.replace(/\{%-?\s*capture\s+(\w+)\s*-?%\}([\s\S]*?)\{%-?\s*endcapture\s*-?%\}/g, (_, varName, body) => {
        assigns[varName] = body.trim();
        return '';
    });

    // {% unless %}...{% endunless %}
    result = result.replace(/\{%-?\s*unless\s+([\s\S]+?)\s*-?%\}([\s\S]*?)\{%-?\s*endunless\s*-?%\}/g, (_, cond, body) => {
        const [unlessPart, ...rest] = body.split(/\{%-?\s*else\s*-?%\}/);
        const elsePart = rest.join('{% else %}');
        return evalCondition(cond, row, assigns) ? (elsePart ?? '') : unlessPart;
    });

    // {% if %}...{% elsif %}...{% else %}...{% endif %}
    result = result.replace(/\{%-?\s*if\s+([\s\S]+?)\s*-?%\}([\s\S]*?)\{%-?\s*endif\s*-?%\}/g, (_, cond, body) => {
        const [ifPart, ...elseRest] = body.split(/\{%-?\s*else\s*-?%\}/);
        const elsePart = elseRest.join('{% else %}');
        const ifSegs = ifPart.split(/\{%-?\s*elsif\s+([\s\S]+?)\s*-?%\}/);
        if (evalCondition(cond, row, assigns)) return ifSegs[0];
        for (let i = 1; i < ifSegs.length; i += 2) {
            if (evalCondition(ifSegs[i], row, assigns)) return ifSegs[i + 1] ?? '';
        }
        return elsePart ?? '';
    });

    return result;
}

/** Full Liquid render: blocks → assigns → variable expressions */
function renderTemplate(template: string, row: Row): string {
    const assigns: Row = {};

    // 1. Process all block tags
    let result = processLiquidBlocks(template, row, assigns);

    // 2. {{- whitespace control -}}
    result = result.replace(/\{\{-\s*([\s\S]+?)\s*-\}\}/g, (_, expr) => resolveExpr(expr, row, assigns).trim());
    result = result.replace(/\{\{-\s*([\s\S]+?)\s*\}\}/g, (_, expr) => resolveExpr(expr, row, assigns));
    result = result.replace(/\{\{\s*([\s\S]+?)\s*-\}\}/g, (_, expr) => resolveExpr(expr, row, assigns));

    // 3. {{ expr | filters }}
    result = result.replace(/\{\{([^{}%]+)\}\}/g, (_, expr) => resolveExpr(expr, row, assigns));

    return result;
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

export default function ElixirPage() {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'data' | 'template' | 'send'>('data');

    // Data state
    const [headers, setHeaders] = useState<string[]>([]);
    const [allRows, setAllRows] = useState<Row[]>([]);
    const [columnTypes, setColumnTypes] = useState<Record<string, ColumnType>>({});
    const [filters, setFilters] = useState<FilterValue[]>([]);
    const [recipientColumn, setRecipientColumn] = useState<string>('');
    const [isDragging, setIsDragging] = useState(false);
    const [fileName, setFileName] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);

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

    const previewRow = filteredRows[previewRowIndex] || {};
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
                        <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                            <Zap className="h-4 w-4 text-violet-500" />
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
                                "bg-violet-600 text-white hover:bg-violet-700 active:scale-95",
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
                                activeTab === tab.id ? "border-violet-500 text-violet-600" : "border-transparent text-muted-foreground hover:text-foreground"
                            )}>
                            <tab.icon className="h-4 w-4" />
                            {tab.label}
                            {tab.id === 'send' && results.length > 0 && (
                                <span className="ml-1 text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">{results.length}</span>
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
                            onDrop={handleDrop}
                            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                            onDragLeave={() => setIsDragging(false)}
                            onFileClick={() => fileInputRef.current?.click()}
                            onFileChange={handleFileChange}
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
    isDragging, fileInputRef, onDrop, onDragOver, onDragLeave,
    onFileClick, onFileChange, onAddFilter, onUpdateFilter, onRemoveFilter, onSetRecipientColumn,
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
    onDrop: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onFileClick: () => void;
    onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
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
                    <div
                        onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave} onClick={onFileClick}
                        className={cn(
                            "border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all",
                            isDragging ? "border-violet-400 bg-violet-50" : "border-border hover:border-violet-300 hover:bg-muted/30"
                        )}
                    >
                        <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                        {fileName
                            ? <p className="text-sm font-medium truncate">{fileName}</p>
                            : <>
                                <p className="text-sm font-medium">Subir archivo</p>
                                <p className="text-xs text-muted-foreground mt-1">CSV o Excel (.xlsx)</p>
                            </>
                        }
                    </div>
                    <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFileChange} />
                    {allRows.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-2 text-center">{allRows.length} filas · {headers.length} columnas</p>
                    )}
                </div>

                {/* Recipient column */}
                {headers.length > 0 && (
                    <div className="p-4 border-b border-border">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Columna de email</p>
                        <select
                            value={recipientColumn} onChange={e => onSetRecipientColumn(e.target.value)}
                            className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-violet-400"
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
                            <button onClick={onAddFilter} className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-medium">
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
                                            h === recipientColumn ? "text-violet-600" : "text-muted-foreground"
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
                    className="flex-1 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-violet-400"
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
                className="w-full text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-violet-400"
            >
                {ops.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {needsValue && (
                <input
                    type={inputType}
                    value={filter.value}
                    onChange={e => onUpdate({ value: e.target.value })}
                    placeholder={filter.op === 'between' || filter.op === 'date_between' ? 'Desde...' : 'Valor...'}
                    className="w-full text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
            )}
            {needsSecondValue && (
                <input
                    type={inputType}
                    value={filter.value2 || ''}
                    onChange={e => onUpdate({ value2: e.target.value })}
                    placeholder="Hasta..."
                    className="w-full text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-violet-400"
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
    previewSubject, previewHtml, senderConfig, importTemplateRef,
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
    const insertVar = (varName: string) => onTemplateChange(templateHtml + `{{${varName}}}`);
    const sc = senderConfig;
    const set = (k: keyof SenderConfig) => (v: string) => onSenderConfigChange({ ...sc, [k]: v });

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
                    <span className="ml-auto text-[11px] text-muted-foreground">Acepta .liquid · .html · .json</span>
                </div>

                {/* Sender config */}
                <div className="px-4 py-3 border-b border-border shrink-0 bg-muted/10 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Configuración de envío</p>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="text-[10px] text-muted-foreground block mb-1">Nombre remitente</label>
                            <input value={sc.fromName} onChange={e => set('fromName')(e.target.value)}
                                placeholder="{{nombre}} (tu empresa)"
                                className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-violet-400" />
                        </div>
                        <div>
                            <label className="text-[10px] text-muted-foreground block mb-1">Email remitente</label>
                            <input value={sc.fromEmail} onChange={e => set('fromEmail')(e.target.value)}
                                placeholder="tu@empresa.com"
                                className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-violet-400" />
                        </div>
                        <div>
                            <label className="text-[10px] text-muted-foreground block mb-1">CC (copia)</label>
                            <input value={sc.cc} onChange={e => set('cc')(e.target.value)}
                                placeholder="cc@empresa.com · admite {{columna}}"
                                className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-violet-400" />
                        </div>
                        <div>
                            <label className="text-[10px] text-muted-foreground block mb-1">BCC (copia oculta)</label>
                            <input value={sc.bcc} onChange={e => set('bcc')(e.target.value)}
                                placeholder="bcc@empresa.com · admite {{columna}}"
                                className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-violet-400" />
                        </div>
                    </div>
                </div>

                {/* Subject */}
                <div className="px-4 py-3 border-b border-border shrink-0">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Asunto</label>
                    <input type="text" value={subject} onChange={e => onSubjectChange(e.target.value)}
                        className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-violet-400 font-medium"
                        placeholder="Hola {{nombre | default: 'ahí'}} — admite Liquid" />
                </div>

                {/* Variables */}
                {headers.length > 0 && (
                    <div className="px-4 py-2 border-b border-border shrink-0 bg-muted/20">
                        <p className="text-xs text-muted-foreground mb-1.5 font-medium">Variables disponibles (click para insertar):</p>
                        <div className="flex flex-wrap gap-1.5">
                            {headers.map(h => (
                                <button key={h} onClick={() => insertVar(h)}
                                    className="text-xs bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 rounded-full hover:bg-violet-100 transition-colors font-mono">
                                    {`{{${h}}}`}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

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

                        <span className="col-span-2 text-[10px] font-bold text-amber-900 mt-1.5 uppercase tracking-wider">Filtros de texto</span>
                        <span>{`| upcase / downcase`}</span>
                        <span>{`| capitalize`}</span>
                        <span>{`| strip / lstrip / rstrip`}</span>
                        <span>{`| strip_html`}</span>
                        <span>{`| truncate: 50`}</span>
                        <span>{`| truncate: 50, "…"`}</span>
                        <span>{`| truncatewords: 10`}</span>
                        <span>{`| replace: "old", "new"`}</span>
                        <span>{`| remove: "texto"`}</span>
                        <span>{`| prepend: "Hola "`}</span>
                        <span>{`| append: "!"`}</span>
                        <span>{`| escape / url_encode`}</span>
                        <span>{`| newline_to_br`}</span>
                        <span>{`| size`}</span>

                        <span className="col-span-2 text-[10px] font-bold text-amber-900 mt-1.5 uppercase tracking-wider">Filtros numéricos</span>
                        <span>{`| plus: 10 / minus: 5`}</span>
                        <span>{`| times: 2 / divided_by: 3`}</span>
                        <span>{`| round / ceil / floor`}</span>
                        <span>{`| round: 2`}</span>
                        <span>{`| abs / modulo: 7`}</span>
                        <span>{`| default: "0"`}</span>

                        <span className="col-span-2 text-[10px] font-bold text-amber-900 mt-1.5 uppercase tracking-wider">Filtros de fecha</span>
                        <span>{`| date: "%B %d, %Y"`}</span>
                        <span>{`| date: "%d/%m/%Y"`}</span>
                        <span>{`%Y %m %d %H %M %S %B %b`}</span>
                        <span>{`%A (día) %p (AM/PM)`}</span>

                        <span className="col-span-2 text-[10px] font-bold text-amber-900 mt-1.5 uppercase tracking-wider">Cadena de filtros</span>
                        <span className="col-span-2">{`{{campo | upcase | truncate: 20 | append: "..."}}`}</span>

                        <span className="col-span-2 text-[10px] font-bold text-amber-900 mt-1.5 uppercase tracking-wider">Control de flujo</span>
                        <span>{`{% if campo %} … {% endif %}`}</span>
                        <span>{`{% unless campo %} … {% endunless %}`}</span>
                        <span>{`{% if a == "X" %} … {% else %} … {% endif %}`}</span>
                        <span>{`{% if a contains "X" %} … {% endif %}`}</span>
                        <span>{`{% if a > 100 and b != "Y" %} … {% endif %}`}</span>
                        <span>{`{% if a or b %} … {% elsif c %} … {% endif %}`}</span>

                        <span className="col-span-2 text-[10px] font-bold text-amber-900 mt-1.5 uppercase tracking-wider">Asignación</span>
                        <span>{`{% assign x = campo | upcase %}`}</span>
                        <span>{`{% capture x %}texto {{campo}}{% endcapture %}`}</span>
                    </div>
                </details>

                {/* Liquid Code Editor (CodeMirror 6) */}
                <div className="flex-1 min-h-0 border-t border-border overflow-hidden">
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
                        />
                    </Suspense>
                </div>
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
                                                <span className="text-xs font-mono text-violet-600 shrink-0 w-32 truncate">{h}</span>
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
                    <Zap className="h-10 w-10 text-violet-500" />
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
