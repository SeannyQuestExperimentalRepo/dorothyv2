/**
 * Quick 10-Day Backtest
 * 
 * Connects to the Neon production database and analyzes our pick performance
 * for the last 10 days (Feb 5-15, 2026)
 */

import { PrismaClient } from "@prisma/client";

// Production database connection
const DATABASE_URL = "postgresql://neondb_owner:npg_q1J2nAExTsmO@ep-patient-sea-aisxwpbp-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL,
    },
  },
});

async function main() {
  try {
    console.log("🏀 Trendline 10-Day Backtest Report");
    console.log("=====================================");
    
    // Get picks from last 10 days
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    
    console.log(`📅 Date Range: ${tenDaysAgo.toISOString().split('T')[0]} to ${new Date().toISOString().split('T')[0]}`);
    
    const picks = await prisma.dailyPick.findMany({
      where: {
        gameDate: {
          gte: tenDaysAgo,
          lte: new Date(),
        },
        // Only graded picks (we have results)
        result: {
          not: null,
        },
      },
      orderBy: {
        gameDate: 'asc',
      },
    });
    
    if (picks.length === 0) {
      console.log("❌ No graded picks found in the last 10 days");
      return;
    }
    
    console.log(`📊 Total Graded Picks: ${picks.length}\n`);
    
    // Overall performance
    const wins = picks.filter(pick => pick.result === 'WIN').length;
    const losses = picks.filter(pick => pick.result === 'LOSS').length;
    const pushes = picks.filter(pick => pick.result === 'PUSH').length;
    
    const winRate = wins / (wins + losses);
    
    console.log("📈 OVERALL PERFORMANCE");
    console.log(`Win-Loss Record: ${wins}-${losses}${pushes > 0 ? `-${pushes}` : ''}`);
    console.log(`Win Rate: ${(winRate * 100).toFixed(1)}%`);
    console.log(`ROI: ${wins > losses ? '+' : ''}${((winRate - 0.5238) * 100).toFixed(1)}% (vs -5.238% breakeven)\n`);
    
    // Performance by confidence tier
    console.log("⭐ PERFORMANCE BY CONFIDENCE TIER");
    [5, 4, 3].forEach(tier => {
      const tierPicks = picks.filter(pick => pick.confidence === tier);
      if (tierPicks.length === 0) return;
      
      const tierWins = tierPicks.filter(pick => pick.result === 'WIN').length;
      const tierLosses = tierPicks.filter(pick => pick.result === 'LOSS').length;
      const tierWinRate = tierWins / (tierWins + tierLosses);
      
      console.log(`${tier}★: ${tierWins}-${tierLosses} (${(tierWinRate * 100).toFixed(1)}%) - ${tierPicks.length} total picks`);
    });
    
    console.log("");
    
    // Performance by sport
    console.log("🏆 PERFORMANCE BY SPORT");
    const sports = [...new Set(picks.map(pick => pick.sport))];
    sports.forEach(sport => {
      const sportPicks = picks.filter(pick => pick.sport === sport);
      const sportWins = sportPicks.filter(pick => pick.result === 'WIN').length;
      const sportLosses = sportPicks.filter(pick => pick.result === 'LOSS').length;
      const sportWinRate = sportWins / (sportWins + sportLosses);
      
      console.log(`${sport}: ${sportWins}-${sportLosses} (${(sportWinRate * 100).toFixed(1)}%) - ${sportPicks.length} total`);
    });
    
    console.log("");
    
    // Performance by pick type
    console.log("🎯 PERFORMANCE BY PICK TYPE");
    const pickTypes = [...new Set(picks.map(pick => pick.pickType))];
    pickTypes.forEach(type => {
      const typePicks = picks.filter(pick => pick.pickType === type);
      const typeWins = typePicks.filter(pick => pick.result === 'WIN').length;
      const typeLosses = typePicks.filter(pick => pick.result === 'LOSS').length;
      const typeWinRate = typeWins / (typeWins + typeLosses);
      
      console.log(`${type}: ${typeWins}-${typeLosses} (${(typeWinRate * 100).toFixed(1)}%) - ${typePicks.length} total`);
    });
    
    console.log("");
    
    // Daily breakdown
    console.log("📅 DAILY BREAKDOWN");
    const dailyBreakdown: { [key: string]: { wins: number; losses: number; total: number } } = {};
    
    picks.forEach(pick => {
      const date = pick.gameDate.toISOString().split('T')[0];
      if (!dailyBreakdown[date]) {
        dailyBreakdown[date] = { wins: 0, losses: 0, total: 0 };
      }
      dailyBreakdown[date].total++;
      if (pick.result === 'WIN') dailyBreakdown[date].wins++;
      if (pick.result === 'LOSS') dailyBreakdown[date].losses++;
    });
    
    Object.keys(dailyBreakdown)
      .sort()
      .forEach(date => {
        const day = dailyBreakdown[date];
        const dayWinRate = day.wins / (day.wins + day.losses);
        console.log(`${date}: ${day.wins}-${day.losses} (${(dayWinRate * 100).toFixed(1)}%) - ${day.total} picks`);
      });
    
    console.log("");
    
    // CLV Analysis (if available)
    const picksWithCLV = picks.filter(pick => pick.clv !== null);
    if (picksWithCLV.length > 0) {
      const avgCLV = picksWithCLV.reduce((sum, pick) => sum + (pick.clv || 0), 0) / picksWithCLV.length;
      const positiveCLV = picksWithCLV.filter(pick => (pick.clv || 0) > 0).length;
      
      console.log("💰 CLOSING LINE VALUE (CLV)");
      console.log(`Average CLV: ${avgCLV > 0 ? '+' : ''}${avgCLV.toFixed(2)} points`);
      console.log(`Positive CLV Rate: ${((positiveCLV / picksWithCLV.length) * 100).toFixed(1)}%`);
      console.log(`CLV Sample Size: ${picksWithCLV.length} picks\n`);
    }
    
    // Summary assessment
    console.log("🎯 ASSESSMENT");
    if (winRate >= 0.60) {
      console.log("🟢 EXCELLENT - Model is performing exceptionally well");
    } else if (winRate >= 0.54) {
      console.log("🟡 GOOD - Model is profitable and beating expectations");
    } else if (winRate >= 0.50) {
      console.log("🟡 FAIR - Model is close to breakeven, monitor closely");
    } else {
      console.log("🔴 POOR - Model is underperforming, investigate immediately");
    }
    
    console.log(`📊 Total Sample: ${picks.length} picks over 10 days (avg ${(picks.length / 10).toFixed(1)} picks/day)`);
    
  } catch (error) {
    console.error("Error running backtest:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);