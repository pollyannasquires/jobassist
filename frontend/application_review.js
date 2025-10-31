// FILENAME: application_review.js | Handles application history viewing, document upload/download, and navigation
// Incorporates fixes for API parsing, job title rendering, column ordering, and document upload payload fields.

// --- API Endpoints ---
const APPLICATIONS_API_BASE = '/api/applications'; // GET /api/applications?company_id=<id> (Endpoint 11.0)
const DOCUMENT_UPLOAD_API_BASE = '/api/application'; // For POST /api/application/<id>/documents (API 9.0)
const DOCUMENT_DOWNLOAD_API_BASE = '/api/document'; // For GET /api/document/<id> (API 10.0)

// --- DOM Elements ---
const tableBody = document.getElementById('applicationsTableBody');
const companyNameDisplay = document.getElementById('companyNameDisplay');
const recordNewAppBtn = document.getElementById('recordNewAppBtn');
const statusMessage = document.getElementById('statusMessage');
const documentUploadModal = document.getElementById('documentUploadModal');
const documentUploadForm = document.getElementById('documentUploadForm');
const modalApplicationTitle = document.getElementById('modalApplicationTitle');
const uploadBtnText = document.getElementById('uploadBtnText');
const uploadSpinner = document.getElementById('uploadSpinner');
const uploadStatusMessage = document.getElementById('uploadStatusMessage');

// Form elements specific to upload
const uploadFileElement = document.getElementById('documentFile');
const uploadTypeSelect = document.getElementById('documentTypeCode');

// --- Global State ---
let currentCompanyId = null;
let currentCompanyName = 'Loading...';
let currentApplicationIdForUpload = null;
let allApplications = []; // Store applications for dynamic updates

// --- Utility Functions for UI State ---

/**
 * Sets the loading state for the upload button (disabling it and showing a spinner).
 * @param {boolean} isLoading
 */
function setUploadLoading(isLoading) {
    const submitBtn = document.getElementById('submitUploadBtn');
    submitBtn.disabled = isLoading;
    if (isLoading) {
        uploadBtnText.textContent = 'Uploading...';
        uploadSpinner.classList.remove('hidden');
        uploadStatusMessage.classList.add('hidden');
    } else {
        uploadBtnText.textContent = 'Upload Document';
        uploadSpinner.classList.add('hidden');
    }
}

/**
 * Displays a status message in the upload modal.
 * @param {string} message - The message content.
 * @param {string} type - 'success' or 'error'.
 */
function setUploadStatus(message, type) {
    uploadStatusMessage.textContent = message;
    uploadStatusMessage.classList.remove('hidden', 'text-error', 'text-success', 'bg-red-50', 'bg-green-50');
    if (type === 'error') {
        uploadStatusMessage.classList.add('text-error', 'bg-red-50');
    } else {
        uploadStatusMessage.classList.add('text-success', 'bg-green-50');
    }
}

// --- Modal Control Functions (Exposed Globally) ---

/**
 * Opens the document upload modal and sets the context (application ID).
 * @param {string} applicationId - UUID of the application.
 * @param {string} applicationTitle - Title of the application (Job Title or status).
 */
function openUploadModal(applicationId, applicationTitle) {
    currentApplicationIdForUpload = applicationId;
    modalApplicationTitle.textContent = applicationTitle;
    documentUploadForm.reset(); // Reset form on open
    uploadStatusMessage.classList.add('hidden'); // Clear previous status
    setUploadLoading(false); // Reset button state

    documentUploadModal.classList.remove('hidden', 'opacity-0');
    documentUploadModal.classList.add('opacity-100');
    document.body.classList.add('overflow-hidden');
}

/**
 * Closes the document upload modal.
 */
function closeUploadModal() {
    documentUploadModal.classList.remove('opacity-100');
    documentUploadModal.classList.add('opacity-0');
    // Wait for transition before hiding completely
    setTimeout(() => {
        documentUploadModal.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
    }, 300);
}

// --- Upload Function (CRITICAL FIX) ---

