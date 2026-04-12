import React from 'react';
import { notFound } from 'next/navigation';
import { getFromStorage } from '@/lib/storage';
import { decrypt } from '@/lib/encryption';
import { ShieldCheck, Calendar, User } from 'lucide-react';

interface SecurePageProps {
    params: Promise<{ id: string }>;
}

export default async function SecureMessagePage({ params }: SecurePageProps) {
    const { id } = await params;

    // 1. Fetch file
    const encryptedContent = await getFromStorage(`secure/${id}.msg`);

    if (!encryptedContent) {
        return notFound();
    }

    // 2. Decrypt
    let data;
    try {
        const decryptedJson = decrypt(encryptedContent);
        data = JSON.parse(decryptedJson);
    } catch (e) {
        console.error('Decryption failed for message', id);
        return notFound();
    }

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-white rounded-lg shadow-xl overflow-hidden border border-gray-100">
                {/* Header */}
                <div className="bg-blue-600 text-white p-6 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <ShieldCheck className="w-8 h-8" />
                        <div>
                            <h1 className="text-xl font-bold">Secure Message</h1>
                            <p className="text-blue-100 text-sm">Protected by Bloomx Encryption</p>
                        </div>
                    </div>
                </div>

                {/* Metadata */}
                <div className="bg-gray-50 px-6 py-4 border-b flex flex-wrap gap-4 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                        <User className="w-4 h-4" />
                        <span className="font-semibold">From:</span> {data.sender}
                    </div>
                    <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        <span className="font-semibold">Sent:</span> {new Date(data.createdAt).toLocaleString()}
                    </div>
                </div>

                {/* Subject */}
                <div className="px-6 py-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-900">{data.subject}</h2>
                </div>

                {/* Body */}
                <div className="p-8 prose max-w-none">
                    <div dangerouslySetInnerHTML={{ __html: data.content }} />
                </div>

                {/* Footer */}
                <div className="bg-gray-50 px-6 py-4 text-center text-xs text-gray-400">
                    This message was sent securely. The link may expire.
                </div>
            </div>
        </div>
    );
}