require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const commonQuestions = [
  {
    external_id: 'absence-short-term',
    title: 'Short-Term Absences (1-2 Days)',
    category: 'attendance',
    content: 'For absences of one or two days due to illness, family issues, or short-term conflicts, email your professors directly. The Dean of Students Office does not need to be contacted for these short absences and will not "excuse" them. The Attendance Policy provides an Applicable Absence Limitation to cover these situations. As a professional courtesy, always notify your professors of absences.',
    summary: 'Email professors for 1-2 day absences; Dean of Students not needed',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations#rule2B',
    source_name: 'Attendance Policy'
  },
  {
    external_id: 'absence-extended',
    title: 'Extended Absences (3+ Days)',
    category: 'attendance',
    content: 'If you will be absent for more than three consecutive days or will exceed the Applicable Absence Limitation for any class, you must contact the Dean of Students Office at lawdeanofstudents@suffolk.edu or 617-573-8157.',
    summary: 'Contact Dean of Students for absences over 3 days',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations#rule2B',
    source_name: 'Attendance Policy'
  },
  {
    external_id: 'exam-emergency',
    title: 'Emergency During Exam Period',
    category: 'exams',
    content: 'If you are ill or have a significant personal emergency causing a conflict with an exam, contact the Dean of Students Office by emailing lawdeanofstudents@suffolk.edu (preferred) or calling 617-573-8157. Because of exam anonymity, you MUST NOT alert your professor(s). The Dean of Students Office will assist you.',
    summary: 'Contact Dean of Students (not professor) for exam emergencies',
    source_url: 'http://www.suffolk.edu/law/student-life/19216.php#examPostpone',
    source_name: 'Exam Postponement Policy'
  },
  {
    external_id: 'academic-accommodations',
    title: 'Academic Accommodations',
    category: 'student-services',
    content: 'Students with disabilities who require accommodations should contact the Disability Services Office. Accommodations must be arranged in advance. Contact the Dean of Students Office at lawdeanofstudents@suffolk.edu for more information about the accommodation process.',
    summary: 'Contact Disability Services for accommodations',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules',
    source_name: 'Student Services'
  },
  {
    external_id: 'attendance-tracking',
    title: 'How Attendance is Tracked',
    category: 'attendance',
    content: 'All students should scan the QR code located in each classroom. If you cannot scan the code but are present, communicate that in the follow-up email sent the next day. You cannot use the follow-up email as your primary attendance method just because you choose not to scan. Physical presence is what matters for attendance - keeping up with work outside class does not avoid the attendance policy.',
    summary: 'Scan QR code in classroom; physical presence required',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations#rule2B',
    source_name: 'Attendance Policy'
  },
  {
    external_id: 'library-hours',
    title: 'Law Library Hours',
    category: 'library',
    content: 'The Suffolk Law Library offers extended hours during the academic year. Students can access study rooms, research materials, and librarian assistance. For current hours and to book study rooms, visit the library website or contact the library directly.',
    summary: 'Library offers study spaces and research assistance',
    source_url: 'https://www.suffolk.edu/law/faculty-research/about-the-library',
    source_name: 'Law Library'
  }
];

async function addPolicies() {
  console.log('📚 Adding common Suffolk Law policies...\n');
  
  try {
    for (const policy of commonQuestions) {
      await pool.query(`
        INSERT INTO policies (external_id, title, category, content, summary, source_url, source_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (external_id) DO UPDATE SET
          content = EXCLUDED.content,
          summary = EXCLUDED.summary,
          last_updated = CURRENT_TIMESTAMP
      `, [policy.external_id, policy.title, policy.category, policy.content, policy.summary, policy.source_url, policy.source_name]);
      
      console.log('✅', policy.title);
    }
    
    const result = await pool.query('SELECT COUNT(*) FROM policies');
    console.log(`\n✨ Complete! Total policies: ${result.rows[0].count}`);
  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await pool.end();
  }
}

addPolicies();