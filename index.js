// server.js (CommonJS style)
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const admin = require('firebase-admin');
const { verifyFirebaseToken } = require('./authMiddleware');
const serviceAccount = require('./firebase-service-account.json');
const { getFoodDetail, extractEssentialNutrients } = require('./usdaService');
require('dotenv').config();

// Initialize Firebase Admin SDK
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://meal-nutrition-e08bf-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();
const app = express();
app.use(cors());
app.use(bodyParser.json());

/*  API Endpoints */

// 🔹 Create or update a meal
app.post('/meals', verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const meal = req.body.meal;

    if (!meal) {
      return res.status(400).json({ error: "Meal object is required" });
    }

    let mealRef;

    if (meal.id) {
      // ✅ Update existing meal
      mealRef = db.ref(`meals/${uid}/${meal.id}`);
      await mealRef.set(meal);
    } else {
      // ✅ Create new meal
      mealRef = db.ref(`meals/${uid}`).push();
      meal.id = mealRef.key;
      await mealRef.set(meal);
    }
    res.status(200).json(meal);
  } catch (err) {
    console.error("❌ Error saving meal:", err);
    res.status(500).json({ error: err.message });
  }
});

/* 🔹 Get meals for a specific date with enriched food details */
app.get('/meals/:date', verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { date } = req.params;

    const snapshot = await db
      .ref(`meals/${uid}`)
      .orderByChild('date')
      .equalTo(date)
      .get();

    if (!snapshot.exists()) return res.json([]);

     const meals = Object.values(snapshot.val());

     console.log(`Fetched ${meals.length} meals for user ${uid} on date ${date}`);
    const enrichedMeals = [];

      // In-memory cache to avoid duplicate USDA calls
    const fdcCache = {};

    for (const meal of meals) {
      const enrichedItems = [];
      for (const item of meal.items || []) {
        try {
            
          let foodDetail;
           if (fdcCache[item.fdcId]) {
            // reuse previous result
            foodDetail = fdcCache[item.fdcId];
          } else {
            foodDetail = await getFoodDetail(item.fdcId);
            fdcCache[item.fdcId] = foodDetail;
          }
          const essentials = extractEssentialNutrients(foodDetail);

          enrichedItems.push({
            ...item,
            description: foodDetail.description,
            essentialNutrients: essentials
          });
        } catch (err) {
          console.error(`❌ Failed to fetch USDA for fdcId ${item.fdcId}:`, err.message);
          enrichedItems.push(item);
        }
      }
      enrichedMeals.push({ ...meal, items: enrichedItems });
    }

    res.json(enrichedMeals);
  } catch (err) {
    console.error("❌ Error fetching meals:", err);
    res.status(500).json({ error: err.message });
  }
});

/* 🔹 Delete a meal by ID */
app.delete('/meals/:mealId', verifyFirebaseToken, async (req, res) => {
    try {
        const uid = req.user.uid;
        const { mealId } = req.params;
        await db.ref(`meals/${uid}/${mealId}`).remove();
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Error deleting meal:", err);
        res.status(500).json({ error: err.message });
    }
});

/* 🔹 Delete a food item from a meal by meal ID and fdcId */
app.delete('/meals/:mealId/food-items/:fdcId', verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { mealId, fdcId } = req.params;

    const mealRef = db.ref(`meals/${uid}/${mealId}`);
    const snapshot = await mealRef.get();

    if (!snapshot.exists()) {
      return res.status(404).json({ error: "Meal not found" });
    }

    const meal = snapshot.val();
    const updatedItems = (meal.items || []).filter(
      (item) => String(item.fdcId) !== String(fdcId) 
    );

    if (updatedItems.length === 0) {
      // ✅ If no items left, delete the whole meal
      await mealRef.remove();
      return res.json({ success: true, message: `Food item ${fdcId} deleted. Meal ${mealId} removed because it was empty.` });
    } else {
      // ✅ Update meal with remaining items
      await mealRef.update({ items: updatedItems });
      return res.json({ success: true, message: `Food item ${fdcId} deleted from meal ${mealId}` });
    }
  } catch (err) {
    console.error("❌ Error deleting food item:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
