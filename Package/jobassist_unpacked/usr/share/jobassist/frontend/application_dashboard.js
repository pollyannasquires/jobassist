// FILENAME: application_dashboard.js | Logic for fetching and displaying the user's application history.

import { initializeServices, fetchWithGuard } from './core-utils.js';

// --- API Endpoints ---
const APPLICATIONS_ALL_API = '/api/applications/all'; // Endpoint 22.0

// --- Global State ---
let allApplications = [];
let currentSortKey = 'application_date';
let currentSortDirection = 'desc'; // Default to newest first

// --- DOM Elements ---
const applicationTableBody = document.getElementById('applicationTableBody');
const loadingIndicator = document.getElementById('loadingIndicator');
const errorDisplay = document.getElementById('errorDisplay');
const totalApplicationCountElement = document.getElementById('totalApplicationCount');


// ---------------------------------------------------------------------
// --- UI RENDERING FUNCTIONS ------------------------------------------
// ---------------------------------------------------------------------

/**
 * Shows the error message and hides the loading spinner/table.
 * @param {string} message - The error message to display.
 */
function displayError(message) {
    if (loadingIndicator) loadingIndicator.classList.add('hidden');
    if (applicationTableBody) applicationTableBody.innerHTML = '';
    if (errorDisplay) {
        errorDisplay.textContent = `Data Load Error: ${message}`;
        errorDisplay.classList.remove('hidden');
    }
}

/**
 * Formats the application status into a visually distinct badge.
 * @param {string} status - The status code (e.g., 'NEW', 'INTERVIEW', 'OFFER').
 * @returns {string} HTML for the status badge.
 */
function formatStatusBadge(status) {
    let colorClass;
    switch (status) {
        case 'OFFER':
            colorClass = 'bg-green-100 text-green-800';
            break;
        case 'INTERVIEW':
            colorClass = 'bg-yellow-100 text-yellow-800';
            break;
        case 'REJECTED':
            colorClass = 'bg-red-100 text-red-800';
            break;
        case 'NEW':
        default:
            colorClass = 'bg-indigo-100 text-indigo-800';
            break;
    }
    return `<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${colorClass}">
                ${status.toUpperCase().replace('_', ' ')}
            </span>`;
}


/**
 * Renders the application data into the HTML table body.
 * @param {Array<Object>} applications - The sorted list of application objects.
 * * **UPDATED:** Wrapped company name and contact count in anchor tags
 * to redirect to the management.html page.
 */
