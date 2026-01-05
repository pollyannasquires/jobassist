// FILENAME: application_review.js | FIX: Changing DELETE API path to plural to match working cURL.

// CRITICAL FIX: Import core utilities and firebase dependencies directly for use in this module
import { fetchWithGuard, initializeServices, currentUserId, appId, db, isAuthReady } from './core-utils.js'; 
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"; 
// IMPORT NEW REUSABLE SIDEBAR MODULE
import { initSidebar } from './company_sidebar.js';


// --- API Endpoints ---
const APPLICATIONS_API_BASE = '/api/applications'; // GET /api/applications?company_id=<id> (Endpoint 11.0)
const DOCUMENT_UPLOAD_API_BASE = '/api/application'; // For POST /api/application/<id>/documents (API 9.0)
const DOCUMENT_DOWNLOAD_API_BASE = '/api/documents'; // For GET /api/document/<id> (API 10.0)
// API 8.0: DELETE /api/application/<id>
// CRITICAL FIX: Changed from /api/application/ to /api/applications/ to match successful CURL
const APPLICATION_DELETE_API = (id) => `/api/applications/${id}`; 


// --- ENUMERATED TYPES (Document Types) ---
const DOCUMENT_TYPES = [
    { code: 'RESUME', name: 'Résumé/CV' },
    { code: 'COVER_LETTER', name: 'Cover Letter' },
    { code: 'OTHER', code: 'OTHER', name: 'Other Document (Transcript, Portfolio, etc.)' } // FIX: Ensure 'code' is repeated
];

// --- Status to styling mapping ---
const STATUS_MAP = {
    'NEW': { text: 'New', class: 'bg-blue-100 text-blue-800' },
    'APPLIED': { text: 'Applied', class: 'bg-indigo-100 text-indigo-800' },
    'INTERVIEWING': { text: 'Interviewing', class: 'bg-purple-100 text-purple-800' },
    'OFFER': { text: 'Offer Received', class: 'bg-success text-emerald-800' },
    'REJECTED': { text: 'Rejected', class: 'bg-red-100 text-red-800' },
    'WITHDRAWN': { text: 'Withdrawn', class: 'bg-gray-100 text-gray-800' },
};


// --- Global State & Element Declarations (Initialized to null) ---
let tableBody = null;
let companyNameDisplay = null;
let recordNewAppBtn = null;
let statusMessage = null;

// Modal Elements
let documentUploadModal = null;
let documentUploadForm = null;
let modalApplicationTitle = null; 
let modalApplicationId = null;
let docTypeSelect = null;
let fileInput = null;
let uploadStatusMessage = null;

// --- Global State ---
let currentCompanyId = null;


// Upload File code from application_create.js will be adapted here
/**
 * Uploads a single file and its type to the API endpoint (Core Logic).
 * This is adapted from application_create.js's uploadSingleDocument.
 * @param {string} appId - The ID of the application.
 * @param {File} file - The file object to upload.
 * @param {string} type - The document type string (e.g., 'RESUME').
 */
async function uploadModalFile(appId, file, type) {
    // API 9.0: POST /api/application/<id>/documents
    const apiUrl = `${DOCUMENT_UPLOAD_API_BASE}/${appId}/documents`;
    const fileName = file.name;
    const operationName = `uploading file ${fileName} for application ${appId.substring(0, 8)}`;
    
    // Authorization header logic from handleDocumentUpload
    const authHeader = `Bearer ${window.__initial_auth_token || currentUserId || appId || 'dummy-token'}`;

    try {
        const formData = new FormData();
        // NOTE: Using 'file' and 'document_type' keys as successfully used in the modal context
        formData.append('file', file);
        formData.append('document_type', type); 

        console.log(`[MODAL UPLOAD] Starting upload for ${fileName} using file key 'file' and type key 'document_type'...`);

        const response = await fetch(apiUrl, {
            method: 'POST',
            body: formData, 
            headers: {
                'Authorization': authHeader
            }
        });

        if (!response.ok) {
            // Implement the robust error collection logic from application_create.js
            const errorData = await response.json().catch(() => ({ message: response.statusText, detail: 'Response body was not valid JSON or was empty.' }));
            console.error(`[MODAL UPLOAD] Detailed Server Error for ${fileName}:`, errorData);

            const serverMessage = errorData?.message || errorData?.detail || response.statusText;
            throw new Error(`API Error (${response.status}): ${operationName} failed. Server says: ${serverMessage}`);
        }
        
        console.log(`[MODAL UPLOAD] Success: File ${fileName} uploaded successfully. Status: ${response.status}`);
        return true; 

    } catch (error) {
        console.error(`[MODAL UPLOAD] ${operationName} failed:`, error);
        throw error; // Re-throw to be caught by the outer function
    }
}
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

