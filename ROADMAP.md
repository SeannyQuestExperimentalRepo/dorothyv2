# TrendLine — Development Roadmap

*Last updated: Feb 12, 2026*

## Current State

TrendLine is a sports betting analytics platform with **154K+ games** across NFL, NCAAF, and NCAAMB. The core platform and most Tier 1 features are production-ready:

### Fully Built
- Natural language trend search (NLP regex parser + GPT-4o-mini fallback)
- Trend engine with 20+ queryable fields and perspective flipping
- Auto-discover 45+ angle templates with statistical significance testing
- Deep matchup pages (H2H, season stats, recent games, situational trends)
- Daily ESPN data sync (cron at 6 AM/12 PM ET) for upcoming games + completed scores
- **The Odds API integration** — Daily NCAAMB odds supplement + historical backfill, shared team mapping (125+ entries)
- Statistical rigor: p-values, z-scores, confidence intervals on every result
- **Player props & player trends** — Prop finder page, hit rate analysis, PlayerGameLog in DB
- **Live odds** — The Odds API (20K credits/mo), multi-book comparison page, OddsSnapshot storage
- **Bet tracking** — Full dashboard with ROI, streak tracking, by-sport breakdown, auto-grading
- **Daily picks** — Pick Engine v6 with 9-signal convergence scoring, FanMatch integration, market edge signal, auto-generation via cron
- **Saved trends** — Save/replay trend queries, daily cron evaluation against upcoming games
- **Parlay engine** — Joint probability, EV, Kelly criterion, teaser point analysis
- **Rate limiting** — 4 tiered limiters across all API routes (public, auth, query, auth-flow)
- **AP rankings** — Displayed next to team names for college basketball and football
- **Auth** — NextAuth v5 with Google + credentials, JWT sessions, role-based access (FREE/PREMIUM/ADMIN)
- **Tier limits** — Feature gating by user role (pick confidence, bet tracking, props, odds access)
- **Pricing page** — FREE vs Premium ($19/mo, $149/yr) with feature comparison
- **Sentry error monitoring** — `@sentry/nextjs` with client/server/edge configs, global error boundary, cron monitor with check-ins, custom metrics (`cron.games_synced`, `cron.picks_generated`, `cron.duration_ms`), user context in middleware, performance spans
- **Line movement dashboard** — Dual-axis Recharts chart (spread + total over time) on matchup pages, significant move detection (spread >1pt, total >2pt), significant moves API + card on odds page
- **Mobile PWA** — `manifest.json`, service worker (cache-first static, network-first pages), offline banner, installable from mobile browser, iOS safe-area-inset support
- **Push notifications** — VAPID web push via `web-push`, subscribe/send API routes, service worker push handler, opt-in prompt, PushSubscription model, triggered after daily pick generation
- **Pick Engine backtesting** — v5 vs v6 comparison script, configurable thresholds, sensitivity analysis (HCA, AdjOE, ML edge), FanMatch + moneyline data pipeline from UpcomingGame → NCAAMBGame

### Partially Built
- **Subscriptions** — Tiers defined and enforced in code, but Stripe not connected (no payment flow)

---

## Competitive Landscape

### Direct Competitors

| Tool | Pricing | Key Strength | What They Have That We Don't |
|------|---------|-------------|------------------------------|
| **Action Network** | $20-30/mo | Sharp money %, line movement, bet tracking | Public/sharp splits, line movement charts, bet sync, mobile app |
| **BetQL** | ~$30/mo | AI model (10K sims per game), star ratings | Predictive model with ratings, injury integration |
| **TeamRankings/BetIQ** | $30/mo | Custom trend builder with filter dropdowns | Polished UI trend builder, pre-built trend pages by sport, predictions |
| **KillerSports** | Free/$10/mo | SDQL (Sports Data Query Language) — power users | Custom query language, daily email alerts when trends are active |
| **Covers.com** | Free/Premium | Consensus picks, real-time odds | Public betting %, consensus data, massive community/forum |
| **Outlier** | $20-80/mo | Player props with hit rate colors | One-click bet placement, +EV feed |
| **OddsShark** | Free | Data-driven betting guides, historical odds | Computer picks, extensive free content |
| **StatMuse** | Free | Natural language sports queries | Voice search, multi-platform, beautiful data viz |

