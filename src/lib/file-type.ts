// Deteccion del tipo REAL de un archivo por sus "magic bytes" y validacion frente al tipo/extension declarados.
// CIS v8 9.6 (bloquear tipos de archivo innecesarios), NIST 800-53 SI-3 / SI-10, ISO 27001:2022 A.8.7 / A.8.26.
// Sin dependencias. No sustituye a un antivirus (ver av-hook.ts); reduce el riesgo de ejecutables/HTML disfrazados.

import { hasDangerousExtension, isActiveContentType } from './mail-validation';

export type FileFamily = 'image' | 'document' | 'archive' | 'audio' | 'video' | 'text' | 'executable' | 'active' | 'unknown';

export interface DetectedType {
    mime: string;
    family: FileFamily;
    /** Ejecutable / script nativo: nunca debe entregarse como adjunto. */
    dangerous: boolean;
    /** Contenido que un navegador puede ejecutar (html/svg/xml con script): se sirve solo como binario opaco. */
    active: boolean;
}

const t = (mime: string, family: FileFamily, extra: Partial<DetectedType> = {}): DetectedType => ({
    mime, family, dangerous: false, active: false, ...extra,
});

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
    if (buf.length < offset + bytes.length) return false;
    for (let i = 0; i < bytes.length; i++) if (buf[offset + i] !== bytes[i]) return false;
    return true;
}
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));
function asciiAt(buf: Buffer, s: string, offset = 0) { return startsWith(buf, ascii(s), offset); }

function looksLikeText(buf: Buffer): boolean {
    const n = Math.min(buf.length, 8000);
    if (n === 0) return false;
    let suspicious = 0;
    for (let i = 0; i < n; i++) {
        const b = buf[i];
        if (b === 0) return false;
        if (b < 7 || (b > 13 && b < 32 && b !== 27)) suspicious++;
    }
    return suspicious / n < 0.02;
}

