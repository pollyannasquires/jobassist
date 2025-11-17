// FILENAME: management.js | Core logic for the Company Management View.
// CRITICAL FIXES: 
// 1. Confirmed fix for import/call to use 'initializeServices' from core-utils.js.
// 2. CRITICAL: Updated loadCompanyData to correctly read profile data from the 'company' key 
//    in the API 3.0 GET response, matching the cURL output structure.

// --- Import Only Exported Utilities from core-utils.js ---
import { 
    initializeServices, 
    fetchWithGuard 
} from './core-utils.js'; 

// Import the reusable sidebar initialization function
import { initSidebar } from './company_sidebar.js';


// --- API Endpoints ---
const API_URLS = {
    // API 3.0 & 4.0: GET/PUT /api/companies/{companyId} (Base profile endpoint)
    PROFILE: (id) => `/api/companies/${id}`,
    // API 12.0: GET /api/companies/{companyId}/raw_names
    RAW_NAMES: (id) => `/api/companies/${id}/raw_names`,
    // API 13.0: GET /api/companies/{companyId}/contacts
    CONTACTS: (id) => `/api/companies/${id}/contacts`,
};

// --- Global State & DOM Elements ---
let currentCompanyId = null;
let companyForm = null;
let companyNameDisplay = null;
let companyIdDisplay = null;
let initialPlaceholder = null;
let managementContent = null;
let rawNamesTableBody = null;
let contactsTableBody = null;
let statusMessage = null;


// ---------------------------------------------------------------------
// --- DATA RENDERING FUNCTIONS ----------------------------------------
// ---------------------------------------------------------------------

/**
 * Renders the company profile data into the main form fields.
 * @param {object} profileData - The company profile data (from API 3.0 GET).
 */
function renderProfile(profileData) {
    if (!profileData) return;

    // Populate profile fields based on the expected structure
    document.getElementById('companyName').value = profileData.company_name_clean || '';
    document.getElementById('headquarters').value = profileData.headquarters || '';
    document.getElementById('website_url').value = profileData.website_url || '';
    
    // Ensure numerical fields are handled safely (can be null/undefined)
    // Note: The API returns these as strings in the cURL example, so we don't force a number type here,
    // but the input type is 'number' in HTML for validation.
    document.getElementById('size_employees').value = profileData.size_employees || '';
    document.getElementById('annual_revenue').value = profileData.annual_revenue || '';
    
    // Set other fields
    document.getElementById('revenue_scale').value = profileData.revenue_scale || 'B';
    document.getElementById('targetInterest').checked = profileData.target_interest || false;
    document.getElementById('notes').value = profileData.notes || '';
    
    // Update header display
    const displayName = profileData.company_name_clean || 'Company Profile Management';
    companyNameDisplay.textContent = displayName;
    companyIdDisplay.textContent = `ID: ${currentCompanyId}`;
    document.getElementById('pageTitle').textContent = `${displayName} | Management | JobAssist`;
}

/**
 * Renders the raw names list into the table.
 * @param {Array<string>} rawNames - Array of raw name strings (from API 12.0).
 */
function renderRawNames(rawNames) {
    if (!rawNamesTableBody) return;
    
    if (rawNames && Array.isArray(rawNames) && rawNames.length > 0) {
        rawNamesTableBody.innerHTML = rawNames.map(name => `
            <tr class="hover:bg-gray-50 transition">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${name}</td>
            </tr>
        `).join('');
    } else {
        rawNamesTableBody.innerHTML = `<tr><td class="text-center py-4 text-gray-500 italic">No raw names found.</td></tr>`;
    }
}

/**
 * Renders the contacts list into the table.
 * @param {Array<object>} contacts - Array of contact objects (from API 13.0).
 */
function renderContacts(contacts) {
    if (!contactsTableBody) return;

    if (contacts && Array.isArray(contacts) && contacts.length > 0) {
        contactsTableBody.innerHTML = contacts.map(contact => {
            const connectedDate = contact.connected_on ? new Date(contact.connected_on).toLocaleDateString() : 'N/A';
            return `
                <tr class="hover:bg-gray-50 transition">
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${contact.first_name || ''} ${contact.last_name || ''}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${contact.position || 'N/A'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${contact.email_address || 'N/A'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${connectedDate}</td>
                </tr>
            `;
        }).join('');
    } else {
        contactsTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-500 italic">No contacts found.</td></tr>`;
    }
}

