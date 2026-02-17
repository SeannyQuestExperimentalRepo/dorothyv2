# 📺 UI Concept 2: SportsCenter-Style Dashboard (Medium Complexity)

**Philosophy:** "ESPN meets Bloomberg Terminal" - Information-rich but familiar

**Implementation Complexity:** ⭐⭐⭐ (Medium)
- Multi-section layout with tabs
- Real-time updates
- Chart integrations (Chart.js/Recharts)

---

## Visual Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ TRENDLINE ANALYTICS                              🔴 LIVE  │ ⚙️ │ 👤 Seanny │
├─────────────────────────────────────────────────────────────────────────────┤
│ [TODAY] [TOMORROW] [CALENDAR] [PERFORMANCE] [HISTORY]                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ ┌─ TOP PLAYS ──────┐  ┌─ MARKET MOVERS ─────┐  ┌─ PERFORMANCE ───┐         │
│ │                  │  │                     │  │                  │         │
│ │ 🟡⭐⭐⭐⭐⭐       │  │ DUKE -6.5 → -8.0   │  │ WIN RATE TREND   │         │
│ │ DUKE vs UNC      │  │ Sharp money 📈      │  │     ╭──╮         │         │
│ │ UNDER 155.5      │  │                     │  │   ╭─╯  ╰─╮       │         │
│ │ 🎯 92% Confident │  │ KANSAS +2 → PK      │  │ ╭─╯      ╰──    │         │
│ │ Reasoning: Tour- │  │ Public fade 📊      │  │ 65.2%    70%    │         │
│ │ nament rivalry   │  │                     │  │ ┌────┬────┬───┐ │         │
│ │                  │  │ BAYLOR U142→139     │  │ │7D  │30D │ALL│ │         │
│ │ [BET NOW] 📋     │  │ Steam move ⚡       │  │ └────┴────┴───┘ │         │
│ └──────────────────┘  └─────────────────────┘  └──────────────────┘         │
│                                                                             │
│ ┌─ ALL PICKS TODAY ─────────────────────────────────────────────────────┐   │
│ │                                                                       │   │
│ │ ⭐⭐⭐⭐⭐ │ DUKE vs UNC        │ UNDER 155.5 │ 92% │ Tournament rivalry │   │
│ │ ⭐⭐⭐⭐   │ KANSAS vs BAYLOR   │ UNDER 142.0 │ 87% │ KenPom + fatigue   │   │
│ │ ⭐⭐⭐     │ VILLANOVA +3.5     │ SPREAD      │ 74% │ Road dog value     │   │
│ │ ⭐⭐⭐     │ MICHIGAN -2.5      │ SPREAD      │ 68% │ Home court edge    │   │
│ │                                                                       │   │
│ │ [EXPORT CSV] [PRINT] [SHARE] [FILTERS ▼]                              │   │
│ └───────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│ ┌─ BREAKING NEWS / ALERTS ─────────────────────────────────────────────┐    │
│ │ 🚨 SHARP MONEY: Heavy action on Duke UNDER at -105                   │    │
│ │ 📊 INJURY UPDATE: UNC's top scorer questionable (ankle)              │    │
│ │ ⚡ LINE MOVE: Kansas moved from +2 to Pick'em in last 30 minutes     │    │
│ └───────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Color-Coded Sections

### Header Bar
- **Dark blue background** (#1a365d)
- **Live indicator:** Red/green status
- **User menu:** Dropdown with settings

### Main Content Grid
- **Card-based layout** with rounded corners
- **White backgrounds** with subtle shadows
- **Color coding:**
  - 🟡 Gold: 5-star picks
  - 🔵 Blue: 4-star picks  
  - 🟢 Green: 3-star picks
  - 🔴 Red: Alerts/warnings

### Charts & Performance
- **Real-time line charts** for win rate trends
- **Progress bars** for confidence levels
- **Heat maps** for historical performance

## Implementation Architecture

```typescript
// Route structure
/dashboard
  /today      (default)
  /tomorrow   
  /calendar   (date picker)
  /performance (analytics)
  /history    (past picks)

// Main component structure
const SportsCenter = () => {
  const [activeTab, setActiveTab] = useState('today');
  const picks = usePicks(activeTab);
  const marketData = useMarketMovers();
  const performance = usePerformance();
  const alerts = useAlerts();
  
  return (
    <Layout>
      <Header />
      <TabNavigation active={activeTab} onChange={setActiveTab} />
      <GridLayout>
        <TopPlaysCard picks={picks.filter(p => p.confidence >= 4)} />
        <MarketMoversCard data={marketData} />
        <PerformanceChart data={performance} />
        <AllPicksTable picks={picks} />
        <AlertsCard alerts={alerts} />
      </GridLayout>
    </Layout>
  );
};
```

## Advanced Features

### Real-Time Updates
```typescript
// WebSocket integration for live updates
const useRealTimeUpdates = () => {
  useEffect(() => {
    const ws = new WebSocket('wss://api.trendline.app/live');
    ws.onmessage = (event) => {
      const update = JSON.parse(event.data);
      if (update.type === 'line_move') {
        updateMarketMovers(update.data);
      }
      if (update.type === 'pick_result') {
        updatePerformance(update.data);
      }
    };
  }, []);
};
```

### Export Functionality
- **CSV export** of picks
- **PDF reports** with performance analytics
- **Share links** for individual picks
- **Calendar integration** for scheduled picks

### Responsive Breakpoints
- **Desktop (1200px+):** Full 3-column grid
- **Tablet (768-1199px):** 2-column layout
- **Mobile (320-767px):** Single column stack

## Third-Party Integrations

### Charts (Recharts)
```typescript
const PerformanceChart = ({ data }) => (
  <ResponsiveContainer width="100%" height={200}>
    <LineChart data={data}>
      <XAxis dataKey="date" />
      <YAxis domain={[0.5, 1]} />
      <Tooltip />
      <Line 
        type="monotone" 
        dataKey="winRate" 
        stroke="#3182ce" 
        strokeWidth={2}
      />
    </LineChart>
  </ResponsiveContainer>
);
```

### Notifications (React Hot Toast)
```typescript
const useAlertSystem = () => {
  useEffect(() => {
    if (newAlert) {
      toast.success('🎯 New 5-star pick available!', {
        position: 'top-right',
        duration: 5000
      });
    }
  }, [alerts]);
};
```

**Implementation Time:** 2-3 weeks
**Complexity:** Medium
**Libraries Needed:** 
- React Router
- Recharts/Chart.js
- React Hot Toast
- Date-fns
- Tailwind UI

**Pros:**
- Professional ESPN-like appearance
- Real-time market intelligence
- Comprehensive but not overwhelming
- Familiar sports media layout

**Cons:**
- More complex state management
- Requires WebSocket infrastructure  
- Multiple third-party dependencies
- Longer development time

**Best For:** Serious handicappers, desktop users, professional appearance