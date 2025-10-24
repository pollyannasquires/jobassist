// /home/jobert/webapp/contact_app/frontend/app.js (LIST-BASED MAPPING)
const API_BASE = '/api';
let currentRawName = null;

function displayMessage(type, message) {
    const display = document.getElementById('messageDisplay');
    display.textContent = message;
    display.className = `message ${type}`;
    display.style.display = 'block';
}

// ----------------------------------------------------------------------
// 1. LOAD FULL LIST OF UNMAPPED COMPANY NAMES
// ----------------------------------------------------------------------
async function loadUnmappedList() {
    const listDiv = document.getElementById('unmappedList');
    listDiv.innerHTML = 'Fetching list of unmapped companies...';
    document.getElementById('mapForm').style.display = 'none';
    document.getElementById('rawNameDisplay').textContent = 'Select a company name below.';


    try {
        const response = await fetch(`${API_BASE}/unmapped_list`);
        const data = await response.json();

        if (data.raw_names && data.raw_names.length > 0) {
            listDiv.innerHTML = '';
            data.raw_names.forEach(name => {
                const item = document.createElement('div');
                item.className = 'raw-name-item';
                item.textContent = name;
                item.dataset.name = name;
                item.onclick = () => selectRawName(name, item);
                listDiv.appendChild(item);
            });
        } else {
            listDiv.innerHTML = 'All company names have been mapped!';
            document.getElementById('rawNameDisplay').textContent = 'Mapping Complete.';
        }
    } catch (error) {
        listDiv.innerHTML = `Error loading list: ${error.message}`;
        document.getElementById('rawNameDisplay').textContent = 'Connection Error.';
    }
}

// ----------------------------------------------------------------------
// 2. SELECT RAW NAME FOR MAPPING
// ----------------------------------------------------------------------
function selectRawName(name, element) {
    currentRawName = name;
    
    // Highlight the selected item
    document.querySelectorAll('.raw-name-item').forEach(item => item.classList.remove('selected'));
    element.classList.add('selected');

    // Update the main display and form
    document.getElementById('rawNameDisplay').textContent = name;
    document.getElementById('mapForm').style.display = 'block';
    document.getElementById('cleanName').value = ''; // Clear input field
    document.getElementById('cleanNameList').innerHTML = ''; // Clear suggestions
    document.getElementById('cleanName').focus(); // Put focus on the input field
}

// ----------------------------------------------------------------------
// 3. FETCH CLEAN NAME SUGGESTIONS (Logic is unchanged)
// ----------------------------------------------------------------------
async function fetchSuggestions() {
    const cleanNameInput = document.getElementById('cleanName').value.trim();
    const datalist = document.getElementById('cleanNameList');
    datalist.innerHTML = '';

    if (cleanNameInput.length < 2) return;

    try {
        const response = await fetch(`${API_BASE}/suggestions?q=${encodeURIComponent(cleanNameInput)}`);
        const data = await response.json();

        if (response.ok && data.suggestions) {
            data.suggestions.forEach(suggestion => {
                const option = document.createElement('option');
                option.value = suggestion.company_name_clean;
                datalist.appendChild(option);
            });
        }
    } catch (error) {
        console.error("Suggestion fetch failed:", error);
    }
}

// ----------------------------------------------------------------------
// 4. SUBMIT MAPPING DECISION (POST request)
// ----------------------------------------------------------------------
async function submitMapping(mappingType) {
    if (!currentRawName) {
        displayMessage('error', 'Please select a company name first.');
        return;
    }

    const cleanName = document.getElementById('cleanName').value.trim();

    if (mappingType === 'map' && !cleanName) {
        displayMessage('error', 'Please enter a clean name to map.');
        return;
    }

    let payload = { raw_name: currentRawName, action: mappingType, clean_name: cleanName || '' };
    
    document.getElementById('submitButton').disabled = true;
    document.getElementById('skipButton').disabled = true;
    displayMessage('message', 'Submitting map decision...');

    try {
        const response = await fetch(`${API_BASE}/map_company`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        document.getElementById('submitButton').disabled = false;
        document.getElementById('skipButton').disabled = false;

        if (response.ok) {
            displayMessage('success', result.message);
            // After successful map, reload the entire list
            // Use a timeout to allow the user to read the success message
            setTimeout(() => {
                loadUnmappedList();
            }, 1000); 
        } else {
            displayMessage('error', result.message || 'Mapping failed.');
        }
    } catch (error) {
        document.getElementById('submitButton').disabled = false;
        document.getElementById('skipButton').disabled = false;
        displayMessage('error', 'Network error during submission: ' + error.message);
    }
}

// Start the process when the page loads
document.addEventListener('DOMContentLoaded', () => {
    loadUnmappedList(); // <--- Now loads the list, not just the next company
    document.getElementById('cleanName').addEventListener('input', fetchSuggestions);
});