/**
 * Displays a temporary status message (success/error).
 * @param {string} message - The message to display.
 * @param {('success'|'error'|'clear')} type - The type of message.
 */
function showStatusMessage(message, type) {
    statusMessage.textContent = message;
    statusMessage.style.opacity = '1';
    statusMessage.className = 'p-2 rounded-lg text-center font-medium transition-opacity duration-300';

    if (type === 'success') {
        statusMessage.classList.add('bg-success', 'text-white');
        statusMessage.classList.remove('bg-error');
    } else if (type === 'error') {
        statusMessage.classList.add('bg-error', 'text-white');
        statusMessage.classList.remove('bg-success');
    } else if (type === 'clear') {
        statusMessage.textContent = '';
        statusMessage.style.opacity = '0';
        statusMessage.classList.remove('bg-success', 'bg-error', 'text-white');
    }

    // Clear message after 5 seconds
    if (type !== 'clear') {
        setTimeout(() => showStatusMessage('', 'clear'), 5000); 
    }
}


// ---------------------------------------------------------------------
// --- DATA FETCHING & SAVING ------------------------------------------
// ---------------------------------------------------------------------

/**
 * Orchestrates the parallel fetching of all required company data.
 * @param {string} companyId - The ID of the company to load.
 */
async function loadCompanyData(companyId) {
    currentCompanyId = companyId;
    
    showStatusMessage('', 'clear'); // Clear status
    managementContent.classList.remove('hidden');
    initialPlaceholder.classList.add('hidden');
    
    // Set loading state in UI
    companyNameDisplay.textContent = 'Loading...';
    companyIdDisplay.textContent = 'ID: ' + companyId;
    rawNamesTableBody.innerHTML = `<tr><td class="text-center py-4 text-warning italic">Fetching raw names...</td></tr>`;
    contactsTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-warning italic">Fetching contacts...</td></tr>`;

    try {
        // Execute all three API calls in parallel using fetchWithGuard
        const [profileResponse, rawNamesResponse, contactsResponse] = await Promise.all([
            // fetchWithGuard(url, method, operationName)
            fetchWithGuard(API_URLS.PROFILE(companyId), 'GET', 'Fetch Company Profile'),
            fetchWithGuard(API_URLS.RAW_NAMES(companyId), 'GET', 'Fetch Raw Names'),
            fetchWithGuard(API_URLS.CONTACTS(companyId), 'GET', 'Fetch Contacts')
        ]);

        // 1. Render Profile 
        // CRITICAL FIX: The profile data is nested under the 'company' key.
        renderProfile(profileResponse.company || {});
        
        // 2. Render Raw Names (Data is directly under the 'raw_names' key in the response)
        renderRawNames(rawNamesResponse.raw_names || []);

        // 3. Render Contacts (Data is directly under the 'contacts' key in the response)
        renderContacts(contactsResponse.contacts || []);

    } catch (error) {
        console.error("Failed to load all company data:", error);
        
        // Update UI to reflect the failure
        companyNameDisplay.textContent = 'Data Load Error';
        rawNamesTableBody.innerHTML = `<tr><td class="text-center py-4 text-error italic">Error: Failed to load raw names.</td></tr>`;
        contactsTableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-error italic">Error: Failed to load contacts.</td></tr>`;
        
        showStatusMessage(`Failed to load data. Error: ${error.message.substring(0, 70)}...`, 'error');
    }
}


/**
 * Handles the submission of the Company Profile form (API 4.0 PUT).
 * @param {Event} event - The form submission event.
 */
