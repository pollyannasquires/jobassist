// FILENAME: company_sidebar.js | Reusable logic for fetching and rendering the Company Profiles sidebar

// --- API Endpoints ---
const API_COMPANIES = '/api/companies';

// --- DOM Elements ---
const sidebarListElement = document.getElementById('companyList');
const sidebarSearchFilter = document.getElementById('sidebarSearchFilter');
const sidebarTargetFilter = document.getElementById('sidebarTargetFilter');

// --- Global State ---
let allCompanies = []; // Full, un-filtered list of companies
let currentActiveCompanyId = null; // NEW: Track the currently active ID internally

// --- Utility Functions ---

/**
 * Utility to debounce function calls.
 */
function debounce(func, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

/**
 * Renders the filtered list of companies into the sidebar.
 * @param {Array} companies - The list of companies to render.
 * @param {number} activeCompanyId - The ID of the currently selected company, if any.
 */
function renderCompanyList(companies, activeCompanyId = null) {
    if (!sidebarListElement) return;

    if (!companies || companies.length === 0) {
        sidebarListElement.innerHTML = `<li class="p-4 text-sm text-gray-500 italic">No companies found matching criteria.</li>`;
        return;
    }

    const html = companies.map(company => {
        // FIX: Ensure the correct class is applied based on the ID passed
        const isActive = company.company_id === activeCompanyId ? 'active' : ''; 
        const targetClass = company.target_interest ? 'text-primary' : 'text-gray-500';
        
        return `
            <li class="p-0">
                <a href="#" class="company-name-link block p-4 flex items-center justify-between text-gray-700 hover:bg-indigo-50 ${isActive}" 
                   data-id="${company.company_id}" 
                   data-name="${company.company_name_clean}">
                    <div class="flex items-center">
                        <div class="w-8 h-8 flex items-center justify-center rounded-full bg-indigo-100 text-primary text-xs font-bold mr-3">
                            ${company.company_name_clean.charAt(0).toUpperCase()}
                        </div>
                        <span class="text-sm font-medium truncate">${company.company_name_clean}</span>
                    </div>
                    ${company.target_interest ? `<i data-lucide="zap" class="w-4 h-4 ${targetClass} ml-2"></i>` : ''}
                </a>
            </li>
        `;
    }).join('');

    sidebarListElement.innerHTML = html;

    // Call lucide.createIcons() after updating innerHTML in case of success or failure
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

/**
 * Applies the current filters and re-renders the list.
 */
function filterAndRenderCompanies() {
    if (!sidebarSearchFilter || !sidebarTargetFilter) return;

    const searchTerm = sidebarSearchFilter.value.toLowerCase();
    const targetFilterValue = sidebarTargetFilter.value;

    let filteredCompanies = allCompanies.filter(company => {
        // 1. Search Filter
        const nameMatches = company.company_name_clean.toLowerCase().includes(searchTerm);
        
        // 2. Target Filter
        let targetMatches = true;
        if (targetFilterValue === 'target') {
            targetMatches = company.target_interest;
        } else if (targetFilterValue === 'non-target') {
            targetMatches = !company.target_interest;
        }

        return nameMatches && targetMatches;
    });

    // FIX: Pass the internal active ID state to ensure the highlight is maintained.
    renderCompanyList(filteredCompanies, currentActiveCompanyId);
}

const debouncedFilterAndRender = debounce(filterAndRenderCompanies, 300);

/**
 * Fetches the initial company data from the API and renders the list.
 */
async function fetchCompanies() {
    if (!sidebarListElement) return;

    sidebarListElement.innerHTML = `<li class="p-4 text-sm text-center text-gray-500">Loading companies...</li>`;

    try {
        const response = await fetch(API_COMPANIES);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        // Handle API response format (assuming it's an array of companies directly)
        if (Array.isArray(data)) {
             allCompanies = data;
        } else if (data && Array.isArray(data.companies)) {
             allCompanies = data.companies; // Fallback for nested array if API changes
        } else {
             allCompanies = [];
        }
        
        // Use the internally tracked ID for initial render
        filterAndRenderCompanies();
    } catch (error) {
        console.error('Error fetching companies:', error);
        sidebarListElement.innerHTML = `<li class="p-4 text-sm text-error italic">Failed to load companies: ${error.message}</li>`;
    }
}

// --- Exposed Functions for Host Page (application_review.js) ---

/**
 * Exposes a method for the host page to set the active company ID
 * and trigger a re-render to ensure the visual state is correct.
 * This is used when a company is clicked OR when the page loads from a URL param.
 * @param {number|null} companyId - The ID of the company to highlight.
 */
window.setActiveCompanyIdAndRerender = (companyId) => {
    // 1. Update internal state
    currentActiveCompanyId = companyId;
    
    // 2. Re-render the list using the current filters and the new active ID
    filterAndRenderCompanies();
};

// --- Initialization and Event Listeners ---

document.addEventListener('DOMContentLoaded', () => {
    // Check for required elements before proceeding
    if (!sidebarListElement || !sidebarSearchFilter || !sidebarTargetFilter) {
        console.error("Required sidebar DOM elements not found. Initialization aborted.");
        return; 
    }

    // 1. Initial Data Load
    fetchCompanies();
    
    // 2. Event Listeners for Filters
    sidebarSearchFilter.addEventListener('input', () => debouncedFilterAndRender());
    sidebarTargetFilter.addEventListener('change', () => filterAndRenderCompanies());
    
    // 3. Click Listener on the List
    sidebarListElement.addEventListener('click', (event) => {
        const link = event.target.closest('.company-name-link');
        if (link) {
            event.preventDefault();
            const companyId = parseInt(link.getAttribute('data-id'), 10);
            const companyName = link.getAttribute('data-name');
            
            // Call the exposed setter function to manage the highlight internally
            window.setActiveCompanyIdAndRerender(companyId);

            // Check if the host page has defined the callback function
            if (typeof window.onCompanySelect === 'function') {
                // application_review.js handles loading the main content
                window.onCompanySelect(companyId, companyName); 
            }
        }
    });
});
