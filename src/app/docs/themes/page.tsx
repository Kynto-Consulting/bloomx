import { Palette, Contrast, Languages, Accessibility, Terminal } from 'lucide-react';
import { THEMES, TOKEN_KEYS } from '@/lib/themes';
import { contrast } from '@/lib/color';

/**
 * Documentacion de temas. La tabla se genera desde el registro (src/lib/themes.ts),
 * asi que nunca se desincroniza de los temas reales.
 */
export default function ThemesDocs() {
    return (
        <div className="space-y-12 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-bold tracking-tight mb-4 flex items-center gap-3">
                    <Palette className="h-8 w-8 text-primary" aria-hidden="true" />
                    Temas y accesibilidad
                </h1>
                <p className="text-lg text-muted-foreground leading-relaxed">
                    BloomX incluye 8 temas (Claro y Oscuro, que usan la marca del dominio, más 6 paletas propias) y la opción <strong>Sistema</strong>,
                    que sigue el modo claro/oscuro del dispositivo. Se elige en <em>Ajustes → Apariencia</em>, se aplica al
                    instante, se guarda en el dispositivo (cookie + localStorage) y en tu cuenta.
                </p>
            </div>

            <section className="space-y-4" aria-labelledby="catalogo">
                <h2 id="catalogo" className="text-2xl font-bold">Catálogo de temas</h2>
                <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[640px] text-sm">
                        <thead className="bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
                            <tr>
                                <th scope="col" className="px-4 py-3">Tema</th>
                                <th scope="col" className="px-4 py-3">Modo</th>
                                <th scope="col" className="px-4 py-3">Marca del dominio</th>
                                <th scope="col" className="px-4 py-3">Texto / fondo</th>
                                <th scope="col" className="px-4 py-3">Muestra</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {THEMES.map((t) => (
                                <tr key={t.id}>
                                    <th scope="row" className="px-4 py-3 text-left font-medium">
                                        {t.label} <code className="ml-1 text-xs text-muted-foreground">{t.id}</code>
                                        <div className="mt-0.5 text-xs font-normal text-muted-foreground">{t.description}</div>
                                    </th>
                                    <td className="px-4 py-3">{t.scheme === 'dark' ? 'Oscuro' : 'Claro'}</td>
                                    <td className="px-4 py-3">{t.brandable ? 'Sí' : 'No (paleta propia)'}</td>
                                    <td className="px-4 py-3 tabular-nums">{contrast(t.tokens.foreground, t.tokens.background).toFixed(1)}:1</td>
                                    <td className="px-4 py-3">
                                        <span
                                            aria-hidden="true"
                                            className="inline-flex h-8 w-24 overflow-hidden rounded border"
                                            style={{ backgroundColor: t.tokens.background, borderColor: t.tokens.border }}
                                        >
                                            <span className="h-full w-1/3" style={{ backgroundColor: t.tokens.primary }} />
                                            <span className="h-full w-1/3" style={{ backgroundColor: t.tokens.card }} />
                                            <span className="h-full w-1/3" style={{ backgroundColor: t.tokens['brand-accent'] }} />
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="space-y-4" aria-labelledby="tokens">
                <h2 id="tokens" className="text-2xl font-bold">Tokens semánticos</h2>
                <p className="text-muted-foreground">
                    Los componentes <strong>no usan hex ni clases de paleta</strong> (<code>bg-white</code>, <code>text-gray-500</code>…);
                    usan tokens que Tailwind v4 expone como utilitarios: <code>bg-background</code>, <code>text-foreground</code>,{' '}
                    <code>text-muted-foreground</code>, <code>border-border</code>, <code>bg-primary text-primary-foreground</code>,{' '}
                    <code>text-destructive</code>, <code>bg-destructive/10</code>, <code>ring-ring</code>…
                </p>
                <p className="text-sm text-muted-foreground">
                    Tokens disponibles: {TOKEN_KEYS.map((k, i) => (
                        <span key={k}><code className="text-xs">{k}</code>{i < TOKEN_KEYS.length - 1 ? ', ' : '.'}</span>
                    ))}
                </p>
                <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm space-y-2">
                    <p className="font-medium">Escalas crudas en temas oscuros</p>
                    <p className="text-muted-foreground">
                        Como red de seguridad, en los temas oscuros las escalas de Tailwind se reasignan: <code>50–300</code> pasan a
                        tonos oscuros de fondo, <code>700–900</code> a tonos claros de texto y <code>500–600</code> se aclaran
                        (se usan como color de texto/acento). Consecuencia: <strong>no uses <code>bg-&lt;color&gt;-500/600</code> con texto
                        blanco</strong> para rellenos sólidos; usa <code>bg-primary</code>, <code>bg-destructive</code>, etc.
                    </p>
                </div>
            </section>

            <section className="space-y-4" aria-labelledby="marca">
                <h2 id="marca" className="text-2xl font-bold flex items-center gap-2">
                    <Contrast className="h-6 w-6 text-primary" aria-hidden="true" />
                    Marca del dominio y contraste
                </h2>
                <p className="text-muted-foreground">
                    Los colores de marca (panel de administración → Ajustes) se superponen a los temas <em>Claro</em> y <em>Oscuro</em>.
                    Antes de aplicarse se corrigen para cumplir <strong>WCAG 2.1 AA</strong>: texto normal ≥ 4.5:1 y bordes de campos/foco ≥ 3:1.
                    El panel <strong>avisa</strong> cuando un color elegido no cumple, muestra el color que realmente se aplicará
                    (con su ratio) y ofrece “Usar el color corregido”.
                </p>
                <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
                    <li><code>primaryColor</code>, <code>accentColor</code>: se ajustan a 4.5:1 sobre fondo y tarjeta; el texto encima se calcula solo.</li>
                    <li><code>inputColor</code> (borde de campos) y <code>ringColor</code> (foco): opcionales; vacío = automático. Mínimo 3:1.</li>
                    <li>Fondo, texto, tarjeta y bordes de marca solo afectan al tema Claro.</li>
                    <li>Los colores de agenda, calendarios y citas los elige cada usuario: el texto sobre ellos se calcula por contraste (nunca “blanco fijo”).</li>
                </ul>
            </section>

            <section className="space-y-4" aria-labelledby="idioma">
                <h2 id="idioma" className="text-2xl font-bold flex items-center gap-2">
                    <Languages className="h-6 w-6 text-primary" aria-hidden="true" />
                    Idioma (es / en)
                </h2>
                <p className="text-muted-foreground">
                    El idioma se resuelve en este orden: cookie <code>bloomx-lang</code> (elección del usuario en Ajustes → Apariencia) →
                    cabecera <code>Accept-Language</code> → español. <code>&lt;html lang&gt;</code> refleja el resultado desde el primer HTML.
                    Los diccionarios viven en <code>src/lib/i18n/messages/{'{es,en}'}.ts</code>; en cliente se usa{' '}
                    <code>const {'{ t }'} = useI18n()</code> y en servidor <code>getServerTranslator()</code>. Si falta una clave se usa el idioma por
                    defecto y, en último caso, la propia clave. Pantallas ya migradas: layout, login/registro, Ajustes, panel de administración,
                    navegación de docs y página pública de reservas.
                </p>
            </section>

            <section className="space-y-4" aria-labelledby="a11y">
                <h2 id="a11y" className="text-2xl font-bold flex items-center gap-2">
                    <Accessibility className="h-6 w-6 text-primary" aria-hidden="true" />
                    Accesibilidad de base
                </h2>
                <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
                    <li>Modales: usar <code>&lt;Modal&gt;</code> o el hook <code>useDialog</code> (<code>src/components/ui</code>): <code>role=&quot;dialog&quot;</code>, <code>aria-modal</code>, foco atrapado, Escape, restauración de foco y bloqueo de scroll.</li>
                    <li>Foco visible global (<code>:focus-visible</code> con el token <code>ring</code>) definido en <code>globals.css</code>.</li>
                    <li>Formularios: cada campo con <code>&lt;label htmlFor&gt;</code>, <code>autoComplete</code> adecuado y errores en <code>role=&quot;alert&quot;</code>.</li>
                    <li>Tamaño mínimo de texto: 11–12 px; evitar <code>text-[10px]</code>.</li>
                    <li>El tema <em>Alto contraste</em> cumple AAA para el texto principal.</li>
                </ul>
            </section>

            <section className="space-y-4" aria-labelledby="crear">
                <h2 id="crear" className="text-2xl font-bold flex items-center gap-2">
                    <Terminal className="h-6 w-6 text-primary" aria-hidden="true" />
                    Añadir un tema y verificarlo
                </h2>
                <ol className="list-decimal space-y-1 pl-6 text-muted-foreground">
                    <li>Añade un <code>ThemeDefinition</code> con todos los tokens en <code>src/lib/themes.ts</code> y agrégalo a <code>THEMES</code>.</li>
                    <li>Añade su nombre y descripción en <code>appearance.themes.&lt;id&gt;</code> de los dos diccionarios (opcional; si falta se usa el texto del registro).</li>
                    <li>Ejecuta <code>npm run check:themes</code>: falla si algún par texto/fondo baja de AA, si un tono de las escalas 500/600 remapeadas no se lee sobre un fondo oscuro o si <code>globals.css</code> se desincroniza del tema claro.</li>
                </ol>
                <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-4 text-sm text-foreground"><code>npm run check:themes        # tabla + código de salida 1 si algo falla
npm run check:themes -- --md  # tabla en Markdown</code></pre>
            </section>
        </div>
    );
}