//--
// --//----------------------------------------------------------------------
// --- MAIN APPLICATION REVIEW LOGIC -----------------------------------
// ---------------------------------------------------------------------

/**
 * Helper function to format the application status for display.
 */
function formatStatus(status) {
    const map = STATUS_MAP[status] || { text: status, class: 'bg-gray-200 text-gray-800' };
    return `<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${map.class}">
                ${map.text}
            </span>`;
}


/**
 * Renders the list of documents and the upload link for a single application.
 */
function renderDocumentLinks(documents, applicationId) {
    let linksHtml = documents.map(doc => {
        const docName = doc.original_filename || 'Document File';
        const icon = doc.document_type === 'RESUME' ? 'file-text' : doc.document_type === 'COVER_LETTER' ? 'mail' : 'file';

        // Use direct link to API endpoint with file_path and 'download' attribute
        return `
            <a href="${DOCUMENT_DOWNLOAD_API_BASE}/${doc.file_path}"
               download="${docName}"
               target="_blank"
               class="flex items-center text-sm text-indigo-600 hover:text-indigo-800 hover:underline transition duration-150 truncate leading-tight"
               title="Download ${docName}">
               <span class="inline-block w-3 h-3 mr-1" data-lucide="${icon}"></span>
               <span class="truncate">${docName}</span>
            </a>
        `;
    }).join('');

    // Add the "Upload New Document" button
    linksHtml += `
        <button type="button" 
            data-action="upload"
            data-id="${applicationId}"
            class="mt-0.5 text-xs font-medium text-emerald-600 hover:text-emerald-800 flex items-center transition duration-150">
            <span class="inline-block w-3 h-3 mr-1" data-lucide="upload"></span>
            Upload Document
        </button>
    `;

    return `<div>${linksHtml}</div>`; 
}


/**
 * Renders the application history table rows.
 */
