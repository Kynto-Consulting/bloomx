
import { Shield, Zap, Database, Component, Settings, Check, Lock, Globe, Mail, Clock, FileText, AlertTriangle } from 'lucide-react';

export default function ExpansionsDocs() {
    return (
        <div className="space-y-12 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-bold tracking-tight mb-4">Expansion Ecosystem</h1>
                <p className="text-lg text-muted-foreground leading-relaxed">
                    The 21 extensions that ship with Bloomx. Each one is a manifest plus an optional server script; a domain installs the ones it needs and configures its own credentials.
                </p>
            </div>

            {/* Core Integrations */}
            <Section title="Integrations" icon={Globe} color="text-primary bg-primary/15" desc="Connect to external services. Credentials are configured per domain and stored encrypted.">
                <ExpansionCard
                    name="Google Drive"
                    id="core-google-drive"
                    desc="Browse your Drive files and insert links from the composer. Uses the linked Google account."
                    features={['File search', 'Insert link']}
                    config="Connect Google in Settings"
                    env="Uploading from the panel is not available yet"
                />
                <ExpansionCard
                    name="Notion"
                    id="core-notion"
                    desc="Save the open email into a Notion database (title, sender and excerpt)."
                    features={['Database check', 'One-click save']}
                    config="NOTION_API_KEY, NOTION_DATABASE_ID"
                    env="Per-domain credentials"
                />
                <ExpansionCard
                    name="HubSpot CRM"
                    id="core-hubspot"
                    desc="Look up the sender in HubSpot and create the contact if it does not exist."
                    features={['Contact lookup', 'Create contact']}
                    config="OAuth or HUBSPOT_ACCESS_TOKEN, HUBSPOT_PORTAL_ID"
                    env="Per-domain credentials"
                />
                <ExpansionCard
                    name="Trello"
                    id="core-trello"
                    desc="Turn an email into a Trello card: pick board and list, then edit title and description."
                    features={['Board and list wizard', 'Prefilled card']}
                    config="TRELLO_KEY, TRELLO_TOKEN"
                    env="Per-domain credentials"
                />
                <ExpansionCard
                    name="Zoom"
                    id="core-zoom"
                    desc="Create a Zoom meeting and insert the invitation with an .ics attachment."
                    features={['Meeting link', 'Invitation email', 'ICS']}
                    config="ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET"
                    env="Per-domain credentials"
                />
                <ExpansionCard
                    name="Google Meet"
                    id="core-google-meet"
                    desc="Create a Google Meet space and insert the invitation with an .ics attachment."
                    features={['Meeting link', 'Invitation email', 'ICS']}
                    config="Linked Google account (or per-domain Google credentials)"
                    env="GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_MEET_ADMIN_REFRESH_TOKEN"
                />
                <ExpansionCard
                    name="Giphy"
                    id="core-giphy"
                    desc="Search or browse trending GIFs and insert them from the composer toolbar."
                    features={['Search', 'Trending']}
                    config="GIPHY_API_KEY"
                    env="Per-domain, or global if the operator allows it"
                />
            </Section>

            {/* AI Suite */}
            <Section title="AI Suite" icon={Zap} color="text-brand-accent bg-brand-accent/15" desc="Requires an LLM provider configured on the backend.">
                <div className="grid sm:grid-cols-2 gap-6">
                    <UtilityCard
                        name="Smart Reply"
                        id="core-smart-reply"
                        desc="Suggests three short replies for the draft or message."
                    />
                    <UtilityCard
                        name="Summarizer"
                        id="core-summarizer"
                        desc="Summarizes the open email in three bullet points."
                    />
                    <UtilityCard
                        name="Composer Helper"
                        id="core-composer-helper"
                        desc="Writing assistant in the composer: describe what you want and insert the result."
                    />
                    <UtilityCard
                        name="Translator"
                        id="core-translator"
                        desc="Translates the open email to English on demand."
                    />
                </div>
            </Section>

            {/* Productivity */}
            <Section title="Productivity" icon={Clock} color="text-success bg-success/15" desc="Enhancements to speed up your daily workflow.">
                <div className="grid gap-6">
                    <ExpansionCard
                        name="Calendar"
                        id="core-calendar"
                        desc="Create an event from the composer: attaches an .ics file and inserts a branded invitation. Can prefill the form from the draft with AI."
                        features={['Invitation email', '.ics generation', 'AI prefill']}
                        config="No configuration needed"
                        env="-"
                    />
                    <ExpansionCard
                        name="Appointments"
                        id="core-appointments"
                        desc="Share one of your booking links straight from the composer."
                        features={['Booking link']}
                        config="Create schedules in Appointments first"
                        env="-"
                    />
                    <ExpansionCard
                        name="Mail Groups"
                        id="core-mail-groups"
                        desc="Define aliases such as @sales that expand to several recipients while you compose."
                        features={['Custom aliases', 'Expands To / Cc / Bcc']}
                        config="Settings > Mail Groups"
                        env="Synced across devices"
                    />
                    <ExpansionCard
                        name="Email Signature"
                        id="core-signature"
                        desc="Signature that is added automatically when you open the composer."
                        features={['Auto-append']}
                        config="Settings > Email Signature"
                        env="Stored encrypted in this browser only"
                    />
                </div>
            </Section>

            {/* Background Services */}
            <Section title="Server-side Policies" icon={Database} color="text-muted-foreground bg-muted" desc="Run on the server when mail is sent or received.">
                <div className="grid gap-6">
                    <ExpansionCard
                        name="DLP (Data Loss Prevention)"
                        id="core-dlp"
                        desc="Runs before every send. Blocks the message when it finds sensitive keywords, card numbers (Luhn), IBAN, SSN, private keys or secrets in the subject, body or attachment names."
                        features={['Blocks sending', 'Pattern detectors', 'Fail-closed']}
                        config="DLP_KEYWORDS, DLP_DETECTORS"
                        env="Per-domain, defaults to built-in keywords"
                    />
                    <ExpansionCard
                        name="Webhooks"
                        id="core-webhooks"
                        desc="Sends an HMAC-signed email_received event (ids only, never the content) to your URL. The receive-side hook still has to be wired into the inbound mail webhook."
                        features={['HMAC signature', 'SSRF-safe', 'Minimal payload']}
                        config="WEBHOOK_URL, WEBHOOK_SECRET"
                        env="Per-domain credentials"
                    />
                    <ExpansionCard
                        name="Slash Commands"
                        id="core-slash-commands"
                        desc="/shrug, /smile and /hr text shortcuts. Declared in the manifest; the editor does not consume them yet."
                        features={['Declarative']}
                        config="-"
                        env="Not active yet"
                    />
                </div>
            </Section>

            {/* Disabled */}
            <Section title="Disabled" icon={AlertTriangle} color="text-warning bg-warning/15" desc="Present in the catalog but not mounted, on purpose.">
                <div className="grid sm:grid-cols-2 gap-6">
                    <UtilityCard
                        name="Sealer Encryption"
                        id="core-sealer"
                        desc="End-to-end encryption needs a public-key directory and a send hook that do not exist yet. It does not encrypt anything."
                        extra="Disabled"
                    />
                    <UtilityCard
                        name="Auto Organizer"
                        id="core-organizer"
                        desc="AI email classification exists, but extensions cannot read the mailbox or apply labels yet."
                        extra="Disabled"
                    />
                </div>
            </Section>
        </div>
    );
}

