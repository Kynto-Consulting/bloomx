import { csvCell } from '@/lib/admin/csv';

export interface Credential { email: string; password: string; mustChange: boolean }

const BOM = String.fromCharCode(0xfeff);

/** CSV de credenciales (neutraliza formulas de hoja de calculo). Solo vive en memoria del navegador. */
export function credentialsToCsv(rows: Credential[]): string {
    const lines = [['email', 'password', 'must_change_password'].map(csvCell).join(',')];
    for (const r of rows) lines.push([r.email, r.password, r.mustChange ? 'yes' : 'no'].map(csvCell).join(','));
    return BOM + lines.join('\r\n') + '\r\n';
}

/** Descarga un CSV desde memoria (Blob). */
export function downloadTextFile(name: string, content: string): void {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = href;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        setTimeout(() => URL.revokeObjectURL(href), 1000);
    }
}
