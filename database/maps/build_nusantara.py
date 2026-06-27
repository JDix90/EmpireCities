"""
Maritime Southeast Asia (Nusantara) — the great archipelago and its mainland rim.
Reference genre: r/imaginarymaps "Majapahit / Srivijaya thalassocracy, the spice routes".

geo_polygon outlines trace the real coasts of Sumatra, Java, Borneo, the Malay
peninsula, Luzon/Visayas/Mindanao, Sulawesi, the Moluccas, and mainland Indochina
(Burma, Siam, Đại Việt & Champa). The seas dominate: most links cross the straits
of Malacca, Sunda, Makassar and the Java/Banda seas. Built via mapkit.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from mapkit import build_map

BOUNDS = {"minLng": 92.0, "maxLng": 142.0, "minLat": -11.0, "maxLat": 23.0}

REGIONS = [
    {"region_id": "java",             "name": "Majapahit Java",            "bonus": 6},
    {"region_id": "sumatra",          "name": "Srivijaya / Sumatra",       "bonus": 5},
    {"region_id": "borneo",           "name": "Borneo",                    "bonus": 4},
    {"region_id": "malaya",           "name": "Malaya & Singapura",        "bonus": 4},
    {"region_id": "philippines",      "name": "the Philippine Isles",      "bonus": 5},
    {"region_id": "siam",             "name": "Siam",                      "bonus": 4},
    {"region_id": "vietnam_champa",   "name": "Đại Việt & Champa",         "bonus": 4},
    {"region_id": "burma",            "name": "Burma",                     "bonus": 3},
    {"region_id": "maluku_sulawesi",  "name": "Sulawesi & the Spice Islands", "bonus": 5},
]

T = [
    # ---- Sumatra (long island, SW, NW-SE diagonal) ----
    ("aceh", "Aceh", "sumatra", [
        [95.2,5.6],[96.2,5.2],[97.5,4.2],[98.0,3.6],[97.2,3.4],[96.0,3.6],[95.2,4.4],[94.8,5.2],[95.2,5.6]]),
    ("batak", "Batak Highlands", "sumatra", [
        [98.0,3.6],[99.7,2.8],[100.4,1.8],[99.6,1.0],[98.4,1.4],[97.2,2.4],[97.2,3.4],[98.0,3.6]]),
    ("minangkabau", "Minangkabau", "sumatra", [
        [99.6,1.0],[100.4,1.8],[101.4,0.6],[101.0,-0.4],[100.2,-1.0],[99.2,-0.4],[99.6,1.0]]),
    ("palembang", "Palembang", "sumatra", [
        [101.0,-0.4],[101.4,0.6],[103.2,1.0],[104.6,-1.2],[103.4,-2.4],[102.0,-2.0],[100.6,-1.4],[100.2,-1.0],[101.0,-0.4]]),
    ("lampung", "Lampung", "sumatra", [
        [103.4,-2.4],[104.6,-1.2],[105.8,-3.6],[105.0,-5.6],[104.0,-5.4],[103.4,-4.2],[103.4,-2.4]]),
    # ---- Malay peninsula (mainland S, "malaya") ----
    ("kedah", "Kedah & Perak", "malaya", [
        [100.0,6.5],[100.8,6.4],[101.4,5.6],[101.2,4.6],[100.4,4.0],[99.8,5.2],[100.0,6.5]]),
    ("pahang", "Pahang", "malaya", [
        [101.2,4.6],[103.4,4.4],[103.6,3.4],[102.8,2.6],[101.6,2.8],[101.2,4.6]]),
    ("johor", "Johor & Singapura", "malaya", [
        [102.8,2.6],[103.6,3.4],[104.2,1.8],[103.6,1.3],[102.6,1.8],[102.8,2.6]]),
    # ---- Borneo (center) ----
    ("brunei_sarawak", "Sarawak & Brunei", "borneo", [
        [109.6,2.0],[111.4,3.0],[113.0,4.4],[114.6,4.4],[115.2,4.8],[114.0,3.0],[112.0,1.4],[110.0,0.8],[109.6,2.0]]),
    ("sabah", "Sabah", "borneo", [
        [115.2,4.8],[116.8,7.0],[117.6,6.4],[118.6,5.0],[117.4,4.2],[116.0,4.2],[115.2,4.8]]),
    ("west_borneo", "West Kalimantan", "borneo", [
        [109.0,1.6],[109.6,2.0],[110.0,0.8],[110.4,-0.6],[110.0,-2.0],[108.8,-3.2],[108.6,-1.0],[108.8,0.6],[109.0,1.6]]),
    ("south_borneo", "Banjarmasin", "borneo", [
        [108.8,-3.2],[110.0,-2.0],[112.0,-3.2],[114.6,-3.6],[116.0,-3.2],[116.4,-1.4],[114.0,-0.4],[112.0,-1.4],[110.4,-0.6],[108.8,-3.2]]),
    ("east_borneo", "Kutai", "borneo", [
        [114.0,-0.4],[116.4,-1.4],[117.6,0.8],[118.4,1.0],[118.4,2.6],[117.4,4.2],[116.0,4.2],[115.2,4.8],[114.6,4.4],[113.0,4.4],[114.0,3.0],[114.0,-0.4]]),
    # ---- Java (along the south) ----
    ("banten", "Banten & Sunda", "java", [
        [105.0,-5.6],[106.6,-5.8],[107.0,-6.8],[106.0,-7.4],[105.2,-6.6],[105.0,-5.6]]),
    ("mataram", "Central Java", "java", [
        [106.6,-5.8],[109.0,-6.4],[110.4,-6.8],[110.2,-7.8],[108.6,-7.6],[107.0,-6.8],[106.6,-5.8]]),
    ("majapahit", "Majapahit & Surabaya", "java", [
        [110.4,-6.8],[112.6,-6.9],[114.4,-7.7],[113.6,-8.4],[111.4,-8.3],[110.2,-7.8],[110.4,-6.8]]),
    ("bali_lombok", "Bali & the Lesser Isles", "java", [
        [114.4,-7.7],[115.7,-8.1],[116.6,-8.4],[118.8,-8.4],[119.4,-8.8],[117.4,-9.0],[115.6,-8.8],[114.4,-8.4],[114.4,-7.7]]),
    # ---- Philippines (NE) ----
    ("luzon", "Luzon", "philippines", [
        [120.0,18.6],[121.6,18.4],[122.4,17.2],[122.0,15.8],[121.8,14.2],[120.9,13.8],[120.4,15.2],[119.8,16.4],[120.0,18.6]]),
    ("manila", "Manila & the Tagalog", "philippines", [
        [120.0,13.0],[121.0,13.6],[121.8,14.2],[122.0,13.4],[121.4,12.4],[120.6,12.6],[120.2,12.8],[120.0,13.0]]),
    ("visayas", "the Visayas", "philippines", [
        [122.0,11.6],[124.2,11.8],[125.4,11.0],[125.0,9.8],[123.4,9.2],[122.0,10.0],[122.6,11.0],[122.0,11.6]]),
    ("mindanao", "Mindanao", "philippines", [
        [121.8,7.4],[123.4,7.0],[125.4,7.0],[126.6,7.4],[126.2,9.0],[125.0,9.8],[123.4,9.2],[122.2,8.4],[121.8,7.4]]),
    ("sulu", "the Sulu Sea", "philippines", [
        [119.8,11.0],[121.2,12.0],[120.6,10.0],[121.0,8.4],[120.0,7.6],[119.4,8.6],[119.8,11.0]]),
    # ---- Sulawesi & the Spice Islands (eastern isles) ----
    ("makassar", "Makassar", "maluku_sulawesi", [
        [119.0,-5.6],[120.2,-5.4],[120.6,-4.0],[120.4,-2.6],[119.4,-3.4],[118.8,-4.6],[119.0,-5.6]]),
    ("north_sulawesi", "Minahasa", "maluku_sulawesi", [
        [120.4,-2.6],[120.6,-4.0],[121.6,-4.4],[123.2,-2.0],[125.2,1.4],[124.4,1.6],[123.0,0.4],[121.2,-0.8],[120.0,-0.6],[120.4,-2.6]]),
    ("ternate", "Ternate & Halmahera", "maluku_sulawesi", [
        [127.4,1.8],[128.6,1.6],[128.6,0.2],[127.8,-0.8],[127.4,0.4],[126.8,0.8],[127.4,1.8]]),
    ("banda_seram", "Seram & the Bandas", "maluku_sulawesi", [
        [127.8,-3.0],[129.4,-3.2],[130.8,-3.4],[130.6,-2.4],[129.0,-2.6],[127.8,-2.6],[127.8,-3.0]]),
    # ---- Siam (Thai mainland, N-center) ----
    ("ayutthaya", "Ayutthaya", "siam", [
        [98.6,18.6],[100.6,18.0],[101.4,16.4],[101.0,14.4],[100.0,13.4],[99.4,15.0],[98.8,16.8],[98.6,18.6]]),
    ("tenasserim", "the Tenasserim Coast", "siam", [
        [98.4,12.6],[99.6,12.2],[100.4,8.6],[101.2,6.6],[100.2,6.6],[99.0,9.4],[98.4,11.0],[98.4,12.6]]),
    # ---- Vietnam & Champa (Indochina east coast) ----
    ("dai_viet", "Đại Việt", "vietnam_champa", [
        [102.6,22.6],[105.8,22.6],[107.0,21.2],[106.6,20.0],[105.6,18.8],[104.4,18.6],[103.2,20.6],[102.6,22.6]]),
    ("champa", "Champa", "vietnam_champa", [
        [105.6,18.8],[106.6,20.0],[109.4,13.6],[109.2,11.0],[106.6,10.4],[105.0,12.0],[104.4,14.6],[105.6,18.8]]),
    ("khmer", "the Khmer Delta", "vietnam_champa", [
        [104.0,11.6],[106.6,10.4],[106.0,8.8],[104.4,9.6],[103.0,11.0],[104.0,11.6]]),
    # ---- Burma (western mainland) ----
    ("ava", "Ava & the Irrawaddy", "burma", [
        [94.0,22.8],[96.6,22.4],[98.4,21.6],[98.6,18.6],[96.4,17.0],[95.0,18.8],[93.8,20.6],[94.0,22.8]]),
    ("pegu", "Pegu & the Delta", "burma", [
        [95.0,18.8],[96.4,17.0],[98.6,16.8],[98.4,14.0],[97.4,15.4],[95.6,15.8],[94.4,17.4],[95.0,18.8]]),
    ("arakan", "Arakan", "burma", [
        [92.4,21.0],[93.8,20.6],[95.0,18.8],[94.4,17.4],[93.4,18.4],[92.6,19.6],[92.4,21.0]]),
]

C = [
    # === Mainland LAND links ===
    # Burma internal
    ("ava","pegu","land"),("ava","arakan","land"),("pegu","arakan","land"),
    # Burma - Siam
    ("ava","ayutthaya","land"),("pegu","ayutthaya","land"),("pegu","tenasserim","land"),
    # Siam internal
    ("ayutthaya","tenasserim","land"),
    # Siam - Indochina
    ("ayutthaya","dai_viet","land"),("ayutthaya","champa","land"),("ayutthaya","khmer","land"),
    # Indochina internal
    ("dai_viet","champa","land"),("champa","khmer","land"),
    # Malay peninsula land chain (Siam down into Malaya)
    ("tenasserim","kedah","land"),("kedah","pahang","land"),("pahang","johor","land"),

    # === SEA links ===
    # Strait of Malacca: Sumatra <-> Malaya
    ("aceh","kedah","sea"),("batak","kedah","sea"),("minangkabau","pahang","sea"),
    ("palembang","johor","sea"),
    # Andaman / Bay of Bengal: Burma/Siam <-> Sumatra
    ("arakan","aceh","sea"),("tenasserim","aceh","sea"),
    # Sumatra internal sea-ish coast (kept as land along the island spine)
    ("aceh","batak","land"),("batak","minangkabau","land"),("minangkabau","palembang","land"),
    ("palembang","lampung","land"),
    # Sunda Strait: Sumatra <-> Java
    ("lampung","banten","sea"),("palembang","banten","sea"),
    # Java island chain (land along the island)
    ("banten","mataram","land"),("mataram","majapahit","land"),("majapahit","bali_lombok","land"),
    # Java Sea: Java <-> Borneo
    ("majapahit","south_borneo","sea"),("mataram","south_borneo","sea"),("majapahit","west_borneo","sea"),
    # Karimata Strait: Sumatra <-> Borneo
    ("palembang","west_borneo","sea"),
    # Borneo internal land
    ("west_borneo","south_borneo","land"),("west_borneo","brunei_sarawak","land"),
    ("brunei_sarawak","sabah","land"),("brunei_sarawak","east_borneo","land"),
    ("east_borneo","sabah","land"),("east_borneo","south_borneo","land"),
    # Makassar Strait: Borneo <-> Sulawesi
    ("south_borneo","makassar","sea"),("east_borneo","makassar","sea"),("east_borneo","north_sulawesi","sea"),
    # Sulawesi internal
    ("makassar","north_sulawesi","land"),
    # Bali/Lesser isles <-> Sulawesi (Flores/Banda seas)
    ("bali_lombok","makassar","sea"),
    # Sulawesi <-> the Spice Islands (Molucca / Banda seas)
    ("north_sulawesi","ternate","sea"),("north_sulawesi","banda_seram","sea"),
    ("makassar","banda_seram","sea"),("ternate","banda_seram","sea"),
    # Bali <-> Spice Islands (Banda Sea)
    ("bali_lombok","banda_seram","sea"),
    # Sulu / Celebes Sea: Sabah <-> Sulu <-> Philippines
    ("sabah","sulu","sea"),("sabah","mindanao","sea"),("ternate","mindanao","sea"),
    # Philippines internal seas
    ("sulu","mindanao","sea"),("sulu","visayas","sea"),("sulu","manila","sea"),
    ("mindanao","visayas","sea"),("visayas","manila","sea"),("manila","luzon","sea"),
    # North Sulawesi <-> Mindanao (Celebes Sea)
    ("north_sulawesi","mindanao","sea"),
    # South China Sea: Malaya/Borneo <-> Philippines / Champa
    ("johor","west_borneo","sea"),("pahang","brunei_sarawak","sea"),
    # Champa <-> Philippines / Borneo across the South China Sea
    ("champa","sabah","sea"),("khmer","johor","sea"),
]

# Real-world admin geometry. HYBRID: iso_codes for the mainland rim (Burma/Siam/
# Indochina) where only whole-country Natural Earth polygons are available, and
# admin1 ISO 3166-2 codes for the archipelago (Indonesia provinces, Malaysian
# states, Philippine provinces). Brunei & Singapore are whole-country iso_codes.
ADMIN = {
    # ---- Sumatra (ID provinces) ----
    "aceh":        {"admin1": ["ID-AC"]},
    "batak":       {"admin1": ["ID-SU"]},
    "minangkabau": {"admin1": ["ID-SB", "ID-RI", "ID-KR"]},
    "palembang":   {"admin1": ["ID-SS", "ID-JA", "ID-BB"]},
    "lampung":     {"admin1": ["ID-LA", "ID-BE"]},
    # ---- Malay peninsula (MY states + Singapore) ----
    "kedah":  {"admin1": ["MY-02", "MY-08", "MY-09", "MY-07", "MY-03"]},
    "pahang": {"admin1": ["MY-06", "MY-11", "MY-10", "MY-14", "MY-16", "MY-05", "MY-04"]},
    "johor":  {"admin1": ["MY-01"], "iso_codes": ["SG"]},
    # ---- Borneo (MY Sabah/Sarawak + Brunei + ID Kalimantan) ----
    "brunei_sarawak": {"admin1": ["MY-13"], "iso_codes": ["BN"]},
    "sabah":          {"admin1": ["MY-12", "MY-15"]},
    "west_borneo":    {"admin1": ["ID-KB"]},
    "south_borneo":   {"admin1": ["ID-KS", "ID-KT"]},
    "east_borneo":    {"admin1": ["ID-KI", "ID-KU"]},
    # ---- Java (ID provinces) ----
    "banten":      {"admin1": ["ID-BT", "ID-JK", "ID-JB"]},
    "mataram":     {"admin1": ["ID-JT", "ID-YO"]},
    "majapahit":   {"admin1": ["ID-JI"]},
    "bali_lombok": {"admin1": ["ID-BA", "ID-NB", "ID-NT"]},
    # ---- Philippines (PH provinces, grouped Luzon/Visayas/Mindanao/Sulu) ----
    "luzon":  {"admin1": ["PH-ABR", "PH-APA", "PH-AUR", "PH-BAN", "PH-BEN", "PH-BTN",
                          "PH-BUL", "PH-CAG", "PH-IFU", "PH-ILN", "PH-ILS", "PH-ISA",
                          "PH-KAL", "PH-LUN", "PH-MOU", "PH-NUE", "PH-NUV", "PH-PAM",
                          "PH-PAN", "PH-QUI", "PH-TAR", "PH-ZMB"]},
    "manila": {"admin1": ["PH-BTG", "PH-CAV", "PH-LAG", "PH-QUE", "PH-RIZ", "PH-MAD",
                          "PH-MDC", "PH-MDR", "PH-ROM", "PH-ALB", "PH-CAN", "PH-CAS",
                          "PH-CAT", "PH-MAS", "PH-SOR"]},
    "visayas": {"admin1": ["PH-AKL", "PH-ANT", "PH-BIL", "PH-BOH", "PH-CAP", "PH-CEB",
                           "PH-EAS", "PH-GUI", "PH-ILI", "PH-LEY", "PH-NEC", "PH-NER",
                           "PH-NSA", "PH-SIG", "PH-SLE", "PH-WSA"]},
    "mindanao": {"admin1": ["PH-AGN", "PH-AGS", "PH-BUK", "PH-CAM", "PH-COM", "PH-DAO",
                            "PH-DAS", "PH-DAV", "PH-DIN", "PH-LAN", "PH-LAS", "PH-MAG",
                            "PH-MSC", "PH-MSR", "PH-NCO", "PH-SAR", "PH-SCO", "PH-SUK",
                            "PH-SUN", "PH-SUR", "PH-ZAN", "PH-ZAS", "PH-ZSI"]},
    "sulu": {"admin1": ["PH-BAS", "PH-PLW", "PH-SLU", "PH-TAW"]},
    # ---- Sulawesi & the Spice Islands (ID provinces) ----
    "makassar":       {"admin1": ["ID-SN", "ID-SR", "ID-SG"]},
    "north_sulawesi": {"admin1": ["ID-SA", "ID-GO", "ID-ST"]},
    "ternate":        {"admin1": ["ID-MU"]},
    "banda_seram":    {"admin1": ["ID-MA", "ID-PA", "ID-PB"]},
    # ---- Siam (whole-country) ----
    "ayutthaya":  {"iso_codes": ["TH"]},
    "tenasserim": {"iso_codes": ["TH"]},
    # ---- Vietnam & Champa / Khmer (whole-country) ----
    "dai_viet": {"iso_codes": ["VN", "LA"]},
    "champa":   {"iso_codes": ["VN"]},
    "khmer":    {"iso_codes": ["KH"]},
    # ---- Burma (whole-country) ----
    "ava":    {"iso_codes": ["MM"]},
    "pegu":   {"iso_codes": ["MM"]},
    "arakan": {"iso_codes": ["MM"]},
}

if __name__ == "__main__":
    build_map(
        map_id="community_nusantara",
        name="Maritime Southeast Asia",
        description=(
            "The great archipelago of Nusantara and its mainland rim — Srivijaya's "
            "Sumatra, Majapahit's Java, the jungled mass of Borneo, the Malay peninsula "
            "guarding the Strait of Malacca, the scattered Philippine isles, Sulawesi and "
            "the spice-rich Moluccas, and the Indochinese kingdoms of Burma, Siam, Đại "
            "Việt and Champa. A theater ruled by the sea: whoever holds the straits holds "
            "the trade winds, and every island is won or lost by fleet."
        ),
        bounds=BOUNDS,
        regions=REGIONS,
        territories=T,
        connections=C,
        globe_view={"center_lat": 2.0, "center_lng": 114.0, "altitude": 1.0},
        admin_refs=ADMIN,
    )
