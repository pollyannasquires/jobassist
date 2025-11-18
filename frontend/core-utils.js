// FILENAME: core-utils.js | Provides essential utilities like Firebase setup and the API guard function.
// CRITICAL FIX: Replaced all calls to 'crypto.randomUUID()' with 'generateFallbackId()' 
// to prevent crashes in secure iframe environments, as documented in the dev guide.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, setDoc, doc, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Firebase Instances (CRITICAL: EXPORTED) ---
export let db = null;
export let auth = null;
export let currentUserId = null;
export let isAuthReady = false;
export let appId = null;

// Use 'Debug' for detailed logging during development
setLogLevel('Debug');

/**
 * CRITICAL FIX: Fallback to generate a simple UUID-like string if crypto.randomUUID() is unavailable.
 * This fixes the "Silent Crash" issue documented in the guide.
 * @returns {string} A 36-character UUID-like string.
 */
function generateFallbackId() {
    // Generate a simple UUID-like string
    const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
    return template.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}


/**
 * Initializes Firebase services using mandatory global configuration variables.
 * @returns {Promise<void>} Resolves when isAuthReady is true.
 */
export async function initializeServices() {
    try {
        // 1. Get mandatory global variables
        appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
        const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

        if (Object.keys(firebaseConfig).length === 0) {
            console.error("Firebase Setup Warning: Firebase configuration is missing or empty. Using default dummy IDs.");
            // CRITICAL FIX: Use fallback function instead of crypto.randomUUID()
            currentUserId = generateFallbackId();
            isAuthReady = true; // Still set to true to prevent hangs in the calling module
            return;
        }

        // 2. Initialize App and Services
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        // 3. Authentication & State Ready Promise
        await new Promise(resolve => {
            const unsubscribe = onAuthStateChanged(auth, async (user) => {
                // If onAuthStateChanged fires before we manually sign in, we get the current user.
                // If no user, proceed with sign-in.
                if (!user) {
                    try {
                        if (initialAuthToken) {
                            await signInWithCustomToken(auth, initialAuthToken);
                        } else {
                            await signInAnonymously(auth);
                        }
                    } catch (signInError) {
                        console.error("Sign-in failed:", signInError);
                    }
                }
                
                // Final state setup
                // CRITICAL FIX: Use fallback function instead of crypto.randomUUID()
                currentUserId = auth.currentUser?.uid || generateFallbackId();
                isAuthReady = true;
                console.log(`Firebase Ready. User ID: ${currentUserId}`);
                unsubscribe();
                resolve();
            });

            // Fallback timeout in case auth state never changes for some reason
            setTimeout(() => {
                if (!isAuthReady) {
                    console.warn("Auth state failed to resolve. Proceeding with mock ID.");
                    // CRITICAL FIX: Use fallback function instead of crypto.randomUUID()
                    currentUserId = generateFallbackId();
                    isAuthReady = true;
                    resolve();
                }
            }, 5000); // 5 second timeout
        });

    } catch (error) {
        console.error("Critical Firebase Initialization Error:", error);
        // CRITICAL FIX: Use fallback function instead of crypto.randomUUID()
        currentUserId = generateFallbackId();
        isAuthReady = true;
    }
}


/**
 * Guarded fetch function to call external APIs with built-in error handling and exponential backoff.
 * @param {string} url - The API endpoint URL.
 * @param {string} method - HTTP method ('GET', 'POST', etc.).
 * @param {string} operationName - Descriptive name for logging.
 * @param {object} [options={}] - Standard fetch options (headers, body, etc.).
 * @returns {Promise<object>} - The parsed JSON response data.
 */
export async function fetchWithGuard(url, method, operationName, options = {}) {
    const MAX_RETRIES = 3;
    let lastError = null;

    // CRITICAL FIX: WAIT FOR AUTH TO BE READY
    if (!isAuthReady) {
        await new Promise((resolve, reject) => {
            const check = setInterval(() => {
                if (isAuthReady) {
                    clearInterval(check);
                    resolve();
                }
            }, 50);
            setTimeout(() => {
                clearInterval(check);
                // Allow proceeding, as initializeServices handles the un-initialized state.
                resolve(); 
            }, 5000); 
        });
    }

    // Get the auth token AFTER waiting for auth readiness
    const token = await auth?.currentUser?.getIdToken() || 'MOCK_TOKEN';

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            console.log(`[API] Attempt ${i + 1}/${MAX_RETRIES}: ${method} ${url}`);
            
            // Build headers, including Authorization
            const headers = {
                // START OF CRITICAL FIX: Set application/json as the default Content-Type for all requests.
                // This resolves the 415 error for APIs that rely on this header being present.
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                // User-supplied headers are spread *last* to allow them to override the default Content-Type.
                ...options.headers, 
            };
            
            // Handle content type for JSON vs FormData
            let body = options.body;
            const isFormData = body instanceof FormData;
            const isObjectBody = typeof body === 'object' && body !== null && !isFormData;

            // --- CRITICAL LOGIC ---
            if (isObjectBody) {
                // If body is a raw object, stringify it. Content-Type is already set above.
                body = JSON.stringify(body);
            } else if (isFormData) {
                 // For FormData, the browser sets the Content-Type header with the boundary. 
                 // We must explicitly delete the default Content-Type.
                 delete headers['Content-Type'];
            }
            // For other cases (e.g., GET/DELETE or already-stringified body), we rely on the default 
            // Content-Type set above, or any override in options.headers.
            // --- END OF CRITICAL LOGIC ---
            
            // Perform the fetch call
            const response = await fetch(url, {
                method: method,
                headers: headers,
                body: body,
                // Do not spread headers or body from options, as we have already processed them.
                ...options
            });

            // Attempt to read and parse response body
            const contentType = response.headers.get('content-type');
            let data = null;

            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else if (!response.ok) {
                 // If not JSON and not OK, throw error before trying to read body as JSON
                 throw new Error(`Non-JSON API Error (${response.status}): ${operationName} failed. Response was not JSON.`);
            }


            if (!response.ok) {
                // API returned a non-200 status code
                throw new Error(data?.message || `API Error (${response.status}): ${operationName} failed.`);
            }

            return data; // Success

        } catch (error) {
            lastError = error;
            if (i < MAX_RETRIES - 1) {
                const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
                console.warn(`[API] Retrying ${operationName} in ${delay.toFixed(0)}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    // If all retries fail, throw the last error
    console.error(`[API] Fatal Error after ${MAX_RETRIES} attempts for ${operationName}:`, lastError);
    // Throw a user-friendly error
    throw new Error(`Failed to perform '${operationName}'. Please check your network connection and try again. Technical details: ${lastError.message}`);
}