// FILENAME: application_review.js | Handles application history viewing, document upload/download, and navigation

// --- API Endpoints ---
const APPLICATIONS_API_BASE = '/api/applications';
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

// Form elements specific to upload
const uploadFileElement = document.getElementById('documentFile');
const uploadTypeSelect = document.getElementById('documentTypeCode'); 

// --- Global State ---
let currentCompanyId = null;
let currentCompanyName = 'Loading...';
let currentApplicationIdForUpload = null; 

// --- Utility Functions ---

/**
 * Extracts companyId and companyName from the URL.
 */
function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    // Use parseInt with radix 10, but allow null/NaN if not found
    const companyId = params.get('companyId') ? parseInt(params.get('companyId'), 10) : null;
    return {
        companyId: companyId,
        companyName: params.get('companyName')
    };
}

/**
 * Renders the list of applications into the table.
 * @param {Array} applications - The list of application objects.
 */
function renderApplications(applications) {
    if (!applications || applications.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-gray-500 italic">No applications recorded yet for ${currentCompanyName}.</td></tr>`;
        return;
    }

    const html = applications.map(app => {
        // Safely access nested job title and provide a fallback
        const jobTitle = app.job_title_info?.title_name || 'N/A';
        const cleanDate = app.date_applied ? new Date(app.date_applied).toLocaleDateString('en-US') : 'N/A';

        // Documents handling (safely access and build link structure)
        const documentLinks = (app.documents || []).map(doc => `
            <button onclick="handleDocumentDownload('${doc.document_id}', '${doc.original_filename}')" 
                    class="text-xs text-primary hover:text-indigo-700 underline focus:outline-none block text-left"
                    title="Download ${doc.original_filename} (${doc.document_type})">
                ${doc.original_filename} 
                <span data-lucide="download" class="inline w-3 h-3 ml-1"></span>
            </button>
        `).join('');

        const documentUploadBtn = `
            <button onclick="openUploadModal('${app.application_id}', '${jobTitle}')" 
                    class="text-xs text-success hover:text-emerald-700 focus:outline-none font-medium">
                Upload New Document
                <span data-lucide="upload" class="inline w-3 h-3 ml-1"></span>
            </button>
        `;

        const statusClass = {
            'APPLIED': 'bg-blue-100 text-blue-800',
            'INTERVIEW': 'bg-yellow-100 text-yellow-800',
            'OFFER': 'bg-green-100 text-green-800',
            'REJECTED': 'bg-red-100 text-red-800',
            'CONTACTED': 'bg-purple-100 text-purple-800'
        }[app.current_status] || 'bg-gray-100 text-gray-800';


        return `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${cleanDate}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${jobTitle}</td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">
                        ${app.current_status || 'UNKNOWN'}
                    </span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-500 space-y-1">
                    ${documentLinks}
                    <hr class="border-gray-100 my-1">
                    ${documentUploadBtn}
                </td>
            </tr>
        `;
    }).join('');

    tableBody.innerHTML = html;
    // Re-create icons for the new dynamic content (download/upload icons)
    lucide.createIcons(); 
}

/**
 * Fetches applications for the current company.
 * @param {number} companyId - The ID of the company.
 */