function renderApplicationTable(applications) {
    if (!tableBody) return;

    if (!applications || applications.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-gray-500">No applications recorded for this company.</td></tr>`;
        return;
    }

    const rowsHtml = applications.map(app => {
        const documents = app.documents || [];
        
        // Extract company/job info for action buttons
        const companyIdForButtons = app.company_info?.company_id || currentCompanyId;
        const companyNameForButtons = app.company_info?.company_name_clean || companyNameDisplay.textContent;
        const applicationId = app.application_id;

        // Format the Date Applied
        const dateApplied = new Date(app.date_applied).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });

        // Generate the document links column
        const documentCellHtml = renderDocumentLinks(documents, applicationId);

        return `
            <tr class="hover:bg-gray-50 transition duration-100">
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <div class="font-medium">${dateApplied}</div>
                    <div class="text-xs text-gray-400" title="Application ID">${applicationId.substring(0, 8)}...</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    ${app.job_title_info?.title_name || 'N/A Job Title'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    ${formatStatus(app.current_status)}
                </td>
                <td class="px-6 py-4 whitespace-normal text-sm text-gray-500">
                    ${documentCellHtml}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div class="flex flex-col space-y-1 items-end">
                        <button type="button" 
                            data-action="edit" 
                            data-id="${applicationId}"
                            data-company-id="${companyIdForButtons}"
                            data-company-name="${companyNameForButtons}"
                            class="text-indigo-600 hover:text-indigo-900 transition duration-150 flex items-center">
                            <i data-lucide="pencil" class="w-4 h-4 mr-1"></i> Edit
                        </button>
                        <button type="button" 
                            data-action="delete" 
                            data-id="${applicationId}"
                            class="text-red-600 hover:text-red-900 transition duration-150 flex items-center">
                            <i data-lucide="trash-2" class="w-4 h-4 mr-1"></i> Delete
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    tableBody.innerHTML = rowsHtml;
    // Re-initialize Lucide icons for dynamically added content
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}


/**
 * Fetches application history for a specific company and renders the table.
 */
export async function fetchApplications(companyId, companyName) {
    if (!companyNameDisplay || !tableBody) return;

    currentCompanyId = companyId; // Set current company ID state
    companyNameDisplay.textContent = companyName;
    document.getElementById('pageTitle').textContent = `${companyName} Applications | JobAssist`;
    
    // Clear previous results and show loading indicator
    tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-indigo-400">
        <div class="flex justify-center items-center">
            <div class="animate-spin w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full mr-3"></div>
            <span>Loading applications...</span>
        </div>
    </td></tr>`;

    if (recordNewAppBtn) {
        recordNewAppBtn.style.display = 'block';
    }

    try {
        const apiUrl = `${APPLICATIONS_API_BASE}?company_id=${companyId}`;
        // Use fetchWithGuard for GET requests as it handles retries and auth well
        const data = await fetchWithGuard(apiUrl, 'GET', 'fetch applications'); 
        
        renderApplicationTable(data.applications);

    } catch (error) {
        console.error("Failed to fetch applications:", error);
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-error">Error loading applications: ${error.message}.</td></tr>`;
    }
}


// --- Action Handlers ---

/**
 * Handles the click on Edit, Delete, or inline Upload buttons via event delegation.
 */
async function handleApplicationAction(event) {
    const target = event.target.closest('button');
    if (!target) return;

    const action = target.getAttribute('data-action');
    const id = target.getAttribute('data-id');

    if (!id) {
        console.error('Action button missing application ID.');
        return;
    }

    const companyName = companyNameDisplay.textContent;

    switch (action) {
        case 'edit':
            // 1. EDIT: Redirect to application_create.html in edit mode
            const companyId = target.getAttribute('data-company-id');
            const companyNameForEdit = target.getAttribute('data-company-name');
            window.location.href = `application_create.html?mode=edit&appId=${id}&companyId=${companyId}&companyName=${encodeURIComponent(companyNameForEdit)}`;
            break;

        case 'delete':
            // 2. DELETE: Prompt and call API 8.0 DELETE
            if (confirm(`Are you sure you want to permanently delete application ${id.substring(0, 8)}...?`)) {
                
                // CRITICAL FIX: Use the updated, plural API path: /api/applications/{id}
                const apiUrl = APPLICATION_DELETE_API(id);
                // We use standard fetch with Authorization header.
                const authHeader = `Bearer ${window.__initial_auth_token || currentUserId || appId || 'dummy-token'}`;

                try {
                    console.log(`[API] Attempt 1/1: DELETE ${apiUrl}`);
                    const response = await fetch(apiUrl, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': authHeader,
                            'Content-Type': 'application/json', // Required by API, though response may not be JSON on error
                        },
                    });

                    // Parse body only if present and attempt JSON
                    let data = {};
                    try {
                        data = await response.json();
                    } catch (e) {
                        // Ignore JSON parsing errors if body is empty or non-JSON (e.g., 204 No Content or HTML 404 page)
                    }

                    if (!response.ok) {
                        const errorMsg = data.message 
                            ? `Server Error: ${data.message}` 
                            : `HTTP Error (${response.status}): Application may not exist or access denied.`;
                        throw new Error(errorMsg);
                    }

                    alert(data.message || 'Application deleted successfully.');
                    // Refresh the table to show the change
                    fetchApplications(currentCompanyId, companyName);

                } catch (error) {
                    alert(`Failed to delete application: ${error.message}`);
                    console.error("Delete failed:", error);
                }
            }
            break;

        case 'upload':
            // 3. UPLOAD: Open modal with context
            const displayId = id.substring(0, 8) + '...';
            openUploadModal(id, displayId);
            break;
    }
}


