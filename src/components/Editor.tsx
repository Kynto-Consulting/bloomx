'use client';

import { useEditor, EditorContent, type Editor as TiptapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import ImageExtension from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { toast } from 'sonner';
import {
    Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code,
    List, ListOrdered, Quote, Link2,
    AlignLeft, AlignCenter, AlignRight, AlignJustify,
    Type, Palette, Undo, Redo, RemoveFormatting
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useId, useMemo, useState, useRef, forwardRef, useImperativeHandle } from 'react';
import { sanitizePastedColors } from '@/lib/paste-utils';
import { SlashMenu, slashListboxId, slashOptionId } from '@/components/SlashMenu';
import { filterSlashCommands, parseSlashInput, slashKeyAction, type SlashCommand } from '@/lib/slash-commands';

// Define fonts
const fonts = [
    { name: 'Sans Serif', value: 'Inter, Arial, sans-serif' },
    { name: 'Serif', value: 'Georgia, Times New Roman, serif' },
    { name: 'Monospace', value: 'Courier New, Courier, monospace' },
];

const colors = [
    '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
    '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
    '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
    '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
    '#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0',
    '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
    '#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47',
    '#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130'
];

export interface EditorHandle {
    insertContent: (content: string) => void;
    prependContent: (content: string) => void;
}

interface EditorProps {
    value: string;
    onChange: (value: string) => void;
    simple?: boolean;
    /** Comandos "/" de las extensiones instaladas (ver lib/slash-commands.ts). */
    slashCommands?: SlashCommand[];
    context?: any;
}

interface SlashMenuState {
    open: boolean;
    query: string;
    /** Texto tras la clave (solo con comando exacto). */
    args: string;
    x: number;
    y: number;
    index: number;
    exactMatch: boolean;
    /** Rango absoluto del texto "/comando args" en el documento. */
    range: { from: number; to: number };
}

const SLASH_CLOSED: SlashMenuState = { open: false, query: '', args: '', x: 0, y: 0, index: 0, exactMatch: false, range: { from: 0, to: 0 } };

const NO_COMMANDS: SlashCommand[] = [];

export const Editor = forwardRef<EditorHandle, EditorProps>(({ value, onChange, simple, slashCommands = NO_COMMANDS, context }, ref) => {
    const handleImageUpload = async (file: File) => {
        if (!file.type.startsWith('image/')) return;

        const toastId = toast.loading('Uploading image...');
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            if (!res.ok) throw new Error('Upload failed');
            const data = await res.json();
            return data.url;
        } catch (e) {
            console.error(e);
            toast.error('Image upload failed', { id: toastId });
            return null;
        } finally {
            toast.dismiss(toastId);
        }
    };

    const lastValueRef = useRef(value);

    // --- Comandos "/" ---
    const slashId = useId();
    const [slashMenu, setSlashMenu] = useState<SlashMenuState>(SLASH_CLOSED);
    const slashMenuRef = useRef(slashMenu);
    slashMenuRef.current = slashMenu;
    const slashCommandsRef = useRef(slashCommands);
    slashCommandsRef.current = slashCommands;
    const simpleRef = useRef(simple);
    simpleRef.current = simple;
    const slashApiRef = useRef<{ sync: (ed: TiptapEditor) => void; handleKey: (key: string) => boolean }>({ sync: () => { }, handleKey: () => false });

    /** Abre/actualiza/cierra el menu segun el texto de la linea hasta el cursor. */
    const syncSlashMenu = (ed: TiptapEditor) => {
        const close = () => setSlashMenu(prev => (prev.open ? { ...prev, open: false } : prev));
        if (simpleRef.current || slashCommandsRef.current.length === 0) return close();

        const { selection } = ed.state;
        const { $from, empty } = selection;
        if (!empty) return close();

        const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');
        const parsed = parseSlashInput(textBefore, slashCommandsRef.current);
        if (!parsed) return close();

        let x = 0;
        let y = 0;
        try {
            const coords = ed.view.coordsAtPos($from.pos);
            x = coords?.left || 0;
            y = (coords?.bottom || 0) + 8;
        } catch { /* sin layout (p. ej. jsdom) */ }

        const from = $from.pos - $from.parentOffset + parsed.start;
        setSlashMenu(prev => ({
            open: true,
            x,
            y,
            query: parsed.query,
            args: parsed.args,
            exactMatch: parsed.exactMatch,
            range: { from, to: $from.pos },
            index: prev.open && prev.query === parsed.query ? prev.index : 0,
        }));
    };

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            // StarterKit 3.x ya trae link y underline: se desactivan para usar las versiones propias (evita 'Duplicate extension names').
            StarterKit.configure({ link: false, underline: false }),
            Underline,
            TextStyle,
            Color,
            FontFamily,
            ImageExtension.configure({
                inline: true,
                allowBase64: true,
                HTMLAttributes: {
                    class: 'max-w-full h-auto rounded-md shadow-sm',
                },
            }),
            TextAlign.configure({
                types: ['heading', 'paragraph', 'image'],
            }),
            Link.extend({
                addAttributes() {
                    return {
                        ...this.parent?.(),
                        style: {
                            default: null,
                            parseHTML: element => element.getAttribute('style'),
                            renderHTML: attributes => {
                                if (!attributes.style) return {};
                                return { style: attributes.style };
                            },
                        },
                        class: {
                            default: null,
                            parseHTML: element => element.getAttribute('class'),
                            renderHTML: attributes => {
                                if (!attributes.class) return {};
                                return { class: attributes.class };
                            },
                        }
                    };
                },

            }).configure({
                openOnClick: false,
                HTMLAttributes: {
                    class: 'text-primary hover:underline cursor-pointer',
                },
            }),
            Placeholder.configure({
                placeholder: 'Type your message...',
            }),
            Table.configure({
                resizable: false,
                HTMLAttributes: {
                    class: 'bloomx-editor-table',
                },
            }),
            TableRow,
            TableHeader,
            TableCell,
        ],
        content: value,
        editorProps: {
            attributes: {
                class: 'prose prose-sm max-w-none focus:outline-none min-h-[200px] h-full p-4',
            },
            // Colores inline casi negros/blancos pegados desde otras webs/Word quedarian invisibles segun el tema.
            transformPastedHTML: (html) => sanitizePastedColors(html),
            handlePaste: (view, event, slice) => {
                const items = Array.from(event.clipboardData?.items || []);
                const images = items.filter(item => item.type.startsWith('image/'));
                if (images.length === 0) return false;
                event.preventDefault();
                images.forEach(item => {
                    const file = item.getAsFile();
                    if (file) {
                        handleImageUpload(file).then(url => {
                            if (url && editor) {
                                editor.chain().focus().setImage({ src: url }).run();
                            }
                        });
                    }
                });
                return true;
            },
            handleKeyDown: (view, event) => {
                // Menu "/" abierto: flechas / Enter / Tab / Escape (ver slashKeyAction)
                if (!event.isComposing && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && slashApiRef.current.handleKey(event.key)) {
                    event.preventDefault();
                    return true;
                }
                if (event.key === 'Backspace' && editor) {
                    const { selection } = view.state;
                    if (selection.empty) {
                        const { $from } = selection;
                        const linkMark = view.state.schema.marks.link;

                        // Check if we are inside or right after a link
                        const hasLink = $from.marks().some(m => m.type === linkMark) ||
                            ($from.nodeBefore && $from.nodeBefore.marks.some(m => m.type === linkMark));

                        if (hasLink) {
                            editor.chain().extendMarkRange('link').deleteSelection().run();
                            return true;
                        }
                    }
                }
                return false;
            },
        },
        onUpdate: ({ editor }) => {
            const content = editor.getHTML();
            lastValueRef.current = content;
            onChange(content);

            slashApiRef.current.sync(editor);
        },
        onSelectionUpdate: ({ editor }) => {
            slashApiRef.current.sync(editor);
        },
    });

    useImperativeHandle(ref, () => ({
        insertContent: (content: string) => {
            if (editor) {
                editor.chain().focus().insertContent(content).run();
            }
        },
        prependContent: (content: string) => {
            if (editor) {
                const current = editor.getHTML();
                const newContent = content + current;
                lastValueRef.current = newContent;
                editor.commands.setContent(newContent);
            }
        }
    }));

    useEffect(() => {
        if (!editor) return;
        if (value !== lastValueRef.current) {
            editor.commands.setContent(value);
            lastValueRef.current = value;
        }
    }, [value, editor]);

    // Filtrado y comando activo (el estado del menu se declara arriba, junto a los refs)
    const filteredCommands = useMemo(() => filterSlashCommands(slashCommands, slashMenu.query), [slashCommands, slashMenu.query]);
    const exactCommand = slashMenu.exactMatch
        ? slashCommands.find(c => c.key.toLowerCase() === slashMenu.query.toLowerCase())
        : undefined;
    const activeIndex = exactCommand
        ? Math.max(0, filteredCommands.findIndex(c => c.key === exactCommand.key))
        : Math.min(slashMenu.index, Math.max(0, filteredCommands.length - 1));

    const closeSlashMenu = () => setSlashMenu(prev => (prev.open ? { ...prev, open: false } : prev));

    /** Borra el texto "/comando args" del documento y ejecuta el comando con sus argumentos. */
    const executeCommand = (cmd: SlashCommand) => {
        if (!editor) return;
        const menu = slashMenuRef.current;
        const to = editor.state.selection.to;
        const from = menu.range.from;
        if (from > 0 && from < to) {
            editor.chain().focus().deleteRange({ from, to }).run();
        }
        closeSlashMenu();
        cmd.execute?.(menu.args.trim());
    };

    /** Tab: completa "/tr" -> "/translate " (pasa a modo argumentos). */
    const completeCommand = (cmd: SlashCommand) => {
        if (!editor) return;
        const menu = slashMenuRef.current;
        editor.chain().focus().insertContentAt({ from: menu.range.from, to: editor.state.selection.to }, `/${cmd.key} `).run();
    };

    // Los handlers de TipTap se crean una sola vez: leen siempre la ultima version de estas funciones por ref.
    slashApiRef.current = {
        sync: syncSlashMenu,
        handleKey: (key: string) => {
            const menu = slashMenuRef.current;
            if (!menu.open) return false;
            const commands = filterSlashCommands(slashCommandsRef.current, menu.query);
            const exact = menu.exactMatch
                ? slashCommandsRef.current.find(c => c.key.toLowerCase() === menu.query.toLowerCase())
                : undefined;
            const count = exact ? 1 : commands.length;
            const action = slashKeyAction(key, { exactMatch: menu.exactMatch, count, index: menu.index });
            switch (action.type) {
                case 'move': setSlashMenu(prev => ({ ...prev, index: action.index })); return true;
                case 'execute': {
                    const cmd = exact ?? commands[action.index];
                    if (cmd) executeCommand(cmd);
                    return !!cmd;
                }
                case 'complete': {
                    const cmd = commands[action.index];
                    if (cmd) completeCommand(cmd);
                    return !!cmd;
                }
                case 'close': closeSlashMenu(); return true;
                default: return false;
            }
        },
    };

    const setLink = () => {
        if (!editor) return;
        const previousUrl = editor.getAttributes('link').href;
        const url = window.prompt('URL', previousUrl);

        if (url === null) return;

        if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return;
        }

        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    };

    // ARIA: el lector de pantalla sigue la opcion activa mientras el foco esta en el editor.
    useEffect(() => {
        if (!editor) return;
        const dom = editor.view.dom;
        if (slashMenu.open && filteredCommands.length > 0) {
            dom.setAttribute('aria-controls', slashListboxId(slashId));
            dom.setAttribute('aria-activedescendant', slashOptionId(slashId, activeIndex));
        } else {
            dom.removeAttribute('aria-controls');
            dom.removeAttribute('aria-activedescendant');
        }
    }, [editor, slashMenu.open, filteredCommands.length, activeIndex, slashId]);

    return (
        <div className="flex flex-col h-full border border-border rounded-md overflow-hidden bg-card relative">
            <style dangerouslySetInnerHTML={{
                __html: `
                .bloomx-editor-table {
                    border-collapse: separate;
                    border-spacing: 0;
                    width: auto !important;
                    margin: 16px 0 !important;
                    table-layout: auto !important;
                }
                .bloomx-editor-table td {
                    border: none !important;
                    padding: 0 !important;
                    background: none !important;
                }
                /* Reset prose table styles */
                .prose table.bloomx-editor-table {
                    margin: 16px 0 !important;
                }
                .prose table.bloomx-editor-table tr {
                    border: none !important;
                }
            `}} />
            {/* Menu de comandos "/" de las extensiones instaladas */}
            {slashMenu.open && (
                <SlashMenu
                    id={slashId}
                    commands={filteredCommands}
                    activeIndex={activeIndex}
                    x={slashMenu.x}
                    y={slashMenu.y}
                    onSelect={executeCommand}
                    onHover={(index) => setSlashMenu(prev => ({ ...prev, index }))}
                />
            )}

            <div className="flex flex-wrap items-center gap-1 p-2 border-b border-border bg-muted/50 sticky top-0 z-10">
                <div className="flex items-center gap-0.5 border-r border-input pr-2 mr-1">
                    <ToolbarButton
                        onClick={() => editor?.chain().focus().undo().run()}
                        disabled={!editor?.can().undo()}
                        icon={<Undo className="w-4 h-4" />}
                        title="Undo"
                    />
                    <ToolbarButton
                        onClick={() => editor?.chain().focus().redo().run()}
                        disabled={!editor?.can().redo()}
                        icon={<Redo className="w-4 h-4" />}
                        title="Redo"
                    />
                </div>

                <select
                    className="h-7 text-xs border border-border rounded px-1 min-w-[100px] focus:outline-none focus:border-input bg-transparent"
                    aria-label="Fuente"
                    onChange={(e) => {
                        const chain = editor?.chain().focus();
                        if (!chain) return;
                        if (e.target.value) chain.setFontFamily(e.target.value).run();
                        else chain.unsetFontFamily().run();
                    }}
                    value={editor?.getAttributes('textStyle')?.fontFamily || ''}
                >
                    <option value="">Font</option>
                    {fonts.map(font => <option key={font.name} value={font.value}>{font.name}</option>)}
                </select>

                <div className="w-px h-4 bg-border mx-1" />

                <ToolbarButton onClick={() => editor?.chain().focus().toggleBold().run()} isActive={editor?.isActive('bold')} icon={<Bold className="w-4 h-4" />} title="Bold" />
                <ToolbarButton onClick={() => editor?.chain().focus().toggleItalic().run()} isActive={editor?.isActive('italic')} icon={<Italic className="w-4 h-4" />} title="Italic" />
                <ToolbarButton onClick={() => editor?.chain().focus().toggleUnderline().run()} isActive={editor?.isActive('underline')} icon={<UnderlineIcon className="w-4 h-4" />} title="Underline" />
                <ToolbarButton onClick={() => editor?.chain().focus().toggleStrike().run()} isActive={editor?.isActive('strike')} icon={<Strikethrough className="w-4 h-4" />} title="Strike" />

                {!simple && (
                    <div className="relative group">
                        <button type="button" aria-label="Color de texto" aria-haspopup="true" title="Color de texto" className={cn("p-1.5 rounded hover:bg-secondary text-foreground", editor?.isActive('textStyle') && "bg-secondary")}>
                            <Palette className="w-4 h-4" style={{ color: editor?.getAttributes('textStyle')?.color }} />
                        </button>
                        <div className="absolute top-full left-0 mt-1 p-2 bg-card text-card-foreground border border-border shadow-lg rounded-md grid grid-cols-10 gap-1 w-[200px] hidden group-hover:grid group-focus-within:grid z-50">
                            {colors.map(color => (
                                <button
                                    key={color}
                                    type="button"
                                    aria-label={`Color ${color}`}
                                    className="w-4 h-4 rounded-full border border-border/60 hover:scale-125 transition-transform"
                                    style={{ backgroundColor: color }}
                                    onClick={() => editor?.chain().focus().setColor(color).run()}
                                    title={color}
                                />
                            ))}
                        </div>
                    </div>
                )}

                <div className="w-px h-4 bg-border mx-1" />

                <ToolbarButton onClick={() => editor?.chain().focus().setTextAlign('left').run()} isActive={editor?.isActive({ textAlign: 'left' })} icon={<AlignLeft className="w-4 h-4" />} title="Align Left" />
                <ToolbarButton onClick={() => editor?.chain().focus().setTextAlign('center').run()} isActive={editor?.isActive({ textAlign: 'center' })} icon={<AlignCenter className="w-4 h-4" />} title="Align Center" />
                <ToolbarButton onClick={() => editor?.chain().focus().setTextAlign('right').run()} isActive={editor?.isActive({ textAlign: 'right' })} icon={<AlignRight className="w-4 h-4" />} title="Align Right" />

                <div className="w-px h-4 bg-border mx-1" />

                <ToolbarButton onClick={() => editor?.chain().focus().toggleBulletList().run()} isActive={editor?.isActive('bulletList')} icon={<List className="w-4 h-4" />} title="Bullet List" />
                <ToolbarButton onClick={() => editor?.chain().focus().toggleOrderedList().run()} isActive={editor?.isActive('orderedList')} icon={<ListOrdered className="w-4 h-4" />} title="Ordered List" />
                <ToolbarButton onClick={() => editor?.chain().focus().toggleBlockquote().run()} isActive={editor?.isActive('blockquote')} icon={<Quote className="w-4 h-4" />} title="Quote" />
                <ToolbarButton onClick={setLink} isActive={editor?.isActive('link')} icon={<Link2 className="w-4 h-4" />} title="Link" />

                <div className="ml-auto">
                    <ToolbarButton onClick={() => editor?.chain().focus().unsetAllMarks().run()} icon={<RemoveFormatting className="w-4 h-4" />} title="Clear Formatting" />
                </div>
            </div>

            <div
                className="flex-1 overflow-y-auto cursor-text text-foreground"
                onClick={(e) => {
                    if (e.target === e.currentTarget) {
                        editor?.chain().focus().run();
                    }
                }}
            >
                <EditorContent editor={editor} className="h-full min-h-[300px]" />
            </div>
        </div>
    );
});

Editor.displayName = 'Editor';

function ToolbarButton({ onClick, isActive, icon, title, disabled }: { onClick: () => void, isActive?: boolean, icon: React.ReactNode, title: string, disabled?: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            aria-label={title}
            aria-pressed={isActive === undefined ? undefined : !!isActive}
            className={cn(
                "p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground",
                isActive ? "bg-secondary text-foreground" : "hover:bg-secondary",
                disabled && "opacity-50 cursor-not-allowed hover:bg-transparent"
            )}
        >
            {icon}
        </button>
    );
}
