// Filename: cleanup.js
// Purpose: Contains all the logic for the Company Cleanup Interface, including API calls,
//          UI rendering, and event handlers.
// FIX: Using 'raw_name' as the unique identifier/Primary Key for the unmapped list,
// as the backend API is structured around raw_name being the key field to update.
// The code now relies exclusively on 'raw_name' as the unique queue identifier, eliminating
// the need for a separate internal 'raw_company_id' or 'currentRawNameId'.

(function() {
    // API Endpoints based on the API Reference
    const API_BASE = '/api';
    
    // CRITICAL FIX: Authorization constants required by the backend (as per 15.pdf)
    const MOCK_TOKEN = 'MOCK_TOKEN';
    const AUTH_HEADER = { 'Authorization': `Bearer ${MOCK_TOKEN}` };

    // unmappedNames stores objects: { raw_name: string }
    let unmappedNames = []; 
    let currentRawName = null; // PK of the item currently being processed
    let selectedCompanyId = null; 
    let selectedCompanyName = null;
    let isProcessing = false;

    const elements = {
        listContainer: document.getElementById('rawNamesList'),
        nameCount: document.getElementById('nameCount'),
        loadingIndicator: document.getElementById('loadingIndicator'),
        emptyState: document.getElementById('emptyState'),
        currentRawNameDisplay: document.getElementById('currentRawNameDisplay'),
        messageArea: document.getElementById('messageArea'),
        existingSearchInput: document.getElementById('existingSearchInput'),
        suggestionDropdown: document.getElementById('suggestionDropdown'),
        mapExistingBtn: document.getElementById('mapExistingBtn'),
        selectedExisting: document.getElementById('selectedExisting'),
        newCleanNameInput: document.getElementById('newCleanNameInput'),
        createNewBtn: document.getElementById('createNewBtn'),
        selfMapBtn: document.getElementById('selfMapBtn'),
        batchMapBtn: document.getElementById('batchMapBtn')
    };

    // --- Utility Functions ---

    function showMessage(type, message) {
        if (!elements.messageArea) return; 
        elements.messageArea.className = 'mb-6 p-3 rounded-lg text-sm transition duration-300';
        elements.messageArea.classList.remove('hidden');

        if (type === 'success') {
            elements.messageArea.classList.add('bg-success-green/10', 'text-success-green', 'border', 'border-success-green');
        } else if (type === 'error') {
            elements.messageArea.classList.add('bg-error-red/10', 'text-error-red', 'border', 'border-error-red');
        } else if (type === 'info') {
            elements.messageArea.classList.add('bg-primary-light/10', 'text-primary-blue', 'border', 'border-primary-light');
        }
        elements.messageArea.innerHTML = message;
        // Keep the message visible a bit longer for API status feedback
        setTimeout(() => {
            elements.messageArea.classList.add('hidden');
        }, 6000);
    }

    function setControlsEnabled(enabled) {
        // Only enable controls if a name is currently selected
        const nameIsSelected = !!currentRawName;

        elements.existingSearchInput.disabled = !enabled || !nameIsSelected;
        // Keep the mapExistingBtn disabled unless a company is selected (handled in handleSelectExisting)
        elements.mapExistingBtn.disabled = !enabled || !selectedCompanyId || !nameIsSelected; 
        elements.newCleanNameInput.disabled = !enabled || !nameIsSelected;
        elements.createNewBtn.disabled = !enabled || !nameIsSelected;
        elements.selfMapBtn.disabled = !enabled || !nameIsSelected;
        elements.batchMapBtn.disabled = !enabled || unmappedNames.length === 0;

        isProcessing = !enabled;
    }

    function resetExistingMapState() {
        selectedCompanyId = null;
        selectedCompanyName = null;
        if(elements.mapExistingBtn) elements.mapExistingBtn.disabled = true;
        if(elements.selectedExisting) elements.selectedExisting.textContent = '';
        if(elements.existingSearchInput) elements.existingSearchInput.value = '';
        if(elements.suggestionDropdown) elements.suggestionDropdown.classList.add('hidden');
    }

    function showConfirmationModal(title, message) {
        return new Promise(resolve => {
            const modal = document.getElementById('confirmationModal');
            const modalTitle = document.getElementById('modalTitle');
            const modalMessage = document.getElementById('modalMessage');
            const confirmBtn = document.getElementById('modalConfirm');
            const cancelBtn = document.getElementById('modalCancel');

            if (!modal || !modalTitle || !modalMessage) {
                // Fallback for missing modal elements
                const userConfirmed = window.confirm(`${title}\n${message}`);
                resolve(userConfirmed);
                return;
            }

            modalTitle.textContent = title;
            modalMessage.innerHTML = message; 

            const cleanup = () => {
                modal.classList.add('hidden');
                confirmBtn.removeEventListener('click', onConfirm);
                cancelBtn.removeEventListener('click', onCancel);
            };

            const onConfirm = () => {
                cleanup();
                resolve(true);
            };

            const onCancel = () => {
                cleanup();
                resolve(false);
            };

            // Ensure listeners are only attached once
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);

            confirmBtn.addEventListener('click', onConfirm);
            cancelBtn.addEventListener('click', onCancel);
            modal.classList.remove('hidden');
        });
    }

    // This function must wrap the mapping action to remove the current name and advance the queue.
    async function executeMapping(url, payload, successMessage) {
        if (isProcessing || !currentRawName) return;
        setControlsEnabled(false);
        const nameToMap = currentRawName;

        try {
            const response = await fetch(API_BASE + url, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json', 
                    ...AUTH_HEADER 
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (!response.ok || data.status === 'error') {
                throw new Error(data.message || `API call failed with status: ${response.status}`);
            }

            // Success: Remove the mapped name (using raw_name as PK) and advance the queue
            unmappedNames = unmappedNames.filter(n => n.raw_name !== nameToMap);
            
            // Clear current name state before re-rendering
            currentRawName = null;
            
            renderUnmappedList();
            showMessage('success', successMessage);

        } catch (error) {
            console.error('Mapping Error:', error);
            // On failure, restore control and display error, but keep the name in the list
            showMessage('error', `Mapping failed for "${nameToMap}": ${error.message}`);
        } finally {
             // Re-enable controls, regardless of success or failure
             if (unmappedNames.length > 0) {
                 setControlsEnabled(true);
             } else {
                 setControlsEnabled(false); // List is empty
             }
        }
    }

    // --- UI State Management ---

    function selectRawName(item) {
        if (!item || !item.raw_name) {
            console.error("Selection Failed: Raw name object is missing 'raw_name'. Data received:", item);
            showMessage('error', 'The selected raw name is missing critical data and cannot be processed.');
            return; 
        }

        currentRawName = item.raw_name;
        
        console.log(`Raw Name Selected: PK/Name="${currentRawName}"`);

        elements.currentRawNameDisplay.textContent = currentRawName;
        document.querySelectorAll('#rawNamesList button').forEach(btn => {
            btn.classList.remove('bg-primary-light/20', 'ring-2', 'ring-primary-blue');
        });
        
        // Use raw_name for button ID (must be sanitized for HTML ID attribute)
        const sanitizedNameId = currentRawName.replace(/[^a-zA-Z0-9]/g, '_');
        const selectedBtn = document.getElementById(`raw-name-id-${sanitizedNameId}`);
        if (selectedBtn) {
            selectedBtn.classList.add('bg-primary-light/20', 'ring-2', 'ring-primary-blue');
        }
        
        elements.newCleanNameInput.value = currentRawName;
        resetExistingMapState();
        setControlsEnabled(true);
    }

    function renderUnmappedList() {
        if (!elements.listContainer || !elements.nameCount) return;
        elements.listContainer.innerHTML = '';
        elements.nameCount.textContent = `${unmappedNames.length} remaining`;
        
        if (unmappedNames.length === 0) {
            elements.emptyState.classList.remove('hidden');
            elements.currentRawNameDisplay.textContent = 'Cleanup complete!';
            setControlsEnabled(false);
            currentRawName = null;
            return;
        } else {
            elements.emptyState.classList.add('hidden');
        }

        unmappedNames.forEach(item => {
            const sanitizedNameId = item.raw_name.replace(/[^a-zA-Z0-9]/g, '_');
            const button = document.createElement('button');
            // Use sanitized raw_name for button ID
            button.id = `raw-name-id-${sanitizedNameId}`; 
            button.className = 'block w-full text-left p-2 rounded-lg transition duration-150 hover:bg-gray-100 text-sm truncate';
            button.textContent = item.raw_name;
            button.onclick = () => selectRawName(item); 
            elements.listContainer.appendChild(button);
        });

        // Auto-select the first name if none is selected, or if the previously selected name is gone
        if (!currentRawName || !unmappedNames.find(n => n.raw_name === currentRawName)) {
            const firstValidName = unmappedNames[0]; 
            if (firstValidName) {
                selectRawName(firstValidName);
            } else {
                setControlsEnabled(false); // If no names left
            }
        }
    }

    // --- API Calls ---

    async function fetchUnmappedList() {
        if (!elements.loadingIndicator) return;

        elements.loadingIndicator.classList.remove('hidden');
        try {
            const response = await fetch(`${API_BASE}/unmapped_list`, { headers: AUTH_HEADER });
            
            if (!response.ok) throw new Error(`API returned status ${response.status}.`);
            
            const data = await response.json();
            const rawNames = data.raw_names || [];
            
            // Filter to ensure only items with a raw_name are processed
            unmappedNames = rawNames.filter(item => item && item.raw_name);

        } catch (error) {
            showMessage('error', `Could not load raw names: ${error.message}`);
            console.error('Initial Load Error:', error);
        } finally {
            renderUnmappedList();
            elements.loadingIndicator.classList.add('hidden');
        }
    }


    let searchTimeout = null;
    function fetchSuggestions(query) {
        if (!query || query.length < 2) {
            elements.suggestionDropdown.classList.add('hidden');
            return;
        }

        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            const dropdown = elements.suggestionDropdown;
            dropdown.classList.remove('hidden');
            dropdown.innerHTML = '<div class="p-2 text-sm text-gray-500 text-center"><i data-lucide="loader-circle" class="w-4 h-4 inline-block animate-spin mr-1"></i> Searching...</div>';

            try {
                // Uses API 14.0 as defined in the spec
                const response = await fetch(`${API_BASE}/search/company?query=${encodeURIComponent(query)}`, { headers: AUTH_HEADER });
                
                if (!response.ok) throw new Error('Search failed.');
                
                const data = await response.json();
                dropdown.innerHTML = '';

                // Uses data.companies as defined in the spec
                if (data.companies && data.companies.length > 0) {
                    data.companies.forEach(item => {
                        const suggestionDiv = document.createElement('div');
                        suggestionDiv.className = 'p-2 hover:bg-primary-light/10 cursor-pointer text-sm transition duration-100 truncate';
                        suggestionDiv.textContent = item.company_name_clean;
                        suggestionDiv.onclick = () => {
                            // handleSelectExisting is a local helper function
                            handleSelectExisting(item.company_id, item.company_name_clean);
                        }
                        dropdown.appendChild(suggestionDiv);
                    });
                } else {
                    dropdown.innerHTML = '<div class="p-2 text-sm text-gray-500">No existing profiles found.</div>';
                }
            } catch (error) {
                dropdown.innerHTML = '<div class="p-2 text-sm text-error-red">Error fetching suggestions.</div>';
                console.error('Suggestion Fetch Error:', error);
            }
            if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
                 lucide.createIcons(); // Re-render icons if new search results contain them
            }
        }, 300); 
    }

    // Action 1: Map to Existing (API 6.0)
    function handleSelectExisting(id, name) {
        selectedCompanyId = id;
        selectedCompanyName = name;
        elements.existingSearchInput.value = name;
        elements.selectedExisting.textContent = `Selected: ${name} (ID: ${id})`;
        elements.suggestionDropdown.classList.add('hidden');
        // Enable map button as we have both a raw name and a target ID
        elements.mapExistingBtn.disabled = false; 
        console.log(`Existing Company Selected: ID=${selectedCompanyId}, Name="${selectedCompanyName}"`);
    }

    async function handleMapExisting() {
        if (!selectedCompanyId || !currentRawName) {
            showMessage('error', 'Please select an existing clean company name and ensure a raw name is available.');
            return;
        }

        // Uses API 6.0: POST /api/map/existing
        await executeMapping(
            '/map/existing', 
            // FIX: Sending raw_name as the PK for the mapping table update
            { raw_name: currentRawName, company_id: selectedCompanyId },
            `Successfully mapped "${currentRawName}" to existing profile: "${selectedCompanyName}".`
        );
    }

    // Action 2: Create & Map New (API 7.0)
    async function handleCreateNew() {
        const newCleanName = elements.newCleanNameInput.value.trim();
        if (!newCleanName || !currentRawName) {
            showMessage('error', 'Please enter a clean company name and ensure a raw name is available.');
            return;
        }

        // Uses API 7.0: POST /api/map/new
        await executeMapping(
            '/map/new', 
            // FIX: Sending raw_name as the PK for the mapping table update
            { raw_name: currentRawName, company_name_clean: newCleanName },
            `Created new profile "${newCleanName}" and successfully mapped "${currentRawName}" to it.`
        );
    }

    // Action 3: Skip & Self-Map (API 8.0)
    async function handleSelfMap() {
        if (!currentRawName) {
            showMessage('error', 'A raw name must be selected to perform a self-map.');
            return;
        }

        const confirmed = await showConfirmationModal(
            'Confirm Self-Map',
            `Are you sure you want to create a new profile named "<strong>${currentRawName}</strong>" and map the raw name to it?`
        );

        if (confirmed) {
            // Uses API 8.0: POST /api/map/self
            await executeMapping(
                '/map/self', 
                // FIX: Sending raw_name as the PK for the mapping table update
                { raw_name: currentRawName },
                `Successfully created self-mapped profile "${currentRawName}".`
            );
        } else {
            showMessage('info', 'Self-Map operation cancelled.');
        }
    }

    // Action 4: Batch Map (API 1.5 - as per flow documentation)
    async function handleBatchMap() {
        if (unmappedNames.length === 0) {
            showMessage('info', 'No unmapped names remaining for batch processing.');
            return;
        }

        const confirmed = await showConfirmationModal(
            'Confirm Batch Map',
            `Are you sure you want to attempt to batch map all <strong>${unmappedNames.length}</strong> remaining names to Target Company profiles? This action cannot be easily undone.`
        );

        if (confirmed) {
            // Note: Batch map is assumed to be an asynchronous backend job.
            // For simplicity in this UI, we just clear the local list and trust the backend.
            await executeMapping(
                '/map/batch', 
                {}, // Payload is often empty for a trigger-only batch job
                `Successfully started batch map for ${unmappedNames.length} names. The list will update automatically.`
            );
            unmappedNames = []; 
            // Set currentRawName to null so the list renders correctly
            currentRawName = null; 
            renderUnmappedList();
            setControlsEnabled(false);
        } else {
            showMessage('info', 'Batch map operation cancelled.');
        }
    }


    // Global initialization
    window.onload = function() {
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
             lucide.createIcons();
        }
        fetchUnmappedList();

        document.addEventListener('click', (e) => {
            if (!elements.existingSearchInput || !elements.suggestionDropdown) return;
            
            if (!elements.existingSearchInput.contains(e.target) && !elements.suggestionDropdown.contains(e.target)) {
                elements.suggestionDropdown.classList.add('hidden');
            }
        });
    };

    // Expose necessary functions globally for use in HTML onclick handlers
    window.cleanupApp = {
        fetchSuggestions: fetchSuggestions,
        handleMapExisting: handleMapExisting,
        handleCreateNew: handleCreateNew,
        handleSelfMap: handleSelfMap,
        handleBatchMap: handleBatchMap,
    };

})();
