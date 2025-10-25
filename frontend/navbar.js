// FILENAME: navbar.js | Purpose: Inject consistent navigation bar across all pages

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
                </div>
            </div>
        </div>
    </nav>
`;

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

    // 3. Update the height of the main content area
    const mainElement = document.querySelector('main');
    if (mainElement) {
        // The navbar is h-16 (4rem), so main content should fill the rest of the viewport
        mainElement.style.height = 'calc(100vh - 4rem)';
    }
}

// Execute the function when the script loads
injectNavbar();