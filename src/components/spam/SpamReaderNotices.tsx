'use client';

import { ExternalSenderBanner } from './ExternalSenderBanner';
import { SpamWhyBanner } from './SpamWhyBanner';
import type { MessageSpam } from './useMessageSpam';

/** Avisos de spam/externo de UN mensaje del lector (aviso de externo + "Por que"). Sin datos no pinta nada. */
export function SpamReaderNotices({ id, from, folder, spam, onNotSpam }: { id: string; from: string; folder?: string | null; spam: MessageSpam; onNotSpam?: (() => void) | null }) {
    return (
        <div data-spam-notices>
            <ExternalSenderBanner messageId={id} from={from} policy={spam.policy} verdict={spam.verdict} />
            <SpamWhyBanner emailId={id} from={from} folder={folder} explain={spam.explain} onNotSpam={onNotSpam} />
        </div>
    );
}
