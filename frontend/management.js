// FILENAME: management.js | LAST EDITED: 2025-10-24 (Final Correction)

const API_BASE = '/api/companies';

// --- DOM Elements ---
const statusMessage = document.getElementById('statusMessage');
const companyListContainer = document.getElementById('companyListContainer');
const companyListElement = document.getElementById('companyList');
const profileContainer = document.getElementById('profileContainer');
const initialMessage = document.getElementById('initialMessage');
const companyForm = document.getElementById('companyForm');
const companyTitle = document.getElementById('companyTitle');
const rawNamesList = document.getElementById('rawNamesList');
const contactCountSpan = document.getElementById('contactCount');
const contactsTableBody = document.getElementById('contactsTableBody');
const searchFilter = document.getElementById('searchFilter');
const targetFilter = document.getElementById('targetFilter');

// Form field elements
const companyIdInput = document.getElementById('company_id');
const cleanNameInput = document.getElementById('company_name_clean');
const headquartersInput = document.getElementById('headquarters');
const employeesInput = document.getElementById('size_employees');
const revenueInput = document.getElementById('annual_revenue');
const revenueScaleSelect = document.getElementById('revenue_scale');
const targetInterestCheckbox = document.getElementById('target_interest');
const notesTextarea = document.getElementById('notes');
const saveBtn = document.getElementById('saveBtn');


// Global state
let allCompanies = [];
let currentCompanyId = null;
let currentActiveLink = null;

// --- Utility Functions ---

/**
 * Shows a status message (success or error).
 * @param {string} message 
 * @param {('success'|'error')} type 
 */
function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.classList.remove('bg-success', 'bg-error', 'hidden', 'opacity-0', 'translate-y-[-10px]');
    
    if (type === 'success') {
        statusMessage.classList.add('bg-success');
    } else {
        statusMessage.classList.add('bg-error');
    }
    
    // Animate in
    statusMessage.classList.add('opacity-100', 'translate-y-0');

    setTimeout(() => {
        // Animate out
        statusMessage.classList.remove('opacity-100', 'translate-y-0');
        statusMessage.classList.add('opacity-0', 'translate-y-[-10px]');
        
        // Hide after animation
        setTimeout(() => {
            statusMessage.classList.add('hidden');
        }, 300); 
    }, 4000);
}

/**
 * Creates a debounced function that delays execution.
 * @param {Function} func The function to debounce.
 * @param {number} delay The delay in milliseconds.
 * @returns {Function} The debounced function.
 */
function debounce(func, delay) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

/**
 * Formats a number with commas.
 * @param {number} num 
 * @returns {string}
 */
function formatNumber(num) {
    if (num === null || num === undefined) return '';
    return num.toLocaleString();
}

/**
 * Resets the profile form to initial state.
 */
function resetProfileView() {
    companyForm.reset();
    companyTitle.textContent = '';
    rawNamesList.innerHTML = '<p class="text-sm text-gray-500 italic">Select a company to load raw names.</p>';
    contactCountSpan.textContent = '0';
    contactsTableBody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-gray-500 italic">Select a company to load contacts.</td></tr>';
    profileContainer.classList.add('hidden');
    initialMessage.classList.remove('hidden');
}


// --- Rendering Functions ---

/**
 * Renders the list of companies in the sidebar.
 * @param {Array<Object>} companies 
 */
