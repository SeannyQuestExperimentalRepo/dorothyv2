/**
 * NCAAMB (D-I Men's Basketball) team name mapping.
 * Maps between Sports Reference CBB names, KenPom names, common abbreviations,
 * nicknames, and other variants to a canonical team name.
 *
 * Canonical name = KenPom name where available.
 *
 * Key: any variant name (lowercased)
 * Value: canonical team name
 *
 * Covers all 364 current D-I teams (2024-25) plus defunct/reclassified programs
 * that appear in historical data (2005-2025).
 */
export const ncaambTeamNameMap: Record<string, string> = {
  // ═══════════════════════════════════════════════════════════════════
  // ─── ACC (15 teams) ───────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Boston College
  "boston college": "Boston College",
  "boston college eagles": "Boston College",
  bc: "Boston College",

  // California
  california: "California",
  "california golden bears": "California",
  cal: "California",
  "cal bears": "California",
  "golden bears": "California",

  // Clemson
  clemson: "Clemson",
  "clemson tigers": "Clemson",

  // Duke
  duke: "Duke",
  "duke blue devils": "Duke",
  "blue devils": "Duke",
  dook: "Duke",

  // Florida St.
  "florida st.": "Florida St.",
  "florida state": "Florida St.",
  "florida state seminoles": "Florida St.",
  "florida st": "Florida St.",
  fsu: "Florida St.",
  seminoles: "Florida St.",
  noles: "Florida St.",

  // Georgia Tech
  "georgia tech": "Georgia Tech",
  "georgia tech yellow jackets": "Georgia Tech",
  gt: "Georgia Tech",
  "yellow jackets": "Georgia Tech",

  // Louisville
  louisville: "Louisville",
  "louisville cardinals": "Louisville",
  "l'ville": "Louisville",

  // Miami FL
  "miami fl": "Miami FL",
  "miami (fl)": "Miami FL",
  "miami hurricanes": "Miami FL",
  hurricanes: "Miami FL",
  canes: "Miami FL",
  "the u": "Miami FL",

  // North Carolina
  "north carolina": "North Carolina",
  "north carolina tar heels": "North Carolina",
  unc: "North Carolina",
  "tar heels": "North Carolina",
  carolina: "North Carolina",

  // N.C. State
  "n.c. state": "N.C. State",
  "nc state": "N.C. State",
  "nc state wolfpack": "N.C. State",
  "north carolina state": "N.C. State",
  "north carolina st.": "N.C. State",
  wolfpack: "N.C. State",

  // Notre Dame
  "notre dame": "Notre Dame",
  "notre dame fighting irish": "Notre Dame",
  "fighting irish": "Notre Dame",
  nd: "Notre Dame",

  // Pittsburgh
  pittsburgh: "Pittsburgh",
  "pittsburgh panthers": "Pittsburgh",
  pitt: "Pittsburgh",

  // SMU
  smu: "SMU",
  "smu mustangs": "SMU",
  "southern methodist": "SMU",
  mustangs: "SMU",

  // Stanford
  stanford: "Stanford",
  "stanford cardinal": "Stanford",

  // Syracuse
  syracuse: "Syracuse",
  "syracuse orange": "Syracuse",
  cuse: "Syracuse",

  // Virginia
  virginia: "Virginia",
  "virginia cavaliers": "Virginia",
  uva: "Virginia",
  wahoos: "Virginia",
  cavaliers: "Virginia",

  // Virginia Tech
  "virginia tech": "Virginia Tech",
  "virginia tech hokies": "Virginia Tech",
  vt: "Virginia Tech",
  hokies: "Virginia Tech",

  // Wake Forest
  "wake forest": "Wake Forest",
  "wake forest demon deacons": "Wake Forest",
  wake: "Wake Forest",
  "demon deacons": "Wake Forest",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Big East (11 teams) ──────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Butler
  butler: "Butler",
  "butler bulldogs": "Butler",

  // UConn / Connecticut
  connecticut: "Connecticut",
  uconn: "Connecticut",
  "uconn huskies": "Connecticut",
  "connecticut huskies": "Connecticut",

  // Creighton
  creighton: "Creighton",
  "creighton bluejays": "Creighton",
  bluejays: "Creighton",

  // DePaul
  depaul: "DePaul",
  "depaul blue demons": "DePaul",
  "blue demons": "DePaul",

  // Georgetown
  georgetown: "Georgetown",
  "georgetown hoyas": "Georgetown",
  hoyas: "Georgetown",

  // Marquette
  marquette: "Marquette",
  "marquette golden eagles": "Marquette",

  // Providence
  providence: "Providence",
  "providence friars": "Providence",
  friars: "Providence",

  // Seton Hall
  "seton hall": "Seton Hall",
  "seton hall pirates": "Seton Hall",

  // St. John's
  "st. john's": "St. John's",
  "st. john's (ny)": "St. John's",
  "st john's": "St. John's",
  "saint john's": "St. John's",
  "st. john's red storm": "St. John's",
  "red storm": "St. John's",

  // Villanova
  villanova: "Villanova",
  "villanova wildcats": "Villanova",
  nova: "Villanova",

  // Xavier
  xavier: "Xavier",
  "xavier musketeers": "Xavier",
  musketeers: "Xavier",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Big Ten (18 teams) ───────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Illinois
  illinois: "Illinois",
  "illinois fighting illini": "Illinois",
  illini: "Illinois",
  "fighting illini": "Illinois",

  // Indiana
  indiana: "Indiana",
  "indiana hoosiers": "Indiana",
  hoosiers: "Indiana",
  iu: "Indiana",

  // Iowa
  iowa: "Iowa",
  "iowa hawkeyes": "Iowa",
  hawkeyes: "Iowa",

  // Maryland
  maryland: "Maryland",
  "maryland terrapins": "Maryland",
  terps: "Maryland",
  terrapins: "Maryland",

  // Michigan
  michigan: "Michigan",
  "michigan wolverines": "Michigan",
  wolverines: "Michigan",

  // Michigan St.
  "michigan st.": "Michigan St.",
  "michigan state": "Michigan St.",
  "michigan state spartans": "Michigan St.",
  "michigan st": "Michigan St.",
  msu: "Michigan St.",
  "sparty": "Michigan St.",

  // Minnesota
  minnesota: "Minnesota",
  "minnesota golden gophers": "Minnesota",
  gophers: "Minnesota",

  // Nebraska
  nebraska: "Nebraska",
  "nebraska cornhuskers": "Nebraska",
  huskers: "Nebraska",

  // Northwestern
  northwestern: "Northwestern",
  "northwestern wildcats": "Northwestern",

  // Ohio St.
  "ohio st.": "Ohio St.",
  "ohio state": "Ohio St.",
  "ohio state buckeyes": "Ohio St.",
  "ohio st": "Ohio St.",
  osu: "Ohio St.",
  buckeyes: "Ohio St.",

  // Oregon
  oregon: "Oregon",
  "oregon ducks": "Oregon",
  ducks: "Oregon",

  // Penn St.
  "penn st.": "Penn St.",
  "penn state": "Penn St.",
  "penn state nittany lions": "Penn St.",
  "penn st": "Penn St.",
  psu: "Penn St.",
  "nittany lions": "Penn St.",

  // Purdue
  purdue: "Purdue",
  "purdue boilermakers": "Purdue",
  boilermakers: "Purdue",

  // Rutgers
  rutgers: "Rutgers",
  "rutgers scarlet knights": "Rutgers",
  "scarlet knights": "Rutgers",

  // UCLA
  ucla: "UCLA",
  "ucla bruins": "UCLA",
  bruins: "UCLA",

  // USC
  usc: "USC",
  "usc trojans": "USC",
  "southern california": "USC",
  "southern cal": "USC",
  trojans: "USC",

  // Washington
  washington: "Washington",
  "washington huskies": "Washington",
  huskies: "Washington",
  udub: "Washington",

  // Wisconsin
  wisconsin: "Wisconsin",
  "wisconsin badgers": "Wisconsin",
  badgers: "Wisconsin",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Big 12 (16 teams) ───────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Arizona
  arizona: "Arizona",
  "arizona wildcats": "Arizona",
  "u of a": "Arizona",
  zona: "Arizona",

  // Arizona St.
  "arizona st.": "Arizona St.",
  "arizona state": "Arizona St.",
  "arizona state sun devils": "Arizona St.",
  "arizona st": "Arizona St.",
  asu: "Arizona St.",
  "sun devils": "Arizona St.",

  // Baylor
  baylor: "Baylor",
  "baylor bears": "Baylor",

  // BYU
  byu: "BYU",
  "byu cougars": "BYU",
  "brigham young": "BYU",
  "brigham young cougars": "BYU",

  // UCF
  ucf: "UCF",
  "ucf knights": "UCF",
  "central florida": "UCF",
  knights: "UCF",

  // Cincinnati
  cincinnati: "Cincinnati",
  "cincinnati bearcats": "Cincinnati",
  cincy: "Cincinnati",
  bearcats: "Cincinnati",

  // Colorado
  colorado: "Colorado",
  "colorado buffaloes": "Colorado",
  buffs: "Colorado",
  cu: "Colorado",

  // Houston
  houston: "Houston",
  "houston cougars": "Houston",
  coogs: "Houston",

  // Iowa St.
  "iowa st.": "Iowa St.",
  "iowa state": "Iowa St.",
  "iowa state cyclones": "Iowa St.",
  "iowa st": "Iowa St.",
  isu: "Iowa St.",
  cyclones: "Iowa St.",

  // Kansas
  kansas: "Kansas",
  "kansas jayhawks": "Kansas",
  ku: "Kansas",
  jayhawks: "Kansas",
  "rock chalk": "Kansas",

  // Kansas St.
  "kansas st.": "Kansas St.",
  "kansas state": "Kansas St.",
  "kansas state wildcats": "Kansas St.",
  "kansas st": "Kansas St.",
  ksu: "Kansas St.",
  "k-state": "Kansas St.",

  // Oklahoma St.
  "oklahoma st.": "Oklahoma St.",
  "oklahoma state": "Oklahoma St.",
  "oklahoma state cowboys": "Oklahoma St.",
  "oklahoma st": "Oklahoma St.",
  okst: "Oklahoma St.",

  // TCU
  tcu: "TCU",
  "tcu horned frogs": "TCU",
  "texas christian": "TCU",
  "horned frogs": "TCU",

  // Texas Tech
  "texas tech": "Texas Tech",
  "texas tech red raiders": "Texas Tech",
  ttu: "Texas Tech",
  "red raiders": "Texas Tech",

  // Utah
  utah: "Utah",
  "utah utes": "Utah",
  utes: "Utah",

  // West Virginia
  "west virginia": "West Virginia",
  "west virginia mountaineers": "West Virginia",
  wvu: "West Virginia",
  mountaineers: "West Virginia",

  // ═══════════════════════════════════════════════════════════════════
  // ─── SEC (16 teams) ───────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Alabama
  alabama: "Alabama",
  "alabama crimson tide": "Alabama",
  bama: "Alabama",
  "crimson tide": "Alabama",
  "roll tide": "Alabama",

  // Arkansas
  arkansas: "Arkansas",
  "arkansas razorbacks": "Arkansas",
  razorbacks: "Arkansas",
  hogs: "Arkansas",

  // Auburn
  auburn: "Auburn",
  "auburn tigers": "Auburn",

  // Florida
  florida: "Florida",
  "florida gators": "Florida",
  gators: "Florida",
  uf: "Florida",

  // Georgia
  georgia: "Georgia",
  "georgia bulldogs": "Georgia",
  uga: "Georgia",
  dawgs: "Georgia",

  // Kentucky
  kentucky: "Kentucky",
  "kentucky wildcats": "Kentucky",
  uk: "Kentucky",
  wildcats: "Kentucky",

  // LSU
  lsu: "LSU",
  "lsu tigers": "LSU",
  "louisiana state": "LSU",

  // Mississippi (KP canonical for Ole Miss)
  mississippi: "Mississippi",
  "ole miss": "Mississippi",
  "ole miss rebels": "Mississippi",
  "mississippi rebels": "Mississippi",

  // Mississippi St.
  "mississippi st.": "Mississippi St.",
  "mississippi state": "Mississippi St.",
  "mississippi state bulldogs": "Mississippi St.",
  "miss state": "Mississippi St.",
  "miss st": "Mississippi St.",

  // Missouri
  missouri: "Missouri",
  "missouri tigers": "Missouri",
  mizzou: "Missouri",

  // Oklahoma
  oklahoma: "Oklahoma",
  "oklahoma sooners": "Oklahoma",
  ou: "Oklahoma",
  sooners: "Oklahoma",

  // South Carolina
  "south carolina": "South Carolina",
  "south carolina gamecocks": "South Carolina",
  gamecocks: "South Carolina",

  // Tennessee
  tennessee: "Tennessee",
  "tennessee volunteers": "Tennessee",
  vols: "Tennessee",

  // Texas
  texas: "Texas",
  "texas longhorns": "Texas",
  longhorns: "Texas",
  "hook em": "Texas",

  // Texas A&M
  "texas a&m": "Texas A&M",
  "texas a&m aggies": "Texas A&M",
  "texas am": "Texas A&M",
  tamu: "Texas A&M",
  aggies: "Texas A&M",
  "a&m": "Texas A&M",

  // Vanderbilt
  vanderbilt: "Vanderbilt",
  "vanderbilt commodores": "Vanderbilt",
  vandy: "Vanderbilt",
  commodores: "Vanderbilt",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Pac-12 (remaining 2 + historical) ────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Oregon St.
  "oregon st.": "Oregon St.",
  "oregon state": "Oregon St.",
  "oregon state beavers": "Oregon St.",
  "oregon st": "Oregon St.",
  beavers: "Oregon St.",

  // Washington St.
  "washington st.": "Washington St.",
  "washington state": "Washington St.",
  "washington state cougars": "Washington St.",
  "washington st": "Washington St.",
  wsu: "Washington St.",
  wazzu: "Washington St.",
  cougs: "Washington St.",

  // ═══════════════════════════════════════════════════════════════════
  // ─── AAC (14 teams) ───────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Charlotte
  charlotte: "Charlotte",
  "charlotte 49ers": "Charlotte",

  // East Carolina
  "east carolina": "East Carolina",
  "east carolina pirates": "East Carolina",
  ecu: "East Carolina",

  // FAU / Florida Atlantic
  "florida atlantic": "Florida Atlantic",
  "florida atlantic owls": "Florida Atlantic",
  fau: "Florida Atlantic",

  // Memphis
  memphis: "Memphis",
  "memphis tigers": "Memphis",

  // North Texas
  "north texas": "North Texas",
  "north texas mean green": "North Texas",
  unt: "North Texas",
  "mean green": "North Texas",

  // Rice
  rice: "Rice",
  "rice owls": "Rice",

  // South Florida
  "south florida": "South Florida",
  "south florida bulls": "South Florida",
  usf: "South Florida",

  // Temple
  temple: "Temple",
  "temple owls": "Temple",

  // Tulane
  tulane: "Tulane",
  "tulane green wave": "Tulane",
  "green wave": "Tulane",

  // Tulsa
  tulsa: "Tulsa",
  "tulsa golden hurricane": "Tulsa",
  "golden hurricane": "Tulsa",

  // UAB
  uab: "UAB",
  "uab blazers": "UAB",
  "alabama-birmingham": "UAB",
  "alabama birmingham": "UAB",

  // UTSA
  utsa: "UTSA",
  "utsa roadrunners": "UTSA",
  "texas-san antonio": "UTSA",
  "texas san antonio": "UTSA",
  roadrunners: "UTSA",

  // Wichita St.
  "wichita st.": "Wichita St.",
  "wichita state": "Wichita St.",
  "wichita state shockers": "Wichita St.",
  "wichita st": "Wichita St.",
  shockers: "Wichita St.",

  // Army (historically AAC, now Patriot)
  // Listed under Patriot League below

  // Navy (historically AAC, now Patriot)
  // Listed under Patriot League below

  // ═══════════════════════════════════════════════════════════════════
  // ─── Mountain West (12 teams) ─────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Air Force
  "air force": "Air Force",
  "air force falcons": "Air Force",
  usafa: "Air Force",

  // Boise St.
  "boise st.": "Boise St.",
  "boise state": "Boise St.",
  "boise state broncos": "Boise St.",
  "boise st": "Boise St.",
  boise: "Boise St.",

  // Colorado St.
  "colorado st.": "Colorado St.",
  "colorado state": "Colorado St.",
  "colorado state rams": "Colorado St.",
  "colorado st": "Colorado St.",
  csu: "Colorado St.",

  // Fresno St.
  "fresno st.": "Fresno St.",
  "fresno state": "Fresno St.",
  "fresno state bulldogs": "Fresno St.",
  "fresno st": "Fresno St.",
  fresno: "Fresno St.",

  // Nevada
  nevada: "Nevada",
  "nevada wolf pack": "Nevada",
  "wolf pack": "Nevada",

  // New Mexico
  "new mexico": "New Mexico",
  "new mexico lobos": "New Mexico",
  unm: "New Mexico",
  lobos: "New Mexico",

  // San Diego St.
  "san diego st.": "San Diego St.",
  "san diego state": "San Diego St.",
  "san diego state aztecs": "San Diego St.",
  "san diego st": "San Diego St.",
  sdsu: "San Diego St.",
  aztecs: "San Diego St.",

  // San Jose St.
  "san jose st.": "San Jose St.",
  "san jose state": "San Jose St.",
  "san jose state spartans": "San Jose St.",
  "san jose st": "San Jose St.",
  sjsu: "San Jose St.",

  // UNLV
  unlv: "UNLV",
  "unlv rebels": "UNLV",
  "nevada-las vegas": "UNLV",
  "nevada las vegas": "UNLV",

  // Utah St.
  "utah st.": "Utah St.",
  "utah state": "Utah St.",
  "utah state aggies": "Utah St.",
  "utah st": "Utah St.",
  usu: "Utah St.",

  // Wyoming
  wyoming: "Wyoming",
  "wyoming cowboys": "Wyoming",

  // Hawaii (moved to Big West for basketball)
  hawaii: "Hawaii",
  "hawaii rainbow warriors": "Hawaii",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Sun Belt (14 teams) ──────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Appalachian St.
  "appalachian st.": "Appalachian St.",
  "appalachian state": "Appalachian St.",
  "appalachian state mountaineers": "Appalachian St.",
  "appalachian st": "Appalachian St.",
  "app state": "Appalachian St.",
  "app st": "Appalachian St.",

  // Arkansas St.
  "arkansas st.": "Arkansas St.",
  "arkansas state": "Arkansas St.",
  "arkansas state red wolves": "Arkansas St.",
  "arkansas st": "Arkansas St.",

  // Coastal Carolina
  "coastal carolina": "Coastal Carolina",
  "coastal carolina chanticleers": "Coastal Carolina",
  coastal: "Coastal Carolina",
  ccu: "Coastal Carolina",

  // Georgia Southern
  "georgia southern": "Georgia Southern",
  "georgia southern eagles": "Georgia Southern",

  // Georgia St.
  "georgia st.": "Georgia St.",
  "georgia state": "Georgia St.",
  "georgia state panthers": "Georgia St.",
  "georgia st": "Georgia St.",

  // James Madison
  "james madison": "James Madison",
  "james madison dukes": "James Madison",
  jmu: "James Madison",

  // Louisiana
  louisiana: "Louisiana",
  "louisiana ragin' cajuns": "Louisiana",
  "louisiana ragin cajuns": "Louisiana",
  "louisiana-lafayette": "Louisiana",
  "louisiana lafayette": "Louisiana",
  ull: "Louisiana",
  cajuns: "Louisiana",
  "ragin cajuns": "Louisiana",

  // Louisiana Monroe
  "louisiana monroe": "Louisiana Monroe",
  "louisiana-monroe": "Louisiana Monroe",
  "louisiana-monroe warhawks": "Louisiana Monroe",
  ulm: "Louisiana Monroe",
  warhawks: "Louisiana Monroe",

  // Marshall
  marshall: "Marshall",
  "marshall thundering herd": "Marshall",
  "thundering herd": "Marshall",

  // Old Dominion
  "old dominion": "Old Dominion",
  "old dominion monarchs": "Old Dominion",
  odu: "Old Dominion",
  monarchs: "Old Dominion",

  // South Alabama
  "south alabama": "South Alabama",
  "south alabama jaguars": "South Alabama",

  // Southern Miss
  "southern miss": "Southern Miss",
  "southern mississippi": "Southern Miss",
  "southern miss golden eagles": "Southern Miss",
  usm: "Southern Miss",

  // Texas St.
  "texas st.": "Texas St.",
  "texas state": "Texas St.",
  "texas state bobcats": "Texas St.",
  "texas st": "Texas St.",
  txst: "Texas St.",

  // Troy
  troy: "Troy",
  "troy trojans": "Troy",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Conference USA (10 teams) ────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // FIU
  fiu: "FIU",
  "fiu panthers": "FIU",
  "florida international": "FIU",

  // Jacksonville St.
  "jacksonville st.": "Jacksonville St.",
  "jacksonville state": "Jacksonville St.",
  "jacksonville state gamecocks": "Jacksonville St.",
  "jacksonville st": "Jacksonville St.",
  "jax state": "Jacksonville St.",
  "jax st": "Jacksonville St.",

  // Kennesaw St.
  "kennesaw st.": "Kennesaw St.",
  "kennesaw state": "Kennesaw St.",
  "kennesaw state owls": "Kennesaw St.",
  "kennesaw st": "Kennesaw St.",
  kennesaw: "Kennesaw St.",

  // Liberty
  liberty: "Liberty",
  "liberty flames": "Liberty",
  flames: "Liberty",

  // Louisiana Tech
  "louisiana tech": "Louisiana Tech",
  "louisiana tech bulldogs": "Louisiana Tech",
  "la tech": "Louisiana Tech",

  // Middle Tennessee
  "middle tennessee": "Middle Tennessee",
  "middle tennessee state": "Middle Tennessee",
  "middle tennessee blue raiders": "Middle Tennessee",
  mtsu: "Middle Tennessee",
  "blue raiders": "Middle Tennessee",

  // New Mexico St.
  "new mexico st.": "New Mexico St.",
  "new mexico state": "New Mexico St.",
  "new mexico state aggies": "New Mexico St.",
  "new mexico st": "New Mexico St.",
  nmsu: "New Mexico St.",

  // Sam Houston St.
  "sam houston st.": "Sam Houston St.",
  "sam houston": "Sam Houston St.",
  "sam houston state": "Sam Houston St.",
  "sam houston st": "Sam Houston St.",
  shsu: "Sam Houston St.",

  // UTEP
  utep: "UTEP",
  "utep miners": "UTEP",
  "texas-el paso": "UTEP",
  "texas el paso": "UTEP",
  miners: "UTEP",

  // Western Kentucky
  "western kentucky": "Western Kentucky",
  "western kentucky hilltoppers": "Western Kentucky",
  "western ky": "Western Kentucky",
  wku: "Western Kentucky",
  hilltoppers: "Western Kentucky",

  // ═══════════════════════════════════════════════════════════════════
  // ─── MAC (12 teams) ───────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Akron
  akron: "Akron",
  "akron zips": "Akron",
  zips: "Akron",

  // Ball St.
  "ball st.": "Ball St.",
  "ball state": "Ball St.",
  "ball state cardinals": "Ball St.",
  "ball st": "Ball St.",

  // Bowling Green
  "bowling green": "Bowling Green",
  "bowling green falcons": "Bowling Green",
  "bowling green state": "Bowling Green",
  bgsu: "Bowling Green",

  // Buffalo
  buffalo: "Buffalo",
  "buffalo bulls": "Buffalo",

  // Central Michigan
  "central michigan": "Central Michigan",
  "central michigan chippewas": "Central Michigan",
  cmu: "Central Michigan",
  chippewas: "Central Michigan",

  // Eastern Michigan
  "eastern michigan": "Eastern Michigan",
  "eastern michigan eagles": "Eastern Michigan",
  emu: "Eastern Michigan",

  // Kent St.
  "kent st.": "Kent St.",
  "kent state": "Kent St.",
  "kent state golden flashes": "Kent St.",
  "kent st": "Kent St.",
  kent: "Kent St.",

  // Miami OH
  "miami oh": "Miami OH",
  "miami (oh)": "Miami OH",
  "miami ohio": "Miami OH",
  "miami redhawks": "Miami OH",
  redhawks: "Miami OH",

  // Northern Illinois
  "northern illinois": "Northern Illinois",
  "northern illinois huskies": "Northern Illinois",
  niu: "Northern Illinois",

  // Ohio
  ohio: "Ohio",
  "ohio bobcats": "Ohio",
  "ohio university": "Ohio",

  // Toledo
  toledo: "Toledo",
  "toledo rockets": "Toledo",
  rockets: "Toledo",

  // Western Michigan
  "western michigan": "Western Michigan",
  "western michigan broncos": "Western Michigan",
  wmu: "Western Michigan",

  // ═══════════════════════════════════════════════════════════════════
  // ─── WCC (10 teams) ───────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Gonzaga
  gonzaga: "Gonzaga",
  "gonzaga bulldogs": "Gonzaga",
  zags: "Gonzaga",

  // Loyola Marymount
  "loyola marymount": "Loyola Marymount",
  "loyola marymount lions": "Loyola Marymount",
  lmu: "Loyola Marymount",

  // Oregon St. - already listed above under Pac-12

  // Pacific
  pacific: "Pacific",
  "pacific tigers": "Pacific",

  // Pepperdine
  pepperdine: "Pepperdine",
  "pepperdine waves": "Pepperdine",
  waves: "Pepperdine",

  // Portland
  portland: "Portland",
  "portland pilots": "Portland",
  pilots: "Portland",

  // Saint Mary's
  "saint mary's": "Saint Mary's",
  "saint marys": "Saint Mary's",
  "st. mary's": "Saint Mary's",
  "st marys": "Saint Mary's",
  "saint mary's gaels": "Saint Mary's",
  gaels: "Saint Mary's",

  // San Diego
  "san diego": "San Diego",
  "san diego toreros": "San Diego",
  toreros: "San Diego",

  // San Francisco
  "san francisco": "San Francisco",
  "san francisco dons": "San Francisco",
  dons: "San Francisco",
  usf_bb: "San Francisco", // differentiate from South Florida

  // Santa Clara
  "santa clara": "Santa Clara",
  "santa clara broncos": "Santa Clara",

  // Washington St. - already listed above

  // ═══════════════════════════════════════════════════════════════════
  // ─── MVC / Missouri Valley (12 teams) ─────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Belmont
  belmont: "Belmont",
  "belmont bruins": "Belmont",

  // Bradley
  bradley: "Bradley",
  "bradley braves": "Bradley",
  braves: "Bradley",

  // Drake
  drake: "Drake",
  "drake bulldogs": "Drake",

  // Evansville
  evansville: "Evansville",
  "evansville purple aces": "Evansville",
  "purple aces": "Evansville",

  // Illinois St.
  "illinois st.": "Illinois St.",
  "illinois state": "Illinois St.",
  "illinois state redbirds": "Illinois St.",
  "illinois st": "Illinois St.",
  redbirds: "Illinois St.",

  // Indiana St.
  "indiana st.": "Indiana St.",
  "indiana state": "Indiana St.",
  "indiana state sycamores": "Indiana St.",
  "indiana st": "Indiana St.",
  sycamores: "Indiana St.",

  // Missouri St.
  "missouri st.": "Missouri St.",
  "missouri state": "Missouri St.",
  "missouri state bears": "Missouri St.",
  "missouri st": "Missouri St.",

  // Murray St.
  "murray st.": "Murray St.",
  "murray state": "Murray St.",
  "murray state racers": "Murray St.",
  "murray st": "Murray St.",
  racers: "Murray St.",

  // Northern Iowa
  "northern iowa": "Northern Iowa",
  "northern iowa panthers": "Northern Iowa",
  uni: "Northern Iowa",

  // Southern Illinois
  "southern illinois": "Southern Illinois",
  "southern illinois salukis": "Southern Illinois",
  siu: "Southern Illinois",
  salukis: "Southern Illinois",

  // UIC / Illinois Chicago
  "illinois chicago": "Illinois Chicago",
  uic: "Illinois Chicago",
  "uic flames": "Illinois Chicago",
  "illinois-chicago": "Illinois Chicago",

  // Valparaiso
  valparaiso: "Valparaiso",
  "valparaiso beacons": "Valparaiso",
  valpo: "Valparaiso",

  // ═══════════════════════════════════════════════════════════════════
  // ─── A-10 / Atlantic 10 (15 teams) ────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Davidson
  davidson: "Davidson",
  "davidson wildcats": "Davidson",

  // Dayton
  dayton: "Dayton",
  "dayton flyers": "Dayton",
  flyers: "Dayton",

  // Duquesne
  duquesne: "Duquesne",
  "duquesne dukes": "Duquesne",

  // Fordham
  fordham: "Fordham",
  "fordham rams": "Fordham",
  rams: "Fordham",

  // George Mason
  "george mason": "George Mason",
  "george mason patriots": "George Mason",
  gmu: "George Mason",

  // George Washington
  "george washington": "George Washington",
  "george washington revolutionaries": "George Washington",
  gw: "George Washington",
  gwu: "George Washington",

  // La Salle
  "la salle": "La Salle",
  "la salle explorers": "La Salle",
  "lasalle": "La Salle",
  explorers: "La Salle",

  // Loyola Chicago
  "loyola chicago": "Loyola Chicago",
  "loyola (il)": "Loyola Chicago",
  "loyola il": "Loyola Chicago",
  "loyola-chicago": "Loyola Chicago",
  "loyola chicago ramblers": "Loyola Chicago",
  ramblers: "Loyola Chicago",

  // UMass / Massachusetts
  umass: "Massachusetts",
  massachusetts: "Massachusetts",
  "massachusetts minutemen": "Massachusetts",
  "umass minutemen": "Massachusetts",
  minutemen: "Massachusetts",

  // Rhode Island
  "rhode island": "Rhode Island",
  "rhode island rams": "Rhode Island",
  uri: "Rhode Island",

  // Richmond
  richmond: "Richmond",
  "richmond spiders": "Richmond",
  spiders: "Richmond",

  // Saint Bonaventure
  "saint bonaventure": "Saint Bonaventure",
  "st. bonaventure": "Saint Bonaventure",
  "st bonaventure": "Saint Bonaventure",
  bonnies: "Saint Bonaventure",

  // Saint Joseph's
  "saint joseph's": "Saint Joseph's",
  "st. joseph's": "Saint Joseph's",
  "st joseph's": "Saint Joseph's",
  "saint josephs": "Saint Joseph's",
  "st. josephs": "Saint Joseph's",
  hawks: "Saint Joseph's",

  // Saint Louis
  "saint louis": "Saint Louis",
  "st. louis": "Saint Louis",
  "st louis": "Saint Louis",
  "saint louis billikens": "Saint Louis",
  billikens: "Saint Louis",
  slu: "Saint Louis",

  // VCU
  vcu: "VCU",
  "vcu rams": "VCU",
  "virginia commonwealth": "VCU",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Colonial Athletic Association (13 teams) ─────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Campbell
  campbell: "Campbell",
  "campbell fighting camels": "Campbell",

  // Charleston
  charleston: "Charleston",
  "college of charleston": "Charleston",
  "charleston cougars": "Charleston",
  cofc: "Charleston",

  // Delaware
  delaware: "Delaware",
  "delaware blue hens": "Delaware",
  "blue hens": "Delaware",

  // Drexel
  drexel: "Drexel",
  "drexel dragons": "Drexel",
  dragons: "Drexel",

  // Elon
  elon: "Elon",
  "elon phoenix": "Elon",

  // Hampton
  hampton: "Hampton",
  "hampton pirates": "Hampton",

  // Hofstra
  hofstra: "Hofstra",
  "hofstra pride": "Hofstra",

  // Monmouth
  monmouth: "Monmouth",
  "monmouth hawks": "Monmouth",

  // UNCW / UNC Wilmington
  "unc wilmington": "UNC Wilmington",
  uncw: "UNC Wilmington",
  "north carolina-wilmington": "UNC Wilmington",
  "unc-wilmington": "UNC Wilmington",

  // Northeastern
  northeastern: "Northeastern",
  "northeastern huskies": "Northeastern",

  // Stony Brook
  "stony brook": "Stony Brook",
  "stony brook seawolves": "Stony Brook",

  // Towson
  towson: "Towson",
  "towson tigers": "Towson",

  // William & Mary
  "william & mary": "William & Mary",
  "william and mary": "William & Mary",
  "william & mary tribe": "William & Mary",
  "w&m": "William & Mary",

  // ═══════════════════════════════════════════════════════════════════
  // ─── America East (10 teams) ──────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Albany
  albany: "Albany",
  "albany (ny)": "Albany",
  "albany great danes": "Albany",
  "great danes": "Albany",

  // Binghamton
  binghamton: "Binghamton",
  "binghamton bearcats": "Binghamton",

  // Bryant
  bryant: "Bryant",
  "bryant bulldogs": "Bryant",

  // Maine
  maine: "Maine",
  "maine black bears": "Maine",

  // New Hampshire
  "new hampshire": "New Hampshire",
  "new hampshire wildcats": "New Hampshire",
  unh: "New Hampshire",

  // NJIT
  njit: "NJIT",
  "njit highlanders": "NJIT",

  // UMBC
  umbc: "UMBC",
  "umbc retrievers": "UMBC",
  "maryland-baltimore county": "UMBC",
  retrievers: "UMBC",

  // UMass Lowell
  "umass lowell": "UMass Lowell",
  "massachusetts-lowell": "UMass Lowell",
  "umass-lowell": "UMass Lowell",

  // UVM / Vermont
  vermont: "Vermont",
  "vermont catamounts": "Vermont",
  uvm: "Vermont",
  catamounts: "Vermont",

  // Hartford (reclassified D-III, historical only)
  hartford: "Hartford",
  "hartford hawks": "Hartford",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Atlantic Sun (ASUN, 13 teams) ────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Austin Peay
  "austin peay": "Austin Peay",
  "austin peay state": "Austin Peay",
  "austin peay governors": "Austin Peay",
  apsu: "Austin Peay",

  // Bellarmine
  bellarmine: "Bellarmine",
  "bellarmine knights": "Bellarmine",

  // Central Arkansas
  "central arkansas": "Central Arkansas",
  "central arkansas bears": "Central Arkansas",
  uca: "Central Arkansas",

  // Eastern Kentucky
  "eastern kentucky": "Eastern Kentucky",
  "eastern kentucky colonels": "Eastern Kentucky",
  eku: "Eastern Kentucky",
  colonels: "Eastern Kentucky",

  // Florida Gulf Coast
  "florida gulf coast": "Florida Gulf Coast",
  "florida gulf coast eagles": "Florida Gulf Coast",
  fgcu: "Florida Gulf Coast",
  "fl gulf coast": "Florida Gulf Coast",

  // High Point
  "high point": "High Point",
  "high point panthers": "High Point",

  // Jacksonville
  jacksonville: "Jacksonville",
  "jacksonville dolphins": "Jacksonville",

  // Lipscomb
  lipscomb: "Lipscomb",
  "lipscomb bisons": "Lipscomb",

  // North Alabama
  "north alabama": "North Alabama",
  "north alabama lions": "North Alabama",
  una: "North Alabama",

  // North Florida
  "north florida": "North Florida",
  "north florida ospreys": "North Florida",
  unf: "North Florida",

  // Queens
  queens: "Queens",
  "queens royals": "Queens",
  "queens university": "Queens",

  // Stetson
  stetson: "Stetson",
  "stetson hatters": "Stetson",
  hatters: "Stetson",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Big Sky (13 teams) ───────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Eastern Washington
  "eastern washington": "Eastern Washington",
  "eastern washington eagles": "Eastern Washington",
  ewu: "Eastern Washington",

  // Idaho
  idaho: "Idaho",
  "idaho vandals": "Idaho",
  vandals: "Idaho",

  // Idaho St.
  "idaho st.": "Idaho St.",
  "idaho state": "Idaho St.",
  "idaho state bengals": "Idaho St.",
  "idaho st": "Idaho St.",

  // Montana
  montana: "Montana",
  "montana grizzlies": "Montana",

  // Montana St.
  "montana st.": "Montana St.",
  "montana state": "Montana St.",
  "montana state bobcats": "Montana St.",
  "montana st": "Montana St.",

  // Northern Arizona
  "northern arizona": "Northern Arizona",
  "northern arizona lumberjacks": "Northern Arizona",
  nau: "Northern Arizona",
  lumberjacks: "Northern Arizona",

  // Northern Colorado
  "northern colorado": "Northern Colorado",
  "northern colorado bears": "Northern Colorado",
  unc_co: "Northern Colorado",

  // Portland St.
  "portland st.": "Portland St.",
  "portland state": "Portland St.",
  "portland state vikings": "Portland St.",
  "portland st": "Portland St.",

  // Sacramento St.
  "sacramento st.": "Sacramento St.",
  "sacramento state": "Sacramento St.",
  "sacramento state hornets": "Sacramento St.",
  "sacramento st": "Sacramento St.",
  "sac state": "Sacramento St.",
  "sac st": "Sacramento St.",

  // Weber St.
  "weber st.": "Weber St.",
  "weber state": "Weber St.",
  "weber state wildcats": "Weber St.",
  "weber st": "Weber St.",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Big South (11 teams) ─────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Charleston Southern
  "charleston southern": "Charleston Southern",
  "charleston southern buccaneers": "Charleston Southern",

  // Gardner-Webb
  "gardner-webb": "Gardner Webb",
  "gardner webb": "Gardner Webb",
  "gardner-webb runnin' bulldogs": "Gardner Webb",

  // High Point - already listed under ASUN

  // Longwood
  longwood: "Longwood",
  "longwood lancers": "Longwood",
  lancers: "Longwood",

  // Presbyterian
  presbyterian: "Presbyterian",
  "presbyterian blue hose": "Presbyterian",
  "blue hose": "Presbyterian",

  // Radford
  radford: "Radford",
  "radford highlanders": "Radford",

  // UNC Asheville
  "unc asheville": "UNC Asheville",
  "north carolina-asheville": "UNC Asheville",
  "unc-asheville": "UNC Asheville",
  unca: "UNC Asheville",

  // USC Upstate
  "usc upstate": "USC Upstate",
  "south carolina upstate": "USC Upstate",
  "sc upstate": "USC Upstate",

  // Winthrop
  winthrop: "Winthrop",
  "winthrop eagles": "Winthrop",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Big West (11 teams) ──────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Cal Poly
  "cal poly": "Cal Poly",
  "cal poly mustangs": "Cal Poly",
  "california polytechnic": "Cal Poly",
  "cal poly slo": "Cal Poly",

  // CSU Bakersfield
  "cal st. bakersfield": "Cal St. Bakersfield",
  "csu bakersfield": "Cal St. Bakersfield",
  "cal state bakersfield": "Cal St. Bakersfield",
  "cal st. bakersfield roadrunners": "Cal St. Bakersfield",
  "cal st bakersfield": "Cal St. Bakersfield",
  csub: "Cal St. Bakersfield",

  // CSU Fullerton
  "cal st. fullerton": "Cal St. Fullerton",
  "csu fullerton": "Cal St. Fullerton",
  "cal state fullerton": "Cal St. Fullerton",
  "cal st fullerton": "Cal St. Fullerton",
  csuf: "Cal St. Fullerton",
  "fullerton": "Cal St. Fullerton",

  // CSU Northridge / CSUN
  csun: "CSUN",
  "cal state northridge": "CSUN",
  "cal st. northridge": "CSUN",
  "csu northridge": "CSUN",
  "cal st northridge": "CSUN",
  "csun matadors": "CSUN",
  matadors: "CSUN",
  northridge: "CSUN",

  // Hawaii - already listed above

  // Long Beach St.
  "long beach st.": "Long Beach St.",
  "long beach state": "Long Beach St.",
  "long beach state 49ers": "Long Beach St.",
  "long beach st": "Long Beach St.",
  lbsu: "Long Beach St.",
  "long beach": "Long Beach St.",

  // UC Davis
  "uc davis": "UC Davis",
  "uc davis aggies": "UC Davis",

  // UC Irvine
  "uc irvine": "UC Irvine",
  "uc irvine anteaters": "UC Irvine",
  uci: "UC Irvine",
  anteaters: "UC Irvine",

  // UC Riverside
  "uc riverside": "UC Riverside",
  "uc riverside highlanders": "UC Riverside",
  ucr: "UC Riverside",

  // UC San Diego
  "uc san diego": "UC San Diego",
  "uc san diego tritons": "UC San Diego",
  ucsd: "UC San Diego",
  tritons: "UC San Diego",

  // UC Santa Barbara
  "uc santa barbara": "UC Santa Barbara",
  "uc santa barbara gauchos": "UC Santa Barbara",
  ucsb: "UC Santa Barbara",
  gauchos: "UC Santa Barbara",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Horizon League (12 teams) ────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Cleveland St.
  "cleveland st.": "Cleveland St.",
  "cleveland state": "Cleveland St.",
  "cleveland state vikings": "Cleveland St.",
  "cleveland st": "Cleveland St.",

  // Detroit Mercy
  "detroit mercy": "Detroit Mercy",
  "detroit mercy titans": "Detroit Mercy",
  detroit: "Detroit Mercy",

  // Green Bay
  "green bay": "Green Bay",
  "green bay phoenix": "Green Bay",
  "wisconsin-green bay": "Green Bay",

  // IU Indy (formerly IUPUI)
  "iu indy": "IU Indy",
  "iu indianapolis": "IU Indy",
  iupui: "IU Indy",
  "iupui jaguars": "IU Indy",

  // Milwaukee
  milwaukee: "Milwaukee",
  "milwaukee panthers": "Milwaukee",
  "wisconsin-milwaukee": "Milwaukee",
  uwm: "Milwaukee",

  // Northern Kentucky
  "northern kentucky": "Northern Kentucky",
  "northern kentucky norse": "Northern Kentucky",
  nku: "Northern Kentucky",
  norse: "Northern Kentucky",

  // Oakland
  oakland: "Oakland",
  "oakland golden grizzlies": "Oakland",

  // Purdue Fort Wayne
  "purdue fort wayne": "Purdue Fort Wayne",
  "purdue-fort wayne": "Purdue Fort Wayne",
  "ipfw": "Purdue Fort Wayne",
  "fort wayne": "Purdue Fort Wayne",
  "indiana-purdue-fort wayne": "Purdue Fort Wayne",

  // Robert Morris
  "robert morris": "Robert Morris",
  "robert morris colonials": "Robert Morris",
  rmu: "Robert Morris",

  // Wright St.
  "wright st.": "Wright St.",
  "wright state": "Wright St.",
  "wright state raiders": "Wright St.",
  "wright st": "Wright St.",
  raiders: "Wright St.",

  // Youngstown St.
  "youngstown st.": "Youngstown St.",
  "youngstown state": "Youngstown St.",
  "youngstown state penguins": "Youngstown St.",
  "youngstown st": "Youngstown St.",
  penguins: "Youngstown St.",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Ivy League (8 teams) ─────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Brown
  brown: "Brown",
  "brown bears": "Brown",

  // Columbia
  columbia: "Columbia",
  "columbia lions": "Columbia",

  // Cornell
  cornell: "Cornell",
  "cornell big red": "Cornell",
  "big red": "Cornell",

  // Dartmouth
  dartmouth: "Dartmouth",
  "dartmouth big green": "Dartmouth",
  "big green": "Dartmouth",

  // Harvard
  harvard: "Harvard",
  "harvard crimson": "Harvard",

  // Penn
  penn: "Penn",
  "penn quakers": "Penn",
  "pennsylvania": "Penn",
  quakers: "Penn",

  // Princeton
  princeton: "Princeton",
  "princeton tigers": "Princeton",

  // Yale
  yale: "Yale",
  "yale bulldogs": "Yale",

  // ═══════════════════════════════════════════════════════════════════
  // ─── MAAC (11 teams) ──────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Canisius
  canisius: "Canisius",
  "canisius golden griffins": "Canisius",

  // Fairfield
  fairfield: "Fairfield",
  "fairfield stags": "Fairfield",
  stags: "Fairfield",

  // Iona
  iona: "Iona",
  "iona gaels": "Iona",

  // Manhattan
  manhattan: "Manhattan",
  "manhattan jaspers": "Manhattan",
  jaspers: "Manhattan",

  // Marist
  marist: "Marist",
  "marist red foxes": "Marist",

  // Mount St. Mary's
  "mount st. mary's": "Mount St. Mary's",
  "mount st. marys": "Mount St. Mary's",
  "mount st mary's": "Mount St. Mary's",
  "mt. st. mary's": "Mount St. Mary's",
  "the mount": "Mount St. Mary's",

  // Niagara
  niagara: "Niagara",
  "niagara purple eagles": "Niagara",

  // Quinnipiac
  quinnipiac: "Quinnipiac",
  "quinnipiac bobcats": "Quinnipiac",

  // Rider
  rider: "Rider",
  "rider broncs": "Rider",

  // Sacred Heart
  "sacred heart": "Sacred Heart",
  "sacred heart pioneers": "Sacred Heart",

  // Saint Peter's
  "saint peter's": "Saint Peter's",
  "st. peter's": "Saint Peter's",
  "st peter's": "Saint Peter's",
  "saint peters": "Saint Peter's",
  peacocks: "Saint Peter's",

  // Siena
  siena: "Siena",
  "siena saints": "Siena",

  // ═══════════════════════════════════════════════════════════════════
  // ─── MEAC (8 teams) ───────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Coppin St.
  "coppin st.": "Coppin St.",
  "coppin state": "Coppin St.",
  "coppin state eagles": "Coppin St.",
  "coppin st": "Coppin St.",

  // Delaware St.
  "delaware st.": "Delaware St.",
  "delaware state": "Delaware St.",
  "delaware state hornets": "Delaware St.",
  "delaware st": "Delaware St.",

  // Howard
  howard: "Howard",
  "howard bison": "Howard",
  bison: "Howard",

  // Maryland Eastern Shore
  "maryland eastern shore": "Maryland Eastern Shore",
  "maryland-eastern shore": "Maryland Eastern Shore",
  umes: "Maryland Eastern Shore",

  // Morgan St.
  "morgan st.": "Morgan St.",
  "morgan state": "Morgan St.",
  "morgan state bears": "Morgan St.",
  "morgan st": "Morgan St.",

  // Norfolk St.
  "norfolk st.": "Norfolk St.",
  "norfolk state": "Norfolk St.",
  "norfolk state spartans": "Norfolk St.",
  "norfolk st": "Norfolk St.",

  // North Carolina Central
  "north carolina central": "North Carolina Central",
  "nc central": "North Carolina Central",
  nccu: "North Carolina Central",

  // South Carolina St.
  "south carolina st.": "South Carolina St.",
  "south carolina state": "South Carolina St.",
  "south carolina state bulldogs": "South Carolina St.",
  "south carolina st": "South Carolina St.",
  "sc state": "South Carolina St.",

  // ═══════════════════════════════════════════════════════════════════
  // ─── NEC (10 teams) ───────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Central Connecticut
  "central connecticut": "Central Connecticut",
  "central connecticut state": "Central Connecticut",
  "central connecticut st.": "Central Connecticut",
  ccsu: "Central Connecticut",

  // Chicago St.
  "chicago st.": "Chicago St.",
  "chicago state": "Chicago St.",
  "chicago state cougars": "Chicago St.",
  "chicago st": "Chicago St.",

  // Fairleigh Dickinson
  "fairleigh dickinson": "Fairleigh Dickinson",
  "fairleigh dickinson knights": "Fairleigh Dickinson",
  fdu: "Fairleigh Dickinson",

  // Le Moyne
  "le moyne": "Le Moyne",
  "le moyne dolphins": "Le Moyne",
  lemoyne: "Le Moyne",

  // LIU
  liu: "LIU",
  "long island university": "LIU",
  "long island": "LIU",
  "liu brooklyn": "LIU",

  // Mercyhurst
  mercyhurst: "Mercyhurst",
  "mercyhurst lakers": "Mercyhurst",

  // St. Francis NY / Saint Francis (Brooklyn)
  "st. francis ny": "St. Francis NY",
  "st. francis (ny)": "St. Francis NY",
  "st francis ny": "St. Francis NY",
  "st. francis brooklyn": "St. Francis NY",
  "saint francis brooklyn": "St. Francis NY",
  "st. francis (bkn)": "St. Francis NY",

  // Stonehill
  stonehill: "Stonehill",
  "stonehill skyhawks": "Stonehill",

  // Wagner
  wagner: "Wagner",
  "wagner seahawks": "Wagner",

  // ═══════════════════════════════════════════════════════════════════
  // ─── OVC / Ohio Valley (9 teams) ──────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Arkansas St. - already listed under Sun Belt

  // Eastern Illinois
  "eastern illinois": "Eastern Illinois",
  "eastern illinois panthers": "Eastern Illinois",
  eiu: "Eastern Illinois",

  // Lindenwood
  lindenwood: "Lindenwood",
  "lindenwood lions": "Lindenwood",

  // Little Rock
  "little rock": "Little Rock",
  "arkansas-little rock": "Little Rock",
  "arkansas little rock": "Little Rock",
  ualr: "Little Rock",

  // Morehead St.
  "morehead st.": "Morehead St.",
  "morehead state": "Morehead St.",
  "morehead state eagles": "Morehead St.",
  "morehead st": "Morehead St.",

  // SIU Edwardsville
  "siu edwardsville": "SIU Edwardsville",
  "southern illinois-edwardsville": "SIU Edwardsville",
  "southern illinois edwardsville": "SIU Edwardsville",
  siue: "SIU Edwardsville",

  // Southeast Missouri St.
  "southeast missouri st.": "Southeast Missouri St.",
  "southeast missouri state": "Southeast Missouri St.",
  "southeast missouri": "Southeast Missouri St.",
  "southeast missouri st": "Southeast Missouri St.",
  semo: "Southeast Missouri St.",

  // Tennessee St.
  "tennessee st.": "Tennessee St.",
  "tennessee state": "Tennessee St.",
  "tennessee state tigers": "Tennessee St.",
  "tennessee st": "Tennessee St.",

  // Tennessee Tech
  "tennessee tech": "Tennessee Tech",
  "tennessee tech golden eagles": "Tennessee Tech",
  ttu_tn: "Tennessee Tech",

  // UT Martin
  "tennessee martin": "Tennessee Martin",
  "ut martin": "Tennessee Martin",
  "ut-martin": "Tennessee Martin",
  "tennessee-martin": "Tennessee Martin",

  // Western Illinois
  "western illinois": "Western Illinois",
  "western illinois leathernecks": "Western Illinois",
  wiu: "Western Illinois",
  leathernecks: "Western Illinois",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Patriot League (10 teams) ────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // American
  american: "American",
  "american university": "American",
  "american eagles": "American",

  // Army
  army: "Army",
  "army black knights": "Army",
  "army west point": "Army",
  "black knights": "Army",

  // Boston University
  "boston university": "Boston University",
  "boston university terriers": "Boston University",
  bu: "Boston University",
  terriers: "Boston University",

  // Bucknell
  bucknell: "Bucknell",
  "bucknell bison": "Bucknell",

  // Colgate
  colgate: "Colgate",
  "colgate raiders": "Colgate",

  // Holy Cross
  "holy cross": "Holy Cross",
  "holy cross crusaders": "Holy Cross",
  crusaders: "Holy Cross",

  // Lafayette
  lafayette: "Lafayette",
  "lafayette leopards": "Lafayette",
  leopards: "Lafayette",

  // Lehigh
  lehigh: "Lehigh",
  "lehigh mountain hawks": "Lehigh",

  // Loyola MD
  "loyola md": "Loyola MD",
  "loyola (md)": "Loyola MD",
  "loyola maryland": "Loyola MD",
  "loyola-maryland": "Loyola MD",

  // Navy
  navy: "Navy",
  "navy midshipmen": "Navy",
  midshipmen: "Navy",

  // ═══════════════════════════════════════════════════════════════════
  // ─── SoCon / Southern Conference (12 teams) ───────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Chattanooga
  chattanooga: "Chattanooga",
  "chattanooga mocs": "Chattanooga",
  "ut chattanooga": "Chattanooga",
  utc: "Chattanooga",
  mocs: "Chattanooga",

  // ETSU / East Tennessee St.
  "east tennessee st.": "East Tennessee St.",
  "east tennessee state": "East Tennessee St.",
  etsu: "East Tennessee St.",
  "east tennessee st": "East Tennessee St.",

  // Furman
  furman: "Furman",
  "furman paladins": "Furman",
  paladins: "Furman",

  // Mercer
  mercer: "Mercer",
  "mercer bears": "Mercer",

  // Samford
  samford: "Samford",
  "samford bulldogs": "Samford",

  // The Citadel
  "the citadel": "The Citadel",
  citadel: "The Citadel",
  "citadel bulldogs": "The Citadel",

  // UNC Greensboro
  "unc greensboro": "UNC Greensboro",
  "north carolina-greensboro": "UNC Greensboro",
  "unc-greensboro": "UNC Greensboro",
  uncg: "UNC Greensboro",

  // VMI
  vmi: "VMI",
  "virginia military": "VMI",
  "virginia military institute": "VMI",
  "vmi keydets": "VMI",
  keydets: "VMI",

  // Western Carolina
  "western carolina": "Western Carolina",
  "western carolina catamounts": "Western Carolina",
  wcu: "Western Carolina",

  // Wofford
  wofford: "Wofford",
  "wofford terriers": "Wofford",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Southland Conference (9 teams) ───────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Houston Christian (formerly Houston Baptist)
  "houston christian": "Houston Christian",
  "houston baptist": "Houston Christian",
  hbu: "Houston Christian",

  // Incarnate Word
  "incarnate word": "Incarnate Word",
  "incarnate word cardinals": "Incarnate Word",
  uiw: "Incarnate Word",

  // Lamar
  lamar: "Lamar",
  "lamar cardinals": "Lamar",

  // McNeese
  mcneese: "McNeese",
  "mcneese state": "McNeese",
  "mcneese cowboys": "McNeese",
  "mcneese st": "McNeese",

  // Nicholls
  nicholls: "Nicholls",
  "nicholls state": "Nicholls",
  "nicholls colonels": "Nicholls",
  "nicholls st": "Nicholls",

  // Northwestern St.
  "northwestern st.": "Northwestern St.",
  "northwestern state": "Northwestern St.",
  "northwestern state demons": "Northwestern St.",
  "northwestern st": "Northwestern St.",
  "northwestern la": "Northwestern St.",

  // Southeastern Louisiana
  "southeastern louisiana": "Southeastern Louisiana",
  "southeastern louisiana lions": "Southeastern Louisiana",
  "se louisiana": "Southeastern Louisiana",

  // Texas A&M Corpus Christi
  "texas a&m corpus chris": "Texas A&M Corpus Chris",
  "texas a&m-corpus christi": "Texas A&M Corpus Chris",
  "texas a&m corpus christi": "Texas A&M Corpus Chris",
  "texas am corpus christi": "Texas A&M Corpus Chris",
  tamucc: "Texas A&M Corpus Chris",

  // ═══════════════════════════════════════════════════════════════════
  // ─── SWAC (12 teams) ──────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Alabama A&M
  "alabama a&m": "Alabama A&M",
  "alabama am": "Alabama A&M",
  "alabama a&m bulldogs": "Alabama A&M",
  aamu: "Alabama A&M",

  // Alabama St.
  "alabama st.": "Alabama St.",
  "alabama state": "Alabama St.",
  "alabama state hornets": "Alabama St.",
  "alabama st": "Alabama St.",

  // Alcorn St.
  "alcorn st.": "Alcorn St.",
  "alcorn state": "Alcorn St.",
  "alcorn state braves": "Alcorn St.",
  "alcorn st": "Alcorn St.",
  alcorn: "Alcorn St.",

  // Bethune-Cookman
  "bethune-cookman": "Bethune Cookman",
  "bethune cookman": "Bethune Cookman",
  "bethune-cookman wildcats": "Bethune Cookman",
  "b-cu": "Bethune Cookman",

  // Florida A&M
  "florida a&m": "Florida A&M",
  "florida am": "Florida A&M",
  "florida a&m rattlers": "Florida A&M",
  famu: "Florida A&M",
  rattlers: "Florida A&M",

  // Grambling St.
  "grambling st.": "Grambling St.",
  "grambling state": "Grambling St.",
  grambling: "Grambling St.",
  "grambling st": "Grambling St.",

  // Jackson St.
  "jackson st.": "Jackson St.",
  "jackson state": "Jackson St.",
  "jackson state tigers": "Jackson St.",
  "jackson st": "Jackson St.",

  // Mississippi Valley St.
  "mississippi valley st.": "Mississippi Valley St.",
  "mississippi valley state": "Mississippi Valley St.",
  "mississippi valley st": "Mississippi Valley St.",
  "miss valley st.": "Mississippi Valley St.",
  mvsu: "Mississippi Valley St.",

  // Prairie View A&M
  "prairie view a&m": "Prairie View A&M",
  "prairie view": "Prairie View A&M",
  "prairie view a&m panthers": "Prairie View A&M",
  pvamu: "Prairie View A&M",

  // Southern
  southern: "Southern",
  "southern university": "Southern",
  "southern jaguars": "Southern",
  "southern u.": "Southern",

  // Texas Southern
  "texas southern": "Texas Southern",
  "texas southern tigers": "Texas Southern",
  txso: "Texas Southern",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Summit League (9 teams) ──────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Denver
  denver: "Denver",
  "denver pioneers": "Denver",

  // Kansas City
  "kansas city": "Kansas City",
  "umkc": "Kansas City",
  "missouri-kansas city": "Kansas City",
  "kansas city roos": "Kansas City",

  // Nebraska Omaha
  "nebraska omaha": "Nebraska Omaha",
  "omaha": "Nebraska Omaha",
  "nebraska-omaha": "Nebraska Omaha",
  "uno": "Nebraska Omaha",

  // North Dakota
  "north dakota": "North Dakota",
  "north dakota fighting hawks": "North Dakota",
  und: "North Dakota",

  // North Dakota St.
  "north dakota st.": "North Dakota St.",
  "north dakota state": "North Dakota St.",
  "north dakota state bison": "North Dakota St.",
  "north dakota st": "North Dakota St.",
  ndsu: "North Dakota St.",

  // Oral Roberts
  "oral roberts": "Oral Roberts",
  "oral roberts golden eagles": "Oral Roberts",
  oru: "Oral Roberts",

  // South Dakota
  "south dakota": "South Dakota",
  "south dakota coyotes": "South Dakota",

  // South Dakota St.
  "south dakota st.": "South Dakota St.",
  "south dakota state": "South Dakota St.",
  "south dakota state jackrabbits": "South Dakota St.",
  "south dakota st": "South Dakota St.",
  sdsu_sd: "South Dakota St.",
  jackrabbits: "South Dakota St.",

  // St. Thomas
  "st. thomas": "St. Thomas",
  "st thomas": "St. Thomas",
  "saint thomas": "St. Thomas",
  "st. thomas mn": "St. Thomas",

  // Western Illinois - already listed under OVC

  // ═══════════════════════════════════════════════════════════════════
  // ─── WAC (8 teams) ────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Abilene Christian
  "abilene christian": "Abilene Christian",
  "abilene christian wildcats": "Abilene Christian",
  acu: "Abilene Christian",

  // Grand Canyon
  "grand canyon": "Grand Canyon",
  "grand canyon antelopes": "Grand Canyon",
  gcu: "Grand Canyon",

  // Seattle
  seattle: "Seattle",
  "seattle redhawks": "Seattle",
  "seattle university": "Seattle",

  // Southern Utah
  "southern utah": "Southern Utah",
  "southern utah thunderbirds": "Southern Utah",
  suu: "Southern Utah",

  // Stephen F. Austin
  "stephen f. austin": "Stephen F. Austin",
  "stephen f austin": "Stephen F. Austin",
  "sfa": "Stephen F. Austin",
  "sfa lumberjacks": "Stephen F. Austin",

  // Tarleton St.
  "tarleton st.": "Tarleton St.",
  "tarleton state": "Tarleton St.",
  "tarleton st": "Tarleton St.",
  tarleton: "Tarleton St.",

  // UT Arlington
  "ut arlington": "UT Arlington",
  "texas-arlington": "UT Arlington",
  "texas arlington": "UT Arlington",
  uta: "UT Arlington",
  "ut-arlington": "UT Arlington",

  // Utah Valley
  "utah valley": "Utah Valley",
  "utah valley wolverines": "Utah Valley",
  uvu: "Utah Valley",

  // UT Rio Grande Valley
  "ut rio grande valley": "UT Rio Grande Valley",
  "texas-rio grande valley": "UT Rio Grande Valley",
  "texas rio grande valley": "UT Rio Grande Valley",
  utrgv: "UT Rio Grande Valley",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Patriot already covered above ────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════
  // ─── Northeast Conference (NEC) — remaining teams ─────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Already listed most NEC teams above. Adding remaining:

  // ═══════════════════════════════════════════════════════════════════
  // ─── Patriot already covered above ────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════
  // ─── Additional teams by conference ───────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // --- Independents ---
  "north alabama": "North Alabama",

  // --- Additional schools not yet covered ---

  // Saint Francis (PA)
  "saint francis": "Saint Francis",
  "saint francis (pa)": "Saint Francis",
  "saint francis pa": "Saint Francis",
  "st. francis (pa)": "Saint Francis",
  "st. francis pa": "Saint Francis",
  "st francis pa": "Saint Francis",

  // Niagara - already listed under MAAC

  // Siena - already listed under MAAC

  // ═══════════════════════════════════════════════════════════════════
  // ─── Mid-Major / Additional D-I teams ─────────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Belmont - already listed under MVC

  // ─── Additional smaller conference teams ───────────────────────────

  // Colgate - already under Patriot

  // Hampton - already under CAA

  // High Point - already under ASUN

  // Iona - already under MAAC

  // Lipscomb - already under ASUN

  // Marist - already under MAAC

  // Rider - already under MAAC

  // Siena - already under MAAC

  // ═══════════════════════════════════════════════════════════════════
  // ─── Additional A-Sun / Horizon / etc. teams not yet listed ───────
  // ═══════════════════════════════════════════════════════════════════

  // ─── ASUN additional ───
  // Eastern Kentucky - already listed

  // ─── Horizon additional ───

  // ─── Summit additional ───

  // ═══════════════════════════════════════════════════════════════════
  // ─── Remaining D-I teams (alphabetical) ───────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Cal Baptist
  "cal baptist": "Cal Baptist",
  "california baptist": "Cal Baptist",
  "cal baptist lancers": "Cal Baptist",
  cbu: "Cal Baptist",

  // Central Connecticut - already listed

  // Colgate - already listed

  // Coppin St. - already listed

  // Delaware St. - already listed

  // DePaul - already listed

  // East Tennessee St. - already listed

  // Fairfield - already listed

  // Fairleigh Dickinson - already listed

  // Gardner-Webb - already listed

  // Grand Canyon - already listed

  // Hampton - already listed

  // High Point - already listed

  // Iona - already listed

  // Lipscomb - already listed

  // Loyola Marymount - already listed

  // Marist - already listed

  // Mount St. Mary's - already listed

  // Niagara - already listed

  // NJIT - already listed

  // North Florida - already listed

  // Rider - already listed

  // Sacred Heart - already listed

  // Siena - already listed

  // Stonehill - already listed

  // Wagner - already listed

  // Winthrop - already listed

  // ═══════════════════════════════════════════════════════════════════
  // ─── Defunct / Reclassified programs (2005-2025 data) ─────────────
  // ═══════════════════════════════════════════════════════════════════

  // Birmingham-Southern (closed 2024)
  "birmingham-southern": "Birmingham Southern",
  "birmingham southern": "Birmingham Southern",

  // Centenary (LA) (reclassified D-III 2011)
  "centenary (la)": "Centenary",
  "centenary": "Centenary",
  "centenary gentlemen": "Centenary",

  // Hartford (reclassified D-III 2025)
  // Already listed above

  // Savannah State (reclassified D-II 2020)
  "savannah state": "Savannah St.",
  "savannah st.": "Savannah St.",
  "savannah st": "Savannah St.",

  // Winston-Salem State (moved between conferences)
  "winston-salem": "Winston Salem St.",
  "winston salem": "Winston Salem St.",
  "winston-salem state": "Winston Salem St.",
  "winston salem state": "Winston Salem St.",
  "winston salem st.": "Winston Salem St.",
  "winston salem st": "Winston Salem St.",

  // IPFW → Purdue Fort Wayne (already listed)

  // ═══════════════════════════════════════════════════════════════════
  // ─── Remaining smaller conference teams ───────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // ─── Patriot League additional ───

  // ─── MEAC additional ───

  // ─── Big South additional ───

  // ─── NEC additional ───

  // ─── OVC additional ───

  // ─── Southland additional ───

  // ─── SWAC additional ───

  // ─── WAC additional ───

  // ─── Summit additional ───

  // ═══════════════════════════════════════════════════════════════════
  // ─── Full remaining teams alphabetically ──────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Alcorn St. - already listed

  // App State - already listed

  // Ark.-Pine Bluff
  "arkansas pine bluff": "Arkansas Pine Bluff",
  "arkansas-pine bluff": "Arkansas Pine Bluff",
  "ark.-pine bluff": "Arkansas Pine Bluff",
  uapb: "Arkansas Pine Bluff",

  // Cal St. Fullerton - already listed

  // Cent. Conn. St. - already listed

  // Central Michigan - already listed

  // Chattanooga - already listed

  // Chicago St. - already listed

  // Citadel - already listed

  // Clemson - already listed

  // Coastal Carolina - already listed

  // Colgate - already listed

  // College of Charleston → Charleston - already listed

  // Coppin St. - already listed

  // Davidson - already listed

  // Dayton - already listed

  // Drexel - already listed

  // East Carolina - already listed

  // Eastern Illinois - already listed

  // Eastern Kentucky - already listed

  // Eastern Washington - already listed

  // Elon - already listed

  // Evansville - already listed

  // Fairfield - already listed

  // Fairleigh Dickinson - already listed

  // Florida A&M - already listed

  // Florida Atlantic - already listed

  // Florida Gulf Coast - already listed

  // Fordham - already listed

  // Furman - already listed

  // Gardner-Webb - already listed

  // George Mason - already listed

  // George Washington - already listed

  // Georgia Southern - already listed

  // Georgia St. - already listed

  // Gonzaga - already listed

  // Grand Canyon - already listed

  // Hampton - already listed

  // Hartford - already listed

  // Harvard - already listed

  // High Point - already listed

  // Hofstra - already listed

  // Holy Cross - already listed

  // Iona - already listed

  // Idaho - already listed

  // Idaho St. - already listed

  // James Madison - already listed

  // Jacksonville - already listed

  // Jacksonville St. - already listed

  // Kent St. - already listed

  // Kennesaw St. - already listed

  // La Salle - already listed

  // Lafayette - already listed

  // Lamar - already listed

  // Le Moyne - already listed

  // Lehigh - already listed

  // Liberty - already listed

  // Lindenwood - already listed

  // Lipscomb - already listed

  // LIU - already listed

  // Long Beach St. - already listed

  // Longwood - already listed

  // Loyola Marymount - already listed

  // Marist - already listed

  // Marshall - already listed

  // McNeese - already listed

  // Memphis - already listed

  // Mercer - already listed

  // Mercyhurst - already listed

  // Miami OH - already listed

  // Middle Tennessee - already listed

  // Milwaukee - already listed

  // Monmouth - already listed

  // Montana - already listed

  // Montana St. - already listed

  // Morehead St. - already listed

  // Morgan St. - already listed

  // Mount St. Mary's - already listed

  // Murray St. - already listed

  // Navy - already listed

  // New Hampshire - already listed

  // New Mexico - already listed

  // New Mexico St. - already listed

  // Niagara - already listed

  // NJIT - already listed

  // Norfolk St. - already listed

  // North Alabama - already listed

  // North Carolina A&T
  "north carolina a&t": "North Carolina A&T",
  "nc a&t": "North Carolina A&T",
  "nc at": "North Carolina A&T",
  "north carolina at": "North Carolina A&T",

  // North Carolina Central - already listed

  // North Dakota - already listed

  // North Dakota St. - already listed

  // North Florida - already listed

  // Northern Arizona - already listed

  // Northern Colorado - already listed

  // Northern Illinois - already listed

  // Northern Kentucky - already listed

  // Northeastern - already listed

  // Northwestern St. - already listed

  // Oakland - already listed

  // Ohio - already listed

  // Old Dominion - already listed

  // Oral Roberts - already listed

  // Pacific - already listed

  // Pepperdine - already listed

  // Portland - already listed

  // Portland St. - already listed

  // Presbyterian - already listed

  // Princeton - already listed

  // Queens - already listed

  // Quinnipiac - already listed

  // Radford - already listed

  // Rhode Island - already listed

  // Rice - already listed

  // Richmond - already listed

  // Rider - already listed

  // Robert Morris - already listed

  // Sacred Heart - already listed

  // Sacramento St. - already listed

  // Saint Bonaventure - already listed

  // Saint Francis (PA) - already listed

  // Saint Joseph's - already listed

  // Saint Louis - already listed

  // Saint Mary's - already listed

  // Saint Peter's - already listed

  // Sam Houston St. - already listed

  // Samford - already listed

  // San Diego - already listed

  // San Diego St. - already listed

  // San Francisco - already listed

  // San Jose St. - already listed

  // Santa Clara - already listed

  // Seattle - already listed

  // Seton Hall - already listed

  // Siena - already listed

  // SIU Edwardsville - already listed

  // South Alabama - already listed

  // South Carolina St. - already listed

  // South Dakota - already listed

  // South Dakota St. - already listed

  // South Florida - already listed

  // Southeast Missouri St. - already listed

  // Southeastern Louisiana - already listed

  // Southern - already listed

  // Southern Illinois - already listed

  // Southern Miss - already listed

  // Southern Utah - already listed

  // St. Francis NY - already listed

  // St. Thomas - already listed

  // Stephen F. Austin - already listed

  // Stetson - already listed

  // Stonehill - already listed

  // Stony Brook - already listed

  // Tarleton St. - already listed

  // Temple - already listed

  // Tennessee Martin - already listed

  // Tennessee St. - already listed

  // Tennessee Tech - already listed

  // Texas A&M Corpus Chris - already listed

  // Texas Southern - already listed

  // Texas St. - already listed

  // The Citadel - already listed

  // Toledo - already listed

  // Towson - already listed

  // Troy - already listed

  // Tulane - already listed

  // Tulsa - already listed

  // UAB - already listed

  // UC Davis - already listed

  // UC Irvine - already listed

  // UC Riverside - already listed

  // UC San Diego - already listed

  // UC Santa Barbara - already listed

  // UMass Lowell - already listed

  // UMBC - already listed

  // UNC Asheville - already listed

  // UNC Greensboro - already listed

  // UNC Wilmington - already listed

  // UT Arlington - already listed

  // UT Martin → Tennessee Martin - already listed

  // UT Rio Grande Valley - already listed

  // Utah Valley - already listed

  // UTEP - already listed

  // UTSA - already listed

  // Valparaiso - already listed

  // Vermont - already listed

  // VMI - already listed

  // Wagner - already listed

  // Weber St. - already listed

  // Western Carolina - already listed

  // Western Illinois - already listed

  // Western Kentucky - already listed

  // Western Michigan - already listed

  // Wichita St. - already listed

  // William & Mary - already listed

  // Winthrop - already listed

  // Wofford - already listed

  // Wright St. - already listed

  // Wyoming - already listed

  // Xavier - already listed

  // Yale - already listed

  // Youngstown St. - already listed

  // ═══════════════════════════════════════════════════════════════════
  // ─── Additional team variants / abbreviations ─────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Additional abbreviations for popular teams
  "gonzaga university": "Gonzaga",
  "duke university": "Duke",
  "villanova university": "Villanova",
  "creighton university": "Creighton",
  "gonzaga bulldogs": "Gonzaga",
  "kentucky wildcats_bb": "Kentucky",

  // Miami disambiguation
  miami: "Miami FL", // default Miami = FL (the bigger program)

  // Additional common variants
  "boise state broncos_bb": "Boise St.",
  "san diego state aztecs_bb": "San Diego St.",

  // Wichita State additional
  wichita: "Wichita St.",

  // Additional "State" → "St." pattern teams not yet covered
  // (The bulk are already covered above)

  // UConn variants
  "connecticut huskies_bb": "Connecticut",

  // Common search terms
  "tar heel": "North Carolina",
  "the citadel bulldogs": "The Citadel",
  "terrapins_bb": "Maryland",

  // Additional Hawaiian variant
  "hawai'i": "Hawaii",
  "hawai'i rainbow warriors": "Hawaii",

  // ─── Additional auto-match "State" → "St." teams ─────────────────
  // These follow the pattern where SR uses "State" and KP uses "St."
  // Most are already listed. Adding any remaining:

  // Alcorn - already listed
  // Appalachian - already listed
  // Arkansas - already listed
  // Ball - already listed
  // Boise - already listed
  // Cleveland - already listed
  // Colorado - already listed
  // Coppin - already listed
  // Delaware - already listed
  // Fresno - already listed
  // Georgia - already listed
  // Idaho - already listed
  // Illinois - already listed
  // Indiana - already listed
  // Iowa - already listed
  // Jackson - already listed
  // Jacksonville - already listed
  // Kansas - already listed
  // Kennesaw - already listed
  // Kent - already listed
  // Long Beach - already listed
  // Michigan - already listed
  // Mississippi - already listed
  // Mississippi Valley - already listed
  // Missouri - already listed
  // Montana - already listed
  // Morehead - already listed
  // Morgan - already listed
  // Murray - already listed
  // New Mexico - already listed
  // Norfolk - already listed
  // North Dakota - already listed
  // Northwestern - already listed
  // Ohio - already listed
  // Oklahoma - already listed
  // Oregon - already listed
  // Penn - already listed
  // Portland - already listed
  // Sacramento - already listed
  // Sam Houston - already listed
  // San Diego - already listed
  // San Jose - already listed
  // South Carolina - already listed
  // South Dakota - already listed
  // Southeast Missouri - already listed
  // Tarleton - already listed
  // Tennessee - already listed
  // Texas - already listed
  // Utah - already listed
  // Washington - already listed
  // Weber - already listed
  // Wichita - already listed
  // Wright - already listed
  // Youngstown - already listed

  // NC A&T additional
  "n.c. a&t": "North Carolina A&T",

  // Additional non-obvious mappings
  "unc charlotte": "Charlotte",
  "nc charlotte": "Charlotte",
  "uncc": "Charlotte",

  // Loyola MD vs Loyola Chicago clarification
  "loyola": "Loyola Chicago", // Default to the more prominent program

  // Incarnate Word
  "uiw cardinals": "Incarnate Word",

  // San Jose additional
  "san josé state": "San Jose St.",
  "san josé st.": "San Jose St.",

  // Hawaii alternate
  "hawai'i rainbow warriors_bb": "Hawaii",

  // ─── Additional smaller programs ──────────────────────────────────

  // Dixie State → Utah Tech (name change 2022)
  "utah tech": "Utah Tech",
  "dixie state": "Utah Tech",
  "dixie st": "Utah Tech",
  "dixie st.": "Utah Tech",
  "utah tech trailblazers": "Utah Tech",

  // SIU Edwardsville variants
  "siue cougars": "SIU Edwardsville",

  // Mississippi Valley State additional
  "mvsu delta devils": "Mississippi Valley St.",
  "delta devils": "Mississippi Valley St.",

  // Alabama State additional
  "bama state": "Alabama St.",

  // Grambling State additional
  "grambling tigers": "Grambling St.",

  // Prairie View additional
  "prairie view panthers": "Prairie View A&M",

  // Jackson State additional
  "jackson state_bb": "Jackson St.",

  // Southern University additional
  "southern u": "Southern",

  // Texas Southern additional
  "tsu": "Texas Southern",

  // Florida A&M additional
  "famu rattlers": "Florida A&M",

  // Bethune-Cookman additional
  "bethune-cookman wildcats_bb": "Bethune Cookman",

  // Norfolk State additional
  "norfolk spartans": "Norfolk St.",

  // North Carolina Central additional
  "nccu eagles": "North Carolina Central",

  // South Carolina State additional
  "sc state bulldogs": "South Carolina St.",

  // Winston-Salem additional
  "wssu": "Winston Salem St.",
  "wssu rams": "Winston Salem St.",

  // ═══════════════════════════════════════════════════════════════════
  // ─── Common Abbreviations for major programs ──────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Extra common abbreviations/nicknames for popular CBB programs
  unk: "Kentucky", // less common but used
  "big blue nation": "Kentucky",
};

