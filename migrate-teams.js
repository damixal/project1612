// migrate-teams.js
const mysql = require('mysql2');

const dbConfig = {
    host: 'localhost',
    user: 'damien',
    password: '123456',
    database: 'smarthoto_db'
};

const db = mysql.createConnection(dbConfig);

db.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    
    console.log('Connected to MySQL database');
    
    // Add team column to stores table
    const addTeamColumnSql = `
        ALTER TABLE stores 
        ADD COLUMN team ENUM('TEAM_A', 'TEAM_B') DEFAULT 'TEAM_A',
        ADD INDEX idx_team (team),
        ADD INDEX idx_team_status (team, status);
    `;
    
    db.query(addTeamColumnSql, (err) => {
        if (err) {
            console.error('Error adding team column:', err);
            db.end();
            return;
        }
        
        console.log('✓ Added team column to stores table');
        
        // Update existing stores based on creator role
        console.log('Updating existing stores...');
        
        const updateStoresSql = `
            UPDATE stores s
            LEFT JOIN users u ON s.created_by_id = u.id
            SET s.team = CASE 
                WHEN u.role = 'RQ' THEN 'TEAM_B'
                ELSE 'TEAM_A'
            END
            WHERE s.team = 'TEAM_A' OR s.team IS NULL;
        `;
        
        db.query(updateStoresSql, (err, result) => {
            if (err) {
                console.error('Error updating stores:', err);
            } else {
                console.log(`✓ Updated ${result.affectedRows} stores with team assignment`);
            }
            
            // Show team distribution
            const teamStatsSql = "SELECT team, COUNT(*) as count FROM stores GROUP BY team";
            
            db.query(teamStatsSql, (err, stats) => {
                if (err) {
                    console.error('Error getting team stats:', err);
                } else {
                    console.log('\n=== Current Store Distribution ===');
                    stats.forEach(stat => {
                        console.log(`${stat.team}: ${stat.count} stores`);
                    });
                }
                
                console.log('\n✅ Migration complete! Restart your server.');
                db.end();
            });
        });
    });
});