/**
 * Handles the document upload form submission, sending multipart/form-data.
 * This function is updated to use the required field names: 'document' and 'document_type_code'.
 */
async function handleDocumentUpload(event) {
    event.preventDefault();
    setUploadStatus('', ''); // Clear previous status

    // 1. Validation
    if (!currentApplicationIdForUpload) {
        setUploadStatus('Upload Failed: Missing application context ID.', 'error');
        return;
    }
    if (uploadFileElement.files.length === 0) {
        setUploadStatus('Upload Failed: Please select a file to upload.', 'error');
        return;
    }
    if (!uploadTypeSelect.value) {
        setUploadStatus('Upload Failed: Please select a Document Type.', 'error');
        return;
    }

    // 2. UI State
    setUploadLoading(true);

    const formData = new FormData();
    
    // *** CRITICAL FIX 1: Use 'document' for the file content (as per Lessons Learned) ***
    formData.append('document', uploadFileElement.files[0]);

    // *** CRITICAL FIX 2: Use 'document_type_code' for the type (as per Lessons Learned) ***
    formData.append('document_type_code', uploadTypeSelect.value);

    // 3. API Call
    const uploadUrl = `${DOCUMENT_UPLOAD_API_BASE}/${currentApplicationIdForUpload}/documents`;

    try {
        const response = await fetch(uploadUrl, {
            method: 'POST',
            // IMPORTANT: Do NOT set Content-Type header when using FormData, 
            // the browser sets it automatically with the correct boundary.
            body: formData,
        });

        if (response.ok) {
            setUploadStatus('Document uploaded successfully! Please close this window to refresh the table.', 'success');
            // Clear the file selection field after success
            uploadFileElement.value = '';
            // Re-fetch applications to update the table in the background
            fetchApplications(currentCompanyId); 
        } else {
            const errorData = await response.json().catch(() => ({}));
            const message = errorData.message || `HTTP Error ${response.status}.`;
            setUploadStatus(`Upload Failed: ${message}`, 'error');
            console.error('Document upload failed:', errorData);
        }

    } catch (error) {
        setUploadStatus(`Upload Failed: Network or server error. ${error.message}`, 'error');
        console.error('Document upload error:', error);
    } finally {
        setUploadLoading(false);
    }
}


// --- Main Application Fetch and Render Logic ---

/**
 * Handles the document download link click.
 */
function handleDocumentDownload(documentId, originalFilename) {
    // Basic security check (though the backend should enforce auth/ownership)
    if (!documentId) {
        console.error('Missing document ID for download.');
        return;
    }

    const downloadUrl = `${DOCUMENT_DOWNLOAD_API_BASE}/${documentId}`;
    
    // NOTE: In a real environment, this should open in a new tab or trigger a download
    // For this context, we will simply navigate to the URL.
    window.location.href = downloadUrl;
}

/**
 * Formats a date string (YYYY-MM-DD) into a more readable format.
 * @param {string} dateString
 * @returns {string} Formatted date string or a default value.
 */
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    try {
        const [year, month, day] = dateString.split('-');
        return `${year}/${month}/${day}`;
    } catch (e) {
        return dateString; // Return original if parsing fails
    }
}

/**
 * Renders the list of applications into the table.
 * @param {Array} applications
 */