/**
 * Sports Reference CBB slug → canonical (KenPom) team name.
 * Slugs match the URL format: https://www.sports-reference.com/cbb/schools/{slug}/
 *
 * Comprehensive list of all D-I programs that appear in SR CBB data (2005-2025).
 */
export const ncaambSlugToCanonical: Record<string, string> = {
  // ─── ACC ───
  "boston-college": "Boston College",
  california: "California",
  clemson: "Clemson",
  duke: "Duke",
  "florida-state": "Florida St.",
  "georgia-tech": "Georgia Tech",
  louisville: "Louisville",
  "miami-fl": "Miami FL",
  "north-carolina": "North Carolina",
  "north-carolina-state": "N.C. State",
  "notre-dame": "Notre Dame",
  pittsburgh: "Pittsburgh",
  "southern-methodist": "SMU",
  stanford: "Stanford",
  syracuse: "Syracuse",
  virginia: "Virginia",
  "virginia-tech": "Virginia Tech",
  "wake-forest": "Wake Forest",

  // ─── Big East ───
  butler: "Butler",
  connecticut: "Connecticut",
  creighton: "Creighton",
  depaul: "DePaul",
  georgetown: "Georgetown",
  marquette: "Marquette",
  providence: "Providence",
  "seton-hall": "Seton Hall",
  "st-johns-ny": "St. John's",
  villanova: "Villanova",
  xavier: "Xavier",

  // ─── Big Ten ───
  illinois: "Illinois",
  indiana: "Indiana",
  iowa: "Iowa",
  maryland: "Maryland",
  michigan: "Michigan",
  "michigan-state": "Michigan St.",
  minnesota: "Minnesota",
  nebraska: "Nebraska",
  northwestern: "Northwestern",
  "ohio-state": "Ohio St.",
  oregon: "Oregon",
  "penn-state": "Penn St.",
  purdue: "Purdue",
  rutgers: "Rutgers",
  ucla: "UCLA",
  "southern-california": "USC",
  washington: "Washington",
  wisconsin: "Wisconsin",

  // ─── Big 12 ───
  arizona: "Arizona",
  "arizona-state": "Arizona St.",
  baylor: "Baylor",
  "brigham-young": "BYU",
  "central-florida": "UCF",
  cincinnati: "Cincinnati",
  colorado: "Colorado",
  houston: "Houston",
  "iowa-state": "Iowa St.",
  kansas: "Kansas",
  "kansas-state": "Kansas St.",
  "oklahoma-state": "Oklahoma St.",
  "texas-christian": "TCU",
  "texas-tech": "Texas Tech",
  utah: "Utah",
  "west-virginia": "West Virginia",

  // ─── SEC ───
  alabama: "Alabama",
  arkansas: "Arkansas",
  auburn: "Auburn",
  florida: "Florida",
  georgia: "Georgia",
  kentucky: "Kentucky",
  "louisiana-state": "LSU",
  mississippi: "Mississippi",
  "mississippi-state": "Mississippi St.",
  missouri: "Missouri",
  oklahoma: "Oklahoma",
  "south-carolina": "South Carolina",
  tennessee: "Tennessee",
  texas: "Texas",
  "texas-am": "Texas A&M",
  vanderbilt: "Vanderbilt",

  // ─── Pac-12 (remaining) ───
  "oregon-state": "Oregon St.",
  "washington-state": "Washington St.",

  // ─── AAC ───
  charlotte: "Charlotte",
  "east-carolina": "East Carolina",
  "florida-atlantic": "Florida Atlantic",
  memphis: "Memphis",
  "north-texas": "North Texas",
  rice: "Rice",
  "south-florida": "South Florida",
  temple: "Temple",
  tulane: "Tulane",
  tulsa: "Tulsa",
  "alabama-birmingham": "UAB",
  "texas-san-antonio": "UTSA",
  "wichita-state": "Wichita St.",

  // ─── Mountain West ───
  "air-force": "Air Force",
  "boise-state": "Boise St.",
  "colorado-state": "Colorado St.",
  "fresno-state": "Fresno St.",
  nevada: "Nevada",
  "new-mexico": "New Mexico",
  "san-diego-state": "San Diego St.",
  "san-jose-state": "San Jose St.",
  "nevada-las-vegas": "UNLV",
  "utah-state": "Utah St.",
  wyoming: "Wyoming",
  hawaii: "Hawaii",

  // ─── Sun Belt ───
  "appalachian-state": "Appalachian St.",
  "arkansas-state": "Arkansas St.",
  "coastal-carolina": "Coastal Carolina",
  "georgia-southern": "Georgia Southern",
  "georgia-state": "Georgia St.",
  "james-madison": "James Madison",
  "louisiana-lafayette": "Louisiana",
  "louisiana-monroe": "Louisiana Monroe",
  marshall: "Marshall",
  "old-dominion": "Old Dominion",
  "south-alabama": "South Alabama",
  "southern-mississippi": "Southern Miss",
  "texas-state": "Texas St.",
  troy: "Troy",

  // ─── Conference USA ───
  "florida-international": "FIU",
  "jacksonville-state": "Jacksonville St.",
  "kennesaw-state": "Kennesaw St.",
  liberty: "Liberty",
  "louisiana-tech": "Louisiana Tech",
  "middle-tennessee-state": "Middle Tennessee",
  "new-mexico-state": "New Mexico St.",
  "sam-houston-state": "Sam Houston St.",
  "texas-el-paso": "UTEP",
  "western-kentucky": "Western Kentucky",

  // ─── MAC ───
  akron: "Akron",
  "ball-state": "Ball St.",
  "bowling-green-state": "Bowling Green",
  buffalo: "Buffalo",
  "central-michigan": "Central Michigan",
  "eastern-michigan": "Eastern Michigan",
  "kent-state": "Kent St.",
  "miami-oh": "Miami OH",
  "northern-illinois": "Northern Illinois",
  ohio: "Ohio",
  toledo: "Toledo",
  "western-michigan": "Western Michigan",

  // ─── WCC ───
  gonzaga: "Gonzaga",
  "loyola-marymount": "Loyola Marymount",
  pacific: "Pacific",
  pepperdine: "Pepperdine",
  portland: "Portland",
  "saint-marys-ca": "Saint Mary's",
  "san-diego": "San Diego",
  "san-francisco": "San Francisco",
  "santa-clara": "Santa Clara",

  // ─── MVC ───
  belmont: "Belmont",
  bradley: "Bradley",
  drake: "Drake",
  evansville: "Evansville",
  "illinois-state": "Illinois St.",
  "indiana-state": "Indiana St.",
  "missouri-state": "Missouri St.",
  "murray-state": "Murray St.",
  "northern-iowa": "Northern Iowa",
  "southern-illinois": "Southern Illinois",
  "illinois-chicago": "Illinois Chicago",
  valparaiso: "Valparaiso",

  // ─── A-10 ───
  davidson: "Davidson",
  dayton: "Dayton",
  duquesne: "Duquesne",
  fordham: "Fordham",
  "george-mason": "George Mason",
  "george-washington": "George Washington",
  "la-salle": "La Salle",
  "loyola-il": "Loyola Chicago",
  massachusetts: "Massachusetts",
  "rhode-island": "Rhode Island",
  richmond: "Richmond",
  "st-bonaventure": "Saint Bonaventure",
  "saint-josephs": "Saint Joseph's",
  "saint-louis": "Saint Louis",
  "virginia-commonwealth": "VCU",

  // ─── CAA ───
  campbell: "Campbell",
  "college-of-charleston": "Charleston",
  delaware: "Delaware",
  drexel: "Drexel",
  elon: "Elon",
  hampton: "Hampton",
  hofstra: "Hofstra",
  monmouth: "Monmouth",
  "north-carolina-wilmington": "UNC Wilmington",
  northeastern: "Northeastern",
  "stony-brook": "Stony Brook",
  towson: "Towson",
  "william-mary": "William & Mary",

  // ─── America East ───
  "albany-ny": "Albany",
  binghamton: "Binghamton",
  bryant: "Bryant",
  maine: "Maine",
  "new-hampshire": "New Hampshire",
  njit: "NJIT",
  "maryland-baltimore-county": "UMBC",
  "massachusetts-lowell": "UMass Lowell",
  vermont: "Vermont",
  hartford: "Hartford",

  // ─── ASUN ───
  "austin-peay": "Austin Peay",
  bellarmine: "Bellarmine",
  "central-arkansas": "Central Arkansas",
  "eastern-kentucky": "Eastern Kentucky",
  "florida-gulf-coast": "Florida Gulf Coast",
  "high-point": "High Point",
  jacksonville: "Jacksonville",
  lipscomb: "Lipscomb",
  "north-alabama": "North Alabama",
  "north-florida": "North Florida",
  queens: "Queens",
  stetson: "Stetson",

  // ─── Big Sky ───
  "eastern-washington": "Eastern Washington",
  idaho: "Idaho",
  "idaho-state": "Idaho St.",
  montana: "Montana",
  "montana-state": "Montana St.",
  "northern-arizona": "Northern Arizona",
  "northern-colorado": "Northern Colorado",
  "portland-state": "Portland St.",
  "sacramento-state": "Sacramento St.",
  "weber-state": "Weber St.",

  // ─── Big South ───
  "charleston-southern": "Charleston Southern",
  "gardner-webb": "Gardner Webb",
  longwood: "Longwood",
  presbyterian: "Presbyterian",
  radford: "Radford",
  "north-carolina-asheville": "UNC Asheville",
  "south-carolina-upstate": "USC Upstate",
  winthrop: "Winthrop",

  // ─── Big West ───
  "cal-poly": "Cal Poly",
  "cal-state-bakersfield": "Cal St. Bakersfield",
  "cal-state-fullerton": "Cal St. Fullerton",
  "cal-state-northridge": "CSUN",
  "long-beach-state": "Long Beach St.",
  "uc-davis": "UC Davis",
  "uc-irvine": "UC Irvine",
  "uc-riverside": "UC Riverside",
  "uc-san-diego": "UC San Diego",
  "uc-santa-barbara": "UC Santa Barbara",

  // ─── Horizon ───
  "cleveland-state": "Cleveland St.",
  "detroit-mercy": "Detroit Mercy",
  "green-bay": "Green Bay",
  "iupui": "IU Indy",
  "indiana-purdue-fort-wayne": "Purdue Fort Wayne",
  milwaukee: "Milwaukee",
  "northern-kentucky": "Northern Kentucky",
  oakland: "Oakland",
  "robert-morris": "Robert Morris",
  "wright-state": "Wright St.",
  "youngstown-state": "Youngstown St.",

  // ─── Ivy League ───
  brown: "Brown",
  columbia: "Columbia",
  cornell: "Cornell",
  dartmouth: "Dartmouth",
  harvard: "Harvard",
  pennsylvania: "Penn",
  princeton: "Princeton",
  yale: "Yale",

  // ─── MAAC ───
  canisius: "Canisius",
  fairfield: "Fairfield",
  iona: "Iona",
  manhattan: "Manhattan",
  marist: "Marist",
  "mount-st-marys": "Mount St. Mary's",
  niagara: "Niagara",
  quinnipiac: "Quinnipiac",
  rider: "Rider",
  "sacred-heart": "Sacred Heart",
  "saint-peters": "Saint Peter's",
  siena: "Siena",

  // ─── MEAC ───
  "coppin-state": "Coppin St.",
  "delaware-state": "Delaware St.",
  howard: "Howard",
  "maryland-eastern-shore": "Maryland Eastern Shore",
  "morgan-state": "Morgan St.",
  "norfolk-state": "Norfolk St.",
  "north-carolina-central": "North Carolina Central",
  "south-carolina-state": "South Carolina St.",

  // ─── NEC ───
  "central-connecticut-state": "Central Connecticut",
  "chicago-state": "Chicago St.",
  "fairleigh-dickinson": "Fairleigh Dickinson",
  "le-moyne": "Le Moyne",
  "long-island-university": "LIU",
  mercyhurst: "Mercyhurst",
  "st-francis-ny": "St. Francis NY",
  stonehill: "Stonehill",
  wagner: "Wagner",

  // ─── OVC ───
  "eastern-illinois": "Eastern Illinois",
  lindenwood: "Lindenwood",
  "arkansas-little-rock": "Little Rock",
  "morehead-state": "Morehead St.",
  "southern-illinois-edwardsville": "SIU Edwardsville",
  "southeast-missouri-state": "Southeast Missouri St.",
  "tennessee-state": "Tennessee St.",
  "tennessee-tech": "Tennessee Tech",
  "tennessee-martin": "Tennessee Martin",
  "western-illinois": "Western Illinois",

  // ─── Patriot League ───
  american: "American",
  army: "Army",
  "boston-university": "Boston University",
  bucknell: "Bucknell",
  colgate: "Colgate",
  "holy-cross": "Holy Cross",
  lafayette: "Lafayette",
  lehigh: "Lehigh",
  "loyola-md": "Loyola MD",
  navy: "Navy",

  // ─── SoCon ───
  chattanooga: "Chattanooga",
  "east-tennessee-state": "East Tennessee St.",
  furman: "Furman",
  mercer: "Mercer",
  samford: "Samford",
  "the-citadel": "The Citadel",
  "north-carolina-greensboro": "UNC Greensboro",
  vmi: "VMI",
  "western-carolina": "Western Carolina",
  wofford: "Wofford",

  // ─── Southland ───
  "houston-baptist": "Houston Christian",
  "incarnate-word": "Incarnate Word",
  lamar: "Lamar",
  "mcneese-state": "McNeese",
  "nicholls-state": "Nicholls",
  "northwestern-state": "Northwestern St.",
  "southeastern-louisiana": "Southeastern Louisiana",
  "texas-am-corpus-christi": "Texas A&M Corpus Chris",

  // ─── SWAC ───
  "alabama-am": "Alabama A&M",
  "alabama-state": "Alabama St.",
  "alcorn-state": "Alcorn St.",
  "bethune-cookman": "Bethune Cookman",
  "florida-am": "Florida A&M",
  "grambling": "Grambling St.",
  "jackson-state": "Jackson St.",
  "mississippi-valley-state": "Mississippi Valley St.",
  "prairie-view-am": "Prairie View A&M",
  "southern-university": "Southern",
  "texas-southern": "Texas Southern",

  // ─── Summit League ───
  denver: "Denver",
  "missouri-kansas-city": "Kansas City",
  "nebraska-omaha": "Nebraska Omaha",
  "north-dakota": "North Dakota",
  "north-dakota-state": "North Dakota St.",
  "oral-roberts": "Oral Roberts",
  "south-dakota": "South Dakota",
  "south-dakota-state": "South Dakota St.",
  "st-thomas-mn": "St. Thomas",

  // ─── WAC ───
  "abilene-christian": "Abilene Christian",
  "grand-canyon": "Grand Canyon",
  seattle: "Seattle",
  "southern-utah": "Southern Utah",
  "stephen-f-austin": "Stephen F. Austin",
  "tarleton-state": "Tarleton St.",
  "texas-arlington": "UT Arlington",
  "utah-valley": "Utah Valley",
  "texas-rio-grande-valley": "UT Rio Grande Valley",

  // ─── Additional / Defunct ───
  "birmingham-southern": "Birmingham Southern",
  "centenary-la": "Centenary",
  "savannah-state": "Savannah St.",
  "winston-salem-state": "Winston Salem St.",
  "north-carolina-at": "North Carolina A&T",
  "arkansas-pine-bluff": "Arkansas Pine Bluff",
  "cal-baptist": "Cal Baptist",
  "dixie-state": "Utah Tech",
  "utah-tech": "Utah Tech",
  "purdue-fort-wayne": "Purdue Fort Wayne",
  "iu-indianapolis": "IU Indy",
};

