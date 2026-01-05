// FILENAME: application_create.js | COMPLETE AND FINAL WORKING VERSION (500 Error Fix for PUT)

// --- 1. Imports ---
import { initializeServices, fetchWithGuard, currentUserId, appId } from './core-utils.js';
import { injectNavbar } from './navbar.js';
import { initSidebar } from './company_sidebar.js';

// --- 2. Configuration & API Endpoints ---
const API = {
    COMPANY_DETAILS: (companyId) => `/api/companies/${companyId}`, 
    FETCH_APPLICATION_DETAILS: (applicationId) => `/api/application/${applicationId}`, 
    CREATE_APPLICATION: '/api/applications', // Endpoint 10
    UPDATE_APPLICATION: (applicationId) => `/api/applications/${applicationId}`, 
    UPLOAD_DOCUMENT: (applicationId) => `/api/application/${applicationId}/documents`, // Endpoint 9
};

// --- 3. Global State ---
let activeCompanyId = null;
let companyNameClean = '';
let currentApplicationData = null; 
let isEditMode = false;

// --- 4. Utility Functions ---
function getUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    let companyId = urlParams.get('companyId') || urlParams.get('company_id');
    let appId = urlParams.get('appId') || urlParams.get('applicationId');
    let mode = urlParams.get('mode');
    let companyName = urlParams.get('companyName'); 
    return { companyId, appId, mode, companyName };
}

function showMessageBox(message, isSuccess) {
    const messageBox = document.getElementById('messageBox');
    if (!messageBox) return;

    messageBox.textContent = message;
    messageBox.classList.remove('hidden', 'bg-red-100', 'text-red-800', 'bg-emerald-100', 'text-emerald-800');

    if (isSuccess) {
        messageBox.classList.add('bg-emerald-100', 'text-emerald-800');
    } else {
        messageBox.classList.add('bg-red-100', 'text-red-800');
    }
}

// --- 5. Data Fetching and Initialization Functions ---

async function fetchApplicationDetails(appId) {
    const operationName = `fetching application ${appId} details`;
    try {
        const details = await fetchWithGuard(
            API.FETCH_APPLICATION_DETAILS(appId),
            'GET',
            operationName
        );
        return details.application; 
    } catch (error) {
        console.error(`Failed to fetch application details for ${appId}:`, error);
        throw error;
    }
}

function updateCompanyDisplay(companyId, companyNameFromSource) {
    const companyNameInput = document.getElementById('companyName');
    const displayCompanyIdSpan = document.getElementById('displayCompanyId'); 
    const hiddenCompanyIdInput = document.getElementById('companyId');
    
    if (displayCompanyIdSpan) {
        displayCompanyIdSpan.textContent = companyId;
    }
    if (hiddenCompanyIdInput) {
        hiddenCompanyIdInput.value = companyId;
    }

    companyNameClean = companyNameFromSource ? decodeURIComponent(companyNameFromSource) : '';
    
    if (companyNameInput) {
        companyNameInput.value = companyNameClean || `Error: Name not available for ID ${companyId}`;
    }
}

function populateForm(applicationData) {
    if (!applicationData) return;
    
    const formTitle = document.getElementById('formTitle');
    const submitBtn = document.getElementById('submitBtn');

    if (formTitle) {
        formTitle.textContent = `Edit Application: ${applicationData.job_title_info?.title_name || 'N/A'}`;
    }
    if (submitBtn) {
        submitBtn.innerHTML = `<i data-lucide=\"save\" class=\"w-5 h-5 mr-2\"></i> Update Application`;
        document.title = `Edit: ${applicationData.job_title_info?.title_name} | JobAssist`;
    }

    document.getElementById('jobTitle').value = applicationData.job_title_info?.title_name || '';
    document.getElementById('jobUrl').value = applicationData.job_posting_url || '';
    document.getElementById('currentStatus').value = applicationData.current_status || 'NEW';
    
    const date = new Date(applicationData.date_applied);
    const dateInput = document.getElementById('dateApplied');
    if (dateInput) {
        const dateString = date.toISOString().split('T')[0];
        dateInput.value = dateString;
    }
    
    currentApplicationData = applicationData; 
    
    // Hide upload button and container in edit mode
    document.getElementById('addDocumentBtn')?.classList.add('hidden');
    const docContainer = document.getElementById('documentUploadContainer');
    if (docContainer) {
         docContainer.innerHTML = 'Documents must be managed on the Application Review page.';
    }
}


