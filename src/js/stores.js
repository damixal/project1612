// src/js/stores.js - UPDATED: CORRECTED STORE VISIBILITY AND TEAM HANDLING
document.addEventListener('DOMContentLoaded', () => {
    const userRole = localStorage.getItem('loggedInUserRole');
    const userId = localStorage.getItem('loggedInUserId');
    const userName = localStorage.getItem('loggedInUserName');
    const userRank = localStorage.getItem('loggedInUserRank');
    
    // Store elements
    const storeListContainer = document.getElementById('storeList');
    const teamAStores = document.getElementById('teamAStores');
    const teamBStores = document.getElementById('teamBStores');
    const teamAGrid = document.getElementById('teamAGrid');
    const teamBGrid = document.getElementById('teamBGrid');
    const emptyState = document.getElementById('emptyState');
    
    // Modal elements
    const addStoreBtn = document.getElementById('addStoreBtn');
    const addStoreModal = document.getElementById('addStoreModal');
    const addStoreForm = document.getElementById('addStoreForm');
    const closeButton = addStoreModal?.querySelector('.close-button');
    const dateTimeDisplay = document.getElementById('dateTime');
    
    // QR Code Modal elements
    const qrCodeModal = document.getElementById('qrCodeModal');
    const qrCloseButton = qrCodeModal?.querySelector('.qr-close');
    const qrStoreName = document.getElementById('qrStoreName');
    const qrStoreId = document.getElementById('qrStoreId');
    const qrCodeDisplay = document.getElementById('qrCodeDisplay');
    const downloadQRBtn = document.getElementById('downloadQRBtn');
    const printQRBtn = document.getElementById('printQRBtn');

    // Confirmation Modal Elements (for delete)
    let confirmDeleteModal;
    let deleteStoreId = null;
    let deleteStoreName = '';

    // Handover Modal Elements
    let handoverModal;
    let handoverStoreId = null;
    let handoverStoreName = '';
    let handoverUsers = [];

    // Encryption key - MUST MATCH THE ONE IN hoto-forms-fill.js
    const ENCRYPTION_KEY = 'sbedamien';
    const DEBUG_MODE = true;

    // Display date & time
    function updateDateTime() {
        const now = new Date();
        const options = { 
            weekday: 'short', 
            day: 'numeric', 
            month: 'short', 
            year: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit', 
            hour12: true 
        };
        if (dateTimeDisplay) {
            dateTimeDisplay.textContent = now.toLocaleString('en-SG', options);
        }
    }
    
    updateDateTime();

    // Simple XOR encryption function - MUST MATCH hoto-forms-fill.js
    function encryptData(data, key) {
        let encrypted = '';
        for (let i = 0; i < data.length; i++) {
            const keyChar = key.charCodeAt(i % key.length);
            const dataChar = data.charCodeAt(i);
            encrypted += String.fromCharCode(dataChar ^ keyChar);
        }
        // Base64 encode to make it safe for QR code
        return btoa(encrypted);
    }

    // Debug logging function
    function debugLog(message, data = null) {
        if (DEBUG_MODE) {
            console.log(`🔍 [STORES DEBUG] ${message}`);
            if (data) {
                console.log('📊 Data:', data);
            }
        }
    }

    // Show/hide add button based on role
    if (addStoreBtn) {
        // Only show for Admin and RQ (Members cannot create stores)
        if (userRole !== 'MEC_OIC_ADMIN' && userRole !== 'RQ') {
            addStoreBtn.style.display = 'none';
        }
    }

    // Helper function to determine if RQ can handover a store
    function canRQHandoverStore(store, userId) {
        const storeTeam = store.team || 'TEAM_A';
        const isHolder = store.current_holder_id == userId;
        const isCreator = store.created_by_id == userId;
        const storeStatus = store.status;
        
        // RQ can handover:
        // 1. TEAM_B stores they created or hold
        if (storeTeam === 'TEAM_B') {
            if (storeStatus === 'AVAILABLE' && isCreator) return true;
            if (storeStatus === 'TAKEN_OVER' && isHolder) return true;
            if (storeStatus === 'TAKEN_OVER' && isCreator) return true; // RQ can handover stores they created even if not holder
        }
        // 2. TEAM_A stores they created or hold
        if (storeTeam === 'TEAM_A') {
            if (storeStatus === 'TAKEN_OVER' && isHolder) return true;
            if (storeStatus === 'TAKEN_OVER' && isCreator) return true; // RQ can handover stores they created even if not holder
        }
        
        return false;
    }

    // CORRECTED: Fetch and display stores with proper team logic
    async function fetchStores() {
        try {
            debugLog('Fetching stores...', { 
                userRole, 
                userId, 
                userName,
                userRank 
            });
            const response = await fetch('/api/stores');
            const allStores = await response.json();
            
            debugLog('All stores received from API', { 
                count: allStores.length,
                stores: allStores.map(s => ({ 
                    id: s.id, 
                    name: s.name, 
                    team: s.team, 
                    status: s.status,
                    current_holder_id: s.current_holder_id,
                    created_by_id: s.created_by_id 
                }))
            });
            
            // Reset containers
            if (teamAGrid) teamAGrid.innerHTML = '';
            if (teamBGrid) teamBGrid.innerHTML = '';
            if (emptyState) emptyState.style.display = 'none';
            
            // Separate stores by team
            const teamA = [];
            const teamB = [];
            
            allStores.forEach(store => {
                let canView = false;
                let storeTeam = store.team || 'TEAM_A';
                const isHolder = store.current_holder_id == userId;
                const isCreator = store.created_by_id == userId;
                
                debugLog('Checking store visibility', {
                    storeId: store.id,
                    storeName: store.name,
                    storeTeam: storeTeam,
                    storeStatus: store.status,
                    currentHolder: store.current_holder_id,
                    isHolder: isHolder,
                    isCreator: isCreator,
                    userId: userId,
                    userRole: userRole
                });
                
                // NEW LOGIC: ADMIN CAN SEE ALL STORES
                if (userRole === 'MEC_OIC_ADMIN') {
                    canView = true;
                    debugLog('Admin can see all stores', { storeName: store.name });
                }
                // For RQ users:
                else if (userRole === 'RQ') {
                    // RQ can see:
                    // 1. TEAM_B stores they created
                    if (storeTeam === 'TEAM_B' && isCreator) {
                        canView = true;
                        debugLog('RQ can see TEAM_B store they created', { storeName: store.name });
                    }
                    // 2. TEAM_B stores that are AVAILABLE
                    else if (storeTeam === 'TEAM_B' && store.status === 'AVAILABLE') {
                        canView = true;
                        debugLog('RQ can see TEAM_B AVAILABLE store', { storeName: store.name });
                    }
                    // 3. Stores they created in TEAM_A
                    else if (storeTeam === 'TEAM_A' && isCreator) {
                        canView = true;
                        debugLog('RQ can see TEAM_A store they created', { storeName: store.name });
                    }
                    // 4. Stores they currently hold (any team)
                    else if (isHolder && store.status === 'TAKEN_OVER') {
                        canView = true;
                        debugLog('RQ can see store they hold', { storeName: store.name });
                    }
                }
                // For MEMBER users:
                else if (userRole === 'MEMBER') {
                    // MEMBER can see:
                    // 1. TEAM_A stores they created
                    if (storeTeam === 'TEAM_A' && isCreator) {
                        canView = true;
                        debugLog('MEMBER can see TEAM_A store they created', { storeName: store.name });
                    }
                    // 2. TEAM_A stores that are AVAILABLE
                    else if (storeTeam === 'TEAM_A' && store.status === 'AVAILABLE') {
                        canView = true;
                        debugLog('MEMBER can see TEAM_A AVAILABLE store', { storeName: store.name });
                    }
                    // 3. Stores they currently hold in TEAM_A
                    else if (storeTeam === 'TEAM_A' && isHolder && store.status === 'TAKEN_OVER') {
                        canView = true;
                        debugLog('MEMBER can see TEAM_A store they hold', { storeName: store.name });
                    }
                }
                
                if (canView) {
                    if (storeTeam === 'TEAM_B') {
                        teamB.push(store);
                        debugLog('Added to Team B list', { storeName: store.name });
                    } else {
                        teamA.push(store); // Default to TEAM_A
                        debugLog('Added to Team A list', { storeName: store.name });
                    }
                } else {
                    debugLog('Store not visible to user', { 
                        storeName: store.name, 
                        reason: 'User does not have permission' 
                    });
                }
            });
            
            debugLog('Visible Team A stores', teamA.map(s => ({ 
                id: s.id, 
                name: s.name, 
                status: s.status,
                isHolder: s.current_holder_id == userId 
            })));
            debugLog('Visible Team B stores', teamB.map(s => ({ 
                id: s.id, 
                name: s.name, 
                status: s.status,
                isHolder: s.current_holder_id == userId 
            })));
            
            // Display Team A stores (only if user can see them)
            if (teamA.length > 0) {
                if (teamAStores) {
                    teamAStores.style.display = 'block';
                    const teamATitle = teamAStores.querySelector('.team-title');
                    if (teamATitle) {
                        if (userRole === 'MEC_OIC_ADMIN') {
                            teamATitle.innerHTML = '<i class="fas fa-users"></i> TEAM A STORES (ALL)';
                        } else if (userRole === 'RQ') {
                            teamATitle.innerHTML = '<i class="fas fa-users"></i> TEAM A STORES (YOUR STORES)';
                        } else {
                            teamATitle.innerHTML = '<i class="fas fa-users"></i> TEAM A STORES (YOUR TEAM)';
                        }
                    }
                }
                teamA.forEach(store => {
                    createStoreCard(store, teamAGrid);
                });
            } else {
                if (teamAStores) teamAStores.style.display = 'none';
            }
            
            // Display Team B stores (only if user can see them)
            if (teamB.length > 0) {
                if (teamBStores) {
                    teamBStores.style.display = 'block';
                    const teamBTitle = teamBStores.querySelector('.team-title');
                    if (teamBTitle) {
                        if (userRole === 'MEC_OIC_ADMIN') {
                            teamBTitle.innerHTML = '<i class="fas fa-users"></i> TEAM B STORES (ALL)';
                        } else if (userRole === 'RQ') {
                            teamBTitle.innerHTML = '<i class="fas fa-users"></i> TEAM B STORES (YOUR TEAM)';
                        } else {
                            teamBTitle.innerHTML = '<i class="fas fa-users"></i> TEAM B STORES';
                        }
                    }
                }
                teamB.forEach(store => {
                    createStoreCard(store, teamBGrid);
                });
            } else {
                if (teamBStores) teamBStores.style.display = 'none';
            }
            
            // Show empty state if no stores visible
            if (teamA.length === 0 && teamB.length === 0) {
                if (emptyState) {
                    emptyState.innerHTML = `
                        <h3><i class="fas fa-store"></i> No Stores Found</h3>
                        <p>You don't have access to any stores.</p>
                        <p><strong>Your Role:</strong> ${userRole}</p>
                        ${userRole === 'RQ' ? `
                        <p><strong>As an RQ, you can see:</strong></p>
                        <ul style="text-align: left; margin: 10px 0; font-size: 0.9rem;">
                            <li>✓ TEAM_B stores that are AVAILABLE</li>
                            <li>✓ Stores you created (any team)</li>
                            <li>✓ Stores you currently hold (any team)</li>
                        </ul>
                        ` : ''}
                        ${userRole === 'MEMBER' ? `
                        <p><strong>As a Member, you can see:</strong></p>
                        <ul style="text-align: left; margin: 10px 0; font-size: 0.9rem;">
                            <li>✓ TEAM_A stores that are AVAILABLE</li>
                            <li>✓ TEAM_A stores you created</li>
                            <li>✓ TEAM_A stores you currently hold</li>
                        </ul>
                        ` : ''}
                        <button onclick="location.reload()" class="btn btn-primary" style="margin-top: 10px;">
                            <i class="fas fa-redo"></i> Refresh
                        </button>
                    `;
                    emptyState.style.display = 'block';
                }
            }
            
            // Attach event listeners after cards are created
            attachEventListeners();
            
        } catch (error) {
            debugLog('Error loading stores', error);
            console.error('Error loading stores:', error);
            storeListContainer.innerHTML = `
                <div class="error-state">
                    <h3><i class="fas fa-exclamation-triangle"></i> Error Loading Stores</h3>
                    <p>${error.message}</p>
                    <button onclick="location.reload()" class="btn btn-primary" style="margin-top: 10px;">
                        <i class="fas fa-redo"></i> Retry
                    </button>
                </div>
            `;
        }
    }

    // Add real-time status to store cards
    function addRealTimeIndicators() {
        // This function would add online/offline indicators to users
        // You can implement this based on your real-time system
        
        // Example: Add connection status to page
        const connectionStatus = document.createElement('div');
        connectionStatus.id = 'storesConnectionStatus';
        connectionStatus.style.cssText = `
            position: fixed;
            bottom: 10px;
            right: 10px;
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 1000;
            background: #f8f9fa;
            border: 1px solid #dee2e6;
        `;
        connectionStatus.textContent = 'Real-time: Connecting...';
        document.body.appendChild(connectionStatus);
    }

    // Add real-time status to store cards
    function addRealTimeIndicators() {
        // This function would add online/offline indicators to users
        // You can implement this based on your real-time system
        
        // Example: Add connection status to page
        const connectionStatus = document.createElement('div');
        connectionStatus.id = 'storesConnectionStatus';
        connectionStatus.style.cssText = `
            position: fixed;
            bottom: 10px;
            right: 10px;
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 1000;
            background: #f8f9fa;
            border: 1px solid #dee2e6;
        `;
        connectionStatus.textContent = 'Real-time: Connecting...';
        document.body.appendChild(connectionStatus);
    }

    // Create a store card element
    function createStoreCard(store, container) {
        const storeCard = document.createElement('div');
        storeCard.className = 'store-card';
        storeCard.dataset.storeId = store.id;
        
        // Determine status class and text
        let statusClass = '';
        let statusText = '';
        let statusIcon = '';
        
        switch(store.status) {
            case 'AVAILABLE':
                statusClass = 'status-available';
                statusText = 'Available';
                statusIcon = '<i class="fas fa-check-circle"></i>';
                break;
            case 'HANDED_OVER':
                statusClass = 'status-handed-over';
                statusText = 'Handed Over';
                statusIcon = '<i class="fas fa-handshake"></i>';
                break;
            case 'TAKEN_OVER':
                statusClass = 'status-taken-over';
                statusText = 'Taken Over';
                statusIcon = '<i class="fas fa-user-check"></i>';
                break;
            default:
                statusClass = 'status-unknown';
                statusText = store.status || 'Unknown';
                statusIcon = '<i class="fas fa-question-circle"></i>';
        }
        
        // Check user's relationship to this store
        const isHolder = store.current_holder_id == userId;
        const isCreator = store.created_by_id == userId;
        const storeTeam = store.team || 'TEAM_A';
        const hasNoHolder = !store.current_holder_id || store.current_holder_id === null;
        
        // For RQ users, check if they can handover this store
        const canRQHandover = userRole === 'RQ' ? canRQHandoverStore(store, userId) : false;
        
        // Add special badges based on user's relationship to store
        let specialBadges = '';
        
        // Badge if user is the current holder
        if (isHolder && store.status === 'TAKEN_OVER') {
            specialBadges += '<span class="team-badge you-hold">YOU HOLD THIS STORE</span>';
        }
        
        // Badge if user created the store
        if (isCreator) {
            specialBadges += '<span class="team-badge you-created">YOU CREATED THIS</span>';
        }
        
        // Badge for RQ users who can handover
        if (userRole === 'RQ' && canRQHandover) {
            specialBadges += '<span class="team-badge rq-can-handover">CAN HANDOVER</span>';
        }
        
        // NEW: Badge for admin handover capability (when holder is none)
        if (userRole === 'MEC_OIC_ADMIN' && hasNoHolder) {
            specialBadges += '<span class="team-badge admin-can-handover">ADMIN CAN HANDOVER</span>';
        }
        
        // Determine if user can handover this store
        const canHandOver = userRole === 'MEC_OIC_ADMIN' || 
                           (userRole === 'RQ' && canRQHandover) ||
                           (userRole === 'MEMBER' && storeTeam === 'TEAM_A' && (isHolder || (isCreator && store.status === 'AVAILABLE')));
        
        // Create card HTML
        storeCard.innerHTML = `
            <div class="store-card-header">
                <h3>${store.name}</h3>
                <div>
                    ${specialBadges}
                    <span class="store-status ${statusClass}">
                        ${statusIcon} ${statusText}
                    </span>
                </div>
            </div>
            <div class="store-card-info">
                <p><strong>Team:</strong> ${storeTeam}</p>
                <p><strong>Status:</strong> ${statusText}</p>
                <p><strong>Current Holder:</strong> ${store.current_holder_name || 'None'}</p>
                <p><strong>Created by:</strong> ${store.created_by_name || 'Unknown'}</p>
                <p><strong>Created:</strong> ${formatDate(store.created_at)}</p>
                ${hasNoHolder ? '<p><strong>⚠️ No current holder</strong></p>' : ''}
                ${isHolder ? '<p><strong>👤 You are the current holder</strong></p>' : ''}
                ${isCreator ? '<p><strong>🛠️ You created this store</strong></p>' : ''}
                ${userRole === 'RQ' ? `
                    ${storeTeam === 'TEAM_B' ? '<p><strong>🏆 Your team store</strong></p>' : ''}
                    ${storeTeam === 'TEAM_A' && isCreator ? '<p><strong>📝 You created this TEAM_A store</strong></p>' : ''}
                ` : ''}
                ${userRole === 'RQ' && canRQHandover ? '<p><strong>✅ You can handover this store</strong></p>' : ''}
            </div>
            <div class="store-card-actions">
                ${canHandOver ? `
                <button class="btn btn-small btn-primary initiate-handover-btn" data-store-id="${store.id}" data-store-name="${store.name}" data-store-team="${storeTeam}">
                    <i class="fas fa-handshake"></i> Hand Over
                </button>
                ` : ''}
                ${userRole === 'MEC_OIC_ADMIN' ? `
                <button class="btn btn-small btn-secondary generate-qr-btn" data-store-id="${store.id}" data-store-name="${store.name}">
                    <i class="fas fa-qrcode"></i> QR Code
                </button>
                <button class="btn btn-small btn-danger delete-store-btn" data-store-id="${store.id}" data-store-name="${store.name}">
                    <i class="fas fa-trash"></i> Delete Store
                </button>
                ` : ''}
            </div>
        `;
        
        container.appendChild(storeCard);
    }

    // Attach event listeners to buttons
    function attachEventListeners() {
        // Hand Over buttons
        document.querySelectorAll('.initiate-handover-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const storeId = btn.dataset.storeId;
                const storeName = btn.dataset.storeName;
                const storeTeam = btn.dataset.storeTeam;
                initiateHandOver(storeId, storeName, storeTeam);
            });
        });
        
        // QR Code buttons
        document.querySelectorAll('.generate-qr-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const storeId = btn.dataset.storeId;
                const storeName = btn.dataset.storeName;
                generateStoreQRCode(storeId, storeName);
            });
        });
        
        // Delete buttons
        document.querySelectorAll('.delete-store-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const storeId = btn.dataset.storeId;
                const storeName = btn.dataset.storeName;
                confirmDeleteStore(storeId, storeName);
            });
        });
    }

    // Initiate Hand Over process - FIXED: RQ can handover stores they created in any team
    function initiateHandOver(storeId, storeName, storeTeam) {
        debugLog('Initiating hand over', { storeId, storeName, storeTeam, userRole, userId });
        
        // Check if user is logged in
        if (!userId) {
            alert('Please log in first.');
            window.location.href = 'login.html';
            return;
        }
        
        // For non-admin users: Must be holder or creator
        if (userRole !== 'MEC_OIC_ADMIN') {
            // For RQ users: Check if they can handover this store
            if (userRole === 'RQ') {
                // Check if RQ created this store (any team)
                const store = allStores.find(s => s.id == storeId);
                if (store) {
                    const isCreator = store.created_by_id == userId;
                    const isHolder = store.current_holder_id == userId;
                    
                    if (isCreator || isHolder) {
                        // Redirect to HOTO form with store pre-selected
                        const storeData = {
                            id: storeId,
                            name: storeName
                        };
                        
                        // Store the selected store in localStorage for the HOTO form
                        localStorage.setItem('selectedStoreForHOTO', JSON.stringify(storeData));
                        
                        // Redirect to HOTO form
                        window.location.href = 'hoto-forms-fill.html';
                        return;
                    }
                }
            }
            // For Member users: Must be TEAM_A store and holder/creator
            else if (userRole === 'MEMBER') {
                if (storeTeam === 'TEAM_A') {
                    // Redirect to HOTO form with store pre-selected
                    const storeData = {
                        id: storeId,
                        name: storeName
                    };
                    
                    // Store the selected store in localStorage for the HOTO form
                    localStorage.setItem('selectedStoreForHOTO', JSON.stringify(storeData));
                    
                    // Redirect to HOTO form
                    window.location.href = 'hoto-forms-fill.html';
                    return;
                } else {
                    alert('Members can only handover TEAM_A stores.');
                    return;
                }
            }
            
            alert('You do not have permission to handover this store.');
        } else {
            // ADMIN: Show handover modal to select user
            showAdminHandoverModal(storeId, storeName);
        }
    }

    // Show admin handover modal
    async async function showAdminHandoverModal(storeId, storeName) {
        handoverStoreId = storeId;
        handoverStoreName = storeName;

        debugLog('Showing admin handover modal', { storeId, storeName });

        try {
            // Enforce: BOTH parties must be online for admin -> RQ handover
            const rt = (typeof window !== 'undefined') ? window.RealTimeHandover : null;
            const isConnected = !!(rt && rt.isConnected);

            // Ensure modal exists
            if (!handoverModal) {
                createHandoverModal();
            }

            const userSelect = document.getElementById('handoverUserSelect');
            const modalMessage = document.getElementById('handoverModalMessage');
            const submitBtn = handoverModal?.querySelector('button[type="submit"]');

            if (!userSelect) throw new Error('Handover user selector not found');

            // If not connected, block handover (require both online)
            if (!isConnected) {
                userSelect.innerHTML = '<option value="">Real-time system offline (cannot handover)</option>';
                if (submitBtn) submitBtn.disabled = true;

                if (modalMessage) {
                    modalMessage.innerHTML = `
                        <p><strong>Store:</strong> ${storeName}</p>
                        <p style="color:#721c24;"><strong>❌ Cannot Hand Over:</strong> Real-time system is offline.</p>
                        <p>Requirement: Admin and RQ must both be <strong>online</strong> to handover.</p>
                        <p><em>Tip:</em> Start <code>node websocket-server.js</code> and refresh this page.</p>
                    `;
                }

                handoverModal.style.display = 'flex';
                return;
            }

            // Refresh online users list from server (best-effort)
            try { rt.requestOnlineUsers?.(); } catch (_) {}

            // Only allow handover to ONLINE RQ users
            const onlineUsers = Array.isArray(rt.onlineUsers) ? rt.onlineUsers : [];
            const eligible = onlineUsers
                .filter(u => u && u.userId != userId)
                .filter(u => u.userRole === 'RQ'); // enforce admin -> RQ only

            // Populate dropdown
            userSelect.innerHTML = '<option value="">Select ONLINE RQ user...</option>';

            if (eligible.length === 0) {
                userSelect.innerHTML = `
                    <option value="">No ONLINE RQ users available</option>
                    <option value="" disabled>Both admin and RQ must be online</option>
                `;
                if (submitBtn) submitBtn.disabled = true;
            } else {
                eligible.forEach(u => {
                    const opt = document.createElement('option');
                    opt.value = u.userId;
                    opt.textContent = `${u.userName} (${u.userRole}) - ONLINE`;
                    userSelect.appendChild(opt);
                });
                if (submitBtn) submitBtn.disabled = false;
            }

            if (modalMessage) {
                modalMessage.innerHTML = `
                    <p><strong>Store:</strong> ${storeName}</p>
                    <p><strong>Requirement:</strong> Admin and RQ must both be <span style="color:#155724;">ONLINE</span>.</p>
                    <p><strong>Note:</strong> This will immediately change the store holder to the selected user.</p>
                `;
            }

            // Show modal
            handoverModal.style.display = 'flex';

        } catch (error) {
            debugLog('Error preparing admin handover modal', error);
            alert('Error preparing handover: ' + error.message);
        }
    }

    // Create handover modal for admin
    function createHandoverModal() {
        handoverModal = document.createElement('div');
        handoverModal.id = 'adminHandoverModal';
        handoverModal.className = 'modal-overlay';
        handoverModal.style.display = 'none';
        
        handoverModal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <h2><i class="fas fa-handshake" style="color: #007bff; margin-right: 10px;"></i> Admin Hand Over</h2>
                <div id="handoverModalMessage" style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 4px;">
                    <!-- Message will be populated here -->
                </div>
                <form id="adminHandoverForm">
                    <div class="form-group">
                        <label for="handoverUserSelect">Select User to Hand Over To:</label>
                        <select id="handoverUserSelect" class="form-control" required>
                            <option value="">Select user to handover to...</option>
                        </select>
                        <small class="form-help">The store will be immediately assigned to this user</small>
                    </div>
                    <div class="form-group">
                        <label for="handoverRemarks">Remarks (Optional):</label>
                        <textarea id="handoverRemarks" class="form-control" rows="3" placeholder="Enter remarks about this handover..."></textarea>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary" id="cancelHandover">
                            Cancel
                        </button>
                        <button type="submit" class="btn btn-primary">
                            <i class="fas fa-handshake"></i> Confirm Hand Over
                        </button>
                    </div>
                </form>
            </div>
        `;
        
        document.body.appendChild(handoverModal);
        
        // Add event listeners
        const cancelBtn = handoverModal.querySelector('#cancelHandover');
        const form = handoverModal.querySelector('#adminHandoverForm');
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                debugLog('Admin handover cancelled');
                handoverModal.style.display = 'none';
                handoverStoreId = null;
                handoverStoreName = '';
            });
        }
        
        if (form) {
            form.addEventListener('submit', handleAdminHandover);
        }
        
        // Close modal when clicking outside
        handoverModal.addEventListener('click', (e) => {
            if (e.target === handoverModal) {
                handoverModal.style.display = 'none';
                handoverStoreId = null;
                handoverStoreName = '';
            }
        });
    }

    // Handle admin handover
    async function handleAdminHandover(event) {
        event.preventDefault();
        
        if (!handoverStoreId) return;
        
        const userSelect = document.getElementById('handoverUserSelect');
        const remarks = document.getElementById('handoverRemarks').value;
        const toUserId = userSelect.value;
        
        if (!toUserId) {
            alert('Please select a user to handover to.');
            return;
        }
        
        // Enforce: BOTH parties must be online for admin -> RQ handover
        const rt = (typeof window !== 'undefined') ? window.RealTimeHandover : null;
        if (!rt || !rt.isConnected) {
            alert('Real-time system is offline. Admin and RQ must both be online to handover.');
            return;
        }
        if (typeof rt.isUserOnline === 'function') {
            if (!rt.isUserOnline(toUserId)) {
                alert('Target user is offline. Both admin and RQ must be online to handover.');
                return;
            }
        } else {
            const online = Array.isArray(rt.onlineUsers) ? rt.onlineUsers : [];
            const isOnline = online.some(u => u.userId == toUserId);
            if (!isOnline) {
                alert('Target user is offline. Both admin and RQ must be online to handover.');
                return;
            }
        }

        debugLog('Processing admin handover', {
            storeId: handoverStoreId,
            storeName: handoverStoreName,
            fromUserId: userId,
            toUserId: toUserId,
            userRole: userRole
        });
        
        try {
            const response = await fetch(`/api/stores/${handoverStoreId}/handover`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    handed_over_by: userId,
                    handed_over_to: toUserId,
                    remarks: remarks || `Admin ${userName} handed over store ${handoverStoreName}`
                })
            });
            
            const result = await response.json();
            
            if (response.ok) {
                debugLog('Admin handover successful', result);
                alert(`Store "${handoverStoreName}" handed over successfully!\n\nNew holder: ${result.newHolder.rank} ${result.newHolder.name}`);
                handoverModal.style.display = 'none';
                handoverStoreId = null;
                handoverStoreName = '';
                fetchStores(); // Refresh store list
            } else {
                debugLog('Admin handover failed', result);
                alert(`Error: ${result.message}`);
            }
        } catch (error) {
            debugLog('Error during admin handover', error);
            console.error('Error during admin handover:', error);
            alert('An error occurred during handover: ' + error.message);
        }
    }

    // Generate QR Code for store (for HOTO form scanning)
    async function generateStoreQRCode(storeId, storeName) {
        try {
            debugLog('Generating QR code for store', { storeId, storeName });
            
            // Create QR code data in JSON format
            const qrData = {
                storeId: storeId.toString(),
                storeName: storeName,
                timestamp: Date.now(),
                type: 'STORE_QR',
                version: '2.0',
                humanReadable: `Store: ${storeName} (ID: ${storeId})`
            };
            
            const qrDataString = JSON.stringify(qrData);
            
            // Encrypt the data with sbedamien key
            const encryptedData = encryptData(qrDataString, ENCRYPTION_KEY);
            
            // Clear previous QR code
            qrCodeDisplay.innerHTML = '';
            
            // Generate new QR code with encrypted data
            try {
                // Use the QRCode library directly
                const qr = new QRCode(qrCodeDisplay, {
                    text: encryptedData,
                    width: 256,
                    height: 256,
                    colorDark: "#000000",
                    colorLight: "#ffffff",
                    correctLevel: QRCode.CorrectLevel.Q
                });
                
                debugLog('QR Code generated successfully');
                
            } catch (qrError) {
                debugLog('QR Code generation error', qrError);
                // Fallback: Show the data as text
                qrCodeDisplay.innerHTML = `
                    <div style="text-align: center; padding: 20px; background: #f8f9fa; border-radius: 8px;">
                        <h4>QR Code Generation Failed</h4>
                        <p>Please use this data manually:</p>
                        <div style="background: white; padding: 10px; border-radius: 4px; font-family: monospace; word-break: break-all; font-size: 12px; margin: 10px 0;">
                            <strong>Store ID:</strong> ${storeId}<br>
                            <strong>Store Name:</strong> ${storeName}<br>
                            <strong>Encrypted Data:</strong><br>
                            ${encryptedData}
                        </div>
                    </div>
                `;
            }
            
            // Update modal info
            qrStoreName.textContent = storeName;
            qrStoreId.textContent = storeId;
            
            // Show modal
            qrCodeModal.style.display = 'flex';
            
        } catch (error) {
            debugLog('Error generating QR code', error);
            console.error('Error generating QR code:', error);
            alert('Failed to generate QR code: ' + error.message);
        }
    }

    // Download QR Code
    function setupQRDownload() {
        if (downloadQRBtn) {
            downloadQRBtn.addEventListener('click', () => {
                const canvas = qrCodeDisplay.querySelector('canvas');
                if (canvas) {
                    const link = document.createElement('a');
                    link.download = `store-${qrStoreId.textContent}-qr.png`;
                    link.href = canvas.toDataURL('image/png');
                    link.click();
                    debugLog('QR code downloaded', { 
                        storeId: qrStoreId.textContent,
                        storeName: qrStoreName.textContent 
                    });
                } else {
                    alert('QR code not generated yet. Please try generating the QR code again.');
                }
            });
        }
    }

    // Print QR Code
    function setupQRPrint() {
        if (printQRBtn) {
            printQRBtn.addEventListener('click', () => {
                debugLog('Printing QR code', { 
                    storeId: qrStoreId.textContent,
                    storeName: qrStoreName.textContent 
                });
                const printWindow = window.open('', '_blank');
                printWindow.document.write(`
                    <html>
                    <head>
                        <title>Store QR Code - ${qrStoreName.textContent}</title>
                        <style>
                            body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
                            .qr-container { margin: 20px auto; text-align: center; }
                            .store-info { margin: 20px 0; }
                            .store-info h2 { color: #333; }
                            .store-info p { color: #666; }
                            @media print {
                                .no-print { display: none; }
                                button { display: none; }
                            }
                        </style>
                    </head>
                    <body>
                        <div class="store-info">
                            <h2>Store QR Code</h2>
                            <p><strong>Store:</strong> ${qrStoreName.textContent}</p>
                            <p><strong>Store ID:</strong> ${qrStoreId.textContent}</p>
                            <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
                        </div>
                        <div class="qr-container">
                            ${qrCodeDisplay.innerHTML}
                        </div>
                        <div class="instructions no-print">
                            <p><em>Scan this QR code with the HOTO form to initiate store handover</em></p>
                            <button onclick="window.print()" style="margin-top: 20px; padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
                                Print QR Code
                            </button>
                            <button onclick="window.close()" style="margin-top: 20px; padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">
                                Close
                            </button>
                        </div>
                    </body>
                    </html>
                `);
                printWindow.document.close();
            });
        }
    }

    // Confirm delete store
    function confirmDeleteStore(storeId, storeName) {
        deleteStoreId = storeId;
        deleteStoreName = storeName;
        
        debugLog('Confirming store deletion', { storeId, storeName });
        
        // Create confirmation modal if it doesn't exist
        if (!confirmDeleteModal) {
            createDeleteConfirmationModal();
        }
        
        // Update modal message
        const deleteMessage = confirmDeleteModal.querySelector('#deleteMessage');
        if (deleteMessage) {
            deleteMessage.textContent = `Are you sure you want to delete the store "${storeName}"? This action cannot be undone.`;
        }
        
        // Show modal
        confirmDeleteModal.style.display = 'flex';
    }

    // Create delete confirmation modal
    function createDeleteConfirmationModal() {
        confirmDeleteModal = document.createElement('div');
        confirmDeleteModal.id = 'confirmDeleteModal';
        confirmDeleteModal.className = 'modal-overlay';
        confirmDeleteModal.style.display = 'none';
        
        confirmDeleteModal.innerHTML = `
            <div class="modal-content">
                <h2><i class="fas fa-exclamation-triangle" style="color: #dc3545; margin-right: 10px;"></i> Confirm Delete</h2>
                <p id="deleteMessage">Are you sure you want to delete this store?</p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-secondary" id="cancelDelete">
                        Cancel
                    </button>
                    <button type="button" class="btn btn-danger" id="confirmDelete">
                        <i class="fas fa-trash"></i> Delete Store
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(confirmDeleteModal);
        
        // Add event listeners
        const cancelBtn = confirmDeleteModal.querySelector('#cancelDelete');
        const confirmBtn = confirmDeleteModal.querySelector('#confirmDelete');
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                debugLog('Store deletion cancelled');
                confirmDeleteModal.style.display = 'none';
            });
        }
        
        if (confirmBtn) {
            confirmBtn.addEventListener('click', handleDeleteStore);
        }
        
        // Close modal when clicking outside
        confirmDeleteModal.addEventListener('click', (e) => {
            if (e.target === confirmDeleteModal) {
                confirmDeleteModal.style.display = 'none';
            }
        });
    }

    // Handle store deletion
    async function handleDeleteStore() {
        if (!deleteStoreId) return;
        
        debugLog('Deleting store', { storeId: deleteStoreId, storeName: deleteStoreName });
        
        try {
            const response = await fetch(`/api/stores/${deleteStoreId}`, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (response.ok) {
                debugLog('Store deleted successfully', result);
                alert(`Store "${deleteStoreName}" deleted successfully!`);
                confirmDeleteModal.style.display = 'none';
                deleteStoreId = null;
                deleteStoreName = '';
                fetchStores(); // Refresh store list
            } else {
                debugLog('Store deletion failed', result);
                alert(`Error: ${result.message}`);
                confirmDeleteModal.style.display = 'none';
            }
        } catch (error) {
            debugLog('Error deleting store', error);
            console.error('Error deleting store:', error);
            alert('An error occurred while deleting the store.');
            confirmDeleteModal.style.display = 'none';
        }
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

    // Handle store creation
    async function handleCreateStore(event) {
        event.preventDefault();
        
        if (userRole !== 'MEC_OIC_ADMIN' && userRole !== 'RQ') {
            alert('Only Admin and RQ can create stores.');
            return;
        }
        
        const newStoreName = document.getElementById('newStoreName').value.trim();
        
        if (!newStoreName) {
            alert('Please enter a store name.');
            return;
        }

        debugLog('Creating new store', { 
            storeName: newStoreName, 
            userId: userId,
            userName: userName,
            userRole: userRole 
        });

        try {
            const response = await fetch('/api/stores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    name: newStoreName,
                    created_by_id: userId
                })
            });

            const result = await response.json();

            if (response.ok) {
                debugLog('Store created successfully', result);
                alert(`Store "${newStoreName}" created successfully!\n\nYou are now the owner of this store.`);
                addStoreModal.style.display = 'none';
                addStoreForm.reset();
                fetchStores(); // Refresh store list
            } else {
                debugLog('Store creation failed', result);
                alert(`Error: ${result.message}`);
            }
        } catch (error) {
            debugLog('Error creating store', error);
            console.error('Error creating store:', error);
            alert('An error occurred while creating the store.');
        }
    }

    // Initialize event listeners
    function initEventListeners() {
        // Add store modal
        if (addStoreBtn) {
            addStoreBtn.addEventListener('click', () => {
                if (userRole === 'MEC_OIC_ADMIN' || userRole === 'RQ') {
                    addStoreModal.style.display = 'flex';
                    document.getElementById('newStoreName').focus();
                    debugLog('Add store modal opened', { userRole });
                } else {
                    alert('Only Admin and RQ can create stores.');
                }
            });
        }

        // Close modal buttons
        if (closeButton) {
            closeButton.addEventListener('click', () => {
                debugLog('Add store modal closed');
                addStoreModal.style.display = 'none';
                addStoreForm.reset();
            });
        }

        if (qrCloseButton) {
            qrCloseButton.addEventListener('click', () => {
                debugLog('QR code modal closed');
                qrCodeModal.style.display = 'none';
                qrCodeDisplay.innerHTML = ''; // Clear QR code
            });
        }

        // Close modals when clicking outside
        window.addEventListener('click', (event) => {
            if (event.target == addStoreModal) {
                debugLog('Add store modal closed (outside click)');
                addStoreModal.style.display = 'none';
                addStoreForm.reset();
            }
            if (event.target == qrCodeModal) {
                debugLog('QR code modal closed (outside click)');
                qrCodeModal.style.display = 'none';
                qrCodeDisplay.innerHTML = ''; // Clear QR code
            }
        });

        // Form submission
        if (addStoreForm) {
            addStoreForm.addEventListener('submit', handleCreateStore);
        }

        // Setup QR code buttons
        setupQRDownload();
        setupQRPrint();
    }

    // Initialize everything
    function init() {
        debugLog('Initializing stores.js', {
            userRole,
            userId,
            userName,
            userRank,
            debugMode: DEBUG_MODE,
            encryptionKey: DEBUG_MODE ? ENCRYPTION_KEY : '[HIDDEN]',
            timestamp: new Date().toISOString()
        });
        
        initEventListeners();
        fetchStores();
        
        // Update date/time every minute
        setInterval(updateDateTime, 60000);
    }

    // Start the application
    init();
});