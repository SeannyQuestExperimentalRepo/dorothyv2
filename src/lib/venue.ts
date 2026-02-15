import "server-only";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VenueData {
  name: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  altitude: number; // feet
  isDome: boolean;
  surface?: string;
  timezone: string; // IANA timezone
}

export interface TravelInfo {
  distanceMiles: number;
  timezoneChange: number; // hours difference (absolute)
  isBackToBack: boolean;
  fatigueScore: number; // 0-10
}

// ─── Static Venue Data ──────────────────────────────────────────────────────

const NFL_VENUES: Record<string, VenueData> = {
  "Arizona Cardinals":       { name: "State Farm Stadium",           city: "Glendale",       state: "AZ", lat: 33.5276, lon: -112.2626, altitude: 1100, isDome: true,  surface: "Grass",       timezone: "America/Phoenix" },
  "Atlanta Falcons":         { name: "Mercedes-Benz Stadium",       city: "Atlanta",         state: "GA", lat: 33.7553, lon: -84.4006,  altitude: 1050, isDome: true,  surface: "FieldTurf",   timezone: "America/New_York" },
  "Baltimore Ravens":        { name: "M&T Bank Stadium",            city: "Baltimore",       state: "MD", lat: 39.2780, lon: -76.6227,  altitude: 33,   isDome: false, surface: "Grass",       timezone: "America/New_York" },
  "Buffalo Bills":           { name: "Highmark Stadium",            city: "Orchard Park",    state: "NY", lat: 42.7738, lon: -78.7870,  altitude: 597,  isDome: false, surface: "A-Turf Titan", timezone: "America/New_York" },
  "Carolina Panthers":       { name: "Bank of America Stadium",     city: "Charlotte",       state: "NC", lat: 35.2258, lon: -80.8528,  altitude: 751,  isDome: false, surface: "Grass",       timezone: "America/New_York" },
  "Chicago Bears":           { name: "Soldier Field",               city: "Chicago",         state: "IL", lat: 41.8623, lon: -87.6167,  altitude: 597,  isDome: false, surface: "Grass",       timezone: "America/Chicago" },
  "Cincinnati Bengals":      { name: "Paycor Stadium",              city: "Cincinnati",      state: "OH", lat: 39.0955, lon: -84.5161,  altitude: 490,  isDome: false, surface: "Grass",       timezone: "America/New_York" },
  "Cleveland Browns":        { name: "Cleveland Browns Stadium",    city: "Cleveland",       state: "OH", lat: 41.5061, lon: -81.6995,  altitude: 653,  isDome: false, surface: "Grass",       timezone: "America/New_York" },
  "Dallas Cowboys":          { name: "AT&T Stadium",                city: "Arlington",       state: "TX", lat: 32.7473, lon: -97.0945,  altitude: 616,  isDome: true,  surface: "Matrix Turf", timezone: "America/Chicago" },
  "Denver Broncos":          { name: "Empower Field at Mile High",  city: "Denver",          state: "CO", lat: 39.7439, lon: -105.0201, altitude: 5280, isDome: false, surface: "Grass",       timezone: "America/Denver" },
  "Detroit Lions":           { name: "Ford Field",                  city: "Detroit",         state: "MI", lat: 42.3400, lon: -83.0456,  altitude: 600,  isDome: true,  surface: "FieldTurf",   timezone: "America/Detroit" },
  "Green Bay Packers":       { name: "Lambeau Field",               city: "Green Bay",       state: "WI", lat: 44.5013, lon: -88.0622,  altitude: 640,  isDome: false, surface: "Grass",       timezone: "America/Chicago" },
  "Houston Texans":          { name: "NRG Stadium",                 city: "Houston",         state: "TX", lat: 29.6847, lon: -95.4107,  altitude: 43,   isDome: true,  surface: "Grass",       timezone: "America/Chicago" },
  "Indianapolis Colts":      { name: "Lucas Oil Stadium",           city: "Indianapolis",    state: "IN", lat: 39.7601, lon: -86.1639,  altitude: 715,  isDome: true,  surface: "FieldTurf",   timezone: "America/Indiana/Indianapolis" },
  "Jacksonville Jaguars":    { name: "EverBank Stadium",            city: "Jacksonville",    state: "FL", lat: 30.3239, lon: -81.6373,  altitude: 16,   isDome: false, surface: "Grass",       timezone: "America/New_York" },
  "Kansas City Chiefs":      { name: "GEHA Field at Arrowhead Stadium", city: "Kansas City", state: "MO", lat: 39.0489, lon: -94.4839,  altitude: 800,  isDome: false, surface: "Grass",       timezone: "America/Chicago" },
  "Las Vegas Raiders":       { name: "Allegiant Stadium",           city: "Las Vegas",       state: "NV", lat: 36.0909, lon: -115.1833, altitude: 2030, isDome: true,  surface: "Grass",       timezone: "America/Los_Angeles" },
  "Los Angeles Chargers":    { name: "SoFi Stadium",                city: "Inglewood",       state: "CA", lat: 33.9535, lon: -118.3392, altitude: 131,  isDome: true,  surface: "Matrix Turf", timezone: "America/Los_Angeles" },
  "Los Angeles Rams":        { name: "SoFi Stadium",                city: "Inglewood",       state: "CA", lat: 33.9535, lon: -118.3392, altitude: 131,  isDome: true,  surface: "Matrix Turf", timezone: "America/Los_Angeles" },
  "Miami Dolphins":          { name: "Hard Rock Stadium",           city: "Miami Gardens",   state: "FL", lat: 25.9580, lon: -80.2389,  altitude: 7,    isDome: false, surface: "Grass",       timezone: "America/New_York" },
  "Minnesota Vikings":       { name: "U.S. Bank Stadium",           city: "Minneapolis",     state: "MN", lat: 44.9736, lon: -93.2575,  altitude: 830,  isDome: true,  surface: "UBU Speed S5-M", timezone: "America/Chicago" },
  "New England Patriots":    { name: "Gillette Stadium",            city: "Foxborough",      state: "MA", lat: 42.0909, lon: -71.2643,  altitude: 298,  isDome: false, surface: "FieldTurf",   timezone: "America/New_York" },
  "New Orleans Saints":      { name: "Caesars Superdome",           city: "New Orleans",     state: "LA", lat: 29.9511, lon: -90.0812,  altitude: 3,    isDome: true,  surface: "UBU Speed S5-M", timezone: "America/Chicago" },
  "New York Giants":         { name: "MetLife Stadium",             city: "East Rutherford", state: "NJ", lat: 40.8128, lon: -74.0742,  altitude: 3,    isDome: false, surface: "UBU Speed S5-M", timezone: "America/New_York" },
  "New York Jets":           { name: "MetLife Stadium",             city: "East Rutherford", state: "NJ", lat: 40.8128, lon: -74.0742,  altitude: 3,    isDome: false, surface: "UBU Speed S5-M", timezone: "America/New_York" },
  "Philadelphia Eagles":     { name: "Lincoln Financial Field",     city: "Philadelphia",    state: "PA", lat: 39.9012, lon: -75.1676,  altitude: 39,   isDome: false, surface: "Grass",       timezone: "America/New_York" },
  "Pittsburgh Steelers":     { name: "Acrisure Stadium",            city: "Pittsburgh",      state: "PA", lat: 40.4468, lon: -80.0158,  altitude: 745,  isDome: false, surface: "Grass",       timezone: "America/New_York" },
  "San Francisco 49ers":     { name: "Levi's Stadium",              city: "Santa Clara",     state: "CA", lat: 37.4033, lon: -121.9694, altitude: 43,   isDome: false, surface: "Grass",       timezone: "America/Los_Angeles" },
  "Seattle Seahawks":        { name: "Lumen Field",                 city: "Seattle",         state: "WA", lat: 47.5952, lon: -122.3316, altitude: 20,   isDome: false, surface: "FieldTurf",   timezone: "America/Los_Angeles" },
  "Tampa Bay Buccaneers":    { name: "Raymond James Stadium",       city: "Tampa",           state: "FL", lat: 27.9759, lon: -82.5033,  altitude: 36,   isDome: false, surface: "Grass",       timezone: "America/New_York" },
  "Tennessee Titans":        { name: "Nissan Stadium",              city: "Nashville",       state: "TN", lat: 36.1665, lon: -86.7713,  altitude: 550,  isDome: false, surface: "Grass",       timezone: "America/Chicago" },
  "Washington Commanders":   { name: "Northwest Stadium",           city: "Landover",        state: "MD", lat: 38.9076, lon: -76.8645,  altitude: 180,  isDome: false, surface: "Grass",       timezone: "America/New_York" },
};

