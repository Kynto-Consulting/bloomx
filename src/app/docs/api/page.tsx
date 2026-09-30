
import { Code, Server, ArrowRight } from 'lucide-react';

export default function ApiDocs() {
    return (
        <div className="space-y-12 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-bold tracking-tight mb-4">API Reference</h1>
                <p className="text-lg text-muted-foreground leading-relaxed">
                    Bloomx is API-first. Every action available in the UI is accessible via these REST endpoints.
                </p>
                <div className="mt-4 p-4 bg-muted/50 rounded-lg text-sm border">
                    <strong>Base URL:</strong> <code>/api</code>
                    <br />
                    <strong>Authentication:</strong> Cookie-based (NextAuth) or Bearer Token (Coming Soon for external apps).
                </div>
            </div>

            <div className="space-y-12">
                <ApiSection title="Email Operations" icon={Server}>
                    <Endpoint
                        method="GET"
                        path="/emails"
                        desc="List emails with pagination and filtering."
                        params={[
                            { name: 'folder', type: 'string', desc: 'Folder ID (e.g. INBOX, SENT)' },
                            { name: 'page', type: 'number', desc: 'Page number (0-indexed)' },
                            { name: 'q', type: 'string', desc: 'Search query' }
                        ]}
                    />
                    <Endpoint
                        method="GET"
                        path="/emails/[id]"
                        desc="Retrieve full content of a specific email, including HTML body and attachments."
                    />
                    <Endpoint
                        method="POST"
                        path="/emails/send"
                        desc="Send a new email."
                        body={[
                            { name: 'to', type: 'string[]', desc: 'Recipients' },
                            { name: 'subject', type: 'string', desc: 'Email subject' },
                            { name: 'html', type: 'string', desc: 'HTML content' }
                        ]}
                    />
                    <Endpoint
                        method="PATCH"
                        path="/emails/batch"
                        desc="Batch update emails (mark read, archive, delete)."
                        body={[
                            { name: 'ids', type: 'string[]', desc: 'List of Email IDs' },
                            { name: 'action', type: 'read | unread | archive | trash', desc: 'Action to perform' }
                        ]}
                    />
                </ApiSection>

                <ApiSection title="Drafts & Composition" icon={Code}>
                    <Endpoint
                        method="GET"
                        path="/drafts"
                        desc="List all current user drafts."
                    />
                    <Endpoint
                        method="POST"
                        path="/drafts"
                        desc="Create or update a draft."
                    />
                </ApiSection>

                <ApiSection title="System & Expansions" icon={Code}>
                    <Endpoint
                        method="GET"
                        path="/settings"
                        desc="Retrieve encrypted user settings and expansion configs."
                    />
                    <Endpoint
                        method="POST"
                        path="/expansions"
                        desc="Trigger a server-side expansion action (e.g. Save to Notion)."
                        params={[
                            { name: 'trigger', type: 'string', desc: 'Action ID (e.g. save_to_notion)' }
                        ]}
                    />
                </ApiSection>
            </div>
        </div>
    );
}

function ApiSection({ title, icon: Icon, children }: { title: string, icon: any, children: React.ReactNode }) {
    return (
        <section className="space-y-6">
            <h2 className="text-xl font-bold flex items-center gap-2 border-b pb-2">
                <Icon className="h-5 w-5 text-muted-foreground" />
                {title}
            </h2>
            <div className="grid gap-6">
                {children}
            </div>
        </section>
    )
}

function Endpoint({ method, path, desc, params, body }: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, desc: string, params?: any[], body?: any[] }) {
    const colors = {
        GET: 'bg-primary/15 text-primary',
        POST: 'bg-success/15 text-success',
        PATCH: 'bg-warning/15 text-warning',
        DELETE: 'bg-destructive/15 text-destructive',
    };

    return (
        <div className="rounded-lg bg-muted/40 overflow-hidden hover:bg-muted/60 transition-colors">
            <div className="flex flex-col md:flex-row md:items-center gap-4 p-4 bg-transparent">
                <span className={`px-2.5 py-1 rounded-md text-xs font-bold font-mono w-fit ${colors[method]}`}>
                    {method}
                </span>
                <code className="text-sm font-semibold">{path}</code>
                <span className="text-sm text-muted-foreground md:ml-auto">{desc}</span>
            </div>

            {(params || body) && (
                <div className="p-4 bg-background text-sm space-y-4">
                    {params && (
                        <div>
                            <h4 className="font-semibold text-xs uppercase text-muted-foreground mb-2">Query Parameters</h4>
                            <ul className="space-y-2">
                                {params.map((p, i) => (
                                    <li key={i} className="flex items-start gap-2">
                                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{p.name}</code>
                                        <span className="text-muted-foreground text-xs opacity-70">({p.type})</span>
                                        <span className="text-muted-foreground">– {p.desc}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {body && (
                        <div>
                            <h4 className="font-semibold text-xs uppercase text-muted-foreground mb-2">Request Body (JSON)</h4>
                            <ul className="space-y-2">
                                {body.map((p, i) => (
                                    <li key={i} className="flex items-start gap-2">
                                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{p.name}</code>
                                        <span className="text-muted-foreground text-xs opacity-70">({p.type})</span>
                                        <span className="text-muted-foreground">– {p.desc}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
