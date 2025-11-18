// FILENAME: management.js | Core logic for the Company Management View.
// Version: v1.17 - FIX: Implemented "Max Force JSON Fix." The request body is now 
// explicitly JSON.stringified, and the 'Content-Type' header is explicitly added
// for POST/PUT requests, overriding the utility's unreliable auto-detection 
// to ensure the server correctly processes the request.

// --- Import Only Exported Utilities from core-utils.js ---
import { 
    initializeServices, 
    fetchWithGuard 
} from './core-utils.js'; 

// Import the reusable sidebar initialization function
import { initSidebar } from './company_sidebar.js';

// --- MOCK AUTHENTICATION WORKAROUND ---
// Only includes Authorization. For POST/PUT with a body, Content-Type will be 
// explicitly added in handleSaveProfile() to ensure the body is processed correctly.
const MOCK_AUTH_HEADERS = {
    'Authorization': 'Bearer MOCK_TOKEN',
};

// --- API Endpoints ---
const API_URLS = {
    // API 3.0 & 4.0: GET/PUT /api/companies/{companyId} (Base profile endpoint)
    PROFILE: (id) => `/api/companies/${id}`,
    // ASSUMED API for Creation: POST /api/companies
    CREATE: '/api/companies',
    // API 12.0: GET /api/companies/{companyId}/raw_names
    RAW_NAMES: (id) => `/api/companies/${id}/raw_names`,
    // API 13.0: GET /api/companies/{companyId}/contacts
    CONTACTS: (id) => `/api/companies/${id}/contacts`,
    // API 5.0: DELETE /api/companies/{companyId}
    DELETE: (id) => `/api/companies/${id}`,
};

// --- Global State & DOM Elements ---
let currentCompanyId = null;

// Form Elements
const companyForm = document.getElementById('companyForm');
const saveProfileButton = document.getElementById('saveProfileButton');
const saveProfileButtonText = document.getElementById('saveProfileButtonText');
const deleteProfileButton = document.getElementById('deleteProfileButton');
const createNewCompanyBtn = document.getElementById('createNewCompanyBtn'); 
const createNewCompanyBtnPlaceholder = document.getElementById('createNewCompanyBtnPlaceholder'); 

// View/Container Elements
const profileTitle = document.getElementById('profileTitle');
const rawNamesList = document.getElementById('rawNamesList');
const contactsTableBody = document.getElementById('contactsTableBody');
const initialPlaceholder = document.getElementById('initialPlaceholder');
const managementContent = document.getElementById('managementContent');
const profileViewSection = document.getElementById('profileViewSection');
const toastContainer = document.getElementById('toastContainer');


// --- Utility Functions ---

/**
 * Shows a toast notification.
 * @param {string} message The message to display.
 * @param {'success'|'error'|'warning'} type The type of notification (for color/icon).
 */
