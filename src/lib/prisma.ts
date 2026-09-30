import { PrismaClient } from '@prisma/client'
import { withAccountTokenEncryption } from './account-tokens'

// Cliente con extension de cifrado en reposo de los tokens OAuth de Account (ver account-tokens.ts).
const createClient = () => withAccountTokenEncryption(new PrismaClient())
type AppPrismaClient = ReturnType<typeof createClient>

const globalForPrisma = global as unknown as { prisma: AppPrismaClient }

export const prisma = globalForPrisma.prisma || createClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
