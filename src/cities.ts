/** Approximate city-center coordinates, ported from liveview-backend/lib/cityCoordinates.js */
export const CITY_COORDS: Record<string, [number, number]> = {
  "pebble beach,ca": [
    36.5664,
    -121.9486
  ],
  "augusta,ga": [
    33.4735,
    -82.0105
  ],
  "ponte vedra beach,fl": [
    30.2397,
    -81.3856
  ],
  "la jolla,ca": [
    32.8473,
    -117.2742
  ],
  "farmingdale,ny": [
    40.7326,
    -73.4454
  ],
  "haven,wi": [
    43.7072,
    -87.7829
  ],
  "kiawah island,sc": [
    32.6082,
    -80.0848
  ],
  "bandon,or": [
    43.119,
    -124.4084
  ],
  "university place,wa": [
    47.2357,
    -122.5515
  ],
  "oakmont,pa": [
    40.5217,
    -79.8414
  ],
  "mamaroneck,ny": [
    40.9487,
    -73.7326
  ],
  "southampton,ny": [
    40.8843,
    -72.3895
  ],
  "ardmore,pa": [
    40.0068,
    -75.2855
  ],
  "pacific palisades,ca": [
    34.0459,
    -118.5265
  ],
  "dublin,oh": [
    40.0992,
    -83.1141
  ],
  "atlanta,ga": [
    33.749,
    -84.388
  ],
  "charlotte,nc": [
    35.2271,
    -80.8431
  ],
  "bethesda,md": [
    38.9847,
    -77.0947
  ],
  "chaska,mn": [
    44.8053,
    -93.6002
  ],
  "tulsa,ok": [
    36.154,
    -95.9928
  ],
  "olympia fields,il": [
    41.5184,
    -87.6945
  ],
  "medinah,il": [
    41.975,
    -88.037
  ],
  "springfield,nj": [
    40.704,
    -74.3243
  ],
  "pittsford,ny": [
    43.0906,
    -77.515
  ],
  "pinehurst,nc": [
    35.1954,
    -79.4695
  ],
  "hilton head island,sc": [
    32.2163,
    -80.7526
  ],
  "orlando,fl": [
    28.5383,
    -81.3792
  ],
  "honolulu,hi": [
    21.3069,
    -157.8583
  ],
  "lahaina,hi": [
    20.8783,
    -156.6825
  ],
  "scottsdale,az": [
    33.4942,
    -111.9261
  ],
  "fort mcdowell,az": [
    33.5823,
    -111.6812
  ],
  "san tan valley,az": [
    33.1889,
    -111.5615
  ],
  "akron,oh": [
    41.0814,
    -81.519
  ],
  "fort worth,tx": [
    32.7555,
    -97.3308
  ],
  "louisville,ky": [
    38.2527,
    -85.7585
  ],
  "erin,wi": [
    43.1683,
    -88.3259
  ],
  "jersey city,nj": [
    40.7178,
    -74.0431
  ],
  "miami,fl": [
    25.7617,
    -80.1918
  ],
  "bowling green,fl": [
    27.6386,
    -81.9748
  ],
  "nekoosa,wi": [
    44.3125,
    -89.904
  ],
  "hutchinson,ks": [
    38.0608,
    -97.9298
  ],
  "edina,mn": [
    44.8897,
    -93.3499
  ],
  "cherry hills village,co": [
    39.6417,
    -104.9597
  ],
  "castle rock,co": [
    39.3722,
    -104.8561
  ],
  "north las vegas,nv": [
    36.1989,
    -115.1175
  ],
  "mesquite,nv": [
    36.8055,
    -114.0672
  ],
  "santa cruz,ca": [
    36.9741,
    -122.0308
  ],
  "juno beach,fl": [
    26.8436,
    -80.0584
  ],
  "los angeles,ca": [
    34.0522,
    -118.2437
  ],
  "phoenix,az": [
    33.4484,
    -112.074
  ],
  "san diego,ca": [
    32.7157,
    -117.1611
  ],
  "san francisco,ca": [
    37.7749,
    -122.4194
  ],
  "austin,tx": [
    30.2672,
    -97.7431
  ],
  "dallas,tx": [
    32.7767,
    -96.797
  ],
  "houston,tx": [
    29.7604,
    -95.3698
  ],
  "tampa,fl": [
    27.9506,
    -82.4572
  ],
  "chicago,il": [
    41.8781,
    -87.6298
  ],
  "denver,co": [
    39.7392,
    -104.9903
  ],
  "seattle,wa": [
    47.6062,
    -122.3321
  ],
  "portland,or": [
    45.5152,
    -122.6784
  ],
  "las vegas,nv": [
    36.1699,
    -115.1398
  ],
  "boston,ma": [
    42.3601,
    -71.0589
  ],
  "new york,ny": [
    40.7128,
    -74.006
  ],
  "philadelphia,pa": [
    39.9526,
    -75.1652
  ],
  "nashville,tn": [
    36.1627,
    -86.7816
  ],
  "minneapolis,mn": [
    44.9778,
    -93.265
  ],
  "detroit,mi": [
    42.3314,
    -83.0458
  ],
  "sunnyvale,ca": [
    37.3688,
    -122.0363
  ],
  "millbrae,ca": [
    37.5985,
    -122.3872
  ]
};

export function coordsForCity(city = '', state = '') {
  const key = `${String(city).trim().toLowerCase()},${String(state).trim().toLowerCase()}`;
  const hit = CITY_COORDS[key];
  if (hit) return { latitude: hit[0], longitude: hit[1] };
  const stateOnly = Object.entries(CITY_COORDS).find(([k]) => k.endsWith(`,${String(state).trim().toLowerCase()}`));
  if (stateOnly) return { latitude: stateOnly[1][0], longitude: stateOnly[1][1] };
  return { latitude: 39.8283, longitude: -98.5795 };
}
