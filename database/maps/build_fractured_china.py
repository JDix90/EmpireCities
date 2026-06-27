"""
Fractured China — Warlord Era. The Republic shattered into rival cliques after 1916:
Fengtian in Manchuria, Zhili on the North China Plain, the frontier khanates and
Xinjiang, the Tibetan plateau, the southwestern cliques of Yunnan & Sichuan, the
Yangtze heartland, the wealthy treaty-port Jiangnan, and the southern cliques of
Guangdong-Guangxi-Fujian.

geo_polygon outlines trace the real Chinese coast and interior frontiers (the Pacific
shore, the Yangtze and Yellow rivers, the Himalayan/Tibetan edge, the Gobi, and the
NE border with Korea). Taiwan and Hainan are islands joined by sea lanes. Built via mapkit.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from mapkit import build_map

BOUNDS = {"minLng": 73.0, "maxLng": 135.0, "minLat": 18.0, "maxLat": 54.0}

REGIONS = [
    {"region_id": "manchuria",      "name": "Fengtian Clique / Manchuria",       "bonus": 5},
    {"region_id": "north_china",    "name": "Zhili Clique / North China Plain",  "bonus": 5},
    {"region_id": "mongolia_gansu", "name": "Northern Frontier",                 "bonus": 4},
    {"region_id": "xinjiang",       "name": "Xinjiang",                          "bonus": 3},
    {"region_id": "tibet",          "name": "Tibet",                             "bonus": 3},
    {"region_id": "southwest",      "name": "Yunnan & Sichuan Cliques",          "bonus": 4},
    {"region_id": "central_china",  "name": "Central China / Yangtze",           "bonus": 4},
    {"region_id": "lower_yangtze",  "name": "Jiangnan & the Treaty Ports",       "bonus": 6},
    {"region_id": "south_coast",    "name": "Southern Cliques",                  "bonus": 4},
]

T = [
    # --- Manchuria (NE), bordered by Korea/Russia ---
    ("heilongjiang", "Heilongjiang", "manchuria", [
        [121.5,53.0],[126.0,53.5],[131.0,48.0],[134.5,48.4],[134.0,45.0],[130.0,44.5],
        [126.0,45.5],[123.0,46.5],[121.5,49.0],[121.5,53.0]]),
    ("jilin", "Jilin", "manchuria", [
        [123.0,46.5],[126.0,45.5],[130.0,44.5],[131.5,43.0],[129.5,42.0],[126.5,41.7],
        [124.5,42.5],[122.5,44.0],[123.0,46.5]]),
    ("liaoning", "Liaoning (Fengtian)", "manchuria", [
        [122.5,44.0],[124.5,42.5],[126.5,41.7],[125.0,40.0],[122.0,39.0],[120.5,40.0],
        [119.8,41.5],[121.0,42.8],[122.5,44.0]]),
    # --- Northern Frontier: Inner Mongolia + Gansu corridor ---
    ("inner_mongolia", "Inner Mongolia", "mongolia_gansu", [
        [110.0,42.0],[115.0,43.0],[119.8,44.0],[121.5,49.0],[121.5,46.0],[119.8,41.5],
        [114.0,41.0],[110.0,40.5],[110.0,42.0]]),
    ("ningxia_ordos", "Ningxia & Ordos", "mongolia_gansu", [
        [104.0,39.0],[110.0,40.5],[114.0,41.0],[112.0,38.0],[110.0,37.0],[106.0,36.5],
        [104.0,37.5],[104.0,39.0]]),
    ("gansu", "Gansu Corridor", "mongolia_gansu", [
        [94.0,40.0],[100.0,41.5],[104.0,39.0],[104.0,37.5],[106.0,36.5],[103.5,34.0],
        [100.0,35.5],[96.0,38.0],[94.0,40.0]]),
    # --- Xinjiang (far NW) ---
    ("dzungaria", "Dzungaria", "xinjiang", [
        [79.0,45.5],[85.0,47.5],[91.0,46.0],[94.0,44.0],[91.0,43.0],[85.0,44.0],
        [80.5,43.5],[79.0,45.5]]),
    ("tarim", "Tarim Basin", "xinjiang", [
        [73.5,39.5],[80.5,43.5],[85.0,44.0],[91.0,43.0],[94.0,44.0],[94.0,40.0],
        [90.0,38.5],[83.0,36.5],[78.0,36.0],[74.5,37.5],[73.5,39.5]]),
    # --- Tibet (SW plateau) ---
    ("western_tibet", "Ngari & Western Tibet", "tibet", [
        [78.0,36.0],[83.0,36.5],[85.0,33.0],[84.0,30.0],[80.5,30.5],[79.0,32.5],
        [78.0,36.0]]),
    ("central_tibet", "Ü-Tsang", "tibet", [
        [84.0,30.0],[85.0,33.0],[90.0,34.0],[94.0,32.0],[92.0,28.5],[88.0,27.5],
        [84.0,28.0],[84.0,30.0]]),
    ("kham", "Kham & Amdo", "tibet", [
        [90.0,38.5],[94.0,40.0],[96.0,38.0],[100.0,35.5],[103.5,34.0],[101.5,31.0],
        [98.0,29.5],[94.0,32.0],[90.0,34.0],[90.0,38.5]]),
    # --- North China Plain (Zhili) ---
    ("hebei_zhili", "Hebei (Zhili)", "north_china", [
        [114.0,41.0],[119.8,41.5],[120.5,40.0],[119.0,38.5],[117.5,38.0],[116.0,37.0],
        [113.5,37.0],[113.0,39.5],[114.0,41.0]]),
    ("shanxi", "Shanxi", "north_china", [
        [110.0,40.5],[114.0,41.0],[113.0,39.5],[113.5,37.0],[112.5,35.0],[110.5,34.8],
        [110.0,37.0],[112.0,38.0],[110.0,40.5]]),
    ("shandong", "Shandong", "north_china", [
        [116.0,37.0],[117.5,38.0],[119.0,38.0],[122.7,37.4],[120.0,35.5],[117.5,34.5],
        [115.5,35.0],[116.0,37.0]]),
    ("henan", "Henan", "north_china", [
        [110.5,34.8],[112.5,35.0],[113.5,37.0],[116.0,37.0],[115.5,35.0],[116.5,33.0],
        [114.0,32.0],[111.5,32.5],[110.5,34.8]]),
    ("shaanxi", "Shaanxi (Guanzhong)", "north_china", [
        [104.0,37.5],[106.0,36.5],[110.0,37.0],[110.5,34.8],[111.5,32.5],[108.5,32.5],
        [106.0,33.0],[103.5,34.0],[104.0,37.5]]),
    # --- Central China / Yangtze (Hubei-Hunan-Jiangxi) ---
    ("hubei", "Hubei", "central_china", [
        [108.5,32.5],[111.5,32.5],[114.0,32.0],[116.5,33.0],[116.0,30.5],[113.5,29.5],
        [110.5,29.8],[108.5,30.5],[108.5,32.5]]),
    ("hunan", "Hunan", "central_china", [
        [108.5,30.5],[110.5,29.8],[113.5,29.5],[114.0,27.0],[113.0,25.2],[110.0,25.0],
        [109.0,27.5],[108.5,30.5]]),
    ("jiangxi", "Jiangxi", "central_china", [
        [113.5,29.5],[116.0,30.5],[118.0,29.5],[118.0,27.5],[116.0,25.0],[114.0,25.5],
        [114.0,27.0],[113.5,29.5]]),
    # --- Lower Yangtze / Jiangnan (treaty ports) ---
    ("anhui", "Anhui", "lower_yangtze", [
        [114.0,32.0],[116.5,33.0],[118.5,33.0],[119.5,31.0],[118.0,29.5],[116.0,30.5],
        [114.0,32.0]]),
    ("jiangsu", "Jiangsu", "lower_yangtze", [
        [116.5,33.0],[117.5,34.5],[120.0,35.5],[121.5,32.0],[121.8,31.2],[119.5,31.0],
        [118.5,33.0],[116.5,33.0]]),
    ("shanghai_zhejiang", "Shanghai & Zhejiang", "lower_yangtze", [
        [118.0,29.5],[119.5,31.0],[121.8,31.2],[122.5,30.0],[121.5,28.0],[120.0,27.0],
        [118.0,27.5],[118.0,29.5]]),
    ("taiwan", "Taiwan", "lower_yangtze", [
        [120.0,25.3],[121.6,25.3],[121.9,24.0],[120.9,22.0],[120.1,22.6],[120.2,24.5],
        [120.0,25.3]]),
    # --- Yunnan & Sichuan cliques (SW) ---
    ("sichuan", "Sichuan", "southwest", [
        [101.5,31.0],[103.5,34.0],[106.0,33.0],[108.5,32.5],[108.5,30.5],[109.0,27.5],
        [106.0,28.0],[103.0,28.5],[100.5,28.5],[98.0,29.5],[101.5,31.0]]),
    ("yunnan", "Yunnan", "southwest", [
        [98.0,29.5],[100.5,28.5],[103.0,28.5],[104.5,26.5],[104.0,24.0],[101.5,22.0],
        [99.0,22.0],[97.5,24.0],[98.5,26.5],[98.0,29.5]]),
    ("guizhou", "Guizhou", "southwest", [
        [103.0,28.5],[106.0,28.0],[109.0,27.5],[110.0,25.0],[108.0,24.7],[105.0,24.8],
        [104.5,26.5],[103.0,28.5]]),
    # --- Southern Cliques (Guangdong/Guangxi/Fujian) ---
    ("fujian", "Fujian", "south_coast", [
        [116.0,25.0],[118.0,27.5],[120.0,27.0],[120.5,25.0],[118.5,24.0],[117.0,23.5],
        [116.0,23.7],[116.0,25.0]]),
    ("guangdong", "Guangdong", "south_coast", [
        [110.0,25.0],[113.0,25.2],[114.0,25.5],[116.0,25.0],[116.0,23.7],[117.0,23.5],
        [115.0,22.7],[113.0,21.8],[110.5,21.3],[110.0,23.0],[110.0,25.0]]),
    ("guangxi", "Guangxi", "south_coast", [
        [104.0,24.0],[104.5,26.5],[105.0,24.8],[108.0,24.7],[110.0,25.0],[110.0,23.0],
        [110.5,21.3],[108.0,21.5],[106.0,22.0],[105.0,23.2],[104.0,24.0]]),
    ("hainan", "Hainan", "south_coast", [
        [108.6,20.0],[111.0,20.0],[111.0,18.4],[109.0,18.2],[108.6,19.2],[108.6,20.0]]),
]

C = [
    # Manchuria internal + to frontier/north china
    ("heilongjiang","jilin","land"),("jilin","liaoning","land"),
    ("heilongjiang","inner_mongolia","land"),("jilin","inner_mongolia","land"),
    ("liaoning","inner_mongolia","land"),("liaoning","hebei_zhili","land"),
    # Northern Frontier internal
    ("inner_mongolia","ningxia_ordos","land"),("ningxia_ordos","gansu","land"),
    ("inner_mongolia","hebei_zhili","land"),("inner_mongolia","shanxi","land"),
    ("ningxia_ordos","shanxi","land"),("ningxia_ordos","shaanxi","land"),
    ("gansu","shaanxi","land"),("gansu","tarim","land"),("gansu","kham","land"),
    ("gansu","dzungaria","land"),
    # Xinjiang internal + neighbors
    ("dzungaria","tarim","land"),("tarim","western_tibet","land"),
    ("tarim","kham","land"),
    # Tibet internal + neighbors
    ("western_tibet","central_tibet","land"),("central_tibet","kham","land"),
    ("kham","sichuan","land"),("central_tibet","sichuan","land"),
    ("kham","yunnan","land"),("central_tibet","yunnan","land"),
    # North China Plain internal
    ("hebei_zhili","shanxi","land"),("hebei_zhili","shandong","land"),
    ("hebei_zhili","henan","land"),("shanxi","shaanxi","land"),
    ("shanxi","henan","land"),("shandong","henan","land"),
    ("henan","shaanxi","land"),("henan","hubei","land"),("henan","anhui","land"),
    ("shandong","jiangsu","land"),
    # Shaanxi to central/southwest
    ("shaanxi","sichuan","land"),("shaanxi","hubei","land"),
    # Central China internal + neighbors
    ("hubei","hunan","land"),("hubei","jiangxi","land"),("hubei","anhui","land"),
    ("hubei","sichuan","land"),("hunan","jiangxi","land"),
    ("hunan","guizhou","land"),("hunan","guangdong","land"),("hunan","guangxi","land"),
    ("jiangxi","anhui","land"),("jiangxi","shanghai_zhejiang","land"),
    ("jiangxi","fujian","land"),("jiangxi","guangdong","land"),
    # Lower Yangtze internal
    ("anhui","jiangsu","land"),("anhui","shanghai_zhejiang","land"),
    ("jiangsu","shanghai_zhejiang","land"),
    ("shanghai_zhejiang","fujian","land"),
    # Southwest internal
    ("sichuan","yunnan","land"),("sichuan","guizhou","land"),
    ("yunnan","guizhou","land"),("yunnan","guangxi","land"),
    ("guizhou","guangxi","land"),
    # Southern coast internal
    ("guangxi","guangdong","land"),("guangdong","fujian","land"),
    # Sea lanes for islands
    ("taiwan","shanghai_zhejiang","sea"),("taiwan","fujian","sea"),
    ("hainan","guangdong","sea"),("hainan","guangxi","sea"),
]

# Real Natural Earth admin-1 (ISO 3166-2) assignments per territory.
# Every mainland CN province assigned once; Taiwan -> ISO country TW.
# Xinjiang (CN-65) and Xizang (CN-54) each cover two territories, split by clip_bbox.
ADMIN = {
    # --- Manchuria ---
    "heilongjiang":     {"admin1": ["CN-23"]},
    "jilin":            {"admin1": ["CN-22"]},
    "liaoning":         {"admin1": ["CN-21"]},
    # --- Northern Frontier ---
    "inner_mongolia":   {"admin1": ["CN-15"]},               # Nei Mongol
    "ningxia_ordos":    {"admin1": ["CN-64"]},               # Ningxia
    "gansu":            {"admin1": ["CN-62"]},               # Gansu corridor
    # --- Xinjiang (one province CN-65 split N/S) ---
    "dzungaria":        {"admin1": ["CN-65"], "clip_bbox": [73.0, 43.0, 96.0, 49.5]},
    "tarim":            {"admin1": ["CN-65"], "clip_bbox": [73.0, 34.0, 96.0, 43.0]},
    # --- Tibet (Xizang CN-54 split W/E; Qinghai CN-63 = Kham/Amdo) ---
    "western_tibet":    {"admin1": ["CN-54"], "clip_bbox": [78.0, 27.0, 85.0, 37.0]},
    "central_tibet":    {"admin1": ["CN-54"], "clip_bbox": [85.0, 27.0, 95.0, 37.0]},
    "kham":             {"admin1": ["CN-63"]},               # Qinghai
    # --- North China Plain (Zhili) ---
    "hebei_zhili":      {"admin1": ["CN-13", "CN-11", "CN-12"]},  # Hebei + Beijing + Tianjin
    "shanxi":           {"admin1": ["CN-14"]},               # Shanxi
    "shandong":         {"admin1": ["CN-37"]},
    "henan":            {"admin1": ["CN-41"]},
    "shaanxi":          {"admin1": ["CN-61"]},               # Shaanxi (Guanzhong)
    # --- Central China / Yangtze ---
    "hubei":            {"admin1": ["CN-42"]},
    "hunan":            {"admin1": ["CN-43"]},
    "jiangxi":          {"admin1": ["CN-36"]},
    # --- Lower Yangtze / Jiangnan ---
    "anhui":            {"admin1": ["CN-34"]},
    "jiangsu":          {"admin1": ["CN-32"]},
    "shanghai_zhejiang":{"admin1": ["CN-31", "CN-33"]},      # Shanghai + Zhejiang
    "taiwan":           {"iso_codes": ["TW"]},
    # --- Yunnan & Sichuan cliques ---
    "sichuan":          {"admin1": ["CN-51", "CN-50"]},      # Sichuan + Chongqing
    "yunnan":           {"admin1": ["CN-53"]},
    "guizhou":          {"admin1": ["CN-52"]},
    # --- Southern Cliques ---
    "fujian":           {"admin1": ["CN-35"]},
    "guangdong":        {"admin1": ["CN-44", "CN-91", "CN-92"]},  # Guangdong + HK + Macao
    "guangxi":          {"admin1": ["CN-45"]},
    "hainan":           {"admin1": ["CN-46"]},
}

if __name__ == "__main__":
    build_map(
        map_id="community_fractured_china",
        name="Fractured China — Warlord Era",
        description=(
            "China in the warlord era, splintered into rival cliques: Fengtian holds Manchuria, "
            "Zhili the North China Plain, frontier khanates and Xinjiang guard the Gobi and the "
            "Tian Shan, Tibet rules its plateau, the Yunnan and Sichuan cliques the southwest, "
            "and the wealthy treaty ports of Jiangnan and the southern cliques of Guangdong "
            "command the coast. A continental theater of river borders, mountain walls, and "
            "contested sea lanes to Taiwan and Hainan."
        ),
        bounds=BOUNDS,
        regions=REGIONS,
        territories=T,
        connections=C,
        globe_view={"center_lat": 35.0, "center_lng": 104.0, "altitude": 1.0},
        admin_refs=ADMIN,
    )
