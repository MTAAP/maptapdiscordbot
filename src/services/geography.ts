import fs from 'fs';
import path from 'path';

export interface CountryMetadata {
    code: string;
    name: string;
    continent: string;
    subregion: string;
}

export interface ClassifiedLocation {
    countryCode: string;
    countryName: string;
    continent: string;
    subregion: string;
}

interface GeoJsonFeature {
    properties: {
        name?: string;
        NAME?: string;
        iso2?: string;
    };
    geometry:
        | { type: 'Polygon'; coordinates: number[][][] }
        | { type: 'MultiPolygon'; coordinates: number[][][][] };
}

const COUNTRIES: Record<string, { name: string; continent: string; subregion: string }> = {
    // Western Europe
    AT: { name: 'Austria', continent: 'Europe', subregion: 'Western Europe' },
    BE: { name: 'Belgium', continent: 'Europe', subregion: 'Western Europe' },
    CH: { name: 'Switzerland', continent: 'Europe', subregion: 'Western Europe' },
    DE: { name: 'Germany', continent: 'Europe', subregion: 'Western Europe' },
    FR: { name: 'France', continent: 'Europe', subregion: 'Western Europe' },
    LI: { name: 'Liechtenstein', continent: 'Europe', subregion: 'Western Europe' },
    LU: { name: 'Luxembourg', continent: 'Europe', subregion: 'Western Europe' },
    MC: { name: 'Monaco', continent: 'Europe', subregion: 'Western Europe' },
    NL: { name: 'Netherlands', continent: 'Europe', subregion: 'Western Europe' },

    // Northern Europe
    DK: { name: 'Denmark', continent: 'Europe', subregion: 'Northern Europe' },
    EE: { name: 'Estonia', continent: 'Europe', subregion: 'Northern Europe' },
    FI: { name: 'Finland', continent: 'Europe', subregion: 'Northern Europe' },
    FO: { name: 'Faroe Islands', continent: 'Europe', subregion: 'Northern Europe' },
    GB: { name: 'United Kingdom', continent: 'Europe', subregion: 'Northern Europe' },
    IE: { name: 'Ireland', continent: 'Europe', subregion: 'Northern Europe' },
    IS: { name: 'Iceland', continent: 'Europe', subregion: 'Northern Europe' },
    LT: { name: 'Lithuania', continent: 'Europe', subregion: 'Northern Europe' },
    LV: { name: 'Latvia', continent: 'Europe', subregion: 'Northern Europe' },
    NO: { name: 'Norway', continent: 'Europe', subregion: 'Northern Europe' },
    SE: { name: 'Sweden', continent: 'Europe', subregion: 'Northern Europe' },

    // Southern Europe
    AD: { name: 'Andorra', continent: 'Europe', subregion: 'Southern Europe' },
    AL: { name: 'Albania', continent: 'Europe', subregion: 'Southern Europe' },
    BA: { name: 'Bosnia and Herzegovina', continent: 'Europe', subregion: 'Southern Europe' },
    ES: { name: 'Spain', continent: 'Europe', subregion: 'Southern Europe' },
    GI: { name: 'Gibraltar', continent: 'Europe', subregion: 'Southern Europe' },
    GR: { name: 'Greece', continent: 'Europe', subregion: 'Southern Europe' },
    HR: { name: 'Croatia', continent: 'Europe', subregion: 'Southern Europe' },
    IT: { name: 'Italy', continent: 'Europe', subregion: 'Southern Europe' },
    ME: { name: 'Montenegro', continent: 'Europe', subregion: 'Southern Europe' },
    MK: { name: 'North Macedonia', continent: 'Europe', subregion: 'Southern Europe' },
    MT: { name: 'Malta', continent: 'Europe', subregion: 'Southern Europe' },
    PT: { name: 'Portugal', continent: 'Europe', subregion: 'Southern Europe' },
    RS: { name: 'Serbia', continent: 'Europe', subregion: 'Southern Europe' },
    SI: { name: 'Slovenia', continent: 'Europe', subregion: 'Southern Europe' },
    SM: { name: 'San Marino', continent: 'Europe', subregion: 'Southern Europe' },
    VA: { name: 'Vatican City', continent: 'Europe', subregion: 'Southern Europe' },
    XK: { name: 'Kosovo', continent: 'Europe', subregion: 'Southern Europe' },

    // Eastern Europe
    BG: { name: 'Bulgaria', continent: 'Europe', subregion: 'Eastern Europe' },
    BY: { name: 'Belarus', continent: 'Europe', subregion: 'Eastern Europe' },
    CZ: { name: 'Czechia', continent: 'Europe', subregion: 'Eastern Europe' },
    HU: { name: 'Hungary', continent: 'Europe', subregion: 'Eastern Europe' },
    MD: { name: 'Moldova', continent: 'Europe', subregion: 'Eastern Europe' },
    PL: { name: 'Poland', continent: 'Europe', subregion: 'Eastern Europe' },
    RO: { name: 'Romania', continent: 'Europe', subregion: 'Eastern Europe' },
    RU: { name: 'Russia', continent: 'Europe', subregion: 'Eastern Europe' },
    SK: { name: 'Slovakia', continent: 'Europe', subregion: 'Eastern Europe' },
    UA: { name: 'Ukraine', continent: 'Europe', subregion: 'Eastern Europe' },

    // Northern America
    BM: { name: 'Bermuda', continent: 'North America', subregion: 'Northern America' },
    CA: { name: 'Canada', continent: 'North America', subregion: 'Northern America' },
    GL: { name: 'Greenland', continent: 'North America', subregion: 'Northern America' },
    US: { name: 'United States', continent: 'North America', subregion: 'Northern America' },

    // Central America
    BZ: { name: 'Belize', continent: 'North America', subregion: 'Central America' },
    CR: { name: 'Costa Rica', continent: 'North America', subregion: 'Central America' },
    GT: { name: 'Guatemala', continent: 'North America', subregion: 'Central America' },
    HN: { name: 'Honduras', continent: 'North America', subregion: 'Central America' },
    MX: { name: 'Mexico', continent: 'North America', subregion: 'Central America' },
    NI: { name: 'Nicaragua', continent: 'North America', subregion: 'Central America' },
    PA: { name: 'Panama', continent: 'North America', subregion: 'Central America' },
    SV: { name: 'El Salvador', continent: 'North America', subregion: 'Central America' },

    // Caribbean
    AG: { name: 'Antigua and Barbuda', continent: 'North America', subregion: 'Caribbean' },
    AW: { name: 'Aruba', continent: 'North America', subregion: 'Caribbean' },
    BB: { name: 'Barbados', continent: 'North America', subregion: 'Caribbean' },
    BS: { name: 'Bahamas', continent: 'North America', subregion: 'Caribbean' },
    CU: { name: 'Cuba', continent: 'North America', subregion: 'Caribbean' },
    CW: { name: 'Curaçao', continent: 'North America', subregion: 'Caribbean' },
    DM: { name: 'Dominica', continent: 'North America', subregion: 'Caribbean' },
    DO: { name: 'Dominican Republic', continent: 'North America', subregion: 'Caribbean' },
    GD: { name: 'Grenada', continent: 'North America', subregion: 'Caribbean' },
    GP: { name: 'Guadeloupe', continent: 'North America', subregion: 'Caribbean' },
    HT: { name: 'Haiti', continent: 'North America', subregion: 'Caribbean' },
    JM: { name: 'Jamaica', continent: 'North America', subregion: 'Caribbean' },
    KN: { name: 'Saint Kitts and Nevis', continent: 'North America', subregion: 'Caribbean' },
    LC: { name: 'Saint Lucia', continent: 'North America', subregion: 'Caribbean' },
    MQ: { name: 'Martinique', continent: 'North America', subregion: 'Caribbean' },
    PR: { name: 'Puerto Rico', continent: 'North America', subregion: 'Caribbean' },
    TT: { name: 'Trinidad and Tobago', continent: 'North America', subregion: 'Caribbean' },
    VC: { name: 'Saint Vincent and the Grenadines', continent: 'North America', subregion: 'Caribbean' },
    VI: { name: 'U.S. Virgin Islands', continent: 'North America', subregion: 'Caribbean' },

    // South America
    AR: { name: 'Argentina', continent: 'South America', subregion: 'South America' },
    BO: { name: 'Bolivia', continent: 'South America', subregion: 'South America' },
    BR: { name: 'Brazil', continent: 'South America', subregion: 'South America' },
    CL: { name: 'Chile', continent: 'South America', subregion: 'South America' },
    CO: { name: 'Colombia', continent: 'South America', subregion: 'South America' },
    EC: { name: 'Ecuador', continent: 'South America', subregion: 'South America' },
    FK: { name: 'Falkland Islands', continent: 'South America', subregion: 'South America' },
    GF: { name: 'French Guiana', continent: 'South America', subregion: 'South America' },
    GY: { name: 'Guyana', continent: 'South America', subregion: 'South America' },
    PE: { name: 'Peru', continent: 'South America', subregion: 'South America' },
    PY: { name: 'Paraguay', continent: 'South America', subregion: 'South America' },
    SR: { name: 'Suriname', continent: 'South America', subregion: 'South America' },
    UY: { name: 'Uruguay', continent: 'South America', subregion: 'South America' },
    VE: { name: 'Venezuela', continent: 'South America', subregion: 'South America' },

    // East Asia
    CN: { name: 'China', continent: 'Asia', subregion: 'East Asia' },
    HK: { name: 'Hong Kong', continent: 'Asia', subregion: 'East Asia' },
    JP: { name: 'Japan', continent: 'Asia', subregion: 'East Asia' },
    KP: { name: 'North Korea', continent: 'Asia', subregion: 'East Asia' },
    KR: { name: 'South Korea', continent: 'Asia', subregion: 'East Asia' },
    MN: { name: 'Mongolia', continent: 'Asia', subregion: 'East Asia' },
    MO: { name: 'Macau', continent: 'Asia', subregion: 'East Asia' },
    TW: { name: 'Taiwan', continent: 'Asia', subregion: 'East Asia' },

    // Southeast Asia
    BN: { name: 'Brunei', continent: 'Asia', subregion: 'Southeast Asia' },
    ID: { name: 'Indonesia', continent: 'Asia', subregion: 'Southeast Asia' },
    KH: { name: 'Cambodia', continent: 'Asia', subregion: 'Southeast Asia' },
    LA: { name: 'Laos', continent: 'Asia', subregion: 'Southeast Asia' },
    MM: { name: 'Myanmar', continent: 'Asia', subregion: 'Southeast Asia' },
    MY: { name: 'Malaysia', continent: 'Asia', subregion: 'Southeast Asia' },
    PH: { name: 'Philippines', continent: 'Asia', subregion: 'Southeast Asia' },
    SG: { name: 'Singapore', continent: 'Asia', subregion: 'Southeast Asia' },
    TH: { name: 'Thailand', continent: 'Asia', subregion: 'Southeast Asia' },
    TL: { name: 'Timor-Leste', continent: 'Asia', subregion: 'Southeast Asia' },
    VN: { name: 'Vietnam', continent: 'Asia', subregion: 'Southeast Asia' },

    // South Asia
    AF: { name: 'Afghanistan', continent: 'Asia', subregion: 'South Asia' },
    BD: { name: 'Bangladesh', continent: 'Asia', subregion: 'South Asia' },
    BT: { name: 'Bhutan', continent: 'Asia', subregion: 'South Asia' },
    IN: { name: 'India', continent: 'Asia', subregion: 'South Asia' },
    LK: { name: 'Sri Lanka', continent: 'Asia', subregion: 'South Asia' },
    MV: { name: 'Maldives', continent: 'Asia', subregion: 'South Asia' },
    NP: { name: 'Nepal', continent: 'Asia', subregion: 'South Asia' },
    PK: { name: 'Pakistan', continent: 'Asia', subregion: 'South Asia' },

    // West Asia
    AE: { name: 'United Arab Emirates', continent: 'Asia', subregion: 'West Asia' },
    AM: { name: 'Armenia', continent: 'Asia', subregion: 'West Asia' },
    AZ: { name: 'Azerbaijan', continent: 'Asia', subregion: 'West Asia' },
    BH: { name: 'Bahrain', continent: 'Asia', subregion: 'West Asia' },
    CY: { name: 'Cyprus', continent: 'Asia', subregion: 'West Asia' },
    GE: { name: 'Georgia', continent: 'Asia', subregion: 'West Asia' },
    IL: { name: 'Israel', continent: 'Asia', subregion: 'West Asia' },
    IQ: { name: 'Iraq', continent: 'Asia', subregion: 'West Asia' },
    IR: { name: 'Iran', continent: 'Asia', subregion: 'West Asia' },
    JO: { name: 'Jordan', continent: 'Asia', subregion: 'West Asia' },
    KW: { name: 'Kuwait', continent: 'Asia', subregion: 'West Asia' },
    LB: { name: 'Lebanon', continent: 'Asia', subregion: 'West Asia' },
    OM: { name: 'Oman', continent: 'Asia', subregion: 'West Asia' },
    PS: { name: 'Palestine', continent: 'Asia', subregion: 'West Asia' },
    QA: { name: 'Qatar', continent: 'Asia', subregion: 'West Asia' },
    SA: { name: 'Saudi Arabia', continent: 'Asia', subregion: 'West Asia' },
    SY: { name: 'Syria', continent: 'Asia', subregion: 'West Asia' },
    TR: { name: 'Türkiye', continent: 'Asia', subregion: 'West Asia' },
    YE: { name: 'Yemen', continent: 'Asia', subregion: 'West Asia' },

    // Central Asia
    KG: { name: 'Kyrgyzstan', continent: 'Asia', subregion: 'Central Asia' },
    KZ: { name: 'Kazakhstan', continent: 'Asia', subregion: 'Central Asia' },
    TJ: { name: 'Tajikistan', continent: 'Asia', subregion: 'Central Asia' },
    TM: { name: 'Turkmenistan', continent: 'Asia', subregion: 'Central Asia' },
    UZ: { name: 'Uzbekistan', continent: 'Asia', subregion: 'Central Asia' },

    // North Africa
    DZ: { name: 'Algeria', continent: 'Africa', subregion: 'North Africa' },
    EG: { name: 'Egypt', continent: 'Africa', subregion: 'North Africa' },
    EH: { name: 'Western Sahara', continent: 'Africa', subregion: 'North Africa' },
    LY: { name: 'Libya', continent: 'Africa', subregion: 'North Africa' },
    MA: { name: 'Morocco', continent: 'Africa', subregion: 'North Africa' },
    SD: { name: 'Sudan', continent: 'Africa', subregion: 'North Africa' },
    TN: { name: 'Tunisia', continent: 'Africa', subregion: 'North Africa' },

    // West Africa
    BF: { name: 'Burkina Faso', continent: 'Africa', subregion: 'West Africa' },
    BJ: { name: 'Benin', continent: 'Africa', subregion: 'West Africa' },
    CI: { name: "Côte d'Ivoire", continent: 'Africa', subregion: 'West Africa' },
    CV: { name: 'Cabo Verde', continent: 'Africa', subregion: 'West Africa' },
    GH: { name: 'Ghana', continent: 'Africa', subregion: 'West Africa' },
    GM: { name: 'Gambia', continent: 'Africa', subregion: 'West Africa' },
    GN: { name: 'Guinea', continent: 'Africa', subregion: 'West Africa' },
    GW: { name: 'Guinea-Bissau', continent: 'Africa', subregion: 'West Africa' },
    LR: { name: 'Liberia', continent: 'Africa', subregion: 'West Africa' },
    ML: { name: 'Mali', continent: 'Africa', subregion: 'West Africa' },
    MR: { name: 'Mauritania', continent: 'Africa', subregion: 'West Africa' },
    NE: { name: 'Niger', continent: 'Africa', subregion: 'West Africa' },
    NG: { name: 'Nigeria', continent: 'Africa', subregion: 'West Africa' },
    SL: { name: 'Sierra Leone', continent: 'Africa', subregion: 'West Africa' },
    SN: { name: 'Senegal', continent: 'Africa', subregion: 'West Africa' },
    TG: { name: 'Togo', continent: 'Africa', subregion: 'West Africa' },

    // East Africa
    BI: { name: 'Burundi', continent: 'Africa', subregion: 'East Africa' },
    DJ: { name: 'Djibouti', continent: 'Africa', subregion: 'East Africa' },
    ER: { name: 'Eritrea', continent: 'Africa', subregion: 'East Africa' },
    ET: { name: 'Ethiopia', continent: 'Africa', subregion: 'East Africa' },
    KE: { name: 'Kenya', continent: 'Africa', subregion: 'East Africa' },
    KM: { name: 'Comoros', continent: 'Africa', subregion: 'East Africa' },
    MG: { name: 'Madagascar', continent: 'Africa', subregion: 'East Africa' },
    MU: { name: 'Mauritius', continent: 'Africa', subregion: 'East Africa' },
    MW: { name: 'Malawi', continent: 'Africa', subregion: 'East Africa' },
    MZ: { name: 'Mozambique', continent: 'Africa', subregion: 'East Africa' },
    RE: { name: 'Réunion', continent: 'Africa', subregion: 'East Africa' },
    RW: { name: 'Rwanda', continent: 'Africa', subregion: 'East Africa' },
    SC: { name: 'Seychelles', continent: 'Africa', subregion: 'East Africa' },
    SO: { name: 'Somalia', continent: 'Africa', subregion: 'East Africa' },
    SS: { name: 'South Sudan', continent: 'Africa', subregion: 'East Africa' },
    TZ: { name: 'Tanzania', continent: 'Africa', subregion: 'East Africa' },
    UG: { name: 'Uganda', continent: 'Africa', subregion: 'East Africa' },
    YT: { name: 'Mayotte', continent: 'Africa', subregion: 'East Africa' },
    ZM: { name: 'Zambia', continent: 'Africa', subregion: 'East Africa' },
    ZW: { name: 'Zimbabwe', continent: 'Africa', subregion: 'East Africa' },

    // Central Africa
    AO: { name: 'Angola', continent: 'Africa', subregion: 'Central Africa' },
    CD: { name: 'DR Congo', continent: 'Africa', subregion: 'Central Africa' },
    CF: { name: 'Central African Republic', continent: 'Africa', subregion: 'Central Africa' },
    CG: { name: 'Republic of the Congo', continent: 'Africa', subregion: 'Central Africa' },
    CM: { name: 'Cameroon', continent: 'Africa', subregion: 'Central Africa' },
    GA: { name: 'Gabon', continent: 'Africa', subregion: 'Central Africa' },
    GQ: { name: 'Equatorial Guinea', continent: 'Africa', subregion: 'Central Africa' },
    ST: { name: 'São Tomé and Príncipe', continent: 'Africa', subregion: 'Central Africa' },
    TD: { name: 'Chad', continent: 'Africa', subregion: 'Central Africa' },

    // Southern Africa
    BW: { name: 'Botswana', continent: 'Africa', subregion: 'Southern Africa' },
    LS: { name: 'Lesotho', continent: 'Africa', subregion: 'Southern Africa' },
    NA: { name: 'Namibia', continent: 'Africa', subregion: 'Southern Africa' },
    SZ: { name: 'Eswatini', continent: 'Africa', subregion: 'Southern Africa' },
    ZA: { name: 'South Africa', continent: 'Africa', subregion: 'Southern Africa' },

    // Oceania
    AU: { name: 'Australia', continent: 'Oceania', subregion: 'Australia and New Zealand' },
    NZ: { name: 'New Zealand', continent: 'Oceania', subregion: 'Australia and New Zealand' },
    FJ: { name: 'Fiji', continent: 'Oceania', subregion: 'Melanesia' },
    NC: { name: 'New Caledonia', continent: 'Oceania', subregion: 'Melanesia' },
    PG: { name: 'Papua New Guinea', continent: 'Oceania', subregion: 'Melanesia' },
    SB: { name: 'Solomon Islands', continent: 'Oceania', subregion: 'Melanesia' },
    VU: { name: 'Vanuatu', continent: 'Oceania', subregion: 'Melanesia' },
    FM: { name: 'Micronesia', continent: 'Oceania', subregion: 'Micronesia' },
    GU: { name: 'Guam', continent: 'Oceania', subregion: 'Micronesia' },
    KI: { name: 'Kiribati', continent: 'Oceania', subregion: 'Micronesia' },
    MH: { name: 'Marshall Islands', continent: 'Oceania', subregion: 'Micronesia' },
    NR: { name: 'Nauru', continent: 'Oceania', subregion: 'Micronesia' },
    PW: { name: 'Palau', continent: 'Oceania', subregion: 'Micronesia' },
    AS: { name: 'American Samoa', continent: 'Oceania', subregion: 'Polynesia' },
    PF: { name: 'French Polynesia', continent: 'Oceania', subregion: 'Polynesia' },
    TO: { name: 'Tonga', continent: 'Oceania', subregion: 'Polynesia' },
    TV: { name: 'Tuvalu', continent: 'Oceania', subregion: 'Polynesia' },
    WS: { name: 'Samoa', continent: 'Oceania', subregion: 'Polynesia' },

    // Polar & Ocean
    AQ: { name: 'Antarctica', continent: 'Antarctica', subregion: 'Antarctica' },
    TF: { name: 'French Southern Territories', continent: 'Antarctica', subregion: 'Antarctica' },
    XX: { name: 'International Waters', continent: 'International Waters', subregion: 'International Waters' },
};