async function handleSaveProfile(event) {
    event.preventDefault();

    if (!currentCompanyId) {
        showStatusMessage("Error: No company is currently selected to save.", 'error');
        return;
    }

    const formData = new FormData(companyForm);
    const saveButton = document.getElementById('saveProfileBtn');
    
    saveButton.disabled = true;
    saveButton.innerHTML = `<i data-lucide="loader-circle" class="w-5 h-5 inline mr-2 animate-spin"></i> Saving...`;
    // Re-create icons to show the loader
    if (typeof lucide !== 'undefined') lucide.createIcons(); 

    // Construct the complex payload based on the successful cURL request
    const payload = {
        // CRITICAL: Ensure company_id is present and parsed as an integer
        company_id: parseInt(currentCompanyId, 10), 
        
        // Text fields
        company_name_clean: formData.get('company_name_clean'),
        headquarters: formData.get('headquarters'),
        website_url: formData.get('website_url'),
        notes: formData.get('notes'),

        // Numerical fields, safely parsed
        size_employees: parseInt(formData.get('size_employees'), 10) || 0,
        annual_revenue: parseFloat(formData.get('annual_revenue')) || 0.0,
        
        // Selection/Checkbox fields
        revenue_scale: formData.get('revenue_scale'),
        target_interest: document.getElementById('targetInterest').checked, 
    };

    try {
        // The request body is passed in the options object for PUT
        const result = await fetchWithGuard(
            API_URLS.PROFILE(currentCompanyId), 
            'PUT', // positional method
            'Save Company Profile', // positional operationName
            { // options object
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }
        );

        if (result.status === 'success') {
            // Update the rendered name on success
            renderProfile(payload); // Optimistically update the UI with saved data
            showStatusMessage(`Successfully updated profile for ${payload.company_name_clean}.`, 'success');
        } else {
            // Check if the server returned a specific error message
            throw new Error(result.message || 'API returned failure status.');
        }

    } catch (error) {
        console.error("Failed to save company profile:", error);
        // Show a user-friendly error message
        showStatusMessage(`Failed to save profile. Details: ${error.message}`, 'error');
    } finally {
        // Reset the save button state
        saveButton.disabled = false;
        saveButton.innerHTML = `<i data-lucide="save" class="w-5 h-5 inline mr-2"></i> Save Profile`;
        if (typeof lucide !== 'undefined') lucide.createIcons(); 
    }
}


// ---------------------------------------------------------------------
// --- INITIALIZATION --------------------------------------------------
// ---------------------------------------------------------------------

/**
 * Main initialization function for the Management page.
 */
async function initManagement() {
    // 1. Initialize Firebase/Auth 
    await initializeServices();
    
    // 2. Perform DOM lookups
    companyNameDisplay = document.getElementById('companyNameDisplay');
    companyIdDisplay = document.getElementById('companyIdDisplay');
    initialPlaceholder = document.getElementById('initialPlaceholder');
    managementContent = document.getElementById('managementContent');
    companyForm = document.getElementById('companyForm');
    rawNamesTableBody = document.getElementById('rawNamesTableBody');
    contactsTableBody = document.getElementById('contactsTableBody');
    statusMessage = document.getElementById('statusMessage');

    // 3. Extract Company ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const companyId = urlParams.get('companyId');

    // 4. Initialize the REUSABLE SIDEBAR
    // This connects the sidebar to the company loading logic on this page.
    initSidebar({ 
        activeCompanyId: companyId,
        targetPage: 'management.html' 
    });

    // 5. Attach Event Listeners
    if (companyForm) {
        companyForm.addEventListener('submit', handleSaveProfile);
    }
    
    // 6. Load data if a company is selected
    if (companyId) {
        await loadCompanyData(companyId);
    } else {
        // If no ID is in the URL, show the placeholder
        initialPlaceholder.classList.remove('hidden');
        managementContent.classList.add('hidden');
        companyIdDisplay.textContent = 'ID: N/A';
    }

    // 7. Initialize icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

// Call the main initialization function when the DOM is ready
document.addEventListener('DOMContentLoaded', initManagement);

// CRITICAL EXPORT: Export loadCompanyData so the sidebar can trigger a reload 
// when the user navigates between companies by clicking a sidebar link.
window.loadCompanyData = loadCompanyData;