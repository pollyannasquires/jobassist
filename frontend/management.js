// FILENAME: management.js | LAST EDITED: 2025-10-24

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

// --- Utility Functions ---

/** Displays a status message to the user. */
function showStatus(message, type = 'success') {
    statusMessage.textContent = message;
    // Set classes based on type
    const baseClasses = 'p-3 rounded-lg mb-6 font-medium';
    const typeClasses = type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
    
    statusMessage.className = `${baseClasses} ${typeClasses}`;
    statusMessage.classList.remove('hidden');

    // Hide after 5 seconds
    setTimeout(() => statusMessage.classList.add('hidden'), 5000);
}

/** Clears the profile view and resets the form. */
function clearProfile() {
    profileContainer.classList.add('hidden');
    initialMessage.classList.remove('hidden');
    companyForm.reset();
    companyTitle.textContent = 'Company Profile Data'; // Reset detail title
    rawNamesList.innerHTML = '<p class="text-gray-500 italic text-sm">No names loaded.</p>';
    contactCountSpan.textContent = '0';
    // NOTE: Contacts table header might need adjustment in the HTML to match 3 columns
    contactsTableBody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-gray-500 italic">No contacts loaded.</td></tr>'; 
    currentCompanyId = null;
    
    // Deselect all company links
    document.querySelectorAll('.company-name-link').forEach(el => el.classList.remove('active'));
}

// --- List Loading and Filtering ---

/** Fetches all clean companies for the list view. */
async function fetchAllCompanies() {
    companyListElement.innerHTML = '<p class="text-center py-4 text-gray-500 italic">Fetching companies...</p>';
    try {
        // NOTE: Assuming /api/companies returns all clean company profiles
        const response = await fetch(API_BASE);
        const data = await response.json();

        if (response.ok) {
            allCompanies = data.companies || [];
            renderCompanyList();
        } else {
            showStatus(`Error fetching company list: ${data.message || 'Server error'}`, 'error');
            companyListElement.innerHTML = '<p class="p-4 text-center text-red-500 font-medium">Failed to load list.</p>';
        }
    } catch (error) {
        console.error('Fetch error for all companies:', error);
        showStatus('A network error occurred while loading the company list.', 'error');
    }
}

/** Filters and renders the company list based on current filters. */
function renderCompanyList() {
    const searchTerm = searchFilter.value.toLowerCase();
    const targetFilterValue = targetFilter.value;

    const filteredCompanies = allCompanies.filter(company => {
        // Name Search Filter
        const nameMatch = company.company_name_clean.toLowerCase().includes(searchTerm);
        
        // Target Interest Filter
        let targetMatch = true;
        if (targetFilterValue !== 'all') {
            // Note: target_interest from the API is a boolean, but filter value is a string.
            // JSON from Python often returns booleans as true/false, which JavaScript handles correctly.
            const isTarget = targetFilterValue === 'true'; 
            targetMatch = company.target_interest === isTarget;
        }

        return nameMatch && targetMatch;
    });

    if (filteredCompanies.length === 0) {
        companyListElement.innerHTML = `<p class="p-4 text-center text-gray-500 italic">No companies match your filters.</p>`;
        return;
    }

    companyListElement.innerHTML = filteredCompanies.map(company => `
        <div 
            class="company-name-link p-3 border-b border-gray-100 flex justify-between items-center cursor-pointer hover:bg-indigo-50 transition-colors" 
            data-id="${company.company_id}"
        >
            <span class="truncate pr-2">${company.company_name_clean}</span>
            <span class="text-xs font-semibold px-2 py-0.5 rounded-full ${company.target_interest ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}">
                ${company.target_interest ? 'TARGET' : 'No'}
            </span>
        </div>
    `).join('');

    // Re-highlight the currently loaded company if applicable
    if (currentCompanyId) {
        const activeLink = document.querySelector(`.company-name-link[data-id="${currentCompanyId}"]`);
        if (activeLink) {
            activeLink.classList.add('active');
        }
    }
}

// Simple debounce function
let debounceTimer;
function debouncedLoadCompanies() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(renderCompanyList, 300);
}

// --- Data Loading Functions ---

/** Fetches the main company profile data and populates the form fields. */
async function loadCompanyProfile(companyId, targetElement) {
    if (currentCompanyId === companyId) return; // Already loaded

    // 1. Update active selection in the list
    document.querySelectorAll('.company-name-link').forEach(el => el.classList.remove('active'));
    if (targetElement) {
        targetElement.classList.add('active');
    }

    // Show loading state in the profile area
    initialMessage.classList.add('hidden');
    profileContainer.classList.add('opacity-50', 'pointer-events-none');
    companyTitle.textContent = `Loading Company ID ${companyId}...`;
    
    currentCompanyId = companyId;

    try {
        const response = await fetch(`${API_BASE}/${companyId}`);
        const data = await response.json();

        if (response.ok) {
            const company = data.company;
            
            // 2. Populate form fields
            companyTitle.textContent = `${company.company_name_clean} (ID: ${company.company_id})`;
            cleanNameInput.value = company.company_name_clean || '';
            headquartersInput.value = company.headquarters || '';
            
            // Handle potential nulls from Python/PostgreSQL
            employeesInput.value = company.size_employees !== null && company.size_employees > 0 ? company.size_employees : '';
            revenueInput.value = company.annual_revenue !== null && company.annual_revenue > 0 ? company.annual_revenue : '';

            revenueScaleSelect.value = company.revenue_scale || '';
            targetInterestCheckbox.checked = company.target_interest === true;
            notesTextarea.value = company.notes || '';

            profileContainer.classList.remove('hidden');
            
            // 3. Load related data (contacts and raw names)
            await loadRelatedData(companyId);
            
            showStatus(`Profile for ${company.company_name_clean} loaded.`, 'success');

        } else if (response.status === 404) {
            showStatus(`Error: Company ID ${companyId} not found.`, 'error');
            clearProfile();
        } else {
            showStatus(`Error loading profile: ${data.message || 'Server error'}`, 'error');
            clearProfile();
        }

    } catch (error) {
        console.error('Fetch error for company profile:', error);
        showStatus('A network error occurred while trying to load the profile.', 'error');
        clearProfile();
    } finally {
        profileContainer.classList.remove('opacity-50', 'pointer-events-none');
    }
}

