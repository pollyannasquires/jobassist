// FILENAME: navbar.js | Purpose: Inject consistent navigation bar across all pages and handle sidebar initialization

const navHtml = `
    <nav class="bg-white shadow-md sticky top-0 z-20">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between items-center h-16">
                <div class="flex-shrink-0">
                    <span class="text-2xl font-bold text-gray-800">Job<span class="text-primary">Assist</span></span>
                </div>
                <div class="flex space-x-4">
                    <a href="index.html" id="nav-index" class="nav-link text-gray-600 hover:text-primary px-3 py-2 rounded-md text-sm font-medium transition-colors">
                        Dashboard
                    </a>
                    <a href="cleanup.html" id="nav-cleanup" class="nav-link text-gray-600 hover:text-primary px-3 py-2 rounded-md text-sm font-medium transition-colors">
                        Cleanup Tool
                    </a>
                    <a href="management.html" id="nav-management" class="nav-link text-gray-600 hover:text-primary px-3 py-2 rounded-md text-sm font-medium transition-colors">
                        Management
                    </a>
                    <!-- FIX for Issue 2.2: Add application_review back into the Navbar -->
                     <a href="application_review.html" id="nav-application_review" class="nav-link text-gray-600 hover:text-primary px-3 py-2 rounded-md text-sm font-medium transition-colors">
                        Application Review
                    </a>
                </div>
            </div>
        </div>
    </nav>
`;

/**
 * Injects the Navbar HTML and sets the active link based on the current page.
 */
function injectNavbar() {
    const body = document.body;
    
    // 1. Inject the navigation HTML
    body.insertAdjacentHTML('afterbegin', navHtml);
    
    // 2. Identify the current page and set the active state
    const currentPath = window.location.pathname;
    
    let activeId;
    if (currentPath.includes('cleanup.html')) {
        activeId = 'nav-cleanup';
    } else if (currentPath.includes('management.html')) {
        activeId = 'nav-management';
    } else if (currentPath.includes('application_review.html')) {
        activeId = 'nav-application_review'; // Set active for Application Review page
    } else {
        // Default to index.html (Dashboard)
        activeId = 'nav-index';
    }
    
    const activeLink = document.getElementById(activeId);
    if (activeLink) {
        // Remove default styles and apply active styles
        activeLink.classList.remove('text-gray-600', 'hover:text-primary');
        activeLink.classList.add('bg-primary', 'text-white');
    }

    // 3. Update the height of the main content area for proper layout below the fixed navbar
    const mainElement = document.querySelector('main');
    if (mainElement) {
        // Set proper padding at the top of main content to account for the fixed navbar
        mainElement.style.paddingTop = '5rem';
    }

    // After injection, create lucide icons if the library is loaded
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
// This resolves the "Cannot set properties of null" error in navbar.js (Issue 2).
