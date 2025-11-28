// FILENAME: dashboard_sidebar.js | Purpose: Renders the reusable navigation sidebar.

// CRITICAL FIX: Export the function so it can be imported as a module in index.html
export function renderSidebar() {
    // --- CONFIGURATION: Update your links here ---\n
    const menuItems = [
        // Ensure index.html is correctly pointed to for the Companies link
        { name: 'Applications',  path: 'application_dashboard.html',  icon: 'app-window' },
        { name: 'Companies',     path: 'company_dashboard.html',      icon: 'building-2' }, 
        { name: 'Contacts',      path: 'contact_dashboard.html',      icon: 'users' },
        { name: 'Files',         path: 'file_dashboard.html',                  icon: 'wrench' }
    ];

    const container = document.getElementById('sidebar-container');
    if (!container) return;

    // Get the current file name to determine the active link
    const currentPath = window.location.pathname.split('/').pop();
    
    // Determine primary color variables for dynamic styling (using the hex value defined in tailwind.config)
    const primaryColor = 'rgb(79, 70, 229)'; // indigo-600

    // 1. Build the Container Structure
    let html = `
        <!-- The aside tag is now just a child, the w-64 height/width are controlled by the parent div in index.html -->
        <aside class="w-full h-full flex flex-col justify-between">
            <div>
                <!-- Header/Logo Area -->
                <div class="h-16 flex items-center px-6 border-b border-gray-200">
                    <div class="flex items-center gap-2 text-gray-800 font-bold text-lg">
                        <i data-lucide="grid" class="w-6 h-6 text-primary"></i>
                        <span>Menu</span>
                    </div>
                </div>

                <!-- Navigation Links -->
                <nav class="p-4 space-y-2">
    `;

    // 2. Add Links
    menuItems.forEach(item => {
        // Active state logic: true if currentPath matches item.path, or if currentPath is empty and item.path is 'index.html'
        // This handles cases where index.html is loaded as 'index.html' or as the root '/'
        const isActive = currentPath === item.path || (currentPath === '' && item.path === 'index.html');
        
        const baseClasses = "flex items-center px-3 py-2 text-sm font-medium rounded-lg transition duration-150 group";
        const activeClasses = "bg-primary text-white shadow-md";
        // Use text-primary for hover when inactive, matching the global primary color
        const inactiveClasses = "text-gray-700 hover:bg-gray-100 hover:text-primary";
        
        const finalClass = isActive ? `${baseClasses} ${activeClasses}` : `${baseClasses} ${inactiveClasses}`;
        // Adjust icon color based on active state
        const iconColor = isActive ? "text-white" : "text-gray-500 group-hover:text-primary";

        html += `
            <a href="${item.path}" class="${finalClass}">
                <i data-lucide="${item.icon}" class="w-5 h-5 mr-3 ${iconColor}"></i>
                ${item.name}
            </a>
        `;
    });

    // 3. Close the structure
    html += `
            </nav>
        </div>
        
        <!-- Footer/Sign Out Button -->
        <div class="p-4 border-t border-gray-200">
            <button class="flex items-center w-full px-3 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100 transition duration-150">
                <i data-lucide="log-out" class="w-5 h-5 mr-3 text-gray-500"></i>
                Sign Out
            </button>
        </div>
    </aside>
    `;

    container.innerHTML = html;

    // 4. Re-initialize icons for the newly added HTML
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}