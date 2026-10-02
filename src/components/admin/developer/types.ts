/** Respuestas del backend del marketplace (contrato en bloomx-backend), tal como las reenvia /api/admin/developer/**. */

export type VersionStatus = 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'published' | 'rejected' | 'yanked';
export type ExtensionStatus = 'private' | 'active' | 'yanked' | 'suspended';
export type Risk = 'low' | 'medium' | 'high';

export interface Finding { id: string; severity: string; message: string; path?: string }
export interface Analysis { score?: number; risk: Risk; findings: Finding[] }

export interface PricingValue {
    model: 'free' | 'one_time' | 'subscription';
    oneTimeCents?: number;
    monthCents?: number;
    yearCents?: number;
    trialDays?: number;
}

export interface DevVersion {
    version: string; status: VersionStatus; changelog: string; submittedAt: string | null; reviewedAt: string | null; reviewNote: string | null; analysis?: Analysis | null;
    /** Envio al que pertenece la version: habilita enviar / retirar / publicar (POST submissions/:id/submit|withdraw|publish). */
    submissionId?: string;
}
export interface DevExtension {
    id: string; name: string; pricing: PricingValue | null; status: ExtensionStatus; latestVersion: string | null; versions: DevVersion[];
}
export interface DevOverview {
    /** false = el backend tiene apagada la publicacion de terceros (MARKETPLACE_THIRD_PARTY_ENABLED). Ausente (backend antiguo) = se asume encendida. */
    thirdPartyEnabled?: boolean;
    slug: string; idPrefix: string;
    terms: { requiredVersion: string; acceptedVersion: string | null; acceptedAt: string | null };
    paypal: { status: string; emailMasked: string | null };
    shares: { developerBps: number; platformBps: number };
    limits: { minPriceCents: number; maxPriceCents: number; maxServerBytes: number; maxManifestBytes: number; maxIconBytes?: number; maxReadmeBytes?: number };
    extensions: DevExtension[];
}

export interface ValidateIssue { path: string; message: string; severity: 'error' | 'warning' }
export interface ValidateResult {
    ok: boolean;
    issues: ValidateIssue[];
    analysis: Analysis;
    versioning: { lastVersion: string | null; increases: boolean; suggested: { patch: string; minor: string; major: string }; changelogRequired: boolean };
    permissionsDiff: { added: string[]; removed: string[]; unchanged: string[] };
    sizes?: Record<string, number>;
}