function renderCompanyList(companies) {
    if (companies.length === 0) {
        companyListElement.innerHTML = '<div class="p-4 text-center text-gray-500 italic">No companies found matching the filter criteria.</div>';
        return;
    }

    const html = companies.map(c => `
        <a href="#" class="company-name-link block p-4 hover:bg-gray-100 transition duration-150 ${c.company_id === currentCompanyId ? 'active' : ''}" 
           data-id="${c.company_id}" 
           data-target="${c.target_interest}">
            <div class="flex items-center justify-between">
                <span class="text-gray-800 font-medium">${c.company_name_clean}</span>
                <i data-lucide="zap" 
                   class="w-4 h-4 ${c.target_interest ? 'text-primary' : 'text-gray-300'}"
                   title="${c.target_interest ? 'Target Interest' : 'Not Target'}">
                </i>
            </div>
            <p class="text-sm text-gray-500 mt-0.5">Employees: ${c.size_employees ? formatNumber(c.size_employees) : 'N/A'}</p>
        </a>
    `).join('');

    companyListElement.innerHTML = html;
    // Re-initialize icons for the new content
    lucide.createIcons();
    
    // Re-select the active link if one exists
    if (currentCompanyId) {
        currentActiveLink = document.querySelector(`.company-name-link[data-id="${currentCompanyId}"]`);
        if (currentActiveLink) {
            currentActiveLink.classList.add('active');
        }
    }
}

/**
 * Renders the raw name list in the profile view.
 * @param {Array<string>} rawNames 
 */
function renderRawNames(rawNames) {
    rawNamesList.innerHTML = '';
    document.getElementById('rawNamesCount').textContent = (rawNames && rawNames.length) || 0; 

    if (!rawNames || rawNames.length === 0) {
        rawNamesList.innerHTML = '<p class="text-sm text-gray-500 italic">No raw names mapped yet.</p>';
        return;
    }

    const listHtml = rawNames.map(name => `
        <span class="inline-flex items-center px-3 py-1 mr-2 mb-2 text-xs font-medium bg-indigo-100 text-indigo-800 rounded-full">
            ${name}
        </span>
    `).join('');

    rawNamesList.innerHTML = `<div class="flex flex-wrap">${listHtml}</div>`;
}

/**
 * Renders the associated contacts table.
 * @param {Array<Object>} contacts 
 */
function renderContacts(contacts) {
    contactCountSpan.textContent = (contacts && contacts.length) || 0;
    
    if (!contacts || contacts.length === 0) {
        contactsTableBody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-gray-500 italic">No contacts associated with this company.</td></tr>';
        return;
    }
    
    const html = contacts.map(contact => {
        let nameContent;
        if (contact.linkedin_url) {
            nameContent = `
                <a href="${contact.linkedin_url}" target="_blank" 
                   class="text-primary hover:text-indigo-700 transition duration-150 flex items-center">
                    <i data-lucide="linkedin" class="w-4 h-4 mr-1"></i>
                    ${contact.name}
                </a>
            `;
        } else {
            nameContent = contact.name;
        }

        return `
            <tr class="hover:bg-gray-50 transition duration-100">
                <td class="px-6 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                    ${nameContent}
                </td>
                <td class="px-6 py-3 whitespace-nowrap text-sm text-gray-500">${contact.job_title}</td>
                <td class="px-6 py-3 whitespace-nowrap text-sm text-gray-500">${contact.email}</td>
            </tr>
        `;
    }).join('');
    
    contactsTableBody.innerHTML = html;
    // Re-initialize icons for the new content (especially the LinkedIn icon)
    lucide.createIcons();
}


// --- Data Fetching and Logic ---

/**
 * Main function to fetch company list with current filters applied.
 */
async function fetchCompaniesWithFilter() {
    const search = searchFilter.value.trim();
    const target = targetFilter.value; // 'all', 'true', or 'false'
    
    let url = API_BASE;
    const params = new URLSearchParams();
    
    if (search) {
        params.append('search', search);
    }
    if (target !== 'all') {
        params.append('target_interest', target);
    }

    if (params.toString()) {
        url += '?' + params.toString();
    }
    
    try {
        // Show loading state in the sidebar
        companyListElement.innerHTML = '<div class="p-4 text-center text-gray-500 italic"><i data-lucide="loader-circle" class="w-5 h-5 inline mr-2 animate-spin"></i>Loading companies...</div>';
        lucide.createIcons();

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        // The API is expected to return { companies: [...] }
        allCompanies = data.companies || []; 
        
        renderCompanyList(allCompanies);

    } catch (error) {
        console.error('Error fetching company list:', error);
        companyListElement.innerHTML = '<div class="p-4 text-center text-error italic">Failed to load companies. Check API connection.</div>';
    }
}

