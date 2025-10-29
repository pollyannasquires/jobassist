// FILENAME: application_create.js | Handles the two-step application creation and upload process
// FIXES APPLIED:  - DEPLOYMENT TAG
// 1. All URLs corrected.
// 2. Application creation payload requires 'current_status' and correct fields.
// 3. FINAL CRITICAL FIX: The file field name is 'document' and the type field is 'document_type_code' to match the live server's validation errors and API Reference.

const CREATE_APP_API = '/api/applications'; 
const UPLOAD_DOC_BASE_API = '/api/application'; 
const form = document.getElementById('newApplicationForm');
const submitBtn = document.getElementById('submitBtn');
const companyNameDisplay = document.getElementById('companyNameDisplay');
const statusMessage = document.getElementById('statusMessage');

let currentCompanyId = null;
let currentCompanyName = ''; // Variable to store the company name

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
    statusMessage.classList.add(type === 'error' ? 'bg-error' : 'bg-success');
    setTimeout(() => {
        statusMessage.classList.add('hidden');
    }, 5000);
}

// --- API Call Functions ---

/**
 * Step 1: Create the Application Record (POST /api/applications)
 */
async function createApplication(data) {
    const payload = {
        "company_name_clean": currentCompanyName, 
        "title_name": data.get('jobTitle'),
        "date_applied": data.get('dateApplied'),
        "current_status": "NEW" 
    };
    
    const response = await fetch(CREATE_APP_API, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(`Failed to create application record. Status: ${response.status}. Detail: ${errorBody.detail || errorBody.message || 'Unknown error.'}`);
    }

    const result = await response.json();
    
    if (result.application_id) {
        return result.application_id;
    }
    throw new Error('Application record created, but API did not return an application ID.');
}


/**
 * Step 2: Upload a single document file (POST /api/application/{id}/documents)
 */
async function uploadDocument(applicationId, file, documentType) {
    const formData = new FormData();
    
    // 1. The File (CRITICAL: 'document' per API Ref)
    formData.append('document', file);
    
    // 2. The Document Type (CRITICAL: 'document_type_code' per live server error)
    formData.append('document_type_code', documentType); 
    
    // NOTE: Only two fields are sent in the form data, as per documentation.

    const UPLOAD_URL = `${UPLOAD_DOC_BASE_API}/${applicationId}/documents`; 

    const response = await fetch(UPLOAD_URL, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        let message = `File upload failed for ${file.name} (${documentType}). Status: ${response.status}.`;
        
        if (response.status === 400) {
             const errorBody = await response.json().catch(() => ({ message: response.statusText }));
             message = `File upload failed. Status: 400 Bad Request. Detail: ${errorBody.message || errorBody.detail || 'Unknown validation error.'}`;
        } else if (response.status === 404) {
             message = `File upload endpoint not found (404). Backend route ${UPLOAD_URL} is likely still missing.`;
        }
        
        throw new Error(message);
    }
}


// --- Main Handler ---

async function handleSubmit(event) {
    event.preventDefault();
    
    let applicationId = null;

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading-animation w-5 h-5 mr-2"></span> Submitting...';
    showStatus('Starting application submission and file uploads...', 'success');

    try {
        const formData = new FormData(form);
        
        // 1. Create the Application Record
        applicationId = await createApplication(formData);
        showStatus('Application record created successfully. Starting file uploads...', 'success');

        // 2. Upload Documents
        const uploadPromises = [];
        
        const resumeInput = document.getElementById('resumeFile');
        const resumeFile = resumeInput ? resumeInput.files[0] : null; 
        if (resumeFile) {
            uploadPromises.push(uploadDocument(applicationId, resumeFile, 'RESUME'));
        }

        const jobDescInput = document.getElementById('jobDescFile');
        const jobDescFile = jobDescInput ? jobDescInput.files[0] : null;
        if (jobDescFile) {
            uploadPromises.push(uploadDocument(applicationId, jobDescFile, 'JOB_DESCRIPTION'));
        }

        const otherInput = document.getElementById('otherFiles');
        const otherFiles = otherInput ? otherInput.files : [];
        for (let i = 0; i < otherFiles.length; i++) {
             uploadPromises.push(uploadDocument(applicationId, otherFiles[i], 'OTHER')); 
        }

        await Promise.all(uploadPromises);

        showStatus('All files uploaded successfully! Redirecting...', 'success');
        
        // 3. Success: Redirect back to the review page
        setTimeout(() => {
            window.location.href = `application_review.html?companyId=${currentCompanyId}&companyName=${encodeURIComponent(currentCompanyName)}`;
        }, 1500);

    } catch (error) {
        console.error('Submission Failed:', error.message);
        
        if (applicationId) {
            showStatus(`Upload failed. Record created but documents are missing. Error: ${error.message}`, 'error');
        } else {
            showStatus(`Application creation failed. Error: ${error.message}`, 'error');
        }
        
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i data-lucide="save" class="w-5 h-5 mr-2"></i> Save Application & Upload Documents';
    } finally {
        lucide.createIcons();
    }
}

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
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
