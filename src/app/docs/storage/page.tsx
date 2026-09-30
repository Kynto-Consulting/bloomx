
import { Database, Cloud, HardDrive, UploadCloud } from 'lucide-react';

export default function StorageDocs() {
    return (
        <div className="space-y-12 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-bold tracking-tight mb-4 flex items-center gap-3">
                    <Database className="h-8 w-8 text-info" />
                    Storage Providers
                </h1>
                <p className="text-lg text-muted-foreground leading-relaxed">
                    Bloomx abstracts file storage using an S3-compatible interface. This allows you to bring your own bucket from almost any cloud provider.
                </p>
            </div>

            <section className="space-y-6">
                <h2 className="text-2xl font-bold">How Uploads Work</h2>
                <div className="prose prose-zinc max-w-none">
                    <ol>
                        <li><strong>Client Request</strong>: The Composer requests a pre-signed URL from <code>/api/upload/presign</code>.</li>
                        <li><strong>Server Validation</strong>: We check file size limits (25MB) and mime types.</li>
                        <li><strong>Direct Upload</strong>: The browser uploads the file <i>directly</i> to the bucket using the pre-signed URL.</li>
                        <li><strong>Reference</strong>: Only the final URL is stored in the email body.</li>
                    </ol>
                </div>
            </section>

            <section className="space-y-6">
                <h2 className="text-2xl font-bold">Compatible Providers</h2>
                <div className="grid md:grid-cols-3 gap-6">
                    <StorageCard
                        title="AWS S3"
                        icon={HardDrive}
                        desc="The standard. Robust, reliable, but can be expensive for high egress."
                    />
                    <StorageCard
                        title="Cloudflare R2"
                        icon={Cloud}
                        desc="Recommended. Zero egress fees make it perfect for email attachments."
                    />
                    <StorageCard
                        title="MinIO"
                        icon={UploadCloud}
                        desc="Self-hosted compatible server. Great for local development or on-premise."
                    />
                </div>
            </section>
        </div>
    );
}

function StorageCard({ title, icon: Icon, desc }: { title: string, icon: any, desc: string }) {
    return (
        <div className="p-6 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
            <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-info/15 rounded-md">
                    <Icon className="h-5 w-5 text-info" />
                </div>
                <h3 className="font-semibold text-lg">{title}</h3>
            </div>
            <p className="text-muted-foreground leading-relaxed text-sm">{desc}</p>
        </div>
    )
}
