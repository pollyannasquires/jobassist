// FILENAME: application_review.js | Handles application history viewing, document upload/download, and now imports the Company Sidebar.

// CRITICAL FIX: Import core utilities and firebase dependencies directly for use in this module
import { fetchWithGuard, initializeServices, currentUserId, appId, db, isAuthReady } from './core-utils.js'; 
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"; 
// IMPORT NEW REUSABLE SIDEBAR MODULE
import { initSidebar } from './company_sidebar.js';


// --- API Endpoints ---
const APPLICATIONS_API_BASE = '/api/applications'; // GET /api/applications?company_id=<id> (Endpoint 11.0)
const DOCUMENT_UPLOAD_API_BASE = '/api/application'; // For POST /api/application/<id>/documents (API 9.0)
const DOCUMENT_DOWNLOAD_API_BASE = '/api/document'; // For GET /api/document/<id> (API 10.0)

// --- ENUMERATED TYPES (Document Types) ---
const DOCUMENT_TYPES = [
    { code: 'RESUME', name: 'Résumé/CV' },
    { code: 'COVER_LETTER', name: 'Cover Letter' },
    { code: 'OTHER', name: 'Other Document (Transcript, Portfolio, etc.)' }
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


// --- Main Content DOM Elements ---
const tableBody = document.getElementById('applicationsTableBody');
const companyNameDisplay = document.getElementById('companyNameDisplay');
const recordNewAppBtn = document.getElementById('recordNewAppBtn');
const statusMessage = document.getElementById('statusMessage');

// Modal Elements
const documentUploadModal = document.getElementById('documentUploadModal');
const documentUploadForm = document.getElementById('documentUploadForm');
const modalApplicationTitle = document.getElementById('modalApplicationTitle'); 
const modalApplicationId = document.getElementById('modalApplicationId');
const docTypeSelect = document.getElementById('documentType');
const fileInput = document.getElementById('documentFile');
const uploadStatusMessage = document.getElementById('uploadStatusMessage');

// --- Global State ---
let currentCompanyId = null;


// ---------------------------------------------------------------------
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
            <!-- Changed 'block' to 'flex items-center' to ensure tighter control over vertical spacing and better icon alignment -->
            <a href="${DOCUMENT_DOWNLOAD_API_BASE}/${doc.file_path}"
               download="${docName}"
               class="flex items-center text-sm text-indigo-600 hover:text-indigo-800 hover:underline transition duration-150 truncate leading-tight"
               title="Download ${docName}">
               <span class="inline-block w-3 h-3 mr-1" data-lucide="${icon}"></span>
               <span class="truncate">${docName}</span>
            </a>
        `;
    }).join('');

    // Add the "Upload New Document" button
    linksHtml += `
        <!-- Reduced vertical margin from 'mt-1' to 'mt-0.5' for tighter packing -->
        <button type="button" 
            onclick="openUploadModal('${applicationId}', '${applicationId.substring(0, 8)}...')"
            class="mt-0.5 text-xs font-medium text-emerald-600 hover:text-emerald-800 flex items-center transition duration-150">
            <span class="inline-block w-3 h-3 mr-1" data-lucide="upload"></span>
            Upload Document
        </button>
    `;

    // The container uses a plain div to avoid adding external spacing
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
        
        // Format the Date Applied
        const dateApplied = new Date(app.date_applied).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });

        // Generate the document links column
        const documentCellHtml = renderDocumentLinks(documents, app.application_id);

        return `
            <tr class="hover:bg-gray-50 transition duration-100">
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <div class="font-medium">${dateApplied}</div>
                    <div class="text-xs text-gray-400" title="Application ID">${app.application_id.substring(0, 8)}...</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    ${app.job_title_info?.title_name || 'N/A Job Title'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    ${formatStatus(app.current_status)}
                </td>
                <!-- Added 'whitespace-normal' here to ensure the cell content wraps if necessary, and it receives the document links -->
                <td class="px-6 py-4 whitespace-normal text-sm text-gray-500">
                    ${documentCellHtml}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                    <a href="#" class="text-indigo-600 hover:text-indigo-900 transition duration-150">Edit</a>
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
 * This function must be exported/globally accessible as it is called by the sidebar navigation.
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

    // Ensure the Record New Application button is visible
    if (recordNewAppBtn) {
        recordNewAppBtn.style.display = 'block';
    }

    try {
        // API 11.0: GET /api/applications?company_id=<id>
        const apiUrl = `${APPLICATIONS_API_BASE}?company_id=${companyId}`;
        const data = await fetchWithGuard(apiUrl, 'GET', 'fetch applications'); 
        
        renderApplicationTable(data.applications);

    } catch (error) {
        console.error("Failed to fetch applications:", error);
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-error">Error loading applications: ${error.message}.</td></tr>`;
    }
}


// --- Document Upload Modal Functions ---

/**
 * Opens the document upload modal and sets the context.
 */
function openUploadModal(applicationId, displayId) {
    if (!documentUploadModal || !modalApplicationTitle || !modalApplicationId || !docTypeSelect || !uploadStatusMessage) {
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
 * Handles the form submission for document upload.
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
        const formData = new FormData();
        formData.append('document', file);
        formData.append('document_type_code', documentType); 

        // API 9.0: POST /api/application/<id>/documents
        const apiUrl = `${DOCUMENT_UPLOAD_API_BASE}/${applicationId}/documents`;
        
        // Use standard fetch for FormData upload (CRITICAL: DO NOT use fetchWithGuard or set Content-Type)
        const response = await fetch(apiUrl, {
            method: 'POST',
            body: formData, 
        });

        const data = await response.json();

        if (!response.ok) {
             throw new Error(data.message || `API Error (${response.status}): Document upload failed.`);
        }

        uploadStatusMessage.textContent = `Upload successful! Document ID: ${data.document_id}`;
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
    
    // 1. Attach main button listeners
    if (recordNewAppBtn) {
        recordNewAppBtn.addEventListener('click', handleRecordNewApplication);
    }
    if (documentUploadForm) {
        documentUploadForm.addEventListener('submit', handleDocumentUpload);
    }
    
    // 2. Check URL parameters for the currently selected company
    const urlParams = new URLSearchParams(window.location.search);
    const companyId = urlParams.get('companyId');
    const companyName = urlParams.get('companyName');
    
    // 3. Initialize the REUSABLE SIDEBAR
    // This is the key integration point!
    initSidebar({ 
        activeCompanyId: companyId,
        targetPage: 'application_review.html' // Tell the sidebar where to navigate
    });

    // 4. If a company is selected, load its applications
    if (companyId && companyName) {
        // Fetch and render applications for the selected company
        fetchApplications(companyId, decodeURIComponent(companyName));
    } else {
        // Error state: Missing company context. 
        companyNameDisplay.textContent = 'N/A';
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-error">Error: Missing Company ID in URL. Please select a company from the sidebar to view history.</td></tr>`;
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
// fetchApplications must be exposed so the sidebar can trigger it when a company is clicked.
window.openUploadModal = openUploadModal;
window.closeUploadModal = closeUploadModal;
window.handleRecordNewApplication = handleRecordNewApplication; 
window.fetchApplications = fetchApplications;