/**
 * Initial load function (simply calls the filter function).
 */
function fetchAllCompanies() {
    fetchCompaniesWithFilter();
}


/**
 * Fetches and displays a single company's detailed profile, including related data.
 * This function now uses two chained API calls to get core profile data and then related data.
 * @param {number} companyId 
 * @param {HTMLElement} linkElement 
 */
// management.js (updated to fix profile loading issues)
async function loadCompanyProfile(companyId, linkElement) {
    if (currentCompanyId === companyId) return;

    // 1. Update active link in the sidebar
    if (currentActiveLink) {
        currentActiveLink.classList.remove('active');
    }
    linkElement.classList.add('active');
    currentActiveLink = linkElement;

    // 2. Update global state and UI
    currentCompanyId = companyId;
    initialMessage.classList.add('hidden');
    profileContainer.classList.remove('hidden');
    companyTitle.textContent = 'Loading...';
    
    // Clear dynamic content while loading
    rawNamesList.innerHTML = '<p class="text-sm text-gray-500 italic">Loading...</p>';
    contactsTableBody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-gray-500 italic">Loading...</td></tr>';

    try {
        // --- API Call 1: Fetch Core Profile Data (GET /api/companies/<id>) ---
        const profileUrl = `${API_BASE}/${companyId}`; 
        const profileResponse = await fetch(profileUrl);
        
        if (!profileResponse.ok) {
            throw new Error(`HTTP error! status: ${profileResponse.status} for profile.`);
        }
        
        const profileData = await profileResponse.json();
        
        // FIX 1: Extract the profile data from the 'company' key
        const profile = profileData.company; 

        // FIX 2: Check for the correct field name: 'company_name_clean'
        if (!profile || typeof profile.company_name_clean === 'undefined') {
            throw new Error("API response structure error: Profile data object or 'company_name_clean' missing.");
        }
        
        // Populate form fields (Profile Data)
        companyTitle.textContent = profile.company_name_clean;
        companyIdInput.value = profile.company_id;
        // CORRECTED: Use the correct field name to populate the input
        cleanNameInput.value = profile.company_name_clean || '';
        
        headquartersInput.value = profile.headquarters || '';
        employeesInput.value = profile.size_employees || '';
        revenueInput.value = profile.annual_revenue || '';
        revenueScaleSelect.value = profile.revenue_scale || 'N';
        notesTextarea.value = profile.notes || '';
        targetInterestCheckbox.checked = profile.target_interest;


        // --- API Call 2: Fetch Related Data (GET /api/related_data/<id>) ---
        const relatedUrl = `/api/related_data/${companyId}`;
        const relatedResponse = await fetch(relatedUrl);

        if (relatedResponse.ok) {
            const relatedData = await relatedResponse.json();
            
            // The API is expected to return { raw_names: [], contacts: [] }
            const rawNames = relatedData.raw_names || [];
            const contacts = relatedData.contacts || [];

            // Render Mapped Names and Contacts (Related Data)
            renderRawNames(rawNames);
            renderContacts(contacts);
        } else {
            console.warn(`Warning: Failed to fetch related data (Status: ${relatedResponse.status}). Displaying empty lists.`);
            renderRawNames([]);
            renderContacts([]);
        }

    } catch (error) {
        console.error('Error loading company profile:', error);
        companyTitle.textContent = 'Error Loading Profile';
        showStatus('Failed to load company profile details. Check console for API status.', 'error');
        resetProfileView(); 
    }
}
/**
 * Handles the form submission (PUT request to update profile).
 * @param {Event} event 
 */
