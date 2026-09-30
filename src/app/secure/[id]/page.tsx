import React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SECURE_ID_RE } from '@/lib/sealed/schema';
import { SecureViewer } from './SecureViewer';

// Nunca cachear mensajes seguros; nunca enviar Referer (ademas de la cabecera Referrer-Policy de next.config.js).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
    title: 'Secure message',
    referrer: 'no-referrer',
    robots: { index: false, follow: false },
};

interface SecurePageProps {
    params: Promise<{ id: string }>;
}

/**
 * El servidor NO descifra nada: solo entrega el visor. El visor lee la clave del fragmento `#k=` (que el navegador
 * no envia al servidor), pide el sobre cifrado a /api/secure-message/[id] y descifra con WebCrypto.
 */
export default async function SecureMessagePage({ params }: SecurePageProps) {
    const { id } = await params;
    if (!SECURE_ID_RE.test(id)) return notFound();
    return <SecureViewer id={id} />;
}
