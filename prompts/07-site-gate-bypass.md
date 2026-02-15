# Prompt 07: Fix Site Gate Cookie Bypass

**Priority:** 🟡 P1 — Anyone can bypass site password with dev tools  
**Audit:** Security (HIGH)  
**Impact:** Setting `document.cookie = "site_access=granted"` bypasses the entire site password gate.

---

> **COPY EVERYTHING BELOW THIS LINE INTO CLAUDE**

---

Fix the site password gate — the cookie value is a static string "granted" that anyone can set manually to bypass the gate.

**Files:**
- `src/app/api/gate/route.ts` (sets the cookie)
- `src/middleware.ts` (checks the cookie)

**Current (broken):**
- Gate route sets: `site_access=granted`
- Middleware checks: `req.cookies.get("site_access")?.value === "granted"`

**Fix:** Sign the cookie with HMAC so it can't be forged.

In `src/app/api/gate/route.ts`:

    import crypto from "crypto";
    
    // After password validation succeeds:
    const timestamp = Date.now().toString();
    const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
    const signature = crypto
      .createHmac("sha256", secret!)
      .update(timestamp)
      .digest("hex");
    const cookieValue = `${timestamp}:${signature}`;
    
    // Set cookie
    cookies().set("site_access", cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

In `src/middleware.ts`:

    import crypto from "crypto";
    
    function verifySiteAccess(cookieValue: string): boolean {
      const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
      if (!secret) return false;
      
      const parts = cookieValue.split(":");
      if (parts.length !== 2) return false;
      
      const [timestamp, signature] = parts;
      
      // Optional: expire after 30 days
      const age = Date.now() - parseInt(timestamp);
      if (isNaN(age) || age > 30 * 24 * 60 * 60 * 1000) return false;
      
      const expected = crypto
        .createHmac("sha256", secret)
        .update(timestamp)
        .digest("hex");
      
      try {
        return crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(expected)
        );
      } catch {
        return false;
      }
    }
    
    // In the middleware function, replace:
    // req.cookies.get("site_access")?.value === "granted"
    // With:
    // verifySiteAccess(req.cookies.get("site_access")?.value || "")

This follows the same HMAC pattern already used for admin tokens in `src/lib/admin-auth.ts`.
