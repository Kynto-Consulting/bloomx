/**
 * mime-decode.ts
 * Utilities for decoding MIME headers, including RFC 2047 encoded-words,
 * header folding, and RFC 5987 extended parameter values (filename*=).
 */

/**
 * Decode a single RFC 2047 encoded-word token.
 * Handles =?charset?B?...?= (base64) and =?charset?Q?...?= (quoted-printable).
 */
function decodeEncodedWord(charset: string, encoding: string, text: string): string {
    try {
        const enc = encoding.toUpperCase();
        let bytes: Buffer;
        if (enc === 'B') {
            bytes = Buffer.from(text, 'base64');
        } else if (enc === 'Q') {
            // Replace _ with space, decode =XX sequences
            const decoded = text.replace(/_/g, ' ').replace(/=([A-Fa-f0-9]{2})/g, (_, hex) =>
                String.fromCharCode(parseInt(hex, 16)),
            );
            bytes = Buffer.from(decoded, 'binary');
        } else {
            return text;
        }
        return bytes.toString((charset.toLowerCase() as BufferEncoding) || 'utf8');
    } catch {
        return text;
    }
}

/**
 * Decode all RFC 2047 encoded-word sequences in a header value string.
 * Example: =?UTF-8?Q?Certificado_Vac=C3=ADo?= → "Certificado Vacío"
 */
export function decodeRFC2047(value: string): string {
    if (!value) return value;
    // Unfold header (continuation lines start with whitespace)
    const unfolded = value.replace(/\r?\n[ \t]+/g, ' ');
    return unfolded.replace(
        /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
        (_, charset, encoding, text) => decodeEncodedWord(charset, encoding, text),
    );
}

/**
 * Unfold MIME header continuation lines.
 * Per RFC 2822, a header can span multiple lines if each continuation line starts with
 * at least one whitespace character (LWSP).
 */
export function unfoldHeader(value: string): string {
    return value.replace(/\r?\n[ \t]+/g, ' ');
}

/**
 * Extract the filename from a MIME part header block.
 * Tries (in order):
 *  1. Content-Disposition: attachment; filename*=UTF-8''... (RFC 5987, percent-encoded)
 *  2. Content-Disposition: attachment; filename="..." or filename=...  (with RFC 2047 decode)
 *  3. Content-Type: ...; name*=UTF-8''... (RFC 5987)
 *  4. Content-Type: ...; name="..." or name=...  (with RFC 2047 decode)
 *
 * Returns an empty string if no filename can be found.
 */
