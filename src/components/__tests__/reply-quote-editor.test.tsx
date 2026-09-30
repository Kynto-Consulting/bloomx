// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Editor } from '../Editor';
import { buildReplyQuote } from '@/lib/reply-builder';
import { sanitizeHtml } from '@/lib/sanitizeHtml';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Respuesta de Gmail movil: cuerpo en <div dir="auto"> con lineas vacias al inicio y un historial anidado de 3 niveles.
const ORIGINAL = `<div dir="auto"><div dir="auto"><br></div><div dir="auto">Hi Sandeep,</div><div dir="auto"><br></div><div dir="auto">Thank you for your interest in the position.</div></div><br>
<div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">On Thu, Apr 2, 2026 at 9:10 PM Piero &lt;<a href="mailto:piero@example.test">piero@example.test</a>&gt; wrote:<br></div>
<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex"><div dir="auto">Earlier message level one<div dir="auto"><br></div></div><br>
<div class="gmail_quote"><div dir="ltr" class="gmail_attr">On Wed, Apr 1, 2026 Recruiter wrote:<br></div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex"><div dir="auto">Earlier message level two</div></blockquote></div></blockquote></div>`;

describe('responder: el mensaje original llega completo al redactor', () => {
    it('la cita conserva el texto del mensaje y del historial anidado', async () => {
        const quote = buildReplyQuote({ from: 'Recruiter <recruiter@example.test>', to: 'me@example.test', subject: 'Re: X', createdAt: '2026-04-03T03:34:00Z' } as any, ORIGINAL, { sanitize: sanitizeHtml } as any);
        const host = document.createElement('div');
        document.body.appendChild(host);
        await act(async () => { createRoot(host).render(React.createElement(Editor as any, { value: quote.body, onChange: () => {} })); });
        await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
        const text = host.querySelector('.ProseMirror')?.textContent ?? '';
        expect(text).toContain('Hi Sandeep,');
        expect(text).toContain('Thank you for your interest in the position.');
        expect(text).toContain('Earlier message level one');
        expect(text).toContain('Earlier message level two');
        expect(host.querySelector('.ProseMirror blockquote')).not.toBeNull();
    });
});
