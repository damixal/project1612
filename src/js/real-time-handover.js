// src/js/real-time-handover.js - Real-time Handover System
class RealTimeHandover {
    constructor() {
        this.ws = null;
        this.userId = null;
        this.userName = null;
        this.userRole = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.onlineUsers = [];
        this.onHandoverInvitation = null;
        this.onOnlineUsersUpdate = null;
        this.onConnectionStatusChange = null;
        
        this.DEBUG_MODE = true;
    }
    
    debugLog(message, data = null) {
        if (this.DEBUG_MODE) {
            console.log(`📡 [REAL-TIME] ${message}`);
            if (data) console.log('📊', data);
        }
    }
    
    // Initialize WebSocket connection
    connect(userId, userName, userRole) {
        if (!userId || !userName || !userRole) {
            console.error('Cannot connect: Missing user information');
            return false;
        }
        
        this.userId = userId;
        this.userName = userName;
        this.userRole = userRole;
        
        // Clean up existing connection
        if (this.ws) {
            this.disconnect();
        }
        
        try {
            // Create WebSocket connection with user info as query params
            const wsProto = (window.location.protocol === 'https:') ? 'wss' : 'ws';
            // Option A: WebSocket server runs separately on port 8080
            const wsUrl = `${wsProto}://${window.location.hostname}:8080?userId=${encodeURIComponent(userId)}&userName=${encodeURIComponent(userName)}&userRole=${encodeURIComponent(userRole)}`;
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => this.handleOpen();
            this.ws.onmessage = (event) => this.handleMessage(event);
            this.ws.onclose = () => this.handleClose();
            this.ws.onerror = (error) => this.handleError(error);
            
            this.debugLog('WebSocket connection initiated', { wsUrl });
            return true;
            
        } catch (error) {
            this.debugLog('WebSocket connection failed', error);
            return false;
        }
    }
    
    handleOpen() {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        this.debugLog('WebSocket connected successfully');
        
        // Start heartbeat
        this.startHeartbeat();
        
        // Notify connection status change
        if (this.onConnectionStatusChange) {
            this.onConnectionStatusChange(true);
        }
    }
    
