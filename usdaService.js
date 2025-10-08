const admin = require('firebase-admin');
const axios = require('axios');
require('dotenv').config();

// USDA API configuration
const USDA_API_KEY = process.env.USDA_API_KEY || '';
const BASE_URL = "https://api.nal.usda.gov/fdc/v1";

// Essential nutrients with aliases and legacy conversion
const ESSENTIAL_NUTRIENTS_DATA = [
  // --- MACRONUTRIENTS ---
  { nutrientName: 'Energy', aliases: ['Energy'], label: 'Energy', value: 0, unitName: 'kcal', dailyValueMen: 2500, dailyValueWomen: 2000 },
  { nutrientName: 'Protein', aliases: ['Protein', 'Protein (g)'], label: 'Protein', value: 0, unitName: 'g', dailyValueMen: 98, dailyValueWomen: 77 },
  { nutrientName: 'Total lipid (fat)', aliases: ['Total lipid (fat)', 'Total Fat'], label: 'Fat', value: 0, unitName: 'g', dailyValueMen: 70, dailyValueWomen: 70 },
  { nutrientName: 'Carbohydrate, by difference', aliases: ['Carbohydrate, by difference', 'Carbohydrate, by summation'], label: 'Carbs', value: 0, unitName: 'g', dailyValueMen: 300, dailyValueWomen: 300 },
  { nutrientName: 'Fiber, total dietary', aliases: ['Fiber, total dietary', 'Total dietary fiber'], label: 'Fiber', value: 0, unitName: 'g', dailyValueMen: 38, dailyValueWomen: 25 },
  { nutrientName: 'Sugars, Total', aliases: ['Sugars, Total', 'Total sugars', 'Sugars, total including NLEA'], label: 'Sugars', value: 0, unitName: 'g', dailyValueMen: 36, dailyValueWomen: 25 },

  // --- MINERALS ---
  { nutrientName: 'Calcium, Ca', aliases: ['Calcium, Ca', 'Calcium'], label: 'Calcium', value: 0, unitName: 'mg', dailyValueMen: 1000, dailyValueWomen: 1000 },
  { nutrientName: 'Iron, Fe', aliases: ['Iron, Fe', 'Iron'], label: 'Iron', value: 0, unitName: 'mg', dailyValueMen: 8, dailyValueWomen: 18 },
  { nutrientName: 'Magnesium, Mg', aliases: ['Magnesium, Mg', 'Magnesium'], label: 'Magnesium', value: 0, unitName: 'mg', dailyValueMen: 400, dailyValueWomen: 310 },
  { nutrientName: 'Potassium, K', aliases: ['Potassium, K', 'Potassium'], label: 'Potassium', value: 0, unitName: 'mg', dailyValueMen: 3400, dailyValueWomen: 2600 },
  { nutrientName: 'Sodium, Na', aliases: ['Sodium, Na', 'Sodium'], label: 'Sodium', value: 0, unitName: 'mg', dailyValueMen: 2300, dailyValueWomen: 2300 },
  { nutrientName: 'Zinc, Zn', aliases: ['Zinc, Zn', 'Zinc'], label: 'Zinc', value: 0, unitName: 'mg', dailyValueMen: 11, dailyValueWomen: 8 },

  // --- VITAMINS ---
  {
    nutrientName: 'Vitamin A, RAE',
    aliases: ['Vitamin A, IU'],
    label: 'Vit A',
    unitName: 'µg',
    dailyValueMen: 900,
    dailyValueWomen: 700,
    value: 0,
    legacyConversion: { fromUnit: 'IU', toUnit: 'µg', formula: (val) => val / 3.33 },
  },
  { nutrientName: 'Vitamin C, total ascorbic acid', aliases: ['Ascorbic acid'], label: 'Vit C', unitName: 'mg', dailyValueMen: 90, dailyValueWomen: 75, value: 0 },
  {
    nutrientName: 'Vitamin D (D2 + D3)',
    aliases: ['Vitamin D', 'Vitamin D, IU'],
    label: 'Vit D',
    unitName: 'µg',
    dailyValueMen: 15,
    dailyValueWomen: 15,
    value: 0,
    legacyConversion: { fromUnit: 'IU', toUnit: 'µg', formula: (val) => val * 0.025 },
  },
  {
    nutrientName: 'Vitamin E (alpha-tocopherol)',
    aliases: ['Vitamin E, IU'],
    label: 'Vit E',
    unitName: 'mg',
    dailyValueMen: 15,
    dailyValueWomen: 15,
    value: 0,
    legacyConversion: { fromUnit: 'IU', toUnit: 'mg', formula: (val) => val * 0.67 },
  },
  { nutrientName: 'Vitamin K (phylloquinone)', aliases: ['Vitamin K'], label: 'Vit K', unitName: 'µg', dailyValueMen: 120, dailyValueWomen: 90, value: 0 },
  { nutrientName: 'Vitamin B-6', aliases: ['Vitamin B-6', 'Pyridoxine'], label: 'Vit B6', unitName: 'mg', dailyValueMen: 1.7, dailyValueWomen: 1.5, value: 0 },
  { nutrientName: 'Vitamin B-12', aliases: ['Vitamin B-12', 'Cobalamin'], label: 'Vit B12', unitName: 'µg', dailyValueMen: 2.4, dailyValueWomen: 2.4, value: 0 },
];

