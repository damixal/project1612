
const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

// ==============================
// Real-time WebSocket (embedded)
// ==============================
const WebSocket = require('ws');
const url = require('url');

class RealTimeHandoverServer {
    constructor(options = {}) {
        this.path = options.path || '/ws';
        this.wss = new WebSocket.Server({ noServer: true });

        this.onlineUsers = new Map(); // userId -> {userId, userName, userRole, ws, lastSeen, status}
        this.pendingHandovers = new Map(); // targetUserId -> {fromUserId, storeId, storeName, ...}

        // Bind handlers
        this._onConnection = this._onConnection.bind(this);
    }

    /**
     * Attach WebSocket handling to an existing HTTP server (same port as Express).
     */
    attach(httpServer) {
        // Handle HTTP upgrade requests
        httpServer.on('upgrade', (req, socket, head) => {
            try {
                const { pathname, query } = url.parse(req.url, true);
                // Allow both exact path and legacy clients hitting "/" (optional)
                if (pathname !== this.path && pathname !== '/') {
                    socket.destroy();
                    return;
                }

                this.wss.handleUpgrade(req, socket, head, (ws) => {
                    // Stash parsed query on the request so we can use it in connection handler
                    ws._wsQuery = query || {};
                    this.wss.emit('connection', ws, req);
                });
            } catch (e) {
                socket.destroy();
            }
        });

        // Connection
        this.wss.on('connection', this._onConnection);

        // Cleanup offline users
        this.startCleanupInterval();

        console.log(`📡 WebSocket ready on ws://<host>:${port}${this.path}`);
    }

    _onConnection(ws, req) {
        console.log('🔗 New WebSocket connection');

        const q = ws._wsQuery || url.parse(req.url, true).query || {};
        const userId = q.userId;
        const userName = q.userName;
        const userRole = q.userRole;

        if (userId && userName && userRole) {
            this.handleUserConnection(ws, String(userId), String(userName), String(userRole));
        } else {
            console.log('❌ Missing user parameters, closing connection');
            try { ws.close(); } catch {}
            return;
        }

        ws.on('message', (message) => this.handleMessage(ws, message));

        ws.on('close', () => {
            this.handleUserDisconnection(String(userId));
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });
    }

    handleUserConnection(ws, userId, userName, userRole) {
        this.onlineUsers.set(userId, {
            userId,
            userName,
            userRole,
            ws,
            lastSeen: Date.now(),
            status: 'online'
        });

        console.log(`👤 User ${userName} (${userId}, ${userRole}) connected`);

        // Send welcome with current list
        ws.send(JSON.stringify({
            type: 'welcome',
            message: 'Connected to real-time handover system',
            userId,
            onlineUsers: this.getOnlineUsersList(),
            timestamp: new Date().toISOString()
        }));

        // Broadcast presence
        this.broadcastUserStatus(userId, 'online');
    }

    handleUserDisconnection(userId) {
        const user = this.onlineUsers.get(userId);
        if (!user) return;

        this.onlineUsers.delete(userId);
        console.log(`👋 User ${user.userName} (${userId}) disconnected`);

        // Remove any pending handover targeting this user
        if (this.pendingHandovers.has(userId)) {
            this.pendingHandovers.delete(userId);
        }

        this.broadcastUserStatus(userId, 'offline');
    }

    handleMessage(ws, message) {
        try {
            const data = typeof message === 'string' ? JSON.parse(message) : JSON.parse(message.toString());
            switch (data.type) {
                case 'heartbeat':
                    this.handleHeartbeat(String(data.userId));
                    break;
                case 'handover_request':
                    this.handleHandoverRequest(data);
                    break;
                case 'handover_response':
                    this.handleHandoverResponse(data);
                    break;
                case 'cancel_handover':
                    this.handleCancelHandover(data);
                    break;
                case 'get_online_users':
                    this.sendOnlineUsers(ws, String(data.userId));
                    break;
                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    }

    handleHeartbeat(userId) {
        const user = this.onlineUsers.get(userId);
        if (user) {
            user.lastSeen = Date.now();
            user.status = 'online';
        }
    }

    canHandoverBetweenTeams(fromRole, toRole) {
        // Allow admin to handover to anyone
        if (fromRole === 'MEC_OIC_ADMIN') return true;

        // Example restrictions: MEMBER <-> MEMBER, RQ <-> RQ only (adjust as needed)
        // If you want MEMBER can handover to RQ etc, change this logic.
        const teamA = new Set(['MEC_OIC_ADMIN', 'MEMBER']);
        const teamB = new Set(['RQ']);

        const fromTeam = teamB.has(fromRole) ? 'B' : 'A';
        const toTeam = teamB.has(toRole) ? 'B' : 'A';
        return fromTeam === toTeam;
    }

    handleHandoverRequest(data) {
        const { fromUserId, fromUserName, fromUserRole, toUserId, storeId, storeName, remarks } = data;

        console.log(`🤝 Handover request from ${fromUserName} to user ${toUserId}`);

        const targetUser = this.onlineUsers.get(String(toUserId));
        const fromUser = this.onlineUsers.get(String(fromUserId));

        if (!targetUser) {
            if (fromUser?.ws?.readyState === WebSocket.OPEN) {
                fromUser.ws.send(JSON.stringify({
                    type: 'handover_error',
                    message: 'Target user is offline. Cannot initiate handover.',
                    targetUserId: String(toUserId),
                    timestamp: new Date().toISOString()
                }));
            }
            return;
        }

        if (!this.canHandoverBetweenTeams(String(fromUserRole), String(targetUser.userRole))) {
            if (fromUser?.ws?.readyState === WebSocket.OPEN) {
                fromUser.ws.send(JSON.stringify({
                    type: 'handover_error',
                    message: `Cannot handover between ${fromUserRole} and ${targetUser.userRole}. Team restrictions apply.`,
                    targetUserId: String(toUserId),
                    timestamp: new Date().toISOString()
                }));
            }
            return;
        }

        this.pendingHandovers.set(String(toUserId), {
            fromUserId: String(fromUserId),
            fromUserName: String(fromUserName),
            fromUserRole: String(fromUserRole),
            storeId: String(storeId),
            storeName: String(storeName),
            remarks: remarks || '',
            timestamp: Date.now()
        });

        if (targetUser.ws.readyState === WebSocket.OPEN) {
            targetUser.ws.send(JSON.stringify({
                type: 'handover_invitation',
                fromUserId: String(fromUserId),
                fromUserName: String(fromUserName),
                fromUserRole: String(fromUserRole),
                storeId: String(storeId),
                storeName: String(storeName),
                remarks: remarks || '',
                timestamp: new Date().toISOString()
            }));
        }

        if (fromUser?.ws?.readyState === WebSocket.OPEN) {
            fromUser.ws.send(JSON.stringify({
                type: 'handover_sent',
                message: `Handover invitation sent to ${targetUser.userName}`,
                targetUserId: String(toUserId),
                targetUserName: targetUser.userName,
                timestamp: new Date().toISOString()
            }));
        }
    }

    handleHandoverResponse(data) {
        const { fromUserId, toUserId, accepted, reason } = data;

        console.log(`📩 Handover response from ${toUserId}: ${accepted ? 'Accepted' : 'Rejected'}`);

        const fromUser = this.onlineUsers.get(String(fromUserId));
        const toUser = this.onlineUsers.get(String(toUserId));

        this.pendingHandovers.delete(String(toUserId));

        if (accepted) {
            if (fromUser?.ws?.readyState === WebSocket.OPEN) {
                fromUser.ws.send(JSON.stringify({
                    type: 'handover_accepted',
                    message: 'Handover accepted!',
                    fromUserId: String(fromUserId),
                    toUserId: String(toUserId),
                    toUserName: toUser?.userName || 'Unknown',
                    timestamp: new Date().toISOString()
                }));
            }
            if (toUser?.ws?.readyState === WebSocket.OPEN) {
                toUser.ws.send(JSON.stringify({
                    type: 'handover_confirmed',
                    message: 'You accepted the handover.',
                    fromUserId: String(fromUserId),
                    toUserId: String(toUserId),
                    timestamp: new Date().toISOString()
                }));
            }
        } else {
            if (fromUser?.ws?.readyState === WebSocket.OPEN) {
                fromUser.ws.send(JSON.stringify({
                    type: 'handover_rejected',
                    message: `Handover rejected${reason ? `: ${reason}` : ''}`,
                    fromUserId: String(fromUserId),
                    toUserId: String(toUserId),
                    timestamp: new Date().toISOString()
                }));
            }
        }
    }

    handleCancelHandover(data) {
        const { fromUserId, toUserId } = data;

        console.log(`🛑 Cancel handover from ${fromUserId} to ${toUserId}`);

        const fromUser = this.onlineUsers.get(String(fromUserId));
        const toUser = this.onlineUsers.get(String(toUserId));

        this.pendingHandovers.delete(String(toUserId));

        if (toUser?.ws?.readyState === WebSocket.OPEN) {
            toUser.ws.send(JSON.stringify({
                type: 'handover_cancelled',
                message: 'Handover was cancelled by sender.',
                fromUserId: String(fromUserId),
                timestamp: new Date().toISOString()
            }));
        }

        if (fromUser?.ws?.readyState === WebSocket.OPEN) {
            fromUser.ws.send(JSON.stringify({
                type: 'handover_cancelled_ack',
                message: 'Handover cancelled.',
                toUserId: String(toUserId),
                timestamp: new Date().toISOString()
            }));
        }
    }

    sendOnlineUsers(ws, userId) {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
            type: 'online_users',
            onlineUsers: this.getOnlineUsersList(),
            timestamp: new Date().toISOString()
        }));
    }

    getOnlineUsersList() {
        return Array.from(this.onlineUsers.values()).map(u => ({
            userId: u.userId,
            userName: u.userName,
            userRole: u.userRole,
            status: u.status,
            lastSeen: u.lastSeen
        }));
    }

    broadcastUserStatus(userId, status) {
        const payload = JSON.stringify({
            type: 'user_status',
            userId: String(userId),
            status,
            onlineUsers: this.getOnlineUsersList(),
            timestamp: new Date().toISOString()
        });

        for (const u of this.onlineUsers.values()) {
            if (u.ws?.readyState === WebSocket.OPEN) {
                u.ws.send(payload);
            }
        }
    }

    startCleanupInterval() {
        // Mark users offline if no heartbeat in 45s
        const TIMEOUT_MS = 45_000;
        const INTERVAL_MS = 15_000;

        setInterval(() => {
            const now = Date.now();
            for (const [userId, user] of this.onlineUsers.entries()) {
                if (now - user.lastSeen > TIMEOUT_MS) {
                    console.log(`⏰ User ${user.userName} timed out`);
                    try { user.ws.close(); } catch {}
                    this.onlineUsers.delete(userId);
                    this.broadcastUserStatus(userId, 'offline');
                }
            }
        }, INTERVAL_MS);
    }
}



