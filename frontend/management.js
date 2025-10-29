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
// FIX: Using the correct ID from management.html
const appReviewBtn = document.getElementById('appReviewBtn');

// --- Global State ---
let allCompanies = [];
let currentActiveLink = null;

// --- Utility Functions ---

function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.classList.remove('hidden', 'bg-error', 'bg-success');
    statusMessage.classList.add(type === 'error' ? 'bg-error' : 'bg-success');
    // Hide after 5 seconds
    setTimeout(() => { statusMessage.classList.add('hidden'); }, 5000);
}

function debounce(func, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

function getCompanyIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('companyId');
}

// --- Rendering Functions ---

function renderCompanies(companies) {
    if (companies.length === 0) {
        companyListElement.innerHTML = '<li class="p-4 text-center text-gray-500 italic">No companies found.</li>';
        return;
    }

    const html = companies.map(company => {
        // SIMPLIFIED FIX: The raw name count display is removed entirely.
        return `
            <li class="company-name-link block cursor-pointer px-6 py-3 text-sm text-gray-700 border-l-4 border-transparent hover:bg-gray-50 transition-colors" 
                data-id="${company.company_id}">
                ${company.company_name_clean}
            </li>
        `;
    }).join('');

    companyListElement.innerHTML = html;
}

function renderRawNames(rawNames) {
    if (!rawNames || rawNames.length === 0) {
        rawNamesList.innerHTML = '<li class="text-gray-500 italic">None</li>';
        return;
    }
    const html = rawNames.map(name => `<li>- ${name}</li>`).join('');
    rawNamesList.innerHTML = html;
}

function renderContacts(contacts) {
    if (!contacts || contacts.length === 0) {
        contactsTableBody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-gray-500 italic">No contacts found.</td></tr>';
        return;
    }

    const html = contacts.map(contact => `
        <tr class="hover:bg-gray-50">
            <td class="px-6 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                <a href="${contact.linkedin_url}" target="_blank" class="text-primary hover:underline" title="View LinkedIn Profile">
                    ${contact.contact_name} <i data-lucide="external-link" class="w-3 h-3 inline ml-1"></i>
                </a>
            </td>
            <td class="px-6 py-3 whitespace-nowrap text-sm text-gray-500">${contact.title || 'N/A'}</td>
            <td class="px-6 py-3 whitespace-nowrap text-sm text-gray-500">${contact.email || 'N/A'}</td>
        </tr>
    `).join('');

    contactsTableBody.innerHTML = html;
}

// --- Data Fetching ---

async function fetchAllCompanies() {
    try {
        const response = await fetch(API_BASE);
        if (!response.ok) {
            throw new Error('Failed to fetch initial company list.');
        }
        const result = await response.json();
        if (result.status === 'success' && Array.isArray(result.companies)) {
            allCompanies = result.companies;
            renderCompanies(allCompanies);
        } else {
            throw new Error(result.message || 'API returned a non-success status or malformed data.');
        }
    } catch (error) {
        console.error('Error fetching companies:', error);
        companyListElement.innerHTML = `<li class="p-4 text-center text-error">Error loading companies.</li>`;
    }
}

async function fetchCompaniesWithFilter() {
    const searchTerm = searchFilter.value.toLowerCase();
    const isTarget = targetFilter.checked;

    const filteredCompanies = allCompanies.filter(company => {
        const nameMatch = company.company_name_clean.toLowerCase().includes(searchTerm);
        const targetMatch = !isTarget || (isTarget && company.target_interest === true);
        return nameMatch && targetMatch;
    });

    renderCompanies(filteredCompanies);
}

// ----------------------------------------------------------------------
// CORE FIX: Load Profile and Set the Application Review Link
// ----------------------------------------------------------------------

