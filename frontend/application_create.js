// FILENAME: application_create.js | Handles the business logic for creating a new job application.

// --- 1. Imports ---
import { initializeServices, fetchWithGuard, currentUserId, appId } from './core-utils.js';
import { injectNavbar } from './navbar.js';
import { initSidebar } from './company_sidebar.js';

// --- 2. Configuration & API Endpoints ---
const API = {
    // API endpoint assumed from documentation for fetching a single company
    COMPANY_DETAILS: (companyId) => `/api/companies/${companyId}`,
    // API endpoint 10.0: Create new application
    CREATE_APPLICATION: '/api/applications',
    // API endpoint 11.0: Upload document - FIX: Endpoint must include application ID in path, per CURL example
    UPLOAD_DOCUMENT: (applicationId) => `/api/application/${applicationId}/documents`,
};

// --- 3. Global State ---
let activeCompanyId = null;
let companyNameClean = '';

// --- 4. Utility Functions ---

/**
 * Extracts the company_id from the browser's URL query parameters.
 * FIX: Checks for both 'company_id' (snake_case) and 'companyId' (camelCase) 
 * to handle inconsistencies from the sidebar/external links.
 * @returns {string|null} The company ID or null if not found.
 */
function getCompanyIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    // Check for standard snake_case first
    let id = urlParams.get('company_id');
    
    // Fallback: Check for camelCase (the required workaround)
    if (!id) {
        id = urlParams.get('companyId');
    }
    
    return id && id.length > 0 ? id : null;
}

/**
 * Displays a non-alert message box for user feedback.
 * @param {string} message - The message content.
 * @param {boolean} isSuccess - True for success (green), false for error (red).
 */