const app = express();
const port = 8000;

// Create a single HTTP server for BOTH Express and WebSocket
const server = http.createServer(app);
const realTimeServer = new RealTimeHandoverServer({ path: '/ws' });
realTimeServer.attach(server);

// --- Configuration ---
const DEBUG_MODE = true; // Set to false in production
const LOG_REQUESTS = true;
const LOG_RESPONSES = true;
const LOG_SQL = true;

// Middleware for logging
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Custom logging middleware
app.use((req, res, next) => {
    const startTime = Date.now();
    const requestId = crypto.randomBytes(4).toString('hex');
    
    req.requestId = requestId;
    
    if (LOG_REQUESTS && DEBUG_MODE) {
        console.log(`\n═══════════════════════════════════════════════════`);
        console.log(`📥 REQUEST [${requestId}] ${req.method} ${req.url}`);
        console.log(`📅 Time: ${new Date().toISOString()}`);
        console.log(`📝 IP: ${req.ip || req.connection.remoteAddress}`);
        console.log(`👤 User-Agent: ${req.get('User-Agent')?.substring(0, 50)}...`);
        
        if (req.body && Object.keys(req.body).length > 0) {
            console.log(`📦 Body:`);
            console.log(JSON.stringify(req.body, null, 2));
        }
        
        if (req.query && Object.keys(req.query).length > 0) {
            console.log(`❓ Query Params:`);
            console.log(JSON.stringify(req.query, null, 2));
        }
        
        if (req.params && Object.keys(req.params).length > 0) {
            console.log(`🔗 Route Params:`);
            console.log(JSON.stringify(req.params, null, 2));
        }
    }
    
    // Override res.json to log responses
    const originalJson = res.json;
    res.json = function(data) {
        const responseTime = Date.now() - startTime;
        
        if (LOG_RESPONSES && DEBUG_MODE) {
            console.log(`\n═══════════════════════════════════════════════════`);
            console.log(`📤 RESPONSE [${requestId}] ${req.method} ${req.url}`);
            console.log(`⏱️  Response Time: ${responseTime}ms`);
            console.log(`📊 Status: ${res.statusCode} ${res.statusMessage}`);
            
            if (data && DEBUG_MODE) {
                console.log(`📄 Response Data:`);
                
                // Truncate large responses for readability
                let dataToLog = data;
                if (Array.isArray(data) && data.length > 5) {
                    dataToLog = {
                        message: `Array with ${data.length} items (truncated)`,
                        first_5_items: data.slice(0, 5),
                        total_count: data.length
                    };
                } else if (typeof data === 'object' && data !== null) {
                    const keys = Object.keys(data);
                    if (keys.length > 10) {
                        dataToLog = {
                            message: `Object with ${keys.length} properties (truncated)`,
                            sample: Object.fromEntries(
                                Object.entries(data).slice(0, 10)
                            ),
                            total_properties: keys.length
                        };
                    }
                }
                
                console.log(JSON.stringify(dataToLog, null, 2));
            }
            
            console.log(`═══════════════════════════════════════════════════\n`);
        }
        
        return originalJson.call(this, data);
    };
    
    next();
});

// --- Database Connection ---
const dbConfig = {
    host: 'localhost',
    user: 'damien',
    password: '123456',
    database: 'smarthoto_db',
    multipleStatements: true
};

const db = mysql.createConnection(dbConfig);

db.connect((err) => {
    if (err) {
        console.error('❌ Error connecting to MySQL:', err);
        return;
    }
    console.log('✅ Successfully connected to MySQL database: smarthoto_db');
    setupDatabase();
});

// --- Logging Helper Functions ---
function logSQL(query, params = []) {
    if (LOG_SQL && DEBUG_MODE) {
        console.log(`\n🔍 SQL QUERY:`);
        console.log(`📝 Query: ${query}`);
        if (params.length > 0) {
            console.log(`🔢 Parameters:`, params);
        }
    }
}

function logError(context, error) {
    console.error(`\n❌ ERROR in ${context}:`);
    console.error(`💥 Message: ${error.message}`);
    console.error(`📌 Stack: ${error.stack}`);
    if (error.sql) {
        console.error(`🗄️ SQL: ${error.sql}`);
    }
    if (error.sqlState) {
        console.error(`🗄️ SQL State: ${error.sqlState}`);
    }
}

function logInfo(message, data = null) {
    if (DEBUG_MODE) {
        console.log(`\nℹ️ ${message}`);
        if (data) {
            console.log('📊 Data:', data);
        }
    }
}