async function fetchApplications(companyId) {
    statusMessage.textContent = 'Loading applications...';
    statusMessage.classList.remove('hidden', 'text-error', 'text-success');
    statusMessage.classList.add('text-gray-500');

    try {
        // Use Endpoint 11.0: GET /api/applications?company_id=<id>
        const response = await fetch(`${APPLICATIONS_API_BASE}?company_id=${companyId}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // FIX: Extract the nested 'applications' array from the structured response object
        const applications = data.applications;

        renderApplications(applications);
        
        // Clear status message on success
        statusMessage.classList.add('hidden');
        
    } catch (error) {
        console.error('Error fetching applications:', error);
        statusMessage.textContent = 'Failed to load application history.';
        statusMessage.classList.remove('text-gray-500', 'text-success');
        statusMessage.classList.add('text-error');
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-error">Could not retrieve applications. Please try again.</td></tr>`;
    }
}

// --- Document Modal Functions ---

/**
 * Sets the context for the upload modal and displays it.
 * @param {string} applicationId - The ID of the application to attach the document to.
 * @param {string} jobTitle - The title of the job for display in the modal.
 */
function openUploadModal(applicationId, jobTitle) {
    currentApplicationIdForUpload = applicationId;
    modalApplicationTitle.textContent = `Upload Document for: ${jobTitle}`;
    documentUploadModal.classList.remove('hidden');

    // Clear previous state
    uploadFileElement.value = '';
    uploadTypeSelect.value = ''; // Reset the select to the default placeholder
    document.getElementById('uploadStatusMessage').textContent = '';
    document.getElementById('uploadStatusMessage').classList.add('hidden');
    
}

/**
 * Hides the document upload modal.
 */
function closeUploadModal() {
    documentUploadModal.classList.add('hidden');
    currentApplicationIdForUpload = null;
    // Reset status/spinner
    uploadSpinner.classList.add('hidden');
    uploadBtnText.textContent = 'Upload Document';
    document.getElementById('submitUploadBtn').disabled = false;
}

/**
 * Handles the form submission for document upload.
 * @param {Event} event - The form submission event.
 */
async function handleDocumentUpload(event) {
    event.preventDefault();

    const uploadStatusMessage = document.getElementById('uploadStatusMessage');
    const submitBtn = document.getElementById('submitUploadBtn');

    // Basic validation
    if (!currentApplicationIdForUpload) {
        uploadStatusMessage.textContent = 'Error: Application ID context is missing.';
        uploadStatusMessage.classList.remove('hidden');
        return;
    }
    if (!uploadFileElement.files[0]) {
        uploadStatusMessage.textContent = 'Please select a file to upload.';
        uploadStatusMessage.classList.remove('hidden');
        return;
    }
    if (!uploadTypeSelect.value) {
        uploadStatusMessage.textContent = 'Please select a document type.';
        uploadStatusMessage.classList.remove('hidden');
        return;
    }

    // Prepare UI for loading state
    submitBtn.disabled = true;
    uploadBtnText.textContent = 'Uploading...';
    uploadSpinner.classList.remove('hidden');
    uploadStatusMessage.classList.add('hidden');

    const formData = new FormData();
    formData.append('file', uploadFileElement.files[0]);
    formData.append('document_type_code', uploadTypeSelect.value);

    // Endpoint 9.0: POST /api/application/<id>/documents
    const apiUrl = `${DOCUMENT_UPLOAD_API_BASE}/${currentApplicationIdForUpload}/documents`;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            body: formData,
            // Fetch will automatically set Content-Type: multipart/form-data with FormData
        });

        if (response.status === 400) {
             const errorData = await response.json();
             throw new Error(errorData.message || 'Invalid data provided for upload.');
        }

        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }
        
        // Success
        uploadStatusMessage.textContent = 'Document uploaded successfully!';
        uploadStatusMessage.classList.remove('hidden', 'text-error');
        uploadStatusMessage.classList.add('text-success', 'bg-green-50');

        // Refresh the applications list to show the new document
        if (currentCompanyId) {
            await fetchApplications(currentCompanyId);
        }

        // Close modal after a delay
        setTimeout(() => {
            closeUploadModal();
        }, 1500);

    } catch (error) {
        console.error('Upload failed:', error);
        uploadStatusMessage.textContent = `Upload failed: ${error.message}`;
        uploadStatusMessage.classList.remove('hidden', 'text-success');
        uploadStatusMessage.classList.add('text-error', 'bg-red-50');
        // Re-enable button on failure
        submitBtn.disabled = false;
        uploadBtnText.textContent = 'Upload Document';
        uploadSpinner.classList.add('hidden');
    }
}

/**
 * Handles the document download link click.
 * @param {string} documentId - The ID of the document to download.
 * @param {string} originalFilename - The original filename for saving the file locally.
 */