const NAME_ALIASES_TO_ISO: Record<string, string> = {
    usa: 'US',
    us: 'US',
    'u.s.': 'US',
    'u.s.a.': 'US',
    'united states': 'US',
    'united states of america': 'US',
    uk: 'GB',
    'the uk': 'GB',
    'united kingdom': 'GB',
    england: 'GB',
    scotland: 'GB',
    wales: 'GB',
    'northern ireland': 'GB',
    britain: 'GB',
    'great britain': 'GB',
    uae: 'AE',
    'united arab emirates': 'AE',
    turkey: 'TR',
    'türkiye': 'TR',
    turkiye: 'TR',
    'czech republic': 'CZ',
    czechia: 'CZ',
    'ivory coast': 'CI',
    "côte d'ivoire": 'CI',
    "cote d'ivoire": 'CI',
    'cape verde': 'CV',
    'cabo verde': 'CV',
    burma: 'MM',
    myanmar: 'MM',
    swaziland: 'SZ',
    eswatini: 'SZ',
    macedonia: 'MK',
    'north macedonia': 'MK',
    'democratic republic of the congo': 'CD',
    'dr congo': 'CD',
    drc: 'CD',
    'republic of the congo': 'CG',
    'congo-brazzaville': 'CG',
    congo: 'CG',
    'federated states of micronesia': 'FM',
    micronesia: 'FM',
    'vatican city': 'VA',
    'holy see': 'VA',
    'the vatican': 'VA',
    'south korea': 'KR',
    'republic of korea': 'KR',
    'north korea': 'KP',
    'palestine state': 'PS',
    palestine: 'PS',
    'timor-leste': 'TL',
    'east timor': 'TL',
    curacao: 'CW',
    'curaçao': 'CW',
    reunion: 'RE',
    'réunion': 'RE',
    'sao tome and principe': 'ST',
    'são tomé and príncipe': 'ST',
    'the bahamas': 'BS',
    'the gambia': 'GM',
    'the netherlands': 'NL',
    holland: 'NL',
    antarctica: 'AQ',
    siberia: 'RU',
    sicily: 'IT',
    sardinia: 'IT',
    corsica: 'FR',
    crete: 'GR',
    okinawa: 'JP',
    hokkaido: 'JP',
    tasmania: 'AU',
    'french overseas territory': '',
};