// --- Updated DATABASE SETUP FUNCTION ---
function setupDatabase() {
    console.log('🔄 Setting up database tables...');
    
    // Create users table
    const createUsersTable = `
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            \`rank\` VARCHAR(50) NOT NULL,
            password VARCHAR(255) NOT NULL,
            phone_number VARCHAR(20),
            role ENUM('MEC_OIC_ADMIN', 'MEMBER', 'RQ') DEFAULT 'MEMBER'
        ) ENGINE=InnoDB;
    `;
    
    logSQL(createUsersTable);
    db.query(createUsersTable, (err) => {
        if (err) {
            logError('creating users table', err);
            return;
        }
        logInfo('✅ Users table created/verified');
        
        // Create stores table
        const createStoresTable = `
            CREATE TABLE IF NOT EXISTS stores (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                status ENUM('AVAILABLE', 'HANDED_OVER', 'TAKEN_OVER') DEFAULT 'AVAILABLE',
                current_holder_id INT NULL,
                created_by_id INT,
                team ENUM('TEAM_A', 'TEAM_B') DEFAULT 'TEAM_A',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_current_holder (current_holder_id),
                INDEX idx_created_by (created_by_id),
                INDEX idx_team (team),
                INDEX idx_team_status (team, status)
            ) ENGINE=InnoDB;
        `;
        
        logSQL(createStoresTable);
        db.query(createStoresTable, (err) => {
            if (err) {
                logError('creating stores table', err);
                createStoresTableSimple();
                return;
            }
            logInfo('✅ Stores table created/verified with team separation');
            createHOTOInstancesTable();
        });
    });
}

function createStoresTableSimple() {
    const simpleTable = `
        CREATE TABLE IF NOT EXISTS stores (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            status VARCHAR(20) DEFAULT 'AVAILABLE',
            current_holder_id INT NULL,
            created_by_id INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB;
    `;
    
    logSQL(simpleTable);
    db.query(simpleTable, (err) => {
        if (err) {
            logError('creating simple stores table', err);
            return;
        }
        logInfo('✅ Simple stores table created');
        createHOTOInstancesTable();
    });
}

function createHOTOInstancesTable() {
    console.log('🔄 Creating/verifying hoto_instances table...');
    
    const checkTableSql = "SHOW TABLES LIKE 'hoto_instances'";
    
    logSQL(checkTableSql);
    db.query(checkTableSql, (err, results) => {
        if (err) {
            logError('checking table existence', err);
            return;
        }
        
        if (results.length === 0) {
            createNewHotoTable();
        } else {
            checkTableStructure();
        }
    });
}

function createNewHotoTable() {
    console.log('🔄 Creating new hoto_instances table...');
    
    const createTableSql = `
        CREATE TABLE hoto_instances (
            id INT AUTO_INCREMENT PRIMARY KEY,
            store_id INT NOT NULL,
            store_name VARCHAR(255) NOT NULL,
            user_id INT,
            user_name VARCHAR(255) NOT NULL,
            user_rank VARCHAR(50) NOT NULL,
            mobile_number VARCHAR(20),
            hoto_type ENUM('Hand Over', 'Take Over') NOT NULL,
            hoto_date DATE NOT NULL,
            status ENUM('ONGOING', 'COMPLETED', 'CANCELLED') DEFAULT 'ONGOING',
            box_condition ENUM('YES', 'NO') DEFAULT 'YES',
            issue_description TEXT,
            issue_notification TEXT,
            issue_resolved BOOLEAN DEFAULT FALSE,
            authorized_by VARCHAR(255),
            witnessed_by VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_store (store_id),
            INDEX idx_user (user_id),
            INDEX idx_status (status)
        ) ENGINE=InnoDB;
    `;
    
    logSQL(createTableSql);
    db.query(createTableSql, (err) => {
        if (err) {
            logError('creating hoto_instances table', err);
            return;
        }
        logInfo('✅ hoto_instances table created successfully with store_id column');
        createStoreTransactionsTable();
    });
}

function checkTableStructure() {
    console.log('🔍 Checking hoto_instances table structure...');
    
    const describeSql = "DESCRIBE hoto_instances";
    logSQL(describeSql);
    
    db.query(describeSql, (err, results) => {
        if (err) {
            logError('describing table', err);
            return;
        }
        
        const columns = results.map(col => col.Field);
        logInfo('Existing columns', columns);
        
        if (!columns.includes('store_id')) {
            console.log('🔄 Adding missing store_id column...');
            addStoreIdColumn();
        } else {
            logInfo('✅ store_id column already exists');
            createStoreTransactionsTable();
        }
    });
}

function addStoreIdColumn() {
    console.log('🔄 Adding store_id and store_name columns...');
    
    const checkDataSql = "SELECT COUNT(*) as count FROM hoto_instances";
    logSQL(checkDataSql);
    
    db.query(checkDataSql, (err, results) => {
        if (err) {
            logError('checking table data', err);
            return;
        }
        
        const rowCount = results[0]?.count || 0;
        
        if (rowCount > 0) {
            console.log(`📊 Table has ${rowCount} rows. Creating new table and migrating data...`);
            migrateToNewTable();
        } else {
            const alterSql = `
                ALTER TABLE hoto_instances 
                ADD COLUMN store_id INT NOT NULL AFTER id,
                ADD COLUMN store_name VARCHAR(255) NOT NULL AFTER store_id,
                ADD INDEX idx_store (store_id);
            `;
            
            logSQL(alterSql);
            db.query(alterSql, (err) => {
                if (err) {
                    logError('adding columns', err);
                    return;
                }
                logInfo('✅ Columns added successfully');
                createStoreTransactionsTable();
            });
        }
    });
}

function migrateToNewTable() {
    console.log('🔄 Migrating to new table structure...');
    
    const backupTableSql = "CREATE TABLE hoto_instances_backup LIKE hoto_instances";
    logSQL(backupTableSql);
    
    db.query(backupTableSql, (err) => {
        if (err) {
            logError('creating backup table', err);
            return;
        }
        
        const copyDataSql = "INSERT INTO hoto_instances_backup SELECT * FROM hoto_instances";
        logSQL(copyDataSql);
        
        db.query(copyDataSql, (err) => {
            if (err) {
                console.warn('⚠️ Error copying data to backup:', err);
            }
            
            const dropTableSql = "DROP TABLE hoto_instances";
            logSQL(dropTableSql);
            
            db.query(dropTableSql, (err) => {
                if (err) {
                    logError('dropping table', err);
                    return;
                }
                
                createNewHotoTable();
                console.log('✅ Migration complete. Old data backed up in hoto_instances_backup');
            });
        });
    });
}

function createStoreTransactionsTable() {
    const createTransactionsTable = `
        CREATE TABLE IF NOT EXISTS store_transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            store_id INT NOT NULL,
            transaction_type ENUM('HANDOVER', 'TAKEOVER') NOT NULL,
            from_user_id INT NULL,
            to_user_id INT NOT NULL,
            transaction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            remarks TEXT,
            hoto_instance_id INT NULL,
            INDEX idx_store (store_id),
            INDEX idx_from_user (from_user_id),
            INDEX idx_to_user (to_user_id),
            INDEX idx_hoto_instance (hoto_instance_id)
        ) ENGINE=InnoDB;
    `;
    
    logSQL(createTransactionsTable);
    db.query(createTransactionsTable, (err) => {
        if (err) {
            logError('creating store_transactions table', err);
            return;
        }
        logInfo('✅ Store transactions table created/verified');
        checkAndAddHotoInstanceColumn();
    });
}

function checkAndAddHotoInstanceColumn() {
    const checkColumnSql = `
        SELECT COUNT(*) as column_exists 
        FROM information_schema.columns 
        WHERE table_name = 'store_transactions' 
        AND column_name = 'hoto_instance_id' 
        AND table_schema = DATABASE()
    `;
    
    logSQL(checkColumnSql);
    db.query(checkColumnSql, (err, results) => {
        if (err) {
            console.warn('⚠️ Error checking column:', err);
            createDefaultAdmin();
            return;
        }
        
        if (results[0].column_exists === 0) {
            const addColumnSql = `
                ALTER TABLE store_transactions 
                ADD COLUMN hoto_instance_id INT NULL,
                ADD INDEX idx_hoto_instance (hoto_instance_id)
            `;
            
            logSQL(addColumnSql);
            db.query(addColumnSql, (addErr) => {
                if (addErr) {
                    console.warn('⚠️ Error adding hoto_instance_id column:', addErr);
                } else {
                    logInfo('✅ Added hoto_instance_id column to store_transactions table');
                }
                createDefaultAdmin();
            });
        } else {
            logInfo('✅ hoto_instance_id column already exists');
            createDefaultAdmin();
        }
    });
}

