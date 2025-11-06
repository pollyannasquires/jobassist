// FILENAME: network_guard.js | Pillar 4: The Mandatory, Centralized Network Request Guard

/**
 * The 'Network Guard' is the single source of truth for all API interactions.
 * It enforces standardized headers, error handling, and structured response parsing
 * (e.g., handling the server's {"status": "success", "data": [...] } wrapper).
 */

// --- API Configuration ---
// Note: We use an empty string for API key; the environment provides the necessary token via auth headers.
const API_BASE_URL = ''; // Assumes API is on the same domain/origin
const API_KEY = ''; 

// --- Core Helper: API Response Standardizer ---
/**
 * Processes the raw server response to ensure it adheres to the standardized
 * structured format and throws a clean error if validation or status fails.
 * @param {Response} response - The raw browser Response object from fetch.
 * @param {string} resourceKey - The key where the data is nested (e.g., 'applications').
 * @returns {Promise<any>} The extracted data array/object.
 */
async function processStructuredResponse(response, resourceKey) {
    let responseData;
    
    // 1. Check HTTP Status
    if (!response.ok) {
        // Attempt to parse server-defined error payload (400, 401, 404, 500)
        try {
            responseData = await response.json();
            // Throw a structured error that can be caught by the caller
            throw new Error(`API Error (${response.status} ${response.statusText}): ${responseData.message || 'Server rejected the request.'}`);
        } catch (e) {
            // If JSON parsing fails (e.g., 500 HTML error), throw a generic error
            throw new Error(`Network/Server Error: ${response.status} ${response.statusText} (${e.message})`);
        }
    }

    // 2. Parse JSON body for successful responses
    try {
        responseData = await response.json();
    } catch (e) {
        // Handle cases where 200/201 returns no body (e.g., a DELETE or simple success)
        return null;
    }
    
    // 3. Check Server-Defined Status Wrapper (Pillar 1/4 Enforcement)
    if (responseData.status !== 'success') {
        throw new Error(`API Contract Violation: Expected status='success', got '${responseData.status || 'undefined'}'`);
    }

    // 4. Extract the Nested Resource (Pillar 3: Response De-structuring)
    if (resourceKey && responseData[resourceKey] === undefined) {
        console.warn(`Response missing expected key '${resourceKey}'. Returning full data.`);
        return responseData;
    }
    
    return resourceKey ? responseData[resourceKey] : responseData;
}


// --- Mandatory Core Function: The Network Guard ---

/**
 * Executes a network request using standardized processes and error handling.
 * This is the ONLY function permitted to use the raw 'fetch' API.
 * @param {string} endpoint - The API path (e.g., '/api/companies').
 * @param {string} method - The HTTP method ('GET', 'POST', etc.).
 * @param {string} resourceKey - The nested key to extract (e.g., 'companies' for response.companies).
 * @param {object | FormData} [body=null] - JSON body object or FormData object.
 * @returns {Promise<any>} The parsed and extracted data resource.
 */
export async function fetchWithGuard(endpoint, method = 'GET', resourceKey = null, body = null) {
    const fullUrl = `${API_BASE_URL}${endpoint}`;
    
    const options = {
        method: method,
        headers: {
            'Authorization': `Bearer ${API_KEY}`, // Placeholder for auth token
        },
    };

    // Handle JSON body
    if (body && !(body instanceof FormData)) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }
    
    // Handle FormData body (e.g., file upload)
    if (body instanceof FormData) {
        delete options.headers['Content-Type'];
        options.body = body;
    }
    
    try {
        const response = await fetch(fullUrl, options);
        // Use the standardized processor defined above
        return await processStructuredResponse(response, resourceKey); 
    } catch (error) {
        // Log the error for debugging and re-throw for the caller to handle UI updates
        console.error(`Request to ${fullUrl} failed:`, error.message);
        throw error;
    }
}
