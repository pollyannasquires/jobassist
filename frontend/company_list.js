// /home/jobert/webapp/contact_app/frontend/company_list.js
const API_BASE = '/api';
let companiesData = []; // Cache the full list (or the unfiltered list)

// Timer ID for the debounced function
let debounceTimer;

/**
 * Standard debounce function implementation.
 * Delays execution of a function until after a specified delay.
 * @param {Function} func - The function to debounce.
 * @param {number} delay - The delay in milliseconds.
 */
function debounce(func, delay = 300) {
    return function() {
        const context = this;
        const args = arguments;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => func.apply(context, args), delay);
    };
}

/**
 * Generates a CSV string from the array of company objects.
 * @param {Array} companies - The filtered list of company objects.
 * @returns {string} - The CSV string.
 */
function generateCSV(companies) {
    if (companies.length === 0) return '';
    
    // Define headers (must match the property names used below)
    const headers = ["Company Name", "Target Interest", "ID", "Headquarters", "Annual Revenue"];
    
    // Create CSV rows
    const csvRows = companies.map(company => {
        const isTarget = company.target_interest === true || company.target_interest === 'true';
        const targetString = isTarget ? 'Yes' : 'No';

        return [
            `"${(company.company_name_clean || '').replace(/"/g, '""')}"`, // Quote and escape company name
            targetString,
            company.company_id || 'N/A',
            `"${(company.headquarters || '').replace(/"/g, '""')}"`,
            company.annual_revenue_formatted || 'N/A'
        ].join(',');
    });

    return [headers.join(','), ...csvRows].join('\n');
}

/**
 * Renders the list of companies as a searchable, copy/paste-friendly table.
 * @param {Array} companies - The filtered list of company objects to display.
 */
function renderCompanies(companies) {
    const listContainer = document.getElementById('companyList');
    listContainer.innerHTML = '';
    
    if (companies.length === 0) {
        listContainer.className = 'loading-message';
        listContainer.innerHTML = 'No companies found matching your filters.';
        return;
    }
    
    // Add a button to copy data as CSV
    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy Table Data to Clipboard (CSV)';
    copyButton.style.cssText = 'padding: 10px 15px; margin-bottom: 15px; background-color: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer;';
    copyButton.onclick = () => {
        const csvData = generateCSV(companies);
        try {
            // Use execCommand('copy') for better compatibility in sandboxed environments
            const tempTextArea = document.createElement('textarea');
            tempTextArea.value = csvData;
            document.body.appendChild(tempTextArea);
            tempTextArea.select();
            document.execCommand('copy');
            document.body.removeChild(tempTextArea);
            copyButton.textContent = 'Copied!';
            setTimeout(() => copyButton.textContent = 'Copy Table Data to Clipboard (CSV)', 2000);
        } catch (err) {
            console.error('Could not copy text: ', err);
            // This is safer than alert()
            const messageDiv = document.createElement('div');
            messageDiv.textContent = 'Failed to copy. Please try manually selecting and copying the table.';
            messageDiv.style.cssText = 'color: red; margin-top: 10px;';
            listContainer.insertBefore(messageDiv, listContainer.firstChild);
            setTimeout(() => messageDiv.remove(), 3000);
        }
    };
    listContainer.appendChild(copyButton);


    listContainer.className = 'table-container'; // New class for table styling
    
    const table = document.createElement('table');
    table.style.cssText = 'width: 100%; border-collapse: collapse; background-color: white;';
    table.innerHTML = `
        <thead>
            <tr style="background-color: #e0f2fe;">
                <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe;">Company Name</th>
                <th style="padding: 12px; text-align: center; border: 1px solid #bfdbfe;">Target?</th>
                <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe;">ID</th>
                <th style="padding: 12px; text-align: left; border: 1px solid #bfdbfe;">Headquarters</th>
                <th style="padding: 12px; text-align: right; border: 1px solid #bfdbfe;">Annual Revenue</th>
            </tr>
        </thead>
        <tbody id="companyTableBody"></tbody>
    `;
    listContainer.appendChild(table);

    const tbody = document.getElementById('companyTableBody');

    companies.forEach(company => {
        const isTarget = company.target_interest === true || company.target_interest === 'true';
        const targetText = isTarget 
            ? `<span style="color: #065f46; font-weight: bold;">Yes</span>` 
            : `<span style="color: #991b1b;">No</span>`;
        const row = tbody.insertRow();
        row.style.cssText = 'border-bottom: 1px solid #f3f4f6; transition: background-color 0.1s;';
        row.onmouseover = () => row.style.backgroundColor = '#f9fafb';
        row.onmouseout = () => row.style.backgroundColor = 'white';
        
        row.innerHTML = `
            <td style="padding: 12px; border: 1px solid #e5e7eb;">${company.company_name_clean || 'N/A'}</td>
            <td style="padding: 12px; text-align: center; border: 1px solid #e5e7eb;">${targetText}</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb; font-family: monospace;">${company.company_id || 'N/A'}</td>
            <td style="padding: 12px; border: 1px solid #e5e7eb;">${company.headquarters || 'Unspecified'}</td>
            <td style="padding: 12px; text-align: right; border: 1px solid #e5e7eb;">${company.annual_revenue_formatted || 'N/A'}</td>
        `;
    });
}

/**
 * Fetches company data from the backend based on filters.
 */
async function loadCompanies() {
    const targetFilter = document.getElementById('targetFilter').value;
    const searchFilter = document.getElementById('searchFilter').value.toLowerCase().trim();
    const listContainer = document.getElementById('companyList');
    
    listContainer.innerHTML = 'Fetching filtered data...';
    listContainer.className = 'loading-message';

    // Construct query parameters
    let params = [];
    
    // Only add target_interest to params if it's NOT 'all'
    if (targetFilter !== 'all') {
        // Ensure the parameter is correctly formatted as 'true' or 'false' string
        params.push(`target_interest=${targetFilter}`); 
    }
    
    if (searchFilter) {
        params.push(`search=${encodeURIComponent(searchFilter)}`);
    }

    const queryString = params.length > 0 ? '?' + params.join('&') : '';
    
    try {
        const response = await fetch(`${API_BASE}/companies${queryString}`);
        
        if (!response.ok) {
            throw new Error('Failed to fetch companies.');
        }

        const data = await response.json();
        
        if (data.companies) {
            renderCompanies(data.companies);
        } else {
            renderCompanies([]); // Show empty list message
        }

    } catch (error) {
        listContainer.innerHTML = `Error loading companies: ${error.message}`;
        console.error("Error fetching companies:", error);
    }
}

// Create the debounced version of loadCompanies for the filter controls
const debouncedLoadCompanies = debounce(loadCompanies, 300);

// Initial load when the page is ready. Use the debounced function for a cleaner start.
document.addEventListener('DOMContentLoaded', debouncedLoadCompanies);