const US_STATES = new Set([
    'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut',
    'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa',
    'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan',
    'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire',
    'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio',
    'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota',
    'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington', 'washington, d.c.',
    'washington d.c.', 'district of columbia', 'west virginia', 'wisconsin', 'wyoming',
]);

// Build reverse name -> ISO2 index once
const NORMALIZED_COUNTRY_LOOKUP: Map<string, string> = (() => {
    const map = new Map<string, string>();
    for (const [iso, meta] of Object.entries(COUNTRIES)) {
        map.set(meta.name.toLowerCase(), iso);
    }
    for (const [alias, iso] of Object.entries(NAME_ALIASES_TO_ISO)) {
        if (iso) map.set(alias.toLowerCase(), iso);
    }
    return map;
})();

let cachedGeoFeatures: GeoJsonFeature[] | null = null;

function loadGeoFeatures(): GeoJsonFeature[] {
    if (cachedGeoFeatures) return cachedGeoFeatures;

    const candidates = [
        path.join(__dirname, '../data/countries.geojson'),
        path.resolve(process.cwd(), 'src/data/countries.geojson'),
        path.resolve(process.cwd(), 'dist/data/countries.geojson'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { features: GeoJsonFeature[] };
            cachedGeoFeatures = parsed.features ?? [];
            return cachedGeoFeatures;
        }
    }
    throw new Error('countries.geojson asset not found in dist/data or src/data');
}

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0];
        const yi = ring[i][1];
        const xj = ring[j][0];
        const yj = ring[j][1];
        const intersect =
            yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-15) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