/**
 * Resolve any NCAAMB team name (abbreviated, alternate, or canonical) to the
 * canonical (KenPom) name. Case-insensitive. Also checks the slug map.
 *
 * @returns The canonical team name, or the original input trimmed if not found.
 */
export function resolveNCAAMBTeamName(name: string): string {
  const normalized = name.trim().toLowerCase();

  // 1. Direct lookup in the main name map
  const fromName = ncaambTeamNameMap[normalized];
  if (fromName) return fromName;

  // 2. Check slug map (SR slugs)
  const fromSlug = ncaambSlugToCanonical[normalized];
  if (fromSlug) return fromSlug;

  // 3. Try converting "State" → "St." pattern automatically
  const statePattern = normalized.replace(/\bstate\b/g, "st.");
  const fromStatePattern = ncaambTeamNameMap[statePattern];
  if (fromStatePattern) return fromStatePattern;

  // 4. Try removing parenthetical qualifiers: "team (XX)" → "team"
  const withoutParens = normalized.replace(/\s*\([^)]*\)\s*/g, "").trim();
  if (withoutParens !== normalized) {
    const fromParens = ncaambTeamNameMap[withoutParens];
    if (fromParens) return fromParens;
  }

  // 5. Try slugified version (replace spaces with hyphens)
  const slugified = normalized.replace(/\s+/g, "-");
  const fromSlugified = ncaambSlugToCanonical[slugified];
  if (fromSlugified) return fromSlugified;

  // 6. Return original input trimmed (not found)
  return name.trim();
}

