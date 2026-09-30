import { z } from 'zod';
import { LEVELS } from './config-core';
import { TUNABLE_FAMILIES } from './types';

const familyWeights = z.object(Object.fromEntries(TUNABLE_FAMILIES.map((f) => [f, z.number().min(0).max(2)])) as Record<(typeof TUNABLE_FAMILIES)[number], z.ZodNumber>).partial().strict();
const action = z.enum(['deliver', 'warn', 'spam']);

/** PATCH parcial: solo claves conocidas; lo demas se sanea en sanitizeSpamConfig. `reject` no existe para el score. */
export const configPatchSchema = z.object({
    level: z.enum(LEVELS).optional(),
    threshold: z.number().min(1).max(100).optional(),
    actions: z.object({ suspicious: action.optional(), spam: action.optional() }).strict().optional(),
    familyWeights: familyWeights.optional(),
    engine: z.object({ content: z.boolean(), links: z.boolean(), learning: z.boolean(), context: z.boolean() }).partial().strict().optional(),
    allowUserSensitivity: z.boolean().optional(),
    logRetentionDays: z.number().int().min(1).max(365).optional(),
    logDelivered: z.boolean().optional(),
    external: z.object({
        enabled: z.boolean(), style: z.enum(['info', 'warning']), subjectTag: z.boolean(), colleagueSpoof: z.boolean(), firstTime: z.boolean(),
        hardenLinks: z.boolean(), hardenAttachments: z.boolean(), internalDomains: z.array(z.string().max(253)).max(50),
        text: z.object({ es: z.string().max(1000), en: z.string().max(1000) }).partial().strict(),
    }).partial().strict().optional(),
}).strict();
