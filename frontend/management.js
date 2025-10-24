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
// 2. LOAD DETAILS FOR SELECTED COMPANY
// ----------------------------------------------------------------------
async function selectCompany(id, element) {
    currentCompanyId = id;
    document.querySelectorAll('.company-item').forEach(item => item.classList.remove('selected'));
    element.classList.add('selected');

    document.getElementById('detailTitle').textContent = `Loading Details for ID ${id}...`;
    document.getElementById('companyForm').style.display = 'none';
    document.getElementById('messageDisplay').style.display = 'none';

    try {
        const response = await fetch(`${API_BASE}/companies/${id}`);
        const company = await response.json();

        if (response.ok) {
            document.getElementById('detailTitle').textContent = `Editing: ${company.company_name_clean}`;
            
            // --- RENDER MAPPED RAW NAMES ---
            const mappedList = document.getElementById('mappedNamesList');
            mappedList.innerHTML = ''; // Clear previous list

            if (company.mapped_names && company.mapped_names.length > 0) {
                company.mapped_names.forEach(name => {
                    const listItem = document.createElement('li');
                    listItem.textContent = name;
                    mappedList.appendChild(listItem);
                });
            } else {
                mappedList.innerHTML = '<li>No raw names mapped yet.</li>';
            }
            
            // --- RENDER ASSOCIATED CONTACTS ---
            const contactList = document.getElementById('contactList');
            contactList.innerHTML = ''; // Clear previous list

            if (company.contacts && company.contacts.length > 0) {
                company.contacts.forEach(person => {
                    const listItem = document.createElement('li');
                    
                    let name = `${person.first_name || ''} ${person.last_name || ''}`.trim();

                    if (person.linkedin_url) {
                        const link = document.createElement('a');
                        link.href = person.linkedin_url;
                        link.target = '_blank'; // Open in new tab
                        link.textContent = name;
                        listItem.appendChild(link);
                    } else {
                        listItem.textContent = name;
                    }
                    
                    contactList.appendChild(listItem);
                });
            } else {
                contactList.innerHTML = '<li>No contacts found linked to this company\'s raw names.</li>';
            }
            
            // --- POPULATE FORM FIELDS ---
            document.getElementById('companyNameClean').value = company.company_name_clean || '';
            document.getElementById('targetInterest').value = String(company.target_interest);
            document.getElementById('sizeEmployees').value = company.size_employees || '';
            document.getElementById('annualRevenue').value = company.annual_revenue || '';
            document.getElementById('revenueScale').value = company.revenue_scale || '';
            document.getElementById('headquarters').value = company.headquarters || '';
            document.getElementById('notes').value = company.notes || '';

            document.getElementById('companyForm').style.display = 'block';

        } else {
            document.getElementById('detailTitle').textContent = 'Error loading details.';
            displayMessage('error', company.message);
        }
    } catch (error) {
        document.getElementById('detailTitle').textContent = 'Connection Error.';
        displayMessage('error', `Network error: ${error.message}`);
    }
}
// ----------------------------------------------------------------------
// 3. SAVE CHANGES (PUT request)
// ----------------------------------------------------------------------
async function saveChanges() {
    if (!currentCompanyId) return;

    displayMessage('message', 'Saving changes...');

    const payload = {
        company_name_clean: document.getElementById('companyNameClean').value,
        target_interest: document.getElementById('targetInterest').value === 'true',
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
