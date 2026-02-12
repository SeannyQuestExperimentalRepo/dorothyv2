/**
 * GET  /api/trends/saved — List user's saved trends
 * POST /api/trends/saved — Save a new trend
 *
 * All routes require authentication.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/../../auth";
import { prisma } from "@/lib/db";
import { authLimiter, applyRateLimit } from "@/lib/rate-limit";
import type { Sport } from "@prisma/client";

export const dynamic = "force-dynamic";

const VALID_SPORTS = ["NFL", "NCAAF", "NCAAMB", "NBA"];

// ─── GET: List saved trends ──────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 },
      );
    }

    const limited = applyRateLimit(req, authLimiter, session.user.id);
    if (limited) return limited;

    const trends = await prisma.savedTrend.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });

    return NextResponse.json({ success: true, trends });
  } catch (error) {
    console.error("[GET /api/trends/saved]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch saved trends" },
      { status: 500 },
    );
  }
}

// ─── POST: Save a new trend ──────────────────────────────────────────────────

interface SaveTrendBody {
  name: string;
  sport: string;
  query: Record<string, unknown>;
  description?: string;
  notifyEmail?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 },
      );
    }

    const limited = applyRateLimit(req, authLimiter, session.user.id);
    if (limited) return limited;

    const body = (await req.json()) as SaveTrendBody;

    if (!body.name || body.name.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Name is required" },
        { status: 400 },
      );
    }

    if (!body.sport || !VALID_SPORTS.includes(body.sport.toUpperCase())) {
      return NextResponse.json(
        { success: false, error: "Valid sport is required" },
        { status: 400 },
      );
    }

    if (!body.query || typeof body.query !== "object") {
      return NextResponse.json(
        { success: false, error: "Query object is required" },
        { status: 400 },
      );
    }

    // Check limit (max 20 saved trends per user)
    const count = await prisma.savedTrend.count({
      where: { userId: session.user.id },
    });
    if (count >= 20) {
      return NextResponse.json(
        { success: false, error: "Maximum 20 saved trends reached. Delete some to add new ones." },
        { status: 400 },
      );
    }

    const trend = await prisma.savedTrend.create({
      data: {
        userId: session.user.id,
        name: body.name.trim(),
        sport: body.sport.toUpperCase() as Sport,
        query: body.query as unknown as import("@prisma/client").Prisma.InputJsonValue,
        description: body.description?.trim() || null,
        notifyEmail: body.notifyEmail ?? false,
      },
    });

    return NextResponse.json({ success: true, trend }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/trends/saved]", error);
    return NextResponse.json(
      { success: false, error: "Failed to save trend" },
      { status: 500 },
    );
  }
}

// ─── PATCH: Update a saved trend (e.g., toggle email notifications) ─────────

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 },
      );
    }

    const limited = applyRateLimit(req, authLimiter, session.user.id);
    if (limited) return limited;

    const body = (await req.json()) as { id: number; notifyEmail?: boolean; isPublic?: boolean };

    if (!body.id) {
      return NextResponse.json(
        { success: false, error: "Trend id is required" },
        { status: 400 },
      );
    }

    // Verify ownership
    const trend = await prisma.savedTrend.findFirst({
      where: { id: body.id, userId: session.user.id },
    });

    if (!trend) {
      return NextResponse.json(
        { success: false, error: "Trend not found" },
        { status: 404 },
      );
    }

    const updateData: Record<string, unknown> = {};
    if (body.notifyEmail !== undefined) {
      updateData.notifyEmail = body.notifyEmail;
    }
    if (body.isPublic !== undefined) {
      updateData.isPublic = body.isPublic;
    }

    const updated = await prisma.savedTrend.update({
      where: { id: trend.id },
      data: updateData,
    });

    return NextResponse.json({ success: true, trend: updated });
  } catch (error) {
    console.error("[PATCH /api/trends/saved]", error);
    return NextResponse.json(
      { success: false, error: "Failed to update trend" },
      { status: 500 },
    );
  }
}

// ─── DELETE: Remove a saved trend ────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 },
      );
    }

    const { searchParams } = req.nextUrl;
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Trend id is required" },
        { status: 400 },
      );
    }

    // Verify ownership
    const trend = await prisma.savedTrend.findFirst({
      where: { id: parseInt(id), userId: session.user.id },
    });

    if (!trend) {
      return NextResponse.json(
        { success: false, error: "Trend not found" },
        { status: 404 },
      );
    }

    await prisma.savedTrend.delete({ where: { id: trend.id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/trends/saved]", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete trend" },
      { status: 500 },
    );
  }
}
