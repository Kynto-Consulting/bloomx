'use client';

import React, { useEffect, useRef, useState } from 'react';

interface SafeIframeProps {
    html: string;
    className?: string;
}

export function SafeIframe({ html, className }: SafeIframeProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState('200px');

    useEffect(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;

        const handleLoad = () => {
            if (!iframe.contentWindow) return;
            const doc = iframe.contentDocument || iframe.contentWindow.document;
            if (!doc) return;

            // Inject content
            doc.open();
            doc.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        * {
                            box-sizing: border-box;
                        }
                        html {
                            width: 100%;
                            max-width: 100%;
                            overflow-x: hidden;
                        }
                        body {
                            margin: 0;
                            padding: 0;
                            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                            font-size: 14px;
                            line-height: 1.5;
                            color: #1a1a1a;
                            width: 100%;
                            max-width: 100%;
                            overflow-x: hidden;
                            word-break: break-word;
                            overflow-wrap: anywhere;
                        }
                        table {
                            width: 100% !important;
                            max-width: 100% !important;
                            table-layout: fixed;
                        }
                        th, td {
                            word-break: break-word;
                            overflow-wrap: anywhere;
                        }
                        img { max-width: 100%; height: auto; }
                        a {
                            color: #2563eb;
                            text-decoration: underline;
                            word-break: break-word;
                            overflow-wrap: anywhere;
                        }
                        pre, code {
                            white-space: pre-wrap;
                            word-break: break-word;
                            overflow-wrap: anywhere;
                        }
                        blockquote {
                            margin: 0 0 0 .8ex;
                            border-left: 1px #999 solid;
                            padding-left: 1ex;
                            max-width: 100%;
                        }
                        .gmail_quote_toggle {
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            width: 32px;
                            height: 24px;
                            background-color: #f3f4f6;
                            border: 1px solid #d1d5db;
                            border-radius: 4px;
                            cursor: pointer;
                            margin: 8px 0;
                            color: #6b7280;
                            font-weight: bold;
                            font-size: 12px;
                            position: relative;
                            z-index: 50;
                        }
                        #content {
                            display: block;
                            padding: 1px; /* Prevent margin collapse */
                            width: 100%;
                            max-width: 100%;
                            overflow-x: hidden;
                        }
                    </style>
                </head>
                <body>
                    <div id="content">${html}</div>
                    <script>
                        function updateHeight() {
                            const content = document.getElementById('content');
                            if (!content) return;
                            // Use scrollHeight to ensure we capture all content
                            const h = content.scrollHeight; 
                            window.parent.postMessage({ type: 'resize', height: h }, '*');
                        }


                        function setupQuotes() {
                            try {
                                const content = document.getElementById('content');
                                if (!content) return;
                                
                                // Gmail often wraps history in multiple nested quotes or diff classes
                                let quotes = content.querySelectorAll('.gmail_quote, blockquote, [class*="gmail_quote"]');
                                
                                // Only target the *first* major quote block
                                let firstQuote = quotes[0];

                                if (firstQuote && !firstQuote.dataset.processed) {
                                    firstQuote.dataset.processed = 'true';
                                    console.log('Found quote to collapse');

                                    // Walk backwards to find attribution, skipping empty/br
                                    let prev = firstQuote.previousElementSibling;
                                    let attribution = null;
                                    let attempts = 3; // Look back up to 3 elements

                                    while (prev && attempts > 0) {
                                        const text = prev.textContent.trim().toLowerCase();
                                        // Skip empty or just <br>
                                        if (!text && prev.innerHTML.trim() === '<br>') {
                                            prev = prev.previousElementSibling;
                                            attempts--;
                                            continue;
                                        }

                                        // Check for keywords
                                        if (
                                            prev.classList.contains('gmail_attr') || 
                                            text.includes('wrote:') || 
                                            text.includes('wrote') && text.includes('on ') || 
                                            text.includes('schrieb:') ||
                                            text.includes('escribió:') ||
                                            text.includes('enviado desde')
                                        ) {
                                            attribution = prev;
                                            console.log('Found attribution line');
                                        }
                                        break; // Stop at first non-empty element
                                    }

                                    // Elements to toggle
                                    const elementsToToggle = [firstQuote];
                                    if (attribution) elementsToToggle.push(attribution);

                                    // Hide default
                                    elementsToToggle.forEach(el => el.style.setProperty('display', 'none', 'important'));
                                    
                                    const btn = document.createElement('div');
                                    btn.className = 'gmail_quote_toggle';
                                    btn.innerHTML = '•••';
                                    btn.title = "Show quoted text";
                                    btn.style.cssText = 'display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 24px; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; color: #4b5563; font-weight: bold; font-size: 14px; margin: 8px 0; user-select: none; z-index: 50;';
                                    
                                    btn.onclick = (e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const isHidden = firstQuote.style.display === 'none';
                                        elementsToToggle.forEach(el => el.style.display = isHidden ? 'block' : 'none');
                                        btn.innerHTML = isHidden ? 'Close' : '•••';
                                        btn.style.width = isHidden ? 'auto' : '32px';
                                        btn.style.padding = isHidden ? '0 8px' : '0';
                                        
                                        // Updates
                                        updateHeight();
                                        setTimeout(updateHeight, 50);
                                        setTimeout(updateHeight, 200);
                                    };

                                    // Insert before the top-most element (attribution or quote)
                                    const insertPoint = attribution || firstQuote;
                                    if(insertPoint.parentNode) {
                                        insertPoint.parentNode.insertBefore(btn, insertPoint);
                                    }
                                }
                            } catch (e) {
                                console.error('Error setting up quotes:', e);
                            }
                        }

                        document.addEventListener('click', (e) => {
                            const target = e.target.closest('a');
                            if (target) {
                                target.target = '_blank';
                                target.rel = 'noopener noreferrer';
                            }
                        });

                        // Run setup immediately
                        setupQuotes();
                        
                        // And ensure sizing on load / re-setup quotes if needed
                        window.addEventListener('load', () => {
                            setupQuotes();
                            updateHeight();
                            setTimeout(updateHeight, 100);
                        });

                        // Observe size changes on CONTENT, not body, to be precise
                        const content = document.getElementById('content');
                        if(content) {
                            new ResizeObserver(() => {
                                updateHeight();
                            }).observe(content);
                            
                            // Also observe body just in case content doesn't catch all (images loading?)
                             new ResizeObserver(() => {
                                updateHeight();
                            }).observe(document.body);
                        }
                    </script>
                </body>
                </html>
            `);
            doc.close();
        };

        iframe.addEventListener('load', handleLoad);

        // Initial trigger for srcdoc or about:blank
        if (iframe.contentWindow?.document.readyState === 'complete') {
            handleLoad();
        }

        const handleMessage = (event: MessageEvent) => {
            if (event.data?.type === 'resize' && event.data?.height) {
                setHeight(`${event.data.height}px`);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => {
            iframe.removeEventListener('load', handleLoad);
            window.removeEventListener('message', handleMessage);
        };
    }, [html]);

    return (
        <iframe
            ref={iframeRef}
            className={className}
            style={{ width: '100%', maxWidth: '100%', height, border: 'none', overflow: 'hidden' }}
            title="Email Content"
            sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin"
        />
    );
}
