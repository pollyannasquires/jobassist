// FILENAME: company_sidebar.js | Reusable logic for fetching and rendering the Company Profiles sidebar.

// Imports the fetch guard utility
import { fetchWithGuard } from './core-utils.js'; 

// --- CONFIGURATION ---
// Configuration object allows easy modification of API endpoint, 
// default navigation target, and styling classes.
const CONFIG = {
    // UPDATED: Using API 14.0 /api/sidebar
    API_URL: '/api/sidebar', 
    // Default page to navigate to when a company is selected (used for URL construction)
    TARGET_PAGE: 'application_review.html', 
    styles: {
        // Tailwind classes for the active selected company
        activeBg: 'bg-indigo-600', 
        activeText: 'text-white',
        // Tailwind classes for target companies (is_target=true)
        targetText: 'text-white font-bold', 
        // Tailwind classes for non-target companies
        nonTargetText: 'text-gray-300', 
        loadingText: 'Loading...',
        errorText: 'Failed to load companies.'
    }
};

// --- DOM Elements ---
let sidebarListElement = null;
let sidebarSearchFilter = null;
let sidebarTargetFilter = null;

// --- Global State ---
let allCompanies = [];
let currentActiveCompanyId = null;
let currentTargetPage = CONFIG.TARGET_PAGE;


// ---------------------------------------------------------------------
// --- UTILITY FUNCTIONS -----------------------------------------------
// ---------------------------------------------------------------------

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
 * Renders the filtered list of companies into the sidebar list element.
 * @param {Array} companies - The list of companies to render.
 */
function renderCompanyList(companies) {
    if (!sidebarListElement) return;

    const { styles } = CONFIG;

    if (!companies || companies.length === 0) {
        const searchVal = sidebarSearchFilter ? sidebarSearchFilter.value.toLowerCase() : '';
        const targetVal = sidebarTargetFilter ? sidebarTargetFilter.value : 'ALL';
        
        if (allCompanies.length > 0 && (searchVal || targetVal !== 'ALL')) {
            sidebarListElement.innerHTML = '<div class="px-4 py-2 text-sm text-gray-400">No companies found matching criteria.</div>';
        } else {
             sidebarListElement.innerHTML = '<div class="px-4 py-2 text-sm text-gray-400">No companies found in the system.</div>';
        }
        return;
    }

    const html = companies.map(company => {
        const isActive = company.company_id == currentActiveCompanyId; // Use == for mixed types (ID can be string/number)
        const isTarget = company.is_target === true;

        const targetClass = isTarget ? styles.targetText : styles.nonTargetText;
        // Use a background and text class for the active item
        const activeClasses = isActive ? `${styles.activeBg} ${styles.activeText}` : 'hover:bg-gray-700';
        
        // UPDATED: Using company.company_name_clean for display and data-name
        return `
            <a href="#" class="company-name-link ${activeClasses} ${targetClass} 
               truncate px-4 py-2 flex items-center transition duration-150 rounded-lg mx-2" 
               data-id="${company.company_id}" 
               data-name="${company.company_name_clean}"
               title="${company.company_name_clean}">
                <span data-lucide="${isTarget ? 'star' : 'briefcase'}" class="w-4 h-4 mr-2 flex-shrink-0"></span>
                <span class="truncate">${company.company_name_clean}</span>
            </a>
        `;
    }).join('');

    sidebarListElement.innerHTML = html;
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

/**
 * Filters the main company list based on current filter state and re-renders.
 */
function filterAndRenderCompanies() {
    const searchTerm = sidebarSearchFilter ? sidebarSearchFilter.value.toLowerCase() : '';
    const targetFilter = sidebarTargetFilter ? sidebarTargetFilter.value : 'ALL'; 

    let filteredCompanies = allCompanies.filter(company => {
        // CRITICAL: Filter against company_name_clean
        if (!company || typeof company.company_name_clean !== 'string') {
            return false;
        }
        
        const matchesSearch = company.company_name_clean.toLowerCase().includes(searchTerm);
        
        let matchesTarget = true;
        if (targetFilter === 'TARGET') {
            matchesTarget = company.is_target === true;
        } else if (targetFilter === 'NON_TARGET') {
            matchesTarget = company.is_target === false;
        }

        return matchesSearch && matchesTarget;
    });

    // Sort alphabetically by company_name_clean
    filteredCompanies.sort((a, b) => a.company_name_clean.localeCompare(b.company_name_clean));

    renderCompanyList(filteredCompanies);
}

const debouncedFilterAndRender = debounce(filterAndRenderCompanies, 300);

/**
 * Fetches all company profiles from the API and initializes the display.
 */
async function fetchCompanies() {
    if (sidebarListElement) {
        sidebarListElement.innerHTML = `<div class="px-4 py-2 text-sm text-indigo-400 flex items-center"><span class="animate-spin w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full mr-2"></span> ${CONFIG.styles.loadingText}</div>`;
    }

    try {
        const data = await fetchWithGuard(CONFIG.API_URL, 'GET', 'fetch sidebar company list'); 

        allCompanies = Array.isArray(data.companies) ? data.companies : [];
        
        filterAndRenderCompanies();

    } catch (error) {
        console.error("Failed to fetch companies:", error);
        if (sidebarListElement) {
            sidebarListElement.innerHTML = `<div class="px-4 py-2 text-sm text-error">${CONFIG.styles.errorText}</div>`;
        }
    }
}


/**
 * Handles the click event on a company link, constructing the correct URL.
 */
function handleCompanyLinkClick(event) {
    const link = event.target.closest('.company-name-link');
    if (link) {
        event.preventDefault(); 
        
        const companyId = link.getAttribute('data-id');
        const companyName = link.getAttribute('data-name');
        
        // Navigate to the target page, maintaining compatibility via URL params
        const newUrl = `${currentTargetPage}?companyId=${companyId}&companyName=${encodeURIComponent(companyName)}`;
        window.location.href = newUrl;
    }
}

// ---------------------------------------------------------------------
// --- PUBLIC API (Initialization) -------------------------------------
// ---------------------------------------------------------------------

/**
 * Initializes the Company Sidebar component.
 * @param {object} options - Configuration options.
 * @param {string} [options.activeCompanyId] - The ID of the currently selected company (read from URL).
 * @param {string} [options.targetPage] - The page to navigate to when a link is clicked (e.g., 'application_review.html').
 */
export function initSidebar(options = {}) {
    // 1. Set global state from options
    currentActiveCompanyId = options.activeCompanyId || null;
    currentTargetPage = options.targetPage || CONFIG.TARGET_PAGE;

    // 2. Perform DOM lookups
    sidebarListElement = document.getElementById('companyList');
    sidebarSearchFilter = document.getElementById('sidebarSearchFilter');
    sidebarTargetFilter = document.getElementById('sidebarTargetFilter');

    // CRITICAL GUARD: Ensure required elements exist
    if (!sidebarListElement || !sidebarSearchFilter || !sidebarTargetFilter) {
        console.error("Sidebar initialization failed: Missing required DOM elements (companyList, sidebarSearchFilter, or sidebarTargetFilter).");
        return;
    }
    
    // 3. Attach Event Listeners
    sidebarListElement.addEventListener('click', handleCompanyLinkClick);
    sidebarSearchFilter.addEventListener('input', debouncedFilterAndRender);
    sidebarTargetFilter.addEventListener('change', filterAndRenderCompanies);
    
    // 4. Fetch and render initial data
    fetchCompanies();
}