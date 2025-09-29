// usdaService.js
const admin = require('firebase-admin');     
const axios = require('axios');
require('dotenv').config();


// USDA API configuration
const USDA_API_KEY = process.env.USDA_API_KEY || '';
const BASE_URL = "https://api.nal.usda.gov/fdc/v1";

// Define essential nutrients mapping
const ESSENTIAL_NUTRIENTS_DATA = [
    { nutrientName: 'Energy', label: 'Energy', value: 0, unitName: 'kcal', dailyValueMen: 2500, dailyValueWomen: 2000 },
    { nutrientName: 'Protein', label: 'Protein', value: 0, unitName: 'g', dailyValueMen: 98, dailyValueWomen: 77 },
    { nutrientName: 'Total lipid (fat)', label: 'Fat', value: 0, unitName: 'g', dailyValueMen: 70, dailyValueWomen: 70 },
    { nutrientName: 'Carbohydrate, by difference', label: 'Carbs', value: 0, unitName: 'g', dailyValueMen: 300, dailyValueWomen: 300 },
    { nutrientName: 'Fiber, total dietary', label: 'Fiber', value: 0, unitName: 'g', dailyValueMen: 38, dailyValueWomen: 25 },
    { nutrientName: 'Sugars, total including NLEA', label: 'Sugars', value: 0, unitName: 'g', dailyValueMen: 36, dailyValueWomen: 25 },
    { nutrientName: 'Calcium, Ca', label: 'Calcium', value: 0, unitName: 'mg', dailyValueMen: 1000, dailyValueWomen: 1000 },
    { nutrientName: 'Iron, Fe', label: 'Iron', value: 0, unitName: 'mg', dailyValueMen: 8, dailyValueWomen: 18 },
    { nutrientName: 'Magnesium, Mg', label: 'Magnesium', value: 0, unitName: 'mg', dailyValueMen: 400, dailyValueWomen: 310 },
    { nutrientName: 'Potassium, K', label: 'Potassium', value: 0, unitName: 'mg', dailyValueMen: 3400, dailyValueWomen: 2600 },
    { nutrientName: 'Sodium, Na', label: 'Sodium', value: 0, unitName: 'mg', dailyValueMen: 2300, dailyValueWomen: 2300 },
    { nutrientName: 'Zinc, Zn', label: 'Zinc', value: 0, unitName: 'mg', dailyValueMen: 11, dailyValueWomen: 8 },
    { nutrientName: 'Vitamin A, RAE', label: 'Vit A', value: 0, unitName: 'µg', dailyValueMen: 900, dailyValueWomen: 700 },
    { nutrientName: 'Vitamin C, total ascorbic acid', label: 'Vit C', value: 0, unitName: 'mg', dailyValueMen: 90, dailyValueWomen: 75 },
    { nutrientName: 'Vitamin D (D2 + D3)', label: 'Vit D', value: 0, unitName: 'µg', dailyValueMen: 15, dailyValueWomen: 15 },
    { nutrientName: 'Vitamin E (alpha-tocopherol)', label: 'Vit E', value: 0, unitName: 'mg', dailyValueMen: 15, dailyValueWomen: 15 },
    { nutrientName: 'Vitamin K (phylloquinone)', label: 'Vit K', value: 0, unitName: 'µg', dailyValueMen: 120, dailyValueWomen: 90 },
    { nutrientName: 'Vitamin B-6', label: 'Vit B6', value: 0, unitName: 'mg', dailyValueMen: 1.7, dailyValueWomen: 1.5 },
    { nutrientName: 'Vitamin B-12', label: 'Vit B12', value: 0, unitName: 'µg', dailyValueMen: 2.4, dailyValueWomen: 2.4 },
];

// Cache TTL in days (not currently used, but can be implemented for cache invalidation)
const CACHE_TTL_DAYS = parseInt(process.env.USDA_CACHE_TTL_DAYS || '0', 10);

