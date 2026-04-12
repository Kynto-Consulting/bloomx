'use client';

import { useCompose } from '@/contexts/ComposeContext';
import { ComposeModal } from './ComposeModal';

export function ComposeWindows() {
    const { windows } = useCompose();

    return (
        <>
            {windows.map((window, index) => (
                <ComposeModal
                    key={window.id}
                    id={window.id}
                    initialFrom={window.from}
                    initialTo={window.to}
                    initialCc={window.cc}
                    initialBcc={window.bcc}
                    initialSubject={window.subject}
                    initialBody={window.body}
                    initialMinimized={window.minimized}
                    initialDraftId={window.draftId}
                    initialAttachments={window.attachments}
                    index={index}
                />
            ))}
        </>
    );
}