async function handleUpdate(event) {
    event.preventDefault();
    
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const companyId = companyIdInput.value;
    const url = `${API_BASE}/${companyId}`;
    
    // Collect form data
    const formData = {
        clean_name: cleanNameInput.value.trim(), 
        headquarters: headquartersInput.value.trim(),
        size_employees: parseInt(employeesInput.value) || null,
        annual_revenue: parseFloat(revenueInput.value) || null,
        revenue_scale: revenueScaleSelect.value,
        target_interest: targetInterestCheckbox.checked,
        notes: notesTextarea.value.trim(),
    };

    try {
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData),
        });

        const data = await response.json();

        if (response.ok) {
            fetchCompaniesWithFilter();
            showStatus(data.message || 'Company profile updated successfully.', 'success');
            
            if (currentActiveLink) {
                currentActiveLink.classList.remove('active');
                currentActiveLink.classList.add('active'); 
            }

        } else {
            console.error('Server update failure:', data);
            showStatus(`Update failed: ${data.message || 'Server error occurred.'}`, 'error');
        }

    } catch (error) {
        console.error('Update error:', error);
        showStatus('A network error occurred while attempting to save changes.', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
    }
}

// Create a debounced version of the company list loading function for filters
const debouncedLoadCompanies = debounce(fetchCompaniesWithFilter, 300);

// --- Event Listeners ---

// 1. Filter and Search listeners (debounced)
searchFilter.addEventListener('input', debouncedLoadCompanies);
targetFilter.addEventListener('change', debouncedLoadCompanies);

// 2. Company List click listener
companyListElement.addEventListener('click', (event) => {
    const link = event.target.closest('.company-name-link'); 
    if (link) {
        event.preventDefault(); 
        const companyId = parseInt(link.getAttribute('data-id'), 10);
        if (companyId > 0) {
            loadCompanyProfile(companyId, link);
        }
    }
});

// 3. Form Submission (PUT request)
companyForm.addEventListener('submit', handleUpdate);

// 4. Initial Load
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    fetchAllCompanies(); 
});
/**
 * Retrieves the company ID from the URL query parameter 'company_id'.
 * @returns {number|null} The company ID or null if not found.
 */
function getCompanyIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    // FIX: Look for 'company_id' to match the index.html link
    const id = params.get('company_id'); 
    return id ? parseInt(id, 10) : null;
}
// --- Initial Load Logic ---
async function initialLoad() {
    // 1. Initialize Lucide icons
    lucide.createIcons();

    const companyIdFromUrl = getCompanyIdFromUrl();

    // 2. Always fetch the full company list first (to populate the sidebar)
    // The previous profile loading fixes are already integrated into loadCompanyProfile
    await fetchCompaniesWithFilter();

    // 3. If an ID was in the URL, load the specific profile
    if (companyIdFromUrl) {
        // Find the newly rendered link element in the sidebar list
        const linkElement = document.querySelector(`.company-name-link[data-id="${companyIdFromUrl}"]`);

        if (linkElement) {
            // Load the profile and mark it as active
            await loadCompanyProfile(companyIdFromUrl, linkElement);
            
            // Optional: Clean up the URL bar
            window.history.replaceState(null, null, window.location.pathname);
        } else {
            // This happens if the company list fetch failed or the company was filtered out
            console.warn(`Company ID ${companyIdFromUrl} not found in the sidebar list after fetching.`);
        }
    }
}


// ... (Keep the debouncedLoadCompanies and Event Listeners logic the same) ...


// --- Event Listeners (Ensure this is the very last part of the file) ---

// 1. Filter and Search listeners (debounced)
searchFilter.addEventListener('input', debouncedLoadCompanies);
targetFilter.addEventListener('change', debouncedLoadCompanies);

// 2. Company List click listener
companyListElement.addEventListener('click', (event) => {
    // ... (Existing click logic remains here)
});

// 3. Form Submission (PUT request)
companyForm.addEventListener('submit', handleUpdate);

// 4. Initial Load - Now calls the new logic
document.addEventListener('DOMContentLoaded', initialLoad);