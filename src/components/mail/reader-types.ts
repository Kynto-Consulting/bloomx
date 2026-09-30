import type { EmailAuthentication } from '@/lib/email-auth';

export interface InvitePreview {
    attachmentId: string;
    filename: string;
    uid?: string | null;
    title: string;
    description?: string | null;
    location?: string | null;
    meetUrl?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    method?: string | null;
    organizerEmail?: string | null;
    organizerName?: string | null;
}

export interface InviteResponse {
    response: 'accepted' | 'tentative' | 'declined';
    respondedAt?: string;
    organizerEmail?: string;
    organizerName?: string;
    uid?: string;
}

export interface ReaderEmail {
    id: string;
    from: string;
    to: string;
    cc?: string | null;
    bcc?: string | null;
    cleanTo?: string | null;
    replyTo?: string | null;
    subject: string;
    createdAt: string;
    read: boolean;
    starred: boolean;
    folder: string;
    attachments: any[];
    labels: any[];
    snippet?: string;
}

/** Respuesta de GET /api/emails/[id] (con `thread` cuando se pide ?thread=true). */
export interface EmailDetails {
    email: ReaderEmail;
    content: string;
    invitePreview?: InvitePreview | null;
    inviteResponse?: InviteResponse | null;
    authentication?: EmailAuthentication | null;
    thread?: EmailDetails[];
}