function createDefaultAdmin() {
    const checkAdminQuery = "SELECT COUNT(*) as count FROM users WHERE role = 'MEC_OIC_ADMIN'";
    logSQL(checkAdminQuery);
    
    db.query(checkAdminQuery, (err, results) => {
        if (err) {
            console.warn('⚠️ Could not check for existing admin:', err.message);
            return;
        }
        
        const adminCount = results[0]?.count || 0;
        
        if (adminCount === 0) {
            const createAdminQuery = `
                INSERT INTO users (name, \`rank\`, password, phone_number, role) 
                VALUES ('Admin', 'CPT', 'admin123', '12345678', 'MEC_OIC_ADMIN')
                ON DUPLICATE KEY UPDATE id=id
            `;
            
            logSQL(createAdminQuery);
            db.query(createAdminQuery, (err, result) => {
                if (err) {
                    console.warn('⚠️ Could not create default admin:', err.message);
                } else if (result.affectedRows > 0) {
                    console.log('\n═══════════════════════════════════════════════════');
                    console.log('👑 DEFAULT ADMIN USER CREATED:');
                    console.log('👤 Username: Admin');
                    console.log('🔑 Password: admin123');
                    console.log('⭐ Rank: CPT');
                    console.log('⚡ Role: MEC OIC Admin');
                    console.log('═══════════════════════════════════════════════════\n');
                }
            });
        } else {
            logInfo(`✅ Admin user(s) already exist in database (count: ${adminCount})`);
        }
    });
}

