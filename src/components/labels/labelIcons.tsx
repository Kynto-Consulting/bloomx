'use client';

import {
    Archive, Bell, Book, Briefcase, Camera, Code, Flag, Folder, FolderOpen, Gift, GraduationCap, Heart, House, Inbox, Mail, Music,
    Plane, Receipt, Shield, ShoppingCart, Star, Tag, User, Users, Wallet, type LucideIcon,
} from 'lucide-react';
import type { LabelIcon } from '@/lib/labels/model';

export const ICON_COMPONENTS: Record<LabelIcon, LucideIcon> = {
    tag: Tag, folder: Folder, briefcase: Briefcase, star: Star, heart: Heart, home: House, cart: ShoppingCart, receipt: Receipt,
    plane: Plane, book: Book, user: User, users: Users, bell: Bell, flag: Flag, inbox: Inbox, mail: Mail, archive: Archive,
    shield: Shield, wallet: Wallet, graduation: GraduationCap, code: Code, camera: Camera, music: Music, gift: Gift,
};

interface GlyphProps {
    behavior?: 'tag' | 'folder';
    icon?: string | null;
    color?: string | null;
    open?: boolean;
    className?: string;
}

/** Icono de una etiqueta: el elegido; si no, punto de color (etiqueta) o carpeta (carpeta). El color es un DATO del usuario. */
export function LabelGlyph({ behavior = 'tag', icon, color, open, className = 'h-4 w-4' }: GlyphProps) {
    const Custom = icon ? ICON_COMPONENTS[icon as LabelIcon] : undefined;
    if (Custom) return <Custom aria-hidden="true" className={className} style={{ color: color ?? undefined }} />;
    if (behavior === 'folder') {
        const F = open ? FolderOpen : Folder;
        return <F aria-hidden="true" className={className} style={{ color: color ?? undefined }} />;
    }
    return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-sidebar-border" style={{ backgroundColor: color ?? undefined }} />;
}
