'use client';

import { useEditor, EditorContent } from '@tiptap/react';
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
import { useEffect, useState, useRef, forwardRef, useImperativeHandle } from 'react';

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
    slashCommands?: any[];
    context?: any;
}

export const Editor = forwardRef<EditorHandle, EditorProps>(({ value, onChange, simple, slashCommands = [], context }, ref) => {
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

    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit,
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

            if (simple) return;

            // Slash Command Detection
            const { state } = editor;
            const { selection } = state;
            const { $from, empty } = selection;

            if (empty) {
                // Get text in current line before cursor
                const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');
                const match = textBefore.match(/(?:^|\s)\/([a-zA-Z0-9-_]*)(?:\s+(.*))?$/);

                if (match) {
                    const query = match[1];
                    const args = match[2] || '';
                    const exact = slashCommands.find(c => c.key === query);

                    const fullMatch = match[0];
                    const matchStartInParent = textBefore.lastIndexOf(fullMatch);
                    const startOffset = fullMatch.startsWith(' ') ? 1 : 0;
                    const commandStartPos = $from.pos - $from.parentOffset + matchStartInParent + startOffset;

                    const coords = editor.view.coordsAtPos($from.pos);
                    setSlashMenu(prev => ({
                        ...prev,
                        open: true,
                        x: coords?.left || 0,
                        y: (coords?.bottom || 0) + 8,
                        query,
                        args,
                        exactMatch: !!exact,
                        range: { from: commandStartPos, to: $from.pos }
                    }));
                } else if (slashMenu.open) {
                    setSlashMenu(prev => ({ ...prev, open: false }));
                }
            } else if (slashMenu.open) {
                setSlashMenu(prev => ({ ...prev, open: false }));
            }
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

    // Slash Menu State
    const [slashMenu, setSlashMenu] = useState<{
        open: boolean;
        query: string;
        args: string; // Captured arguments after command
        x: number;
        y: number;
        index: number;
        exactMatch: boolean; // True if 'query' matches a command key exactly (or with space)
        range: { from: number; to: number }; // Absolute document range of the command text
    }>({
        open: false, query: '', args: '', x: 0, y: 0, index: 0, exactMatch: false, range: { from: 0, to: 0 }
    });

    // The previous useEffect for updateListener is replaced by the onUpdate logic.
    // This useEffect is now only for handling the slash menu state based on editor changes.
    // The detection logic is now in onUpdate.

    const filteredCommands = slashCommands.filter(c =>
        c.key.toLowerCase().startsWith(slashMenu.query.toLowerCase()) ||
        c.description.toLowerCase().includes(slashMenu.query.toLowerCase())
    );

    // If we have an exact match (e.g. /giphy), we might want to ONLY show that command, 
    // OR if we are in 'args' mode, we show the Preview for that command.
    // Logic: If exactMatch is true, we lock to that command.
    const activeCommand = slashMenu.exactMatch
        ? slashCommands.find(c => c.key === slashMenu.query)
        : filteredCommands[slashMenu.index];

    const PreviewComponent = activeCommand?.Component;

    const executeCommand = (cmd: any) => {
        if (!editor) return;
        const { state } = editor;
        const { selection } = state;

        // Preference 1: Use the range we stored during detection
        let from = slashMenu.range.from;
        let to = selection.to; // to the current cursor

        // Preference 2: If range seems invalid or missing, scan back in the parent
        if (from <= 0 || from >= to) {
            const { $from } = selection;
            const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');
            const match = textBefore.match(/(?:^|\s)\/([a-zA-Z0-9-_]*)(?:\s+(.*))?$/);
            if (match) {
                const fullMatch = match[0];
                const matchStartInParent = textBefore.lastIndexOf(fullMatch);
                const startOffset = fullMatch.startsWith(' ') ? 1 : 0;
                from = $from.pos - $from.parentOffset + matchStartInParent + startOffset;
            }
        }

        if (from > 0 && from < to) {
            editor.chain()
                .focus()
                .deleteRange({ from, to })
                .run();
        }

        setSlashMenu(prev => ({ ...prev, open: false }));
        // Pass args!
        if (cmd?.execute) cmd.execute(slashMenu.args);
    };

    const extendedContext = {
        ...context,
        onClose: () => setSlashMenu(prev => ({ ...prev, open: false })),
        execute: () => {
            if (activeCommand) executeCommand(activeCommand);
        }
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

    // Intercept Keys
    useEffect(() => {
        if (!editor || !slashMenu.open) return;
        if (simple) return; // Disable slash menu key handling if simple mode

        const dom = editor.view.dom;
        const handler = (e: KeyboardEvent) => {
            if (!slashMenu.open) return;

            // If we are in Argument Mode (exact match), we might want to capture Enter to execute,
            // but allow other keys (typing args).
            // However, Arrow keys might navigate the preview UI? 
            // For now, Slash Menu handles navigation if filtered list > 1.
            // If exact match, list is likely length 1.

            if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) {

                // Special Case: If PreviewComponent wants to handle keys (e.g. arrow keys in Giphy grid),
                // we might need a way to delegate. 
                // For simplicity: If args mode, only Enter/Escape are trapped by us. 
                // Arrows propagate to editor (to move cursor)? No, usually arrows navigate the list.
                // If list has 1 item (the active command), arrows do nothing?
                // Let's keep preventing default to avoid moving cursor out of slash command range easily.

                if (slashMenu.exactMatch) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        if (activeCommand) executeCommand(activeCommand);
                        return;
                    }
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        setSlashMenu(prev => ({ ...prev, open: false }));
                        return;
                    }
                    // Allow arrows/typing to pass through for args editing
                    return;
                }

                e.stopPropagation();
                e.preventDefault();

                if (e.key === 'ArrowDown') {
                    setSlashMenu(prev => ({ ...prev, index: (prev.index + 1) % filteredCommands.length }));
                } else if (e.key === 'ArrowUp') {
                    setSlashMenu(prev => ({ ...prev, index: (prev.index - 1 + filteredCommands.length) % filteredCommands.length }));
                } else if (e.key === 'Enter') {
                    if (filteredCommands[slashMenu.index]) {
                        executeCommand(filteredCommands[slashMenu.index]);
                    }
                } else if (e.key === 'Tab') {
                    const cmd = filteredCommands[slashMenu.index];
                    if (cmd && editor) {
                        const { state } = editor;
                        const { selection } = state;
                        const { $from } = selection;
                        const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');
                        const match = textBefore.match(/(?:^|\s)\/([a-zA-Z0-9-_]*)$/);
                        if (match) {
                            const fullMatch = match[0];
                            const matchStartInParent = textBefore.lastIndexOf(fullMatch);
                            const startOffset = fullMatch.startsWith(' ') ? 1 : 0;
                            const from = $from.pos - $from.parentOffset + matchStartInParent + startOffset;
                            editor.chain().focus().insertContentAt({ from, to: $from.pos }, '/' + cmd.key + ' ').run();
                        }
                    }
                } else if (e.key === 'Escape') {
                    setSlashMenu(prev => ({ ...prev, open: false }));
                }
            }
        };

        dom.addEventListener('keydown', handler, { capture: true });
        return () => dom.removeEventListener('keydown', handler, { capture: true });
    }, [editor, slashMenu.open, filteredCommands, slashMenu.index, slashMenu.exactMatch, activeCommand, simple]);

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
            {/* Slash Menu Overlay */}
            {slashMenu.open && (
                <div
                    className="fixed z-50 bg-card border border-border shadow-xl rounded-md w-80 max-h-[500px] flex flex-col animate-in fade-in zoom-in-95 font-sans"
                    style={{ left: slashMenu.x, top: slashMenu.y }}
                >
                    {/* Header / Preview Area - Only shown if command is typed exactly */}
                    {slashMenu.exactMatch && PreviewComponent && (
                        <div className={cn(
                            activeCommand.header !== false && "border-b bg-muted/50"
                        )}>
                            {/* Passed args and context props to component */}
                            {/* @ts-ignore */}
                            <PreviewComponent args={slashMenu.args} context={extendedContext} />
                        </div>
                    )}

                    {/* Command List (Hidden if exact match? No, maybe show it to allow confirming) */}
                    {(!slashMenu.exactMatch || filteredCommands.length > 1) && (
                        <div className="overflow-y-auto p-1 max-h-48">
                            {filteredCommands.length === 0 ? (
                                <div className="px-3 py-2 text-xs text-muted-foreground">No commands found</div>
                            ) : (
                                filteredCommands.map((cmd, i) => (
                                    <div
                                        key={cmd.key}
                                        className={cn(
                                            "flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors cursor-pointer",
                                            i === slashMenu.index ? "bg-primary/10 text-primary" : "hover:bg-muted"
                                        )}
                                        onClick={() => executeCommand(cmd)}
                                    >
                                        <div className="flex items-center justify-center w-5 h-5 rounded bg-secondary/50 text-muted-foreground font-bold text-[10px]">/</div>
                                        <div className="flex flex-col leading-tight overflow-hidden">
                                            <span className="font-semibold text-xs truncate">
                                                {cmd.key}
                                                {/* @ts-ignore */}
                                                {cmd.arguments && <span className="ml-1 text-muted-foreground font-normal opacity-75">{cmd.arguments}</span>}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground truncate">{cmd.description}</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
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
                    onChange={(e) => editor?.chain().focus().setFontFamily(e.target.value).run()}
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
                        <button className={cn("p-1.5 rounded hover:bg-secondary text-foreground/80", editor?.isActive('textStyle') && "bg-secondary")}>
                            <Palette className="w-4 h-4" style={{ color: editor?.getAttributes('textStyle')?.color }} />
                        </button>
                        <div className="absolute top-full left-0 mt-1 p-2 bg-card border border-border shadow-lg rounded-md grid grid-cols-10 gap-1 w-[200px] hidden group-hover:grid z-50">
                            {colors.map(color => (
                                <button
                                    key={color}
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
