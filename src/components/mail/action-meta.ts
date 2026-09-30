import {
    Archive, ArchiveRestore, Trash2, RotateCcw, ShieldAlert, ShieldCheck, FolderInput, Tag, MailOpen, Mail, Star, Clock, CalendarX, CalendarClock, Send, Pencil,
    type LucideIcon,
} from 'lucide-react';
import type { MailActionId } from '@/lib/mail-actions';

export interface ActionMeta {
    icon: LucideIcon;
    /** Clave i18n de la etiqueta (emailList.actions.<id>). */
    labelKey: string;
    destructive?: boolean;
}

/** Icono y texto de cada accion: una sola fuente para lector, lista, barra masiva, hover y menus. */
export const ACTION_META: Record<MailActionId, ActionMeta> = {
    archive: { icon: Archive, labelKey: 'emailList.actions.archive' },
    unarchive: { icon: ArchiveRestore, labelKey: 'emailList.actions.unarchive' },
    trash: { icon: Trash2, labelKey: 'emailList.actions.trash', destructive: true },
    restore: { icon: RotateCcw, labelKey: 'emailList.actions.restore' },
    deleteForever: { icon: Trash2, labelKey: 'emailList.actions.deleteForever', destructive: true },
    deleteDraft: { icon: Trash2, labelKey: 'emailList.actions.deleteDraft', destructive: true },
    spam: { icon: ShieldAlert, labelKey: 'emailList.actions.spam' },
    notSpam: { icon: ShieldCheck, labelKey: 'emailList.actions.notSpam' },
    move: { icon: FolderInput, labelKey: 'emailList.actions.move' },
    label: { icon: Tag, labelKey: 'emailList.actions.label' },
    markRead: { icon: MailOpen, labelKey: 'emailList.actions.markRead' },
    markUnread: { icon: Mail, labelKey: 'emailList.actions.markUnread' },
    star: { icon: Star, labelKey: 'emailList.actions.star' },
    unstar: { icon: Star, labelKey: 'emailList.actions.unstar' },
    snooze: { icon: Clock, labelKey: 'emailList.actions.snooze' },
    cancelSchedule: { icon: CalendarX, labelKey: 'emailList.actions.cancelSchedule' },
    reschedule: { icon: CalendarClock, labelKey: 'emailList.actions.reschedule' },
    sendNow: { icon: Send, labelKey: 'emailList.actions.sendNow' },
    editScheduled: { icon: Pencil, labelKey: 'emailList.actions.editScheduled' },
    deleteScheduled: { icon: Trash2, labelKey: 'emailList.actions.deleteScheduled', destructive: true },
};
