// FILENAME: application_review.js | Handles application history viewing and navigation
const API_BASE = '/api/applications';

// --- DOM Elements (Checked for consistency) ---
const tableBody = document.getElementById('applicationsTableBody'); // Make sure HTML ID is 'applicationsTableBody'
const companyNameDisplay = document.getElementById('companyNameDisplay');
const recordNewAppBtn = document.getElementById('recordNewAppBtn');
const statusMessage = document.getElementById('statusMessage');

let currentCompanyId = null;
let currentCompanyName = 'Loading...';

// --- Utility Functions ---

/**
 * FIX: Now extracts both companyId and companyName from the URL.
 */
function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        companyId: params.get('companyId'),
        companyName: params.get('companyName')
    };
}

function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.classList.remove('hidden', 'bg-error', 'bg-success');
    statusMessage.classList.add(type === 'error' ? 'bg-error' : 'bg-success');
    setTimeout(() => {
        statusMessage.classList.add('hidden');
    }, 5000);
}

/**
 * Renders the list of applications into the table body.
 */
function renderApplications(applications) {
    if (!applications || applications.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-gray-500 italic">No applications recorded yet.</td></tr>`;
        return;
    }

    const html = applications.map(app => {
        // Correctly extract nested data from the API response
        const titleName = app.job_title_info?.title_name || 'N/A';
        const dateApplied = app.date_applied || 'N/A';
        const status = app.current_status || 'N/A';
        
        // Document rendering logic
        const documents = app.documents || [];
        
        let documentsHtml = '';
        if (documents.length > 0) {
            documentsHtml = documents.map(doc => {
                // Endpoint 10.0: GET /api/documents/string:file_path
                const docLink = `/api/documents/${doc.file_path}`; 
                const filename = doc.original_filename || doc.document_type;
                
                return `<a href="${docLink}" target="_blank" 
                           class="text-primary hover:text-indigo-700 underline text-xs block">${filename}</a>`;
            }).join('');
        } else {
            documentsHtml = '<span class="text-gray-500 italic text-sm">None</span>';
        }


        return `
            <tr class="hover:bg-gray-50">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${dateApplied}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${titleName}</td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">${status}</span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-500">
                    ${documentsHtml}
                </td>
            </tr>
        `;
    }).join('');

    tableBody.innerHTML = html;
}

/**
 * Fetches application history for a given company ID and renders the table.
 */
async function fetchApplications(companyId) { 
    // Show the current best guess (from URL or 'Loading...') while fetching
    companyNameDisplay.textContent = currentCompanyName; 
    
    // Set loading state in the table
    tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-gray-500 italic">Fetching history...</td></tr>`;

    const API_URL = `${API_BASE}?company_id=${companyId}`; 

    try {
        const response = await fetch(API_URL);

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}.`);
        }

        const result = await response.json();

        if (result.status === 'success') {
            // Overwrite the current name with the clean name from the API
            currentCompanyName = result.company_name_clean || currentCompanyName;
            companyNameDisplay.textContent = currentCompanyName;
            document.getElementById('pageTitle').textContent = `Application Review for ${currentCompanyName} | JobAssist`;

            // Set the "Record New Application" button's URL
            if (recordNewAppBtn) {
                recordNewAppBtn.href = `application_create.html?companyId=${companyId}&companyName=${encodeURIComponent(currentCompanyName)}`;
                recordNewAppBtn.style.display = 'inline-flex';
            }

            renderApplications(result.applications);
        } else {
            throw new Error(result.message || 'API returned non-success status.');
        }

    } catch (error) { 
        console.error("Error fetching applications:", error);
        companyNameDisplay.textContent = 'Error'; 
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-error">Failed to load application history.</td></tr>`;
        showStatus(error.message || 'Failed to connect to the applications server.', 'error');
    }
}


// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    // 1. Get company ID and Name from URL
    const params = getUrlParams();
    
    if (params.companyId) {
        currentCompanyId = params.companyId;
        
        // FIX: If the name is in the URL, display it immediately
        if (params.companyName) {
             currentCompanyName = decodeURIComponent(params.companyName);
             companyNameDisplay.textContent = currentCompanyName;
        }

        // 2. Begin data fetch (This will run the API call)
        fetchApplications(currentCompanyId);
    } else {
        // 3. Handle missing ID
        companyNameDisplay.textContent = 'N/A';
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-error">Error: Missing Company ID in URL.</td></tr>`;
        
        // Hide the button if we don't know the company
        if (recordNewAppBtn) {
            recordNewAppBtn.style.display = 'none';
        }
    }
    lucide.createIcons();
});
