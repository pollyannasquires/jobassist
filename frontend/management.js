// FILENAME: management.js | Core logic for the Company Management View.
// Version: v1.24 - FIX: Restored the hyperlink for contact names in the table, 
// using the 'linkedin_url' from the API response to enable redirection.

// --- Import Only Exported Utilities from core-utils.js ---
import { 
    initializeServices, 
    fetchWithGuard 
} from './core-utils.js'; 

// Import the reusable sidebar initialization function
import { initSidebar } from './company_sidebar.js';

// --- MOCK AUTHENTICATION WORKAROUND ---
const MOCK_AUTH_HEADERS = {
    'Authorization': 'Bearer MOCK_TOKEN',
};

// --- API Endpoints ---
const API_URLS = {
    PROFILE: (id) => `/api/companies/${id}`,
    CREATE: '/api/companies',
    RAW_NAMES: (id) => `/api/companies/${id}/raw_names`,
    CONTACTS: (id) => `/api/companies/${id}/contacts`,
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
    if (!toastContainer) return; 

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
    
    // Look for either the correct ID or the old ID for compatibility
    const targetInterestCheckbox = document.getElementById('target_interest') || document.getElementById('is_target'); 

    // Populate the form fields. Use || '' to gracefully handle null/undefined data.
    if (companyNameCleanInput) companyNameCleanInput.value = data.company_name_clean || '';
    if (headquartersInput) headquartersInput.value = data.headquarters || '';
    if (sizeEmployeesInput) sizeEmployeesInput.value = data.size_employees || '';
    if (annualRevenueInput) annualRevenueInput.value = data.annual_revenue || '';
    if (revenueScaleInput) revenueScaleInput.value = data.revenue_scale || '';
    if (notesInput) notesInput.value = data.notes || '';
    
    // Populate the checkbox using the correct API field name (target_interest)
    // !!data.target_interest ensures the value is a boolean (true/false)
    if (targetInterestCheckbox) targetInterestCheckbox.checked = !!data.target_interest; 
    
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
    if (!rawNamesList) return; 
    rawNamesList.innerHTML = ''; // Clear previous list
    
    if (!Array.isArray(rawNames) || rawNames.length === 0) {
        rawNamesList.innerHTML = '<li class="p-3 text-gray-500 italic">No alternative names/aliases found.</li>';
        return;
    }

    rawNames.forEach(rawName => {
        let nameText = 'N/A';
        let idDisplay = ''; 

        if (typeof rawName === 'string') {
            nameText = rawName;
        } else if (typeof rawName === 'object' && rawName !== null) {
            nameText = rawName.raw_name || 'N/A'; 
            const idText = rawName.mapping_id || 'N/A';
            if (idText !== 'N/A') {
                idDisplay = `<span class="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">ID: ${idText}</span>`;
            }
        }
        
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
    if (!contactsTableBody) return; 
    contactsTableBody.innerHTML = ''; // Clear previous contacts
    if (!Array.isArray(contacts) || contacts.length === 0) {
        contactsTableBody.innerHTML = `
            <tr>
                <td colspan="4" class="px-6 py-4 text-center text-sm text-gray-500 italic">No associated contacts found.</td>
            </tr>
        `;
        return;
    }

    contacts.forEach(contact => {
        const name = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'N/A';
        const title = contact.position || 'N/A';
        const email = contact.email_address || 'N/A';
        const status = contact.connected_on ? 'Active' : 'Pending';
        
        let statusClass = 'text-yellow-700 bg-yellow-100'; 
        if (status.toLowerCase() === 'active') statusClass = 'text-green-700 bg-green-100';

        // V1.24 FIX: Create a linked name if linkedin_url is present
        const linkedName = contact.linkedin_url 
            ? `<a href="${contact.linkedin_url}" target="_blank" class="text-indigo-600 hover:text-indigo-900 font-semibold transition duration-150">${name}</a>`
            : name;

        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50 transition duration-100';
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${linkedName}</td>
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

    if (initialPlaceholder) initialPlaceholder.classList.add('hidden');
    if (managementContent) managementContent.classList.remove('hidden');
    
    try {
        // 1. Fetch main company profile
        const profilePromise = fetchWithGuard(
            API_URLS.PROFILE(id), 
            'GET', 
            `Fetch Company Profile ${id}`,
            { headers: MOCK_AUTH_HEADERS }
        );

        // 2. Fetch related data in parallel
        const rawNamesPromise = fetchWithGuard(
            API_URLS.RAW_NAMES(id), 
            'GET', 
            `Fetch Raw Names for ${id}`,
            { headers: MOCK_AUTH_HEADERS }
        );
        
        const contactsPromise = fetchWithGuard(
            API_URLS.CONTACTS(id), 
            'GET', 
            `Fetch Contacts for ${id}`,
            { headers: MOCK_AUTH_HEADERS }
        );

        const [profileResponse, rawNamesResponse, contactsResponse] = await Promise.all([
            profilePromise, 
            rawNamesPromise, 
            contactsPromise
        ]);

        // 3. Populate Form and Render Related Data
        
        const profileData = profileResponse?.company || {};
        const rawNamesData = Array.isArray(rawNamesResponse?.raw_names) ? rawNamesResponse.raw_names : [];
        const contactsData = Array.isArray(contactsResponse?.contacts) ? contactsResponse.contacts : [];

        // --- DEBUG LOG ---
        console.log('Raw Names Data received:', rawNamesData); 
        // -----------------

        populateCompanyForm(profileData); 
        renderRawNames(rawNamesData);
        renderContacts(contactsData);

    } catch (error) {
        console.error(`Error loading company data for ID ${id}:`, error);
        showToast(`Failed to load company profile. ${error.message}`, 'error');
        handleCreateNewProfile(); 
        if (profileTitle) profileTitle.textContent = `Error Loading ID ${id}`;
    }

    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}


/**
 * Collects form data and serializes it into a sparse API payload structure.
 * @returns {Object} The JSON payload data collected from the form.
 */
function serializeFormData() {
    if (!companyForm) return {};
    
    const data = {};
    
    // Explicitly and defensively read the checkbox state. 
    // We use the front-end key 'target_interest' temporarily, which will be mapped later.
    const targetInterestCheckbox = document.getElementById('target_interest') || document.getElementById('is_target');
    
    if (targetInterestCheckbox) {
        // Guarantee the key and a boolean value are added to the data object immediately.
        // We use the 'target_interest' key here because that is what the API uses for GET/PUT responses.
        data['target_interest'] = targetInterestCheckbox.checked; 
        console.log(`[Form Serialization] Checkbox state captured (key: target_interest): ${data['target_interest']}`);
    } else {
        data['target_interest'] = false;
        console.log('[Form Serialization] Checkbox element not found. Defaulting target_interest to false.');
    }
    

    // Now, iterate over the REST of the inputs, select, and textareas
    const inputs = companyForm.querySelectorAll('input, select, textarea');

    inputs.forEach(input => {
        // Skip the checkbox here, as we handled it explicitly above.
        if (input.type === 'checkbox') {
            return; 
        }
        if (!input.name) return;

        const value = input.value.trim();
        
        // Skip the key entirely if the value is empty
        if (value === '') {
            return; 
        }

        if (input.type === 'number') {
            const numValue = parseFloat(value);
            if (isNaN(numValue) || !isFinite(numValue)) {
                return; 
            }
            data[input.name] = numValue;
        } else {
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
    event.preventDefault(); 

    const isUpdate = currentCompanyId !== null;
    const method = isUpdate ? 'PUT' : 'POST';
    const url = isUpdate ? API_URLS.PROFILE(currentCompanyId) : API_URLS.CREATE;
    const actionName = isUpdate ? 'Updat' : 'Creat'; 

    const rawData = serializeFormData();
    
    if (!rawData.company_name_clean) {
        showToast('Validation Error: Official Company Name is required to save a profile.', 'error');
        return; 
    }

    let payloadObject;
    
    if (!isUpdate) {
        // --- POST (Create) path: Requires all mandatory fields and uses 'is_target' ---
        
        const flatObject = {
            company_name_clean: rawData.company_name_clean || '',
            
            // CRITICAL V1.23 FIX: Map the internal 'target_interest' key to the API's 'is_target' key for POST.
            is_target: rawData.target_interest, 
            
            headquarters: rawData.headquarters || '',
            size_employees: rawData.size_employees === undefined ? null : rawData.size_employees,
            annual_revenue: rawData.annual_revenue === undefined ? null : rawData.annual_revenue,
            revenue_scale: rawData.revenue_scale || '',
            notes: rawData.notes || '',
        };

        payloadObject = flatObject; 
        
    } else {
        // --- PUT (Update) path: Uses the internal 'target_interest' key as required by the API. ---
        payloadObject = rawData; 
    }

    console.log(`[Form Submit] Method: ${method}, URL: ${url}`);
    console.log(`[Form Submit] FINAL JS OBJECT Payload:`, payloadObject);

    const originalButtonText = isUpdate ? 'Save Changes' : 'Create Profile';

    try {
        if (saveProfileButton) saveProfileButton.disabled = true;
        if (saveProfileButtonText) saveProfileButtonText.textContent = `${actionName}ing...`; 

        const fetchOptions = {
            headers: {
                'Authorization': MOCK_AUTH_HEADERS.Authorization,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payloadObject), 
        };

        const response = await fetchWithGuard(
            url,
            method,
            `${actionName}e Company Profile`, 
            fetchOptions 
        );

        showToast(`Company profile ${actionName.toLowerCase()}ed successfully!`, 'success');
        
        const newCompanyId = response.company?.company_id || response.data?.company_id || response.company_id;
        
        if (!isUpdate && newCompanyId) {
            // Redirect to the newly created company's profile
            window.location.assign(`management.html?companyId=${newCompanyId}`);
            return;
        }
        
        if (isUpdate) {
            // Reload the current company's data
            loadCompanyData(currentCompanyId);
        }

    } catch (error) {
        console.error(`Error during ${actionName}e operation:`, error);
        showToast(`Failed to ${actionName.toLowerCase()}e profile: ${error.message}`, 'error');
    } finally {
        if (saveProfileButton) saveProfileButton.disabled = false;
        if (saveProfileButtonText) saveProfileButtonText.textContent = originalButtonText;
    }
}


/**
 * Sets the UI state for creating a new profile.
 */
function handleCreateNewProfile() {
    currentCompanyId = null; 

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
    if (deleteProfileButton) deleteProfileButton.classList.add('hidden'); 
    if (initialPlaceholder) initialPlaceholder.classList.add('hidden'); 
    if (managementContent) managementContent.classList.remove('hidden'); 
    if (profileViewSection) profileViewSection.classList.add('hidden'); 
    
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
    
    if (!deleteProfileButton) return; 

    // Confirmation logic (two-click delete)
    if (!deleteProfileButton.classList.contains('confirm-delete')) {
        deleteProfileButton.innerHTML = `<span data-lucide="trash-2" class="w-5 h-5 mr-2"></span> Click Again to Confirm Delete`;
        deleteProfileButton.classList.add('confirm-delete');
        
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
            { headers: MOCK_AUTH_HEADERS }
        );

        showToast('Company profile deleted successfully.', 'success');
        
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

    // 1. Initialize Firebase services 
    const authResult = await initializeServices();
    const isAuthReady = authResult && authResult.isAuthReady; 
    
    if (!isAuthReady) {
         console.warn("Authentication not fully ready, using mock token for API calls.");
    }

    // 2. Get company ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const companyId = urlParams.get('companyId');
    
    // 3. Initialize the REUSABLE SIDEBAR
    initSidebar({ 
        activeCompanyId: companyId,
        targetPage: 'management.html' 
    });

    // 4. Attach Event Listeners
    if (companyForm) {
        console.log('[DOM Check] companyForm element found. Attaching submit listener.');
        companyForm.addEventListener('submit', handleSaveProfile);
    } else {
        console.error('[DOM Check] ERROR: companyForm element (ID: companyForm) not found. Save handler cannot be attached.');
    }
    
    if (saveProfileButton) {
        console.log('[DOM Check] saveProfileButton found. Attaching direct click listener.');
        saveProfileButton.addEventListener('click', handleSaveProfile);
    } else {
        console.error('[DOM Check] ERROR: saveProfileButton element not found.');
    }

    if (createNewCompanyBtn) { 
        createNewCompanyBtn.addEventListener('click', handleCreateNewProfile);
    }
    if (createNewCompanyBtnPlaceholder) { 
        createNewCompanyBtnPlaceholder.addEventListener('click', handleCreateNewProfile);
    }
    if (deleteProfileButton) { 
        deleteProfileButton.addEventListener('click', handleDeleteProfile);
    }
    
    // 5. Load data if a company is selected
    if (companyId) {
        if (initialPlaceholder) initialPlaceholder.classList.add('hidden');
        if (managementContent) managementContent.classList.remove('hidden');

        await loadCompanyData(companyId);
    } else {
        if (initialPlaceholder) initialPlaceholder.classList.remove('hidden');
        if (managementContent) managementContent.classList.add('hidden');
        handleCreateNewProfile(); 
    }

    // 6. Initialize icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

// Call the main initialization function when the DOM is ready
document.addEventListener('DOMContentLoaded', initManagement);

// CRITICAL EXPORT
window.loadCompanyData = loadCompanyData;