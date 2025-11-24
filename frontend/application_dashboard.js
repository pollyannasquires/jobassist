// FILENAME: application_dashboard.js | Handles the main dashboard view, listing all applications.

import { fetchWithGuard, initializeServices } from './core-utils.js';
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- API Endpoints ---
// API 11.0: GET /api/applications/all (Retrieve All Applications for authenticated user)
const APPLICATIONS_API_ALL = '/api/applications/all'; 

// --- DOM Elements ---
let applicationTableBody = null; // Renamed from applicationListContainer
let loadingIndicator = null;
let errorDisplay = null;

// --- State for Sorting and Data ---
let allApplications = [];
let sortState = {
    key: 'application_date', // Default sort key
    direction: 'desc'        // Default sort direction (newest first)
};


// ---------------------------------------------------------------------
// --- SORTING & RENDERING ---------------------------------------------
// ---------------------------------------------------------------------

/**
 * Sorts the global application array based on the current sort state.
 */
function sortApplications() {
    const { key, direction } = sortState;

    allApplications.sort((a, b) => {
        let valA = a[key];
        let valB = b[key];

        // Handle date sorting (for 'application_date' and 'updated_at')
        if (key.includes('date')) {
            valA = new Date(valA || 0); // Use epoch start if date is missing
            valB = new Date(valB || 0);
        }
        
        // Handle case-insensitive string sorting
        if (typeof valA === 'string' && typeof valB === 'string') {
            valA = valA.toLowerCase();
            valB = valB.toLowerCase();
        }

        let comparison = 0;
        if (valA > valB) {
            comparison = 1;
        } else if (valA < valB) {
            comparison = -1;
        }

        // Apply direction: 1 for asc, -1 for desc
        return direction === 'desc' ? (comparison * -1) : comparison;
    });
}

/**
 * Updates the visual icons and classes on the table headers to reflect the current sort state.
 */
function updateSortIcons() {
    document.querySelectorAll('.sortable-header').forEach(header => {
        const key = header.getAttribute('data-sort-key');
        const icon = document.getElementById(`sort-icon-${key}`);
        
        // Reset classes
        header.classList.remove('sort-active');
        if (icon) {
            icon.classList.remove('rotate-180');
        }

        if (key === sortState.key) {
            header.classList.add('sort-active');
            // Rotate arrow-down-up icon for 'asc'
            if (sortState.direction === 'asc' && icon) {
                icon.classList.add('rotate-180');
            }
        }
    });
}

/**
 * Public function exposed to window for handling click events on table headers.
 * @param {string} clickedKey - The data-sort-key of the clicked column.
 */
window.handleSortClick = function(clickedKey) {
    if (sortState.key === clickedKey) {
        // Toggle direction
        sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        // New column clicked, set new key and default to descending
        sortState.key = clickedKey;
        sortState.direction = 'desc';
    }

    // Sort, update icons, and re-render
    sortApplications();
    updateSortIcons();
    renderApplications(allApplications);
}


/**
 * Transforms the raw application data from the API into a standardized format
 * for rendering in the dashboard.
 * @param {object} rawApp - The raw application object from API 11.0.
 * @returns {object} A clean application object ready for rendering.
 */
function normalizeApplicationData(rawApp) {
    // CRITICAL FIX: Mapping nested API fields to flat, readable properties for the UI
    return {
        application_id: rawApp.application_id,
        // The API uses date_applied
        application_date: rawApp.date_applied,
        // The API nests company info
        company_id: rawApp.company_info?.company_id,
        company_name_clean: rawApp.company_info?.company_name_clean,
        // The API nests job title info
        job_title: rawApp.job_title_info?.title_name,
        // The API uses current_status
        status_code: rawApp.current_status,
        // updated_at is currently missing in the example but kept for future proofing
        updated_at: rawApp.updated_at || rawApp.date_applied, 
        // job_url is included in the normalization but intentionally not used in rendering now
        job_url: rawApp.job_url || null, 
    };
}


/**
 * Renders the application list in the main container as a table.
 * @param {Array<object>} applications - The array of application data (must be normalized).
 */