### Where TrendLine Wins
- **Statistical rigor** — No competitor surfaces p-values, confidence intervals, and z-scores
- **NLP trend search** — Only StatMuse does NLP for sports, but they don't do betting trends
- **Auto-discovery** — Reverse-lookup engine scanning 45+ templates is unique
- **Multi-sport depth** — Full coverage of NFL + NCAAF + NCAAMB with sport-specific fields
- **Daily picks engine** — Signal convergence across 9 independent angles with FanMatch + market edge signals
- **Parlay analysis** — True joint probability and Kelly sizing — no competitor does this well

### Where TrendLine Still Loses
- **No sharp/public splits** — Requires data partnership or scraping
- **No community** — No forums, leaderboards, or social sharing
- **No email alerts** — Saved trend evaluation runs but email notifications aren't sent (push notifications are live)
- **No payment processing** — Can't collect revenue without Stripe

---

## Recently Completed

### Sentry Error Monitoring — Full Stack (Feb 2026)
- `@sentry/nextjs` with client, server, and edge runtime configs
- Global error boundary (`global-error.tsx`) with Sentry reporting
- `trackError()` and `trackWarning()` wired to Sentry with structured tags (sport, route, userId)
- `trackMetric()` for custom gauge metrics
- Sentry Cron Monitor on daily-sync with check-ins (in_progress → ok/error)
- Custom metrics: `cron.games_synced`, `cron.picks_generated`, `cron.duration_ms`
- User context (`Sentry.setUser`) set in middleware from session
- Performance spans on key API routes
- Source maps uploaded during build, hidden from client

### Line Movement Dashboard (Feb 2026)
- `GET /api/odds/snapshots` endpoint for snapshot history by game
- `GET /api/odds/significant-moves` endpoint detecting moves above threshold
- `detectSignificantMoves()` engine: spread >1pt significant, >2pt major; total >2pt significant, >3.5pt major
- Dual-axis Recharts chart (spread + total) on matchup pages with opening line markers
- Significant Moves card on odds page with move severity badges
- React Query hooks for both endpoints