const NBA_VENUES: Record<string, VenueData> = {
  "Atlanta Hawks":           { name: "State Farm Arena",            city: "Atlanta",         state: "GA", lat: 33.7573, lon: -84.3963,  altitude: 1050, isDome: true, timezone: "America/New_York" },
  "Boston Celtics":          { name: "TD Garden",                   city: "Boston",          state: "MA", lat: 42.3662, lon: -71.0621,  altitude: 20,   isDome: true, timezone: "America/New_York" },
  "Brooklyn Nets":           { name: "Barclays Center",             city: "Brooklyn",        state: "NY", lat: 40.6826, lon: -73.9754,  altitude: 30,   isDome: true, timezone: "America/New_York" },
  "Charlotte Hornets":       { name: "Spectrum Center",             city: "Charlotte",       state: "NC", lat: 35.2251, lon: -80.8392,  altitude: 751,  isDome: true, timezone: "America/New_York" },
  "Chicago Bulls":           { name: "United Center",               city: "Chicago",         state: "IL", lat: 41.8807, lon: -87.6742,  altitude: 597,  isDome: true, timezone: "America/Chicago" },
  "Cleveland Cavaliers":     { name: "Rocket Mortgage FieldHouse",  city: "Cleveland",       state: "OH", lat: 41.4965, lon: -81.6882,  altitude: 653,  isDome: true, timezone: "America/New_York" },
  "Dallas Mavericks":        { name: "American Airlines Center",    city: "Dallas",          state: "TX", lat: 32.7905, lon: -96.8103,  altitude: 430,  isDome: true, timezone: "America/Chicago" },
  "Denver Nuggets":          { name: "Ball Arena",                  city: "Denver",          state: "CO", lat: 39.7487, lon: -105.0077, altitude: 5280, isDome: true, timezone: "America/Denver" },
  "Detroit Pistons":         { name: "Little Caesars Arena",         city: "Detroit",         state: "MI", lat: 42.3410, lon: -83.0553,  altitude: 600,  isDome: true, timezone: "America/Detroit" },
  "Golden State Warriors":   { name: "Chase Center",                city: "San Francisco",   state: "CA", lat: 37.7680, lon: -122.3877, altitude: 5,    isDome: true, timezone: "America/Los_Angeles" },
  "Houston Rockets":         { name: "Toyota Center",               city: "Houston",         state: "TX", lat: 29.7508, lon: -95.3621,  altitude: 43,   isDome: true, timezone: "America/Chicago" },
  "Indiana Pacers":          { name: "Gainbridge Fieldhouse",       city: "Indianapolis",    state: "IN", lat: 39.7640, lon: -86.1555,  altitude: 715,  isDome: true, timezone: "America/Indiana/Indianapolis" },
  "Los Angeles Clippers":    { name: "Intuit Dome",                 city: "Inglewood",       state: "CA", lat: 33.9617, lon: -118.3414, altitude: 131,  isDome: true, timezone: "America/Los_Angeles" },
  "Los Angeles Lakers":      { name: "Crypto.com Arena",            city: "Los Angeles",     state: "CA", lat: 34.0430, lon: -118.2673, altitude: 305,  isDome: true, timezone: "America/Los_Angeles" },
  "Memphis Grizzlies":       { name: "FedExForum",                  city: "Memphis",         state: "TN", lat: 35.1382, lon: -90.0506,  altitude: 337,  isDome: true, timezone: "America/Chicago" },
  "Miami Heat":              { name: "Kaseya Center",               city: "Miami",           state: "FL", lat: 25.7814, lon: -80.1870,  altitude: 7,    isDome: true, timezone: "America/New_York" },
  "Milwaukee Bucks":         { name: "Fiserv Forum",                city: "Milwaukee",       state: "WI", lat: 43.0451, lon: -87.9174,  altitude: 617,  isDome: true, timezone: "America/Chicago" },
  "Minnesota Timberwolves":  { name: "Target Center",               city: "Minneapolis",     state: "MN", lat: 44.9795, lon: -93.2761,  altitude: 830,  isDome: true, timezone: "America/Chicago" },
  "New Orleans Pelicans":    { name: "Smoothie King Center",        city: "New Orleans",     state: "LA", lat: 29.9490, lon: -90.0821,  altitude: 3,    isDome: true, timezone: "America/Chicago" },
  "New York Knicks":         { name: "Madison Square Garden",       city: "New York",        state: "NY", lat: 40.7505, lon: -73.9934,  altitude: 33,   isDome: true, timezone: "America/New_York" },
  "Oklahoma City Thunder":   { name: "Paycom Center",               city: "Oklahoma City",   state: "OK", lat: 35.4634, lon: -97.5151,  altitude: 1201, isDome: true, timezone: "America/Chicago" },
  "Orlando Magic":           { name: "Kia Center",                  city: "Orlando",         state: "FL", lat: 28.5392, lon: -81.3839,  altitude: 82,   isDome: true, timezone: "America/New_York" },
  "Philadelphia 76ers":      { name: "Wells Fargo Center",          city: "Philadelphia",    state: "PA", lat: 39.9012, lon: -75.1720,  altitude: 39,   isDome: true, timezone: "America/New_York" },
  "Phoenix Suns":            { name: "Footprint Center",            city: "Phoenix",         state: "AZ", lat: 33.4457, lon: -112.0712, altitude: 1086, isDome: true, timezone: "America/Phoenix" },
  "Portland Trail Blazers":  { name: "Moda Center",                 city: "Portland",        state: "OR", lat: 45.5316, lon: -122.6668, altitude: 50,   isDome: true, timezone: "America/Los_Angeles" },
  "Sacramento Kings":        { name: "Golden 1 Center",             city: "Sacramento",      state: "CA", lat: 38.5802, lon: -121.4997, altitude: 30,   isDome: true, timezone: "America/Los_Angeles" },
  "San Antonio Spurs":       { name: "Frost Bank Center",           city: "San Antonio",     state: "TX", lat: 29.4270, lon: -98.4375,  altitude: 650,  isDome: true, timezone: "America/Chicago" },
  "Toronto Raptors":         { name: "Scotiabank Arena",            city: "Toronto",         state: "ON", lat: 43.6435, lon: -79.3791,  altitude: 250,  isDome: true, timezone: "America/Toronto" },
  "Utah Jazz":               { name: "Delta Center",                city: "Salt Lake City",  state: "UT", lat: 40.7683, lon: -111.9011, altitude: 4226, isDome: true, timezone: "America/Denver" },
  "Washington Wizards":      { name: "Capital One Arena",           city: "Washington",      state: "DC", lat: 38.8981, lon: -77.0209,  altitude: 25,   isDome: true, timezone: "America/New_York" },
};

