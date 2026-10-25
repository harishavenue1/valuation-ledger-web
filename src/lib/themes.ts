// 2026-10-25 ("under directory we need to build themes, like transformers, pipes, datacenters, shipbuilding, etc") —
// the starting set for the Directory's Themes tab. A theme is just a named list of NSE symbols; every symbol below was
// checked against the daily NSE store's own names, and a stock can sit in several themes (CGPOWER is a transformer
// maker AND a T&D name). Once the Themes tab saves a change, the stored copy (watchlist meta -> `themes`) replaces
// this list wholesale, so editing here only affects a fresh start.
export const DEFAULT_THEMES: Record<string, string[]> = {
  Transformers: ["POWERINDIA", "GVT&D", "ENRIN", "VOLTAMP", "TARIL", "SHILCTECH", "INDOTECH", "MARSONS", "SKIPPER", "SCHNEIDER", "CGPOWER", "SIEMENS", "ABB", "TDPOWERSYS", "KECL"],
  "Power T&D": ["KEC", "KPIL", "SKIPPER", "GENUSPOWER", "HPL", "TDPOWERSYS", "CGPOWER", "ABB", "SIEMENS", "SCHNEIDER"],
  Pipes: ["WELCORP", "APLAPOLLO", "SUPREMEIND", "ASTRAL", "RATNAMANI", "JINDALSAW", "FINPIPE", "MAHSEAMLES", "MANINDS", "SAMBHV", "SURYAROSNI", "VENUSPIPES", "PRINCEPIPE", "APOLLOPIPE", "HITECH", "JTLIND", "INDIANHUME", "GANDHITUBE", "SCODATUBES", "HARIOMPIPE"],
  "Data Centers": ["ANANTRAJ", "NETWEB", "E2E", "TECHNOE", "TATACOMM", "STLTECH", "POLYCAB", "KEI", "APARINDS", "BLUESTARCO", "VOLTAS", "EXIDEIND", "ARE&M", "HBLENGINE", "TEJASNET", "CYIENTDLM", "RRKABEL", "RAILTEL", "SCHNEIDER"],
  Shipbuilding: ["MAZDOCK", "COCHINSHIP", "GRSE", "SWANDEF", "TITAGARH", "LT"],
  Defence: ["HAL", "BEL", "BDL", "MAZDOCK", "COCHINSHIP", "GRSE", "SOLARINDS", "DATAPATTNS", "ASTRAMICRO", "PARAS", "MTARTECH", "ZENTEC", "BEML", "MIDHANI", "BHARATFORG", "AXISCADES", "DYNAMATECH", "PREMEXPLN", "IDEAFORGE"],
  Railways: ["RVNL", "IRCON", "RITES", "IRFC", "TITAGARH", "JWL", "TEXRAIL", "KERNEX", "BEML", "RAILTEL", "IRCTC", "CONCOR", "HBLENGINE"],
  "Solar & Renewables": ["WAAREEENER", "PREMIERENE", "EMMVEE", "SAATVIKGL", "INOXWIND", "SUZLON", "ADANIGREEN", "NTPCGREEN", "ACMESOLAR", "WEBELSOLAR", "SWSOLAR", "WAAREERTL", "INOXGREEN"],
  "Cables & Wires": ["POLYCAB", "KEI", "APARINDS", "RRKABEL", "FINCABLES", "HAVELLS", "UNIVCABLES", "DIACABS", "PRECWIRE", "VINDHYATEL", "STLTECH"],
  "EMS & Semiconductors": ["DIXON", "KAYNES", "SYRMA", "AMBER", "CYIENTDLM", "AVALON", "PGEL", "CENTUM", "MOSCHIP"],
};
