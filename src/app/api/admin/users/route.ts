
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { auditLog, BCRYPT_COST, validateNewPassword } from "@/lib/security";

// GET: List all users
export async function GET(req: NextRequest) {
    const guard = await requireAdmin(req);
    if (!guard.ok) return guard.response;

    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                name: true,
                email: true,
                createdAt: true,
                avatar: true,
            },
            orderBy: { createdAt: "desc" },
        });

        return NextResponse.json(users);
    } catch (error) {
        console.error("[ADMIN_USERS_GET]", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// POST: Create a new user
export async function POST(req: NextRequest) {
    const guard = await requireAdmin(req);
    if (!guard.ok) return guard.response;

    try {
        const { email, name, password } = await req.json();

        if (!email || !password) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const passwordError = validateNewPassword(password, email);
        if (passwordError) {
            return NextResponse.json({ error: passwordError }, { status: 400 });
        }

        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            return NextResponse.json({ error: "User already exists" }, { status: 409 });
        }

        const hashedPassword = await bcrypt.hash(password, BCRYPT_COST);

        const newUser = await prisma.user.create({
            data: {
                email,
                name,
                password: hashedPassword,
            },
        });

        auditLog("admin.user.created", { userId: newUser.id, email: newUser.email, managerId: (guard.actor as any)?.id });
        return NextResponse.json({
            success: true,
            user: { id: newUser.id, email: newUser.email, name: newUser.name },
        });

    } catch (error) {
        console.error("[ADMIN_USERS_POST]", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