function renderApplications(applications) {
    if (!tableBody) return;

    if (!applications || applications.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-gray-500">No applications recorded yet for ${currentCompanyName}.</td></tr>`;
        return;
    }

    const rowsHtml = applications.map(app => {
        const cleanDate = formatDate(app.date_applied);
        
        // Fix: Use optional chaining to safely access nested job title and provide a fallback
        const jobTitle = app.job_title_info?.title_name || 'N/A';
        
        // Render documents attached to this application
        const documentsHtml = (app.documents || [])
            .map(doc => `
                <span class="inline-flex items-center text-xs font-medium bg-indigo-100 text-primary rounded-full px-2.5 py-0.5 mr-2 mb-1 cursor-pointer hover:bg-indigo-200 transition-colors"
                      onclick="handleDocumentDownload('${doc.document_id}', '${doc.original_filename}')">
                    <i data-lucide="file-text" class="w-3 h-3 mr-1"></i>
                    ${doc.original_filename} (${doc.document_type})
                </span>
            `).join('');


        return `
            <tr class="border-b hover:bg-gray-50 transition-colors">
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">${cleanDate}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${jobTitle}</td>
                <td class="px-6 py-4 text-sm font-semibold 
                    ${app.current_status === 'OFFER' ? 'text-success' : 
                      app.current_status === 'REJECTED' ? 'text-error' : 'text-primary'}">
                    ${app.current_status}
                </td>
                <td class="px-6 py-4 text-sm">
                    <div class="flex flex-wrap items-center">
                        ${documentsHtml}
                        <button class="text-primary hover:text-indigo-700 text-xs font-semibold px-2 py-1 rounded-full border border-primary/50 hover:border-indigo-700 transition-colors mt-1"
                                onclick="openUploadModal('${app.application_id}', '${jobTitle} on ${cleanDate}')">
                            <i data-lucide="upload-cloud" class="w-3 h-3 inline-block mr-1"></i>
                            Add Document
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    tableBody.innerHTML = rowsHtml;
    // Recreate icons after rendering new HTML content
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

/**
 * Fetches application data for the current company ID.
 * @param {number} companyId
 */
async function fetchApplications(companyId) {
    statusMessage.textContent = 'Loading applications...';
    statusMessage.classList.remove('hidden', 'text-error');

    if (!companyId) {
        statusMessage.textContent = 'Error: No Company ID specified.';
        statusMessage.classList.add('text-error');
        return;
    }

    const url = `${APPLICATIONS_API_BASE}?company_id=${companyId}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        // Fix: Correctly extract the nested array from the API response
        allApplications = data.applications || [];

        renderApplications(allApplications);
        
        // Hide status message on successful load
        statusMessage.classList.add('hidden');

    } catch (error) {
        console.error('Error fetching applications:', error);
        statusMessage.textContent = `Failed to load applications. ${error.message}`;
        statusMessage.classList.remove('hidden');
        statusMessage.classList.add('text-error');
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-error">Failed to load application data.</td></tr>`;
    }
}


// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
    // 1. Get Company ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const companyIdParam = urlParams.get('companyId');

    if (companyIdParam) {
        currentCompanyId = parseInt(companyIdParam, 10);
        
        // 2. Set Page Title and Display Name
        const companyNameParam = urlParams.get('companyName');
        if (companyNameParam) {
             currentCompanyName = decodeURIComponent(companyNameParam);
             companyNameDisplay.textContent = currentCompanyName;
             document.getElementById('pageTitle').textContent = `Application Review: ${currentCompanyName} | JobAssist`;
        } else {
             companyNameDisplay.textContent = `ID ${currentCompanyId}`;
        }

        // Bug Fix 5: Inform the sidebar component about the active company ID
        if (typeof window.setActiveCompanyIdAndRerender === 'function') {
            window.setActiveCompanyIdAndRerender(currentCompanyId);
        }

        // 3. Fetch data
        fetchApplications(currentCompanyId);

        // 4. Attach form submission handler
        documentUploadForm.addEventListener('submit', handleDocumentUpload);

    } else {
        // Error state handling
        companyNameDisplay.textContent = 'N/A';
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-error">Error: Missing Company ID in URL.</td></tr>`;
        document.getElementById('pageTitle').textContent = `Error | JobAssist`;

        if (recordNewAppBtn) {
            recordNewAppBtn.style.display = 'none';
        }
    }

    // 5. Initialize icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
});

// Expose functions globally for inline HTML handlers (e.g., onclick attributes)
window.openUploadModal = openUploadModal;
window.closeUploadModal = closeUploadModal;
window.handleDocumentDownload = handleDocumentDownload;

// Define the global callback function required by company_sidebar.js for navigation
window.onCompanySelect = (companyId, companyName, linkElement) => {
    // Navigate to the review page for the newly selected company
    window.location.href = `application_review.html?companyId=${companyId}&companyName=${encodeURIComponent(companyName)}`;
};