function showMessageBox(message, isSuccess) {
    const box = document.getElementById('messageBox');
    box.textContent = message;
    box.classList.remove('hidden', 'bg-red-100', 'text-red-800', 'bg-green-100', 'text-green-800');
    box.classList.add(isSuccess ? 'bg-green-100' : 'bg-red-100', isSuccess ? 'text-green-800' : 'text-red-800');
    // Scroll to the message box
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// --- 5. Core Application Logic ---

/**
 * Fetches company details using the provided ID and pre-populates the form.
 * @param {string} companyId - The ID of the company to load.
 */
async function loadCompanyDetails(companyId) {
    const companyNameInput = document.getElementById('companyName');
    const companyIdInput = document.getElementById('companyId');
    const displayCompanyIdSpan = document.getElementById('displayCompanyId');
    const submitBtn = document.getElementById('submitBtn');

    // Update display with ID
    displayCompanyIdSpan.textContent = companyId;

    try {
        companyNameInput.value = "Fetching details...";
        const data = await fetchWithGuard(
            API.COMPANY_DETAILS(companyId),
            'GET',
            'Load Company Details'
        );

        // --- FIX: Correctly handle the 'company' wrapper and look for 'company_name_clean' ---
        // The API returns { status: "success", company: { ... details ... } }
        const companyData = data?.company;
        
        // Prioritize the documented field name, then fall back to previous guesses
        const fetchedCompanyName = companyData?.company_name_clean || 
                                   companyData?.company_name || 
                                   companyData?.name || 
                                   companyData?.companyName;

        if (companyData && fetchedCompanyName) {
            companyNameClean = fetchedCompanyName;
            companyNameInput.value = companyNameClean;
            companyIdInput.value = companyId;
            submitBtn.disabled = false; // Enable form submission
            showMessageBox(`Company "${companyNameClean}" loaded successfully.`, true);
        } else {
            companyNameInput.value = "Error: Company not found or invalid data.";
            // If the key is still missing after checking alternatives, throw the error:
            throw new Error('Invalid company data received: Missing company name field (expected company.company_name_clean).');
        }

    } catch (error) {
        console.error("Failed to load company details:", error);
        companyNameInput.value = `Error: Failed to load company. ${error.message}`;
        showMessageBox(`Failed to load company details: ${error.message}`, false);
        // Ensure the button remains disabled on critical error
        submitBtn.disabled = true; 
    }
}

// --- 6. Document Upload Helpers ---

/**
 * Creates and appends a new document upload row to the container.
 * @param {string} defaultType - Optional default selection for document type.
 */
function addDocumentRow(defaultType = 'RESUME') {
    const container = document.getElementById('documentUploadContainer');
    const documentId = `doc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const html = `
        <div id="${documentId}" class="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4 p-4 border border-gray-100 rounded-lg bg-white shadow-sm">
            <div class="flex-grow">
                <label class="block text-xs font-medium text-gray-500 mb-1">File</label>
                <input type="file" required name="file" 
                       class="w-full text-sm text-gray-500 border border-gray-300 rounded-lg p-2 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-600 hover:file:bg-primary-100 transition duration-150">
            </div>
            <div class="w-full sm:w-48">
                <label class="block text-xs font-medium text-gray-700 mb-1">Document Type</label>
                <select name="document_type" required 
                        class="w-full p-3 border border-gray-300 rounded-lg text-sm focus:ring-primary-600 focus:border-primary-600 transition duration-150">
                    <option value="RESUME" ${defaultType === 'RESUME' ? 'selected' : ''}>RESUME</option>
                    <option value="COVER_LETTER" ${defaultType === 'COVER_LETTER' ? 'selected' : ''}>COVER LETTER</option>
                    <option value="OTHER" ${defaultType === 'OTHER' ? 'selected' : ''}>OTHER</option>
                </select>
            </div>
            <div class="flex items-end pt-5 sm:pt-0">
                <button type="button" data-doc-id="${documentId}" class="remove-doc-btn text-red-500 hover:text-red-700 transition duration-150 p-2 rounded-full hover:bg-red-50" aria-label="Remove Document">
                    <i data-lucide="trash-2" class="w-5 h-5"></i>
                </button>
            </div>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
    
    // Re-create icons for the new button
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

/**
 * Handles the click event for removing a document row.
 * @param {Event} event - The click event.
 */
function handleRemoveDocument(event) {
    const button = event.target.closest('.remove-doc-btn');
    if (button) {
        const docId = button.dataset.docId;
        const docRow = document.getElementById(docId);
        if (docRow) {
            docRow.remove();
        }
    }
}

/**
 * Attaches the document row listeners (add/remove).
 */
function setupDocumentListeners() {
    document.getElementById('addDocumentBtn').addEventListener('click', () => addDocumentRow('OTHER'));
    document.getElementById('documentUploadContainer').addEventListener('click', handleRemoveDocument);
    // Add an initial RESUME and COVER LETTER upload row
    addDocumentRow('RESUME');
    addDocumentRow('COVER_LETTER');
}

// --- 7. Submission Handlers ---

/**
 * Uploads all selected documents for the newly created application.
 * @param {string} applicationId - The ID of the newly created application.
 * @returns {Promise<number>} - The number of documents successfully uploaded.
 */
async function uploadDocuments(applicationId) {
    const documentRows = document.querySelectorAll('#documentUploadContainer > div');
    let successfulUploads = 0;
    let failedUploads = 0;

    // Use a Promise.all to handle uploads concurrently
    const uploadPromises = Array.from(documentRows).map(async (row) => {
        const fileInput = row.querySelector('input[type="file"]');
        const typeSelect = row.querySelector('select[name="document_type"]');

        if (fileInput.files.length === 0) {
            // Skip rows without a file selection
            return;
        }

        const file = fileInput.files[0];
        const documentType = typeSelect.value;
        const documentName = file.name;

        try {
            const formData = new FormData();
            
            // FIX 1: Use 'document' for the file field name, per CURL example
            formData.append('document', file, documentName);
            
            // FIX 2: Use 'document_type_code' for the type field name, per CURL example
            formData.append('document_type_code', documentType);
            
            // fetchWithGuard handles FormData correctly when 'Content-Type' is not set to 'application/json'
            await fetchWithGuard(
                // FIX 3: Use the dynamic URL with the applicationId
                API.UPLOAD_DOCUMENT(applicationId),
                'POST',
                `Upload Document: ${documentName}`,
                { body: formData, headers: {} } 
            );
            successfulUploads++;
        } catch (error) {
            console.error(`Failed to upload document ${documentName}:`, error);
            failedUploads++;
        }
    });

    await Promise.all(uploadPromises);
    return { successfulUploads, failedUploads };
}


/**
 * Handles the main form submission, creating the application first, then uploading documents.
 * @param {Event} event - The form submission event.
 */
async function handleFormSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const submitBtn = document.getElementById('submitBtn');
    
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i data-lucide="loader" class="w-5 h-5 mr-2 animate-spin"></i> Submitting...';
    showMessageBox("Creating application...", true);

    const formData = new FormData(form);
    
    // CRITICAL FIX: Include all required fields reported by the API error
    const applicationPayload = {
        company_name_clean: formData.get('company_name_clean'), 
        title_name: formData.get('title_name'),
        date_applied: formData.get('date_applied'),
        current_status: formData.get('current_status'),
        company_id: formData.get('company_id'),
    };

    // 1. Create the Application
    let applicationId = null;
    try {
        const appResponse = await fetchWithGuard(
            API.CREATE_APPLICATION,
            'POST',
            'Create New Application',
            { body: JSON.stringify(applicationPayload) }
        );

        applicationId = appResponse?.document_id || appResponse?.application_id;
        if (!applicationId) {
            throw new Error("Application creation failed: Missing application ID in response.");
        }
        
        showMessageBox(`Application created successfully (ID: ${applicationId}). Starting document uploads...`, true);

    } catch (error) {
        showMessageBox(`Application Creation Failed: ${error.message}`, false);
        console.error("Application Creation Failed:", error);
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i data-lucide="send" class="w-5 h-5 mr-2"></i> Submit Application';
        return;
    }

    // 2. Upload Documents
    try {
        const { successfulUploads, failedUploads } = await uploadDocuments(applicationId);
        
        let finalMessage = `Application and Documents submitted! ${successfulUploads} file(s) uploaded.`;
        if (failedUploads > 0) {
            finalMessage += ` WARNING: ${failedUploads} file(s) failed to upload.`;
            showMessageBox(finalMessage, false);
        } else {
            showMessageBox(finalMessage, true);
        }

        // Redirect to review page after successful submission
        setTimeout(() => {
            // FIX: Use URL-encoding on companyNameClean to prevent URL breaking if the name contains spaces or special characters.
            const urlEncodedName = encodeURIComponent(companyNameClean);
            window.location.href = `application_review.html?application_id=${applicationId}&company_id=${activeCompanyId}&companyName=${urlEncodedName}`;
        }, 1500);

    } catch (error) {
        // Log general upload error, specific file errors are logged inside uploadDocuments
        showMessageBox(`Document Upload Error: Could not complete all uploads.`, false);
        console.error("Overall Document Upload Error:", error);
    }
    
    // Re-enable and reset button state
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i data-lucide="send" class="w-5 h-5 mr-2"></i> Submit Application';
}


// --- 8. Bootstrapping Sequence ---

/**
 * Initializes all core services, UI components, and page-specific logic.
 */
async function bootApplication() {
    // 1. Initialize Firebase services and authenticate (core-utils.js)
    try {
        await initializeServices();
        console.log(`[BOOT] Services initialized. User ID: ${currentUserId}`);
    } catch (error) {
        console.error("[BOOT] Failed to initialize Firebase services:", error);
        showMessageBox(`Critical Error: Authentication failed. ${error.message}`, false);
        return;
    }

    // 2. Inject Navbar (navbar.js)
    injectNavbar();
    console.log("[BOOT] Navbar injected.");

    // 3. Parse URL and load company details
    activeCompanyId = getCompanyIdFromUrl();
    const submitBtn = document.getElementById('submitBtn');

    if (activeCompanyId) {
        // Set date applied to today's date by default
        document.getElementById('dateApplied').valueAsDate = new Date();
        // Load company details asynchronously
        await loadCompanyDetails(activeCompanyId);
    } else {
        // If no company ID is present, the user must select one from the sidebar
        showMessageBox("Please select a company from the sidebar to create an application.", false);
        submitBtn.disabled = true;
        // Pre-populate company name input with instruction
        document.getElementById('companyName').value = "Select a company from the sidebar...";
    }

    // 4. Initialize Sidebar (company_sidebar.js)
    initSidebar({
        activeCompanyId: activeCompanyId,
        targetPage: 'application_create.html' // Ensures links in the sidebar navigate back to this page
    });
    console.log("[BOOT] Sidebar initialized.");
    
    // 5. Setup Form Listeners
    document.getElementById('applicationForm').addEventListener('submit', handleFormSubmit);
    setupDocumentListeners();
}

// Call the main boot sequence on page load
document.addEventListener('DOMContentLoaded', bootApplication);