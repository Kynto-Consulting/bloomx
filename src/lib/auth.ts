import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { auditLog, getDummyBcryptHash, rateLimitAsync } from "@/lib/security";
import { getSessionTtlSeconds } from "@/lib/jwt";
import { getMfaStatus, mfaRequiredFor } from "@/lib/mfa";

export const authOptions: NextAuthOptions = {
    // `prisma` lleva la extension de cifrado de tokens OAuth (lib/account-tokens.ts): el tipo ya no es PrismaClient puro.
    adapter: PrismaAdapter(prisma as any),
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID || "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
            authorization: {
                params: {
                    scope: "openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly",
                    prompt: "consent",
                    access_type: "offline",
                    response_type: "code"
                }
            }
        }),
        CredentialsProvider({
            name: "Credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" }
            },
            async authorize(credentials, req) {
                if (!credentials?.email || !credentials?.password) {
                    return null;
                }

                const ip = String((req as any)?.headers?.["x-forwarded-for"] || "unknown").split(",")[0].trim();
                const rl = await rateLimitAsync(`nextauth:${ip}:${String(credentials.email).toLowerCase()}`, 10, 15 * 60_000);
                if (!rl.ok) {
                    auditLog("auth.nextauth.rate_limited", { ip });
                    return null;
                }

                const user = await prisma.user.findUnique({
                    where: { email: credentials.email }
                });

                // bcrypt.compare siempre (igualar tiempos, anti-enumeracion); sin logs con PII
                const hash = user?.password || (await getDummyBcryptHash());
                const isPasswordValid = await bcrypt.compare(credentials.password, hash);

                if (!user || !user.password || !isPasswordValid) {
                    auditLog("auth.nextauth.failure", { email: credentials.email, ip });
                    return null;
                }

                // Este proveedor solo valida la contrasena: no puede saltarse el segundo factor. Las cuentas con MFA
                // (activo u obligatorio) deben iniciar sesion por /api/auth/login + /api/auth/mfa/verify.
                const mfa = await getMfaStatus(user.id).catch(() => null);
                if (mfaRequiredFor(user.email) || !mfa || mfa.enabled) {
                    auditLog("auth.nextauth.mfa_blocked", { userId: user.id, ip });
                    return null;
                }

                auditLog("auth.nextauth.success", { userId: user.id, ip });

                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    // image: user.avatar, // Commenting out to prevent cookie size issues
                };
            }
        })
    ],
    session: {
        strategy: "jwt",
        maxAge: getSessionTtlSeconds(),
    },
    pages: {
        signIn: "/login",
    },
    callbacks: {
        async session({ session, token }) {

            if (token && session.user) {
                // @ts-ignore
                session.user.id = token.id as string;
                // @ts-ignore
                // session.user.image = token.picture;
                session.user.name = token.name;
            }
            return session;
        },
        async jwt({ token, user, trigger, session }) {
            if (user) {
                token.id = user.id;
                // token.picture = user.image;
                token.name = user.name;
            }

            if (trigger === "update" && session) {
                if (session.user.name) token.name = session.user.name;
                // if (session.user.image) token.picture = session.user.image;
            }

            return token;
        },
        async redirect({ url, baseUrl }) {
            // Allows relative callback URLs
            if (url.startsWith("/")) return `${baseUrl}${url}`;
            // Allows callback URLs on the same origin
            try {
                if (new URL(url).origin === baseUrl) return url;
            } catch {
                // URL invalida: volver a baseUrl
            }
            return baseUrl;
        }
    },
    secret: process.env.NEXTAUTH_SECRET,
};
