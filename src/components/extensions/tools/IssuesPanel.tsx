'use client';

import React from 'react';
import type { Analysis, AnalysisIssue, IssueCategory } from '@/lib/expansions/playground/analyze';
import { groupIssues } from '@/lib/expansions/playground/analyze';
import { useToolStrings } from './strings';

function Section({ category, issues, strict, onJump }: { category: IssueCategory; issues: AnalysisIssue[]; strict: boolean; onJump?: (line: number, column?: number) => void }) {
    const t = useToolStrings();
    const groups = groupIssues(issues, category);
    const total = groups.reduce((n, g) => n + g.issues.length, 0);
    if (total === 0) return null;
    const title = category === 'error' ? t.errors : category === 'deprecation' ? t.deprecations : t.otherWarnings;
    const asError = category !== 'error' && strict;
    const tone = category === 'error' || asError ? 'text-destructive' : 'text-warning';
    const headingId = `issues-${category}`;
    return (
        <section aria-labelledby={headingId} className="space-y-2">
            <h3 id={headingId} className={`flex items-center gap-2 text-sm font-semibold ${tone}`}>
                <span>{title}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground" aria-label={t.countLabel.replace('{n}', String(total))}>{total}</span>
                {asError && <span className="text-xs font-normal text-muted-foreground">{t.countedAsErrors}</span>}
            </h3>
            {groups.map((group) => (
                <div key={group.source}>
                    <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.source === 'json' ? t.sourceJson : group.source === 'manifest' ? t.sourceManifest : t.sourceUi} ({group.issues.length})</h4>
                    <ul className="space-y-1">
                        {group.issues.map((issue, index) => {
                            const hasPos = issue.line !== undefined;
                            return (
                                <li key={`${issue.path}:${index}`} className={`rounded-md border px-2 py-1.5 text-xs ${category === 'error' || asError ? 'border-destructive/30 bg-destructive/10' : 'border-warning/30 bg-warning/10'}`}>
                                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                        <code className="break-all font-mono text-[11px] font-semibold text-foreground">{issue.path}</code>
                                        {hasPos && onJump ? (
                                            <button type="button" onClick={() => onJump(issue.line!, issue.column)} className="rounded font-mono text-[11px] text-link underline-offset-2 hover:text-link-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                                {t.cursorPos.replace('{line}', String(issue.line)).replace('{col}', String(issue.column))}
                                            </button>
                                        ) : hasPos ? <span className="font-mono text-[11px] text-muted-foreground">{issue.line}:{issue.column}</span> : null}
                                    </div>
                                    <p className="text-foreground">{issue.message}</p>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </section>
    );
}

/** Panel de validacion en linea: errores JSON/manifest/UI, avisos de obsolescencia y otros avisos, con contadores. */
export function IssuesPanel({ analysis, strict, onJump }: { analysis: Analysis; strict: boolean; onJump?: (line: number, column?: number) => void }) {
    const t = useToolStrings();
    const { counts } = analysis;
    const total = counts.errors + counts.deprecations + counts.warnings;
    const summary = analysis.status === 'empty'
        ? t.emptyText
        : total === 0
            ? t.noIssues
            : t.summary.replace('{errors}', String(counts.errors)).replace('{deprecations}', String(counts.deprecations)).replace('{warnings}', String(counts.warnings));
    return (
        <div className="space-y-3" data-testid="issues-panel">
            <p role="status" aria-live="polite" className={`text-sm ${analysis.blocking > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
                {summary}
                {strict && analysis.blocking > 0 && <span> {t.strictBlocking.replace('{n}', String(analysis.blocking))}</span>}
            </p>
            <Section category="error" issues={analysis.issues} strict={strict} onJump={onJump} />
            <Section category="deprecation" issues={analysis.issues} strict={strict} onJump={onJump} />
            <Section category="warning" issues={analysis.issues} strict={strict} onJump={onJump} />
        </div>
    );
}