/** Fetches the related raw names and contacts and populates the lists/tables. */
async function loadRelatedData(companyId) {
    // Set loading states
    rawNamesList.innerHTML = '<p class="text-gray-500 italic text-sm">Loading linked names...</p>';
    contactsTableBody.innerHTML = '<tr><td colspan="3" class="text-center text-gray-500 italic py-4">Loading contacts...</td></tr>';
    contactCountSpan.textContent = '...';
    
    try {
        // NOTE: Uses the new /api/companies/{company_id}/related_data endpoint
        const response = await fetch(`${API_BASE}/${companyId}/related_data`); 
        const data = await response.json();
        
        if (response.ok) {
            // --- Raw Names ---
            const rawNames = data.raw_names || [];
            if (rawNames.length > 0) {
                rawNamesList.innerHTML = rawNames.map(name => 
                    `<span class="inline-block bg-indigo-100 text-indigo-700 text-xs px-3 py-1 rounded-full font-medium m-1">${name}</span>`
                ).join('');
            } else {
                rawNamesList.innerHTML = '<p class="text-gray-500 italic text-sm">No raw names linked yet. Use the Cleanup Page to map this company.</p>';
            }
            
            // --- Contacts ---
            const contacts = data.contacts || [];
            contactCountSpan.textContent = contacts.length;
            
            if (contacts.length > 0) {
                contactsTableBody.innerHTML = contacts.map(contact => {
                    const fullName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
                    
                    // Create the clickable link for the name
                    const nameCellContent = contact.linkedin_url ? 
                        `<a href="${contact.linkedin_url}" target="_blank" class="text-indigo-600 hover:text-indigo-800 font-medium hover:underline">
                            ${fullName}
                        </a>` : 
                        `<span class="text-gray-800">${fullName}</span>`;

                    return `
                        <tr class="hover:bg-gray-50">
                            <td class="px-6 py-3 whitespace-nowrap">${nameCellContent}</td>
                            <td class="px-6 py-3 whitespace-nowrap">${contact.job_title || 'N/A'}</td>
                            <td class="px-6 py-3 text-blue-600 whitespace-nowrap">${contact.email || 'N/A'}</td>
                        </tr>
                    `;
                }).join('');
            } else {
                contactsTableBody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-gray-500 italic">No contacts found for this company.</td></tr>';
            }
            
        } else {
            console.error('Error loading related data:', data.message);
        }

    } catch (error) {
        console.error('Fetch error for related data:', error);
    }
}


// --- Update Submission Function ---

/** Handles the form submission to update the company profile via PUT request. */
async function handleUpdate(event) {
    event.preventDefault();
    
    if (!currentCompanyId) {
        showStatus('Please select a company profile first before saving.', 'error');
        return;
    }
    
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    // 1. Collect all form data
    const updatedData = {
        company_name_clean: cleanNameInput.value.trim(),
        headquarters: headquartersInput.value.trim() || null,
        
        // Convert empty string/null to null for database
        size_employees: employeesInput.value ? parseInt(employeesInput.value, 10) : null,
        annual_revenue: revenueInput.value ? parseFloat(revenueInput.value) : null,
        
        revenue_scale: revenueScaleSelect.value || null,
        target_interest: targetInterestCheckbox.checked,
        notes: notesTextarea.value.trim() || null
    };

    if (!updatedData.company_name_clean) {
        showStatus('Company name is mandatory. Please provide a clean name.', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/${currentCompanyId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(updatedData),
        });

        const data = await response.json();

        if (response.ok) {
            // Update local state and list rendering after successful save
            const companyIndex = allCompanies.findIndex(c => c.company_id === currentCompanyId);
            if (companyIndex !== -1) {
                // Update properties, excluding raw_names and contacts
                allCompanies[companyIndex] = { 
                    ...allCompanies[companyIndex], 
                    company_name_clean: updatedData.company_name_clean,
                    target_interest: updatedData.target_interest 
                };
            }
            renderCompanyList(); // Re-render to update name or TARGET flag if they changed
            companyTitle.textContent = `${updatedData.company_name_clean} (ID: ${currentCompanyId})`;
            showStatus(data.message || 'Profile updated successfully!', 'success');
        } else {
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

// --- Event Listeners ---

// 1. Filter and Search listeners (debounced)
searchFilter.addEventListener('input', debouncedLoadCompanies);
targetFilter.addEventListener('change', debouncedLoadCompanies);

// 2. Company List click listener
companyListElement.addEventListener('click', (event) => {
    // Use closest() to find the clickable link element regardless of where the click landed inside it
    const link = event.target.closest('.company-name-link'); 
    if (link) {
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
    fetchAllCompanies();
});