### Mobile PWA (Feb 2026)
- `manifest.json` with TrendLine branding (teal #14b8a6 on obsidian #0a0a0f)
- Service worker: cache-first for static assets, network-first for pages, skips API routes
- Offline banner component with `navigator.onLine` detection
- Service worker update detection with refresh prompt
- iOS safe-area-inset CSS support for standalone mode
- Push notifications: VAPID web push, subscribe/send API routes, SW push handler, opt-in prompt
- `PushSubscription` Prisma model with user relation
- Cron triggers push after daily pick generation, stale subscription cleanup

### Pick Engine v6 Backtesting (Feb 2026)
- `backtest-v6-compare.ts`: v5 vs v6 comparison with side-by-side output
- Configurable thresholds: HCA (conf/non-conf/Nov/Mar), AdjOE (over/under), ML edge
- Sensitivity analysis mode (`--sensitivity`): 11 configs across HCA, AdjOE, and ML edge dimensions
- `computeKenpomWP()`: logistic model from AdjEM → win probability
- `signalMoneylineEdge()`: market-implied WP vs KenPom WP divergence
- FanMatch + moneyline data pipeline: cron captures → UpcomingGame → NCAAMBGame via extended oddsMap
- `moneylineHome`/`moneylineAway` fields added to NCAAMBGame schema

### The Odds API Integration (Feb 2026)
- Integrated The Odds API into the daily cron pipeline (steps 1.5 and 2.5)
- `supplementUpcomingGamesFromOddsApi()` fills NCAAMB odds gaps ESPN misses
- `backfillYesterdayOdds()` patches completed games still lacking spreads (morning cron only)
- Shared team name mapping module (`odds-api-team-mapping.ts`) with 125+ entries and multi-word mascot handling
- Historical backfill script updated to use shared mapping + commence_time filtering
- Backfilled 26 games across 50 API calls; remaining ~2,983 are small-school games without betting markets

### Pick Engine v6 (Feb 2026)
- **FanMatch predicted margin** — Replaces static AdjEM + HCA formula with KenPom's game-level predictions
- **Context-aware HCA fallback** — Conference=2.5, non-conference=1.5, November=1.0, March=0.5 (was flat 2.0)
- **FanMatch O/U modifier** — Predicted total confirms/dampens the sum_AdjDE signal
- **Moneyline market edge signal** — 9th signal comparing KenPom WP vs market-implied probability
- **AdjOE modifier for O/U** — Offensive efficiency now amplifies OVER/UNDER alongside defensive efficiency
- Weight rebalance: marketEdge=0.10, recentForm=0.10 (was 0.15), h2h=0.05 (was 0.10)

---

## What's Next — Prioritized

### Priority 1: Revenue Unlock (Stripe)

The single most important remaining item. Everything else is built — this is the only blocker to revenue.

**Work needed:**
- Create Stripe products/prices in Stripe Dashboard (Premium Monthly $19, Annual $149)
- Build `/api/stripe/checkout` route (create Checkout Session)
- Build `/api/stripe/webhook` route (handle subscription lifecycle events)
- Build `/api/stripe/portal` route (customer self-service portal)
- Wire "Subscribe Now" button on pricing page to Checkout
- Update user role on subscription create/cancel/update via webhook
- Add `stripeCustomerId` to User model
**Impact:** Revenue generation. Literally the only thing between $0 and recurring revenue.

### Priority 2: Email Notifications for Saved Trends

The cron already evaluates saved trends daily. Just need to send emails when they trigger.

**Work needed:**
- Integrate an email service (Resend, SendGrid, or AWS SES)
- Send email when `evaluateSavedTrends()` finds a match
- Add notification preferences to SavedTrend (email on/off)
- Email template: "Your trend 'Chiefs ATS home favorites' is active today — Chiefs -7 vs Bills"
**Impact:** Massive retention. The app reaches out to users instead of waiting for them.

### Priority 3: Run Backtest & Tune Thresholds

Backtesting infrastructure is built. Need to actually execute against historical data and apply findings.

**Work needed:**
- Run `npx tsx scripts/backtest-v6-compare.ts --sensitivity` against 2025-26 completed games
- Analyze v5 vs v6 comparison results across confidence tiers
- Apply optimal thresholds to `pick-engine.ts` if backtesting suggests changes
- Document results
**Impact:** Validates or improves v6 signal accuracy before season ends.

---

## Must Do Before V1 Launch

| Item | Why | How |
|------|-----|-----|
| **Prisma migration baseline** | DB has been managed with `prisma db push` (no migration history). Any future team member or CI/CD pipeline running `prisma migrate deploy` will fail with drift errors. | Run `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql`, then `prisma migrate resolve --applied 0_init` to mark it as already applied. From that point forward, use `prisma migrate dev` for all schema changes. |
| **Stripe integration** | Can't collect revenue without payment processing (Priority 1 above). | See Priority 1 work items. |
| **E2E test suite** | No automated tests for critical user flows (search, picks, bet tracking, auth). | Add Playwright tests for the top 5 user journeys. |

---

## Future Tiers (Unchanged)

### Tier 2: Competitive Advantages

#### Sharp vs. Public Betting Splits
- Source: Requires partnership or API access to betting percentage data
- Display: % of bets vs. % of money for each side
- Highlight reverse line movement (sharp action indicator)

#### Predictive Model & Game Ratings
- Pick Engine v6 has 9-signal convergence scoring with KenPom + FanMatch + market edge
- Next step: build a trained ML model (logistic regression or gradient boosting) on historical signal outputs
- Calibrate confidence tiers against actual outcomes (are 5★ picks truly better than 4★?)
- Track model performance publicly with a real-time record page

### Tier 3: Growth & Polish

#### NBA, MLB, NHL Support
- Priority order: NBA → MLB → NHL
- Each sport roughly doubles the addressable market

#### Community & Social Features
- Public trend leaderboard
- Share trend to Twitter/X with auto-generated card image
- "Popular trends" section

#### Advanced NLP & Conversational Search
- Multi-turn conversations
- Suggested follow-up queries
- Comparison queries ("Chiefs vs. Bills — who covers more at home?")

### Tier 4: Moonshots

- Real-time game dashboard with live scores
- Backtesting engine (simulate betting systems, show equity curves)
- DFS integration (ownership projections, lineup analysis)
- API for third parties
- White-label / B2B licensing

---

## Technical Debt

| Issue | Priority | Status |
|-------|----------|--------|
| Rate limiting on API routes | High | **DONE** — 4 tiered limiters |
| Error monitoring | High | **DONE** — Sentry full stack with cron monitor, metrics, user context |
| `force-dynamic` on matchup route | Low | **DONE** — Cache-Control added |
| Sequential DB queries | Low | **DONE** — Promise.all |
| All-sport cache loading | Low | **DONE** — Sport-specific |
| `cheerio` and `xlsx` in production deps | Low | Move to devDependencies |
| `openai` dependency for NLP | Medium | Consider local model to reduce cost |
| No E2E tests | Medium | Add Playwright tests for critical flows |
| Pick generation timeout on large slates | Low | **DONE** — Pre-generated via cron |
| Pick Engine v6 not backtested | High | **DONE** — Backtest infrastructure built with sensitivity analysis; needs execution |
| FanMatch data only available for current day | Medium | **DONE** — Cron now captures FanMatch + moneyline daily; pipeline persists to NCAAMBGame |
| Prisma migration history | High | No migration history — using `db push`. Must baseline before V1 launch. |

---

## Revenue Model

Pricing page is built with these tiers:

| Tier | Price | Access |
|------|-------|--------|
| **Free** | $0 | 10 trends/day, 4★ picks only, no bet tracking/props/odds |
| **Premium** | $19/mo or $149/yr | Unlimited trends, all picks (4-5★), bet tracking, props, live odds, saved trends |
| **Admin** | Internal | Everything |

**Blocker:** Stripe integration (Priority 1 above).

---

## Ralph Loop — Overnight Automation Sections

*Added Feb 12, 2026. These sections map to the ralph loop overnight development protocol at `scripts/ralph-loop/RALPH-PROMPT.md`.*

### Section 0: Debug Sweep (Pre-Roadmap)
**Status**: Pending
**Goal**: Stabilize codebase — find and fix all TypeScript errors, build warnings, lint issues, unsafe patterns (missing try/catch, null access, dead exports).
**Success**: ≥80% reduction in total issues from baseline. Zero TSC errors. Clean build.

### Section 1: Stripe Revenue Integration
**Status**: Pending (blocked on Stripe API keys)
**Goal**: Connect Stripe to existing pricing page. Checkout → webhook → role update → portal.
**Files**: `prisma/schema.prisma`, `src/app/api/stripe/checkout/route.ts`, `src/app/api/stripe/webhook/route.ts`, `src/app/api/stripe/portal/route.ts`, `src/app/pricing/page.tsx`
**Blocker**: Need Stripe test-mode API keys from Sean.

### Section 2: Email Notifications for Saved Trends
**Status**: Pending (blocked on email service choice)
**Goal**: Email users when their saved trends trigger on today's games.
**Files**: `src/lib/email.ts`, `src/lib/trend-evaluator.ts`, `src/app/trends/saved/page.tsx`
**Blocker**: Need email service choice (Resend vs SendGrid vs SES) + API key.

### Section 3: E2E Test Suite (Playwright)
**Status**: Pending
**Goal**: Automated tests for 5 critical user journeys.
**Files**: `playwright.config.ts`, `tests/e2e/*.spec.ts`

### Section 4: Prisma Migration Baseline
**Status**: Pending
**Goal**: Generate initial migration SQL so `prisma migrate deploy` works in CI/CD.
**Files**: `prisma/migrations/0_init/migration.sql`
**Note**: SQL generation only — Sean runs `prisma migrate resolve` manually.

### Section 5: Predictive Model v2 (ML Pipeline)
**Status**: Pending (blocked on Python vs TS decision)
**Goal**: Train ML model on historical signal outputs, calibrate confidence tiers.
**Blocker**: Need decision on Python (scikit-learn) vs TypeScript (ml.js).

### Section 6: Community & Social Features
**Status**: Pending
**Goal**: Public trend leaderboard, social sharing, OG image generation.

### Section 7: NBA Support
**Status**: Pending
**Goal**: Add NBA as 4th sport. Schema + scraper + trend engine + pick engine + UI.
