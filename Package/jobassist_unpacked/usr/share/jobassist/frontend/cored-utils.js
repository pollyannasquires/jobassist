// FILENAME: core_utils.js | Provides essential non-UI utilities across the application.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";


// Global instances (exported for use by other modules if needed)
export let db = null;
export let auth = null;

/**
 * Handles API calls with status checking and error parsing.
 * @param {string} url The API endpoint URL.
 * @param {string} method The HTTP method ('GET', 'POST', etc.).
 * @param {string} resourceName A human-readable name for logging errors.
 * @param {object} [body=null] The request body object.
 * @returns {Promise<object>} The parsed JSON data if successful.
 */
export async function fetchWithGuard(url, method, resourceName, body = null) {
    const options = {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    };

    const response = await fetch(url, options);

    if (!response.ok) {
        let errorMsg = `API Error (${response.status}) when fetching ${resourceName}.`;
        try {
            const errorData = await response.json();
            errorMsg = errorData.message || errorMsg; 
        } catch (e) {
            // Ignore JSON parsing error if the response body is not JSON
        }
        throw new Error(errorMsg);
    }

    const data = await response.json();
    
    if (data.status === 'success') {
        return data;
    } else {
        // Handle cases where the response is 200 OK but status field is 'failure'
        const failMessage = data.message || `API returned failure status for ${resourceName}.`;
        throw new Error(failMessage);
    }
}


/**
 * Initializes Firebase services and authenticates the user.
 * @param {object} firebaseConfig The Firebase configuration object.
 * @param {string} initialAuthToken The Firebase custom auth token.
 */
export async function initializeFirebase(firebaseConfig, initialAuthToken) {
    if (!firebaseConfig) {
        console.error("Firebase configuration is missing. Authentication skipped.");
        return;
    }

    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    try {
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
            console.log("Firebase: Signed in with custom token.");
        } else {
            await signInAnonymously(auth);
            console.log("Firebase: Signed in anonymously.");
        }
    } catch (error) {
        console.error("Firebase Authentication failed:", error);
        throw new Error("Application could not authenticate.");
    }
}