// Cache TTL in days (not currently used)
const CACHE_TTL_DAYS = parseInt(process.env.USDA_CACHE_TTL_DAYS || '0', 10);


/**
 * Normalize a string for comparison: lowercase, remove non-alphanumeric
 * @param {*} s 
 * @returns 
 */
function normalizeName(s) {
  if (!s) return '';
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Parse a nutrient entry from USDA data
 * @param {*} entry 
 * @returns 
 */
function parseNutrientEntry(entry) {
  let name = entry.nutrientName || entry.name || (entry.nutrient && (entry.nutrient.name || entry.nutrient.nutrientName)) || '';
  let value = entry.value ?? entry.amount ?? (entry.nutrient && (entry.nutrient.amount ?? entry.nutrient.value)) ?? null;
  let unitName = entry.unitName || (entry.nutrient && entry.nutrient.unitName) || entry.unit || null;

  if (value !== null) {
    const parsed = Number(value);
    value = Number.isFinite(parsed) ? parsed : value;
  }

  return { name: String(name), value, unitName };
}

/**
 * Apply legacy conversion if applicable
 * @param {*} value 
 * @param {*} unitName 
 * @param {*} essential 
 * @returns 
 */
function applyLegacyConversion(value, unitName, essential) {
  if (essential.legacyConversion && unitName === essential.legacyConversion.fromUnit) {
    return essential.legacyConversion.formula(value);
  }
  return value;
}

/**
 *  Extract essential nutrients from a USDA food item
 * @param {*} foodItem 
 * @returns 
 */
function extractEssentialNutrients(foodItem) {
  const result = [];
  const nutrientsArr = foodItem.foodNutrients || [];

  const seenPrimary = new Set();

  for (const entry of nutrientsArr) {
    const { name, value, unitName } = parseNutrientEntry(entry);
    if (!name) continue;

    let essential = null;

    // First try to match primary name
    for (const e of ESSENTIAL_NUTRIENTS_DATA) {
      if (normalizeName(e.nutrientName) === normalizeName(name)) {
        essential = e;
        break;
      }
    }

    // Then try aliases if no primary match
    if (!essential) {
      for (const e of ESSENTIAL_NUTRIENTS_DATA) {
        if ((e.aliases || []).some(alias => normalizeName(alias) === normalizeName(name))) {
          essential = e;
          break;
        }
      }
    }

    if (!essential) continue;

    // Skip if we already added the primary nutrient
    if (seenPrimary.has(essential.nutrientName)) continue;

    // Only accept entry if unit matches the preferred unit
    // or if there is no legacy conversion for this nutrient
    if (essential.unitName && unitName && essential.unitName !== unitName) {
      // Check if a legacy conversion applies
      if (!(essential.legacyConversion && unitName === essential.legacyConversion.fromUnit)) {
        continue; // skip this one
      }
    }

    // Mark primary nutrient as seen
    seenPrimary.add(essential.nutrientName);

    const normalizedValue = applyLegacyConversion(value, unitName, essential);
    
    result.push({
      nutrientName: essential.nutrientName,
      label: essential.label,
      value: Number.isFinite(normalizedValue) ? normalizedValue : 0,
      unitName: essential.unitName,
    });
  }

  return result;
}

/**
 * Get food detail from USDA API, with caching in Firebase Realtime Database
 * @param {*} fdcId 
 * @returns 
 */
async function getFoodDetail(fdcId) {
  if (!fdcId) throw new Error('fdcId is required');
  const db = admin.database();
  const cacheRef = db.ref(`usdaCache/${fdcId}`);

  try {
    const snap = await cacheRef.get();
    if (snap.exists()) {
      const cached = snap.val();
      if (cached?.data) return cached.data;
    }
  } catch (err) {
    console.warn(`⚠️ Cache read failed for fdcId ${fdcId}: ${err.message}`);
  }

  if (!USDA_API_KEY) throw new Error('USDA_API_KEY not configured');
  const url = `${BASE_URL}/food/${fdcId}?api_key=${USDA_API_KEY}`;

  try {
    const response = await axios.get(url, { timeout: 15000 });
    const data = response.data;

    const cacheData = {
      fdcId: data.fdcId ?? fdcId,
      description: data.description ?? '',
      foodNutrients: data.foodNutrients ?? [],
    };

    await cacheRef.set({ data: cacheData, cachedAt: Date.now() });

    return cacheData;
  } catch (err) {
    const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`❌ USDA request failed for fdcId ${fdcId}:`, msg);
    throw err;
  }
}

module.exports = {
  getFoodDetail,
  extractEssentialNutrients,
};
