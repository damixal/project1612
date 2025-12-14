// hoto-forms-fill.js - CORRECTED WITH IMPROVED QR PARSING AND TEAM VALIDATION
document.addEventListener('DOMContentLoaded', () => {
    // Form elements
    const form = document.getElementById('hotoMultiStepForm');
    const sections = document.querySelectorAll('.form-section');
    const currentStepEl = document.getElementById('currentStep');
    const totalStepsEl = document.getElementById('totalSteps');
    const nextButtons = document.querySelectorAll('.next-button');
    const backButtons = document.querySelectorAll('.back-button');
    
    // Step 1 elements
    const storeSelect = document.getElementById('storeSelect');
    const userInfo = document.getElementById('userInfo');
    const userRoleBadge = document.getElementById('userRoleBadge');
    const storePreview = document.getElementById('storePreview');
    const previewStoreName = document.getElementById('previewStoreName');
    const previewStoreId = document.getElementById('previewStoreId');
    const previewStoreStatus = document.getElementById('previewStoreStatus');
    const previewStoreHolder = document.getElementById('previewStoreHolder');
    const previewStoreTeam = document.getElementById('previewStoreTeam');
    const previewStoreCreator = document.getElementById('previewStoreCreator');
    
    // Step 2 elements (QR Verification)
    const selectedStoreName = document.getElementById('selectedStoreName');
    const selectedStoreId = document.getElementById('selectedStoreId');
    const expectedQRData = document.getElementById('expectedQRData');
    const startScannerBtn = document.getElementById('startScannerBtn');
    const stopScannerBtn = document.getElementById('stopScannerBtn');
    const scannerContainer = document.getElementById('scannerContainer');
    const scannerStatus = document.getElementById('scannerStatus');
    const scanSuccess = document.getElementById('scanSuccess');
    const scanError = document.getElementById('scanError');
    const errorText = document.getElementById('errorText');
    const nextAfterScan = document.getElementById('nextAfterScan');
    
    // Step 3 elements
    const verifiedStoreName = document.getElementById('verifiedStoreName');
    const verifiedStoreId = document.getElementById('verifiedStoreId');
    const verifiedStoreTeam = document.getElementById('verifiedStoreTeam');
    const handoverToUserSelect = document.getElementById('handoverToUser');
    // --- Trade-style pairing UI (Pokemon Go style: no user list) ---
    const TRADE_PAGE_KEY = 'hoto-forms-fill.html';
    let tradeState = {
        looking: false,
        storeId: null,
        matchId: null,
        partner: null
    };

    let tradeUI = {
        container: null,
        pairBtn: null,
        cancelBtn: null,
        statusEl: null
    };

    function initTradePairingUI() {
        if (!handoverToUserSelect) return;

        // Keep the <select> for validation + submission, but hide it so users can't browse a list
        handoverToUserSelect.style.display = 'none';

        tradeUI.container = document.createElement('div');
        tradeUI.container.id = 'tradePairingUI';
        tradeUI.container.style.cssText = `
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
            margin-top: 6px;
        `;

        tradeUI.pairBtn = document.createElement('button');
        tradeUI.pairBtn.type = 'button';
        tradeUI.pairBtn.id = 'pairUserBtn';
        tradeUI.pairBtn.className = 'btn btn-primary';
        tradeUI.pairBtn.innerHTML = '<i class="fas fa-link"></i> Pair with user on this page';

        tradeUI.cancelBtn = document.createElement('button');
        tradeUI.cancelBtn.type = 'button';
        tradeUI.cancelBtn.id = 'cancelPairBtn';
        tradeUI.cancelBtn.className = 'btn btn-secondary';
        tradeUI.cancelBtn.innerHTML = '<i class="fas fa-ban"></i> Cancel';
        tradeUI.cancelBtn.style.display = 'none';

        tradeUI.statusEl = document.createElement('div');
        tradeUI.statusEl.id = 'tradeStatusText';
        tradeUI.statusEl.style.cssText = `
            font-size: 13px;
            color: #6c757d;
            display: flex;
            align-items: center;
            gap: 6px;
        `;
        tradeUI.statusEl.innerHTML = '<i class="fas fa-info-circle"></i> Not paired yet.';

        // Insert UI right after the select element
        handoverToUserSelect.insertAdjacentElement('afterend', tradeUI.container);
        tradeUI.container.appendChild(tradeUI.pairBtn);
        tradeUI.container.appendChild(tradeUI.cancelBtn);
        tradeUI.container.appendChild(tradeUI.statusEl);

        tradeUI.pairBtn.addEventListener('click', startTradePairing);
        tradeUI.cancelBtn.addEventListener('click', cancelTradePairing);
    }

    function setTradeStatus(text, iconClass = 'fa-info-circle') {
        if (!tradeUI.statusEl) return;
        tradeUI.statusEl.innerHTML = `<i class="fas ${iconClass}"></i> ${text}`;
    }

    function clearSelectedHandoverUser() {
        selectedHandoverUser = null;
        handoverToUserSelect.value = '';
        toUserName.textContent = 'Select user above';
        toUserRank.textContent = '-';
        toUserRole.textContent = '-';
        if (summaryHandoverTo) summaryHandoverTo.textContent = '';
        tradeState.matchId = null;
        tradeState.partner = null;
    }

    function startTradePairing() {
        if (!selectedStore || !selectedStore.id) {
            alert('Please select a store first.');
            return;
        }

        if (!realTimeHandover || !realTimeHandover.isConnected) {
            alert('Real-time system is offline. Please refresh or check the WebSocket server.');
            return;
        }

        // Reset any previous selection
        clearSelectedHandoverUser();

        tradeState.looking = true;
        tradeState.storeId = selectedStore.id;

        tradeUI.pairBtn.disabled = true;
        tradeUI.cancelBtn.style.display = 'inline-block';
        setTradeStatus('Looking for another user on this page... (they must click Pair too)', 'fa-signal');

        realTimeHandover.joinPage(TRADE_PAGE_KEY, selectedStore.id);
        realTimeHandover.startTradeLooking(TRADE_PAGE_KEY, selectedStore.id, selectedStore.name);
    }

    function cancelTradePairing() {
        if (!tradeState.looking) {
            setTradeStatus('Not paired yet.', 'fa-info-circle');
            return;
        }

        tradeState.looking = false;
        tradeUI.pairBtn.disabled = false;
        tradeUI.cancelBtn.style.display = 'none';
        setTradeStatus('Pairing cancelled.', 'fa-ban');

        if (realTimeHandover && realTimeHandover.isConnected && tradeState.storeId) {
            realTimeHandover.cancelTradeLooking(TRADE_PAGE_KEY, tradeState.storeId);
        }

        tradeState.storeId = null;
    }

    function handleTradePaired(data) {
        if (!data || !data.partner) return;

        // Only accept pairing for the currently-selected store (avoid stale matches)
        if (selectedStore && String(data.storeId) !== String(selectedStore.id)) {
            debugLog('Ignoring trade pair for different store', { pairedStoreId: data.storeId, currentStoreId: selectedStore.id }, 'warn');
            return;
        }

        tradeState.looking = false;
        tradeState.matchId = data.matchId;
        tradeState.partner = data.partner;

        tradeUI.pairBtn.disabled = false;
        tradeUI.cancelBtn.style.display = 'none';

        setTradeStatus(`Paired with ${data.partner.userName} (${data.partner.userRole}).`, 'fa-link');

        // Ensure select contains the paired user for existing validation/submission code
        handoverToUserSelect.innerHTML = '';
        const opt = document.createElement('option');
        opt.value = data.partner.userId;
        opt.textContent = `${data.partner.userName} (${data.partner.userRole})`;
        handoverToUserSelect.appendChild(opt);
        handoverToUserSelect.value = data.partner.userId;

        // Map to full user record if available, otherwise fetch from API
        const existing = allUsers.find(u => u.id == data.partner.userId);
        if (existing) {
            selectedHandoverUser = existing;
            handleHandoverUserChange();
            return;
        }

        // Fallback fetch (in case /api/users doesn't include this user for some reason)
        fetch('/api/users')
            .then(r => r.json())
            .then(users => {
                const u = users.find(x => x.id == data.partner.userId);
                if (u) {
                    selectedHandoverUser = u;
                    allUsers.push(u);
                    handleHandoverUserChange();
                }
            })
            .catch(() => {});
    }

    function handleTradeStatus(data) {
        if (!data) return;

        if (data.status === 'looking') {
            // Keep current text
            return;
        }

        if (data.status === 'cancelled') {
            if (tradeState.looking) {
                tradeState.looking = false;
                tradeUI.pairBtn.disabled = false;
                tradeUI.cancelBtn.style.display = 'none';
                setTradeStatus('Pairing cancelled.', 'fa-ban');
            }
        }
    }

    const fromUserName = document.getElementById('fromUserName');
    const fromUserRank = document.getElementById('fromUserRank');
    const fromUserRole = document.getElementById('fromUserRole');
    const toUserName = document.getElementById('toUserName');
    const toUserRank = document.getElementById('toUserRank');
    const toUserRole = document.getElementById('toUserRole');
    const mobileNumberInput = document.getElementById('mobileNumber');
    const dateHOTOInput = document.getElementById('dateHOTO');
    
    // Step 4 elements
    const summaryStoreName = document.getElementById('summaryStoreName');
    const summaryStoreId = document.getElementById('summaryStoreId');
    const summaryStoreTeam = document.getElementById('summaryStoreTeam');
    const summaryHotoType = document.getElementById('summaryHotoType');
    const summaryHandoverTo = document.getElementById('summaryHandoverTo');
    const summaryUserName = document.getElementById('summaryUserName');
    const summaryDate = document.getElementById('summaryDate');
    const summaryMobile = document.getElementById('summaryMobile');
    const storeConditionRadios = document.querySelectorAll('input[name="storeCondition"]');
    const issueReportingSection = document.getElementById('issue-reporting-section');
    const submitButton = document.getElementById('submit-hoto-btn');
    
    // Modal elements
    const successModal = document.getElementById('successModal');
    const errorModal = document.getElementById('errorModal');
    const successMessage = document.getElementById('successMessage');
    const errorMessage = document.getElementById('errorMessage');
    const closeErrorModal = document.getElementById('closeErrorModal');
    const goToRecordsBtn = document.getElementById('goToRecordsBtn');
    const startNewHotoBtn = document.getElementById('startNewHotoBtn');
    const goToHomeBtn = document.getElementById('goToHomeBtn');
    
    // State
    let currentStep = 1;
    let selectedStore = null;
    let selectedHandoverUser = null;
    let allStores = [];
    let allUsers = [];
    let currentUser = {};
    let isQRVerified = false;
    let qrScanner = null;
    let videoStream = null;
    
    // Configuration
    const ENCRYPTION_KEY = 'sbedamien';
    const DEBUG_MODE = true;
    
    // Set total steps
    totalStepsEl.textContent = sections.length;
    
    // Debug logging function
    function debugLog(message, data = null, level = 'info') {
        if (DEBUG_MODE) {
            const timestamp = new Date().toISOString();
            const logLevel = level.toUpperCase();
            console.log(`🔍 [HOTO DEBUG ${logLevel}] ${timestamp} - ${message}`);
            if (data) {
                console.log('📊 Data:', data);
            }
        }
    }
    
    // Improved decryption function with better error handling
    function decryptData(encryptedData, key) {
        try {
            debugLog('Attempting to decrypt data', { 
                dataLength: encryptedData?.length,
                isBase64: /^[A-Za-z0-9+/]+=*$/.test(encryptedData)
            }, 'debug');
            
            if (!encryptedData || encryptedData.length < 4) {
                throw new Error('Invalid encrypted data: too short or empty');
            }
            
            // Base64 decode first
            let decoded;
            try {
                decoded = atob(encryptedData);
            } catch (e) {
                debugLog('Not base64, trying direct XOR', e.message, 'debug');
                decoded = encryptedData; // Not base64, try direct XOR
            }
            
            let decrypted = '';
            
            // XOR decryption
            for (let i = 0; i < decoded.length; i++) {
                const keyChar = key.charCodeAt(i % key.length);
                const dataChar = decoded.charCodeAt(i);
                decrypted += String.fromCharCode(dataChar ^ keyChar);
            }
            
            debugLog('Decryption successful', { 
                encryptedLength: encryptedData.length,
                decryptedLength: decrypted.length,
                preview: decrypted.substring(0, 100)
            }, 'success');
            
            return decrypted;
        } catch (error) {
            debugLog('Decryption failed', { 
                error: error.message,
                encryptedData: encryptedData?.substring(0, 50) + '...'
            }, 'error');
            throw new Error('Failed to decrypt QR code data: ' + error.message);
        }
    }
    
    // IMPROVED QR CODE PARSING FUNCTION
    function parseQRCodeData(qrData) {
        debugLog('Parsing QR data', { 
            qrData: qrData?.substring(0, 100),
            length: qrData?.length 
        });
        
        if (!qrData || qrData.trim() === '') {
            throw new Error('Empty QR code data');
        }
        
        let parsedData = {};
        const cleanData = qrData.trim();
        
        // Try different formats in order
        
        // 1. Try to decrypt first (if it looks encrypted)
        if (cleanData.length > 20 && !cleanData.startsWith('{') && !cleanData.startsWith('STORE:')) {
            try {
                const decrypted = decryptData(cleanData, ENCRYPTION_KEY);
                debugLog('Successfully decrypted data', { decrypted: decrypted.substring(0, 100) }, 'success');
                
                // Try to parse decrypted data as JSON
                if (decrypted.startsWith('{')) {
                    parsedData = JSON.parse(decrypted);
                    parsedData.source = 'encrypted_json';
                } else {
                    // If not JSON, try other formats
                    return parsePlainQRData(decrypted);
                }
            } catch (decryptError) {
                debugLog('Decryption failed, trying plain text', decryptError.message, 'warn');
                // If decryption fails, try parsing as plain text
                return parsePlainQRData(cleanData);
            }
        } else {
            // Not encrypted, parse as plain text
            return parsePlainQRData(cleanData);
        }
        
        return parsedData;
    }

    // Add WebSocket connection at the top of the file
    let realTimeHandover = null;

    // Initialize real-time system
    function initRealTimeHandover() {
        const userId = localStorage.getItem('loggedInUserId');
        const userName = localStorage.getItem('loggedInUserName');
        const userRole = localStorage.getItem('loggedInUserRole');
        
        if (!userId || !userName || !userRole) {
            debugLog('Cannot initialize real-time: Missing user info', 'warn');
            return;
        }
        
        // Create or get real-time instance
        if (window.RealTimeHandover) {
            realTimeHandover = window.RealTimeHandover;
        } else {
            // Fallback: Create simple WebSocket connection
            realTimeHandover = {
                isConnected: false,
                onlineUsers: [],
                connect: function () { this.isConnected = true; },
                disconnect: function () { this.isConnected = false; },
                getAvailableHandoverUsers: () => [],
                sendHandoverRequest: () => false,
                canHandoverTo: () => false
            };
        }
        
        // Connect to real-time server
        realTimeHandover.connect(userId, userName, userRole);

        // Join presence for this page (used for trade-style pairing)
        if (realTimeHandover.joinPage) {
            realTimeHandover.joinPage(TRADE_PAGE_KEY, null);
        }

        // Pairing callbacks
        realTimeHandover.onTradePaired = handleTradePaired;
        realTimeHandover.onTradeStatus = handleTradeStatus;

// Set up callbacks
        realTimeHandover.onHandoverInvitation = handleHandoverInvitation;
        realTimeHandover.onOnlineUsersUpdate = updateOnlineUsersList;
        realTimeHandover.onConnectionStatusChange = updateConnectionStatus;
        
        debugLog('Real-time handover initialized', { userId, userName, userRole });
    }

    // Handle handover invitation
function handleHandoverInvitation(data) {
    debugLog('Received handover invitation', data, 'info');
    
    // Create notification modal
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.style.zIndex = '10000';
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px;">
            <h2><i class="fas fa-handshake" style="color: #007bff;"></i> Handover Request</h2>
            <div class="handover-invitation-details">
                <p><strong>From:</strong> ${data.fromUserName} (${data.fromUserRole})</p>
                <p><strong>Store:</strong> ${data.storeName} (ID: ${data.storeId})</p>
                <p><strong>Time:</strong> ${new Date(data.timestamp).toLocaleString()}</p>
                ${data.remarks ? `<p><strong>Remarks:</strong> ${data.remarks}</p>` : ''}
            </div>
            <div class="modal-actions">
                <button id="acceptHandoverBtn" class="btn btn-success">
                    <i class="fas fa-check"></i> Accept
                </button>
                <button id="rejectHandoverBtn" class="btn btn-danger">
                    <i class="fas fa-times"></i> Reject
                </button>
                <button id="closeHandoverModal" class="btn btn-secondary">
                    <i class="fas fa-times-circle"></i> Close
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Add event listeners
    document.getElementById('acceptHandoverBtn').addEventListener('click', () => {
        if (realTimeHandover) {
            realTimeHandover.respondToHandover(data.fromUserId, true, 'Accepted via web interface');
        }
        modal.remove();
        
        // Redirect to accept the handover
        localStorage.setItem('pendingHandover', JSON.stringify(data));
        alert(`You accepted the handover request for store "${data.storeName}". Please complete the handover process.`);
    });
    
    document.getElementById('rejectHandoverBtn').addEventListener('click', () => {
        const reason = prompt('Please provide a reason for rejecting:');
        if (realTimeHandover) {
            realTimeHandover.respondToHandover(data.fromUserId, false, reason || 'No reason provided');
        }
        modal.remove();
        alert('Handover request rejected.');
    });
    
    document.getElementById('closeHandoverModal').addEventListener('click', () => {
        modal.remove();
    });
    
    // Close when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// Update online users list
function updateOnlineUsersList(onlineUsers) {
    debugLog('Online users updated', { count: onlineUsers.length });
    
    // Update the handover user dropdown with only online users
    if (handoverToUserSelect) {
        const currentValue = handoverToUserSelect.value;
        
        // Filter online users based on team rules
        const availableUsers = onlineUsers.filter(targetUser => {
            return canHandoverToUser(targetUser.userRole);
        });
        
        // Update dropdown
        handoverToUserSelect.innerHTML = '<option value="">Select online user to handover to...</option>';
        
        if (availableUsers.length === 0) {
            handoverToUserSelect.innerHTML = `
                <option value="">No online users available for handover</option>
                <option value="" disabled>You can only handover to users from the opposite team</option>
            `;
            return;
        }
        
        availableUsers.forEach(user => {
            const option = document.createElement('option');
            option.value = user.userId;
            option.textContent = `${user.userName} (${user.userRole}) - ONLINE`;
            option.dataset.user = JSON.stringify(user);
            handoverToUserSelect.appendChild(option);
        });
        
        // Restore previous selection if still valid
        if (currentValue) {
            const stillAvailable = availableUsers.some(u => u.userId == currentValue);
            if (stillAvailable) {
                handoverToUserSelect.value = currentValue;
                handleHandoverUserChange();
            }
        }
    }
}

// Check if current user can handover to target user based on team
function canHandoverToUser(targetUserRole) {
    const currentUserRole = currentUser.role;
    
    // Team A: MEC_OIC_ADMIN, MEMBER
    // Team B: RQ
    
    const teamA = ['MEC_OIC_ADMIN', 'MEMBER'];
    const teamB = ['RQ'];
    
    const currentTeam = teamA.includes(currentUserRole) ? 'TEAM_A' : 'TEAM_B';
    const targetTeam = teamA.includes(targetUserRole) ? 'TEAM_A' : 'TEAM_B';
    
    // Cannot handover within same team (except admin<->member within TEAM_A)
    if (currentTeam === targetTeam) {
        // Allow admin to handover to member (both TEAM_A)
        if (currentUserRole === 'MEC_OIC_ADMIN' && targetUserRole === 'MEMBER') {
            return true;
        }
        // Allow member to handover to admin (both TEAM_A)
        if (currentUserRole === 'MEMBER' && targetUserRole === 'MEC_OIC_ADMIN') {
            return true;
        }
        // Disallow other same-team handovers
        return false;
    }
    
    // Allow cross-team handovers
    return true;
}

// Update connection status display
function updateConnectionStatus(isConnected) {
    debugLog('Connection status changed', { isConnected });
    
    // Add connection status indicator to UI
    let statusIndicator = document.getElementById('connectionStatus');
    if (!statusIndicator) {
        statusIndicator = document.createElement('div');
        statusIndicator.id = 'connectionStatus';
        statusIndicator.style.position = 'fixed';
        statusIndicator.style.top = '10px';
        statusIndicator.style.right = '10px';
        statusIndicator.style.padding = '5px 10px';
        statusIndicator.style.borderRadius = '4px';
        statusIndicator.style.fontSize = '12px';
        statusIndicator.style.zIndex = '1000';
        document.body.appendChild(statusIndicator);
    }
    
    if (isConnected) {
        statusIndicator.textContent = '🟢 Online';
        statusIndicator.style.background = '#d4edda';
        statusIndicator.style.color = '#155724';
        statusIndicator.style.border = '1px solid #c3e6cb';
    } else {
        statusIndicator.textContent = '🔴 Offline';
        statusIndicator.style.background = '#f8d7da';
        statusIndicator.style.color = '#721c24';
        statusIndicator.style.border = '1px solid #f5c6cb';
    }
}

// Update loadUsers function to work with real-time
async function loadUsers() {
    try {
        // First, try to get online users from real-time system
        if (realTimeHandover && realTimeHandover.isConnected) {
            // Request online users list
            realTimeHandover.requestOnlineUsers();
            
            // Also load all users from API as fallback
            const response = await fetch('/api/users');
            if (!response.ok) throw new Error('Failed to fetch users');
            
            allUsers = await response.json();
            
            // Filter out current user
            const currentUserId = currentUser.id;
            allUsers = allUsers.filter(user => user.id != currentUserId);
            
            debugLog('All users loaded from API', {
                totalUsers: allUsers.length
            });
            
        } else {
            // Fallback: Load all users from API
            const response = await fetch('/api/users');
            if (!response.ok) throw new Error('Failed to fetch users');
            
            allUsers = await response.json();
            
            // Filter out current user
            const currentUserId = currentUser.id;
            allUsers = allUsers.filter(user => user.id != currentUserId);
            
            // Filter by team rules
            const filteredUsers = allUsers.filter(user => {
                return canHandoverToUser(user.role);
            });
            
            populateUserSelect(filteredUsers);
            
            debugLog('Users loaded (offline mode)', {
                totalUsers: allUsers.length,
                availableForHandover: filteredUsers.length
            });
        }
        
    } catch (error) {
        debugLog('Error loading users', error, 'error');
        handoverToUserSelect.innerHTML = '<option value="">Error loading users</option>';
    }
}

// Update the populateUserSelect function
function populateUserSelect(users) {
    handoverToUserSelect.innerHTML = '<option value="">Select user to handover to...</option>';
    
    if (users.length === 0) {
        handoverToUserSelect.innerHTML = `
            <option value="">No users available for handover</option>
            <option value="" disabled>Team restrictions apply. You can only handover to users from the opposite team.</option>
        `;
        return;
    }
    
    users.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        
        let statusText = ' (OFFLINE)';
        if (realTimeHandover && realTimeHandover.onlineUsers) {
            const isOnline = realTimeHandover.onlineUsers.some(onlineUser => onlineUser.userId == user.id);
            statusText = isOnline ? ' (ONLINE)' : ' (OFFLINE)';
        }
        
        let roleText = '';
        switch(user.role) {
            case 'MEC_OIC_ADMIN':
                roleText = 'Admin';
                break;
            case 'RQ':
                roleText = 'RQ';
                break;
            case 'MEMBER':
                roleText = 'Member';
                break;
        }
        
        option.textContent = `${user.rank} ${user.name} (${roleText})${statusText}`;
        option.dataset.user = JSON.stringify(user);
        handoverToUserSelect.appendChild(option);
    });
}

// Update submitHOTOForm function to use real-time handover
async function submitHOTOForm() {
    try {
        debugLog('Submitting HOTO form...', {
            storeId: selectedStore.id,
            storeName: selectedStore.name,
            handoverTo: selectedHandoverUser?.id,
            qrVerified: isQRVerified
        });
        
        if (!selectedHandoverUser) {
            throw new Error('Please select a user to hand over to.');
        }
        
        if (!isQRVerified) {
            throw new Error('Store QR code must be verified before submission.');
        }
        
        // Check if target user is online (if using real-time)
        if (realTimeHandover && realTimeHandover.isConnected) {
            const isTargetOnline = realTimeHandover.onlineUsers.some(u => u.userId == selectedHandoverUser.id);
            
            if (!isTargetOnline) {
                const proceed = confirm(`Target user is offline. They won't receive real-time notification.\n\nDo you want to proceed with handover?`);
                if (!proceed) {
                    return;
                }
            }
        }
        
        // Use real-time handover if available and target is online
        if (realTimeHandover && realTimeHandover.isConnected) {
            const isTargetOnline = realTimeHandover.onlineUsers.some(u => u.userId == selectedHandoverUser.id);
            
            if (isTargetOnline) {
                // Send real-time handover request
                const success = realTimeHandover.sendHandoverRequest(
                    selectedHandoverUser.id,
                    selectedStore.id,
                    selectedStore.name,
                    document.getElementById('remarks').value || ''
                );
                
                if (success) {
                    // Wait for response or proceed with normal handover
                    const waitForResponse = confirm('Handover request sent. Wait for acceptance?');
                    
                    if (waitForResponse) {
                        // Show waiting message
                        showNotification('info', 'Waiting for handover acceptance...');
                        return; // Don't proceed with API handover yet
                    }
                }
            }
        }
        
        // Proceed with normal API-based handover
        const hotoData = {
            store_id: selectedStore.id,
            store_name: selectedStore.name,
            user_id: currentUser.id,
            user_name: currentUser.name,
            user_rank: currentUser.rank,
            mobile_number: mobileNumberInput.value,
            hoto_type: 'Hand Over',
            hoto_date: dateHOTOInput.value,
            store_condition: document.querySelector('input[name="storeCondition"]:checked').value,
            issue_description: document.getElementById('issue-description').value || '',
            issue_notification: document.getElementById('issue-notification').value || '',
            issue_resolved: document.getElementById('issue-resolved-checkbox').checked,
            remarks: document.getElementById('remarks').value || '',
            handover_to_user_id: selectedHandoverUser.id,
            qr_verified: isQRVerified
        };
        
        // Start HOTO
        const startResponse = await fetch('/api/hoto/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                store_id: hotoData.store_id,
                store_name: hotoData.store_name,
                user_id: hotoData.user_id,
                user_name: hotoData.user_name,
                user_rank: hotoData.user_rank,
                mobile_number: hotoData.mobile_number,
                hoto_type: hotoData.hoto_type,
                hoto_date: hotoData.hoto_date
            })
        });
        
        const startResult = await startResponse.json();
        
        if (!startResponse.ok) {
            throw new Error(startResult.message || 'Failed to start Hand Over');
        }
        
        debugLog('HOTO started successfully', startResult);
        
        // Handover store to selected user
        const handoverResponse = await fetch(`/api/stores/${hotoData.store_id}/handover`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                handed_over_by: hotoData.user_id,
                handed_over_to: hotoData.handover_to_user_id,
                remarks: hotoData.remarks || `Handed over by ${hotoData.user_name} to ${selectedHandoverUser.name}`
            })
        });
        
        if (!handoverResponse.ok) {
            const handoverResult = await handoverResponse.json();
            debugLog('Store handover failed (non-critical)', handoverResult, 'warn');
        }
        
        // Complete HOTO
        const completeResponse = await fetch(`/api/hoto/complete/${startResult.hotoId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                box_condition: hotoData.store_condition === 'Yes' ? 'YES' : 'NO',
                issue_description: hotoData.issue_description,
                issue_notification: hotoData.issue_notification,
                issue_resolved: hotoData.issue_resolved,
                authorized_by: '',
                witnessed_by: ''
            })
        });
        
        const completeResult = await completeResponse.json();
        
        if (!completeResponse.ok) {
            throw new Error(completeResult.message || 'Failed to complete Hand Over');
        }
        
        debugLog('HOTO completed successfully', completeResult);
        
        // Success message
        let successMsg = `Hand Over completed successfully!`;
        if (selectedHandoverUser) {
            successMsg += `\nStore "${selectedStore.name}" handed over to ${selectedHandoverUser.rank} ${selectedHandoverUser.name}`;
        }
        
        successMessage.textContent = successMsg;
        successModal.style.display = 'flex';
        
    } catch (error) {
        debugLog('Error submitting Hand Over', error, 'error');
        errorMessage.textContent = error.message;
        errorModal.style.display = 'flex';
    }
}

// Helper function to show notifications
function showNotification(type, message) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${type === 'success' ? '#d4edda' : type === 'error' ? '#f8d7da' : '#fff3cd'};
        color: ${type === 'success' ? '#155724' : type === 'error' ? '#721c24' : '#856404'};
        border: 1px solid ${type === 'success' ? '#c3e6cb' : type === 'error' ? '#f5c6cb' : '#ffeaa7'};
        border-radius: 4px;
        z-index: 10000;
        max-width: 400px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    `;
    
    notification.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between;">
            <span>${message}</span>
            <button class="close-notification" style="
                background: none;
                border: none;
                font-size: 20px;
                cursor: pointer;
                margin-left: 10px;
                color: inherit;
            ">×</button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Add close event
    notification.querySelector('.close-notification').addEventListener('click', () => {
        notification.remove();
    });
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 5000);
}

    
    // Helper function to parse plain QR data
    function parsePlainQRData(data) {
        debugLog('Parsing plain QR data', { data: data.substring(0, 100) });
        
        // 1. Try JSON format
        if (data.startsWith('{')) {
            try {
                const jsonData = JSON.parse(data);
                jsonData.source = 'plain_json';
                return jsonData;
            } catch (e) {
                debugLog('Not valid JSON', e.message, 'debug');
            }
        }
        
        // 2. Try STORE:ID:NAME format
        if (data.startsWith('STORE:')) {
            const parts = data.split(':');
            if (parts.length >= 3) {
                return {
                    storeId: parts[1],
                    storeName: parts[2],
                    type: 'STORE_SIMPLE',
                    source: 'store_format'
                };
            }
        }
        
        // 3. Try to extract store ID from any text
        const storeIdMatch = data.match(/storeId["\s:]+(\d+)/i) || 
                             data.match(/id["\s:]+(\d+)/i) ||
                             data.match(/(\d{3,})/); // Look for 3+ digit number
        
        const storeNameMatch = data.match(/storeName["\s:]+([^,}\s]+)/i) ||
                               data.match(/name["\s:]+([^,}\s]+)/i);
        
        if (storeIdMatch) {
            return {
                storeId: storeIdMatch[1],
                storeName: storeNameMatch ? storeNameMatch[1] : 'Unknown Store',
                type: 'EXTRACTED',
                source: 'text_extraction',
                rawData: data.substring(0, 100)
            };
        }
        
        // 4. If it's just a number, assume it's store ID
        if (/^\d+$/.test(data)) {
            return {
                storeId: data,
                storeName: 'Store ' + data,
                type: 'NUMERIC_ID',
                source: 'numeric_only'
            };
        }
        
        throw new Error('Could not parse QR code data. Format not recognized.');
    }
    
    // Load user information
    function loadUserInfo() {
        const userName = localStorage.getItem('loggedInUserName');
        const userRank = localStorage.getItem('loggedInUserRank');
        const userRole = localStorage.getItem('loggedInUserRole');
        const userId = localStorage.getItem('loggedInUserId');
        
        debugLog('Loading user info', { userName, userRank, userRole, userId });
        
        // If userId is not in localStorage, we need to get it from the server
        if (!userId || !userName) {
            fetchUserInfoFromServer(userName);
            return;
        }
        
        currentUser = {
            id: userId,
            name: userName,
            rank: userRank,
            role: userRole
        };
        
        if (userInfo && userName && userRank) {
            userInfo.textContent = `${userRank} ${userName}`;
        }
        
        if (userRoleBadge && userRole) {
            userRoleBadge.textContent = userRole.replace('_', ' ');
            userRoleBadge.className = `role-badge role-${userRole.toLowerCase()}`;
        }
        
        if (fromUserName && userName) {
            fromUserName.textContent = userName;
        }
        
        if (fromUserRank && userRank) {
            fromUserRank.textContent = userRank;
        }
        
        if (fromUserRole && userRole) {
            fromUserRole.textContent = userRole.replace('_', ' ');
        }
        
        if (summaryUserName && userName) {
            summaryUserName.textContent = `${userRank} ${userName}`;
        }
        
        // Set current date
        if (dateHOTOInput) {
            const today = new Date().toISOString().split('T')[0];
            dateHOTOInput.value = today;
            dateHOTOInput.min = today; // Can't select past dates
        }
        
        // Set HOTO type to "Hand Over" by default
        summaryHotoType.textContent = 'Hand Over';
        
        // Pre-fill mobile number if available
        const userPhone = localStorage.getItem('loggedInUserPhone');
        if (mobileNumberInput && userPhone) {
            mobileNumberInput.value = userPhone;
        }
    }
    
    async function fetchUserInfoFromServer(userName) {
        try {
            const response = await fetch('/api/user-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: userName })
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch user info');
            }
            
            const userData = await response.json();
            
            // Store in localStorage
            localStorage.setItem('loggedInUserId', userData.id);
            localStorage.setItem('loggedInUserName', userData.name);
            localStorage.setItem('loggedInUserRank', userData.rank);
            localStorage.setItem('loggedInUserRole', userData.role);
            
            // Reload the page with proper user info
            location.reload();
            
        } catch (error) {
            debugLog('Error fetching user info', error, 'error');
            alert('Error loading user information. Please log in again.');
            window.location.href = 'login.html';
        }
    }
    
    // Load stores for selection
    async function loadStores() {
        try {
            const response = await fetch('/api/stores');
            if (!response.ok) throw new Error('Failed to fetch stores');
            
            allStores = await response.json();
            debugLog('Stores loaded', { count: allStores.length });
            populateStoreSelect();
            
        } catch (error) {
            debugLog('Error loading stores', error, 'error');
            storeSelect.innerHTML = '<option value="">Error loading stores</option>';
        }
    }
    
    // CORRECTED: Populate store dropdown with proper filtering
    function populateStoreSelect() {
        storeSelect.innerHTML = '<option value="">Select a Store to Hand Over</option>';
        
        const userRole = currentUser.role;
        const userId = currentUser.id;
        
        debugLog('Filtering stores for user', {
            userRole: userRole,
            userId: userId,
            totalStores: allStores.length
        });
        
        const handoverStores = allStores.filter(store => {
            if (userRole === 'MEC_OIC_ADMIN') {
                debugLog('Admin - showing all stores', { storeName: store.name });
                return true;
            }
            
            const storeStatus = store.status;
            const storeTeam = store.team || 'TEAM_A';
            const isHolder = store.current_holder_id == userId;
            const isCreator = store.created_by_id == userId;
            
            debugLog('Checking store availability', {
                storeName: store.name,
                storeStatus: storeStatus,
                storeTeam: storeTeam,
                isHolder: isHolder,
                isCreator: isCreator
            });
            
            // RQ users can see:
            if (userRole === 'RQ') {
                // 1. TEAM_B stores that are AVAILABLE
                if (storeTeam === 'TEAM_B' && storeStatus === 'AVAILABLE') {
                    debugLog('RQ can see TEAM_B AVAILABLE store', { storeName: store.name });
                    return true;
                }
                // 2. Stores they created (any team, any status except HANDED_OVER)
                if (isCreator && storeStatus !== 'HANDED_OVER') {
                    debugLog('RQ can see store they created', { storeName: store.name });
                    return true;
                }
                // 3. Stores they currently hold (any team, TAKEN_OVER status)
                if (isHolder && storeStatus === 'TAKEN_OVER') {
                    debugLog('RQ can see store they hold', { storeName: store.name });
                    return true;
                }
                return false;
            }
            
            // MEMBER users can see:
            if (userRole === 'MEMBER') {
                // 1. TEAM_A stores that are AVAILABLE
                if (storeTeam === 'TEAM_A' && storeStatus === 'AVAILABLE') {
                    debugLog('Member can see TEAM_A AVAILABLE store', { storeName: store.name });
                    return true;
                }
                // 2. Stores they created in TEAM_A (any status except HANDED_OVER)
                if (isCreator && storeTeam === 'TEAM_A' && storeStatus !== 'HANDED_OVER') {
                    debugLog('Member can see TEAM_A store they created', { storeName: store.name });
                    return true;
                }
                // 3. Stores they currently hold in TEAM_A (TAKEN_OVER status)
                if (isHolder && storeTeam === 'TEAM_A' && storeStatus === 'TAKEN_OVER') {
                    debugLog('Member can see TEAM_A store they hold', { storeName: store.name });
                    return true;
                }
                return false;
            }
            
            return false;
        });
        
        debugLog('Filtered stores for handover', { 
            total: allStores.length, 
            available: handoverStores.length,
            stores: handoverStores.map(s => ({ name: s.name, team: s.team, status: s.status }))
        });
        
        if (handoverStores.length === 0) {
            storeSelect.innerHTML = '<option value="">No stores available for hand over</option>';
            
            let message = 'No stores available for hand over with your current permissions.\n\n';
            message += `Your Role: ${userRole}\n`;
            
            if (userRole === 'RQ') {
                message += 'As an RQ, you can handover:\n';
                message += '• TEAM_B stores that are AVAILABLE\n';
                message += '• Stores you created (any team)\n';
                message += '• Stores you currently hold (any team)\n';
            } else if (userRole === 'MEMBER') {
                message += 'As a Member, you can handover:\n';
                message += '• TEAM_A stores that are AVAILABLE\n';
                message += '• TEAM_A stores you created\n';
                message += '• TEAM_A stores you currently hold\n';
            }
            
            alert(message);
            return;
        }
        
        handoverStores.forEach(store => {
            const option = document.createElement('option');
            option.value = store.id;
            
            let statusText = '';
            switch(store.status) {
                case 'AVAILABLE':
                    statusText = 'Available';
                    break;
                case 'HANDED_OVER':
                    statusText = 'Already Handed Over';
                    break;
                case 'TAKEN_OVER':
                    statusText = `Currently Held by ${store.current_holder_name || 'you'}`;
                    break;
            }
            
            let teamText = store.team || 'TEAM_A';
            option.textContent = `${store.name} (${teamText}) - ${statusText}`;
            option.dataset.store = JSON.stringify(store);
            storeSelect.appendChild(option);
        });
    }
    
    // Show store preview when store is selected
    function showStorePreview(storeId) {
        const store = allStores.find(s => s.id == storeId);
        if (!store) return;
        
        selectedStore = store;
        
        debugLog('Store selected for handover', {
            storeId: store.id,
            storeName: store.name,
            status: store.status,
            team: store.team
        });
        
        // Update preview
        previewStoreName.textContent = store.name;
        previewStoreId.textContent = store.id;
        
        let statusText = '';
        switch(store.status) {
            case 'AVAILABLE':
                statusText = 'Available';
                break;
            case 'HANDED_OVER':
                statusText = 'Already Handed Over';
                break;
            case 'TAKEN_OVER':
                statusText = `Currently Held by ${store.current_holder_name || 'you'}`;
                break;
        }
        
        previewStoreStatus.textContent = statusText;
        previewStoreHolder.textContent = store.current_holder_name || 'None';
        previewStoreTeam.textContent = store.team || 'TEAM_A';
        previewStoreCreator.textContent = store.created_by_name || 'Unknown';
        
        // Show preview
        storePreview.style.display = 'block';
        
        // Update Step 2 with selected store info
        selectedStoreName.textContent = store.name;
        selectedStoreId.textContent = store.id;
        expectedQRData.textContent = `Store ID: ${store.id}, Name: ${store.name}`;
        
        // Update Step 3 and 4 with verified info
        verifiedStoreName.textContent = store.name;
        verifiedStoreId.textContent = store.id;
        verifiedStoreTeam.textContent = store.team || 'TEAM_A';
        
        summaryStoreName.textContent = store.name;
        summaryStoreId.textContent = store.id;
        summaryStoreTeam.textContent = store.team || 'TEAM_A';
        
        // Reset QR verification status when store changes
        isQRVerified = false;
        if (nextAfterScan) {
            nextAfterScan.disabled = true;
        }
        scannerStatus.style.display = 'none';
    }
    
    // CORRECTED: Validate if store can be handed over
    function validateStoreForHandover(store) {
        const storeStatus = store.status;
        const userRole = currentUser.role;
        const userId = currentUser.id;
        
        debugLog('Validating store for handover', {
            storeName: store.name,
            storeStatus: storeStatus,
            storeTeam: store.team,
            userRole: userRole,
            userId: userId,
            currentHolder: store.current_holder_id,
            isHolder: store.current_holder_id == userId
        });
        
        // Check if store is already handed over
        if (storeStatus === 'HANDED_OVER') {
            alert('This store has already been handed over. It needs to be taken over first.');
            return false;
        }
        
        // Check if user can handover this store
        if (storeStatus === 'TAKEN_OVER') {
            if (store.current_holder_id != userId) {
                // For RQ users: Allow handover if they created the store, even if not current holder
                if (userRole === 'RQ' && store.created_by_id == userId) {
                    debugLog('RQ can handover store they created (TAKEN_OVER)', {
                        storeName: store.name,
                        creator: store.created_by_id,
                        userId: userId
                    });
                    // Continue to team check
                } else {
                    alert('You can only handover stores that you currently hold.');
                    return false;
                }
            }
        }
        
        if (storeStatus === 'AVAILABLE') {
            // For AVAILABLE stores, only creator or Admin can handover
            if (store.created_by_id != userId && userRole !== 'MEC_OIC_ADMIN') {
                alert('Only the creator or Admin can handover available stores.');
                return false;
            }
        }
        
        // FIXED: Team validation for RQ users
        const storeTeam = store.team || 'TEAM_A';
        
        if (userRole === 'RQ') {
            // RQ users can handover:
            // 1. Stores in TEAM_B (their team)
            // 2. Stores they created in TEAM_A (if they previously created it)
            // 3. Stores they currently hold in TEAM_A
            if (storeTeam === 'TEAM_B') {
                debugLog('RQ can handover TEAM_B store', { storeName: store.name });
                return true;
            } else if (storeTeam === 'TEAM_A') {
                // Check if RQ created this TEAM_A store
                if (store.created_by_id == userId) {
                    debugLog('RQ can handover TEAM_A store they created', { storeName: store.name });
                    return true;
                }
                // Check if RQ is current holder of this TEAM_A store
                if (store.current_holder_id == userId) {
                    debugLog('RQ can handover TEAM_A store they hold', { storeName: store.name });
                    return true;
                }
                // RQ cannot handover other TEAM_A stores
                alert('RQ users can only handover TEAM_B stores, or TEAM_A stores they created or currently hold.');
                return false;
            }
        } else if (userRole === 'MEMBER') {
            // Members can only handover TEAM_A stores
            if (storeTeam !== 'TEAM_A') {
                alert('Members can only handover stores from TEAM_A.');
                return false;
            }
        } else if (userRole === 'MEC_OIC_ADMIN') {
            // Admin can handover any store
            debugLog('Admin can handover any store', { storeName: store.name });
            return true;
        }
        
        return true;
    }
    
    // Initialize QR Scanner (SIMPLIFIED VERSION)
    function initQRScanner() {
        debugLog('Initializing QR scanner');
        
        // Create scanner HTML
        const scannerHTML = `
            <div id="simpleQrScanner" style="text-align: center;">
                <video id="qrVideo" autoplay playsinline style="
                    width: 100%;
                    max-width: 400px;
                    border-radius: 8px;
                    border: 2px solid #007bff;
                "></video>
                <div id="qrStatus" style="
                    margin-top: 15px;
                    padding: 10px;
                    background: #f8f9fa;
                    border-radius: 4px;
                    font-family: monospace;
                    min-height: 40px;
                ">
                    Camera not started
                </div>
                <div style="margin-top: 15px;">
                    <button id="testScanBtn" class="btn btn-primary" style="margin-right: 10px;">
                        <i class="fas fa-bolt"></i> Test Scan
                    </button>
                    <button id="manualInputBtn" class="btn btn-secondary">
                        <i class="fas fa-keyboard"></i> Manual Input
                    </button>
                </div>
            </div>
        `;
        
        if (scannerContainer) {
            scannerContainer.innerHTML = scannerHTML;
            
            // Add event listeners
            document.getElementById('testScanBtn')?.addEventListener('click', testQRScan);
            document.getElementById('manualInputBtn')?.addEventListener('click', manualQRInput);
        }
    }
    
    // Start QR Scanner
    async function startQRScanner() {
        try {
            debugLog('Starting QR scanner...');
            
            // Reset status
            scannerStatus.style.display = 'none';
            scanSuccess.style.display = 'none';
            scanError.style.display = 'none';
            isQRVerified = false;
            nextAfterScan.disabled = true;
            
            if (!selectedStore) {
                showScanError('Please select a store first.');
                return;
            }
            
            // Update status
            updateQRStatus('Requesting camera access...');
            
            // Request camera
            videoStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
            
            const video = document.getElementById('qrVideo');
            video.srcObject = videoStream;
            
            video.onloadedmetadata = () => {
                video.play();
                updateQRStatus('Camera started. Point at QR code...');
                debugLog('Camera started successfully', {
                    width: video.videoWidth,
                    height: video.videoHeight
                });
                
                // Start checking for QR codes
                startQRDetection(video);
            };
            
            startScannerBtn.style.display = 'none';
            scannerContainer.style.display = 'block';
            
        } catch (error) {
            debugLog('Camera error', error, 'error');
            updateQRStatus(`Camera error: ${error.message}`);
            showScanError(`Camera error: ${error.message}. Please ensure camera permissions are granted.`);
            stopQRScanner();
        }
    }
    
    // Simple QR detection using jsQR library (if available)
    async function startQRDetection(video) {
        debugLog('Starting QR detection');
        
        // Create canvas for processing
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        let detectionActive = true;
        
        // Check if jsQR is available
        if (typeof jsQR !== 'undefined') {
            debugLog('jsQR library found, using it for detection');
            
            function checkFrame() {
                if (!detectionActive || !video || video.readyState !== 4) return;
                
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height);
                
                if (code) {
                    debugLog('QR Code found with jsQR', { 
                        data: code.data.substring(0, 100),
                        length: code.data.length 
                    });
                    processQRCode(code.data);
                    detectionActive = false; // Stop checking after finding
                    return;
                }
                
                if (detectionActive) {
                    requestAnimationFrame(checkFrame);
                }
            }
            
            checkFrame();
            
        } else {
            debugLog('jsQR not found, using fallback method');
            updateQRStatus('Using fallback scanner. Click "Test Scan" or "Manual Input".');
        }
    }
    
    // IMPROVED: Process scanned QR code
    function processQRCode(qrData) {
        debugLog('Processing QR code data', { qrData: qrData?.substring(0, 100) });
        
        try {
            if (!qrData || qrData.trim() === '') {
                throw new Error('Empty QR code data');
            }
            
            // Parse the QR code data
            const scannedData = parseQRCodeData(qrData);
            
            debugLog('QR code parsed successfully', scannedData, 'success');
            
            // Validate the scanned data
            if (!scannedData || !scannedData.storeId) {
                throw new Error('QR code does not contain store ID');
            }
            
            // Check if it matches the selected store
            const scannedStoreId = scannedData.storeId.toString();
            const expectedStoreId = selectedStore.id.toString();
            
            debugLog('Validating store match', {
                scannedId: scannedStoreId,
                expectedId: expectedStoreId,
                storeName: scannedData.storeName
            });
            
            if (scannedStoreId !== expectedStoreId) {
                throw new Error(`QR mismatch! Scanned: Store ${scannedStoreId} (${scannedData.storeName}), Expected: Store ${expectedStoreId} (${selectedStore.name})`);
            }
            
            // Success!
            isQRVerified = true;
            debugLog('QR verification successful!', {
                storeId: scannedStoreId,
                storeName: scannedData.storeName,
                source: scannedData.source
            }, 'success');
            
            stopQRScanner();
            nextAfterScan.disabled = false;
            showScanSuccess(`Store verified! ${scannedData.storeName} (ID: ${scannedStoreId})`);
            
        } catch (error) {
            debugLog('QR processing error', error, 'error');
            showScanError(error.message);
        }
    }
    
    // Test scan function (for debugging)
    function testQRScan() {
        debugLog('Test scan triggered');
        
        if (!selectedStore) {
            showScanError('Please select a store first');
            return;
        }
        
        // Create test QR data (encrypted like the real one)
        const testData = {
            storeId: selectedStore.id.toString(),
            storeName: selectedStore.name,
            timestamp: Date.now(),
            type: 'STORE_QR',
            version: '2.0',
            test: true
        };
        
        const testDataString = JSON.stringify(testData);
        
        // Encrypt it (simulating real QR)
        let encrypted = '';
        for (let i = 0; i < testDataString.length; i++) {
            const keyChar = ENCRYPTION_KEY.charCodeAt(i % ENCRYPTION_KEY.length);
            const dataChar = testDataString.charCodeAt(i);
            encrypted += String.fromCharCode(dataChar ^ keyChar);
        }
        const encryptedBase64 = btoa(encrypted);
        
        debugLog('Test QR data generated', { 
            raw: testData,
            encrypted: encryptedBase64.substring(0, 50) + '...',
            length: encryptedBase64.length
        });
        
        // Process it
        processQRCode(encryptedBase64);
    }
    
    // Manual QR input
    function manualQRInput() {
        debugLog('Manual input triggered');
        
        if (!selectedStore) {
            showScanError('Please select a store first');
            return;
        }
        
        const manualData = prompt(
            'Enter the QR code data:\n\n' +
            `Expected store: ${selectedStore.name} (ID: ${selectedStore.id})\n` +
            'Paste the QR code data below:',
            ''
        );
        
        if (manualData) {
            debugLog('Manual input received', { 
                data: manualData.substring(0, 50) + '...',
                length: manualData.length 
            });
            processQRCode(manualData.trim());
        }
    }
    
    // Update QR status
    function updateQRStatus(message) {
        const statusEl = document.getElementById('qrStatus');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.style.background = message.includes('error') ? '#f8d7da' : 
                                       message.includes('success') ? '#d4edda' : '#f8f9fa';
        }
    }
    
    // Stop QR Scanner
    function stopQRScanner() {
        debugLog('Stopping QR scanner');
        
        const video = document.getElementById('qrVideo');
        if (video && video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
        
        if (videoStream) {
            videoStream.getTracks().forEach(track => track.stop());
            videoStream = null;
        }
        
        if (startScannerBtn) {
            startScannerBtn.style.display = 'block';
        }
        
        updateQRStatus('Scanner stopped');
    }
    
    // Show scan success
    function showScanSuccess(message) {
        scannerStatus.style.display = 'block';
        scanSuccess.style.display = 'block';
        scanError.style.display = 'none';
        debugLog('Scan success UI updated', { message });
    }
    
    // Show scan error
    function showScanError(message) {
        scannerStatus.style.display = 'block';
        scanSuccess.style.display = 'none';
        scanError.style.display = 'block';
        errorText.textContent = message;
        debugLog('Scan error UI updated', { message });
    }
    
    // Load users for handover selection
    async function loadUsers() {
        try {
            const response = await fetch('/api/users');
            if (!response.ok) throw new Error('Failed to fetch users');
            
            allUsers = await response.json();
            
            const currentUserId = currentUser.id;
            const currentUserRole = currentUser.role;
            
            let usersForHandover = allUsers.filter(user => {
                if (user.id == currentUserId) return false;
                if (currentUserRole === 'MEC_OIC_ADMIN') return true;
                if (currentUserRole === 'RQ') return user.role === 'RQ' || true;
                if (currentUserRole === 'MEMBER') return user.role === 'MEMBER';
                return false;
            });
            
            debugLog('Users available for handover', {
                totalUsers: allUsers.length,
                availableForHandover: usersForHandover.length
            });
            
            populateUserSelect(usersForHandover);
            
        } catch (error) {
            debugLog('Error loading users', error, 'error');
            handoverToUserSelect.innerHTML = '<option value="">Error loading users</option>';
        }
    }
    
    // Populate user dropdown for handover
    function populateUserSelect(users) {
        handoverToUserSelect.innerHTML = '<option value="">Select user to handover to...</option>';
        
        if (users.length === 0) {
            handoverToUserSelect.innerHTML = '<option value="">No users available for handover</option>';
            return;
        }
        
        users.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            
            let roleText = '';
            switch(user.role) {
                case 'MEC_OIC_ADMIN':
                    roleText = 'Admin';
                    break;
                case 'RQ':
                    roleText = 'RQ';
                    break;
                case 'MEMBER':
                    roleText = 'Member';
                    break;
            }
            
            option.textContent = `${user.rank} ${user.name} (${roleText})`;
            option.dataset.user = JSON.stringify(user);
            handoverToUserSelect.appendChild(option);
        });
    }
    
    // Handle handover user selection
    function handleHandoverUserChange() {
        const selectedUserId = handoverToUserSelect.value;
        if (!selectedUserId) {
            selectedHandoverUser = null;
            toUserName.textContent = 'Select user above';
            toUserRank.textContent = '-';
            toUserRole.textContent = '-';
            if (summaryHandoverTo) {
                summaryHandoverTo.textContent = '';
            }
            return;
        }
        
        const user = allUsers.find(u => u.id == selectedUserId);
        if (!user) return;
        
        selectedHandoverUser = user;
        
        toUserName.textContent = user.name;
        toUserRank.textContent = user.rank;
        toUserRole.textContent = user.role.replace('_', ' ');
        
        if (summaryHandoverTo) {
            let roleText = '';
            switch(user.role) {
                case 'MEC_OIC_ADMIN':
                    roleText = 'Admin';
                    break;
                case 'RQ':
                    roleText = 'RQ';
                    break;
                case 'MEMBER':
                    roleText = 'Member';
                    break;
            }
            summaryHandoverTo.textContent = `${user.rank} ${user.name} (${roleText})`;
        }
        
        debugLog('Handover user selected', {
            userId: user.id,
            userName: user.name,
            userRole: user.role
        });
    }
    
    // Navigate to next step
    function goToNextStep() {
        if (!validateCurrentStep()) return;
        
        sections[currentStep - 1].classList.remove('active');
        currentStep++;
        sections[currentStep - 1].classList.add('active');
        currentStepEl.textContent = currentStep;
        updateFormState();
        
        debugLog('Navigated to next step', { 
            fromStep: currentStep - 1, 
            toStep: currentStep,
            qrVerified: isQRVerified
        });
    }
    
    // Navigate to previous step
    function goToPrevStep() {
        sections[currentStep - 1].classList.remove('active');
        currentStep--;
        sections[currentStep - 1].classList.add('active');
        currentStepEl.textContent = currentStep;
        updateFormState();
        
        debugLog('Navigated to previous step', { 
            fromStep: currentStep + 1, 
            toStep: currentStep 
        });
    }
    
    // Validate current step
    function validateCurrentStep() {
        switch(currentStep) {
            case 1:
                if (!storeSelect.value) {
                    alert('Please select a store to hand over.');
                    return false;
                }
                if (!validateStoreForHandover(selectedStore)) {
                    return false;
                }
                return true;
                
            case 2:
                if (!isQRVerified) {
                    alert('Please scan and verify the store QR code before proceeding.');
                    return false;
                }
                return true;
                
            case 3:
                if (!handoverToUserSelect.value) {
                    alert('Please select a user to handover the store to.');
                    return false;
                }
                if (handoverToUserSelect.value == currentUser.id) {
                    alert('You cannot handover a store to yourself.');
                    return false;
                }
                if (!mobileNumberInput.value || !/^\d{8}$/.test(mobileNumberInput.value)) {
                    alert('Please enter a valid 8-digit mobile number.');
                    mobileNumberInput.focus();
                    return false;
                }
                if (!dateHOTOInput.value) {
                    alert('Please select a date.');
                    return false;
                }
                return true;
                
            case 4:
                return true;
                
            default:
                return true;
        }
    }
    
    // Update form state based on current step
    function updateFormState() {
        backButtons.forEach(btn => {
            btn.style.display = currentStep > 1 ? 'inline-block' : 'none';
        });
        
        if (currentStep !== 2) {
            stopQRScanner();
        }
    }
    
    // Handle store condition change
    function handleStoreConditionChange() {
        const isConditionGood = document.querySelector('input[name="storeCondition"]:checked').value === 'Yes';
        issueReportingSection.style.display = isConditionGood ? 'none' : 'block';
    }
    
    // Submit HOTO form
    async function submitHOTOForm() {
        try {
            debugLog('Submitting HOTO form...', {
                storeId: selectedStore.id,
                storeName: selectedStore.name,
                handoverTo: selectedHandoverUser?.id,
                qrVerified: isQRVerified
            });
            
            if (!selectedHandoverUser) {
                throw new Error('Please select a user to hand over to.');
            }
            
            if (!isQRVerified) {
                throw new Error('Store QR code must be verified before submission.');
            }
            
            const hotoData = {
                store_id: selectedStore.id,
                store_name: selectedStore.name,
                user_id: currentUser.id,
                user_name: currentUser.name,
                user_rank: currentUser.rank,
                mobile_number: mobileNumberInput.value,
                hoto_type: 'Hand Over',
                hoto_date: dateHOTOInput.value,
                store_condition: document.querySelector('input[name="storeCondition"]:checked').value,
                issue_description: document.getElementById('issue-description').value || '',
                issue_notification: document.getElementById('issue-notification').value || '',
                issue_resolved: document.getElementById('issue-resolved-checkbox').checked,
                remarks: document.getElementById('remarks').value || '',
                handover_to_user_id: selectedHandoverUser.id,
                qr_verified: isQRVerified
            };
            
            // Start HOTO
            const startResponse = await fetch('/api/hoto/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    store_id: hotoData.store_id,
                    store_name: hotoData.store_name,
                    user_id: hotoData.user_id,
                    user_name: hotoData.user_name,
                    user_rank: hotoData.user_rank,
                    mobile_number: hotoData.mobile_number,
                    hoto_type: hotoData.hoto_type,
                    hoto_date: hotoData.hoto_date
                })
            });
            
            const startResult = await startResponse.json();
            
            if (!startResponse.ok) {
                throw new Error(startResult.message || 'Failed to start Hand Over');
            }
            
            debugLog('HOTO started successfully', startResult);
            
            // Handover store to selected user
            const handoverResponse = await fetch(`/api/stores/${hotoData.store_id}/handover`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    handed_over_by: hotoData.user_id,
                    handed_over_to: hotoData.handover_to_user_id,
                    remarks: hotoData.remarks || `Handed over by ${hotoData.user_name} to ${selectedHandoverUser.name}`
                })
            });
            
            if (!handoverResponse.ok) {
                const handoverResult = await handoverResponse.json();
                debugLog('Store handover failed (non-critical)', handoverResult, 'warn');
            }
            
            // Complete HOTO
            const completeResponse = await fetch(`/api/hoto/complete/${startResult.hotoId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    box_condition: hotoData.store_condition === 'Yes' ? 'YES' : 'NO',
                    issue_description: hotoData.issue_description,
                    issue_notification: hotoData.issue_notification,
                    issue_resolved: hotoData.issue_resolved,
                    authorized_by: '',
                    witnessed_by: ''
                })
            });
            
            const completeResult = await completeResponse.json();
            
            if (!completeResponse.ok) {
                throw new Error(completeResult.message || 'Failed to complete Hand Over');
            }
            
            debugLog('HOTO completed successfully', completeResult);
            
            // Success message
            let successMsg = `Hand Over completed successfully!`;
            if (selectedHandoverUser) {
                successMsg += `\nStore "${selectedStore.name}" handed over to ${selectedHandoverUser.rank} ${selectedHandoverUser.name}`;
            }
            
            successMessage.textContent = successMsg;
            successModal.style.display = 'flex';
            
        } catch (error) {
            debugLog('Error submitting Hand Over', error, 'error');
            errorMessage.textContent = error.message;
            errorModal.style.display = 'flex';
        }
    }
    
    // --- EVENT LISTENERS ---
    
    nextButtons.forEach(button => {
        button.addEventListener('click', goToNextStep);
    });
    
    backButtons.forEach(button => {
        button.addEventListener('click', goToPrevStep);
    });
    
    storeSelect.addEventListener('change', (e) => {
        if (e.target.value) {
            showStorePreview(e.target.value);
        } else {
            // New store selection invalidates any pairing
            if (tradeState.looking && realTimeHandover && realTimeHandover.isConnected && tradeState.storeId) {
                realTimeHandover.cancelTradeLooking(TRADE_PAGE_KEY, tradeState.storeId);
            }
            tradeState.looking = false;
            tradeState.storeId = null;
            if (tradeUI.pairBtn) tradeUI.pairBtn.disabled = false;
            if (tradeUI.cancelBtn) tradeUI.cancelBtn.style.display = 'none';
            setTradeStatus('Not paired yet. Select store, verify QR, then Pair.', 'fa-info-circle');
            clearSelectedHandoverUser();
        
            storePreview.style.display = 'none';
            selectedStore = null;
            isQRVerified = false;
            if (nextAfterScan) {
                nextAfterScan.disabled = true;
            }
        }
    });
    
    handoverToUserSelect.addEventListener('change', handleHandoverUserChange);
    
    storeConditionRadios.forEach(radio => {
        radio.addEventListener('change', handleStoreConditionChange);
    });
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitHOTOForm();
    });
    
    // Scanner buttons
    if (startScannerBtn) {
        startScannerBtn.addEventListener('click', startQRScanner);
    }
    
    if (stopScannerBtn) {
        stopScannerBtn.addEventListener('click', stopQRScanner);
    }
    
    closeErrorModal.addEventListener('click', () => {
        errorModal.style.display = 'none';
    });
    
    goToRecordsBtn.addEventListener('click', () => {
        window.location.href = 'past-hoto-records.html';
    });
    
    startNewHotoBtn.addEventListener('click', () => {
        successModal.style.display = 'none';
        window.location.reload();
    });
    
    goToHomeBtn.addEventListener('click', () => {
        window.location.href = 'home.html';
    });
    
    window.addEventListener('click', (event) => {
        if (event.target == successModal) {
            successModal.style.display = 'none';
        }
        if (event.target == errorModal) {
            errorModal.style.display = 'none';
        }
    });
    
    window.addEventListener('beforeunload', () => {
        stopQRScanner();

        // Leave presence + cancel pairing when exiting the page
        try {
            if (realTimeHandover && realTimeHandover.isConnected) {
                if (tradeState.looking && tradeState.storeId) {
                    realTimeHandover.cancelTradeLooking(TRADE_PAGE_KEY, tradeState.storeId);
                }
                if (realTimeHandover.leavePage) {
                    realTimeHandover.leavePage();
                }
            }
        } catch (_) {}
    });
    
    // --- INITIALIZATION ---
    
    debugLog('Initializing HOTO form', {
        DEBUG_MODE,
        ENCRYPTION_KEY: DEBUG_MODE ? ENCRYPTION_KEY : '[HIDDEN]'
    });
    
    initTradePairingUI();

    loadUserInfo();
    loadStores();
    loadUsers();
    initQRScanner();
    initRealTimeHandover();
    
    updateFormState();
    handleStoreConditionChange();
});