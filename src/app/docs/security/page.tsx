
import { Shield, Lock, Fingerprint, Eye, Server, Key } from 'lucide-react';

export default function SecurityDocs() {
    return (
        <div className="space-y-12 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-bold tracking-tight mb-4 flex items-center gap-3">
                    <Shield className="h-8 w-8 text-primary" />
                    Security & Encryption
                </h1>
                <p className="text-lg text-muted-foreground leading-relaxed">
                    Security is not an afterthought in Bloomx. It is the core constraint of our architecture. We operate on a "Zero Trust" model where even the database administrator cannot read your sensitive credentials.
                </p>
            </div>

            <section className="space-y-6">
                <h2 className="text-2xl font-bold">The Vault (Credentials)</h2>
                <div className="prose prose-zinc max-w-none">
                    <p>
                        Expansion credentials (like Google Refresh Tokens, Notion API Keys, and Slack Tokens) are <strong>never</strong> stored in plain text.
                    </p>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                    <SecurityCard
                        title="AES-256-CBC Encryption"
                        icon={Lock}
                        desc="We use industry-standard AES-256-CBC encryption for all 'Expansion Settings' at rest. The Initialization Vector (IV) is unique per record."
                    />
                    <SecurityCard
                        title="Key Derivation"
                        icon={Key}
                        desc="The encryption key is derived from a master server secret (`DATA_ENCRYPTION_KEY`) which exists only in the runtime environment memory, never in the database."
                    />
                </div>
            </section>

            <section className="space-y-6">
                <h2 className="text-2xl font-bold">Authentication & Session</h2>
                <div className="grid md:grid-cols-2 gap-6">
                    <SecurityCard
                        title="Secure Cookies"
                        icon={Fingerprint}
                        desc="In production, sessions are tracked via `__Secure-next-auth.session-token`. Only HTTPS connections can transmit this cookie."
                    />
                    <SecurityCard
                        title="Middleware Protection"
                        icon={Eye}
                        desc="All protected routes are guarded by a specialized Edge Middleware that validates tokens before the request even reaches the server logic."
                    />
                </div>
            </section>

            <section className="bg-destructive/10 border border-destructive/30 rounded-lg p-6">
                <h3 className="text-lg font-bold text-destructive flex items-center gap-2 mb-2">
                    <Server className="h-5 w-5" />
                    Data Ownership
                </h3>
                <p className="text-destructive">
                    Unlike typical SaaS email clients, Bloomx is designed to point to <strong>your</strong> database and <strong>your</strong> S3 bucket. We do not proxy your data through a "Bloomx Cloud". You own the infrastructure.
                </p>
            </section>
        </div>
    );
}

function SecurityCard({ title, icon: Icon, desc }: { title: string, icon: any, desc: string }) {
    return (
        <div className="p-6 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
            <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-primary/10 rounded-md">
                    <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold text-lg">{title}</h3>
            </div>
            <p className="text-muted-foreground leading-relaxed">{desc}</p>
        </div>
    )
}
