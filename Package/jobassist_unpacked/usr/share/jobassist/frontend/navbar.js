// FILENAME: navbar.js | Purpose: Inject consistent navigation bar across all pages and handle sidebar initialization

// Use the primary color defined in tailwind.config (Indigo-600)
const navHtml = (userId) => {
    // Safely determine the display ID. If userId is not a string (e.g., undefined), default to 'N/A'.
    // Display only the first 8 characters of the user ID for brevity.
    const displayUserId = (typeof userId === 'string' && userId.length > 8) 
        ? userId.substring(0, 8) 
        : 'N/A';
        
    return `
    <!-- CRITICAL FIX: Changed 'sticky' to 'fixed' and added 'w-full' for reliable top-of-page positioning -->
    <nav class="bg-white shadow-md fixed top-0 w-full z-20">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between items-center h-16">
                <div class="flex-shrink-0">
                    <span class="text-2xl font-bold text-gray-800">Job<span class="text-primary">Assist</span></span>
                </div>
                <div class="flex space-x-4">
                    <a href="index.html" id="nav-index" class="nav-link text-gray-600 hover:text-primary px-3 py-2 rounded-md text-sm font-medium transition-colors">
                        <i data-lucide="layout-dashboard" class="w-5 h-5 inline mr-1"></i>
                        Dashboard
                    </a>
                    <a href="cleanup.html" id="nav-cleanup" class="nav-link text-gray-600 hover:text-primary px-3 py-2 rounded-md text-sm font-medium transition-colors">
                        <i data-lucide="trash-2" class="w-5 h-5 inline mr-1"></i>
                        Cleanup Tool
                    </a>
                    <a href="management.html" id="nav-management" class="nav-link text-gray-600 hover:text-primary px-3 py-2 rounded-md text-sm font-medium transition-colors">
                        <i data-lucide="settings" class="w-5 h-5 inline mr-1"></i>
                        Management
                    </a>
                    <a href="application_review.html" id="nav-application_review" class="nav-link text-gray-600 hover:text-primary px-3 py-2 rounded-md text-sm font-medium transition-colors">
                        <i data-lucide="archive" class="w-5 h-5 inline mr-1"></i>
                        Review
                    </a>
                </div>
                <div class="flex items-center space-x-2">
                    <!-- User ID Display -->
                    <span class="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full font-mono select-all" title="User ID for Firebase Authentication">
                        ID: ${displayUserId}
                    </span>
                    <i data-lucide="user-circle" class="w-6 h-6 text-gray-400"></i>
                </div>
            </div>
        </div>
    </nav>
    `;
};

/**
 * Injects the navigation bar into the page body and sets the active link style.
 */
export function injectNavbar() {
    // NOTE: userId is provided via core-utils.js in the host HTML page
    const userId = window.__userId || 'N/A'; // Assume global availability of __userId after core-utils.js loads

    // 1. Inject the HTML into the body immediately
    document.body.insertAdjacentHTML('afterbegin', navHtml(userId));

    // 2. Determine and apply active class to the current page link
    const path = window.location.pathname;
    let activeId;
    
    if (path.includes('index.html') || path === '/') {
        activeId = 'nav-index';
    } else if (path.includes('cleanup.html')) {
        activeId = 'nav-cleanup';
    } else if (path.includes('management.html')) {
        activeId = 'nav-management';
    } else if (path.includes('application_review.html')) {
        activeId = 'nav-application_review'; 
    }  else if (path === 'application_review.html' || path === 'application_create.html') {
        activeId = 'nav-application_review'; 
    } else {
        // Default to index.html (Dashboard)
        activeId = 'nav-index';
    }
    
    const activeLink = document.getElementById(activeId);
    if (activeLink) {
        // Apply active styles using 'primary' for consistency
        activeLink.classList.remove('text-gray-600', 'hover:text-primary');
        activeLink.classList.add('bg-primary', 'text-white');
    }

    // 3. Update the height of the main content area for proper layout below the fixed navbar
    const mainElement = document.querySelector('main');
    if (mainElement) {
        // CRITICAL FIX: Set padding-top to 64px (h-16 navbar height) and use 'overflow: hidden' 
        // to prevent the margin of the first child of <main> from collapsing and creating a gap.
        mainElement.style.paddingTop = '64px';
        mainElement.style.overflow = 'hidden';
    }

    // 4. After injection, create lucide icons
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}


// --- Initialization ---

// Inject the navbar immediately after the script loads, fixing Issue 2.1
document.addEventListener('DOMContentLoaded', injectNavbar);

// Expose injectNavbar for pages that load it dynamically
window.injectNavbar = injectNavbar;

// NOTE: All company/sidebar fetching logic is now correctly located in company_sidebar.js.
// This resolves the "Cannot set properties of null" error encountered previously.
