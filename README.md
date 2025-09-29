🍽️ Meal Nutrition App – Backend

This project is a **Meal Tracking & Nutrition App** built with **Angular 20**.  
It uses the **USDA FoodData Central API (FDC)** to provide detailed nutrition data, allowing users to track the nutrients of their meals in real time.  

The app was developed to **showcase my skills in modern web development** by combining a strong **frontend, backend, and cloud integration**.

💡 This backend is designed to be used with the Meal Nutrition Angular frontend https://github.com/will-pznt/meals-tracker 💡

It provides an API layer between the Angular frontend, the USDA FoodData Central API, and Firebase for authentication and storage.


🚀 Tech Stack

Node.js + Express → Web server & API routes

Firebase → Authentication & database

USDA FoodData Central (FDC) → Nutrition data source

dotenv → Secure environment variable management

Angular SSR (via Express) → Server-side rendering support for the frontend


⚡ Features : 

🔑 Firebase Authentication

🍏 Proxy routes to USDA API (search foods, get nutrition details)

🖥️ Serves Angular app with Server-Side Rendering (SSR)


🔐 Uses .env file to securely manage keys

🔑 Environment Variables

Create a .env file inside /server with the following keys:
USDA_API_KEY=your_usda_api_key_here

Create a .firebase-services-account.json file inside /server containing the firebase information and private key
{
  "type": "service_account",
  "project_id": "",
  "private_key_id": "",
  "private_key": "",
  "client_email": "",
  "client_id": "",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "",
  "universe_domain": "googleapis.com"
}


🛠️ Installation & Running
1. Install dependencies
npm install

2. Development mode
npm run dev

3. Start for production
npm run start


📌 Notes

Make sure you set your .env file correctly before running.