// Normalize string for matching
function normalizeName(s) {
    if (!s) return '';
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 *  Parse a nutrient entry from USDA foodNutrients array
 * @param {*} entry 
 * @returns 
 */
function parseNutrientEntry(entry) {
    let name = entry.nutrientName || entry.name || (entry.nutrient && (entry.nutrient.name || entry.nutrient.nutrientName)) || '';
    let value = (entry.value ?? entry.amount ?? (entry.nutrient && (entry.nutrient.amount ?? entry.nutrient.value))) ?? null;
    let unitName = entry.unitName || (entry.nutrient && entry.nutrient.unitName) || entry.unit || null;

    // try to parse value as number
    if (value !== null) {
        const parsed = Number(value);
        value = Number.isFinite(parsed) ? parsed : value;
    }

    return { name: String(name), value, unitName };
}

/* Find essential nutrient match by name
  * Uses normalizeName to compare names loosely
  * Returns the matched essential nutrient object or null if not found
  */
function findEssentialMatch(nutrientName) {
    const n = normalizeName(nutrientName);
    if (!n) return null;
    for (const essential of ESSENTIAL_NUTRIENTS_DATA) {
        const en = normalizeName(essential.nutrientName);
        // match if one name contains the other (helps with slight naming differences)
        if (n.includes(en) || en.includes(n)) return essential;
    }
    return null;
}

/* Extract essential nutrients from USDA food item
 * Returns array of { nutrientName, label, value, unitName }
 */
function extractEssentialNutrients(foodItem) {

  const result = [];
  const arr = foodItem.foodNutrients ?? [];

  for (const entry of arr) {
    const { name, value, unitName } = parseNutrientEntry(entry);
    if (!name) continue;

    const essential = findEssentialMatch(name);
    if (!essential) continue;

    result.push({
      nutrientName: essential.nutrientName,
      label: essential.label,
      value: (typeof value === 'number') ? value : (value === null ? 0 : value),
      unitName: unitName || essential.unitName || ''
    });
  }
  // dedupe by nutrientName, keeping first occurrence
  // (some items have duplicates with slightly different names/units)
  const deduped = [];
  const seen = new Set();
  for (const r of result) {
    if (!seen.has(r.nutrientName)) {
      seen.add(r.nutrientName);
      deduped.push(r);
    }
  }
  return deduped;
}

/** Fetch food detail by fdcId, with caching in Firebase Realtime Database
 * @param {number} fdcId 
 * @returns USDA food item object
 */
async function getFoodDetail(fdcId) {
    console.log('Fetching food detail for fdcId:', fdcId);
  if (!fdcId) throw new Error('fdcId is required');
  const db = admin.database();
  const cacheRef = db.ref(`usdaCache/${fdcId}`);

  // 🔹 Check cache first
  try {
    const snap = await cacheRef.get();
    if (snap.exists()) {
      const cached = snap.val();
      if (cached && cached.data) {
        return cached.data;
      }
    }
  } catch (err) {
    console.warn(`⚠️ Cache read failed for fdcId ${fdcId}: ${err.message}`);
  }

  // 🔹 Fetch from USDA API
  if (!USDA_API_KEY) throw new Error('USDA_API_KEY not configured');
  const url = `${BASE_URL}/food/${fdcId}?api_key=${USDA_API_KEY}`;

  try {
    const response = await axios.get(url, { timeout: 15000 });
    const data = response.data;

    // Cache the result
    const cacheData = {
      fdcId: data.fdcId ?? fdcId,
      description: data.description ?? '',
      foodNutrients: data.foodNutrients ?? []
    };

    await cacheRef.set({
      data: cacheData,
      cachedAt: Date.now()
    });

    return cacheData;
  } catch (err) {
    const msg = err.response && err.response.data
      ? JSON.stringify(err.response.data)
      : err.message;
    console.error(`❌ USDA request failed for fdcId ${fdcId}:`, msg);
    throw err;
  }
}


module.exports = {
    getFoodDetail,
    extractEssentialNutrients
};