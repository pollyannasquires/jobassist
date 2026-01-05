// company_list.js
const API_BASE = '/api';

// State to manage sorting and filtering
let sortColumn = 'clean_name';
let sortDirection = 'ASC'; // ASC or DESC
let searchTimeout = null;

// Helper function for currency formatting
function formatCurrency(value, scale) {
    if (value === null || value === undefined) return 'N/A';
    
    // Simple localization-agnostic formatter
    const formattedValue = value.toLocaleString('en-US', { maximumFractionDigits: 1 });
    
    switch (scale) {
        case 'K': return `$${formattedValue}K`;
        case 'M': return `$${formattedValue}M`;
        case 'B': return `$${formattedValue}B`;
        default: return `$${formattedValue}`; // Use the raw value if scale is missing
    }
}

// Helper function to render the table (including sort arrows)
function renderTable(companies) {
    const listDiv = document.getElementById('companyList');
    
    if (companies.length === 0) {
        listDiv.className = 'loading-message';
        listDiv.innerHTML = 'No companies match the current filter/search criteria.';
        return;
    }

    // Start building the table structure
    let tableHtml = '<div class="table-container">';
    tableHtml += '<table><thead><tr>';

    // Define columns to show and their corresponding sort keys
    const columns = [
        { key: 'clean_name', label: 'Clean Name', class: 'text-left' },
        { key: 'target_interest', label: 'Target Interest', class: 'text-center' },
        { key: 'size_employees', label: 'Size (Employees)', class: 'text-right' },
        { key: 'annual_revenue', label: 'Annual Revenue', class: 'text-right' },
        { key: 'headquarters', label: 'Headquarters', class: 'text-left' }
    ];

    columns.forEach(col => {
        const isCurrentSort = col.key === sortColumn;
        const arrow = isCurrentSort 
            ? (sortDirection === 'ASC' ? ' ▲' : ' ▼') 
            : '';
        const headerClass = `sortable-header ${col.class}`;

        tableHtml += `<th class="${headerClass}" onclick="sortByColumn('${col.key}')">
                        ${col.label}${arrow}
                      </th>`;
    });

    tableHtml += '</tr></thead><tbody>';

    // Populate table rows
    companies.forEach(company => {
        const revenue = formatCurrency(company.annual_revenue, company.revenue_scale);
        const size = company.size_employees ? company.size_employees.toLocaleString() : 'N/A';
        const targetClass = company.target_interest ? 'target-yes' : 'target-no';
        const targetText = company.target_interest ? 'Yes' : 'No';

        tableHtml += '<tr>';
        tableHtml += `<td class="text-left font-semibold">${company.company_name_clean}</td>`;
        tableHtml += `<td class="text-center"><span class="${targetClass}">${targetText}</span></td>`;
        tableHtml += `<td class="text-right">${size}</td>`;
        tableHtml += `<td class="text-right">${revenue}</td>`;
        tableHtml += `<td class="text-left">${company.headquarters || 'N/A'}</td>`;
        tableHtml += '</tr>';
    });

    tableHtml += '</tbody></table></div>';
    listDiv.className = 'table-wrapper'; // Reset class for non-loading state
    listDiv.innerHTML = tableHtml;
}

// ----------------------------------------------------------------------
// CORE DATA FETCH FUNCTION
// ----------------------------------------------------------------------
async function loadCompanies() {
    const listDiv = document.getElementById('companyList');
    listDiv.className = 'loading-message';
    listDiv.innerHTML = 'Loading company data...';

    // Get filter values
    const targetFilter = document.getElementById('targetFilter').value;
    const searchFilter = document.getElementById('searchFilter').value;

    // Construct the API URL with filters and sorting parameters
    let url = `${API_BASE}/companies?`;
    url += `target_filter=${targetFilter}`;
    url += `&search_term=${encodeURIComponent(searchFilter)}`;
    url += `&sort_by=${sortColumn}`;
    url += `&sort_dir=${sortDirection}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (response.ok && data.companies) {
            renderTable(data.companies);
        } else {
            listDiv.innerHTML = `Error: ${data.message || 'Failed to fetch companies.'}`;
        }
    } catch (error) {
        listDiv.innerHTML = `Network Error: ${error.message}`;
    }
}

// ----------------------------------------------------------------------
// SORTING AND DEBOUNCE LOGIC
// ----------------------------------------------------------------------

/**
 * Updates the sort state and reloads the companies list.
 * @param {string} columnKey - The key of the column to sort by.
 */
window.sortByColumn = function(columnKey) {
    if (sortColumn === columnKey) {
        // Toggle direction if the same column is clicked
        sortDirection = sortDirection === 'ASC' ? 'DESC' : 'ASC';
    } else {
        // New column, reset to ASC
        sortColumn = columnKey;
        sortDirection = 'ASC';
    }
    loadCompanies();
}

/**
 * Debounces the loadCompanies call for input events.
 */
window.debouncedLoadCompanies = function() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadCompanies, 300); // 300ms delay for search input
}

// Initial load when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    loadCompanies();
});