export function extractFilenameFromHeaders(headersRaw: string): string {
    // Unfold all lines first
    const headers = unfoldHeader(headersRaw);

    // Helper: RFC 5987 extended value (charset'language'percent-encoded)
    function decodeRfc5987(val: string): string {
        // e.g. UTF-8''Certificado%20Vac%C3%ADo.pdf
        const match = val.match(/^([^']+)'([^']*)'(.*)$/);
        if (match) {
            try {
                return decodeURIComponent(match[3]);
            } catch {
                return match[3];
            }
        }
        // Plain percent-encoded without charset prefix
        try {
            return decodeURIComponent(val);
        } catch {
            return val;
        }
    }

    // Helper: clean up quoted/unquoted value and RFC 2047-decode it
    function cleanValue(val: string): string {
        const stripped = val.trim().replace(/^["']|["']$/g, '');
        return decodeRFC2047(stripped).trim();
    }

    // 1. Content-Disposition filename* (RFC 5987, extended)
    const cdFnStar = headers.match(
        /Content-Disposition:[^\r\n]*;\s*filename\*\s*=\s*([^\s;]+)/i,
    );
    if (cdFnStar) {
        const decoded = decodeRfc5987(cdFnStar[1].replace(/^["']|["']$/g, ''));
        if (decoded) return decoded;
    }

    // 2. Content-Disposition filename (regular or RFC 2047)
    // Match filename="..." or filename=word (stopping at ; or EOL)
    const cdFn = headers.match(
        /Content-Disposition:[^\r\n]*;\s*filename\s*=\s*("(?:[^"\\]|\\.)*"|[^\s;]+)/i,
    );
    if (cdFn) {
        const decoded = cleanValue(cdFn[1]);
        if (decoded) return decoded;
    }

    // 3. Content-Type name* (RFC 5987, extended)
    const ctFnStar = headers.match(
        /Content-Type:[^\r\n]*;\s*name\*\s*=\s*([^\s;]+)/i,
    );
    if (ctFnStar) {
        const decoded = decodeRfc5987(ctFnStar[1].replace(/^["']|["']$/g, ''));
        if (decoded) return decoded;
    }

    // 4. Content-Type name (regular or RFC 2047)
    const ctFn = headers.match(
        /Content-Type:[^\r\n]*;\s*name\s*=\s*("(?:[^"\\]|\\.)*"|[^\s;]+)/i,
    );
    if (ctFn) {
        const decoded = cleanValue(ctFn[1]);
        if (decoded) return decoded;
    }

    return '';
}

/**
 * Comprehensive MIME type → file extension map.
 * Covers images, documents, archives, audio, video, fonts, code, data,
 * 3D/CAD, GIS, ebook, executable, and more.
 * When a MIME type maps to multiple extensions, the most common one is listed.
 */
const MIME_TO_EXT: Record<string, string> = {
    // ── Images ────────────────────────────────────────────────────────────────
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'image/x-bmp': '.bmp',
    'image/tiff': '.tiff',
    'image/x-tiff': '.tiff',
    'image/vnd.microsoft.icon': '.ico',
    'image/x-icon': '.ico',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'image/avif': '.avif',
    'image/jxl': '.jxl',
    'image/apng': '.apng',
    'image/x-portable-bitmap': '.pbm',
    'image/x-portable-graymap': '.pgm',
    'image/x-portable-pixmap': '.ppm',
    'image/x-portable-anymap': '.pnm',
    'image/x-rgb': '.rgb',
    'image/x-xbitmap': '.xbm',
    'image/x-xpixmap': '.xpm',
    'image/x-xcf': '.xcf',
    'image/x-photoshop': '.psd',
    'image/vnd.adobe.photoshop': '.psd',
    'image/x-adobe-dng': '.dng',
    'image/x-canon-cr2': '.cr2',
    'image/x-canon-crw': '.crw',
    'image/x-nikon-nef': '.nef',
    'image/x-sony-arw': '.arw',
    'image/x-fuji-raf': '.raf',
    'image/x-panasonic-raw': '.rw2',
    'image/x-olympus-orf': '.orf',
    'image/x-kodak-dcr': '.dcr',
    'image/x-minolta-mrw': '.mrw',
    'image/jp2': '.jp2',
    'image/jpx': '.jpx',

    // ── Documents ─────────────────────────────────────────────────────────────
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.template': '.dotx',
    'application/vnd.ms-word.document.macroenabled.12': '.docm',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.template': '.xltx',
    'application/vnd.ms-excel.sheet.macroenabled.12': '.xlsm',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/vnd.openxmlformats-officedocument.presentationml.template': '.potx',
    'application/vnd.ms-powerpoint.presentation.macroenabled.12': '.pptm',
    'application/vnd.ms-access': '.mdb',
    'application/vnd.ms-project': '.mpp',
    'application/vnd.visio': '.vsd',
    'application/vnd.ms-xpsdocument': '.xps',
    // LibreOffice / OpenDocument
    'application/vnd.oasis.opendocument.text': '.odt',
    'application/vnd.oasis.opendocument.spreadsheet': '.ods',
    'application/vnd.oasis.opendocument.presentation': '.odp',
    'application/vnd.oasis.opendocument.graphics': '.odg',
    'application/vnd.oasis.opendocument.chart': '.odc',
    'application/vnd.oasis.opendocument.formula': '.odf',
    'application/vnd.oasis.opendocument.database': '.odb',
    'application/vnd.oasis.opendocument.image': '.odi',
    'application/vnd.oasis.opendocument.text-template': '.ott',
    'application/vnd.oasis.opendocument.spreadsheet-template': '.ots',
    'application/vnd.oasis.opendocument.presentation-template': '.otp',
    // iWork
    'application/vnd.apple.pages': '.pages',
    'application/vnd.apple.numbers': '.numbers',
    'application/vnd.apple.keynote': '.key',
    // Rich text / other text
    'application/rtf': '.rtf',
    'text/rtf': '.rtf',
    'application/x-latex': '.latex',
    'text/latex': '.tex',
    'application/x-tex': '.tex',
    'application/epub+zip': '.epub',
    'application/vnd.amazon.mobi8-ebook': '.azw3',
    'application/x-mobipocket-ebook': '.mobi',
    'application/x-fictionbook': '.fb2',

    // ── Text / Code ───────────────────────────────────────────────────────────
    'text/plain': '.txt',
    'text/html': '.html',
    'text/htm': '.htm',
    'text/css': '.css',
    'text/javascript': '.js',
    'application/javascript': '.js',
    'application/x-javascript': '.js',
    'text/typescript': '.ts',
    'application/typescript': '.ts',
    'text/jsx': '.jsx',
    'text/tsx': '.tsx',
    'text/x-python': '.py',
    'application/x-python-code': '.py',
    'text/x-java-source': '.java',
    'text/x-c': '.c',
    'text/x-c++src': '.cpp',
    'text/x-csrc': '.c',
    'text/x-chdr': '.h',
    'text/x-csharp': '.cs',
    'text/x-go': '.go',
    'text/x-rust': '.rs',
    'text/x-ruby': '.rb',
    'text/x-php': '.php',
    'application/x-php': '.php',
    'text/x-sh': '.sh',
    'application/x-sh': '.sh',
    'application/x-shellscript': '.sh',
    'text/x-perl': '.pl',
    'text/x-r': '.r',
    'text/x-swift': '.swift',
    'text/x-kotlin': '.kt',
    'text/x-scala': '.scala',
    'text/x-lua': '.lua',
    'text/x-haskell': '.hs',
    'text/x-lisp': '.lisp',
    'text/x-clojure': '.clj',
    'text/x-elixir': '.ex',
    'text/x-erlang': '.erl',
    'text/x-ocaml': '.ml',
    'text/x-fsharp': '.fs',
    'text/x-yaml': '.yaml',
    'text/yaml': '.yaml',
    'application/x-yaml': '.yaml',
    'text/x-toml': '.toml',
    'application/toml': '.toml',
    'text/markdown': '.md',
    'text/x-markdown': '.md',
    'application/x-markdown': '.md',
    'text/x-rst': '.rst',
    'text/x-asciidoc': '.adoc',
    'text/csv': '.csv',
    'text/tab-separated-values': '.tsv',
    'text/calendar': '.ics',
    'application/ics': '.ics',
    'text/vcard': '.vcf',
    'text/x-vcard': '.vcf',
    'text/xml': '.xml',
    'application/xml': '.xml',
    'application/xhtml+xml': '.xhtml',
    'application/json': '.json',
    'application/ld+json': '.jsonld',
    'application/geo+json': '.geojson',
    'application/manifest+json': '.webmanifest',
    'application/schema+json': '.json',
    'application/graphql': '.graphql',
    'application/x-httpd-php': '.php',
    'text/x-sql': '.sql',
    'application/sql': '.sql',
    'text/x-diff': '.diff',
    'text/x-patch': '.patch',
    'application/x-ndjson': '.ndjson',
    'application/x-jsonlines': '.jsonl',

    // ── Data / Databases ─────────────────────────────────────────────────────
    'application/x-sqlite3': '.sqlite',
    'application/vnd.sqlite3': '.sqlite',
    'application/x-dbf': '.dbf',
    'application/x-msaccess': '.mdb',
    'application/vnd.ms-excel.addin.macroenabled.12': '.xlam',
    'application/parquet': '.parquet',
    'application/x-parquet': '.parquet',
    'application/x-avro': '.avro',
    'application/vnd.apache.arrow.file': '.arrow',
    'application/vnd.apache.arrow.stream': '.arrows',

    // ── Archives / Compression ────────────────────────────────────────────────
    'application/zip': '.zip',
    'application/x-zip-compressed': '.zip',
    'application/x-zip': '.zip',
    'application/x-rar-compressed': '.rar',
    'application/vnd.rar': '.rar',
    'application/x-rar': '.rar',
    'application/x-tar': '.tar',
    'application/gzip': '.gz',
    'application/x-gzip': '.gz',
    'application/x-bzip': '.bz',
    'application/x-bzip2': '.bz2',
    'application/x-7z-compressed': '.7z',
    'application/x-xz': '.xz',
    'application/x-lzip': '.lz',
    'application/x-lzma': '.lzma',
    'application/x-zstd': '.zst',
    'application/x-lz4': '.lz4',
    'application/x-br': '.br',
    'application/x-snappy': '.snappy',
    'application/vnd.ms-cab-compressed': '.cab',
    'application/x-cab': '.cab',
    'application/x-iso9660-image': '.iso',
    'application/x-apple-diskimage': '.dmg',
    'application/x-debian-package': '.deb',
    'application/x-rpm': '.rpm',
    'application/x-cpio': '.cpio',
    'application/x-arj': '.arj',
    'application/x-lha': '.lha',
    'application/java-archive': '.jar',
    'application/x-java-archive': '.jar',
    'application/x-war': '.war',
    'application/x-ear': '.ear',
    'application/x-stuffit': '.sit',

    // ── Audio ─────────────────────────────────────────────────────────────────
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/aac': '.aac',
    'audio/x-aac': '.aac',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/flac': '.flac',
    'audio/x-flac': '.flac',
    'audio/vnd.wave': '.wav',
    'audio/opus': '.opus',
    'audio/webm': '.weba',
    'audio/amr': '.amr',
    'audio/3gpp': '.3gp',
    'audio/3gpp2': '.3g2',
    'audio/midi': '.midi',
    'audio/x-midi': '.midi',
    'audio/mid': '.mid',
    'audio/x-mid': '.mid',
    'audio/aiff': '.aiff',
    'audio/x-aiff': '.aiff',
    'audio/basic': '.au',
    'audio/vnd.rn-realaudio': '.ra',
    'audio/x-realaudio': '.ra',
    'audio/x-ms-wma': '.wma',
    'audio/x-ms-wmv': '.wmv',
    'audio/vnd.dts': '.dts',
    'audio/vnd.dolby.dd-raw': '.ac3',
    'audio/ac3': '.ac3',
    'audio/eac3': '.eac3',
    'audio/x-ape': '.ape',
    'audio/x-musepack': '.mpc',
    'audio/x-wavpack': '.wv',

    // ── Video ─────────────────────────────────────────────────────────────────
    'video/mp4': '.mp4',
    'video/x-m4v': '.m4v',
    'video/mpeg': '.mpeg',
    'video/x-mpeg': '.mpeg',
    'video/ogg': '.ogv',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'video/x-quicktime': '.mov',
    'video/x-msvideo': '.avi',
    'video/avi': '.avi',
    'video/x-ms-wmv': '.wmv',
    'video/x-ms-asf': '.asf',
    'video/x-flv': '.flv',
    'video/x-f4v': '.f4v',
    'video/x-matroska': '.mkv',
    'video/mkv': '.mkv',
    'video/3gpp': '.3gp',
    'video/3gpp2': '.3g2',
    'video/x-theora': '.ogv',
    'video/vp8': '.webm',
    'video/vp9': '.webm',
    'video/av1': '.av1',
    'video/hevc': '.hevc',
    'video/x-h264': '.h264',
    'video/x-h265': '.h265',
    'video/x-divx': '.divx',
    'video/x-xvid': '.xvid',
    'video/x-ms-video': '.avi',
    'video/mp2t': '.ts',
    'video/x-ts': '.ts',
    'application/x-mpegurl': '.m3u8',
    'application/vnd.apple.mpegurl': '.m3u8',
    'video/x-ms-wm': '.wm',
    'video/x-ms-wvx': '.wvx',
    'video/x-mng': '.mng',
    'video/x-sgi-movie': '.movie',
    'video/vnd.vivo': '.viv',
    'video/x-raw-yuv': '.yuv',

    // ── Fonts ─────────────────────────────────────────────────────────────────
    'font/ttf': '.ttf',
    'font/otf': '.otf',
    'font/woff': '.woff',
    'font/woff2': '.woff2',
    'application/font-woff': '.woff',
    'application/font-woff2': '.woff2',
    'application/x-font-ttf': '.ttf',
    'application/x-font-otf': '.otf',
    'application/vnd.ms-fontobject': '.eot',
    'application/x-font-type1': '.pfb',
    'image/x-pcf': '.pcf',

    // ── Executables / System ──────────────────────────────────────────────────
    'application/x-msdownload': '.exe',
    'application/x-msdos-program': '.exe',
    'application/vnd.microsoft.portable-executable': '.exe',
    'application/x-dosexec': '.exe',
    'application/x-executable': '.exe',
    'application/x-elf': '.elf',
    'application/x-mach-binary': '.dylib',
    'application/x-sharedlib': '.so',
    'application/x-object': '.o',
    'application/x-bat': '.bat',
    'application/x-msi': '.msi',
    'application/x-ms-shortcut': '.lnk',
    'application/x-apple-systemprofiler+xml': '.spx',
    'application/vnd.apple.installer+xml': '.mpkg',
    'application/x-xpinstall': '.xpi',
    'application/x-chrome-extension': '.crx',
    'application/x-safari-extension': '.safariextz',

    // ── 3D / CAD ──────────────────────────────────────────────────────────────
    'model/obj': '.obj',
    'model/stl': '.stl',
    'model/x-stl-ascii': '.stl',
    'model/gltf-binary': '.glb',
    'model/gltf+json': '.gltf',
    'model/vnd.collada+xml': '.dae',
    'model/vnd.usdz+zip': '.usdz',
    'application/x-fbx': '.fbx',
    'application/x-blend': '.blend',
    'application/vnd.ms-3mfdocument': '.3mf',
    'application/x-3ds': '.3ds',
    'application/x-ply': '.ply',
    'model/iges': '.igs',
    'model/mesh': '.mesh',
    'model/vrml': '.wrl',
    'x-world/x-vrml': '.vrml',

    // ── GIS / Geo ─────────────────────────────────────────────────────────────
    'application/vnd.google-earth.kml+xml': '.kml',
    'application/vnd.google-earth.kmz': '.kmz',
    'application/gpx+xml': '.gpx',
    'application/vnd.mapbox-vector-tile': '.mvt',
    'application/x-shapefile': '.shp',
    'application/x-esri-shapefile': '.shp',

    // ── Programming / Build ───────────────────────────────────────────────────
    'application/wasm': '.wasm',
    'application/x-asm': '.asm',
    'application/x-masm': '.asm',
    'text/x-asm': '.asm',
    'application/x-cmake': '.cmake',
    'text/x-makefile': '.mk',
    'application/x-gradle': '.gradle',
    'application/x-maven+xml': '.pom',
    'application/x-proto': '.proto',
    'application/x-thrift': '.thrift',
    'application/x-avro-schema+json': '.avsc',
    'application/x-ipynb+json': '.ipynb',

    // ── Configuration / Manifest ──────────────────────────────────────────────
    'text/x-ini': '.ini',
    'text/x-properties': '.properties',
    'application/x-properties': '.properties',
    'text/x-env': '.env',
    'application/x-envfile': '.env',
    'application/x-dotenv': '.env',
    'application/x-desktop': '.desktop',

    // ── Certificate / Cryptography ────────────────────────────────────────────
    'application/x-x509-ca-cert': '.crt',
    'application/x-pem-file': '.pem',
    'application/pkcs8': '.p8',
    'application/pkcs10': '.csr',
    'application/pkix-cert': '.cer',
    'application/pkcs7-mime': '.p7m',
    'application/pkcs7-signature': '.p7s',
    'application/pkcs12': '.pfx',
    'application/x-pkcs12': '.p12',
    'application/x-pkcs7-certificates': '.p7b',
    'application/pgp-signature': '.sig',
    'application/pgp-encrypted': '.pgp',
    'application/pgp-keys': '.asc',

    // ── Ebook / Publishing ────────────────────────────────────────────────────
    'application/x-fictionbook+xml': '.fb2',
    'application/vnd.amazon.ebook': '.azw',
    'application/x-cbr': '.cbr',
    'application/x-cbz': '.cbz',
    'application/x-cb7': '.cb7',
    'application/x-cbt': '.cbt',

    // ── Web / Misc ────────────────────────────────────────────────────────────
    'application/rss+xml': '.rss',
    'application/atom+xml': '.atom',
    'application/vnd.android.package-archive': '.apk',
    'application/x-cocoa': '.cco',
    'application/x-java-jnlp-file': '.jnlp',
    'application/x-makeself': '.run',
    'application/x-pilot': '.prc',
    'application/x-tcl': '.tcl',
    'application/x-perl': '.pl',
    'application/x-cgi': '.cgi',

    // ── Fallback ──────────────────────────────────────────────────────────────
    'application/octet-stream': '',
};

/**
 * Guess a file extension from a MIME content-type string.
 * Returns the extension including the dot (e.g. ".pdf") or empty string.
 */
export function extensionFromMimeType(mimeType: string): string {
    const type = (mimeType || '').split(';')[0].trim().toLowerCase();
    return MIME_TO_EXT[type] ?? '';
}

/**
 * Reverse lookup: guess a MIME type from a file extension.
 * Returns 'application/octet-stream' if unknown.
 */
export function mimeTypeFromExtension(ext: string): string {
    const normalized = (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase();
    const entry = Object.entries(MIME_TO_EXT).find(([, v]) => v === normalized);
    return entry ? entry[0] : 'application/octet-stream';
}

/**
 * Sanitize a filename for safe storage: removes null bytes, control characters,
 * path traversal sequences, and trims to 255 chars.
 */
export function sanitizeFilename(name: string): string {
    return name
        .replace(/\0/g, '')
        .replace(/[/\\:*?"<>|]/g, '_')
        .replace(/\.\./g, '_')
        .trim()
        .substring(0, 255) || 'attachment';
}
