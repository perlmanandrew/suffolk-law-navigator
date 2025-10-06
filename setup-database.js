require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Create/open database
const db = new sqlite3.Database('suffolk_law.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('✅ Connected to SQLite database');
  }
});

// Create tables
db.serialize(() => {
  console.log('🔧 Creating tables...');
  
  // Policies table
  db.run(`CREATE TABLE IF NOT EXISTS policies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    summary TEXT,
    source_url TEXT NOT NULL,
    source_name TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active INTEGER DEFAULT 1
  )`, (err) => {
    if (err) console.error('Error creating policies table:', err);
    else console.log('✅ Policies table created');
  });

  // Q&A interactions table
  db.run(`CREATE TABLE IF NOT EXISTS qa_interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    sources TEXT,
    confidence TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('Error creating qa_interactions table:', err);
    else console.log('✅ Q&A interactions table created');
  });

  // Insert sample data
  console.log('📊 Adding sample policies...');
  
  const samplePolicies = [
    {
      external_id: 'graduation-req-1',
      title: 'JD Degree Requirements',
      category: 'curriculum',
      content: 'Students must complete at least 84 semester hours to earn the JD degree. This includes 6 semesters of full-time study or 8 semesters of part-time study. All students must be in good academic standing and complete required courses including Civil Procedure, Constitutional Law, Contracts, Criminal Law, Property, and Torts.',
      summary: 'Requirements to graduate with a JD degree from Suffolk Law',
      source_url: 'https://www.suffolk.edu/law/academics-clinics/juris-doctor/curriculum-requirements',
      source_name: 'Curriculum & Requirements'
    },
    {
      external_id: 'grading-policy-1',
      title: 'Grading Standards',
      category: 'academic',
      content: 'For courses with 25 or more students, the required median final course grade is B+. Required courses in Civil Procedure, Constitutional Law, Contracts, Criminal Law, Property, and Torts have specific grade distribution requirements. Faculty members must conform to these distribution limits.',
      summary: 'Grade distribution requirements for courses',
      source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations',
      source_name: 'Academic Rules & Regulations'
    },
    {
      external_id: 'registration-1',
      title: 'Course Registration',
      category: 'registration',
      content: 'Fall course registration takes place in early April. Spring term registration takes place in November. JD students have priority enrollment in courses required for the JD degree. Students register through MySuffolk portal.',
      summary: 'How and when to register for courses',
      source_url: 'https://www.suffolk.edu/law/academics-clinics/academic-resources/course-registration',
      source_name: 'Course Registration'
    }
  ];

  const stmt = db.prepare(`INSERT OR IGNORE INTO policies 
    (external_id, title, category, content, summary, source_url, source_name) 
    VALUES (?, ?, ?, ?, ?, ?, ?)`);

  samplePolicies.forEach(policy => {
    stmt.run(
      policy.external_id,
      policy.title,
      policy.category,
      policy.content,
      policy.summary,
      policy.source_url,
      policy.source_name,
      (err) => {
        if (err) console.error('Error inserting policy:', err);
        else console.log('✅ Added:', policy.title);
      }
    );
  });

  stmt.finalize();

  // Verify data
  db.get('SELECT COUNT(*) as count FROM policies', (err, row) => {
    if (err) {
      console.error('Error counting policies:', err);
    } else {
      console.log(`\n✨ Setup complete! ${row.count} policies in database.`);
    }
    db.close();
  });
});