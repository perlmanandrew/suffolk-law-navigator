require('dotenv').config();
const cron = require('node-cron');
const { exec } = require('child_process');

console.log('🕐 Suffolk Law Auto-Scraper Scheduler Started');
console.log('='.repeat(60));

// Schedule: Run every day at 3 AM
cron.schedule('0 3 * * *', () => {
  console.log('\n⏰ Running scheduled scrape at', new Date().toLocaleString());
  
  // Run the scraper
  exec('node scrape-policies-v2.js', (error, stdout, stderr) => {
    if (error) {
      console.error('❌ Scrape failed:', error);
      return;
    }
    console.log(stdout);
    console.log('✅ Scheduled scrape complete\n');
  });
});

// Also run every Sunday at 2 AM for the full crawl
cron.schedule('0 2 * * 0', () => {
  console.log('\n⏰ Running weekly full crawl at', new Date().toLocaleString());
  
  exec('node crawl-academics.js', (error, stdout, stderr) => {
    if (error) {
      console.error('❌ Crawl failed:', error);
      return;
    }
    console.log(stdout);
    console.log('✅ Weekly crawl complete\n');
  });
});

console.log('📅 Schedule:');
console.log('   • Daily at 3:00 AM - Update individual policies');
console.log('   • Weekly (Sundays) at 2:00 AM - Full crawl');
console.log('='.repeat(60));
console.log('Scheduler running... Press Ctrl+C to stop\n');

// Keep process alive
process.stdin.resume();