async function loadExistingApplication(appId) {
    const submitBtn = document.getElementById('submitBtn');
    try {
        showMessageBox(`Loading application details for ${appId.substring(0, 8)}...`, true);
        
        const applicationData = await fetchApplicationDetails(appId);
        
        const companyId = applicationData.company_info?.company_id || activeCompanyId;
        const companyNameFromApp = applicationData.company_info?.company_name_clean || companyNameClean;
        
        if (companyId) {
            activeCompanyId = companyId; 
            updateCompanyDisplay(companyId, companyNameFromApp); 
        }

        populateForm(applicationData);
        document.getElementById('messageBox')?.classList.add('hidden');
        if (submitBtn) {
            submitBtn.disabled = false;
        }

        if(typeof lucide !== 'undefined') { lucide.createIcons(); } 

        return true;

    } catch (error) {
        console.error("Failed to load application details:", error);
        showMessageBox(`Failed to load application details: ${error.message}`, false);
        if (submitBtn) {
            submitBtn.disabled = true; 
        }
        return false;
    }
}

// --- 6. Document Row Management Functions ---

/**
 * Dynamically creates and adds a new row for file and document type input.
 */
function addDocumentRow() {
    const container = document.getElementById('documentUploadContainer');
    if (!container) return; // Safely exit if container not found

    const rowId = `docRow_${Date.now()}`;
    const rowHtml = `
        <div id="${rowId}" class="flex space-x-2 mb-3 items-end document-row border-b border-gray-100 pb-3">
            <div class="flex-grow w-1/3">
                <label for="docType_${rowId}" class="block text-xs font-medium text-gray-700">Document Type</label>
                <select id="docType_${rowId}" name="docType" required class="w-full p-2 border border-gray-300 rounded-lg text-sm">
                    <option value="" disabled selected>Select Type</option>
                    <option value="RESUME">Resume</option>
                    <option value="COVER_LETTER">Cover Letter</option>
                    <option value="TRANSCRIPT">Transcript</option>
                    <option value="OTHER">Other</option>
                </select>
            </div>
            <div class="flex-grow w-2/3">
                <label for="docFile_${rowId}" class="block text-xs font-medium text-gray-700">File</label>
                <input type="file" id="docFile_${rowId}" name="docFile" required class="w-full text-sm border border-gray-300 rounded-lg p-1.5">
            </div>
            <button type="button" data-row-id="${rowId}" class="removeDocumentBtn p-2 text-sm text-red-600 hover:text-red-800 transition duration-150">
                <i data-lucide="x" class=\"w-5 h-5\"></i>
            </button>
        </div>
    `;
    
    // Use insertAdjacentHTML for reliable DOM injection
    container.insertAdjacentHTML('beforeend', rowHtml);
}

/**
 * Uploads a single file and its type to the API endpoint.
 * @param {string} appId - The ID of the application.
 * @param {File} file - The file object to upload.
 * @param {string} type - The document type string.
 * @param {number} index - The index for logging.
 */
async function uploadSingleDocument(appId, file, type, index) {
    const apiUrl = API.UPLOAD_DOCUMENT(appId);
    const fileName = file.name;
    const operationName = `uploading file ${index + 1}/${fileName}`;

    try {
        const formData = new FormData();
        
        // Final working keys from prior debugging
        formData.append('file', file);
        formData.append('document_type', type); 

        console.log(`[FILE UPLOAD] Starting upload for file ${index + 1} (${fileName}) using file key 'document' and type key 'document_type'...`);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer MOCK_TOKEN' 
            },
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: response.statusText }));
            const errorMessage = errorData?.message || `API Error (${response.status}): ${operationName} failed.`;
            throw new Error(errorMessage);
        }
        
        console.log(`[FILE UPLOAD] Success: File ${index + 1} (${fileName}) uploaded successfully. Status: ${response.status}`);
        return true; // Success

    } catch (error) {
        console.error(`[FILE UPLOAD] ${operationName} failed:`, error);
        return false; // Failure
    }
}

/**
 * Handles the upload of documents by making one API call per file.
 * @param {string} appId - The ID of the application to attach documents to.
 * @param {Array<{file: File, type: string}>} filesToUpload - List of files and their types.
 */