function pointInPolygon(lng: number, lat: number, coords: number[][][]): boolean {
    if (!pointInRing(lng, lat, coords[0])) return false;
    for (let i = 1; i < coords.length; i++) {
        if (pointInRing(lng, lat, coords[i])) return false;
    }
    return true;
}

function lookupCountryIsoByCoords(lat: number, lng: number): string | null {
    const features = loadGeoFeatures();

    for (const f of features) {
        const iso2 = (f.properties.iso2 || '').toUpperCase();
        if (!iso2) continue;
        const g = f.geometry;
        if (g.type === 'Polygon') {
            if (pointInPolygon(lng, lat, g.coordinates)) return iso2;
        } else if (g.type === 'MultiPolygon') {
            for (const poly of g.coordinates) {
                if (pointInPolygon(lng, lat, poly)) return iso2;
            }
        }
    }

    // Coastal / harbor fallback within ~1.2 deg (~130 km)
    let bestIso: string | null = null;
    let bestDistSq = 1.44;
    const cosLat = Math.cos((lat * Math.PI) / 180);

    for (const f of features) {
        const iso2 = (f.properties.iso2 || '').toUpperCase();
        if (!iso2) continue;
        const g = f.geometry;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        for (const poly of polys) {
            const ring = poly[0];
            for (let i = 0; i < ring.length; i++) {
                const dx = (ring[i][0] - lng) * cosLat;
                const dy = ring[i][1] - lat;
                const d2 = dx * dx + dy * dy;
                if (d2 < bestDistSq) {
                    bestDistSq = d2;
                    bestIso = iso2;
                }
            }
        }
    }

    return bestIso;
}