function showToast(message, type = 'success') {
    if (!toastContainer) return; // Defensive check

    const iconMap = {
        success: 'check-circle',
        error: 'x-circle',
        warning: 'alert-triangle'
    };
    const colorMap = {
        success: 'bg-green-500 border-green-700',
        error: 'bg-red-500 border-red-700',
        warning: 'bg-yellow-500 border-yellow-700'
    };

    const toast = document.createElement('div');
    toast.className = `p-4 rounded-lg shadow-xl text-white border-l-4 ${colorMap[type]} transition-all duration-300 transform translate-x-full opacity-0 fixed top-4 right-4 z-50`;
    toast.innerHTML = `
        <div class="flex items-center">
            <span data-lucide="${iconMap[type]}" class="w-5 h-5 mr-3"></span>
            <p class="text-sm font-medium">${message}</p>
        </div>
    `;

    toastContainer.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
        toast.classList.remove('translate-x-full', 'opacity-0');
        toast.classList.add('translate-x-0', 'opacity-100');
    }, 10);

    // Animate out and remove
    setTimeout(() => {
        toast.classList.remove('translate-x-0', 'opacity-100');
        toast.classList.add('translate-x-full', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 5000);

    // Re-create icons for the new toast
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}


// --- Rendering Functions ---

/**
 * Fills the form fields with company profile data.
 * @param {Object} data - The company profile object.
 */
function populateCompanyForm(data) {
    const dataIsPresent = data && Object.keys(data).length > 0;

    // CRITICAL: Handle visibility first
    if (initialPlaceholder) initialPlaceholder.classList[dataIsPresent ? 'add' : 'remove']('hidden');
    if (managementContent) managementContent.classList[dataIsPresent ? 'remove' : 'add']('hidden');

    if (!dataIsPresent) {
        // If data is empty or invalid, reset the form and show a placeholder message for the form content
        if (companyForm) companyForm.reset();
        if (profileTitle) profileTitle.textContent = 'Company Not Found';
        if (saveProfileButtonText) saveProfileButtonText.textContent = 'Create Profile';
        if (deleteProfileButton) deleteProfileButton.classList.add('hidden');
        if (profileViewSection) profileViewSection.classList.add('hidden');
        return;
    }

    // Retrieve form fields by their ID
    const companyNameCleanInput = document.getElementById('company_name_clean');
    const headquartersInput = document.getElementById('headquarters');
    const sizeEmployeesInput = document.getElementById('size_employees');
    const annualRevenueInput = document.getElementById('annual_revenue');
    const revenueScaleInput = document.getElementById('revenue_scale');
    const notesInput = document.getElementById('notes');
    const isTargetCheckbox = document.getElementById('is_target'); 

    // Populate the form fields. Use || '' to gracefully handle null/undefined data.
    if (companyNameCleanInput) companyNameCleanInput.value = data.company_name_clean || '';
    if (headquartersInput) headquartersInput.value = data.headquarters || '';
    if (sizeEmployeesInput) sizeEmployeesInput.value = data.size_employees || '';
    if (annualRevenueInput) annualRevenueInput.value = data.annual_revenue || '';
    if (revenueScaleInput) revenueScaleInput.value = data.revenue_scale || '';
    if (notesInput) notesInput.value = data.notes || '';
    
    // Populate the checkbox using the API field name (assuming it comes back as 'is_target')
    if (isTargetCheckbox) isTargetCheckbox.checked = !!data.is_target; 
    
    // Update the header title and button state
    if (profileTitle) profileTitle.textContent = data.company_name_clean || 'Company Profile';
    if (saveProfileButtonText) saveProfileButtonText.textContent = 'Save Changes';
    if (deleteProfileButton) deleteProfileButton.classList.remove('hidden');
    if (profileViewSection) profileViewSection.classList.remove('hidden'); // Show related data sections
}

/**
 * Renders the list of raw names/aliases.
 * @param {Array<string|Object>} rawNames - Array of raw name strings or objects.
 */
function renderRawNames(rawNames) {
    if (!rawNamesList) return; // Defensive check
    rawNamesList.innerHTML = ''; // Clear previous list
    
    if (!Array.isArray(rawNames) || rawNames.length === 0) {
        rawNamesList.innerHTML = '<li class="p-3 text-gray-500 italic">No alternative names/aliases found.</li>';
        return;
    }

    rawNames.forEach(rawName => {
        let nameText = 'N/A';
        let idDisplay = ''; // Default to no ID display

        if (typeof rawName === 'string') {
            // Case 1: Raw name is a string (based on your curl output)
            nameText = rawName;
        } else if (typeof rawName === 'object' && rawName !== null) {
            // Case 2: Raw name is an object (fallback/legacy or alternate API design)
            nameText = rawName.raw_name || 'N/A'; 
            const idText = rawName.mapping_id || 'N/A';
            if (idText !== 'N/A') {
                idDisplay = `<span class="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">ID: ${idText}</span>`;
            }
        }
        
        // Skip rendering if the name text is still N/A
        if (nameText === 'N/A') return;

        const listItem = document.createElement('li');
        listItem.className = 'flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg transition duration-100';
        listItem.innerHTML = `
            <div class="font-medium text-gray-700">${nameText}</div>
            ${idDisplay}
        `;
        rawNamesList.appendChild(listItem);
    });
}

/**
 * Renders the table of associated contacts.
 * @param {Array<Object>} contacts - Array of contact objects.
 */
function renderContacts(contacts) {
    if (!contactsTableBody) return; // Defensive check
    contactsTableBody.innerHTML = ''; // Clear previous contacts
    // Use Array.isArray for robust check
    if (!Array.isArray(contacts) || contacts.length === 0) {
        contactsTableBody.innerHTML = `
            <tr>
                <td colspan="4" class="px-6 py-4 text-center text-sm text-gray-500 italic">No associated contacts found.</td>
            </tr>
        `;
        return;
    }

    contacts.forEach(contact => {
        // Use the new, specific API field names
        const name = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'N/A';
        const title = contact.position || 'N/A';
        const email = contact.email_address || 'N/A';
        // For status, we will infer 'Active' if 'connected_on' is present, otherwise 'Pending'.
        const status = contact.connected_on ? 'Active' : 'Pending';
        
        // Determine status styling
        let statusClass = 'text-yellow-700 bg-yellow-100'; // Default to Pending
        if (status.toLowerCase() === 'active') statusClass = 'text-green-700 bg-green-100';

        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50 transition duration-100';
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${name}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${title}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${email}</td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">
                    ${status}
                </span>
            </td>
        `;
        contactsTableBody.appendChild(row);
    });
}


// --- Data Loading & API Functions ---

/**
 * Loads all data for a specific company profile (main, raw names, and contacts).
 * @param {string} id - The company ID.
 */
export async function loadCompanyData(id) {
    currentCompanyId = id;

    // Immediately hide placeholder and show content area while waiting for fetch
    if (initialPlaceholder) initialPlaceholder.classList.add('hidden');
    if (managementContent) managementContent.classList.remove('hidden');
    
    try {
        // 1. Fetch main company profile
        const profilePromise = fetchWithGuard(
            API_URLS.PROFILE(id), 
            'GET', 
            `Fetch Company Profile ${id}`,
            // Pass MOCK_AUTH_HEADERS inside the options object
            { headers: MOCK_AUTH_HEADERS }
        );

        // 2. Fetch related data in parallel
        const rawNamesPromise = fetchWithGuard(
            API_URLS.RAW_NAMES(id), 
            'GET', 
            `Fetch Raw Names for ${id}`,
            // Pass MOCK_AUTH_HEADERS inside the options object
            { headers: MOCK_AUTH_HEADERS }
        );
        
        const contactsPromise = fetchWithGuard(
            API_URLS.CONTACTS(id), 
            'GET', 
            `Fetch Contacts for ${id}`,
            // Pass MOCK_AUTH_HEADERS inside the options object
            { headers: MOCK_AUTH_HEADERS }
        );

        const [profileResponse, rawNamesResponse, contactsResponse] = await Promise.all([
            profilePromise, 
            rawNamesPromise, 
            contactsPromise
        ]);

        // 3. Populate Form and Render Related Data
        
        // Use the strict key provided by documentation (company)
        const profileData = profileResponse?.company || {};
        
        // Ensure data is an array before attempting to render
        const rawNamesData = Array.isArray(rawNamesResponse?.raw_names) ? rawNamesResponse.raw_names : [];
        const contactsData = Array.isArray(contactsResponse?.contacts) ? contactsResponse.contacts : [];

        // --- DEBUG LOG ---
        console.log('Raw Names Data received:', rawNamesData); 
        // -----------------

        // populateCompanyForm handles visibility based on data presence
        populateCompanyForm(profileData); 
        renderRawNames(rawNamesData);
        renderContacts(contactsData);

    } catch (error) {
        console.error(`Error loading company data for ID ${id}:`, error);
        showToast(`Failed to load company profile. ${error.message}`, 'error');
        // If loading fails, reset to "Create New" state
        handleCreateNewProfile(); 
        if (profileTitle) profileTitle.textContent = `Error Loading ID ${id}`;
    }

    // Ensure icons are created after dynamic content is added
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}


/**
 * Collects form data and serializes it into a sparse API payload structure, 
 * omitting keys with empty values to avoid JSON formatting issues, EXCEPT for booleans.
 * @returns {Object} The JSON payload data collected from the form.
 */
function serializeFormData() {
    // CRITICAL FIX: Check if companyForm exists before querying its elements
    if (!companyForm) return {};
    
    const data = {};
    const inputs = companyForm.querySelectorAll('input, select, textarea');

    inputs.forEach(input => {
        // Only proceed if the input has a name for API mapping
        if (!input.name) return;

        if (input.type === 'checkbox') {
            // CRITICAL: Checkbox value (is_target) is always included as a boolean
            data[input.name] = input.checked;
            return;
        }

        // Get value and trim, which covers non-checkbox/non-number fields
        const value = input.value.trim();
        
        // Skip the key entirely if the value is empty
        if (value === '') {
            return; 
        }

        if (input.type === 'number') {
            const numValue = parseFloat(value);
            // Include only if it's a valid, finite number
            if (isNaN(numValue) || !isFinite(numValue)) {
                return; 
            }
            data[input.name] = numValue;
        } else {
            // Include non-empty strings/select values
            data[input.name] = value;
        }
    });
    
    return data;
}


/**
 * Handles the submission of the profile form (Create or Update).
 * @param {Event} event - The form submission event.
 */
async function handleSaveProfile(event) {
    // Prevent the default browser action (needed for form submit and button click)
    event.preventDefault(); 

    // Determine if this is a POST (Create) or PUT (Update) operation
    const isUpdate = currentCompanyId !== null;
    const method = isUpdate ? 'PUT' : 'POST';
    const url = isUpdate ? API_URLS.PROFILE(currentCompanyId) : API_URLS.CREATE;
    // Ensure 'Creating' is spelled correctly
    const actionName = isUpdate ? 'Updat' : 'Creat'; 

    // Get the raw data object from the form (this is sparse, missing empty fields)
    const rawData = serializeFormData();
    
    // Basic validation for required field
    if (!rawData.company_name_clean) {
        // Show explicit error and return
        showToast('Validation Error: Official Company Name is required to save a profile.', 'error');
        return; 
    }

    let payloadObject;
    
    if (!isUpdate) {
        // 1. Build the non-sparse flat object for creation (v1.12 logic retained)
        const flatObject = {
            company_name_clean: rawData.company_name_clean || '',
            is_target: !!rawData.is_target, // Must be a boolean
            // Ensure all other expected keys are present, even if empty/null
            headquarters: rawData.headquarters || '',
            size_employees: rawData.size_employees === undefined ? null : rawData.size_employees,
            annual_revenue: rawData.annual_revenue === undefined ? null : rawData.annual_revenue,
            revenue_scale: rawData.revenue_scale || '',
            notes: rawData.notes || '',
        };

        // This flat payload is what the backend expects for POST
        payloadObject = flatObject; 
        
    } else {
        // For updates (PUT), the sparse payload is preferred and remains flat.
        payloadObject = rawData; 
    }

    // DEBUG: Log the final object we are passing to fetchWithGuard
    console.log(`[Form Submit] Method: ${method}, URL: ${url}`);
    console.log(`[Form Submit] FINAL JS OBJECT Payload (Flat for POST):`, payloadObject);

    // Capture the original state of the button text
    const originalButtonText = isUpdate ? 'Save Changes' : 'Create Profile';

    try {
        if (saveProfileButton) saveProfileButton.disabled = true;
        // Uses 'Creating' or 'Updating' correctly
        if (saveProfileButtonText) saveProfileButtonText.textContent = `${actionName}ing...`; 

        // --- CRITICAL FIX v1.17: Maximum Force JSON Configuration ---
        // Since the utility's automatic handling is failing to set Content-Type 
        // reliably, we explicitly set the header and manually stringify the body 
        // to guarantee the request matches the successful cURL format.
        const fetchOptions = {
            headers: {
                // Combine Authorization from MOCK_AUTH_HEADERS
                'Authorization': MOCK_AUTH_HEADERS.Authorization,
                // Explicitly set Content-Type to match the successful cURL
                'Content-Type': 'application/json',
            },
            // Manually stringify the body to ensure it is sent as a raw string 
            // of JSON, just like in the cURL command.
            body: JSON.stringify(payloadObject), 
        };
        // -----------------------------------------------------------

        const response = await fetchWithGuard(
            url,
            method,
            `${actionName}e Company Profile`, // Passed to fetchWithGuard for error logging
            fetchOptions // PASSING SINGLE OPTIONS OBJECT
        );

        showToast(`Company profile ${actionName.toLowerCase()}ed successfully!`, 'success');
        
        // If creation was successful, redirect to the management view with the new ID
        // The API returns the new company_id, possibly nested
        const newCompanyId = response.company?.company_id || response.data?.company_id || response.company_id;
        
        if (!isUpdate && newCompanyId) {
            // Navigate to the new profile page to view/edit it
            window.location.assign(`management.html?companyId=${newCompanyId}`);
            return;
        }
        
        // For updates, just reload the data
        if (isUpdate) {
            loadCompanyData(currentCompanyId);
        }

    } catch (error) {
        console.error(`Error during ${actionName}e operation:`, error);
        // Ensure error toast uses the action name
        showToast(`Failed to ${actionName.toLowerCase()}e profile: ${error.message}`, 'error');
    } finally {
        // CRITICAL: Ensure button state is always reset, even after success or failure
        if (saveProfileButton) saveProfileButton.disabled = false;
        if (saveProfileButtonText) saveProfileButtonText.textContent = originalButtonText;
    }
}


/**
 * Sets the UI state for creating a new profile.
 */
function handleCreateNewProfile() {
    currentCompanyId = null; // CRITICAL: Clear the current ID to force POST on save

    // 1. Clear Form and Headings
    if (companyForm) companyForm.reset(); 
    if (profileTitle) profileTitle.textContent = 'Create New Company Profile';
    if (saveProfileButtonText) saveProfileButtonText.textContent = 'Create Profile';
    
    // 2. Clear Related Data Views
    if (rawNamesList) rawNamesList.innerHTML = '<li class="p-3 text-gray-500 italic">Save the profile to see associated data.</li>';
    if (contactsTableBody) contactsTableBody.innerHTML = `
        <tr>
            <td colspan="4" class="px-6 py-4 text-center text-sm text-gray-500 italic">Save the profile to see associated data.</td>
        </tr>
    `;

    // 3. Update Button/Section Visibility
    if (deleteProfileButton) deleteProfileButton.classList.add('hidden'); // Hide delete button for new profiles
    if (initialPlaceholder) initialPlaceholder.classList.add('hidden'); // Hide placeholder
    if (managementContent) managementContent.classList.remove('hidden'); // Show content form
    if (profileViewSection) profileViewSection.classList.add('hidden'); // Hide Raw Names/Contacts section
    
    // Ensure icons are created
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

/**
 * Handles the deletion of the current company profile.
 */
async function handleDeleteProfile() {
    if (!currentCompanyId) {
        showToast('No company selected to delete.', 'warning');
        return;
    }
    
    // CRITICAL: Ensure deleteProfileButton exists before accessing its classes/text
    if (!deleteProfileButton) return; 

    // IMPORTANT: Since alert() and confirm() are forbidden, we'll implement a simple
    // confirmation logic here by temporarily disabling the button and asking for a double-click
    if (!deleteProfileButton.classList.contains('confirm-delete')) {
        deleteProfileButton.innerHTML = `<span data-lucide="trash-2" class="w-5 h-5 mr-2"></span> Click Again to Confirm Delete`;
        deleteProfileButton.classList.add('confirm-delete');
        
        // Reset confirmation state after 3 seconds
        setTimeout(() => {
            if (deleteProfileButton) {
                deleteProfileButton.innerHTML = `<span data-lucide="trash-2" class="w-5 h-5 mr-2"></span> Delete Profile`;
                deleteProfileButton.classList.remove('confirm-delete');
                if (typeof lucide !== 'undefined') { lucide.createIcons(); }
            }
        }, 3000);
        return;
    }
    
    // --- Deletion Logic ---
    try {
        deleteProfileButton.disabled = true;
        deleteProfileButton.innerHTML = `<span data-lucide="loader-2" class="w-5 h-5 mr-2 animate-spin"></span> Deleting...`;
        deleteProfileButton.classList.remove('confirm-delete');

        await fetchWithGuard(
            API_URLS.DELETE(currentCompanyId),
            'DELETE',
            `Delete Company Profile ${currentCompanyId}`,
            // Pass MOCK_AUTH_HEADERS inside the options object
            { headers: MOCK_AUTH_HEADERS }
        );

        showToast('Company profile deleted successfully.', 'success');
        
        // After deletion, navigate back to the default (placeholder) state
        window.location.assign('management.html');

    } catch (error) {
        console.error('Error during delete operation:', error);
        showToast(`Failed to delete profile: ${error.message}`, 'error');
    } finally {
        deleteProfileButton.disabled = false;
        deleteProfileButton.innerHTML = `<span data-lucide="trash-2" class="w-5 h-5 mr-2"></span> Delete Profile`;
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }
}


// --- Initialization ---

/**
 * Main application initialization function.
 */
async function initManagement() {
    console.log('Initializing Management View...');

    // 1. Initialize Firebase services (used by core-utils and fetchWithGuard)
    const authResult = await initializeServices();
    const isAuthReady = authResult && authResult.isAuthReady; 
    
    if (!isAuthReady) {
         console.warn("Authentication not fully ready, using mock token for API calls.");
    }

    // 2. Get company ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const companyId = urlParams.get('companyId');
    
    // 3. Initialize the REUSABLE SIDEBAR
    // Note: initSidebar calls the API to populate the list
    initSidebar({ 
        activeCompanyId: companyId,
        targetPage: 'management.html' 
    });

    // 4. Attach Event Listeners
    // Attaches listener for 'Enter' key press on form fields
    if (companyForm) {
        console.log('[DOM Check] companyForm element found. Attaching submit listener.');
        companyForm.addEventListener('submit', handleSaveProfile);
    } else {
        console.error('[DOM Check] ERROR: companyForm element (ID: companyForm) not found. Save handler cannot be attached.');
    }
    
    // CRITICAL: Attach click listener directly to the button. This guarantees 
    // the save/create function runs, bypassing native form submission issues.
    if (saveProfileButton) {
        console.log('[DOM Check] saveProfileButton found. Attaching direct click listener.');
        saveProfileButton.addEventListener('click', handleSaveProfile);
    } else {
        console.error('[DOM Check] ERROR: saveProfileButton element not found.');
    }

    // Attach click handler to both "Create New" buttons
    if (createNewCompanyBtn) { 
        createNewCompanyBtn.addEventListener('click', handleCreateNewProfile);
    }
    // Corrected variable name from v1.11 typo
    if (createNewCompanyBtnPlaceholder) { 
        createNewCompanyBtnPlaceholder.addEventListener('click', handleCreateNewProfile);
    }
    if (deleteProfileButton) { 
        deleteProfileButton.addEventListener('click', handleDeleteProfile);
    }
    
    // 5. Load data if a company is selected
    if (companyId) {
        // CRITICAL: Immediately show the management view container when an ID is present
        // This ensures the view is shown even if the API data is empty/fails, 
        // allowing the form to display for "New Profile" state if necessary.
        if (initialPlaceholder) initialPlaceholder.classList.add('hidden');
        if (managementContent) managementContent.classList.remove('hidden');

        await loadCompanyData(companyId);
    } else {
        // If no ID is in the URL, show the placeholder
        if (initialPlaceholder) initialPlaceholder.classList.remove('hidden');
        if (managementContent) managementContent.classList.add('hidden');
        // If no ID, ensure we are in the "Create New" state when the DOM loads
        handleCreateNewProfile(); 
    }

    // 6. Initialize icons (for any static or initial content)
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

// Call the main initialization function when the DOM is ready
document.addEventListener('DOMContentLoaded', initManagement);

// CRITICAL EXPORT: Export loadCompanyData so the sidebar can trigger a reload 
// when the user navigates between companies by clicking a sidebar link.
window.loadCompanyData = loadCompanyData;