const { exec } = require('child_process');

console.log('🚀 Running startup sequence...\n');

// Run init-db.js first
exec('node init-db.js', (error, stdout, stderr) => {
  console.log(stdout);
  
  if (error) {
    console.error('❌ Error initializing database:', error);
    console.error(stderr);
  }
  
  console.log('\n🌐 Starting server...\n');
  
  // Then start the server
  require('./server.js');
});