function resolveDeclaredCountryIso(token: string, lat?: number, lng?: number): string | null {
    const cleaned = token.trim().replace(/\.$/, '').toLowerCase();
    if (!cleaned) return null;

    // Special disambiguation: "Georgia" in North America is the US state; in Caucasus it's GE
    if (cleaned === 'georgia') {
        if (typeof lng === 'number' && lng < -30) return 'US';
        return 'GE';
    }

    const direct = NORMALIZED_COUNTRY_LOOKUP.get(cleaned);
    if (direct) return direct;

    if (US_STATES.has(cleaned)) {
        return 'US';
    }

    return null;
}

function extractIsoFromLocationName(name: string, lat?: number, lng?: number): string | null {
    // Check parenthetical suffix e.g. "Zanzibar (Tanzania)"
    const parenMatch = name.match(/\(([^)]+)\)\s*$/);
    if (parenMatch) {
        const fromParen = resolveDeclaredCountryIso(parenMatch[1], lat, lng);
        if (fromParen) return fromParen;
    }

    // Walk comma-separated segments from right to left e.g.
    // "Fort-de-France, Martinique, French Overseas Territory" -> skips last, matches "Martinique" -> MQ
    const parts = name
        .replace(/\([^)]*\)/g, '')
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);

    for (let i = parts.length - 1; i >= 0; i--) {
        // Only treat single-part bare names as countries when they match an exact country/territory
        if (i === 0 && parts.length === 1 && US_STATES.has(parts[0].toLowerCase())) {
            // Bare US state clue e.g. "Wyoming"
            return 'US';
        }
        const hit = resolveDeclaredCountryIso(parts[i], lat, lng);
        if (hit) return hit;
    }

    return null;
}

