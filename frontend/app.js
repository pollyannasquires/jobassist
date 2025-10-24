// /home/jobert/webapp/contact_app/frontend/app.js (Comprehensive Cleanup Interface)
const API_BASE = '/api';
let currentRawName = null;

function displayMessage(type, message) {
    const display = document.getElementById('messageDisplay');
    display.textContent = message;
    display.className = `message ${type}`;
    display.style.display = 'block';
}

function resetDetailPanel() {
    document.getElementById('mapToExistingPanel').style.display = 'none';
    document.getElementById('createNewPanel').style.display = 'none';
    document.getElementById('rawNameDisplay').textContent = 'Select a company name from the list.';
    document.getElementById('existingCleanName').value = '';
    document.getElementById('newCleanName').value = '';
}

// ----------------------------------------------------------------------
// 1. LOAD FULL LIST OF UNMAPPED COMPANY NAMES
// ----------------------------------------------------------------------
async function loadUnmappedList() {
    const listDiv = document.getElementById('unmappedList');
    listDiv.innerHTML = 'Fetching list of unmapped companies...';
    resetDetailPanel();

    try {
        const response = await fetch(`${API_BASE}/unmapped_list`);
        const data = await response.json();

        if (data.raw_names && data.raw_names.length > 0) {
            listDiv.innerHTML = '';
            // Show the batch button if there are names to process
            document.getElementById('batchActionButton').style.display = 'block';

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
            document.getElementById('rawNameDisplay').textContent = 'Cleanup Complete.';
            document.getElementById('batchActionButton').style.display = 'none';
        }
    } catch (error) {
        listDiv.innerHTML = `Error loading list: ${error.message}`;
        document.getElementById('rawNameDisplay').textContent = 'Connection Error.';
        document.getElementById('batchActionButton').style.display = 'none';
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

    // Update the main display and show both panels
    document.getElementById('rawNameDisplay').textContent = `Processing: ${name}`;
    document.getElementById('mapToExistingPanel').style.display = 'block';
    document.getElementById('createNewPanel').style.display = 'block';

    // Clear and focus the existing search input
    document.getElementById('existingCleanName').value = '';
    document.getElementById('existingCleanNameList').innerHTML = '';
    document.getElementById('existingCleanName').focus(); 
}

// ----------------------------------------------------------------------
// 3. FETCH CLEAN NAME SUGGESTIONS (Used for existing mapping)
// ----------------------------------------------------------------------
async function fetchSuggestions(inputId, datalistId) {
    const cleanNameInput = document.getElementById(inputId).value.trim();
    const datalist = document.getElementById(datalistId);
    datalist.innerHTML = '';

    if (cleanNameInput.length < 2) return;

    try {
        const response = await fetch(`${API_BASE}/suggestions?q=${encodeURIComponent(cleanNameInput)}`);
        const data = await response.json();

        if (response.ok && data.suggestions) {
            data.suggestions.forEach(suggestion => {
                const option = document.createElement('option');
                // The value is the clean name, which will be submitted
                option.value = suggestion.company_name_clean;
                datalist.appendChild(option);
            });
        }
    } catch (error) {
        console.error("Suggestion fetch failed:", error);
    }
}

// ----------------------------------------------------------------------
// 4. SUBMIT MAPPING DECISION (Three paths: Map Existing, Create New, Skip)
// ----------------------------------------------------------------------
async function submitMapping(mappingType) {
    if (!currentRawName) {
        displayMessage('error', 'Please select a company name first.');
        return;
    }

    let payload = { raw_name: currentRawName, action: mappingType };
    let cleanName;
    
    // Determine the clean name based on the action
    if (mappingType === 'map') {
        cleanName = document.getElementById('existingCleanName').value.trim();
        if (!cleanName) {
            displayMessage('error', 'Please enter a clean name to map to.');
            return;
        }
        payload.clean_name = cleanName;
    } else if (mappingType === 'create') {
        cleanName = document.getElementById('newCleanName').value.trim();
        if (!cleanName) {
            displayMessage('error', 'Please enter a name for the new company profile.');
            return;
        }
        payload.clean_name = cleanName;
        // The backend logic for 'map' will automatically create the company if clean_name is new.
        // We will send 'map' action but from the 'create' UI flow.
        payload.action = 'map'; 
    } 
    // 'skip' requires no cleanName

    const mapButton = document.getElementById('mapExistingButton');
    const createButton = document.getElementById('createNewButton');
    const skipButton = document.getElementById('skipButton');

    mapButton.disabled = createButton.disabled = skipButton.disabled = true;
    displayMessage('message', 'Submitting map decision...');

    try {
        const response = await fetch(`${API_BASE}/map_company`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        mapButton.disabled = createButton.disabled = skipButton.disabled = false;

        if (response.ok) {
            displayMessage('success', result.message);
            // After successful map/create/skip, reload the list
            currentRawName = null;
            setTimeout(() => {
                loadUnmappedList();
                document.getElementById('newCleanName').value = ''; // Clear new profile input
            }, 1000); 
        } else {
            displayMessage('error', result.message || 'Mapping failed.');
        }
    } catch (error) {
        mapButton.disabled = createButton.disabled = skipButton.disabled = false;
        displayMessage('error', 'Network error during submission: ' + error.message);
    }
}

// ----------------------------------------------------------------------
// 5. BATCH CREATE AND MAP ALL REMAINING UNMAPPED NAMES
// ----------------------------------------------------------------------
async function batchCreateAndMap() {
    const listItems = document.querySelectorAll('#unmappedList .raw-name-item');
    if (listItems.length === 0) {
        displayMessage('error', 'No unmapped names to process.');
        return;
    }

    // IMPORTANT: Custom modal should be used instead of confirm() in a real application
    if (!window.confirm(`Are you sure you want to create and map ${listItems.length} new profiles, setting 'Target Interest' to YES for all?`)) {
        return;
    }

    const batchButton = document.getElementById('batchActionButton');
    batchButton.disabled = true;
    displayMessage('message', `Starting batch process for ${listItems.length} names. This may take a moment...`);

    let successCount = 0;
    let failCount = 0;
    const totalCount = listItems.length;

    for (const item of listItems) {
        const rawName = item.dataset.name;
        
        // Payload for batch creation:
        // action='map' will create the company profile if clean_name is new.
        // target_interest: true is the flag we send to the backend.
        const payload = { 
            raw_name: rawName, 
            action: 'map', 
            clean_name: rawName,
            target_interest: true // Flag to set target_interest on new profile
        };
        
        // Provide visual feedback
        item.textContent = `[Processing...] ${rawName}`;
        item.style.backgroundColor = '#fffacd';

        try {
            const response = await fetch(`${API_BASE}/map_company`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (response.ok) {
                successCount++;
                item.style.backgroundColor = '#d4edda';
            } else {
                failCount++;
                item.style.backgroundColor = '#f8d7da';
                console.error(`Failed to batch process ${rawName}:`, await response.json());
            }

        } catch (error) {
            failCount++;
            item.style.backgroundColor = '#f8d7da';
            console.error(`Network error for ${rawName}:`, error);
        }
        
        displayMessage('message', `Batch progress: ${successCount} successful, ${failCount} failed out of ${totalCount}.`);
    }

    // Final cleanup and reload
    batchButton.disabled = false;
    displayMessage('success', `Batch complete! ${successCount} profiles created and mapped. ${failCount} failures.`);
    currentRawName = null;
    
    // Give time to see final results, then reload list
    setTimeout(loadUnmappedList, 5000); 
}


// Start the process when the page loads
document.addEventListener('DOMContentLoaded', () => {
    loadUnmappedList();

    // Attach suggestion handlers
    document.getElementById('existingCleanName').addEventListener('input', () => 
        fetchSuggestions('existingCleanName', 'existingCleanNameList')
    );
});