    handleMessage(event) {
        try {
            const data = JSON.parse(event.data);
            this.debugLog('Received message', { type: data.type });
            
            switch(data.type) {
                case 'welcome':
                    this.handleWelcome(data);
                    break;
                    
                case 'online_users_list':
                    this.handleOnlineUsersList(data);
                    break;
                    
                case 'user_status':
                    this.handleUserStatus(data);
                    break;
                    
                case 'handover_invitation':
                    this.handleHandoverInvitation(data);
                    break;
                    
                case 'handover_accepted':
                case 'handover_accepted_confirmation':
                    this.handleHandoverAccepted(data);
                    break;
                    
                case 'handover_rejected':
                    this.handleHandoverRejected(data);
                    break;
                    
                case 'handover_cancelled':
                    this.handleHandoverCancelled(data);
                    break;
                    
                case 'handover_sent':
                    this.handleHandoverSent(data);
                    break;
                    
                case 'handover_error':
                    this.handleHandoverError(data);
                    break;
                    
                case 'handover_timeout':
                    this.handleHandoverTimeout(data);
                    break;
                    
                default:
                    this.debugLog('Unknown message type', data);
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    }
    
    handleClose() {
        this.isConnected = false;
        this.debugLog('WebSocket disconnected');
        
        // Stop heartbeat
        this.stopHeartbeat();
        
        // Notify connection status change
        if (this.onConnectionStatusChange) {
            this.onConnectionStatusChange(false);
        }
        
        // Attempt reconnect
        this.attemptReconnect();
    }
    
    handleError(error) {
        this.debugLog('WebSocket error', error);
    }
    
    handleWelcome(data) {
        this.debugLog('Welcome message received', data);
        this.onlineUsers = data.onlineUsers || [];
        
        // Update UI with online users
        this.updateOnlineUsersDisplay();
    }
    
    handleOnlineUsersList(data) {
        this.onlineUsers = data.onlineUsers || [];
        this.debugLog('Online users list updated', { count: this.onlineUsers.length });
        
        // Update UI with online users
        this.updateOnlineUsersDisplay();
        
        // Call callback if set
        if (this.onOnlineUsersUpdate) {
            this.onOnlineUsersUpdate(this.onlineUsers);
        }
    }
    
    handleUserStatus(data) {
        const { userId, userName, userRole, status } = data;
        
        if (status === 'online') {
            // Add or update user
            const existingIndex = this.onlineUsers.findIndex(u => u.userId == userId);
            if (existingIndex >= 0) {
                this.onlineUsers[existingIndex] = { userId, userName, userRole, lastSeen: Date.now() };
            } else {
                this.onlineUsers.push({ userId, userName, userRole, lastSeen: Date.now() });
            }
        } else if (status === 'offline') {
            // Remove user
            this.onlineUsers = this.onlineUsers.filter(u => u.userId != userId);
        }
        
        this.debugLog(`User ${userName} is now ${status}`);
        this.updateOnlineUsersDisplay();
    }
    
    handleHandoverInvitation(data) {
        this.debugLog('Handover invitation received', data);
        
        if (this.onHandoverInvitation) {
            this.onHandoverInvitation(data);
        } else {
            // Default notification
            this.showHandoverNotification(data);
        }
    }
    
    handleHandoverAccepted(data) {
        this.debugLog('Handover accepted', data);
        
        // Show success message
        this.showNotification('success', `Handover accepted by ${data.toUserName || 'user'}!`);
    }
    
    handleHandoverRejected(data) {
        this.debugLog('Handover rejected', data);
        
        // Show rejection message
        this.showNotification('error', `Handover rejected: ${data.reason || 'No reason provided'}`);
    }
    
    handleHandoverCancelled(data) {
        this.debugLog('Handover cancelled', data);
        
        // Show cancellation message
        this.showNotification('info', 'Handover request was cancelled');
    }
    
    handleHandoverSent(data) {
        this.debugLog('Handover sent', data);
        
        // Show sent confirmation
        this.showNotification('info', `Handover invitation sent to ${data.targetUserName}`);
    }
    
    handleHandoverError(data) {
        this.debugLog('Handover error', data);
        
        // Show error message
        this.showNotification('error', data.message || 'Handover error occurred');
    }
    
    handleHandoverTimeout(data) {
        this.debugLog('Handover timeout', data);
        
        // Show timeout message
        this.showNotification('warning', 'Handover request timed out');
    }
    
    // Send handover request to another user
    sendHandoverRequest(toUserId, storeId, storeName, remarks = '') {
        if (!this.isConnected) {
            this.showNotification('error', 'Not connected to real-time system');
            return false;
        }
        
        if (!toUserId) {
            this.showNotification('error', 'No target user selected');
            return false;
        }
        
        const message = {
            type: 'handover_request',
            fromUserId: this.userId,
            fromUserName: this.userName,
            fromUserRole: this.userRole,
            toUserId: toUserId,
            storeId: storeId,
            storeName: storeName,
            remarks: remarks,
            timestamp: new Date().toISOString()
        };
        
        this.ws.send(JSON.stringify(message));
        this.debugLog('Handover request sent', message);
        
        return true;
    }
    
    // Respond to handover invitation
    respondToHandover(fromUserId, accepted, reason = '') {
        if (!this.isConnected) {
            return false;
        }
        
        const message = {
            type: 'handover_response',
            fromUserId: fromUserId,
            toUserId: this.userId,
            accepted: accepted,
            reason: reason,
            timestamp: new Date().toISOString()
        };
        
        this.ws.send(JSON.stringify(message));
        this.debugLog('Handover response sent', message);
        
        return true;
    }
    
    // Cancel pending handover
    cancelHandover(targetUserId) {
        if (!this.isConnected) {
            return false;
        }
        
        const message = {
            type: 'cancel_handover',
            userId: this.userId,
            targetUserId: targetUserId,
            timestamp: new Date().toISOString()
        };
        
        this.ws.send(JSON.stringify(message));
        this.debugLog('Handover cancellation sent', message);
        
        return true;
    }
    
    // Request online users list
    requestOnlineUsers() {
        if (!this.isConnected) {
            return false;
        }
        
        const message = {
            type: 'get_online_users',
            userId: this.userId,
            timestamp: new Date().toISOString()
        };
        
        this.ws.send(JSON.stringify(message));
        this.debugLog('Online users request sent');
        
        return true;
    }
    
    // Start heartbeat to keep connection alive
    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
                const message = {
                    type: 'heartbeat',
                    userId: this.userId,
                    timestamp: Date.now()
                };
                
                this.ws.send(JSON.stringify(message));
            }
        }, 30000); // Every 30 seconds
    }
    
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
    
    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.debugLog('Max reconnection attempts reached');
            return;
        }
        
        this.reconnectAttempts++;
        this.debugLog(`Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        
        setTimeout(() => {
            if (this.userId && this.userName && this.userRole) {
                this.connect(this.userId, this.userName, this.userRole);
            }
        }, 5000); // Try again after 5 seconds
    }
    
    disconnect() {
        this.debugLog('Disconnecting WebSocket');
        
        this.stopHeartbeat();
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.isConnected = false;
        this.onlineUsers = [];
    }
    
    // Helper methods for UI updates
    updateOnlineUsersDisplay() {
        // This method should be overridden by the calling code
        // or use the callback system
        this.debugLog('Online users updated', { count: this.onlineUsers.length });
    }
    
    showHandoverNotification(data) {
        const notification = `
            <div class="handover-notification">
                <h4><i class="fas fa-handshake"></i> Handover Request</h4>
                <p><strong>From:</strong> ${data.fromUserName} (${data.fromUserRole})</p>
                <p><strong>Store:</strong> ${data.storeName}</p>
                ${data.remarks ? `<p><strong>Remarks:</strong> ${data.remarks}</p>` : ''}
                <div class="notification-actions">
                    <button class="btn btn-small btn-success accept-handover" 
                            data-from-user-id="${data.fromUserId}">
                        <i class="fas fa-check"></i> Accept
                    </button>
                    <button class="btn btn-small btn-danger reject-handover"
                            data-from-user-id="${data.fromUserId}">
                        <i class="fas fa-times"></i> Reject
                    </button>
                </div>
            </div>
        `;
        
        // You can implement your own notification system here
        console.log('Handover notification:', notification);
        
        // For now, show a simple alert
        if (confirm(`${data.fromUserName} wants to handover store "${data.storeName}" to you. Accept?`)) {
            this.respondToHandover(data.fromUserId, true, 'Accepted via notification');
        } else {
            this.respondToHandover(data.fromUserId, false, 'Rejected via notification');
        }
    }
    
    showNotification(type, message) {
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };
        
        const icon = icons[type] || 'ℹ️';
        console.log(`${icon} ${message}`);
        
        // You can implement your own notification UI here
        // For now, just log to console
    }
    
    // Get filtered online users based on team rules
    getAvailableHandoverUsers() {
        return this.onlineUsers.filter(targetUser => {
            return this.canHandoverTo(targetUser.userId, targetUser.userRole);
        });
    }
    
    // Check if current user can handover to target user
    canHandoverTo(targetUserId, targetUserRole) {
        // Cannot handover to self
        if (targetUserId == this.userId) {
            return false;
        }
        
        // Team rules
        const teamA = ['MEC_OIC_ADMIN', 'MEMBER'];
        const teamB = ['RQ'];
        
        const currentTeam = teamA.includes(this.userRole) ? 'TEAM_A' : 'TEAM_B';
        const targetTeam = teamA.includes(targetUserRole) ? 'TEAM_A' : 'TEAM_B';
        
        // Cannot handover within same team (except admin<->member within TEAM_A)
        if (currentTeam === targetTeam) {
            // Allow admin to handover to member (both TEAM_A)
            if (this.userRole === 'MEC_OIC_ADMIN' && targetUserRole === 'MEMBER') {
                return true;
            }
            // Allow member to handover to admin (both TEAM_A)
            if (this.userRole === 'MEMBER' && targetUserRole === 'MEC_OIC_ADMIN') {
                return true;
            }
            // Disallow other same-team handovers
            return false;
        }
        
        // Allow cross-team handovers
        return true;
    }
    
    // Get online status indicator
    getConnectionStatus() {
        return this.isConnected ? 'online' : 'offline';
    }
    
    // Set callbacks
    onHandoverInvitation(callback) {
        this.onHandoverInvitation = callback;
    }
    
    onOnlineUsersUpdate(callback) {
        this.onOnlineUsersUpdate = callback;
    }
    
    onConnectionStatusChange(callback) {
        this.onConnectionStatusChange = callback;
    }
}

// Export singleton instance
const realTimeHandover = new RealTimeHandover();
window.RealTimeHandover = realTimeHandover;

