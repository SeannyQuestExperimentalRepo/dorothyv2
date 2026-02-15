import "server-only";

import { prisma } from "./db";
import { getVenue } from "./venue";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WeatherData {
  temperatureF: number;
  windSpeedMph: number;
  windGustMph: number;
  precipitationIn: number;
  humidityPct: number;
  conditions: string;
  isDome: boolean;
}

interface SignalResult {
  category: string;
  direction: "home" | "away" | "over" | "under" | "neutral";
  magnitude: number;
  confidence: number;
  label: string;
  strength: "strong" | "moderate" | "weak" | "noise";
}

interface OpenMeteoResponse {
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    wind_speed_10m: (number | null)[];
    wind_gusts_10m: (number | null)[];
    precipitation: (number | null)[];
    relative_humidity_2m: (number | null)[];
  };
}

// ─── Weather Fetching ───────────────────────────────────────────────────────

async function fetchOpenMeteo(
  lat: number,
  lon: number,
  date: Date
): Promise<OpenMeteoResponse> {
  const dateStr = date.toISOString().split("T")[0];
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation,relative_humidity_2m` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
    `&start_date=${dateStr}&end_date=${dateStr}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo API error: ${res.status}`);
  return res.json() as Promise<OpenMeteoResponse>;
}

function extractHourlyWeather(
  data: OpenMeteoResponse,
  targetHour: number
): WeatherData {
  const idx = Math.min(targetHour, data.hourly.time.length - 1);
  return {
    temperatureF: data.hourly.temperature_2m[idx] ?? 70,
    windSpeedMph: data.hourly.wind_speed_10m[idx] ?? 0,
    windGustMph: data.hourly.wind_gusts_10m[idx] ?? 0,
    precipitationIn: data.hourly.precipitation[idx] ?? 0,
    humidityPct: data.hourly.relative_humidity_2m[idx] ?? 50,
    conditions: classifyConditions(
      data.hourly.precipitation[idx] ?? 0,
      data.hourly.wind_speed_10m[idx] ?? 0,
      data.hourly.temperature_2m[idx] ?? 70
    ),
    isDome: false,
  };
}

function classifyConditions(precip: number, wind: number, temp: number): string {
  if (precip > 0.1 && temp <= 32) return "SNOW";
  if (precip > 0.1) return "RAIN";
  if (wind > 20) return "WIND";
  return "CLEAR";
}

// ─── Exports ────────────────────────────────────────────────────────────────

/**
 * Get weather for a specific game. Returns null for dome games.
 */
export async function getGameWeather(
  sport: string,
  homeTeam: string,
  gameDate: Date,
  kickoffHour?: number
): Promise<WeatherData | null> {
  const venue = getVenue(sport, homeTeam);
  if (!venue) return null;

  // Dome games don't need weather
  if (venue.isDome) {
    return {
      temperatureF: 72,
      windSpeedMph: 0,
      windGustMph: 0,
      precipitationIn: 0,
      humidityPct: 50,
      conditions: "DOME",
      isDome: true,
    };
  }

  const data = await fetchOpenMeteo(venue.lat, venue.lon, gameDate);
  // Default kickoff: 1pm local ≈ hour 13
  const hour = kickoffHour ?? 13;
  return extractHourlyWeather(data, hour);
}

/**
 * Batch fetch weather for all upcoming outdoor games and store in DB.
 */
export async function fetchWeatherForUpcomingGames(): Promise<void> {
  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Fetch upcoming NFL games
  const upcomingGames = await prisma.upcomingGame.findMany({
    where: {
      sport: { in: ["NFL", "NCAAF"] },
      gameDate: { gte: now, lte: weekOut },
    },
  });

  for (const game of upcomingGames) {
    const venue = getVenue(game.sport, game.homeTeam);
    if (!venue || venue.isDome) {
      // Store dome marker
      await prisma.gameWeather.upsert({
        where: {
          sport_gameDate_homeTeam_awayTeam: {
            sport: game.sport,
            gameDate: game.gameDate,
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
          },
        },
        update: { isDome: true, fetchedAt: now },
        create: {
          sport: game.sport,
          gameDate: game.gameDate,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          isDome: true,
        },
      });
      continue;
    }

    try {
      const weather = await getGameWeather(game.sport, game.homeTeam, game.gameDate);
      if (!weather) continue;

      await prisma.gameWeather.upsert({
        where: {
          sport_gameDate_homeTeam_awayTeam: {
            sport: game.sport,
            gameDate: game.gameDate,
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
          },
        },
        update: {
          temperatureF: weather.temperatureF,
          windSpeedMph: weather.windSpeedMph,
          windGustMph: weather.windGustMph,
          precipitationIn: weather.precipitationIn,
          humidityPct: weather.humidityPct,
          conditions: weather.conditions,
          isDome: false,
          fetchedAt: now,
        },
        create: {
          sport: game.sport,
          gameDate: game.gameDate,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          temperatureF: weather.temperatureF,
          windSpeedMph: weather.windSpeedMph,
          windGustMph: weather.windGustMph,
          precipitationIn: weather.precipitationIn,
          humidityPct: weather.humidityPct,
          conditions: weather.conditions,
          isDome: false,
        },
      });
    } catch (err) {
      console.error(`Weather fetch failed for ${game.homeTeam} vs ${game.awayTeam}:`, err);
    }

    // Rate limit: 100ms between API calls
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ─── Weather Signal ─────────────────────────────────────────────────────────

export function signalWeather(weather: WeatherData, sport: string): SignalResult {
  const neutral: SignalResult = {
    category: "weather",
    direction: "neutral",
    magnitude: 0,
    confidence: 0,
    label: "No weather impact",
    strength: "noise",
  };

  // Indoor sports / dome = no signal
  if (weather.isDome || sport === "NBA" || sport === "NCAAMB") {
    return neutral;
  }

  let magnitude = 0;
  let confidence = 0;
  const factors: string[] = [];

  // Wind > 20 mph: favors unders
  if (weather.windSpeedMph > 20) {
    const windFactor = Math.min(5, (weather.windSpeedMph - 20) / 5);
    magnitude += windFactor;
    confidence += 0.3;
    factors.push(`Wind ${Math.round(weather.windSpeedMph)} mph`);
  }

  // Gusts > 30 mph: additional under lean
  if (weather.windGustMph > 30) {
    magnitude += 1;
    confidence += 0.1;
    factors.push(`Gusts ${Math.round(weather.windGustMph)} mph`);
  }

  // Temp < 20°F: slight under lean
  if (weather.temperatureF < 20) {
    magnitude += 1.5;
    confidence += 0.15;
    factors.push(`${Math.round(weather.temperatureF)}°F`);
  } else if (weather.temperatureF < 35) {
    magnitude += 0.5;
    confidence += 0.05;
    factors.push(`${Math.round(weather.temperatureF)}°F`);
  }

  // Precipitation: under lean
  if (weather.precipitationIn > 0.1) {
    const precipFactor = Math.min(3, weather.precipitationIn * 5);
    magnitude += precipFactor;
    confidence += 0.2;
    factors.push(
      weather.temperatureF <= 32
        ? `Snow (${weather.precipitationIn.toFixed(1)}")`
        : `Rain (${weather.precipitationIn.toFixed(1)}")`
    );
  }

  if (magnitude < 1) return neutral;

  magnitude = Math.min(10, magnitude);
  confidence = Math.min(1, confidence);

  const strength: SignalResult["strength"] =
    magnitude >= 5 ? "strong" : magnitude >= 3 ? "moderate" : "weak";

  return {
    category: "weather",
    direction: "under",
    magnitude: Math.round(magnitude * 10) / 10,
    confidence: Math.round(confidence * 100) / 100,
    label: `Weather Under lean: ${factors.join(", ")}`,
    strength,
  };
}
