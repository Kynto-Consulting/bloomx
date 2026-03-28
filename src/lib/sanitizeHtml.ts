function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function stripDangerousMarkup(value: string) {
    return value
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
        .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
        .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, '')
        .replace(/<embed[\s\S]*?>[\s\S]*?<\/embed>/gi, '')
        .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/(href|src)\s*=\s*("|')\s*javascript:[\s\S]*?\2/gi, '$1="#"');
}

export function sanitizeHtml(value: string) {
    const source = stripDangerousMarkup(value || '');

    if (typeof window === 'undefined') {
        return source;
    }

    const template = window.document.createElement('template');
    template.innerHTML = source;

    template.content.querySelectorAll('script,iframe,object,embed').forEach((node) => node.remove());

    template.content.querySelectorAll('*').forEach((element) => {
        [...element.attributes].forEach((attribute) => {
            const attrName = attribute.name.toLowerCase();
            const attrValue = attribute.value.trim();

            if (attrName.startsWith('on')) {
                element.removeAttribute(attribute.name);
                return;
            }

            if ((attrName === 'href' || attrName === 'src') && /^javascript:/i.test(attrValue)) {
                element.removeAttribute(attribute.name);
            }
        });
    });

    return template.innerHTML;
}

export function sanitizeInlineMarkdownHtml(value: string) {
    return sanitizeHtml(escapeHtml(value || ''));
}