function Section({ title, icon: Icon, color, desc, children }: { title: string, icon: any, color: string, desc: string, children: React.ReactNode }) {
    return (
        <section className="space-y-6">
            <div className="flex items-center gap-3 border-b pb-4">
                <div className={`p-2 rounded-lg ${color}`}>
                    <Icon className="h-5 w-5" />
                </div>
                <div>
                    <h2 className="text-xl font-semibold">{title}</h2>
                    <p className="text-sm text-muted-foreground">{desc}</p>
                </div>
            </div>
            {children}
        </section>
    )
}

function ExpansionCard({ name, id, desc, features, config, env }: { name: string, id: string, desc: string, features: string[], config: string, env: string }) {
    return (
        <div className="p-5 rounded-lg bg-muted/40 flex flex-col md:flex-row gap-6 hover:bg-muted/60 transition-colors">
            <div className="flex-1 space-y-3">
                <div className="flex items-center gap-3">
                    <h3 className="font-bold text-lg">{name}</h3>
                    <code className="text-xs px-2 py-0.5 bg-background/50 rounded font-mono text-muted-foreground">{id}</code>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                    {features.map(f => (
                        <span key={f} className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary text-xs font-medium rounded-md">
                            <Check className="h-3 w-3" /> {f}
                        </span>
                    ))}
                </div>
            </div>
            <div className="w-full md:w-72 shrink-0 space-y-3">
                <div className="p-3 bg-background/40 rounded-md text-xs space-y-2">
                    <div className="font-semibold flex items-center gap-2">
                        <Settings className="h-3 w-3" />
                        Configuration
                    </div>
                    <div className="font-mono text-muted-foreground break-all bg-background/50 p-1.5 rounded">
                        {config}
                    </div>
                </div>
                <div className="p-3 bg-background/40 rounded-md text-xs space-y-2">
                    <div className="font-semibold flex items-center gap-2">
                        <Lock className="h-3 w-3" />
                        Credentials
                    </div>
                    <div className="font-mono text-muted-foreground break-all bg-background/50 p-1.5 rounded">
                        {env}
                    </div>
                </div>
            </div>
        </div>
    )
}

function UtilityCard({ name, id, desc, extra }: { name: string, id: string, desc: string, extra?: string }) {
    return (
        <div className="p-5 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors flex flex-col justify-between h-full">
            <div className="space-y-2">
                <div className="flex items-center gap-2 justify-between">
                    <h3 className="font-semibold">{name}</h3>
                    <code className="text-xs px-1.5 py-0.5 bg-background/50 rounded font-mono text-muted-foreground">{id}</code>
                </div>
                <p className="text-sm text-muted-foreground">{desc}</p>
            </div>
            {extra && (
                <div className="mt-4 flex items-center gap-1 text-xs text-warning bg-warning/10 px-2 py-1 rounded w-fit">
                    <AlertTriangle className="h-3 w-3" /> {extra}
                </div>
            )}
        </div>
    )
}
