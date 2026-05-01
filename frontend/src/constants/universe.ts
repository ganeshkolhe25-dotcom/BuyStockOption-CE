export interface UniverseStock {
  name: string;
  symbol: string;
  isIndex?: boolean;
}

export const CUSTOM_UNIVERSE: UniverseStock[] = [
  { name: "Page Industries",               symbol: "PAGEIND" },
  { name: "Bosch",                         symbol: "BOSCHLTD" },
  { name: "Hitachi Energy",                symbol: "POWERINDIA" },
  { name: "Shree Cement",                  symbol: "SHREECEM" },
  { name: "Force Motors",                  symbol: "FORCEMOT" },
  { name: "Solar Industries",              symbol: "SOLARINDS" },
  { name: "Maruti Suzuki",                 symbol: "MARUTI" },
  { name: "UltraTech Cement",              symbol: "ULTRACEMCO" },
  { name: "Dixon Technologies",            symbol: "DIXON" },
  { name: "Bajaj Holdings",                symbol: "BAJAJHLDNG" },
  { name: "Bajaj Auto",                    symbol: "BAJAJ-AUTO" },
  { name: "Oracle Financial (OFSS)",       symbol: "OFSS" },
  { name: "Polycab India",                 symbol: "POLYCAB" },
  { name: "Amber Enterprises",             symbol: "AMBER" },
  { name: "Apollo Hospitals",              symbol: "APOLLOHOSP" },
  { name: "ABB India",                     symbol: "ABB" },
  { name: "Eicher Motors",                 symbol: "EICHERMOT" },
  { name: "Divi's Laboratories",           symbol: "DIVISLAB" },
  { name: "Britannia Industries",          symbol: "BRITANNIA" },
  { name: "Alkem Laboratories",            symbol: "ALKEM" },
  { name: "Cummins India",                 symbol: "CUMMINSIND" },
  { name: "Hero MotoCorp",                 symbol: "HEROMOTOCO" },
  { name: "KEI Industries",                symbol: "KEI" },
  { name: "MRF",                           symbol: "MRF" },
  { name: "Abbott India",                  symbol: "ABBOTINDIA" },
  { name: "Honeywell Automation",          symbol: "HONAUT" },
  { name: "Nestlé India",                  symbol: "NESTLEIND" },
  { name: "LTIMindtree",                   symbol: "LTIM" },
  { name: "Bajaj Finance",                 symbol: "BAJFINANCE" },
  { name: "Coforge",                       symbol: "COFORGE" },
  { name: "Trent",                         symbol: "TRENT" },
  { name: "Siemens India",                 symbol: "SIEMENS" },
  { name: "Persistent Systems",            symbol: "PERSISTENT" },
  { name: "Nifty 50",                      symbol: "NIFTY",     isIndex: true },
  { name: "Bank Nifty",                    symbol: "BANKNIFTY", isIndex: true },
];
