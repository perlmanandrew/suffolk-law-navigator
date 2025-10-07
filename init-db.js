require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

console.log('🗄️  Initializing PostgreSQL Database for Suffolk Law...\n');

async function initDatabase() {
  try {
    // Create policies table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS policies (
        id SERIAL PRIMARY KEY,
        external_id VARCHAR(255) UNIQUE NOT NULL,
        title TEXT NOT NULL,
        category VARCHAR(100) NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        source_url TEXT,
        source_name TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Policies table created/verified');

    // Create index on external_id for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_policies_external_id 
      ON policies(external_id)
    `);
    console.log('✅ Index on external_id created');

    // Create index on category for filtering
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_policies_category 
      ON policies(category)
    `);
    console.log('✅ Index on category created');

    // Create Q&A interactions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS qa_interactions (
        id SERIAL PRIMARY KEY,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        sources TEXT,
        confidence VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Q&A interactions table created/verified');

    // Insert sample policy for testing
    await pool.query(`
      INSERT INTO policies (
        external_id, title, category, content, summary, source_url, source_name
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (external_id) DO NOTHING
    `, [
      'sample-attendance',
      'Sample Attendance Policy',
      'academic',
      'This is a sample policy for testing. Students are expected to attend classes regularly. For absences of 1-2 days, email professors directly. For absences exceeding 3 days, contact the Dean of Students Office at LawDeanofStudents@suffolk.edu or 617-573-8157.',
      'Sample attendance policy for testing purposes',
      'https://www.suffolk.edu/law',
      'Sample Policy'
    ]);
    console.log('✅ Sample policy inserted');

    // Check table contents
    const result = await pool.query('SELECT COUNT(*) FROM policies');
    console.log(`\n📊 Total policies in database: ${result.rows[0].count}`);

    console.log('\n✨ Database initialization complete!');
    console.log('Ready to start the server.\n');

  } catch (err) {
    console.error('❌ Error initializing database:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initDatabase();