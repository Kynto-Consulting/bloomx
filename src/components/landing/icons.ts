import {
    BarChart3, Bell, Building2, Calendar, Check, Cloud, File, Globe, Headphones, Heart, Inbox, Key, Lock, Mail,
    Rocket, Send, Shield, Sparkles, Star, Users, Zap, Clock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { LandingIcon } from '@/lib/landing-config';

/** Lista blanca de iconos: el nombre de la config solo elige de aqui, nunca importa nada dinamico. */
export const LANDING_ICON_MAP: Record<LandingIcon, LucideIcon> = {
    shield: Shield, lock: Lock, zap: Zap, globe: Globe, mail: Mail, users: Users, sparkles: Sparkles,
    check: Check, star: Star, heart: Heart, clock: Clock, cloud: Cloud, key: Key, inbox: Inbox, send: Send,
    calendar: Calendar, bell: Bell, file: File, headphones: Headphones, rocket: Rocket, chart: BarChart3,
    building: Building2,
};