export function getCountryMetadata(isoCode: string): CountryMetadata {
    const upper = isoCode.toUpperCase();
    const meta = COUNTRIES[upper];
    if (meta) {
        return { code: upper, ...meta };
    }
    return {
        code: upper || 'XX',
        name: upper || 'Unknown',
        continent: 'International Waters',
        subregion: 'International Waters',
    };
}

export function countryCodeToFlag(isoCode: string): string {
    const upper = isoCode.toUpperCase();
    if (upper === 'XK' || upper === 'XX' || !/^[A-Z]{2}$/.test(upper)) {
        return '🌍';
    }
    return String.fromCodePoint(
        0x1f1e6 + upper.charCodeAt(0) - 65,
        0x1f1e6 + upper.charCodeAt(1) - 65
    );
}

export function classifyLocation(input: {
    name: string;
    lat: number;
    lng: number;
    country?: string;
    highlight?: string;
}): ClassifiedLocation {
    let iso: string | null = null;

    if (input.highlight && input.highlight.trim().toLowerCase() !== 'none') {
        iso = resolveDeclaredCountryIso(input.highlight, input.lat, input.lng);
    }
    if (!iso && input.country) {
        iso = resolveDeclaredCountryIso(input.country, input.lat, input.lng);
    }
    if (!iso) {
        iso = extractIsoFromLocationName(input.name, input.lat, input.lng);
    }
    if (!iso && Number.isFinite(input.lat) && Number.isFinite(input.lng)) {
        iso = lookupCountryIsoByCoords(input.lat, input.lng);
    }
    if (!iso) {
        iso = input.lat <= -60 ? 'AQ' : 'XX';
    }

    // Russia maps to Eastern Europe / Europe under UN M49 country-level classification.
    const meta = getCountryMetadata(iso);
    return {
        countryCode: meta.code,
        countryName: meta.name,
        continent: meta.continent,
        subregion: meta.subregion,
    };
}

export function findCountryIsoByQuery(query: string): string | null {
    const trimmed = query.trim();
    if (/^[a-z]{2}$/i.test(trimmed)) {
        const upper = trimmed.toUpperCase();
        if (COUNTRIES[upper]) return upper;
    }
    return NORMALIZED_COUNTRY_LOOKUP.get(trimmed.toLowerCase()) ?? null;
}