async function uploadDocuments(appId, filesToUpload) {
    const operationName = `uploading ${filesToUpload.length} document(s)`;
    
    if (filesToUpload.length === 0) return true;

    // Map each file to a promise that executes the single-file API call
    const uploadPromises = filesToUpload.map((item, index) => 
        uploadSingleDocument(appId, item.file, item.type, index)
    );

    // Wait for all uploads to complete concurrently
    const results = await Promise.all(uploadPromises);

    const successCount = results.filter(r => r).length;
    
    if (successCount === filesToUpload.length) {
        return true;
    } else {
        const failureCount = filesToUpload.length - successCount;
        const errorMessage = `${successCount} documents uploaded successfully, but ${failureCount} failed.`;
        
        // Report success to the main form submission but show a warning
        showMessageBox(`Application created, but: ${errorMessage}`, false);
        return false; 
    }
}


// --- 7. Form Submission and Handlers ---

/**
 * Handles the main form submission for creating or updating an application.
 */
async function handleFormSubmit(event) {
    event.preventDefault();
    
    const submitBtn = document.getElementById('submitBtn');

    // 1. Disable button and show loading
    if (submitBtn) {
        submitBtn.disabled = true;
        const originalBtnText = isEditMode ? 'Updating...' : 'Submitting...';
        submitBtn.innerHTML = `<i data-lucide=\"loader-circle\" class=\"w-5 h-5 mr-2 animate-spin\"></i> ${originalBtnText}`;
        if(typeof lucide !== 'undefined') { lucide.createIcons(); }
    }

    // 2. Prepare Data
    let applicationData = {};
    const method = isEditMode ? 'PUT' : 'POST';
    const apiUrl = isEditMode 
        ? API.UPDATE_APPLICATION(currentApplicationData.application_id) 
        : API.CREATE_APPLICATION;
    const operationName = isEditMode ? `Updating application ${currentApplicationData.application_id}` : 'Creating new application';
    
    let newAppId = null;

    try {
        let responseData = null;

        if (isEditMode) {
            // PUT (Update) payload: Ensure all necessary IDs are sent to prevent server crash (FIXED)
            applicationData = {
                current_status: document.getElementById('currentStatus').value,
                date_applied: document.getElementById('dateApplied').value,
                title_name: document.getElementById('jobTitle').value,
                // CRITICAL FIX: Include company details in the PUT payload
                company_id: activeCompanyId, 
                company_name_clean: companyNameClean, 
            };
            
        } else {
            // POST (Create) payload: Full structure
            applicationData = {
                title_name: document.getElementById('jobTitle').value || '', 
                job_posting_url: document.getElementById('jobUrl').value || '',
                current_status: document.getElementById('currentStatus').value || '',
                date_applied: document.getElementById('dateApplied').value || '',
                company_id: activeCompanyId,
                company_name_clean: companyNameClean,
            };
        }
        
        // 3. Raw fetch for BOTH PUT and POST (JSON payloads)
        const response = await fetch(apiUrl, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer MOCK_TOKEN' 
            },
            body: JSON.stringify(applicationData)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: response.statusText }));
            const errorMessage = errorData?.message || `API Error (${response.status}): ${operationName} failed.`;
            throw new Error(errorMessage);
        }
        responseData = await response.json();
        
        // 4. Success handling
        newAppId = responseData.application_id || (isEditMode ? currentApplicationData.application_id : null);
        
        // 5. Handle Document Upload for NEW applications (POST)
        if (!isEditMode && newAppId) {
            const documentRows = document.querySelectorAll('.document-row');
            const filesToUpload = [];

            // Collect files and types from all dynamic rows
            documentRows.forEach(row => {
                const fileInput = row.querySelector('input[name="docFile"]');
                const typeSelect = row.querySelector('select[name="docType"]');
                
                if (fileInput?.files[0] && typeSelect?.value) {
                    filesToUpload.push({
                        file: fileInput.files[0],
                        type: typeSelect.value
                    });
                }
            });
            
            if (filesToUpload.length > 0) {
                // *** CALLS THE NEW MULTI-API-CALL FUNCTION ***
                await uploadDocuments(newAppId, filesToUpload); 
            }
        }

        // 6. Final Success Message
        showMessageBox(`Application ${isEditMode ? 'updated' : 'created'} successfully! ID: ${newAppId.substring(0, 8)}...`, true);

        // 7. Redirect after a much longer delay for debugging (Set back to 1500ms when confirmed working)
        console.log("Redirecting in 10 seconds. Check console and network tab for confirmation (200/201 status codes).");
        setTimeout(() => {
            window.location.href = `application_review.html?companyId=${activeCompanyId}&companyName=${encodeURIComponent(companyNameClean)}`;
        }, 1500); 

    } catch (error) {
        console.error(`${operationName} failed:`, error);
        showMessageBox(`Application ${isEditMode ? 'update' : 'creation'} failed: ${error.message}`, false);

    } finally {
        // Reset button state
        if (!newAppId && submitBtn) {
            submitBtn.disabled = false;
            const originalBtnText = isEditMode ? 'Update Application' : 'Submit Application';
            submitBtn.innerHTML = `<i data-lucide=\"${isEditMode ? 'save' : 'send'}\" class=\"w-5 h-5 mr-2\"></i> ${originalBtnText}`;
            if(typeof lucide !== 'undefined') { lucide.createIcons(); } 
        }
    }
}


