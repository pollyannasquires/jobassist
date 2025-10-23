// app.js
const API_BASE = '/api'; // Nginx will proxy this to Gunicorn/Flask

let currentRawName = null;

// Helper to show status messages
function displayMessage(type, message) {
    const display = document.getElementById('messageDisplay');
    display.textContent = message;
    display.className = `message ${type}`;
    display.style.display = 'block';
}
// ----------------------------------------------------------------------
// 1. POPULATE DROPDOWN LIST OF UNMAPPED NAMES
// ----------------------------------------------------------------------
async function populateDropdown() {
    displayMessage('message', 'Loading list of unmapped companies...');
    const selectElement = document.getElementById('rawNameSelect');
    selectElement.innerHTML = '<option value="" disabled selected>Loading...</option>';

    try {
        const response = await fetch(`${API_BASE}/unmapped_list`);
        const data = await response.json();

        if (data.raw_names && data.raw_names.length > 0) {
            selectElement.innerHTML = '<option value="" disabled selected>--- Select Company to Process ---</option>';
            data.raw_names.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                selectElement.appendChild(option);
            });
            displayMessage('success', `${data.raw_names.length} companies ready for mapping.`);
        } else {
            selectElement.innerHTML = '<option value="" disabled selected>All companies have been mapped!</option>';
            displayMessage('success', data.message || "All unique companies have been mapped!");
        }
    } catch (error) {
        displayMessage('error', 'Error loading company list: ' + error.message);
    }
}

// ----------------------------------------------------------------------
// 2. LOAD SELECTED COMPANY
// ----------------------------------------------------------------------
function loadSelectedCompany() {
    const selectElement = document.getElementById('rawNameSelect');
    const selectedName = selectElement.value;

    if (selectedName) {
        currentRawName = selectedName;
        document.getElementById('rawNameDisplay').textContent = currentRawName;
        document.getElementById('companyNameClean').value = currentRawName;
        displayMessage('success', `Processing: ${currentRawName}`);
        
        // Clear previous state and search for existing matches
        document.getElementById('selectedCompanyId').textContent = 'NONE';
        document.getElementById('mapExistingBtn').disabled = true;
        searchCompanies(currentRawName);
    }
}
// ----------------------------------------------------------------------
// 2. SEARCH COMPANIES
// ----------------------------------------------------------------------
async function searchCompanies(query = document.getElementById('searchName').value) {
    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = 'Searching...';

    if (!query) {
        resultsDiv.innerHTML = '';
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/search_companies?q=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (data.companies) {
            resultsDiv.innerHTML = '';
            data.companies.forEach(company => {
                const card = document.createElement('div');
                card.className = 'existing-company-card';
                card.innerHTML = `
                    <strong>ID ${company.company_id}: ${company.company_name_clean}</strong><br>
                    <small>HQ: ${company.headquarters || 'N/A'}</small>
                `;
                card.onclick = () => selectExistingCompany(company.company_id, card);
                resultsDiv.appendChild(card);
            });
            if (data.companies.length === 0) {
                resultsDiv.innerHTML = '<p>No existing profiles found.</p>';
            }
        }
    } catch (error) {
        resultsDiv.innerHTML = `<p class="error">Search error: ${error.message}</p>`;
    }
}

// Handler for selecting an existing company
function selectExistingCompany(id, element) {
    document.querySelectorAll('.existing-company-card').forEach(card => card.classList.remove('selected'));
    element.classList.add('selected');
    document.getElementById('selectedCompanyId').textContent = id;
    document.getElementById('mapExistingBtn').disabled = false;
}

// ----------------------------------------------------------------------
// 3. CREATE NEW COMPANY PROFILE & MAP
// ----------------------------------------------------------------------
async function createNewCompany() {
    if (!currentRawName) {
        displayMessage('error', 'Please load a raw company name first.');
        return;
    }

    const payload = {
        raw_name: currentRawName,
        company_id: null, // Indicates a new company needs to be created
        company_name_clean: document.getElementById('companyNameClean').value,
        target_interest: document.getElementById('targetInterest').value === 'true',
        size_employees: parseInt(document.getElementById('sizeEmployees').value) || null,
        annual_revenue: parseFloat(document.getElementById('annualRevenue').value) || null,
	revenue_scale: document.getElementById('revenueScale').value, // <<< NEW FIELD
        headquarters: document.getElementById('headquarters').value,
        notes: document.getElementById('notes').value
    };

    await sendMappingRequest(payload);
}

// ----------------------------------------------------------------------
// 4. MAP TO EXISTING COMPANY
// ----------------------------------------------------------------------
async function mapExisting() {
    const companyId = document.getElementById('selectedCompanyId').textContent;
    if (!currentRawName || companyId === 'NONE') {
        displayMessage('error', 'Please load a raw company name and select an existing profile.');
        return;
    }

    const payload = {
        raw_name: currentRawName,
        company_id: parseInt(companyId)
    };

    await sendMappingRequest(payload);
}

// ----------------------------------------------------------------------
// 5. GENERIC MAPPING REQUEST SENDER
// ----------------------------------------------------------------------
async function sendMappingRequest(payload) {
    displayMessage('message', 'Submitting mapping...');

    try {
        const response = await fetch(`${API_BASE}/map_company`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        if (response.ok) {
            displayMessage('success', result.message);
            // After successful map, load the next raw company name
           populateDropdown(); 
            // Clear the currently displayed raw name
            document.getElementById('rawNameDisplay').textContent = ''; 
        } else {
            displayMessage('error', result.message || 'Mapping failed.');
        }
    } catch (error) {
        displayMessage('error', 'Network error during mapping: ' + error.message);
    }
}

// Start the process when the page loads
document.addEventListener('DOMContentLoaded', populateDropdown);