async function handleDocumentDownload(documentId, originalFilename) {
    statusMessage.textContent = `Preparing download for ${originalFilename}...`;
    statusMessage.classList.remove('hidden', 'text-error', 'text-success');
    statusMessage.classList.add('text-gray-500');

    // Endpoint 10.0: GET /api/document/<id>
    const apiUrl = `${DOCUMENT_DOWNLOAD_API_BASE}/${documentId}`;

    try {
        const response = await fetch(apiUrl);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const blob = await response.blob();
        
        // Create a temporary link element to trigger the download
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = originalFilename; 
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        statusMessage.textContent = `Download of ${originalFilename} complete!`;
        statusMessage.classList.remove('text-gray-500', 'text-error');
        statusMessage.classList.add('text-success');
        
        // Hide success message after a delay
        setTimeout(() => statusMessage.classList.add('hidden'), 3000);

    } catch (error) {
        console.error('Download failed:', error);
        statusMessage.textContent = `Download failed for ${originalFilename}.`;
        statusMessage.classList.remove('text-gray-500', 'text-success');
        statusMessage.classList.add('text-error');
    }
}

// --- Callback for Company Sidebar (Handles selection from the sidebar) ---

/**
 * Global function called by company_sidebar.js when a company is selected.
 * This function loads the application data for the selected company.
 * @param {number} companyId - The ID of the selected company.
 * @param {string} companyName - The name of the selected company.
 * @param {HTMLElement} linkElement - The list item element that was clicked (not strictly needed here).
 */
function onCompanySelect(companyId, companyName, linkElement) {
    // 1. Update Global State
    currentCompanyId = companyId;
    currentCompanyName = companyName;

    // 2. Update UI
    companyNameDisplay.textContent = currentCompanyName;
    document.getElementById('pageTitle').textContent = `Application Review: ${currentCompanyName} | JobAssist`;
    
    // Re-enable the 'Record New Application' button
    if (recordNewAppBtn) {
        recordNewAppBtn.style.display = 'inline-flex'; 
    }

    // 3. Fetch Data for the new company
    fetchApplications(currentCompanyId);

    // 4. Ensure the sidebar highlights the active company (function exposed by company_sidebar.js)
    // This allows the sidebar to dynamically mark the selected company as 'active'.
    if (typeof window.filterAndRenderCompanies === 'function') {
        window.filterAndRenderCompanies(companyId);
    }
}

// --- Initialization and Event Listeners ---

document.addEventListener('DOMContentLoaded', () => {
    // 1. Hook up modal listeners
    if (documentUploadForm) {
        documentUploadForm.addEventListener('submit', handleDocumentUpload);
    }
    // Hook up the close button and backdrop click
    document.getElementById('closeUploadModalBtn')?.addEventListener('click', closeUploadModal);
    documentUploadModal?.addEventListener('click', (event) => {
        if (event.target === documentUploadModal) {
            closeUploadModal();
        }
    });

    // 2. Load initial data based on URL parameters
    const params = getUrlParams();
    
    if (params.companyId) {
        currentCompanyId = params.companyId;
        
        if (params.companyName) {
             currentCompanyName = decodeURIComponent(params.companyName);
             companyNameDisplay.textContent = currentCompanyName;
             document.getElementById('pageTitle').textContent = `Application Review: ${currentCompanyName} | JobAssist`;
        }

        fetchApplications(currentCompanyId);
    } else {
        // FIX: Display a neutral instruction instead of an "Error" since the page includes the company sidebar
        companyNameDisplay.textContent = 'No Company Selected';
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-gray-500 italic">Select a company from the sidebar on the left to review applications.</td></tr>`;
        document.getElementById('pageTitle').textContent = `Application Review | JobAssist`; 
        
        if (recordNewAppBtn) {
            recordNewAppBtn.style.display = 'none'; // Keep hidden until a company is chosen
        }
    }
    
    // 3. Initialize icons
    lucide.createIcons();
});


// Expose functions globally for inline HTML handlers and the company sidebar
window.openUploadModal = openUploadModal;
window.closeUploadModal = closeUploadModal;
window.handleDocumentDownload = handleDocumentDownload;
window.onCompanySelect = onCompanySelect; // Expose the new callback for the sidebar
