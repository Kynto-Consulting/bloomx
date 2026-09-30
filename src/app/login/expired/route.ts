import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookies } from "@/lib/session-cookie";

/**
 * Destino del guardia de sesion de (app)/layout.tsx: la cookie es un JWT con firma valida pero la sesion ya no vale
 * (caducada por inactividad, revocada, usuario deshabilitado). Se borra (las dos variantes del nombre) y se manda al login.
 */
export async function GET(req: NextRequest) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const res = NextResponse.redirect(url);
    clearSessionCookies(res.cookies);
    res.headers.set("Cache-Control", "no-store");
    return res;
}
