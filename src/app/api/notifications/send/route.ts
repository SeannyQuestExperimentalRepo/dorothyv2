/**
 * POST /api/notifications/send
 *
 * Sends push notifications to all subscribers.
 * Protected by CRON_SECRET (called from daily-sync after pick generation).
 *
 * Body: { title, body, url? }
 */

import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { prisma } from "@/lib/db";
import { publicLimiter, applyRateLimit } from "@/lib/rate-limit";
import { verifyCronSecret } from "@/lib/auth-helpers";

// Configure VAPID keys (generate with: npx web-push generate-vapid-keys)
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL = process.env.VAPID_EMAIL || "mailto:admin@trendline.app";

export async function POST(req: NextRequest) {
  // Rate limit (defense in depth alongside CRON_SECRET)
  const limited = applyRateLimit(req, publicLimiter);
  if (limited) return limited;

  // Auth: CRON_SECRET required (timing-safe)
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return NextResponse.json(
      { success: false, error: "VAPID keys not configured" },
      { status: 500 },
    );
  }

  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

  try {
    const { title, body, url } = await req.json();

    if (!title || !body) {
      return NextResponse.json(
        { success: false, error: "title and body are required" },
        { status: 400 },
      );
    }

    const subscriptions = await prisma.pushSubscription.findMany();

    let sent = 0;
    let failed = 0;
    const staleIds: number[] = [];

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify({ title, body, url: url || "/" }),
        );
        sent++;
      } catch (err) {
        failed++;
        // Remove stale subscriptions (410 Gone or 404)
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 410 || statusCode === 404) {
          staleIds.push(sub.id);
        }
      }
    }

    // Clean up stale subscriptions
    if (staleIds.length > 0) {
      await prisma.pushSubscription.deleteMany({
        where: { id: { in: staleIds } },
      });
    }

    return NextResponse.json({
      success: true,
      sent,
      failed,
      cleaned: staleIds.length,
      total: subscriptions.length,
    });
  } catch (err) {
    console.error("[POST /api/notifications/send]", err);
    return NextResponse.json(
      { success: false, error: "Failed to send notifications" },
      { status: 500 },
    );
  }
}
