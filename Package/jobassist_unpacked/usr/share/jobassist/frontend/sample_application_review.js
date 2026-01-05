import { fetchWithGuard, initializeFirebase, db, auth } from './core-utils.js';
import { injectNavbar } from './navbar.js';
import { fetchAndRenderCompanies } from './company_sidebar.js'; // To render the left sidebar

// --- API Endpoints and Globals ---
const API_BASE_URL = window.location.origin;
const NEXT_APP_API_URL = '/api/next_application'; // API 4.0: GET
const REVIEW_API_URL = '/api/application_review'; // API 5.0: POST

let currentApplicationId = null;
let currentUserId = null;

// --- Utility Functions ---

/**
 * Updates the status message box in the UI.
 * @param {string} message The message content.
 * @param {string} type 'success', 'error', or 'info' for styling.
 */
function updateStatus(message, type = 'info') {
    const statusDiv = document.getElementById('reviewStatus');
    let classes = '';
    if (type === 'success') classes = 'bg-green-100 text-green-700 border-green-400';
    else if (type === 'error') classes = 'bg-red-100 text-red-700 border-red-400';
    else classes = 'bg-blue-100 text-blue-700 border-blue-400';

    statusDiv.innerHTML = `<div class="p-3 border rounded-lg ${classes} font-medium">${message}</div>`;
    statusDiv.classList.remove('hidden');
}

/**
 * Displays a loading state while data is being fetched.
 */
function showLoading() {
    const container = document.getElementById('applicationDetails');
    container.innerHTML = `
        <div class="flex flex-col items-center justify-center p-8 text-indigo-600">
            <svg class="animate-spin h-8 w-8 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p class="mt-4 text-lg font-semibold">Fetching next application for review...</p>
        </div>
    `;
    updateStatus('Loading...', 'info');
}

// --- Core Application Logic ---

/**
 * Initiates the document download process (API 12.0).
 * @param {string} documentId The UUID of the document to download.
 * @param {string} filename A suggested filename (optional).
 */
function handleDocumentDownload(documentId, filename = 'document') {
    if (!documentId) {
        updateStatus('Error: Missing document ID for download.', 'error');
        return;
    }

    const downloadUrl = `${API_BASE_URL}/api/documents/${documentId}`;

    updateStatus(`Requesting download for Document ID: ${documentId}. Check your browser's downloads.`, 'info');

    // Using window.open triggers a GET request to the file download endpoint.
    // The server is expected to handle setting the Content-Disposition header.
    console.log(`[DOWNLOAD] Attempting download from: ${downloadUrl}`);
    window.open(downloadUrl, '_blank');
}

/**
 * Fetches the next application requiring review (API 4.0).
 */
async function fetchNextApplication() {
    showLoading();
    currentApplicationId = null;

    try {
        const data = await fetchWithGuard(NEXT_APP_API_URL, 'GET', 'next application');
        
        if (data.status === 'success' && data.application) {
            renderApplication(data.application);
            updateStatus(`Application ID: ${data.application.application_id} loaded successfully.`, 'success');
        } else {
            // Handle success status with no application (all caught up)
            renderEmptyState();
        }
    } catch (error) {
        console.error("Failed to fetch next application:", error);
        updateStatus(`Failed to fetch application. ${error.message}`, 'error');
        renderEmptyState('There was an error connecting to the API.');
    }
}

/**
 * Renders the fetched application details into the main content area.
 * @param {object} application The application object from API 4.0.
 */