// ─── Venue Lookup ───────────────────────────────────────────────────────────

export function getVenue(sport: string, teamName: string): VenueData | null {
  if (sport === "NFL" || sport === "NCAAF") {
    return NFL_VENUES[teamName] ?? null;
  }
  if (sport === "NBA" || sport === "NCAAMB") {
    return NBA_VENUES[teamName] ?? null;
  }
  return null;
}

export function getAllVenues(sport: string): Record<string, VenueData> {
  if (sport === "NFL") return NFL_VENUES;
  if (sport === "NBA") return NBA_VENUES;
  return {};
}

// ─── Haversine Distance ─────────────────────────────────────────────────────

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Timezone Offset Map ────────────────────────────────────────────────────

const TZ_OFFSETS: Record<string, number> = {
  "America/New_York": -5,
  "America/Detroit": -5,
  "America/Indiana/Indianapolis": -5,
  "America/Chicago": -6,
  "America/Denver": -7,
  "America/Phoenix": -7, // No DST but same as Mountain
  "America/Los_Angeles": -8,
  "America/Toronto": -5,
};

function getTimezoneOffset(tz: string): number {
  return TZ_OFFSETS[tz] ?? -5;
}

// ─── Travel Info ────────────────────────────────────────────────────────────

export function getTravelInfo(
  sport: string,
  homeTeam: string,
  awayTeam: string,
  prevGame?: { date: Date; location?: string }
): TravelInfo {
  const homeVenue = getVenue(sport, homeTeam);
  const awayVenue = getVenue(sport, awayTeam);

  if (!homeVenue || !awayVenue) {
    return { distanceMiles: 0, timezoneChange: 0, isBackToBack: false, fatigueScore: 0 };
  }

  const distanceMiles = Math.round(
    haversineDistance(awayVenue.lat, awayVenue.lon, homeVenue.lat, homeVenue.lon)
  );

  const timezoneChange = Math.abs(
    getTimezoneOffset(homeVenue.timezone) - getTimezoneOffset(awayVenue.timezone)
  );

  const isBackToBack = prevGame
    ? (Date.now() - prevGame.date.getTime()) < 2 * 24 * 60 * 60 * 1000
    : false;

  // Fatigue score: 0-10 composite
  // Distance: 0-4 points (2000+ miles = 4)
  const distScore = Math.min(4, (distanceMiles / 2000) * 4);
  // Timezone: 0-3 points (3h change = 3)
  const tzScore = Math.min(3, timezoneChange);
  // B2B: 0-3 points
  const b2bScore = isBackToBack ? 3 : 0;

  const fatigueScore = Math.round((distScore + tzScore + b2bScore) * 10) / 10;

  return { distanceMiles, timezoneChange, isBackToBack, fatigueScore: Math.min(10, fatigueScore) };
}
