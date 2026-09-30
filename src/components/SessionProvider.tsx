"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface User {
    id: string;
    email: string;
    name?: string | null;
    avatar?: string | null;
}

interface SessionContextType {
    data: { user?: User } | null;
    status: "authenticated" | "loading" | "unauthenticated";
    update: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType>({
    data: null,
    status: "loading",
    update: async () => { },
});

/** Rutas sin sesion: no se expulsa al login desde ellas. */
const PUBLIC_PREFIXES = ["/login", "/register", "/docs", "/book", "/secure", "/admin"];
const isPublicPath = (pathname: string) => PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

export const SessionProvider =({ children }: { children: React.ReactNode }) => {
    const [session, setSession] = useState<{ user?: User } | null>(null);
    const [status, setStatus] = useState<"authenticated" | "loading" | "unauthenticated">("loading");

    const fetchSession = async () => {
        try {
            const res = await fetch("/api/auth/me");
            if (res.ok) {
                const data = await res.json();
                if (data.user) {
                    setSession({ user: data.user });
                    setStatus("authenticated");
                } else {
                    setSession(null);
                    setStatus("unauthenticated");
                }
            } else {
                setSession(null);
                setStatus("unauthenticated");
            }
        } catch (error) {
            console.error("Failed to fetch session:", error);
            setSession(null);
            setStatus("unauthenticated");
        }
    };

    useEffect(() => {
        fetchSession();
        // Pestanas largas: al volver a la ventana se revalida; si la sesion caduco/fue revocada, al login (la ruta borra la cookie vieja).
        const onVisible = () => {
            if (document.visibilityState !== "visible") return;
            fetch("/api/auth/me", { cache: "no-store" })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => {
                    if (d && d.user === null && !isPublicPath(window.location.pathname)) window.location.replace("/login/expired");
                })
                .catch(() => undefined);
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
    }, []);

    return (
        <SessionContext.Provider value={{ data: session, status, update: fetchSession }}>
            {children}
        </SessionContext.Provider>
    );
};

export const useSession = () => useContext(SessionContext);

export const signIn = (provider: string, options?: any) => {
    if (provider === "credentials") {
        window.location.href = "/login";
    } else {
        window.location.href = `/api/auth/${provider}`;
    }
};

export const signOut = async (options?: any) => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
};

export const getSession = async () => {
    const res = await fetch("/api/auth/me");
    if (res.ok) {
        const session = await res.json();
        return session;
    }
    return null;
};