function renderApplication(application) {
    currentApplicationId = application.application_id;
    const container = document.getElementById('applicationDetails');

    // Default values if fields are missing
    const candidateName = application.candidate_name || 'Candidate Name N/A';
    const jobTitle = application.job_title || 'Unknown Job Title';
    const companyName = application.company_name_clean || 'Unknown Company';
    const appliedDate = application.created_at ? new Date(application.created_at).toLocaleDateString() : 'N/A';
    const applicationIdDisplay = application.application_id || 'N/A';

    // --- Documents List Rendering ---
    const documentsHtml = (application.documents || []).map(doc => {
        const docId = doc.document_id;
        const docType = doc.document_type_code || 'Document';
        return `
            <li class="flex items-center justify-between p-3 bg-gray-50 rounded-lg shadow-sm hover:bg-gray-100 transition-colors">
                <span class="font-medium text-gray-700">${docType}</span>
                <button 
                    onclick="window.handleDocumentDownload('${docId}', '${docType}')"
                    class="flex items-center text-sm text-indigo-600 hover:text-indigo-800 font-semibold transition-colors focus:outline-none"
                    title="Download ${docType}"
                >
                    <i data-lucide="download" class="w-4 h-4 mr-1"></i>
                    Download
                </button>
            </li>
        `;
    }).join('');
    
    // --- Main Content Render ---
    container.innerHTML = `
        <header class="pb-4 border-b border-gray-200 mb-6 flex justify-between items-center">
            <div>
                <h1 class="text-3xl font-bold text-gray-900">Application Review</h1>
                <p class="text-sm text-gray-500 mt-1">Reviewing Application ID: <span class="font-mono text-indigo-600">${applicationIdDisplay}</span></p>
            </div>
            <button onclick="fetchNextApplication()" class="flex items-center text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors">
                 <i data-lucide="skip-forward" class="w-5 h-5 mr-1"></i> Skip/Next
            </button>
        </header>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <!-- Candidate Details Panel -->
            <div class="lg:col-span-2 bg-white p-6 rounded-xl shadow-lg border border-gray-100">
                <h2 class="text-xl font-semibold mb-4 text-indigo-700">Candidate Information</h2>
                
                <div class="space-y-3">
                    <p class="flex items-center text-gray-700">
                        <i data-lucide="user" class="w-5 h-5 mr-3 text-indigo-500"></i>
                        <span class="font-bold mr-1">Candidate:</span> ${candidateName}
                    </p>
                    <p class="flex items-center text-gray-700">
                        <i data-lucide="briefcase" class="w-5 h-5 mr-3 text-indigo-500"></i>
                        <span class="font-bold mr-1">Job Title:</span> ${jobTitle}
                    </p>
                     <p class="flex items-center text-gray-700">
                        <i data-lucide="building-2" class="w-5 h-5 mr-3 text-indigo-500"></i>
                        <span class="font-bold mr-1">Company:</span> ${companyName}
                    </p>
                    <p class="flex items-center text-gray-700">
                        <i data-lucide="calendar" class="w-5 h-5 mr-3 text-indigo-500"></i>
                        <span class="font-bold mr-1">Applied On:</span> ${appliedDate}
                    </p>
                </div>

                <div class="mt-8">
                    <h3 class="text-lg font-semibold mb-3 text-indigo-700 border-b pb-2">Required Documents</h3>
                    <ul class="space-y-2">
                        ${documentsHtml.length > 0 ? documentsHtml : '<li class="text-gray-500 p-2">No documents found for this application.</li>'}
                    </ul>
                </div>
            </div>

            <!-- Review Action Panel -->
            <div class="lg:col-span-1 bg-white p-6 rounded-xl shadow-lg border border-gray-100 h-fit sticky top-20">
                <h2 class="text-xl font-semibold mb-4 text-indigo-700">Review Decision</h2>
                <p class="text-gray-600 mb-6">Once you've reviewed the candidate and documents, choose an action to proceed to the next application.</p>

                <div class="space-y-4">
                    <button id="approveBtn" onclick="window.handleReviewAction('APPROVED')"
                        class="w-full flex items-center justify-center py-3 px-4 border border-transparent rounded-lg shadow-md text-white bg-green-600 hover:bg-green-700 transition-all font-bold text-lg disabled:opacity-50">
                        <i data-lucide="check-circle" class="w-6 h-6 mr-2"></i> Approve
                    </button>
                    <button id="rejectBtn" onclick="window.handleReviewAction('REJECTED')"
                        class="w-full flex items-center justify-center py-3 px-4 border border-transparent rounded-lg shadow-md text-white bg-red-600 hover:bg-red-700 transition-all font-bold text-lg disabled:opacity-50">
                        <i data-lucide="x-circle" class="w-6 h-6 mr-2"></i> Reject
                    </button>
                </div>
            </div>
        </div>
    `;
    // Re-initialize icons for the new content
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

/**
 * Handles the submit of the review decision (API 5.0).
 * @param {string} reviewStatus 'APPROVED' or 'REJECTED'.
 */
async function handleReviewAction(reviewStatus) {
    if (!currentApplicationId) {
        updateStatus('Cannot submit review: No current application loaded.', 'error');
        return;
    }

    const reviewAction = reviewStatus === 'APPROVED' ? 'Approval' : 'Rejection';
    updateStatus(`Submitting ${reviewAction} for ID ${currentApplicationId}...`, 'info');

    try {
        // Disable buttons during submission
        document.getElementById('approveBtn')?.setAttribute('disabled', 'true');
        document.getElementById('rejectBtn')?.setAttribute('disabled', 'true');

        const payload = {
            application_id: currentApplicationId,
            review_status: reviewStatus,
            reviewed_by_user_id: currentUserId || 'system_reviewer' // Use the authenticated user ID
        };
        
        const data = await fetchWithGuard(REVIEW_API_URL, 'POST', 'application review', payload);

        if (data.status === 'success') {
            updateStatus(`Successfully recorded ${reviewAction} for Application ID ${currentApplicationId}. ${data.message}`, 'success');
            // Fetch the next application immediately
            setTimeout(fetchNextApplication, 1500); 
        } else {
            // This should be caught by fetchWithGuard, but for explicit safety:
            throw new Error(data.message || 'Review API returned failure status.');
        }

    } catch (error) {
        console.error(`Failed to submit review (${reviewStatus}):`, error);
        updateStatus(`Failed to submit review. ${error.message}`, 'error');
    } finally {
        // Re-enable buttons if an error occurred before the next application is fetched
        document.getElementById('approveBtn')?.removeAttribute('disabled');
        document.getElementById('rejectBtn')?.removeAttribute('disabled');
    }
}

/**
 * Renders a state indicating no applications are available for review.
 * @param {string} [message] Custom message for the empty state.
 */
function renderEmptyState(message = 'Great job! You are all caught up. There are currently no more applications requiring review.') {
    currentApplicationId = null;
    const container = document.getElementById('applicationDetails');
    container.innerHTML = `
        <div class="flex flex-col items-center justify-center p-10 bg-white rounded-xl shadow-lg mt-10 text-center">
            <i data-lucide="party-popper" class="w-12 h-12 text-indigo-500 mb-4"></i>
            <h2 class="text-2xl font-bold text-gray-800">Review Queue Empty</h2>
            <p class="mt-2 text-gray-600">${message}</p>
            <button onclick="fetchNextApplication()" class="mt-6 flex items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 transition-colors font-medium">
                 <i data-lucide="rotate-cw" class="w-4 h-4 mr-2"></i> Check Again
            </button>
        </div>
    `;
    updateStatus('No applications available.', 'info');
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

/**
 * Main application initialization function.
 */
async function bootApplication() {
    // 1. Get Configs
    const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
    const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

    // 2. Initialize Firebase and authenticate
    await initializeFirebase(firebaseConfig, initialAuthToken);

    // Get the authenticated user ID for the review action payload
    currentUserId = auth.currentUser?.uid || 'anonymous_user';

    // 3. Inject Navbar (depends on user ID being available for display)
    injectNavbar(currentUserId);

    // 4. Inject Company Sidebar content (runs in parallel)
    fetchAndRenderCompanies();

    // 5. Fetch the first application for review
    fetchNextApplication();
}

// Attach functions to the window object so they can be called from onclick handlers in the HTML
window.handleReviewAction = handleReviewAction;
window.handleDocumentDownload = handleDocumentDownload;

// Start the application after the DOM is fully loaded
document.addEventListener('DOMContentLoaded', bootApplication);

// Expose fetchNextApplication for manual retry/next buttons
window.fetchNextApplication = fetchNextApplication;
