
import { Shield, Zap, Database, Component, Settings, Check, Lock, Globe, Mail, Clock, FileText, AlertTriangle } from 'lucide-react';

export default function ExpansionsDocs() {
    return (
        <div className="space-y-12 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-bold tracking-tight mb-4">Expansion Ecosystem</h1>
                <p className="text-lg text-muted-foreground leading-relaxed">
                    A complete catalog of every expansion available in Bloomx. Expansions are modular plugins that extend the core capabilities of the engine.
                </p>
            </div>

            {/* Core Integrations */}
            <Section title="Core Integrations" icon={Globe} color="text-primary bg-primary/15" desc="Deeply integrated tools that require OAuth or API Key configuration.">
                <ExpansionCard
                    name="Google Drive"
                    id="core-google-drive"
                    desc="Attach files directly from Google Drive. Uses OAuth2 for secure access."
                    features={['File Picker Modal', 'Recent Files', 'Smart Attachments']}
                    config="Settings > Expansions > Connect Google"
                    env="EXPANSION_CORE_GOOGLE_DRIVE=true"
                />
                <ExpansionCard
                    name="Notion"
                    id="core-notion"
                    desc="Save emails into any Notion database. Maps subject, sender, and content automatically."
                    features={['Database Selector', 'Content Mapping', 'One-click Save']}
                    config="Settings > Expansions > Notion API Key"
                    env="EXPANSION_CORE_NOTION=true"
                />
                <ExpansionCard
                    name="HubSpot CRM"
                    id="core-hubspot"
                    desc="Two-way sync with HubSpot. View contact details in the sidebar and create new leads from incoming mail."
                    features={['Contact Lookup', 'One-click Lead Gen', 'Activity Logging']}
                    config="Settings > Expansions > HubSpot Token"
                    env="EXPANSION_CORE_HUBSPOT=true"
                />
                <ExpansionCard
                    name="Slack"
                    id="core-slack"
                    desc="Forward important threads to specific public or private Slack channels."
                    features={['Channel Picker', 'Thread Context', 'Instant Forward']}
                    config="Settings > Expansions > Slack Token"
                    env="EXPANSION_CORE_SLACK=true"
                />
                <ExpansionCard
                    name="Trello"
                    id="core-trello"
                    desc="Turn emails into Trello cards. Select Board and List directly from the email toolbar."
                    features={['Board Selector', 'Link Back to Email', 'Task Management']}
                    config="Settings > Expansions > Trello Key/Token"
                    env="EXPANSION_CORE_TRELLO=true"
                />
                <ExpansionCard
                    name="Zoom"
                    id="core-zoom"
                    desc="Generate unique Zoom meeting links instantly within the composer."
                    features={['Smart Chip Insertion', 'One-click Create', 'Duration Control']}
                    config="Settings > Expansions > Zoom Credentials"
                    env="EXPANSION_CORE_ZOOM=true"
                />
            </Section>

            {/* AI Suite */}
            <Section title="AI Native Suite" icon={Zap} color="text-purple-600 bg-purple-100" desc="Powered by Vercel AI SDK. Requires a valid LLM provider configured.">
                <div className="grid sm:grid-cols-2 gap-6">
                    <UtilityCard
                        name="Smart Reply"
                        id="core-smart-reply"
                        desc="Analyzes incoming email context to suggest 3 rapid-response options in the footer."
                    />
                    <UtilityCard
                        name="Summarizer"
                        id="core-summarizer"
                        desc="Collapses long email threads into a concise 3-bullet summary using LLMs."
                    />
                    <UtilityCard
                        name="Organizer"
                        id="core-organizer"
                        desc="Automatically labels incoming mail (Receipts, Newsletters) based on semantic content."
                    />
                    <UtilityCard
                        name="Composer Helper"
                        id="core-composer-helper"
                        desc="A 'Copilot' for your drafts. Ask it to rewrite for tone, grammar, or brevity."
                    />
                    <UtilityCard
                        name="Translator"
                        id="core-translator"
                        desc="Detects foreign languages in incoming mail and offers a one-click translation."
                    />
                </div>
            </Section>

            {/* Productivity */}
            <Section title="Productivity & Tools" icon={Clock} color="text-success bg-success/15" desc="Enhancements to speed up your daily workflow.">
                <div className="grid gap-6">
                    <ExpansionCard
                        name="Calendar"
                        id="core-calendar"
                        desc="Insert calendar events as 'Smart Chips' and generate .ics attachments on the fly."
                        features={['Smart Chips', '.ics Generation', 'Slash Command Support']}
                        config="No Configuration Needed"
                        env="EXPANSION_CORE_CALENDAR=true"
                    />
                    <ExpansionCard
                        name="Mail Groups"
                        id="core-mail-groups"
                        desc="Define custom aliases (e.g. @dev-team) that expand to multiple recipients."
                        features={['Custom Aliases', 'Team BLAST', 'Private Lists']}
                        config="Settings > Mail Groups"
                        env="EXPANSION_CORE_MAIL_GROUPS=true"
                    />
                    <ExpansionCard
                        name="Signatures"
                        id="core-signature"
                        desc="Rich text signatures supporting HTML and images, appended automatically."
                        features={['Visual Editor', 'Multiple Profiles', 'Auto-Append']}
                        config="Settings > Signature"
                        env="default"
                    />
                    <ExpansionCard
                        name="Templates"
                        id="core-templates"
                        desc="Save common responses as templates for quick insertion via slash commands."
                        features={['Slash Command Access', 'Variable Substitution', 'Rich Text']}
                        config="Settings > Templates"
                        env="EXPANSION_CORE_TEMPLATES=true"
                    />
                </div>
            </Section>

            {/* Enhancements */}
            <Section title="Enhancements" icon={Component} color="text-warning bg-warning/15" desc="UI and Functional upgrades to the composer.">
                <div className="grid sm:grid-cols-2 gap-6">
                    <UtilityCard
                        name="Giphy"
                        id="core-giphy"
                        desc="Browse and insert GIFs directly into your emails using the Giphy API."
                        extra="Requires Giphy API Key"
                    />
                    <UtilityCard
                        name="Confidential Mode"
                        id="core-confidential"
                        desc="Adds a visual 'Confidential' badge and headers to sensitive emails."
                    />
                    <UtilityCard
                        name="Slash Commands"
                        id="core-slash-commands"
                        desc="Power-user menu triggered by typing '/' in the composer."
                    />
                    <UtilityCard
                        name="Auto Follow-up"
                        id="core-followup"
                        desc="Reminds you to follow up on sent emails if no reply is received within 3 days."
                    />
                </div>
            </Section>

            {/* Backend Services */}
            <Section title="Background Services" icon={Database} color="text-muted-foreground bg-muted" desc="Invisible services running on the server.">
                <div className="grid gap-6">
                    <ExpansionCard
                        name="DLP (Data Loss Prevention)"
                        id="core-dlp"
                        desc="Scans outgoing emails for sensitive patterns (Credit Cards, SSNs) and warns or blocks sending."
                        features={['Regex Matching', 'Block/Warn Modes', 'Audit Logging']}
                        config="Environment Variables Only"
                        env="EXPANSION_CORE_DLP=true"
                    />
                    <ExpansionCard
                        name="Webhooks"
                        id="core-webhooks"
                        desc="Forwards 'email_received' events to an external URL payload for custom processing."
                        features={['JSON Payload', 'Real-time', 'Fire & Forget']}
                        config="EXPANSION_WEBHOOK_URL"
                        env="EXPANSION_CORE_WEBHOOKS=true"
                    />
                    <ExpansionCard
                        name="CRM Generic"
                        id="core-crm"
                        desc="A generic logger that POSTs email metadata to any endpoint for custom CRM integration."
                        features={['Metadata Logging', 'Flexible Endpoint']}
                        config="EXPANSION_CRM_URL"
                        env="EXPANSION_CORE_CRM=true"
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
                        Environment
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
                    <code className="text-[10px] px-1.5 py-0.5 bg-background/50 rounded font-mono text-muted-foreground">{id}</code>
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
