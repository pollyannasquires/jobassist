// FILENAME: application_create.js | Handles the two-step application creation and upload process
// FIXES APPLIED: 
// 1. Removed redundant 'Content-Type' header setting, relying on the improved fetchWithGuard.
// 2. Confirmed payload structure based on successful cURL (title_name, company_name_clean, date_applied, company_id).
// 3. Consolidated document upload logic into reusable 'uploadDocument' function.

import { fetchWithGuard, initializeServices } from './core-utils.js';

const CREATE_APP_API = '/api/applications'; 
const UPLOAD_DOC_BASE_API = '/api/application'; 

// --- DOM Elements ---
const form = document.getElementById('newApplicationForm');
const submitBtn = document.getElementById('submitBtn');
const companyNameDisplay = document.getElementById('companyNameDisplay');
const statusMessage = document.getElementById('statusMessage');
const resumeFileElement = document.getElementById('resumeFile');
const coverLetterFileElement = document.getElementById('coverLetterFile');
const otherFilesElement = document.getElementById('otherFiles');

// --- Global State ---
let currentCompanyId = null;
let currentCompanyName = '';
let isAuthReady = false; 

// --- Utility Functions ---

function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        companyId: params.get('companyId'),
        companyName: params.get('companyName')
    };
}

function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.classList.remove('hidden', 'bg-error', 'bg-success');
    statusMessage.classList.add('opacity-0'); // Start transition
    statusMessage.classList.add(type === 'error' ? 'bg-error' : 'bg-success');
    
    // Animate in
    setTimeout(() => {
        statusMessage.classList.remove('opacity-0');
    }, 10);
    
    // Animate out
    setTimeout(() => {
        statusMessage.classList.add('opacity-0');
        statusMessage.addEventListener('transitionend', function handler() {
            statusMessage.classList.add('hidden');
            statusMessage.removeEventListener('transitionend', handler);
        });
    }, 5000);
}

/**
 * Step 1: Create the Application Record (POST /api/applications)
 * @param {FormData} applicationFormData - The data collected from the form.
 * @returns {Promise<string>} The ID of the newly created application.
 */
async function createApplicationRecord(applicationFormData) {
    const jobTitle = applicationFormData.get('jobTitle');
    const applicationDate = applicationFormData.get('applicationDate');
    const currentStatus = applicationFormData.get('currentStatus') || 'APPLIED'; 
    const jobLink = applicationFormData.get('jobLink') || ''; // Default to empty string

    if (!currentCompanyId || !currentCompanyName) {
        throw new Error("Missing Company context (ID or Name). Cannot create application.");
    }

    // Construct the payload with all required and contextual fields
    const payload = {
        // These fields strictly match the successful cURL request
        title_name: jobTitle,                               
        company_name_clean: currentCompanyName,             
        date_applied: applicationDate,                      
        current_status: currentStatus,                      
        // These fields are necessary context for the API
        company_id: currentCompanyId,                       
        job_link: jobLink,                                  
    };

    console.log("Application Creation Payload:", payload);
    
    // fetchWithGuard handles the JSON stringification and Content-Type header setting.
    const data = await fetchWithGuard(CREATE_APP_API, "Application Creation", {
        method: 'POST',
        body: payload, 
    });

    if (data && data.application_id) {
        return data.application_id;
    } else {
        throw new Error("Application record created, but 'application_id' was not returned in the success response.");
    }
}

/**
 * Step 2: Upload Documents (POST /api/application/<id>/documents)
 * @param {string} applicationId - The ID of the application.
 * @param {FileList} fileList - The FileList object.
 * @param {string} documentTypeCode - The code identifying the document type.
 */
async function uploadDocument(applicationId, fileList, documentTypeCode) {
    if (!fileList || fileList.length === 0) {
        return; 
    }

    // Iterate over files in the FileList (multiple files are only possible for 'otherFiles')
    for (const file of fileList) {
        const formData = new FormData();
        
        // API requirements for document upload
        formData.append('document', file); 
        formData.append('document_type_code', documentTypeCode);
        
        const url = `${UPLOAD_DOC_BASE_API}/${applicationId}/documents`;
        
        // fetchWithGuard detects FormData and correctly handles headers (i.e., avoids setting Content-Type: application/json)
        await fetchWithGuard(url, `Document Upload (${documentTypeCode})`, {
            method: 'POST',
            body: formData,
        });
    }
}

/**
 * Handles the main form submission.
 */
async function handleSubmit(e) {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 mr-2 animate-spin"></i> Creating Record...';
    lucide.createIcons();

    const applicationFormData = new FormData(form);
    let applicationId = null;

    try {
        // --- Step 1: Create Application Record ---
        applicationId = await createApplicationRecord(applicationFormData);
        
        showStatus('Application record created successfully. Starting document upload...', 'success');
        submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 mr-2 animate-spin"></i> Uploading Documents...';
        lucide.createIcons();


        // --- Step 2: Upload Documents ---
        // Use Promise.all to handle all uploads concurrently
        await Promise.all([
            uploadDocument(applicationId, resumeFileElement.files, 'RESUME'),
            uploadDocument(applicationId, coverLetterFileElement.files, 'COVER_LETTER'),
            uploadDocument(applicationId, otherFilesElement.files, 'OTHER_FILE')
        ]);
        
        
        // --- Final Success ---
        submitBtn.innerHTML = '<i data-lucide="check" class="w-5 h-5 mr-2"></i> Complete!';
        submitBtn.classList.remove('bg-primary', 'hover:bg-indigo-700');
        submitBtn.classList.add('bg-success', 'hover:bg-emerald-700');
        showStatus('Application and all documents uploaded successfully!', 'success');

        // Redirect to review page after a short delay
        setTimeout(() => {
            window.location.href = `application_review.html?companyId=${currentCompanyId}&companyName=${encodeURIComponent(currentCompanyName)}`;
        }, 1500);

    } catch (error) {
        console.error('Submission Failed:', error.message);
        
        if (applicationId) {
            // Record created, upload failed.
            showStatus(`Upload failed. Record created (ID: ${applicationId}), but documents are missing. Error: ${error.message}`, 'error');
        } else {
            // Record creation failed (likely the 400 error we are battling).
            showStatus(`Application creation failed. Error: ${error.message}`, 'error');
        }
        
        // Reset button state
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i data-lucide="save" class="w-5 h-5 mr-2"></i> Save Application & Upload Documents';
        submitBtn.classList.remove('bg-success', 'hover:bg-emerald-700');
        submitBtn.classList.add('bg-primary', 'hover:bg-indigo-700');
    } finally {
        lucide.createIcons();
    }
}

// --- Initialization ---

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Firebase/Auth for the fetchWithGuard utility
    await initializeServices(); 
    
    lucide.createIcons();
    const params = getUrlParams();
    
    if (params.companyId && params.companyName) {
        currentCompanyId = params.companyId;
        currentCompanyName = decodeURIComponent(params.companyName); 
        companyNameDisplay.textContent = currentCompanyName; 
        
        const companySubtitle = document.getElementById('companySubtitle');
        if (companySubtitle) {
            companySubtitle.textContent = `for: ${currentCompanyName}`; 
        }

        form.addEventListener('submit', handleSubmit);
    } else {
        companyNameDisplay.textContent = 'N/A';
        showStatus('Cannot record application: Company ID or Name is missing from the URL.', 'error');
        if (submitBtn) {
            submitBtn.disabled = true;
        }
    }
});