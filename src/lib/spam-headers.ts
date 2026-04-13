type HeaderMap = Record<string, unknown>;

export type SpamClassification = {
    score: number;
    threshold: number;
    isSpam: boolean;
    reasons: string[];
    suggestedFolder: 'inbox' | 'spam';
};

function toHeaderString(value: unknown): string {
    if (Array.isArray(value)) {
        return value.map((item) => String(item ?? '').trim()).filter(Boolean).join(', ');
    }

    if (value === null || value === undefined) {
        return '';
    }

    return String(value).trim();
}

function normalizeHeaders(headers: HeaderMap): Record<string, string> {
    const normalized: Record<string, string> = {};

    for (const [rawKey, rawValue] of Object.entries(headers || {})) {
        const key = String(rawKey || '').trim().toLowerCase();
        if (!key) continue;

        const value = toHeaderString(rawValue);
        if (!value) continue;

        normalized[key] = value;
    }

    return normalized;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function parseNumber(value: string): number | null {
    const parsed = Number.parseFloat(String(value || '').trim());
    return Number.isFinite(parsed) ? parsed : null;
}

function parseSpamScoreFromStatus(status: string): number | null {
    const match = String(status || '').match(/score\s*=\s*([+-]?\d+(?:\.\d+)?)/i);
    if (!match?.[1]) {
        return null;
    }

    return parseNumber(match[1]);
}

function normalizeProviderScore(rawScore: number): number {
    if (rawScore <= 10) {
        return rawScore * 10;
    }

    return rawScore;
}

export function classifySpamFromHeaders(headers: HeaderMap, threshold = 60): SpamClassification {
    const normalized = normalizeHeaders(headers);
    const reasons: string[] = [];
    const effectiveThreshold = clamp(Number.isFinite(threshold) ? threshold : 60, 0, 100);
    let score = 0;
    let strongVerdict = false;

    const spamFlag = normalized['x-spam-flag'] || '';
    if (/^yes$/i.test(spamFlag)) {
        score = Math.max(score, 100);
        strongVerdict = true;
        reasons.push('x-spam-flag=yes');
    }

    const spamStatus = normalized['x-spam-status'] || '';
    if (/^yes\b/i.test(spamStatus)) {
        score = Math.max(score, 80);
        strongVerdict = true;
        reasons.push('x-spam-status=yes');
    }

    const spamScoreHeader = normalized['x-spam-score'];
    const spamScoreValue = parseNumber(spamScoreHeader || '') ?? parseSpamScoreFromStatus(spamStatus);
    if (spamScoreValue !== null) {
        const normalizedScore = clamp(normalizeProviderScore(spamScoreValue), 0, 100);
        score = Math.max(score, normalizedScore);
        if (normalizedScore >= effectiveThreshold) {
            reasons.push('x-spam-score>=threshold');
        }
    }

    const authResults = normalized['authentication-results'] || '';
    if (/\bdmarc=fail\b/i.test(authResults)) {
        score += 30;
        reasons.push('authentication-results:dmarc=fail');
    }

    if (/\bspf=fail\b/i.test(authResults)) {
        score += 20;
        reasons.push('authentication-results:spf=fail');
    }

    if (/\bdkim=fail\b/i.test(authResults)) {
        score += 20;
        reasons.push('authentication-results:dkim=fail');
    }

    score = clamp(score, 0, 100);
    const isSpam = strongVerdict || score >= effectiveThreshold;

    return {
        score,
        threshold: effectiveThreshold,
        isSpam,
        reasons,
        suggestedFolder: isSpam ? 'spam' : 'inbox',
    };
}
