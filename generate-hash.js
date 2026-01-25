const mysql = require('mysql2');
const bcrypt = require('bcryptjs');

const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '12345678', // Your MySQL password
  database: 'dance_management'
});

async function fixAdmin() {
  try {
    console.log('🔧 Fixing admin user...\n');
    
    // Connect to database
    connection.connect();
    
    const adminEmail = 'admin@dbds.com';
    const adminPassword = '12345678';
    const adminName = 'DBDS Admin';
    
    // Generate bcrypt hash
    console.log('🔐 Generating bcrypt hash for password...');
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    console.log('Hash generated:', hashedPassword.substring(0, 30) + '...');
    
    // Delete existing admin if any
    console.log('\n🗑️  Removing any existing admin...');
    await new Promise((resolve, reject) => {
      connection.query('DELETE FROM users WHERE email = ?', [adminEmail], (err) => {
        if (err) reject(err);
        else {
          console.log('✅ Old admin removed');
          resolve();
        }
      });
    });
    
    // Create new admin
    console.log('\n👑 Creating new admin...');
    await new Promise((resolve, reject) => {
      const query = `
        INSERT INTO users (name, email, password, role, is_active) 
        VALUES (?, ?, ?, 'ADMIN', TRUE)
      `;
      
      connection.query(query, [adminName, adminEmail, hashedPassword], (err, result) => {
        if (err) reject(err);
        else {
          console.log('✅ Admin created with ID:', result.insertId);
          resolve();
        }
      });
    });
    
    // Verify the admin
    console.log('\n🔍 Verifying admin...');
    const [rows] = await new Promise((resolve, reject) => {
      connection.query('SELECT * FROM users WHERE email = ?', [adminEmail], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ ADMIN CREATED SUCCESSFULLY');
    console.log('='.repeat(60));
    console.log(`📧 Email: ${rows.email}`);
    console.log(`👤 Name: ${rows.name}`);
    console.log(`🎭 Role: ${rows.role}`);
    console.log(`✅ Active: ${rows.is_active ? 'YES' : 'NO'}`);
    console.log(`🔑 Password (plain): 12345678`);
    console.log(`🔐 Password (hashed): ${rows.password.substring(0, 30)}...`);
    console.log('='.repeat(60));
    
    // Test password verification
    console.log('\n🔐 Testing password verification...');
    const isValid = await bcrypt.compare(adminPassword, rows.password);
    console.log(`Password verification: ${isValid ? '✅ PASSED' : '❌ FAILED'}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    connection.end();
    console.log('\n🔌 Database connection closed');
  }
}

fixAdmin();