function renderApplicationTable(applications) {
    if (!applicationTableBody) return;

    if (applications.length === 0) {
        applicationTableBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center py-10 text-gray-500 font-medium">
                    No applications found. Start tracking your job search!
                </td>
            </tr>
        `;
        return;
    }

    applicationTableBody.innerHTML = applications.map(app => {
        // Construct the URL to the application review page (for 'Actions' column)
        const reviewUrl = `application_review.html?companyId=${app.company_id}&companyName=${encodeURIComponent(app.company_name_clean)}`;
        
        // Construct the URL for management page (for 'Company' and 'Contacts' columns)
        // Uses the format: http://192.168.56.4/management.html?companyId=333&companyName=Code%20Fusion%20Labs
        const managementUrl = `management.html?companyId=${app.company_id}&companyName=${encodeURIComponent(app.company_name_clean)}`;

        return `
            <tr class="hover:bg-gray-50 transition duration-150">
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${app.date_applied ? new Date(app.date_applied).toLocaleDateString() : 'N/A'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 cursor-pointer">
                    <!-- CHANGE: Company Name now links to management page -->
                    <a href="${managementUrl}" class="hover:text-primary transition">
                        ${app.company_name_clean || 'N/A'}
                    </a>
                </td>
                <td class="px-6 py-4 text-sm text-gray-500">
                    ${app.title_name || app.job_title_id || 'N/A'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    ${formatStatusBadge(app.current_status)}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700 font-bold cursor-pointer">
                    <!-- CHANGE: Contact Count now links to management page -->
                    <a href="${managementUrl}" class="hover:text-primary transition">
                        ${app.contact_count !== undefined ? app.contact_count : 0}
                    </a>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <a href="${reviewUrl}" class="text-primary hover:text-indigo-800 transition">
                        <i data-lucide="eye" class="w-5 h-5 inline-block align-text-bottom"></i> Review
                    </a>
                </td>
            </tr>
        `;
    }).join('');

    // Re-initialize lucide icons for the dynamically injected table rows
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}


// ---------------------------------------------------------------------
// --- DATA AND SORTING LOGIC ------------------------------------------
// ---------------------------------------------------------------------

/**
 * Client-side sorting function.
 * @param {string} key - The data property key to sort by.
 * * **UPDATED:** Added numeric sorting logic for the 'contact_count' key.
 */
function sortApplications(key) {
    // 1. Determine sort direction
    if (currentSortKey === key) {
        // Toggle direction if the same key is clicked
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        // Default to descending for a new key (e.g., newest date, Z-A)
        currentSortDirection = 'desc';
        // Reset previous header/icon styles
        document.querySelectorAll('.sortable-header').forEach(header => {
            header.classList.remove('sort-active');
        });
        document.querySelectorAll('.sort-icon').forEach(icon => {
             icon.classList.remove('rotate-180');
        });
    }
    
    currentSortKey = key;

    // 2. Perform the sort
    allApplications.sort((a, b) => {
        const aVal = a[key] || '';
        const bVal = b[key] || '';

        // **CHANGE START**
        // Handle numeric comparison specifically for contact_count
        if (key === 'contact_count') {
            // Ensure values are treated as numbers (defaulting null/undefined to 0 for sort stability)
            const numA = parseInt(aVal) || 0;
            const numB = parseInt(bVal) || 0;
            return (currentSortDirection === 'asc') ? numA - numB : numB - numA;
        }
        // **CHANGE END**

        // Handle string comparison for other fields (case-insensitive)
        if (typeof aVal === 'string' && typeof bVal === 'string') {
            const comparison = aVal.localeCompare(bVal, undefined, { sensitivity: 'base' });
            return (currentSortDirection === 'asc') ? comparison : -comparison;
        }
        
        // Default comparison (e.g., dates)
        if (aVal < bVal) return (currentSortDirection === 'asc') ? -1 : 1;
        if (aVal > bVal) return (currentSortDirection === 'asc') ? 1 : -1;
        return 0;
    });

    // 3. Update UI
    updateSortIcons();
    renderApplicationTable(allApplications);
}


/**
 * Updates the visual state of the sort icons and header color.
 */
function updateSortIcons() {
    // Reset all icons and headers
    document.querySelectorAll('.sortable-header').forEach(header => {
        header.classList.remove('sort-active');
    });
    document.querySelectorAll('.sort-icon').forEach(icon => {
        icon.classList.remove('rotate-180', 'sort-active');
    });

    // Highlight the active header
    const activeHeader = document.getElementById(`header-${currentSortKey}`);
    if (activeHeader) {
        activeHeader.classList.add('sort-active');
        
        // Rotate the icon based on direction
        const activeIcon = document.getElementById(`sort-icon-${currentSortKey}`);
        if (activeIcon) {
            activeIcon.classList.add('sort-active');
            if (currentSortDirection === 'desc') {
                activeIcon.classList.add('rotate-180');
            } else {
                activeIcon.classList.remove('rotate-180');
            }
        }
    }
}

/**
 * Handles the click event on a sortable table header.
 * Exposed globally via window.handleSortClick.
 * @param {string} key - The data property key to sort by.
 * * **UPDATED:** Now correctly handles clicks for the 'contact_count' column.
 */
function handleSortClick(key) {
    if (allApplications.length > 0) {
        sortApplications(key);
    }
}


// ---------------------------------------------------------------------
// --- DATA FETCHING ---------------------------------------------------
// ---------------------------------------------------------------------

/**
 * Fetches all job applications for the current user.
 */
async function fetchApplications() {
    if (loadingIndicator) loadingIndicator.classList.remove('hidden');
    if (errorDisplay) errorDisplay.classList.add('hidden');

    try {
        const responseData = await fetchWithGuard(
            APPLICATIONS_ALL_API, 
            'GET', 
            'Fetch All Applications',
            { useAuth: true }
        );
        
        allApplications = responseData.applications || [];

        // 1. Update the Summary Card count
        if (totalApplicationCountElement) {
            totalApplicationCountElement.textContent = allApplications.length.toString();
        }

        // 2. Initial sort and render (defaults to application_date desc)
        sortApplications(currentSortKey); 
        
    } catch (error) {
        console.error("Error fetching applications:", error);
        displayError(error.message);
        // Ensure total count is reset if there's an error
        if (totalApplicationCountElement) {
            totalApplicationCountElement.textContent = '0';
        }
    } finally {
        if (loadingIndicator) loadingIndicator.classList.add('hidden');
    }
}


// ---------------------------------------------------------------------
// --- INITIALIZATION --------------------------------------------------
// ---------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Firebase/Auth services
    await initializeServices();
    
    // Once services are ready, fetch the application data
    fetchApplications();
    
    // Set initial sort icon state (for default 'application_date' desc)
    updateSortIcons();

    // Re-initialize lucide icons for elements outside of the dynamic table
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
});

// --- Expose functions globally for inline HTML handlers ---
window.handleSortClick = handleSortClick;