/**
 * Sets up listeners for dynamically added document rows.
 */
function setupDocumentListeners() {
    const addDocumentBtn = document.getElementById('addDocumentBtn');
    const docContainer = document.getElementById('documentUploadContainer');

    // 1. Setup button listener
    if (addDocumentBtn) {
        addDocumentBtn.addEventListener('click', (event) => {
            event.preventDefault();
            addDocumentRow();
            // Ensure icons are created for the new row immediately after addition
            if (typeof lucide !== 'undefined') { lucide.createIcons(); } 
        });
    }
    
    // 2. Setup remove button listener
    if (docContainer) {
        docContainer.addEventListener('click', (event) => {
            const button = event.target.closest('.removeDocumentBtn');
            if (button) {
                event.preventDefault();
                const rowId = button.getAttribute('data-row-id');
                document.getElementById(rowId)?.remove();
            }
        });
    }

    // 3. CRITICAL FIX: Only run initialization logic in CREATE mode.
    if (!isEditMode) {
         // Show the button
         addDocumentBtn?.classList.remove('hidden');

         // Add one empty row initially
         addDocumentRow();
         
         // Ensure the icons on the initial row are created immediately
         if (typeof lucide !== 'undefined') { lucide.createIcons(); }
    }
}


// --- 8. Main Boot Function ---

/**
 * Initializes the application creation/editing page.
 */
async function bootApplication() {
    console.log("[BOOT] Starting application_create.js boot sequence...");

    // 1. Initialize services (Auth/Firebase)
    try {
        await initializeServices();
        console.log(`[BOOT] Services initialized. User ID: ${currentUserId || appId}`);
    } catch (error) {
        showMessageBox(`Initialization failed. ${error.message}`, false);
        return;
    }

    // 2. Inject Navbar (navbar.js)
    injectNavbar();
    console.log("[BOOT] Navbar injected.");

    // 3. Look up all required DOM elements 
    const formElements = {
        submitBtn: document.getElementById('submitBtn'),
        formTitle: document.getElementById('formTitle'),
        dateApplied: document.getElementById('dateApplied'),
        companyNameInput: document.getElementById('companyName'),
        applicationForm: document.getElementById('applicationForm'),
        jobTitle: document.getElementById('jobTitle'),
        jobUrl: document.getElementById('jobUrl'),
        currentStatus: document.getElementById('currentStatus'),
    };
    
    const { submitBtn, formTitle, dateApplied, companyNameInput, applicationForm } = formElements;
    
    // 4. Parse URL and determine mode
    const params = getUrlParameters();
    activeCompanyId = params.companyId;
    isEditMode = params.mode === 'edit' && !!params.appId;
    companyNameClean = params.companyName; 

    if (isEditMode) {
        formTitle.textContent = 'Loading Application for Edit...';
        
        const success = await loadExistingApplication(params.appId);
        if (!success) {
            submitBtn.disabled = true;
        }
    } else {
        formTitle.textContent = 'Record New Application';
        // Set default date to today
        dateApplied.valueAsDate = new Date();
        submitBtn.disabled = false;
    }


    // 5. Load Company Details
    if (activeCompanyId) {
        updateCompanyDisplay(activeCompanyId, companyNameClean);
    } else {
        showMessageBox("Please select a company from the sidebar to create an application.", false);
        submitBtn.disabled = true;
        companyNameInput.value = "Select a company from the sidebar...";
    }

    // 6. Initialize Sidebar
    initSidebar({
        activeCompanyId: activeCompanyId,
        targetPage: 'application_create.html'
    });
    console.log("[BOOT] Sidebar initialized.");
    
    // 7. Setup Form Listeners
    applicationForm.addEventListener('submit', handleFormSubmit); 
    setupDocumentListeners(); 

    // 8. Initialize icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

document.addEventListener('DOMContentLoaded', bootApplication);
