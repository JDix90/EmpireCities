"""
Divided Japan & Korea — a Cold War "what-if" where the Allied powers carve the
Japanese archipelago into occupation zones (like Germany), while Korea is split
N/S. A naval-heavy theater: Hokkaido, Honshu, Shikoku, Kyushu and the Korean
peninsula are all separated by straits, so command of the sea is everything.

geo_polygon outlines trace the real coastlines of the Japanese home islands and
the Korean peninsula, projected to canvas via mapkit.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from mapkit import build_map, load_admin

BOUNDS = {"minLng": 124.0, "maxLng": 146.0, "minLat": 30.0, "maxLat": 46.0}

REGIONS = [
    {"region_id": "soviet_zone",  "name": "Soviet Zone",   "bonus": 5},
    {"region_id": "us_zone",      "name": "American Zone",  "bonus": 6},
    {"region_id": "british_zone", "name": "British Zone",   "bonus": 4},
    {"region_id": "chinese_zone", "name": "Chinese Zone",   "bonus": 4},
    {"region_id": "korea",        "name": "Divided Korea",  "bonus": 5},
]

T = [
    # ---- Soviet Zone: Hokkaido + northern Honshu (Tohoku) ----
    ("hokkaido_west", "Hokkaido West", "soviet_zone", [
        [140.0, 42.6], [140.4, 43.3], [140.9, 43.4], [141.4, 43.2], [141.6, 43.9],
        [141.3, 44.8], [140.4, 44.3], [140.0, 43.4], [139.8, 42.8], [140.0, 42.6]]),
    ("hokkaido_east", "Hokkaido East", "soviet_zone", [
        [141.6, 43.9], [142.6, 44.3], [143.6, 44.3], [144.8, 44.3], [145.3, 43.4],
        [144.6, 42.9], [143.4, 42.4], [142.2, 42.6], [141.4, 43.2], [141.6, 43.9]]),
    ("hokkaido_south", "Oshima & Hakodate", "soviet_zone", [
        [140.0, 42.6], [140.6, 42.3], [141.4, 42.2], [141.8, 42.6], [141.4, 43.2],
        [140.9, 43.4], [140.4, 43.3], [140.0, 42.6]]),
    ("aomori", "Aomori & Tsugaru", "soviet_zone", [
        [140.3, 41.5], [140.9, 41.2], [141.5, 40.7], [141.5, 41.2], [141.0, 41.5],
        [140.8, 41.6], [140.3, 41.5]]),
    ("akita_iwate", "Akita & Iwate", "soviet_zone", [
        [139.7, 40.5], [140.3, 41.5], [140.8, 41.6], [141.8, 40.5], [141.6, 39.6],
        [140.9, 39.4], [140.0, 39.6], [139.7, 40.5]]),
    ("sendai", "Sendai & Tohoku Coast", "soviet_zone", [
        [139.5, 38.5], [140.0, 39.6], [140.9, 39.4], [141.6, 39.6], [141.1, 38.4],
        [141.0, 37.8], [140.4, 37.7], [139.8, 38.0], [139.5, 38.5]]),

    # ---- American Zone: Kanto + central Honshu (incl. Tokyo) ----
    ("niigata", "Niigata & Echigo", "us_zone", [
        [138.4, 37.0], [138.9, 37.8], [139.5, 38.5], [139.8, 38.0], [139.5, 37.4],
        [139.0, 36.9], [138.4, 37.0]]),
    ("fukushima", "Fukushima & Joban", "us_zone", [
        [139.5, 37.4], [139.8, 38.0], [140.4, 37.7], [141.0, 37.8], [140.8, 36.9],
        [140.2, 36.7], [139.8, 36.8], [139.5, 37.4]]),
    ("tokyo", "Tokyo & Kanto", "us_zone", [
        [139.0, 36.9], [139.8, 36.8], [140.2, 36.7], [140.6, 35.8], [140.0, 35.1],
        [139.4, 35.2], [139.2, 35.6], [139.0, 36.2], [139.0, 36.9]]),
    ("kanto_west", "Yamanashi & Sagami", "us_zone", [
        [138.4, 37.0], [139.0, 36.9], [139.0, 36.2], [139.2, 35.6], [138.9, 35.1],
        [138.3, 35.0], [138.1, 35.9], [138.4, 37.0]]),
    ("chubu", "Chubu & Nagano", "us_zone", [
        [137.2, 37.2], [138.4, 37.0], [138.1, 35.9], [138.3, 35.0], [137.6, 34.9],
        [137.0, 35.4], [136.7, 36.2], [137.2, 37.2]]),
    ("hokuriku", "Hokuriku & Toyama", "us_zone", [
        [136.7, 36.2], [137.2, 37.2], [137.0, 37.5], [136.4, 37.4], [136.7, 36.8],
        [136.2, 36.5], [136.7, 36.2]]),

    # ---- British Zone: Kansai / Chugoku + Shikoku ----
    ("kansai", "Kansai & Osaka", "british_zone", [
        [135.0, 35.6], [136.2, 36.5], [136.7, 36.2], [137.0, 35.4], [136.6, 34.7],
        [135.9, 34.2], [135.2, 34.3], [135.0, 34.9], [135.0, 35.6]]),
    ("kyoto_kii", "Kyoto & Kii", "british_zone", [
        [135.9, 34.2], [136.6, 34.7], [136.9, 34.2], [136.3, 33.7], [135.7, 33.5],
        [135.2, 33.9], [135.2, 34.3], [135.9, 34.2]]),
    ("sanin", "San'in Coast", "british_zone", [
        [132.0, 35.4], [133.2, 35.6], [134.6, 35.7], [135.0, 35.6], [135.0, 34.9],
        [134.2, 34.8], [133.0, 34.9], [132.2, 34.8], [132.0, 35.4]]),
    ("sanyo", "Hiroshima & San'yo", "british_zone", [
        [132.2, 34.8], [133.0, 34.9], [134.2, 34.8], [135.0, 34.9], [135.2, 34.3],
        [134.4, 34.0], [133.3, 34.3], [132.4, 34.2], [132.2, 34.8]]),
    ("yamaguchi", "Yamaguchi & Shimonoseki", "british_zone", [
        [130.9, 34.4], [131.6, 34.7], [132.2, 34.8], [132.4, 34.2], [131.7, 33.9],
        [131.0, 34.0], [130.9, 34.4]]),
    ("shikoku_north", "Shikoku North", "british_zone", [
        [132.6, 34.0], [133.5, 34.3], [134.4, 34.2], [134.6, 33.9], [134.0, 33.5],
        [133.0, 33.6], [132.6, 33.7], [132.6, 34.0]]),
    ("shikoku_south", "Shikoku South (Kochi)", "british_zone", [
        [132.6, 33.7], [133.0, 33.6], [134.0, 33.5], [134.2, 33.2], [133.4, 32.7],
        [132.7, 32.9], [132.5, 33.3], [132.6, 33.7]]),

    # ---- Chinese Zone: Kyushu + southern islands ----
    ("kitakyushu", "Kitakyushu & Fukuoka", "chinese_zone", [
        [129.9, 33.5], [130.5, 33.9], [131.0, 34.0], [131.2, 33.6], [130.9, 33.2],
        [130.3, 33.1], [129.9, 33.2], [129.9, 33.5]]),
    ("nagasaki", "Nagasaki & Saga", "chinese_zone", [
        [129.4, 33.4], [129.9, 33.5], [129.9, 33.2], [130.3, 33.1], [130.2, 32.6],
        [129.7, 32.5], [129.4, 32.8], [129.4, 33.4]]),
    ("oita", "Oita & Beppu", "chinese_zone", [
        [131.0, 34.0], [131.7, 33.9], [132.0, 33.3], [131.6, 32.9], [131.2, 33.0],
        [130.9, 33.2], [131.2, 33.6], [131.0, 34.0]]),
    ("kumamoto", "Kumamoto & Aso", "chinese_zone", [
        [130.2, 32.6], [130.9, 33.2], [131.2, 33.0], [131.2, 32.5], [130.7, 32.2],
        [130.3, 32.3], [130.2, 32.6]]),
    ("kagoshima", "Kagoshima & Miyazaki", "chinese_zone", [
        [130.3, 32.3], [130.7, 32.2], [131.2, 32.5], [131.5, 31.9], [131.0, 31.3],
        [130.4, 31.0], [130.2, 31.6], [130.3, 32.3]]),

    # ---- Divided Korea: peninsula split N/S ----
    ("north_korea", "North Korea (DPRK)", "korea", [
        [124.5, 39.8], [125.8, 40.9], [127.5, 41.5], [129.7, 41.4], [129.8, 40.4],
        [128.5, 39.3], [127.4, 39.1], [126.0, 38.5], [125.0, 38.7], [124.5, 39.8]]),
    ("south_korea", "South Korea (ROK)", "korea", [
        [126.0, 38.5], [127.4, 39.1], [128.5, 39.3], [129.4, 37.4], [129.3, 35.5],
        [128.4, 34.8], [127.4, 34.5], [126.4, 34.6], [126.4, 36.0], [126.0, 38.5]]),
    ("jeju", "Jeju & Tsushima Approaches", "korea", [
        [126.2, 33.6], [126.9, 33.6], [127.0, 33.2], [126.3, 33.1], [126.2, 33.6]]),
]

C = [
    # ----- Soviet Zone: Hokkaido land + Tohoku land -----
    ("hokkaido_west", "hokkaido_east", "land"),
    ("hokkaido_west", "hokkaido_south", "land"),
    ("hokkaido_east", "hokkaido_south", "land"),
    ("aomori", "akita_iwate", "land"),
    ("akita_iwate", "sendai", "land"),
    # Tsugaru Strait (Hokkaido <-> Honshu)
    ("hokkaido_south", "aomori", "sea"),
    # ----- Soviet -> American (northern Honshu contiguous land) -----
    ("sendai", "niigata", "land"),
    ("sendai", "fukushima", "land"),
    # ----- American Zone: central Honshu land -----
    ("niigata", "fukushima", "land"),
    ("niigata", "kanto_west", "land"),
    ("niigata", "chubu", "land"),
    ("fukushima", "tokyo", "land"),
    ("tokyo", "kanto_west", "land"),
    ("kanto_west", "chubu", "land"),
    ("chubu", "hokuriku", "land"),
    # ----- American -> British (central->Kansai land) -----
    ("chubu", "kansai", "land"),
    ("hokuriku", "kansai", "land"),
    # ----- British Zone: Kansai/Chugoku land + Shikoku across the Inland Sea -----
    ("kansai", "kyoto_kii", "land"),
    ("kansai", "sanin", "land"),
    ("sanin", "sanyo", "land"),
    ("sanyo", "yamaguchi", "land"),
    ("sanin", "yamaguchi", "land"),
    ("kyoto_kii", "sanyo", "land"),
    ("shikoku_north", "shikoku_south", "land"),
    # Seto Inland Sea straits (Honshu <-> Shikoku)
    ("kyoto_kii", "shikoku_north", "sea"),   # Kii Channel
    ("sanyo", "shikoku_north", "sea"),       # Seto bridges/straits
    ("yamaguchi", "shikoku_south", "sea"),   # Bungo Channel approaches
    # ----- British -> Chinese: Kanmon Strait (Honshu <-> Kyushu) -----
    ("yamaguchi", "kitakyushu", "sea"),      # Kanmon Strait
    ("shikoku_south", "oita", "sea"),        # Bungo Channel (Shikoku <-> Kyushu)
    # ----- Chinese Zone: Kyushu land -----
    ("kitakyushu", "nagasaki", "land"),
    ("kitakyushu", "oita", "land"),
    ("kitakyushu", "kumamoto", "land"),
    ("nagasaki", "kumamoto", "land"),
    ("oita", "kumamoto", "land"),
    ("kumamoto", "kagoshima", "land"),
    ("oita", "kagoshima", "land"),
    # ----- Korea: peninsula land split N/S -----
    ("north_korea", "south_korea", "land"),  # the DMZ frontier
    ("south_korea", "jeju", "sea"),          # Jeju Strait
    # ----- Korea <-> Japan straits (Tsushima / Korea Strait) -----
    ("south_korea", "kitakyushu", "sea"),    # Tsushima / Korea Strait
    ("jeju", "nagasaki", "sea"),             # Goto / East China Sea approaches
    ("south_korea", "yamaguchi", "sea"),     # Korea Strait to Shimonoseki
    # ----- Sea of Japan crossings (keep the W flank reachable) -----
    ("north_korea", "akita_iwate", "sea"),   # Sea of Japan
    ("south_korea", "sanin", "sea"),         # Sea of Japan to San'in coast
    # ----- extra naval link: Hokkaido to mainland flank (Soyo approaches) -----
    ("hokkaido_west", "akita_iwate", "sea"),
]

# Real Natural Earth admin geometry per territory.
# Japanese territories use admin1 (ISO 3166-2 JP-NN prefecture codes).
# Hokkaido is a single prefecture (JP-01) covering three territories, so each
# Hokkaido territory clips JP-01 to its slice via clip_bbox.
# Korea territories use whole-country iso_codes (KR / KP).
ADMIN = load_admin("community_divided_japan")

if __name__ == "__main__":
    build_map(
        map_id="community_divided_japan",
        name="Divided Japan & Korea",
        description=(
            "A Cold War carve-up: the victorious Allies split the Japanese archipelago "
            "into Soviet, American, British and Chinese occupation zones while Korea is "
            "divided North and South. Hokkaido, Honshu, Shikoku, Kyushu and the peninsula "
            "are islands and bridgeheads separated by the Tsugaru, Kanmon, Bungo and "
            "Tsushima straits — a naval-heavy theater where the fleet that owns the "
            "straits owns the war."
        ),
        bounds=BOUNDS,
        regions=REGIONS,
        territories=T,
        connections=C,
        globe_view={"center_lat": 38.0, "center_lng": 135.0, "altitude": 0.7},
        admin_refs=ADMIN,
    )
