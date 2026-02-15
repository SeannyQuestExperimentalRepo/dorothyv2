# Prompt 12: Add Stripe Webhook Idempotency

**Priority:** 🟡 P2 — Replayed webhooks can double-process payments  
**Audit:** Architecture (HIGH)  
**Impact:** Stripe retries webhooks on failure. Without idempotency, a user's role could flip between FREE and PREMIUM on retries.

---

> **COPY EVERYTHING BELOW THIS LINE INTO CLAUDE**

---

Add idempotency protection to the Stripe webhook handler. Currently, replayed webhook events get fully reprocessed.

**File:** `src/app/api/stripe/webhook/route.ts`

**Fix:** Check if the event was already processed before handling it.

Option A — Use a ProcessedEvent table:

1. Add to prisma/schema.prisma:

        model StripeEvent {
          id          String   @id // Stripe event ID (evt_...)
          type        String
          processedAt DateTime @default(now())
          
          @@index([processedAt])
        }

2. In the webhook handler, after constructing the event:

        const event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
        
        // Idempotency check
        const existing = await prisma.stripeEvent.findUnique({
          where: { id: event.id }
        });
        if (existing) {
          return NextResponse.json({ received: true, duplicate: true });
        }
        
        // Process the event...
        
        // After successful processing, record it
        await prisma.stripeEvent.create({
          data: { id: event.id, type: event.type }
        });

3. Add a cleanup to the daily cron — delete StripeEvent records older than 30 days:

        await prisma.stripeEvent.deleteMany({
          where: { processedAt: { lt: thirtyDaysAgo } }
        });

Option B — Simpler, check subscription status before updating:

In the `checkout.session.completed` handler, before updating the user role:

    const user = await prisma.user.findUnique({ where: { stripeCustomerId } });
    if (user?.role === "PREMIUM") {
      // Already processed, skip
      return NextResponse.json({ received: true });
    }

Option A is more robust (handles all event types). Go with Option A.

Run migration after updating schema:

    npx prisma migrate dev --name add-stripe-event-idempotency
