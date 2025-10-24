// management.js
const API_BASE = '/api';
let currentCompanyId = null;

function displayMessage(type, message) {
    const display = document.getElementById('messageDisplay');
    display.textContent = message;
    display.className = `message ${type}`;
    display.style.display = 'block';
}

// ----------------------------------------------------------------------
// 1. LOAD LIST OF ALL CLEAN COMPANIES
// ----------------------------------------------------------------------
async function loadCompanyList() {
    const listDiv = document.getElementById('companyList');
    listDiv.innerHTML = 'Fetching list...';

    try {
        // Fetch all companies (without specific filters for management list)
        const response = await fetch(`${API_BASE}/companies`);
        const data = await response.json();

        if (data.companies && data.companies.length > 0) {
            listDiv.innerHTML = '';
            data.companies.forEach(company => {
                const item = document.createElement('div');
                item.className = 'company-item';
                item.textContent = `${company.company_name_clean} (${company.company_id})`;
                item.dataset.id = company.company_id;
                item.onclick = () => {
                    selectCompany(company.company_id, item);
                };
                listDiv.appendChild(item);
            });
        } else {
            listDiv.innerHTML = 'No clean companies found.';
        }
    } catch (error) {
        listDiv.innerHTML = `Error loading list: ${error.message}`;
    }
}

// ----------------------------------------------------------------------
// 2. SELECT COMPANY AND LOAD PROFILE
// ----------------------------------------------------------------------
async function selectCompany(companyId, element) {
    // 1. Highlight the selected item in the list
    document.querySelectorAll('.company-item').forEach(item => {
        item.classList.remove('selected');
    });
    element.classList.add('selected');

    currentCompanyId = companyId;
    document.getElementById('companyDetailForm').style.display = 'none';
    document.getElementById('relatedHeader').textContent = 'Loading...';
    
    displayMessage('message', 'Loading company details...');

    try {
        // Fetch Company Profile
        const profileResponse = await fetch(`${API_BASE}/companies/${companyId}`);
        const profileData = await profileResponse.json();

        if (profileResponse.ok && profileData.company) {
            fillForm(profileData.company);
            document.getElementById('companyDetailForm').style.display = 'block';
            displayMessage('success', 'Profile loaded.');
        } else {
            displayMessage('error', profileData.message || 'Failed to load profile.');
        }

        // Fetch Related Data (Raw Names and Contacts)
        await displayRelatedData(companyId);

    } catch (error) {
        displayMessage('error', 'Network error during load: ' + error.message);
    }
}

// ----------------------------------------------------------------------
// 3. FILL FORM WITH COMPANY DATA
// ----------------------------------------------------------------------
function fillForm(company) {
    document.getElementById('companyNameClean').value = company.company_name_clean || '';
    document.getElementById('targetInterest').value = company.target_interest ? 'true' : 'false';
    document.getElementById('sizeEmployees').value = company.size_employees || '';
    document.getElementById('annualRevenue').value = company.annual_revenue || '';
    document.getElementById('revenueScale').value = company.revenue_scale || '';
    document.getElementById('headquarters').value = company.headquarters || '';
    document.getElementById('notes').value = company.notes || '';
}

// ----------------------------------------------------------------------
// 4. DISPLAY RELATED DATA (Raw Names & Contacts)
// ----------------------------------------------------------------------
async function displayRelatedData(companyId) {
    const rawNamesDiv = document.getElementById('rawNamesList');
    const contactsDiv = document.getElementById('contactsList');
    
    rawNamesDiv.innerHTML = '<div class="loading-message">Loading raw names...</div>';
    contactsDiv.innerHTML = '<div class="loading-message">Loading contacts...</div>';
    document.getElementById('relatedHeader').textContent = 'Related Contacts and Names';

    try {
        const response = await fetch(`${API_BASE}/companies/${companyId}/related_data`);
        const data = await response.json();

        if (!response.ok) {
            rawNamesDiv.innerHTML = `<div class="error-message">Error: ${data.message}</div>`;
            contactsDiv.innerHTML = `<div class="error-message">Error: ${data.message}</div>`;
            return;
        }

        // Display Raw Names
        if (data.raw_names && data.raw_names.length > 0) {
            rawNamesDiv.innerHTML = data.raw_names.map(name => 
                `<div class="raw-name-item">${name}</div>`
            ).join('');
        } else {
            rawNamesDiv.innerHTML = '<div class="no-data">No raw names linked.</div>';
        }

        // Display Contacts (Now with clickable URL)
        if (data.contacts && data.contacts.length > 0) {
            contactsDiv.innerHTML = data.contacts.map(c => {
                const fullName = `${c.first_name || ''} ${c.last_name || ''}`.trim();
                let nameHtml;
                
                // Use URL for a clickable link
                if (c.url && c.url.startsWith('http')) {
                    nameHtml = `<a href="${c.url}" target="_blank" rel="noopener noreferrer" class="contact-link">${fullName}</a>`;
                } else {
                    nameHtml = `<span class="contact-name">${fullName}</span>`;
                }

                // Combine name and position/title
                return `<div class="contact-item">${nameHtml} <span class="contact-position">(${c.position || 'N/A'})</span></div>`;
            }).join('');
        } else {
            contactsDiv.innerHTML = '<div class="no-data">No linked contacts found.</div>';
        }

    } catch (error) {
        rawNamesDiv.innerHTML = `<div class="error-message">Network Error</div>`;
        contactsDiv.innerHTML = `<div class="error-message">Network Error</div>`;
        console.error("Error loading related data:", error);
    }
}

// ----------------------------------------------------------------------
// 5. SAVE CHANGES
// ----------------------------------------------------------------------
async function saveChanges() {
    if (!currentCompanyId) return;

    displayMessage('message', 'Saving changes...');

    const payload = {
        company_name_clean: document.getElementById('companyNameClean').value,
        // Convert 'true'/'false' string back to boolean for the backend
        target_interest: document.getElementById('targetInterest').value === 'true', 
        // Parse numbers, default to null if empty/invalid
        size_employees: parseInt(document.getElementById('sizeEmployees').value) || null,
        annual_revenue: parseFloat(document.getElementById('annualRevenue').value) || null,
        revenue_scale: document.getElementById('revenueScale').value,
        headquarters: document.getElementById('headquarters').value,
        notes: document.getElementById('notes').value
    };

    try {
        const response = await fetch(`${API_BASE}/companies/${currentCompanyId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        if (response.ok) {
            displayMessage('success', result.message);
            // After successful update, reload the list to update the name in the sidebar
            loadCompanyList();
        } else {
            displayMessage('error', result.message || 'Update failed.');
        }
    } catch (error) {
        displayMessage('error', 'Network error during save: ' + error.message);
    }
}

// Start the process when the page loads
document.addEventListener('DOMContentLoaded', loadCompanyList);
