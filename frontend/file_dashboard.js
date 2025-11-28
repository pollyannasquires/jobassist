import { injectNavbar } from './navbar.js';
import { renderSidebar } from './dashboard_sidebar.js';

let documentData = [];
let currentSort = { column: 'upload_timestamp', direction: 'desc' };

// --- HELPER FUNCTIONS ---

const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
};

const getFileIcon = (filename) => {
    const ext = filename ? filename.split('.').pop().toLowerCase() : '';
    if (ext === 'pdf') return `<i data-lucide="file-text" class="w-5 h-5 text-red-500"></i>`;
    if (['doc', 'docx'].includes(ext)) return `<i data-lucide="file-type" class="w-5 h-5 text-blue-500"></i>`;
    return `<i data-lucide="file" class="w-5 h-5 text-gray-400"></i>`;
};

const updateSortIndicators = () => {
    document.querySelectorAll('.sort-indicator').forEach(span => span.innerHTML = '');
    const currentSpan = document.querySelector(`.sort-indicator[data-column="${currentSort.column}"]`);
    if (currentSpan) {
        currentSpan.innerHTML = currentSort.direction === 'asc' ? '&#9650;' : '&#9660;';
    }
};

// --- RENDER LOGIC ---

const renderTable = (data) => {
    const tbody = document.getElementById('fileTableBody');
    tbody.innerHTML = '';

    if (!data || data.length === 0) {
        document.getElementById('noDataMessage').classList.remove('hidden');
        return;
    }
    document.getElementById('noDataMessage').classList.add('hidden');

    data.forEach(doc => {
        const row = tbody.insertRow();
        row.className = "hover:bg-gray-50 transition-colors duration-150";

        // 1. File Name
        const cellName = row.insertCell();
        cellName.className = 'px-6 py-4 whitespace-nowrap file-name-col';
        cellName.innerHTML = `
            <div class="flex items-center">
                <div class="flex-shrink-0 h-10 w-10 flex items-center justify-center bg-gray-50 rounded-lg border border-gray-200">
                    ${getFileIcon(doc.original_filename)}
                </div>
                <div class="ml-4">
                    <div class="text-sm font-medium text-gray-900 truncate max-w-xs text-indigo-600 cursor-pointer hover:underline" title="${doc.original_filename || 'Unknown File'}">
                        ${doc.original_filename || 'Unknown File'}
                    </div>
                    <div class="text-xs text-gray-400 truncate max-w-[200px]">${doc.document_id ? doc.document_id.substring(0, 8) : ''}...</div>
                </div>
            </div>
        `;

        // 2. Type
        const cellType = row.insertCell();
        cellType.className = 'px-6 py-4 whitespace-nowrap type-col';
        const typeClass = doc.document_type === 'RESUME' ? 'bg-green-100 text-green-800' :
                         doc.document_type === 'COVER_LETTER' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800';
        cellType.innerHTML = `
            <span class="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${typeClass}">
                ${doc.document_type ? doc.document_type.replace('_', ' ') : 'UNKNOWN'}
            </span>
        `;

        // 3. Company
        const cellCompany = row.insertCell();
        cellCompany.className = 'px-6 py-4 whitespace-nowrap text-sm company-col';
        
        // Link logic similar to the example if company ID is present
        if(doc.company_id) {
             const mgmtUrl = `management.html?companyId=${doc.company_id}&companyName=${encodeURIComponent(doc.company_name_clean || '')}`;
             cellCompany.innerHTML = `<a href="${mgmtUrl}" class="font-medium text-indigo-600 hover:text-indigo-900 hover:underline">${doc.company_name_clean || 'N/A'}</a>`;
        } else {
             cellCompany.textContent = doc.company_name_clean || 'N/A';
        }

        // 4. Date
        const cellDate = row.insertCell();
        cellDate.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-500 date-col';
        cellDate.textContent = formatDate(doc.upload_timestamp);

        // 5. Actions
        const cellAction = row.insertCell();
        cellAction.className = 'px-6 py-4 whitespace-nowrap text-right text-sm font-medium action-col';
        // Changed from Download to Delete action
        cellAction.innerHTML = `
            <button onclick="deleteDocument('${doc.document_id}')" class="text-gray-400 hover:text-red-600 transition-colors p-2 rounded-full hover:bg-red-50" title="Delete">
                <i data-lucide="trash-2" class="w-5 h-5"></i>
            </button>
        `;
    });

    // Re-initialize icons for new DOM elements
    if (window.lucide) {
        window.lucide.createIcons();
    }
    updateSortIndicators();
};

window.sortTable = (column) => {
    if (currentSort.column === column) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.column = column;
        currentSort.direction = 'asc';
    }

    documentData.sort((a, b) => {
        let valA = (a[column] || '').toString().toLowerCase();
        let valB = (b[column] || '').toString().toLowerCase();

        if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
        return 0;
    });

    renderTable(documentData);
};

window.deleteDocument = async (documentId) => {
    if (!confirm("Are you sure you want to delete this document? This action cannot be undone.")) {
        return;
    }

    try {
        const response = await fetch(`/api/documents/${documentId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': 'Bearer MOCK_TOKEN'
            }
        });

        const result = await response.json();

        if (response.ok && result.status === 'success') {
            // Remove the deleted document from the local array
            documentData = documentData.filter(doc => doc.document_id !== documentId);
            // Re-render the table
            renderTable(documentData);
        } else {
            alert(`Error: ${result.message || 'Failed to delete document'}`);
        }
    } catch (error) {
        console.error("Delete Error:", error);
        alert("Failed to connect to the server.");
    }
};

const fetchDocuments = async () => {
    const loading = document.getElementById('loadingMessage');
    const errorDiv = document.getElementById('errorMessage');
    
    loading.classList.remove('hidden');
    errorDiv.classList.add('hidden');

    try {
        const response = await fetch('/api/documents/all', {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer MOCK_TOKEN',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();

        if (result.status === 'success' && Array.isArray(result.documents)) {
            documentData = result.documents;
            window.sortTable(currentSort.column); // Initial sort & render
        } else {
            throw new Error(result.message || 'Invalid data format received.');
        }
    } catch (error) {
        console.error("Fetch Error:", error);
        document.getElementById('errorDetail').textContent = error.message;
        errorDiv.classList.remove('hidden');
        renderTable([]);
    } finally {
        loading.classList.add('hidden');
    }
};

const init = () => {
    // Call the shared modules to render structure
    try {
        injectNavbar();
        renderSidebar();
    } catch (e) {
        console.warn("Could not render navbar/sidebar from modules. Ensure navbar.js and dashboard_sidebar.js are present.", e);
    }
    
    // Initialize icons if immediately available
    if (window.lucide) window.lucide.createIcons();
    
    // Fetch Data
    fetchDocuments();
};

document.addEventListener('DOMContentLoaded', init);
