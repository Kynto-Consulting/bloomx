
import { Zap, Bot, Brain, Sparkles, Wand2 } from 'lucide-react';

export default function AiDocs() {
    return (
        <div className="space-y-12 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-bold tracking-tight mb-4 flex items-center gap-3">
                    <Zap className="h-8 w-8 text-brand-accent" />
                    AI Capabilities
                </h1>
                <p className="text-lg text-muted-foreground leading-relaxed">
                    Bloomx integrates the Vercel AI SDK natively into the core logic. It supports switching providers (OpenAI, Anthropic, Gemini, Cohere) with a single environment variable change.
                </p>
            </div>

            <section className="space-y-6">
                <h2 className="text-2xl font-bold">Supported Providers</h2>
                <div className="grid md:grid-cols-2 gap-6">
                    <AiCard
                        title="OpenAI (GPT-4o)"
                        icon={Bot}
                        desc="Best for complex reasoning, summarizing threads, and generating structured JSON for the Organizer."
                        env="AI_PROVIDER=openai"
                    />
                    <AiCard
                        title="Google Gemini"
                        icon={Sparkles}
                        desc="Excellent speed and large context window. Great for analyzing very long email threads."
                        env="AI_PROVIDER=google"
                    />
                    <AiCard
                        title="Anthropic Claude"
                        icon={Brain}
                        desc="Superior tone matching for the 'Composer Helper'. Writes very natural sounding emails."
                        env="AI_PROVIDER=anthropic"
                    />
                    <AiCard
                        title="Cohere"
                        icon={Wand2}
                        desc="Specialized for RAG (Retrieval Augmented Generation) and semantic search tasks."
                        env="AI_PROVIDER=cohere"
                    />
                </div>
            </section>

            <section className="bg-muted/30 border rounded-lg p-6 space-y-4">
                <h3 className="font-semibold text-lg">Configuration</h3>
                <p className="text-sm text-muted-foreground">
                    You only need to set two variables in your <code>.env</code> file. The SDK handles the rest.
                </p>
                <pre className="bg-background border p-4 rounded-md font-mono text-sm overflow-x-auto text-foreground">
                    AI_PROVIDER="openai"{'\n'}
                    AI_API_KEY="sk-..."
                </pre>
            </section>
        </div>
    );
}

function AiCard({ title, icon: Icon, desc, env }: { title: string, icon: any, desc: string, env: string }) {
    return (
        <div className="p-6 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
            <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-brand-accent/15 rounded-md">
                    <Icon className="h-5 w-5 text-brand-accent" />
                </div>
                <h3 className="font-semibold text-lg">{title}</h3>
            </div>
            <p className="text-muted-foreground leading-relaxed text-sm mb-4">{desc}</p>
            <code className="text-xs font-mono bg-background/50 px-2 py-1 rounded border border-transparent">{env}</code>
        </div>
    )
}
