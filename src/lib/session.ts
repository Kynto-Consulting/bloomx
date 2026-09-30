import { cookies, headers } from "next/headers";
import { signJWT, verifyJWT, COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "./jwt";
import { prisma } from "./prisma";

// Atributos de cookie de sesion: HttpOnly + Secure (prod) + SameSite=Lax (CIS 16.x, NIST SC-23, ISO 27002 8.26)
export const SESSION_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
};

export async function setSessionCookie(payload: any) {
    const token = await signJWT(payload);
    (await cookies()).set(COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
    return token; // Return token for client-side storage
}

export async function getSessionCookie() {
    const headersList = await headers();
    const authHeader = headersList.get("authorization");
    let token = authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.substring(7)
        : null;

    if (!token) {
        const cookieStore = await cookies();
        token = cookieStore.get(COOKIE_NAME)?.value || null;
    }

    if (!token) return null;
    return await verifyJWT(token);
}

export async function clearSessionCookie() {
    (await cookies()).set(COOKIE_NAME, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
}

export async function getCurrentUser() {
    const session = await getSessionCookie();
    if (!session || !session.sub) return null;

    try {
        const user = await prisma.user.findUnique({
            where: { id: session.sub as string },
            select: {
                id: true,
                name: true,
                email: true,
                avatar: true,
            }
        });
        return user;
    } catch (error) {
        return null;
    }
}
