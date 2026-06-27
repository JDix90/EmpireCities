"""
Surviving Byzantium — a "Megali Idea" alternate-history Aegean theater where a
revived Byzantine Empire clings to the straits while the Ottoman rump, Bulgaria,
Serbia, and the Latin/Italian islanders contest the wine-dark sea.

geo_polygon outlines trace the real coasts of the Aegean: the Anatolian peninsula,
the Greek mainland and Thrace, the Bosphorus strait at Constantinople, the Balkan
shore, and the islands (Crete, Cyprus, Rhodes, Euboea, the Cyclades). Naval play is
central — the Aegean is crossed by "sea" links and every island is reached by ship.
Built via mapkit.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from mapkit import build_map

BOUNDS = {"minLng": 14.0, "maxLng": 44.0, "minLat": 30.0, "maxLat": 47.0}

REGIONS = [
    {"region_id": "byzantine_anatolia", "name": "Byzantine Anatolia",         "bonus": 5},
    {"region_id": "byzantine_greece",   "name": "Byzantine Greece & the City", "bonus": 6},
    {"region_id": "ottoman_rump",       "name": "Ottoman Rump",                "bonus": 4},
    {"region_id": "bulgaria",           "name": "Bulgaria",                    "bonus": 3},
    {"region_id": "serbia",             "name": "Serbia",                      "bonus": 3},
    {"region_id": "aegean_isles",       "name": "Aegean & the Isles",          "bonus": 5},
    {"region_id": "levant",             "name": "Levant Coast",                "bonus": 4},
]

T = [
    # ---- Byzantine Greece & the City (mainland Greece + Thrace/Constantinople + Aegean coast) ----
    ("constantinople", "Constantinople", "byzantine_greece", [
        [28.6,41.3],[29.2,41.2],[29.1,40.9],[28.5,40.6],[27.8,40.7],[27.6,41.0],[28.0,41.2],[28.6,41.3]]),
    ("thrace", "Thrace", "byzantine_greece", [
        [25.0,41.3],[26.4,41.7],[27.6,41.0],[27.8,40.7],[26.6,40.3],[25.4,40.6],[24.6,40.9],[25.0,41.3]]),
    ("macedonia", "Macedonia & Thessalonica", "byzantine_greece", [
        [22.0,41.2],[23.4,41.4],[24.6,40.9],[24.0,40.3],[22.8,40.2],[22.2,40.4],[21.8,40.8],[22.0,41.2]]),
    ("thessaly", "Thessaly", "byzantine_greece", [
        [21.4,39.8],[22.2,40.4],[22.8,40.2],[23.4,39.6],[23.0,39.0],[22.0,39.0],[21.4,39.4],[21.4,39.8]]),
    ("epirus", "Epirus", "byzantine_greece", [
        [20.2,39.7],[21.4,39.8],[21.4,39.4],[21.2,38.8],[20.6,38.6],[20.2,39.0],[20.0,39.4],[20.2,39.7]]),
    ("attica", "Attica & Boeotia", "byzantine_greece", [
        [22.0,39.0],[23.0,39.0],[23.8,38.4],[23.9,37.9],[23.2,37.7],[22.6,38.0],[22.2,38.4],[22.0,39.0]]),
    ("morea", "The Morea", "byzantine_greece", [
        [21.4,38.2],[22.6,38.0],[23.2,37.7],[23.0,37.0],[22.4,36.4],[21.8,36.8],[21.3,37.6],[21.4,38.2]]),

    # ---- Byzantine Anatolia (western + central Asia Minor) ----
    ("bithynia", "Bithynia", "byzantine_anatolia", [
        [29.1,40.9],[30.6,40.8],[31.6,40.6],[31.4,40.0],[30.4,39.8],[29.4,40.0],[28.9,40.4],[29.1,40.9]]),
    ("ionia", "Ionia & Smyrna", "byzantine_anatolia", [
        [26.7,39.2],[27.8,39.4],[28.6,39.0],[28.4,38.2],[27.6,38.0],[26.8,38.3],[26.5,38.7],[26.7,39.2]]),
    ("lydia", "Lydia & Phrygia", "byzantine_anatolia", [
        [28.4,38.2],[28.6,39.0],[29.4,40.0],[30.4,39.8],[31.2,39.2],[30.6,38.4],[29.6,38.0],[28.4,38.2]]),
    ("caria", "Caria & Lycia", "byzantine_anatolia", [
        [27.6,38.0],[28.4,38.2],[29.6,38.0],[30.2,37.2],[29.6,36.5],[28.6,36.6],[27.8,37.0],[27.6,38.0]]),
    ("pisidia", "Pisidia & Pamphylia", "byzantine_anatolia", [
        [30.2,37.2],[31.2,39.2],[32.6,38.8],[33.0,37.8],[32.2,36.8],[31.0,36.6],[30.2,37.2]]),
    ("galatia", "Galatia & Ancyra", "byzantine_anatolia", [
        [31.4,40.0],[32.8,40.2],[34.0,39.6],[33.8,38.6],[32.6,38.8],[31.2,39.2],[31.4,40.0]]),

    # ---- Ottoman Rump (eastern Anatolia) ----
    ("cappadocia", "Cappadocia", "ottoman_rump", [
        [34.0,39.6],[35.6,39.4],[36.0,38.4],[35.0,37.6],[33.8,38.0],[33.8,38.6],[34.0,39.6]]),
    ("pontus", "Pontus", "ottoman_rump", [
        [34.0,39.6],[35.8,41.2],[37.4,41.0],[37.8,40.2],[36.4,39.6],[35.6,39.4],[34.0,39.6]]),
    ("armenia", "Armenia & the East", "ottoman_rump", [
        [37.4,41.0],[40.0,40.8],[42.0,40.2],[42.4,39.0],[40.6,38.6],[38.8,38.8],[37.8,40.2],[37.4,41.0]]),
    ("cilicia", "Cilicia", "ottoman_rump", [
        [33.0,37.8],[35.0,37.6],[36.0,38.4],[36.8,37.4],[36.2,36.6],[34.8,36.4],[33.4,36.4],[33.0,37.8]]),
    ("kurdistan", "Kurdistan", "ottoman_rump", [
        [38.8,38.8],[40.6,38.6],[42.4,39.0],[43.6,37.8],[42.2,37.0],[40.2,37.2],[38.6,37.6],[38.8,38.8]]),

    # ---- Bulgaria (NE Balkans) ----
    ("sofia", "Sofia", "bulgaria", [
        [22.4,42.4],[23.6,42.6],[24.6,42.4],[24.4,41.6],[23.4,41.4],[22.4,41.6],[22.0,42.0],[22.4,42.4]]),
    ("danubia", "Danubian Bulgaria", "bulgaria", [
        [22.8,44.0],[24.6,44.0],[26.6,43.8],[27.0,43.0],[25.6,42.6],[24.0,42.8],[23.0,43.2],[22.8,44.0]]),
    ("varna", "Varna & the Coast", "bulgaria", [
        [27.0,43.0],[28.0,43.4],[28.2,42.6],[27.8,41.8],[26.4,41.7],[25.6,42.6],[27.0,43.0]]),

    # ---- Serbia (W Balkans) ----
    ("belgrade", "Belgrade", "serbia", [
        [19.6,45.2],[21.0,45.0],[22.0,44.2],[21.4,43.6],[20.2,43.6],[19.2,44.0],[18.8,44.6],[19.6,45.2]]),
    ("kosovo", "Kosovo & the South", "serbia", [
        [20.2,43.6],[21.4,43.6],[22.0,42.0],[21.2,41.4],[20.2,41.6],[19.6,42.4],[20.2,43.6]]),
    ("bosnia", "Bosnia & the Adriatic", "serbia", [
        [16.6,44.4],[18.8,44.6],[19.2,44.0],[19.6,42.6],[18.4,42.4],[17.2,43.0],[16.4,43.6],[16.6,44.4]]),

    # ---- Aegean & the Isles (islands joined by sea links) ----
    ("euboea", "Euboea", "aegean_isles", [
        [23.2,38.9],[24.2,38.7],[24.6,38.2],[24.0,38.0],[23.4,38.2],[23.0,38.5],[23.2,38.9]]),
    ("cyclades", "The Cyclades", "aegean_isles", [
        [24.6,37.6],[25.6,37.6],[26.0,37.0],[25.4,36.6],[24.6,36.8],[24.2,37.2],[24.6,37.6]]),
    ("crete", "Crete", "aegean_isles", [
        [23.6,35.4],[25.2,35.6],[26.3,35.3],[26.1,34.9],[24.6,35.0],[23.5,35.0],[23.6,35.4]]),
    ("rhodes", "Rhodes & the Dodecanese", "aegean_isles", [
        [27.6,36.6],[28.4,36.5],[28.6,36.0],[28.0,35.8],[27.4,36.0],[27.3,36.4],[27.6,36.6]]),
    ("cyprus", "Cyprus", "aegean_isles", [
        [32.3,35.2],[33.6,35.4],[34.6,35.7],[34.0,34.9],[32.9,34.6],[32.3,34.8],[32.3,35.2]]),

    # ---- Levant Coast (Syrian + N Egyptian / Nile-delta coast) ----
    ("antioch", "Antioch & the Orontes", "levant", [
        [35.5,36.6],[36.8,36.5],[37.2,35.6],[36.2,35.0],[35.4,35.2],[35.2,36.0],[35.5,36.6]]),
    ("syria", "Syria & Damascus", "levant", [
        [35.4,35.2],[36.2,35.0],[37.0,34.0],[36.4,33.0],[35.4,33.2],[34.9,34.2],[35.4,35.2]]),
    ("palestine", "Palestine", "levant", [
        [34.9,34.2],[35.4,33.2],[35.6,32.0],[34.8,31.4],[34.2,31.6],[34.4,32.6],[34.9,34.2]]),
    ("nile_delta", "Nile Delta & Alexandria", "levant", [
        [29.6,31.2],[31.2,31.5],[32.4,31.3],[33.6,31.2],[33.2,30.6],[31.4,30.6],[29.8,30.7],[29.6,31.2]]),
]

C = [
    # ---- Greece mainland (land) ----
    ("thrace","macedonia","land"),
    ("macedonia","thessaly","land"),
    ("thessaly","epirus","land"),
    ("thessaly","attica","land"),
    ("attica","morea","land"),
    ("epirus","attica","land"),
    ("epirus","morea","land"),
    # ---- Greece <-> Balkans (land) ----
    ("macedonia","sofia","land"),
    ("macedonia","kosovo","land"),
    ("epirus","kosovo","land"),
    ("thrace","varna","land"),
    ("thrace","sofia","land"),
    # ---- Bulgaria (land) ----
    ("sofia","danubia","land"),
    ("sofia","varna","land"),
    ("danubia","varna","land"),
    ("sofia","kosovo","land"),
    # ---- Serbia (land) ----
    ("belgrade","kosovo","land"),
    ("belgrade","bosnia","land"),
    ("kosovo","bosnia","land"),
    ("belgrade","danubia","land"),
    # ---- Constantinople / Bosphorus strait (sea links across the straits) ----
    ("thrace","constantinople","land"),
    ("constantinople","bithynia","sea"),   # Bosphorus strait Greece(Thrace) <-> Anatolia
    # ---- Byzantine Anatolia (land) ----
    ("bithynia","galatia","land"),
    ("bithynia","lydia","land"),
    ("galatia","lydia","land"),
    ("lydia","ionia","land"),
    ("lydia","caria","land"),
    ("ionia","caria","land"),
    ("galatia","pisidia","land"),
    ("lydia","pisidia","land"),
    ("caria","pisidia","land"),
    # ---- Anatolia <-> Ottoman Rump (land) ----
    ("galatia","cappadocia","land"),
    ("galatia","pontus","land"),
    ("pisidia","cappadocia","land"),
    ("pisidia","cilicia","land"),
    ("cappadocia","cilicia","land"),
    ("cappadocia","pontus","land"),
    ("pontus","armenia","land"),
    ("cappadocia","armenia","land"),
    ("armenia","kurdistan","land"),
    ("cilicia","kurdistan","land"),
    ("cilicia","armenia","land"),
    # ---- Cilicia <-> Levant (land) ----
    ("cilicia","antioch","land"),
    ("antioch","syria","land"),
    ("syria","palestine","land"),
    ("kurdistan","syria","land"),
    # ---- Levant coast <-> Nile (sea, along the Levantine shore) ----
    ("palestine","nile_delta","sea"),
    # ---- AEGEAN SEA LINKS (every island reached by ship) ----
    ("attica","euboea","sea"),
    ("euboea","cyclades","sea"),
    ("attica","cyclades","sea"),
    ("morea","cyclades","sea"),
    ("morea","crete","sea"),
    ("cyclades","crete","sea"),
    ("cyclades","rhodes","sea"),
    ("crete","rhodes","sea"),
    ("rhodes","caria","sea"),
    ("ionia","cyclades","sea"),
    ("rhodes","cyprus","sea"),
    ("cyprus","cilicia","sea"),
    ("cyprus","antioch","sea"),
    ("crete","nile_delta","sea"),
    ("cyprus","nile_delta","sea"),
    # ---- Coastal sea links (naval reach across the Aegean) ----
    ("thessaly","euboea","sea"),
    ("varna","constantinople","sea"),  # Black Sea coast to the City
]

ADMIN = {
    # ---- Byzantine Greece & the City ----
    "constantinople": {"admin1": ["TR-34"]},
    "thrace": {"admin1": ["TR-22", "TR-39", "TR-59", "GR-71", "GR-73", "GR-72"]},
    "macedonia": {"admin1": ["GR-54", "GR-53", "GR-59", "GR-57", "GR-61", "GR-62",
                              "GR-64", "GR-69", "GR-58", "GR-56", "GR-63", "GR-51",
                              "GR-52", "GR-55"]},
    "thessaly": {"admin1": ["GR-42", "GR-41", "GR-43", "GR-44"]},
    "epirus": {"admin1": ["GR-33", "GR-31", "GR-32", "GR-34", "GR-22", "GR-24"]},
    "attica": {"admin1": ["GR-A1", "GR-03", "GR-07", "GR-06", "GR-05", "GR-01"]},
    "morea": {"admin1": ["GR-11", "GR-12", "GR-13", "GR-14", "GR-15", "GR-16",
                         "GR-17", "GR-21", "GR-23"]},

    # ---- Byzantine Anatolia ----
    "bithynia": {"admin1": ["TR-16", "TR-41", "TR-77", "TR-54", "TR-14", "TR-81", "TR-11"]},
    "ionia": {"admin1": ["TR-35", "TR-45"]},
    "lydia": {"admin1": ["TR-43", "TR-64", "TR-03", "TR-26"]},
    "caria": {"admin1": ["TR-09", "TR-48", "TR-20", "TR-10", "TR-17"]},
    "pisidia": {"admin1": ["TR-07", "TR-32", "TR-15"]},
    "galatia": {"admin1": ["TR-06", "TR-71", "TR-18", "TR-42", "TR-70"]},

    # ---- Ottoman Rump ----
    "cappadocia": {"admin1": ["TR-50", "TR-51", "TR-68", "TR-38", "TR-40"]},
    "pontus": {"admin1": ["TR-55", "TR-57", "TR-52", "TR-28", "TR-61", "TR-53", "TR-08",
                          "TR-37", "TR-19", "TR-05", "TR-60", "TR-66", "TR-67", "TR-74", "TR-78"]},
    "armenia": {"admin1": ["TR-25", "TR-24", "TR-29", "TR-69", "TR-36", "TR-75", "TR-76",
                           "TR-04", "TR-58"]},
    "cilicia": {"admin1": ["TR-01", "TR-33", "TR-31", "TR-80", "TR-46"]},
    "kurdistan": {"admin1": ["TR-21", "TR-47", "TR-72", "TR-56", "TR-73", "TR-30", "TR-65",
                             "TR-13", "TR-49", "TR-12", "TR-23", "TR-44", "TR-62", "TR-02",
                             "TR-63", "TR-27", "TR-79"]},

    # ---- Bulgaria ----
    "sofia": {"admin1": ["BG-22", "BG-23", "BG-14", "BG-10", "BG-01", "BG-13", "BG-16",
                         "BG-05", "BG-12", "BG-06", "BG-21", "BG-09", "BG-26"]},
    "danubia": {"admin1": ["BG-15", "BG-11", "BG-07", "BG-04", "BG-18", "BG-19", "BG-17", "BG-24"]},
    "varna": {"admin1": ["BG-03", "BG-08", "BG-02", "BG-27", "BG-25", "BG-20", "BG-28"]},

    # ---- Serbia ----
    "belgrade": {"admin1": ["RS-00", "RS-VO", "RS-01", "RS-02", "RS-03", "RS-04", "RS-05",
                            "RS-06", "RS-07", "RS-10", "RS-11", "RS-12", "RS-13", "RS-14", "RS-15"]},
    "kosovo": {"admin1": ["RS-KM", "RS-25", "RS-26", "RS-27", "RS-28", "RS-29", "RS-20",
                          "RS-21", "RS-22", "RS-23", "RS-24", "RS-19"]},
    "bosnia": {"admin1": ["RS-08", "RS-09", "RS-16", "RS-17", "RS-18"]},

    # ---- Aegean & the Isles ----
    "euboea": {"admin1": ["GR-04"]},
    "cyclades": {"admin1": ["GR-82", "GR-83", "GR-84", "GR-85"]},
    "crete": {"admin1": ["GR-91", "GR-92", "GR-93", "GR-94"]},
    "rhodes": {"admin1": ["GR-81"]},
    "cyprus": {"iso_codes": ["CY"]},

    # ---- Levant Coast ----
    "antioch": {"iso_codes": ["SY"]},
    "syria": {"iso_codes": ["SY"]},
    "palestine": {"iso_codes": ["LB"]},
    "nile_delta": {"iso_codes": ["EG"]},
}

if __name__ == "__main__":
    build_map(
        map_id="community_byzantium_megali",
        name="Surviving Byzantium",
        description=(
            "An alternate Aegean where the Empire of the Romans endured. Constantinople "
            "still guards the Bosphorus, Byzantine Anatolia and Greece flank the wine-dark "
            "sea, and a shrunken Ottoman rump, Bulgaria, Serbia, the Latin islanders of the "
            "Aegean, and the Levantine ports all contest the straits. A naval theater where "
            "no power rules without a fleet."
        ),
        bounds=BOUNDS,
        regions=REGIONS,
        territories=T,
        connections=C,
        admin_refs=ADMIN,
        globe_view={"center_lat": 39.0, "center_lng": 28.0, "altitude": 0.8},
    )