function renderApplications(applications) {
    if (!applicationTableBody) return;
    
    // Clear previous content
    applicationTableBody.innerHTML = ''; 

    if (!applications || applications.length === 0) {
        applicationTableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-12 text-gray-500">
                    <i data-lucide="inbox" class="w-8 h-8 mx-auto text-gray-400 mb-2"></i>
                    <p>No Applications Found.</p>
                </td>
            </tr>
        `;
        // Re-create icons for new HTML
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }
    
    // Generate table rows
    const listHtml = applications.map(app => {
        const companyId = app.company_id;
        const appId = app.application_id;
        
        // CRITICAL: Ensure company ID and name are available for the review link
        if (!companyId || !app.company_name_clean) {
             console.warn(`Skipping application ${appId} due to missing company context.`);
             return ''; // Skip rendering if essential data is missing
        }

        // Link leads to the application review page for this company
        const reviewUrl = `application_review.html?companyId=${companyId}&companyName=${encodeURIComponent(app.company_name_clean)}`;

        // Determine status styling
        let statusText = app.status_code || 'NEW'; // Default to NEW based on provided options
        let statusClasses = 'inline-flex items-center px-3 py-0.5 rounded-full text-xs font-medium';
        
        // Use uppercase status code for reliable matching
        const normalizedStatus = statusText.toUpperCase();

        // Updated switch statement to handle all provided options explicitly
        switch (normalizedStatus) {
            case 'INTERVIEW':
                statusClasses += ' bg-yellow-100 text-yellow-800';
                break;
            case 'OFFER':
                statusClasses += ' bg-green-100 text-green-800';
                break;
            case 'REJECTED':
                statusClasses += ' bg-red-100 text-red-800';
                break;
            case 'CONTACTED':
                statusClasses += ' bg-blue-100 text-blue-800'; // Blue for intermediate positive step
                break;
            case 'NEW':
            case 'APPLIED': // Treat APPLIED (potential old status) as NEW (initial status)
            case 'CLOSED': // CLOSES can be generic, using default style
            default:
                statusClasses += ' bg-indigo-100 text-indigo-800'; // Indigo for initial/default states
                // Ensure display text is consistent. Use the normalized status code if it's one of the options, otherwise default to 'NEW'.
                if (['NEW', 'CONTACTED', 'INTERVIEW', 'OFFER', 'REJECTED'].includes(normalizedStatus)) {
                    statusText = normalizedStatus;
                } else if (normalizedStatus === 'APPLIED') {
                    statusText = 'NEW';
                } else {
                    statusText = 'NEW';
                }
                break;
        }
        
        // Fallback to title-cased display
        statusText = statusText.charAt(0).toUpperCase() + statusText.slice(1).toLowerCase();
        
        // Format dates
        const appDate = new Date(app.application_date).toLocaleDateString();
        
        // Job URL link is intentionally removed from this view.
        
        return `
            <tr class="hover:bg-gray-50 transition duration-100">
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm font-medium text-gray-900">${appDate}</div>
                    <div class="text-xs text-gray-500 truncate">ID: ${appId}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm text-gray-900 font-semibold">${app.company_name_clean}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm text-gray-900">${app.job_title}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="${statusClasses}">
                        ${statusText}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <a href="${reviewUrl}" class="text-primary hover:text-indigo-900 transition flex items-center">
                        Review <i data-lucide="arrow-right" class="w-4 h-4 ml-1"></i>
                    </a>
                </td>
            </tr>
        `;
    }).join('');

    applicationTableBody.innerHTML = listHtml;

    // Re-create icons for new HTML
    if (typeof lucide !== 'undefined') lucide.createIcons();
}


/**
 * Fetches all applications for the current authenticated user (API 11.0).
 */
async function fetchApplications() {
    // Renamed from applicationListContainer to applicationTableBody
    if (!applicationTableBody || !loadingIndicator || !errorDisplay) return;

    loadingIndicator.classList.remove('hidden');
    errorDisplay.classList.add('hidden');
    applicationTableBody.innerHTML = ''; // Clear existing list

    try {
        const data = await fetchWithGuard(
            APPLICATIONS_API_ALL, // 1st argument: URL string
            'GET',                // 2nd argument: Method string
            'Fetch All Applications' // 3rd argument: Operation Name string
        );

        // API 11.0 returns { applications: [...] }
        const rawApplications = data.applications || [];
        
        // 1. Normalize the raw data and store globally
        allApplications = rawApplications.map(normalizeApplicationData);
        
        // 2. Initial sort (default: date applied descending)
        sortApplications();
        
        // 3. Update icons and render the sorted data
        updateSortIcons();
        renderApplications(allApplications);

    } catch (error) {
        console.error("Failed to fetch applications:", error);
        errorDisplay.textContent = `Failed to load applications. ${error.message}`;
        errorDisplay.classList.remove('hidden');
    } finally {
        loadingIndicator.classList.add('hidden');
    }
}


// ---------------------------------------------------------------------
// --- INITIALIZATION --------------------------------------------------
// ---------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize Firebase and ensure auth state is ready
    await initializeServices();
    
    // 2. Setup DOM element references
    applicationTableBody = document.getElementById('applicationTableBody'); // Updated ID
    loadingIndicator = document.getElementById('loadingIndicator');
    errorDisplay = document.getElementById('errorDisplay');

    if (!applicationTableBody || !loadingIndicator || !errorDisplay) {
        console.error("Dashboard initialization failed: Missing required DOM elements.");
        return;
    }

    // 3. Kick off the data fetch
    fetchApplications();
});

// Expose fetchApplications and handleSortClick for external calls (HTML, debugging)
window.fetchApplications = fetchApplications;