export function detectFileType(buf: Buffer): DetectedType {
    if (!buf || buf.length === 0) return t('application/octet-stream', 'unknown');

    // --- ejecutables (peligrosos)
    if (asciiAt(buf, 'MZ')) {
        // "MZ" son 2 bytes: un texto plano puede empezar asi. Se exige firma PE valida o contenido no textual.
        let pe = false;
        if (buf.length >= 0x40) {
            const off = buf.readUInt32LE(0x3c);
            pe = off + 4 <= buf.length && buf.toString('latin1', off, off + 4) === 'PE\0\0';
        }
        if (pe || !looksLikeText(buf)) return t('application/x-msdownload', 'executable', { dangerous: true });
    }
    if (startsWith(buf, [0x7f, 0x45, 0x4c, 0x46])) return t('application/x-elf', 'executable', { dangerous: true });
    if (
        startsWith(buf, [0xfe, 0xed, 0xfa, 0xce]) || startsWith(buf, [0xfe, 0xed, 0xfa, 0xcf]) ||
        startsWith(buf, [0xce, 0xfa, 0xed, 0xfe]) || startsWith(buf, [0xcf, 0xfa, 0xed, 0xfe]) ||
        startsWith(buf, [0xca, 0xfe, 0xba, 0xbe])
    ) return t('application/x-mach-binary', 'executable', { dangerous: true }); // incluye .class de Java
    if (asciiAt(buf, '#!')) return t('text/x-script', 'executable', { dangerous: true });

    // --- imagenes
    if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return t('image/png', 'image');
    if (startsWith(buf, [0xff, 0xd8, 0xff])) return t('image/jpeg', 'image');
    if (asciiAt(buf, 'GIF87a') || asciiAt(buf, 'GIF89a')) return t('image/gif', 'image');
    if (asciiAt(buf, 'RIFF') && asciiAt(buf, 'WEBP', 8)) return t('image/webp', 'image');
    if (startsWith(buf, [0x49, 0x49, 0x2a, 0x00]) || startsWith(buf, [0x4d, 0x4d, 0x00, 0x2a])) return t('image/tiff', 'image');
    if (startsWith(buf, [0x00, 0x00, 0x01, 0x00])) return t('image/x-icon', 'image');

    // --- documentos
    if (asciiAt(buf, '%PDF-')) return t('application/pdf', 'document');
    if (asciiAt(buf, '{\\rtf')) return t('application/rtf', 'document');
    if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return t('application/x-ole-storage', 'document'); // doc/xls/ppt/msg/msi

    // --- contenedores ZIP (y derivados ofimaticos / jar / apk)
    if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06]) || startsWith(buf, [0x50, 0x4b, 0x07, 0x08])) {
        const head = buf.subarray(0, Math.min(buf.length, 8192)).toString('latin1');
        if (head.includes('word/')) return t('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document');
        if (head.includes('xl/')) return t('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'document');
        if (head.includes('ppt/')) return t('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'document');
        if (head.includes('META-INF/MANIFEST.MF')) return t('application/java-archive', 'executable', { dangerous: true });
        if (head.includes('AndroidManifest.xml')) return t('application/vnd.android.package-archive', 'executable', { dangerous: true });
        return t('application/zip', 'archive');
    }
    if (startsWith(buf, [0x1f, 0x8b])) return t('application/gzip', 'archive');
    if (startsWith(buf, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return t('application/x-7z-compressed', 'archive');
    if (startsWith(buf, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return t('application/vnd.rar', 'archive');
    if (asciiAt(buf, 'BZh')) return t('application/x-bzip2', 'archive');
    if (startsWith(buf, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return t('application/x-xz', 'archive');
    if (asciiAt(buf, 'ustar', 257)) return t('application/x-tar', 'archive');

    // --- audio / video
    if (asciiAt(buf, 'ID3') || startsWith(buf, [0xff, 0xfb]) || startsWith(buf, [0xff, 0xf3])) return t('audio/mpeg', 'audio');
    if (asciiAt(buf, 'OggS')) return t('audio/ogg', 'audio');
    if (asciiAt(buf, 'fLaC')) return t('audio/flac', 'audio');
    if (asciiAt(buf, 'RIFF') && asciiAt(buf, 'WAVE', 8)) return t('audio/wav', 'audio');
    if (asciiAt(buf, 'RIFF') && asciiAt(buf, 'AVI ', 8)) return t('video/x-msvideo', 'video');
    if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return t('video/webm', 'video');
    if (asciiAt(buf, 'ftyp', 4)) {
        const brand = buf.subarray(8, 12).toString('latin1');
        if (/^(heic|heix|hevc|mif1|msf1)/.test(brand)) return t('image/heic', 'image');
        if (brand === 'qt  ') return t('video/quicktime', 'video');
        if (brand.startsWith('M4A')) return t('audio/mp4', 'audio');
        return t('video/mp4', 'video');
    }

    // --- texto: html/svg/xml activo vs texto plano
    const headText = buf.subarray(0, Math.min(buf.length, 2048)).toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase();
    if (/^(<!doctype\s+html|<html|<head|<body|<script|<iframe|<meta\s|<link\s|<object|<embed)/.test(headText)) {
        return t('text/html', 'active', { active: true });
    }
    if (/^<svg[\s>]/.test(headText) || (/^<\?xml/.test(headText) && headText.includes('<svg'))) {
        return t('image/svg+xml', 'active', { active: true });
    }
    if (/^<\?xml/.test(headText)) return t('application/xml', 'active', { active: true });
    if (looksLikeText(buf)) return t('text/plain', 'text');

    return t('application/octet-stream', 'unknown');
}

// ---------------------------------------------------------------------------
// Validacion
// ---------------------------------------------------------------------------
export type AttachmentVerdict = 'clean' | 'sanitized' | 'blocked';

export interface AttachmentValidation {
    verdict: AttachmentVerdict;
    /** Content-Type con el que debe guardarse el objeto. */
    storeMime: string;
    detected: DetectedType;
    /** blocked_executable | blocked_extension | blocked_mismatch | active_content | type_mismatch | ok */
    reason: string;
}

const EXT_CLAIMS: Array<[RegExp, FileFamily]> = [
    [/\.(png|jpe?g|gif|webp|tiff?|heic|ico)$/i, 'image'],
    [/\.(pdf|docx?|xlsx?|pptx?|rtf|odt|ods|odp)$/i, 'document'],
    [/\.(mp3|ogg|wav|flac|m4a)$/i, 'audio'],
    [/\.(mp4|mov|webm|avi|mkv)$/i, 'video'],
];

function declaredFamily(declaredMime: string, filename: string): FileFamily | null {
    const m = String(declaredMime || '').toLowerCase();
    if (m.startsWith('image/') && !m.includes('svg')) return 'image';
    if (m === 'application/pdf' || m.includes('officedocument') || m === 'application/msword' || m === 'application/rtf' || m.includes('ms-excel') || m.includes('ms-powerpoint')) return 'document';
    if (m.startsWith('audio/')) return 'audio';
    if (m.startsWith('video/')) return 'video';
    for (const [re, fam] of EXT_CLAIMS) if (re.test(filename || '')) return fam;
    return null;
}

/**
 * Valida un adjunto por contenido.
 *  - direction "upload": subida del usuario (se rechaza lo sospechoso, el llamador responde 400).
 *  - direction "inbound": correo recibido (no se puede pedir al remitente que corrija: se bloquea lo peligroso y se
 *    sanea el Content-Type de lo raro; el adjunto queda como binario opaco).
 */
export function validateAttachment(input: {
    filename: string;
    declaredMime?: string;
    buffer: Buffer;
    direction: 'upload' | 'inbound';
}): AttachmentValidation {
    const detected = detectFileType(input.buffer);
    const declared = String(input.declaredMime || 'application/octet-stream').toLowerCase().split(';')[0].trim();
    const opaque = 'application/octet-stream';

    if (detected.dangerous) {
        return { verdict: 'blocked', storeMime: opaque, detected, reason: 'blocked_executable' };
    }
    if (hasDangerousExtension(input.filename)) {
        const blockInbound = process.env.INBOUND_BLOCK_DANGEROUS_EXT !== 'false';
        if (input.direction === 'upload' || blockInbound) {
            return { verdict: 'blocked', storeMime: opaque, detected, reason: 'blocked_extension' };
        }
    }

    const claim = declaredFamily(declared, input.filename);

    if (detected.active) {
        // Declara ser imagen/pdf/etc. pero es HTML/SVG/XML: disfrazado
        if (claim && claim !== 'text') {
            return input.direction === 'upload'
                ? { verdict: 'blocked', storeMime: opaque, detected, reason: 'blocked_mismatch' }
                : { verdict: 'sanitized', storeMime: opaque, detected, reason: 'active_content' };
        }
        return { verdict: 'sanitized', storeMime: opaque, detected, reason: 'active_content' };
    }
    if (isActiveContentType(declared)) {
        return { verdict: 'sanitized', storeMime: opaque, detected, reason: 'active_content' };
    }

    // Declara imagen/documento/audio/video pero el contenido es un contenedor comprimido o no coincide de familia
    if (claim && detected.family !== 'unknown' && detected.family !== 'text' && detected.family !== claim) {
        const hiddenContainer = detected.family === 'archive';
        if (input.direction === 'upload' && hiddenContainer) {
            return { verdict: 'blocked', storeMime: opaque, detected, reason: 'blocked_mismatch' };
        }
        return { verdict: 'sanitized', storeMime: detected.mime, detected, reason: 'type_mismatch' };
    }
    // Declara una familia binaria pero el contenido es texto plano
    if (claim && detected.family === 'text' && (claim === 'image' || claim === 'document' && /\.pdf$/i.test(input.filename))) {
        return input.direction === 'upload'
            ? { verdict: 'blocked', storeMime: opaque, detected, reason: 'blocked_mismatch' }
            : { verdict: 'sanitized', storeMime: opaque, detected, reason: 'type_mismatch' };
    }

    // Tipo declarado genuino: se conserva; si venia como octet-stream y se reconoce, se mejora
    const storeMime = declared && declared !== opaque ? declared : detected.family === 'unknown' ? opaque : detected.mime;
    return { verdict: 'clean', storeMime, detected, reason: 'ok' };
}