// --- HELPER FUNCTIONS ---
function generateQRCode(storeId, storeName) {
    const data = `STORE:${storeId}:${storeName}:${Date.now()}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
}

// --- API Endpoints ---

// 1. API to GET all stores
app.get('/api/stores', (req, res) => {
    const sql = `
        SELECT s.*, 
               u1.name as created_by_name,
               u2.name as current_holder_name
        FROM stores s
        LEFT JOIN users u1 ON s.created_by_id = u1.id
        LEFT JOIN users u2 ON s.current_holder_id = u2.id
        ORDER BY s.name ASC
    `;
    
    logSQL(sql);
    db.query(sql, (err, results) => {
        if (err) {
            logError('fetching stores', err);
            // Try simple query
            const simpleSql = "SELECT * FROM stores ORDER BY name ASC";
            logSQL(simpleSql);
            db.query(simpleSql, (simpleErr, simpleResults) => {
                if (simpleErr) {
                    return res.status(500).json({ message: 'Error fetching stores' });
                }
                logInfo(`✅ Fetched ${simpleResults.length} stores (simple query)`);
                res.status(200).json(simpleResults);
            });
            return;
        }
        logInfo(`✅ Fetched ${results.length} stores`);
        res.status(200).json(results);
    });
});

// 2. API to CREATE a new store WITHOUT QR code
app.post('/api/stores', (req, res) => {
    const { name, created_by_id } = req.body;
    
    logInfo('Creating store', { name, created_by_id });
    
    const getUserSql = "SELECT role FROM users WHERE id = ?";
    logSQL(getUserSql, [created_by_id]);
    
    db.query(getUserSql, [created_by_id], (userErr, userResults) => {
        if (userErr || userResults.length === 0) {
            logError('fetching user role', userErr);
            return res.status(404).json({ message: 'User not found' });
        }
        
        const userRole = userResults[0].role;
        const team = userRole === 'RQ' ? 'TEAM_B' : 'TEAM_A';
        
        const sql = "INSERT INTO stores (name, created_by_id, team) VALUES (?, ?, ?)";
        logSQL(sql, [name, created_by_id, team]);
        
        db.query(sql, [name, created_by_id, team], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    logInfo('❌ Store creation failed - duplicate name', { name });
                    return res.status(409).json({ message: 'A store with this name already exists.' });
                }
                logError('creating store', err);
                return res.status(500).json({ message: 'Error creating store' });
            }
            logInfo('✅ Store created successfully', { storeId: result.insertId, team });
            res.status(201).json({ 
                message: 'Store created successfully', 
                storeId: result.insertId,
                team: team
            });
        });
    });
});

// 3. API to GET store by ID
app.get('/api/stores/:id', (req, res) => {
    const storeId = req.params.id;
    logInfo('Fetching store by ID', { storeId });
    
    const sql = `
        SELECT s.*, 
               u1.name as created_by_name,
               u2.name as current_holder_name
        FROM stores s
        LEFT JOIN users u1 ON s.created_by_id = u1.id
        LEFT JOIN users u2 ON s.current_holder_id = u2.id
        WHERE s.id = ?
    `;
    
    logSQL(sql, [storeId]);
    db.query(sql, [storeId], (err, results) => {
        if (err) {
            logError('fetching store', err);
            return res.status(500).json({ message: 'Error fetching store' });
        }
        if (results.length > 0) {
            logInfo('✅ Store found', results[0]);
            res.status(200).json(results[0]);
        } else {
            logInfo('❌ Store not found', { storeId });
            res.status(404).json({ message: 'Store not found' });
        }
    });
});

// 4. API to DELETE a store
app.delete('/api/stores/:id', (req, res) => {
    const storeId = req.params.id;
    logInfo('Deleting store', { storeId });
    
    const sql = "DELETE FROM stores WHERE id = ?";
    logSQL(sql, [storeId]);
    
    db.query(sql, [storeId], (err, result) => {
        if (err) {
            logError('deleting store', err);
            return res.status(500).json({ message: 'Error deleting store' });
        }
        if (result.affectedRows === 0) {
            logInfo('❌ Store not found for deletion', { storeId });
            return res.status(404).json({ message: 'Store not found' });
        }
        logInfo('✅ Store deleted successfully', { storeId, affectedRows: result.affectedRows });
        res.status(200).json({ message: 'Store deleted successfully' });
    });
});

// 5. API to handover a store to another user - UPDATED FOR ADMIN PRIVILEGES
app.post('/api/stores/:id/handover', (req, res) => {
    const storeId = req.params.id;
    const { handed_over_by, handed_over_to, remarks } = req.body;
    
    logInfo('Handover request', { storeId, handed_over_by, handed_over_to, remarks });
    
    // Get the user role of the person handing over
    const getUserRoleSql = "SELECT role FROM users WHERE id = ?";
    logSQL(getUserRoleSql, [handed_over_by]);
    
    db.query(getUserRoleSql, [handed_over_by], (roleErr, roleResults) => {
        if (roleErr || roleResults.length === 0) {
            logError('fetching user role for handover', roleErr);
            return res.status(404).json({ message: 'User handing over not found' });
        }
        
        const userRole = roleResults[0].role;
        logInfo('User role for handover', { userId: handed_over_by, role: userRole });
        
        const getStoreSql = "SELECT * FROM stores WHERE id = ?";
        logSQL(getStoreSql, [storeId]);
        
        db.query(getStoreSql, [storeId], (err, results) => {
            if (err || results.length === 0) {
                logError('fetching store for handover', err);
                return res.status(404).json({ message: 'Store not found' });
            }
            
            const store = results[0];
            logInfo('Store found for handover', store);
            
            // NEW LOGIC: ADMIN can handover when holder is NONE or ANY status
            if (userRole === 'MEC_OIC_ADMIN') {
                logInfo('Admin handover - bypassing holder check', {
                    storeId,
                    currentHolder: store.current_holder_id,
                    status: store.status
                });
                // Admin can handover any store, regardless of current holder
                proceedWithHandover();
                return;
            }
            
            // For non-admin users: Original logic
            // Validate store status
            if (store.status === 'HANDED_OVER') {
                logInfo('❌ Handover failed - store already handed over', { storeId });
                return res.status(400).json({ message: 'Store has already been handed over' });
            }
            
            // Validate current holder for non-admin users
            if (store.status === 'TAKEN_OVER' && store.current_holder_id != handed_over_by) {
                logInfo('❌ Handover failed - not current holder', { 
                    storeId, 
                    currentHolder: store.current_holder_id,
                    requestingUser: handed_over_by 
                });
                return res.status(403).json({ message: 'You are not the current holder of this store' });
            }
            
            proceedWithHandover();
            
            function proceedWithHandover() {
                // Get user details for the new holder - IMMEDIATELY update holder
                const getUserSql = "SELECT name, `rank` FROM users WHERE id = ?";
                logSQL(getUserSql, [handed_over_to]);
                
                db.query(getUserSql, [handed_over_to], (userErr, userResults) => {
                    if (userErr || userResults.length === 0) {
                        logError('fetching user to handover to', userErr);
                        return res.status(404).json({ message: 'User to handover to not found' });
                    }
                    
                    const newHolder = userResults[0];
                    logInfo('New holder found', newHolder);
                    
                    // IMMEDIATELY update store holder to the receiving user
                    const updateStoreSql = `
                        UPDATE stores 
                        SET status = 'TAKEN_OVER',
                            current_holder_id = ?
                        WHERE id = ?
                    `;
                    
                    logSQL(updateStoreSql, [handed_over_to, storeId]);
                    db.query(updateStoreSql, [handed_over_to, storeId], (updateErr) => {
                        if (updateErr) {
                            logError('updating store holder', updateErr);
                            return res.status(500).json({ message: 'Error updating store holder' });
                        }
                        
                        // Create a transaction record with immediate holder change
                        const transactionSql = `
                            INSERT INTO store_transactions 
                            (store_id, transaction_type, from_user_id, to_user_id, remarks) 
                            VALUES (?, 'HANDOVER', ?, ?, ?)
                        `;
                        
                        const transactionRemarks = remarks || 
                            (userRole === 'MEC_OIC_ADMIN' 
                                ? `Admin ${handed_over_by} handed over to ${newHolder.name}`
                                : `Handed over by user ${handed_over_by} to ${newHolder.name}`);
                        
                        logSQL(transactionSql, [storeId, handed_over_by, handed_over_to, transactionRemarks]);
                        
                        db.query(transactionSql, [storeId, handed_over_by, handed_over_to, transactionRemarks], (transactionErr) => {
                            if (transactionErr) {
                                console.warn('⚠️ Could not create transaction record:', transactionErr);
                            }
                            
                            logInfo('✅ Handover successful with immediate holder change', { 
                                storeId, 
                                from: handed_over_by, 
                                to: handed_over_to,
                                newHolder: newHolder.name,
                                admin: userRole === 'MEC_OIC_ADMIN'
                            });
                            
                            res.status(200).json({ 
                                message: `Store handed over successfully to ${newHolder.rank} ${newHolder.name}`,
                                storeId: storeId,
                                newHolder: newHolder,
                                immediateHolderChange: true,
                                adminInitiated: userRole === 'MEC_OIC_ADMIN'
                            });
                        });
                    });
                });
            }
        });
    });
});

// 6. API to START a HOTO (Hand Over/Take Over) for stores
app.post('/api/hoto/start', (req, res) => {
    const { store_id, store_name, user_id, user_name, user_rank, mobile_number, hoto_type, hoto_date } = req.body;
    
    logInfo('Starting HOTO', {
        store_id, store_name, user_id, user_name, user_rank, mobile_number, hoto_type, hoto_date
    });
    
    // Validate required fields
    if (!store_id || !store_name || !user_name || !user_rank || !hoto_type || !hoto_date) {
        logInfo('❌ HOTO start failed - missing required fields', {
            missing: {
                store_id: !store_id,
                store_name: !store_name,
                user_name: !user_name,
                user_rank: !user_rank,
                hoto_type: !hoto_type,
                hoto_date: !hoto_date
            }
        });
        return res.status(400).json({ 
            message: 'Missing required fields',
            required: ['store_id', 'store_name', 'user_name', 'user_rank', 'hoto_type', 'hoto_date']
        });
    }
    
    const sql = `
        INSERT INTO hoto_instances 
        (store_id, store_name, user_id, user_name, user_rank, mobile_number, hoto_type, hoto_date, status) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ONGOING')
    `;
    
    const params = [store_id, store_name, user_id, user_name, user_rank, mobile_number, hoto_type, hoto_date];
    logSQL(sql, params);
    
    db.query(sql, params, (err, result) => {
        if (err) {
            logError('starting HOTO', err);
            return res.status(500).json({ 
                message: 'Error starting HOTO',
                error: err.message,
                sqlState: err.sqlState
            });
        }
        
        logInfo('✅ HOTO started successfully', { hotoId: result.insertId });
        res.status(201).json({ 
            message: 'HOTO started successfully', 
            hotoId: result.insertId 
        });
    });
});

// 7. API to COMPLETE a HOTO for stores
app.post('/api/hoto/complete/:hotoId', (req, res) => {
    const hotoId = req.params.hotoId;
    const { box_condition, issue_description, issue_notification, issue_resolved, authorized_by, witnessed_by } = req.body;
    
    logInfo('Completing HOTO', { 
        hotoId, box_condition, issue_description, issue_notification, issue_resolved, authorized_by, witnessed_by 
    });
    
    const getHotoSql = "SELECT * FROM hoto_instances WHERE id = ?";
    logSQL(getHotoSql, [hotoId]);
    
    db.query(getHotoSql, [hotoId], (getErr, getResults) => {
        if (getErr || getResults.length === 0) {
            logError('HOTO not found', getErr || 'No results');
            return res.status(404).json({ message: 'HOTO instance not found' });
        }
        
        const hoto = getResults[0];
        logInfo('Found HOTO', hoto);
        
        const updateHotoSql = `
            UPDATE hoto_instances 
            SET status = 'COMPLETED',
                box_condition = ?,
                issue_description = ?,
                issue_notification = ?,
                issue_resolved = ?,
                authorized_by = ?,
                witnessed_by = ?
            WHERE id = ?
        `;
        
        const updateValues = [
            box_condition || 'YES',
            issue_description || '',
            issue_notification || '',
            issue_resolved || false,
            authorized_by || '',
            witnessed_by || '',
            hotoId
        ];
        
        logSQL(updateHotoSql, updateValues);
        
        db.query(updateHotoSql, updateValues, (updateErr, updateResult) => {
            if (updateErr) {
                logError('updating HOTO', updateErr);
                return res.status(500).json({ message: 'Error completing HOTO' });
            }
            
            // Store holder is already updated in the handover endpoint
            // No need to update again here
            
            const transactionSql = `
                INSERT INTO store_transactions 
                (store_id, transaction_type, from_user_id, to_user_id, remarks, hoto_instance_id) 
                VALUES (?, ?, NULL, ?, ?, ?)
            `;
            
            const transactionType = hoto.hoto_type === 'Hand Over' ? 'HANDOVER' : 'TAKEOVER';
            const remarks = `Store ${hoto.hoto_type}: ${hoto.store_name} by ${hoto.user_name}`;
            
            logSQL(transactionSql, [hoto.store_id, transactionType, hoto.user_id, remarks, hotoId]);
            
            db.query(transactionSql, [
                hoto.store_id, transactionType, hoto.user_id, remarks, hotoId
            ], (transactionErr) => {
                if (transactionErr) {
                    console.warn('⚠️ Could not create transaction record:', transactionErr);
                }
                
                logInfo('✅ HOTO completed successfully', {
                    hotoId,
                    storeId: hoto.store_id,
                    hotoType: hoto.hoto_type
                });
                
                res.status(200).json({ 
                    message: `Store ${hoto.hoto_type} completed successfully!`,
                    storeId: hoto.store_id
                });
            });
        });
    });
});

// 8. API to GET store items (for future use if needed)
app.get('/api/stores/:id/items', (req, res) => {
    const storeId = req.params.id;
    logInfo('Fetching store items', { storeId });
    
    const sql = "SELECT * FROM store_items WHERE store_id = ? ORDER BY item_name ASC";
    logSQL(sql, [storeId]);
    
    db.query(sql, [storeId], (err, results) => {
        if (err) {
            logError('fetching store items', err);
            return res.status(500).json({ message: 'Error fetching store items' });
        }
        logInfo(`✅ Fetched ${results.length} store items`, { storeId });
        res.status(200).json(results);
    });
});

// 9. API to add/update store items (for future use if needed)
app.post('/api/stores/:id/items', (req, res) => {
    const storeId = req.params.id;
    const { items } = req.body;
    
    logInfo('Updating store items', { storeId, itemCount: items?.length || 0 });
    
    const deleteSql = "DELETE FROM store_items WHERE store_id = ?";
    logSQL(deleteSql, [storeId]);
    
    db.query(deleteSql, [storeId], (deleteErr) => {
        if (deleteErr) {
            logError('clearing store items', deleteErr);
            return res.status(500).json({ message: 'Error updating store items' });
        }
        
        if (!items || items.length === 0) {
            logInfo('✅ Store items cleared', { storeId });
            return res.status(200).json({ message: 'Store items cleared' });
        }
        
        const insertSql = "INSERT INTO store_items (store_id, item_name, quantity, `condition`, notes) VALUES ?";
        const values = items.map(item => [
            storeId, 
            item.item_name, 
            item.quantity || 1, 
            item.condition || 'GOOD', 
            item.notes || ''
        ]);
        
        logSQL(insertSql + ' [values array]', { itemCount: values.length });
        
        db.query(insertSql, [values], (insertErr, insertResult) => {
            if (insertErr) {
                logError('adding store items', insertErr);
                return res.status(500).json({ message: 'Error adding store items' });
            }
            logInfo('✅ Store items updated successfully', { itemsAdded: insertResult.affectedRows });
            res.status(200).json({ 
                message: 'Store items updated successfully',
                itemsAdded: insertResult.affectedRows 
            });
        });
    });
});

// 10. API for User Login
app.post('/api/login', (req, res) => {
    const { name, password } = req.body;
    
    logInfo('Login attempt', { name, passwordLength: password?.length });
    
    const sql = "SELECT * FROM users WHERE name = ? AND password = ?";
    logSQL(sql, [name, password]);
    
    db.query(sql, [name, password], (err, results) => {
        if (err) {
            logError('login', err);
            return res.status(500).json({ message: 'Database error' });
        }
        
        if (results.length > 0) {
            const user = results[0];
            logInfo('✅ Login successful', { 
                userId: user.id, 
                name: user.name, 
                role: user.role 
            });
            
            res.status(200).json({
                message: 'Login successful',
                id: user.id,
                name: user.name,
                rank: user.rank,
                phoneNumber: user.phone_number,
                role: user.role || 'MEMBER'
            });
        } else {
            logInfo('❌ Login failed - invalid credentials', { name });
            res.status(401).json({ message: 'Invalid name or password' });
        }
    });
});

// 11. API to get user info by name
app.post('/api/user-info', (req, res) => {
    const { name } = req.body;
    
    logInfo('Fetching user info', { name });
    
    if (!name) {
        logInfo('❌ User info request failed - name required');
        return res.status(400).json({ message: 'Name is required' });
    }
    
    const sql = "SELECT id, name, `rank`, role FROM users WHERE name = ?";
    logSQL(sql, [name]);
    
    db.query(sql, [name], (err, results) => {
        if (err) {
            logError('fetching user info', err);
            return res.status(500).json({ message: 'Error fetching user info' });
        }
        
        if (results.length === 0) {
            logInfo('❌ User not found', { name });
            return res.status(404).json({ message: 'User not found' });
        }
        
        const user = results[0];
        logInfo('✅ User info found', user);
        
        res.status(200).json({
            id: user.id,
            name: user.name,
            rank: user.rank,
            role: user.role || 'MEMBER'
        });
    });
});

// 12. API to get store transactions
app.get('/api/stores/:id/transactions', (req, res) => {
    const storeId = req.params.id;
    logInfo('Fetching store transactions', { storeId });
    
    const sql = `
        SELECT st.*, 
               u1.name as from_user_name,
               u2.name as to_user_name,
               hi.hoto_type
        FROM store_transactions st
        LEFT JOIN users u1 ON st.from_user_id = u1.id
        LEFT JOIN users u2 ON st.to_user_id = u2.id
        LEFT JOIN hoto_instances hi ON st.hoto_instance_id = hi.id
        WHERE st.store_id = ?
        ORDER BY st.transaction_date DESC
    `;
    
    logSQL(sql, [storeId]);
    db.query(sql, [storeId], (err, results) => {
        if (err) {
            logError('fetching transactions', err);
            return res.status(500).json({ message: 'Error fetching transactions' });
        }
        logInfo(`✅ Fetched ${results.length} transactions`, { storeId });
        res.status(200).json(results);
    });
});

// 13. API to get past HOTO records
app.get('/api/hoto/records', (req, res) => {
    logInfo('Fetching past HOTO records');
    
    const sql = `
        SELECT hi.*, s.name as store_name
        FROM hoto_instances hi
        LEFT JOIN stores s ON hi.store_id = s.id
        WHERE hi.status = 'COMPLETED'
        ORDER BY hi.hoto_date DESC, hi.created_at DESC
    `;
    
    logSQL(sql);
    db.query(sql, (err, results) => {
        if (err) {
            logError('fetching HOTO records', err);
            return res.status(500).json({ message: 'Error fetching HOTO records' });
        }
        logInfo(`✅ Fetched ${results.length} HOTO records`);
        res.status(200).json(results);
    });
});

// 14. API to generate QR code for store
app.post('/api/stores/:id/generate-qr', (req, res) => {
    const storeId = req.params.id;
    logInfo('Generating QR code', { storeId });
    
    const getStoreSql = "SELECT name FROM stores WHERE id = ?";
    logSQL(getStoreSql, [storeId]);
    
    db.query(getStoreSql, [storeId], (err, results) => {
        if (err || results.length === 0) {
            logError('store not found for QR generation', err);
            return res.status(404).json({ message: 'Store not found' });
        }
        
        const storeName = results[0].name;
        const qrCode = generateQRCode(storeId, storeName);
        
        logInfo('✅ QR code generated', { storeId, storeName, qrCodePreview: qrCode.substring(0, 20) });
        
        res.status(200).json({ 
            message: 'QR code generated successfully',
            storeId: storeId,
            storeName: storeName,
            qrCode: qrCode
        });
    });
});

// 15. API to get store status
app.get('/api/stores/:id/status', (req, res) => {
    const storeId = req.params.id;
    logInfo('Fetching store status', { storeId });
    
    const sql = "SELECT status, current_holder_id FROM stores WHERE id = ?";
    logSQL(sql, [storeId]);
    
    db.query(sql, [storeId], (err, results) => {
        if (err) {
            logError('fetching store status', err);
            return res.status(500).json({ message: 'Error fetching store status' });
        }
        if (results.length > 0) {
            logInfo('✅ Store status found', results[0]);
            res.status(200).json(results[0]);
        } else {
            logInfo('❌ Store not found for status check', { storeId });
            res.status(404).json({ message: 'Store not found' });
        }
    });
});

// 16. API to get HOTO record by ID
app.get('/api/hoto-records/:id', (req, res) => {
    const recordId = req.params.id;
    logInfo('Fetching HOTO record by ID', { recordId });
    
    const sql = `
        SELECT hi.*, s.name as store_name
        FROM hoto_instances hi
        LEFT JOIN stores s ON hi.store_id = s.id
        WHERE hi.id = ?
    `;
    
    logSQL(sql, [recordId]);
    db.query(sql, [recordId], (err, results) => {
        if (err) {
            logError('fetching HOTO record', err);
            return res.status(500).json({ message: 'Error fetching HOTO record' });
        }
        if (results.length > 0) {
            logInfo('✅ HOTO record found', results[0]);
            res.status(200).json(results[0]);
        } else {
            logInfo('❌ HOTO record not found', { recordId });
            res.status(404).json({ message: 'HOTO record not found' });
        }
    });
});

// 17. API to change password
app.post('/api/change-password', (req, res) => {
    const { name, currentPassword, newPassword } = req.body;
    
    logInfo('Changing password', { name, currentPasswordLength: currentPassword?.length, newPasswordLength: newPassword?.length });
    
    const verifySql = "SELECT * FROM users WHERE name = ? AND password = ?";
    logSQL(verifySql, [name, currentPassword]);
    
    db.query(verifySql, [name, currentPassword], (verifyErr, verifyResults) => {
        if (verifyErr) {
            logError('verifying password', verifyErr);
            return res.status(500).json({ message: 'Error verifying current password' });
        }
        
        if (verifyResults.length === 0) {
            logInfo('❌ Password change failed - incorrect current password', { name });
            return res.status(401).json({ message: 'Current password is incorrect' });
        }
        
        const updateSql = "UPDATE users SET password = ? WHERE name = ?";
        logSQL(updateSql, [newPassword, name]);
        
        db.query(updateSql, [newPassword, name], (updateErr, updateResult) => {
            if (updateErr) {
                logError('updating password', updateErr);
                return res.status(500).json({ message: 'Error updating password' });
            }
            
            logInfo('✅ Password changed successfully', { name, affectedRows: updateResult.affectedRows });
            res.status(200).json({ message: 'Password updated successfully' });
        });
    });
});

// 18. API to generate store QR code with encryption
app.post('/api/stores/:id/generate-store-qr', (req, res) => {
    const storeId = req.params.id;
    logInfo('Generating encrypted store QR', { storeId });
    
    const getStoreSql = "SELECT name FROM stores WHERE id = ?";
    logSQL(getStoreSql, [storeId]);
    
    db.query(getStoreSql, [storeId], (err, results) => {
        if (err || results.length === 0) {
            logError('store not found for encrypted QR', err);
            return res.status(404).json({ message: 'Store not found' });
        }
        
        const storeName = results[0].name;
        const storeData = `STORE:${storeId}:${storeName}:${Date.now()}`;
        
        const qrData = crypto.createHash('sha256').update(storeData).digest('hex').substring(0, 32);
        const fullData = JSON.stringify({
            storeId: storeId,
            storeName: storeName,
            timestamp: Date.now()
        });
        
        logInfo('✅ Encrypted QR generated', { 
            storeId, storeName, 
            qrDataPreview: qrData.substring(0, 10),
            fullDataPreview: fullData.substring(0, 50) + '...'
        });
        
        res.status(200).json({ 
            message: 'Store QR code generated successfully',
            storeId: storeId,
            storeName: storeName,
            qrData: qrData,
            encryptedData: fullData
        });
    });
});

// 19. API for admin user management
app.get('/api/admin/users', (req, res) => {
    logInfo('Admin fetching all users');
    
    const sql = "SELECT id, name, `rank`, phone_number, role FROM users ORDER BY name ASC";
    logSQL(sql);
    
    db.query(sql, (err, results) => {
        if (err) {
            logError('fetching users', err);
            return res.status(500).json({ message: 'Error fetching users' });
        }
        logInfo(`✅ Admin fetched ${results.length} users`);
        res.status(200).json(results);
    });
});

// 20. API to create user (admin only)
app.post('/api/admin/users', (req, res) => {
    const { name, password, rank, phoneNumber, role } = req.body;
    
    logInfo('Admin creating user', { name, rank, role, phoneNumber, passwordLength: password?.length });
    
    // Validate input
    if (!name || !password || !rank || !phoneNumber || !role) {
        logInfo('❌ User creation failed - missing fields', {
            name: !!name,
            password: !!password,
            rank: !!rank,
            phoneNumber: !!phoneNumber,
            role: !!role
        });
        return res.status(400).json({ message: 'All fields are required' });
    }
    
    if (password.length < 6) {
        logInfo('❌ User creation failed - password too short', { passwordLength: password.length });
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    
    if (!/^\d{8}$/.test(phoneNumber)) {
        logInfo('❌ User creation failed - invalid phone number', { phoneNumber });
        return res.status(400).json({ message: 'Phone number must be exactly 8 digits' });
    }
    
    const sql = "INSERT INTO users (name, password, `rank`, phone_number, role) VALUES (?, ?, ?, ?, ?)";
    logSQL(sql, [name, password, rank, phoneNumber, role]);
    
    db.query(sql, [name, password, rank, phoneNumber, role], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                logInfo('❌ User creation failed - duplicate name', { name });
                return res.status(409).json({ message: 'User with this name already exists' });
            }
            logError('creating user', err);
            return res.status(500).json({ message: 'Error creating user' });
        }
        logInfo('✅ User created successfully', { userId: result.insertId, name });
        res.status(201).json({ 
            message: 'User created successfully',
            userId: result.insertId
        });
    });
});

// 21. API to update user role (admin only)
app.post('/api/admin/users/:id/role', (req, res) => {
    const userId = req.params.id;
    const { role } = req.body;
    
    logInfo('Admin updating user role', { userId, role });
    
    if (!role) {
        logInfo('❌ Role update failed - role required');
        return res.status(400).json({ message: 'Role is required' });
    }
    
    const sql = "UPDATE users SET role = ? WHERE id = ?";
    logSQL(sql, [role, userId]);
    
    db.query(sql, [role, userId], (err, result) => {
        if (err) {
            logError('updating user role', err);
            return res.status(500).json({ message: 'Error updating user role' });
        }
        
        if (result.affectedRows === 0) {
            logInfo('❌ Role update failed - user not found', { userId });
            return res.status(404).json({ message: 'User not found' });
        }
        
        logInfo('✅ User role updated successfully', { userId, role, affectedRows: result.affectedRows });
        res.status(200).json({ message: 'User role updated successfully' });
    });
});

// 22. API to delete user (admin only)
app.delete('/api/admin/users/:id', (req, res) => {
    const userId = req.params.id;
    logInfo('Admin deleting user', { userId });
    
    const checkSql = "SELECT role FROM users WHERE id = ?";
    logSQL(checkSql, [userId]);
    
    db.query(checkSql, [userId], (checkErr, checkResults) => {
        if (checkErr || checkResults.length === 0) {
            logError('checking user before deletion', checkErr);
            return res.status(404).json({ message: 'User not found' });
        }
        
        const user = checkResults[0];
        
        // Check if this is the last admin
        if (user.role === 'MEC_OIC_ADMIN') {
            const countAdminsSql = "SELECT COUNT(*) as adminCount FROM users WHERE role = 'MEC_OIC_ADMIN'";
            logSQL(countAdminsSql);
            
            db.query(countAdminsSql, (countErr, countResults) => {
                if (countErr) {
                    logError('checking admin count', countErr);
                    return res.status(500).json({ message: 'Error checking admin count' });
                }
                
                const adminCount = countResults[0].adminCount;
                if (adminCount <= 1) {
                    logInfo('❌ User deletion failed - cannot delete last admin', { userId, adminCount });
                    return res.status(400).json({ message: 'Cannot delete the last admin user' });
                }
                
                deleteUser(userId, res);
            });
        } else {
            deleteUser(userId, res);
        }
    });
});

function deleteUser(userId, res) {
    const deleteSql = "DELETE FROM users WHERE id = ?";
    logSQL(deleteSql, [userId]);
    
    db.query(deleteSql, [userId], (deleteErr, deleteResult) => {
        if (deleteErr) {
            logError('deleting user', deleteErr);
            return res.status(500).json({ message: 'Error deleting user' });
        }
        
        if (deleteResult.affectedRows === 0) {
            logInfo('❌ User deletion failed - user not found', { userId });
            return res.status(404).json({ message: 'User not found' });
        }
        
        logInfo('✅ User deleted successfully', { userId, affectedRows: deleteResult.affectedRows });
        res.status(200).json({ message: 'User deleted successfully' });
    });
}

// 23. API to get users for handover selection
app.get('/api/users', (req, res) => {
    logInfo('Fetching all users for handover selection');
    
    const sql = "SELECT id, name, `rank`, role FROM users ORDER BY name ASC";
    logSQL(sql);
    
    db.query(sql, (err, results) => {
        if (err) {
            logError('fetching users for handover', err);
            return res.status(500).json({ message: 'Error fetching users' });
        }
        logInfo(`✅ Fetched ${results.length} users for handover`);
        res.status(200).json(results);
    });
});

// 24. API to get users by role
app.get('/api/users/role/:role', (req, res) => {
    const role = req.params.role;
    logInfo('Fetching users by role', { role });
    
    const sql = "SELECT id, name, `rank` FROM users WHERE role = ? ORDER BY name ASC";
    logSQL(sql, [role]);
    
    db.query(sql, [role], (err, results) => {
        if (err) {
            logError('fetching users by role', err);
            return res.status(500).json({ message: 'Error fetching users' });
        }
        logInfo(`✅ Fetched ${results.length} users with role: ${role}`);
        res.status(200).json(results);
    });
});

// 25. Diagnostic endpoint to check table structure
app.get('/api/debug/hoto-table', (req, res) => {
    logInfo('Debug: checking hoto_instances table structure');
    
    const sql = "DESCRIBE hoto_instances";
    logSQL(sql);
    
    db.query(sql, (err, results) => {
        if (err) {
            return res.status(500).json({ 
                message: 'Error describing table',
                error: err.message 
            });
        }
        
        logInfo('Table structure retrieved', { columnCount: results.length });
        res.status(200).json({
            message: 'Table structure',
            columns: results,
            columnCount: results.length,
            columnNames: results.map(col => col.Field)
        });
    });
});

// 26. API to update store team
app.post('/api/stores/:id/update-team', (req, res) => {
    const storeId = req.params.id;
    const { team } = req.body;
    
    logInfo('Updating store team', { storeId, team });
    
    const sql = "UPDATE stores SET team = ? WHERE id = ?";
    logSQL(sql, [team, storeId]);
    
    db.query(sql, [team, storeId], (err, result) => {
        if (err) {
            logError('updating store team', err);
            return res.status(500).json({ message: 'Error updating store team' });
        }
        
        if (result.affectedRows === 0) {
            logInfo('❌ Store team update failed - store not found', { storeId });
            return res.status(404).json({ message: 'Store not found' });
        }
        
        logInfo('✅ Store team updated successfully', { storeId, team, affectedRows: result.affectedRows });
        res.status(200).json({ 
            message: 'Store team updated successfully',
            storeId: storeId,
            team: team
        });
    });
});

// 27. DEBUG ENDPOINT: Show all data in database
app.get('/api/debug/all-data', (req, res) => {
    if (!DEBUG_MODE) {
        return res.status(403).json({ message: 'Debug mode is disabled' });
    }
    
    logInfo('Debug: fetching all database data');
    
    const queries = {
        users: "SELECT id, name, rank, role, phone_number FROM users ORDER BY id",
        stores: "SELECT id, name, status, team, created_by_id, current_holder_id FROM stores ORDER BY id",
        hoto_instances: "SELECT id, store_id, store_name, user_name, hoto_type, status, hoto_date FROM hoto_instances ORDER BY id",
        store_transactions: "SELECT id, store_id, transaction_type, from_user_id, to_user_id, transaction_date FROM store_transactions ORDER BY id"
    };
    
    const results = {};
    let completedQueries = 0;
    const totalQueries = Object.keys(queries).length;
    
    Object.entries(queries).forEach(([key, sql]) => {
        logSQL(`Debug query for ${key}`, sql);
        db.query(sql, (err, queryResults) => {
            if (err) {
                results[key] = { error: err.message };
            } else {
                results[key] = {
                    count: queryResults.length,
                    data: queryResults.slice(0, 10), // Limit to first 10 for readability
                    total: queryResults.length
                };
            }
            
            completedQueries++;
            if (completedQueries === totalQueries) {
                logInfo('Debug: all data fetched', {
                    users: results.users?.count || 0,
                    stores: results.stores?.count || 0,
                    hoto_instances: results.hoto_instances?.count || 0,
                    store_transactions: results.store_transactions?.count || 0
                });
                
                res.status(200).json({
                    message: 'Debug data fetched successfully',
                    timestamp: new Date().toISOString(),
                    ...results
                });
            }
        });
    });
});

// Add this endpoint to server.js - FIXED: Single HOTO record endpoint
app.get('/api/hoto-records/:id', (req, res) => {
    const recordId = req.params.id;
    logInfo('Fetching HOTO record by ID', { recordId });
    
    const sql = `
        SELECT hi.*, s.name as store_name
        FROM hoto_instances hi
        LEFT JOIN stores s ON hi.store_id = s.id
        WHERE hi.id = ?
    `;
    
    logSQL(sql, [recordId]);
    db.query(sql, [recordId], (err, results) => {
        if (err) {
            logError('fetching HOTO record', err);
            return res.status(500).json({ message: 'Error fetching HOTO record' });
        }
        if (results.length > 0) {
            logInfo('✅ HOTO record found', results[0]);
            res.status(200).json(results[0]);
        } else {
            logInfo('❌ HOTO record not found', { recordId });
            res.status(404).json({ message: 'HOTO record not found' });
        }
    });
});

// 28. DEBUG ENDPOINT: Test QR encryption/decryption
app.post('/api/debug/test-qr', (req, res) => {
    if (!DEBUG_MODE) {
        return res.status(403).json({ message: 'Debug mode is disabled' });
    }
    
    const { data } = req.body;
    logInfo('Debug: testing QR encryption', { data });
    
    // Simulate encryption like in stores.js
    const ENCRYPTION_KEY = 'sbedamien';
    
    function encryptData(data, key) {
        let encrypted = '';
        for (let i = 0; i < data.length; i++) {
            const keyChar = key.charCodeAt(i % key.length);
            const dataChar = data.charCodeAt(i);
            encrypted += String.fromCharCode(dataChar ^ keyChar);
        }
        return Buffer.from(encrypted).toString('base64');
    }
    
    function decryptData(encryptedData, key) {
        const decoded = Buffer.from(encryptedData, 'base64').toString('binary');
        let decrypted = '';
        for (let i = 0; i < decoded.length; i++) {
            const keyChar = key.charCodeAt(i % key.length);
            const dataChar = decoded.charCodeAt(i);
            decrypted += String.fromCharCode(dataChar ^ keyChar);
        }
        return decrypted;
    }
    
    try {
        const encrypted = encryptData(JSON.stringify(data), ENCRYPTION_KEY);
        const decrypted = JSON.parse(decryptData(encrypted, ENCRYPTION_KEY));
        
        logInfo('QR encryption test successful', {
            original: data,
            encryptedPreview: encrypted.substring(0, 50) + '...',
            decrypted: decrypted
        });
        
        res.status(200).json({
            original: data,
            encrypted: encrypted,
            decrypted: decrypted,
            encryptionKey: ENCRYPTION_KEY,
            success: true
        });
        
    } catch (error) {
        logError('QR encryption test failed', error);
        res.status(500).json({
            error: error.message,
            success: false
        });
    }
});

// Start the server
server.listen(port, () => {
    console.log('\n═══════════════════════════════════════════════════');
    console.log(`🚀 Server is running at http://localhost:${port}`);
    console.log(`📊 Store HOTO System Ready`);
    console.log(`🔍 Debug Mode: ${DEBUG_MODE ? 'ENABLED' : 'DISABLED'}`);
    console.log(`📝 Request Logging: ${LOG_REQUESTS ? 'ENABLED' : 'DISABLED'}`);
    console.log(`📄 Response Logging: ${LOG_RESPONSES ? 'ENABLED' : 'DISABLED'}`);
    console.log(`🗄️ SQL Logging: ${LOG_SQL ? 'ENABLED' : 'DISABLED'}`);
    console.log(`═══════════════════════════════════════════════════\n`);
    
    console.log(`📡 WebSocket Server running on ws://localhost:${port}/ws`);
});