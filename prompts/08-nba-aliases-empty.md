# Prompt 08: Populate NBA Team Aliases

**Priority:** 🟡 P1 — NBA team resolution completely broken  
**Audit:** Data Quality (HIGH)  
**Impact:** NBA alias table is empty `{}`. All NBA team name resolution fails, causing broken odds joins and phantom duplicates.

---

## Copy-paste this into Claude:

```
The NBA section of TEAM_ALIASES in src/lib/team-aliases.generated.ts is empty. Populate it with all 30 NBA teams.

**File:** `src/lib/team-aliases.generated.ts` — find the NBA key (around line 1497)

Current:
```typescript
NBA: {},
```

Replace with all 30 NBA teams. Map ESPN names, Odds API names, and common variations to canonical DB names. Follow the same pattern used for NCAAMB/NFL/NCAAF in the same file.

Here are all 30 NBA teams with common name variations:

```typescript
NBA: {
  // Atlantic
  "Boston Celtics": ["BOS", "Boston"],
  "Brooklyn Nets": ["BKN", "Brooklyn", "NJ Nets", "New Jersey Nets"],
  "New York Knicks": ["NYK", "NY Knicks", "New York"],
  "Philadelphia 76ers": ["PHI", "Philadelphia", "Philly", "Sixers"],
  "Toronto Raptors": ["TOR", "Toronto"],
  // Central
  "Chicago Bulls": ["CHI", "Chicago"],
  "Cleveland Cavaliers": ["CLE", "Cleveland", "Cavs"],
  "Detroit Pistons": ["DET", "Detroit"],
  "Indiana Pacers": ["IND", "Indiana"],
  "Milwaukee Bucks": ["MIL", "Milwaukee"],
  // Southeast
  "Atlanta Hawks": ["ATL", "Atlanta"],
  "Charlotte Hornets": ["CHA", "Charlotte", "Charlotte Bobcats"],
  "Miami Heat": ["MIA", "Miami"],
  "Orlando Magic": ["ORL", "Orlando"],
  "Washington Wizards": ["WAS", "Washington", "WSH"],
  // Northwest
  "Denver Nuggets": ["DEN", "Denver"],
  "Minnesota Timberwolves": ["MIN", "Minnesota", "Timberwolves", "T-Wolves"],
  "Oklahoma City Thunder": ["OKC", "Oklahoma City", "OKC Thunder"],
  "Portland Trail Blazers": ["POR", "Portland", "Blazers", "Trail Blazers"],
  "Utah Jazz": ["UTA", "Utah"],
  // Pacific
  "Golden State Warriors": ["GSW", "Golden State", "GS Warriors"],
  "LA Clippers": ["LAC", "Los Angeles Clippers", "Clippers"],
  "Los Angeles Lakers": ["LAL", "LA Lakers", "Lakers"],
  "Phoenix Suns": ["PHX", "Phoenix"],
  "Sacramento Kings": ["SAC", "Sacramento"],
  // Southwest
  "Dallas Mavericks": ["DAL", "Dallas", "Mavs"],
  "Houston Rockets": ["HOU", "Houston"],
  "Memphis Grizzlies": ["MEM", "Memphis"],
  "New Orleans Pelicans": ["NOP", "New Orleans", "NO Pelicans"],
  "San Antonio Spurs": ["SAS", "San Antonio", "SA Spurs"],
},
```

Check what format ESPN and the Odds API actually use for NBA team names by looking at:
1. `src/lib/espn-team-mapping.ts` — does it have NBA entries?
2. `src/lib/odds-api-team-mapping.ts` — does it have NBA entries?
3. The Odds API uses format like "Los Angeles Lakers" — verify against their docs

Make sure the canonical name (the key) matches what's stored in the Team table in the database. If no NBA teams exist in the DB yet, the canonical should match ESPN format since that's the primary data source.
```