// --- Document Upload Modal Functions (Kept from last version) ---

/**
 * Opens the document upload modal and sets the context.
 */
function openUploadModal(applicationId, displayId) {
    // Safety check: ensure modal DOM elements are loaded
    if (!documentUploadModal || !documentUploadForm || !modalApplicationTitle || !docTypeSelect || !uploadStatusMessage) {
        console.error("Modal elements are missing. Cannot open upload modal.");
        return; 
    }
    
    // Set the application context in the modal
    modalApplicationTitle.textContent = `Upload Document for App ${displayId}`;
    modalApplicationId.value = applicationId; // Store ID in a hidden input
    
    // Clear previous state and populate document types
    documentUploadForm.reset(); 
    uploadStatusMessage.textContent = '';
    uploadStatusMessage.classList.add('hidden');

    // Populate the document type dropdown (if not already populated or reset)
    if (docTypeSelect.options.length === 0 || docTypeSelect.options[0].value === "") {
        docTypeSelect.innerHTML = DOCUMENT_TYPES.map(type => 
            `<option value="${type.code}">${type.name}</option>`
        ).join('');
    }

    // Show modal
    documentUploadModal.classList.remove('opacity-0', 'pointer-events-none');
    documentUploadModal.querySelector('.max-w-lg').classList.remove('translate-y-4'); // Trigger transition

    // Initialize icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

/**
 * Closes the document upload modal.
 */
function closeUploadModal() {
    if (!documentUploadModal) return;
    
    // Hide modal with transition effects
    documentUploadModal.querySelector('.max-w-lg').classList.add('translate-y-4');
    documentUploadModal.classList.add('opacity-0');
    
    setTimeout(() => {
        documentUploadModal.classList.add('pointer-events-none');
    }, 300); 
}



/**
 * Handles the form submission for document upload. - now with code from application_create.js
 */
async function handleDocumentUpload(event) {
    event.preventDefault(); 
    
    const applicationId = modalApplicationId.value;
    const documentType = docTypeSelect.value;
    const file = fileInput.files[0];

    if (!applicationId || !documentType || !file) {
        uploadStatusMessage.textContent = 'ERROR: Please select a document type and a file before uploading.';
        uploadStatusMessage.classList.remove('hidden', 'text-indigo-600', 'text-success');
        uploadStatusMessage.classList.add('text-error', 'p-2', 'bg-red-50', 'font-bold'); 
        return;
    }

    uploadStatusMessage.textContent = 'Uploading...';
    uploadStatusMessage.classList.remove('hidden', 'text-error', 'text-success', 'p-2', 'bg-red-50', 'font-bold');
    document.getElementById('uploadSubmitBtn').disabled = true;

    try {
        // --- CORE LOGIC REPLACED: Call the new, consolidated function ---
        await uploadModalFile(applicationId, file, documentType);
        // --- END CORE LOGIC REPLACEMENT ---

        uploadStatusMessage.textContent = `Upload successful! Document uploaded.`;
        uploadStatusMessage.classList.remove('text-indigo-600', 'text-error');
        uploadStatusMessage.classList.add('text-success', 'p-2', 'bg-green-50');
        
        setTimeout(() => {
            closeUploadModal();
            // Refresh the application list
            const companyName = companyNameDisplay.textContent;
            if(currentCompanyId) {
                fetchApplications(currentCompanyId, companyName);
            }
        }, 1500);

    } catch (error) {
        console.error("Document upload failed:", error);
        // The error will contain the detailed server message from uploadModalFile
        uploadStatusMessage.textContent = `Upload failed: ${error.message}`;
        uploadStatusMessage.classList.remove('text-indigo-600', 'text-success');
        uploadStatusMessage.classList.add('text-error', 'p-2', 'bg-red-50', 'font-bold');
    } finally {
        document.getElementById('uploadSubmitBtn').disabled = false;
    }
}

/**
 * Handles the click on the "Record New Application" button.
 */
function handleRecordNewApplication(event) {
    if (event) {
        event.preventDefault(); 
    }

    if (!currentCompanyId) {
        // Show error message if no company is selected
        statusMessage.textContent = 'Please select a company from the sidebar first to record an application.';
        statusMessage.className = 'p-4 rounded-lg text-sm mb-4 bg-red-100 text-red-800 block';
        setTimeout(() => statusMessage.classList.add('hidden'), 5000);
        return;
    }

    // Get the full company name from the display element
    const companyName = companyNameDisplay.textContent;

    // Construct the URL and navigate to the creation page, passing context in the URL
    const newUrl = `application_create.html?companyId=${currentCompanyId}&companyName=${encodeURIComponent(companyName)}`;
    window.location.href = newUrl;
}


// ---------------------------------------------------------------------
// --- INITIALIZATION --------------------------------------------------
// ---------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    // 0. Initialize services (Firebase/Auth)
    await initializeServices();
    
    // CRITICAL FIX: Assign DOM elements here where they are guaranteed to exist.
    tableBody = document.getElementById('applicationsTableBody');
    companyNameDisplay = document.getElementById('companyNameDisplay');
    recordNewAppBtn = document.getElementById('recordNewAppBtn');
    statusMessage = document.getElementById('statusMessage');

    documentUploadModal = document.getElementById('documentUploadModal');
    documentUploadForm = document.getElementById('documentUploadForm');
    modalApplicationTitle = document.getElementById('modalApplicationTitle'); 
    modalApplicationId = document.getElementById('modalApplicationId');
    docTypeSelect = document.getElementById('documentType');
    fileInput = document.getElementById('documentFile');
    uploadStatusMessage = document.getElementById('uploadStatusMessage');

    // 1. Attach main button listeners
    if (recordNewAppBtn) {
        recordNewAppBtn.addEventListener('click', handleRecordNewApplication);
    }
    if (documentUploadForm) {
        documentUploadForm.addEventListener('submit', handleDocumentUpload);
    }
    // CRITICAL FIX: Attach event delegation listener to the table body for Edit/Delete/Upload actions
    if (tableBody) {
        tableBody.addEventListener('click', handleApplicationAction);
    }
    
    // 2. Check URL parameters for the currently selected company
    const urlParams = new URLSearchParams(window.location.search);
    const companyId = urlParams.get('companyId');
    const companyName = urlParams.get('companyName');
    
    // 3. Initialize the REUSABLE SIDEBAR
    initSidebar({ 
        activeCompanyId: companyId,
        targetPage: 'application_review.html' // Tell the sidebar where to navigate
    });

    // 4. If a company is selected, load its applications
    if (companyId && companyName) {
        fetchApplications(companyId, decodeURIComponent(companyName));
    } else {
        // Error state: Missing company context. 
        if (companyNameDisplay) { companyNameDisplay.textContent = 'N/A'; }
        if (tableBody) {
             tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-error">Error: Missing Company ID in URL. Please select a company from the sidebar to view history.</td></tr>`;
        }
        document.getElementById('pageTitle').textContent = `Select Company | JobAssist`;

        if (recordNewAppBtn) {
            recordNewAppBtn.style.display = 'none';
        }
    }

    // 5. Initialize icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
});


// --- Expose functions globally for inline HTML handlers ---
window.openUploadModal = openUploadModal;
window.closeUploadModal = closeUploadModal;
window.handleRecordNewApplication = handleRecordNewApplication; 
window.fetchApplications = fetchApplications;