async function loadCompanyProfile(companyId, linkElement) {
    // Show loading state and clear old data
    initialMessage.classList.add('hidden');
    profileContainer.classList.remove('hidden');
    companyForm.reset();
    saveBtn.disabled = true;
    
    // Check if companyTitle exists before using it (DEFENSIVE CODING)
    if (!companyTitle) {
         // This block should only hit if the 'companyTitle' element is missing from management.html
        console.error("Critical Error: DOM element 'companyTitle' not found. Check management.html.");
        showStatus('Error: Page structure is broken. Cannot find company title element.', 'error');
        return;
    }
    companyTitle.textContent = 'Loading...';

    // Ensure the Review Applications button is hidden/disabled initially
    const appReviewBtn = document.getElementById('appReviewBtn');
    if (appReviewBtn) {
        appReviewBtn.style.display = 'none';
        appReviewBtn.href = '#';
    }

    // Use the correct API endpoint path
    const companyProfileApi = `${API_BASE}/${companyId}`;
    
    try {
        const response = await fetch(companyProfileApi);
        
        if (!response.ok) {
            throw new Error(`Failed to load company profile. Status: ${response.status}.`);
        }
        
        const data = await response.json();

        // Check for data.company (the key returned by the backend)
        if (data.status === 'success' && data.company) {
            
            const profile = data.company; 
            
            const contacts = data.contacts || [];
            const rawNames = profile.raw_names || [];

            // Render Profile Details
            // FIX: Only update companyTitle (the inner <span>) to preserve the header's structure.
            companyTitle.textContent = profile.company_name_clean || 'N/A';
            
            // Populate Form Fields
            companyIdInput.value = profile.company_id;
            cleanNameInput.value = profile.company_name_clean || '';
            headquartersInput.value = profile.headquarters || '';
            employeesInput.value = profile.size_employees || '';
            revenueInput.value = profile.annual_revenue || '';
            revenueScaleSelect.value = profile.revenue_scale || 'M';
            targetInterestCheckbox.checked = profile.target_interest === true;
            notesTextarea.value = profile.notes || '';

            // Render Raw Names and Contacts
            renderRawNames(rawNames);
            renderContacts(contacts);
            contactCountSpan.textContent = `(${contacts.length})`;

            // Set the Application Review Link
            if (appReviewBtn && profile.company_name_clean) { 
                const encodedName = encodeURIComponent(profile.company_name_clean);
                appReviewBtn.href = `application_review.html?companyId=${profile.company_id}&companyName=${encodedName}`;
                appReviewBtn.style.display = 'inline-flex';
            }

            // Set Active Link
            let currentActiveLink = document.querySelector('.company-name-link.active');
            if (currentActiveLink) {
                currentActiveLink.classList.remove('active');
            }
            if (linkElement) {
                linkElement.classList.add('active');
                currentActiveLink = linkElement;
            }
            
            profileContainer.classList.remove('hidden');

        } else {
            throw new Error(data.message || 'Company profile data missing from response.');
        }

    } catch (error) {
        console.error('Error loading company profile:', error);
        companyTitle.textContent = 'Error Loading Profile';
        showStatus(error.message || 'An unexpected error occurred while loading the profile.', 'error');
        profileContainer.classList.add('hidden');
        initialMessage.classList.remove('hidden');
    } finally {
        saveBtn.disabled = false;
        lucide.createIcons();
    }
}
// --- Data Update (PUT Request) ---

async function handleUpdate(event) {
    event.preventDefault();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const companyId = companyIdInput.value;
    
    // Construct payload from form data
    const payload = {
        company_name_clean: cleanNameInput.value.trim(),
        headquarters: headquartersInput.value.trim(),
        size_employees: employeesInput.value.trim() ? parseInt(employeesInput.value.trim(), 10) : null,
        annual_revenue: revenueInput.value.trim() ? parseFloat(revenueInput.value.trim()) : null,
        revenue_scale: revenueScaleSelect.value,
        target_interest: targetInterestCheckbox.checked,
        notes: notesTextarea.value,
    };
    
    // Filter out fields with empty strings or nulls, except those that should explicitly be null/false
    const cleanedPayload = Object.fromEntries(
        Object.entries(payload).filter(([_, v]) => v !== '' && v !== null)
    );
    
    // Ensure target_interest is included even if false
    if (!payload.target_interest) {
        cleanedPayload.target_interest = false;
    }

    try {
        const response = await fetch(`${API_BASE}/${companyId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cleanedPayload)
        });

        const data = await response.json();

        if (response.ok && data.status === 'success') {
            showStatus('Company profile updated successfully.', 'success');
            saveBtn.textContent = 'Saved!';
            
            // Update the company list in the sidebar if the name changed
            if (data.updated_data.company_name_clean) {
                const newName = data.updated_data.company_name_clean;
                const link = currentActiveLink;
                if (link) {
                    // Update the sidebar link text
                    link.childNodes[0].textContent = newName; 
                    // Update the global state and re-render the list
                    await fetchAllCompanies();
                    // Re-mark the link as active
                    link.classList.remove('active');
                    link.classList.add('active'); 
                }
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

// --- Initialization Logic ---

async function initialLoad() {
    const companyIdFromUrl = getCompanyIdFromUrl();
    
    // 1. Fetch all companies to populate the sidebar list
    await fetchAllCompanies();

    // 2. If an ID was in the URL, load the specific profile
    if (companyIdFromUrl) {
        // Find the newly rendered link element in the sidebar list
        const linkElement = document.querySelector(`.company-name-link[data-id=\"${companyIdFromUrl}\"]`);

        if (linkElement) {
            // Load the profile and mark it as active
            await loadCompanyProfile(companyIdFromUrl, linkElement);
            
            // Optional: Clean up the URL bar
            window.history.replaceState(null, null, window.location.pathname);
        } else {
            console.warn(`Company ID ${companyIdFromUrl} not found in the sidebar list after fetching.`);
        }
    }
}


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

// 4. Initial Load - Now calls the new logic
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    initialLoad(); 
});