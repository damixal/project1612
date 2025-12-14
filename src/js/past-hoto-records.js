// src/js/past-hoto-records.js - CORRECTED
document.addEventListener('DOMContentLoaded', () => {
    const storeFilter = document.getElementById('storeFilter');
    const dateFilter = document.getElementById('dateFilter');
    const typeFilter = document.getElementById('typeFilter');
    const clearFiltersBtn = document.getElementById('clearFilters');
    const recordsTable = document.getElementById('recordsTable');
    const recordsTableBody = document.getElementById('recordsTableBody');
    const loadingMessage = document.getElementById('loadingMessage');
    const noRecordsMessage = document.getElementById('noRecordsMessage');
    const recordDetailsModal = document.getElementById('recordDetailsModal');
    const recordDetailsContent = document.getElementById('recordDetailsContent');
    const closeModalBtn = recordDetailsModal.querySelector('.close-button');

    let allRecords = [];
    let allStores = [];

    // --- FUNCTIONS ---

    // Fetch all HOTO records - FIXED ENDPOINT
    async function fetchHOTORecords() {
        try {
            loadingMessage.style.display = 'block';
            recordsTable.style.display = 'none';
            noRecordsMessage.style.display = 'none';

            // FIXED: Changed from '/api/hoto-records' to '/api/hoto/records'
            const response = await fetch('/api/hoto/records');
            if (!response.ok) throw new Error('Failed to fetch records');
            
            allRecords = await response.json();
            console.log('Fetched HOTO records:', allRecords); // Debug log
            applyFilters();
        } catch (error) {
            console.error('Error fetching records:', error);
            loadingMessage.innerHTML = 'Error loading records. Please try again.';
        }
    }

    // Fetch all stores for the filter dropdown
    async function fetchStores() {
        try {
            const response = await fetch('/api/stores');
            if (!response.ok) throw new Error('Failed to fetch stores');
            
            allStores = await response.json();
            populateStoreFilter();
        } catch (error) {
            console.error('Error fetching stores:', error);
        }
    }

    // Populate store filter dropdown
    function populateStoreFilter() {
        storeFilter.innerHTML = '<option value="">All Stores</option>';
        allStores.forEach(store => {
            const option = document.createElement('option');
            option.value = store.name;
            option.textContent = store.name;
            storeFilter.appendChild(option);
        });
    }

    // Apply filters to records
    function applyFilters() {
        let filteredRecords = [...allRecords];

        // Store filter
        const selectedStore = storeFilter.value;
        if (selectedStore) {
            filteredRecords = filteredRecords.filter(record => record.store_name === selectedStore);
        }

        // Date filter - FIXED: Use hoto_date instead of start_date
        const selectedDate = dateFilter.value;
        if (selectedDate) {
            filteredRecords = filteredRecords.filter(record => {
                const recordDate = record.hoto_date || record.start_date;
                return recordDate === selectedDate;
            });
        }

        // Type filter
        const selectedType = typeFilter.value;
        if (selectedType) {
            filteredRecords = filteredRecords.filter(record => record.hoto_type === selectedType);
        }

        displayRecords(filteredRecords);
    }

    // Display records in the table
    function displayRecords(records) {
        loadingMessage.style.display = 'none';

        if (records.length === 0) {
            noRecordsMessage.style.display = 'block';
            recordsTable.style.display = 'none';
            return;
        }

        noRecordsMessage.style.display = 'none';
        recordsTable.style.display = 'table';
        recordsTableBody.innerHTML = '';

        // Sort records by date (newest first)
        records.sort((a, b) => {
            const dateA = a.hoto_date || a.start_date || a.created_at;
            const dateB = b.hoto_date || b.start_date || b.created_at;
            return new Date(dateB) - new Date(dateA);
        });

        records.forEach(record => {
            const row = document.createElement('tr');
            
            // FIXED: Use hoto_date instead of start_date
            const recordDate = record.hoto_date || record.start_date || record.created_at;
            
            // Format box counts for display
            let boxCountsDisplay = 'No data';
            if (record.box_condition) {
                boxCountsDisplay = record.box_condition === 'YES' ? 'Good Condition' : 'Issues Found';
            }

            row.innerHTML = `
                <td>${formatDate(recordDate)}</td>
                <td>${record.store_name || 'Unknown Store'}</td>
                <td>${record.user_name || 'Unknown User'}</td>
                <td><span class="badge ${record.hoto_type === 'Hand Over' ? 'badge-handover' : 'badge-takeover'}">${record.hoto_type || 'Unknown'}</span></td>
                <td><span class="badge ${record.status === 'COMPLETED' ? 'badge-completed' : 'badge-ongoing'}">${record.status || 'Unknown'}</span></td>
                <td class="box-counts-cell">${boxCountsDisplay}</td>
                <td>
                    <button class="btn btn-small btn-primary view-details-btn" data-record-id="${record.id}">
                        <i class="fas fa-eye"></i> View
                    </button>
                </td>
            `;
            recordsTableBody.appendChild(row);
        });

        // Add event listeners to view buttons
        document.querySelectorAll('.view-details-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const recordId = e.target.closest('.view-details-btn').dataset.recordId;
                viewRecordDetails(recordId);
            });
        });
    }

    // Format date for display
    function formatDate(dateString) {
        if (!dateString) return 'Unknown';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-SG', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    // View record details - FIXED ENDPOINT
    async function viewRecordDetails(recordId) {
        try {
            // FIXED: This endpoint should exist in server.js
            const response = await fetch(`/api/hoto-records/${recordId}`);
            if (!response.ok) throw new Error('Failed to fetch record details');
            
            const record = await response.json();
            displayRecordDetails(record);
        } catch (error) {
            console.error('Error fetching record details:', error);
            
            // Fallback: Show basic info from existing record
            const record = allRecords.find(r => r.id == recordId);
            if (record) {
                displayRecordDetails(record);
            } else {
                alert('Error loading record details.');
            }
        }
    }

    // Display record details in modal
    function displayRecordDetails(record) {
        // FIXED: Use hoto_date instead of start_date
        const recordDate = record.hoto_date || record.start_date || record.created_at;
        
        // Prepare details
        const details = `
            <div class="record-detail-group">
                <h3>Basic Information</h3>
                <div class="detail-row">
                    <span class="detail-label">Store:</span>
                    <span class="detail-value">${record.store_name || 'Unknown'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">User:</span>
                    <span class="detail-value">${record.user_name || 'Unknown'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Date:</span>
                    <span class="detail-value">${formatDate(recordDate)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Type:</span>
                    <span class="detail-value badge ${record.hoto_type === 'Hand Over' ? 'badge-handover' : 'badge-takeover'}">${record.hoto_type || 'Unknown'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Status:</span>
                    <span class="detail-value badge ${record.status === 'COMPLETED' ? 'badge-completed' : 'badge-ongoing'}">${record.status || 'Unknown'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Mobile Number:</span>
                    <span class="detail-value">${record.mobile_number || 'Not provided'}</span>
                </div>
            </div>

            <div class="record-detail-group">
                <h3>Store Condition</h3>
                <div class="detail-row">
                    <span class="detail-label">Condition:</span>
                    <span class="detail-value">${record.box_condition === 'YES' ? 'Good Condition' : 'Issues Found'}</span>
                </div>
                ${record.issue_description ? `
                <div class="detail-row">
                    <span class="detail-label">Issue Description:</span>
                    <span class="detail-value">${record.issue_description}</span>
                </div>
                ` : ''}
                ${record.issue_notification ? `
                <div class="detail-row">
                    <span class="detail-label">Notification:</span>
                    <span class="detail-value">${record.issue_notification}</span>
                </div>
                ` : ''}
                <div class="detail-row">
                    <span class="detail-label">Issue Resolved:</span>
                    <span class="detail-value">${record.issue_resolved ? 'Yes' : 'No'}</span>
                </div>
                ${record.authorized_by ? `
                <div class="detail-row">
                    <span class="detail-label">Authorized By:</span>
                    <span class="detail-value">${record.authorized_by}</span>
                </div>
                ` : ''}
                ${record.witnessed_by ? `
                <div class="detail-row">
                    <span class="detail-label">Witnessed By:</span>
                    <span class="detail-value">${record.witnessed_by}</span>
                </div>
                ` : ''}
            </div>

            <div class="record-detail-group">
                <h3>Timestamps</h3>
                <div class="detail-row">
                    <span class="detail-label">Created:</span>
                    <span class="detail-value">${formatDate(record.created_at)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Last Updated:</span>
                    <span class="detail-value">${formatDate(record.updated_at)}</span>
                </div>
            </div>
        `;

        recordDetailsContent.innerHTML = details;
        recordDetailsModal.style.display = 'flex';
    }

    // Clear all filters
    function clearFilters() {
        storeFilter.value = '';
        dateFilter.value = '';
        typeFilter.value = '';
        applyFilters();
    }

    // --- EVENT LISTENERS ---
    storeFilter.addEventListener('change', applyFilters);
    dateFilter.addEventListener('change', applyFilters);
    typeFilter.addEventListener('change', applyFilters);
    clearFiltersBtn.addEventListener('click', clearFilters);

    // Modal close events
    closeModalBtn.addEventListener('click', () => {
        recordDetailsModal.style.display = 'none';
    });

    window.addEventListener('click', (event) => {
        if (event.target == recordDetailsModal) {
            recordDetailsModal.style.display = 'none';
        }
    });

    // --- INITIALIZATION ---
    fetchStores();
    fetchHOTORecords();

    // Ensure modal is hidden on page load
    recordDetailsModal.style.display = 'none';
});