/**
 * Get all known aliases for a given canonical team name.
 *
 * @param canonical - The canonical (KenPom) team name.
 * @returns An array of all known aliases (lowercased), or empty array if not found.
 */
export function getNCAAMBTeamAliases(canonical: string): string[] {
  const aliases: string[] = [];

  for (const [alias, name] of Object.entries(ncaambTeamNameMap)) {
    if (name === canonical) {
      aliases.push(alias);
    }
  }

  for (const [slug, name] of Object.entries(ncaambSlugToCanonical)) {
    if (name === canonical) {
      aliases.push(slug);
    }
  }

  return aliases;
}

/**
 * Build a reverse lookup: canonical name → all known aliases.
 * Useful for search/autocomplete.
 */
export function getNCAAMBAllTeamAliases(): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};

  for (const [alias, canonical] of Object.entries(ncaambTeamNameMap)) {
    if (!aliases[canonical]) {
      aliases[canonical] = [];
    }
    aliases[canonical].push(alias);
  }

  for (const [slug, canonical] of Object.entries(ncaambSlugToCanonical)) {
    if (!aliases[canonical]) {
      aliases[canonical] = [];
    }
    aliases[canonical].push(slug);
  }

  return aliases;
}

/**
 * Get all canonical team names (unique set of KenPom names).
 */
export function getNCAAMBCanonicalNames(): string[] {
  const names = new Set<string>();

  for (const canonical of Object.values(ncaambTeamNameMap)) {
    names.add(canonical);
  }

  for (const canonical of Object.values(ncaambSlugToCanonical)) {
    names.add(canonical);
  }

  return Array.from(names).sort();
}
