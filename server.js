require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { Pool } = require('pg');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Initialize Anthropic
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Initialize PostgreSQL Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// AUTO-INITIALIZE DATABASE ON STARTUP
async function initializeDatabase() {
  try {
    console.log('🗄️  Checking database tables...');
    
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
    
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_policies_external_id ON policies(external_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_policies_category ON policies(category)`);
    
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
    
    await pool.query(`
      INSERT INTO policies (external_id, title, category, content, summary, source_url, source_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (external_id) DO NOTHING
    `, [
      'sample-attendance',
      'Sample Attendance Policy',
      'academic',
      'This is a sample policy for testing. Students are expected to attend classes regularly. For absences of 1-2 days, email professors directly. For absences exceeding 3 days, contact the Dean of Students Office.',
      'Sample attendance policy',
      'https://www.suffolk.edu/law',
      'Sample Policy'
    ]);
    
    const result = await pool.query('SELECT COUNT(*) FROM policies');
    console.log(`✅ Database initialized. Policies in database: ${result.rows[0].count}`);
    
  } catch (err) {
    console.error('❌ Database initialization error:', err);
    throw err;
  }
}

const SUFFOLK_INSTRUCTIONS = `You are a helpful guide to Suffolk Law School. Provide brief, neutral answers.

TONE: Neutral and informative. Use "According to..." and "The policy states..." Avoid "You must" unless quoting.

CONTACTS: Academic (AcadServLaw@suffolk.edu), Dean (LawDeanofStudents@suffolk.edu), Emergency (617-573-8111 for emergencies only)

OUT OF SCOPE: Coursework → "Direct to professor." Unrelated → "Outside my scope."

ALWAYS END WITH: "⚠️ Please note: This tool can make mistakes. Verify with actual Suffolk Law policies or contact AcadServLaw@suffolk.edu or LawDeanofStudents@suffolk.edu."`;

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: 'ok', 
      database: 'connected',
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV || 'development'
    });
  } catch (err) {
    res.status(500).json({ 
      status: 'error', 
      database: 'disconnected',
      timestamp: new Date().toISOString() 
    });
  }
});

app.get('/api/policies', async (req, res) => {
  try {
    const category = req.query.category;
    let query = 'SELECT * FROM policies WHERE is_active = true';
    const params = [];
    
    if (category && category !== 'all') {
      query += ' AND category = $1';
      params.push(category);
    }
    
    query += ' ORDER BY last_updated DESC LIMIT 50';
    
    const result = await pool.query(query, params);
    res.json({ 
      success: true, 
      policies: result.rows, 
      count: result.rows.length 
    });
  } catch (err) {
    console.error('❌ Database error:', err);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

app.post('/api/ask', async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!question || question.length < 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Please provide a question (at least 5 characters)' 
      });
    }
    
    console.log('\n🤔 Question:', question);

    const lowerQ = question.toLowerCase();
    if (lowerQ.includes('solve') || lowerQ.includes('homework') || lowerQ.includes('assignment')) {
      return res.json({
        success: true,
        question,
        answer: "This is the kind of question that is best directed to your professor.\n\n⚠️ Please note: This tool can make mistakes. Verify with actual Suffolk Law policies or contact AcadServLaw@suffolk.edu or LawDeanofStudents@suffolk.edu.",
        sources: [],
        confidence: 'high',
        timestamp: new Date().toISOString()
      });
    }

    // First, try to find relevant policies in database
    const result = await pool.query(
      'SELECT * FROM policies WHERE is_active = true ORDER BY last_updated DESC LIMIT 15'
    );
    
    const policies = result.rows;
    
    // If we have policies, use them
    if (policies && policies.length > 0) {
      console.log(`📚 Found ${policies.length} policies in database`);

      const context = policies.map((p, i) => 
        `[Policy ${i+1}]\nTitle: ${p.title}\nContent: ${p.content.substring(0, 1000)}\nURL: ${p.source_url}\n---`
      ).join('\n\n');

      console.log('🧠 Asking Claude with database policies...');

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        temperature: 0.2,
        messages: [{
          role: 'user',
          content: `${SUFFOLK_INSTRUCTIONS}

POLICIES:
${context}

QUESTION: ${question}

Answer briefly using ONLY these policies. If these policies don't fully answer the question, say "I found some relevant information in my database, but I should search Suffolk Law's website for more complete information." Cite by name. Include URLs as clickable links. Keep concise. End with disclaimer.`
        }]
      });

      let answer = response.content[0].text;
      
      // Check if Claude suggests we need more info
      if (answer.includes('should search') || answer.includes('more complete information') || answer.includes("don't fully address")) {
        console.log('🔍 Database policies insufficient, searching Suffolk Law website...');
        
        // Trigger web search fallback
        try {
          const searchAnswer = await searchSuffolkWebsite(question);
          if (searchAnswer) {
            answer = `Based on my database:\n${answer}\n\n---\n\n**Additional information from Suffolk Law website:**\n${searchAnswer}`;
          }
        } catch (searchErr) {
          console.error('Web search error:', searchErr);
        }
      }
      
      if (!answer.includes('⚠️')) {
        answer += '\n\n⚠️ Please note: This tool can make mistakes. Verify with actual Suffolk Law policies or contact AcadServLaw@suffolk.edu or LawDeanofStudents@suffolk.edu.';
      }

      const sources = policies.slice(0, 5).map(p => ({
        id: p.id,
        title: p.title,
        category: p.category,
        url: p.source_url
      }));

      console.log('✅ Answer generated!\n');

      try {
        await pool.query(
          'INSERT INTO qa_interactions (question, answer, sources, confidence) VALUES ($1, $2, $3, $4)',
          [question, answer, JSON.stringify(sources), 'high']
        );
      } catch (logErr) {
        console.error('Warning: Could not log interaction:', logErr);
      }

      return res.json({
        success: true,
        question,
        answer,
        sources,
        confidence: 'high',
        timestamp: new Date().toISOString()
      });
    }
    
    // No policies in database - search website directly
    console.log('📭 No policies in database, searching Suffolk Law website...');
    
    try {
      const webAnswer = await searchSuffolkWebsite(question);
      
      if (webAnswer) {
        return res.json({
          success: true,
          question,
          answer: webAnswer + '\n\n⚠️ Please note: This information was found by searching Suffolk Law\'s website. Verify with actual Suffolk Law policies or contact AcadServLaw@suffolk.edu or LawDeanofStudents@suffolk.edu.',
          sources: [{
            title: 'Suffolk Law Website',
            category: 'web-search',
            url: 'https://www.suffolk.edu/law'
          }],
          confidence: 'medium',
          timestamp: new Date().toISOString()
        });
      }
    } catch (searchErr) {
      console.error('Web search failed:', searchErr);
    }
    
    // Fallback if everything fails
    return res.json({
      success: true,
      question,
      answer: "I currently don't have enough information to answer this question. Please contact AcadServLaw@suffolk.edu or LawDeanofStudents@suffolk.edu for assistance.\n\n⚠️ Please note: This tool can make mistakes. Always verify with actual Suffolk Law policies.",
      sources: [],
      confidence: 'low',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Server error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error. Please try again later.' 
    });
  }
});

// Helper function to search Suffolk Law website
async function searchSuffolkWebsite(question) {
  const axios = require('axios');
  const cheerio = require('cheerio');
  
  try {
    // Extract key terms from question
    const keywords = question
      .toLowerCase()
      .replace(/[?.,!]/g, '')
      .split(' ')
      .filter(w => w.length > 3 && !['what', 'when', 'where', 'how', 'should', 'would', 'could', 'the', 'this', 'that'].includes(w))
      .slice(0, 3)
      .join(' ');
    
    console.log(`🔍 Searching Suffolk Law website for: "${keywords}"`);
    
    // Use Google to search Suffolk Law site
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keywords + ' site:suffolk.edu/law')}`;
    
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    const $ = cheerio.load(response.data);
    
    // Extract first few search results
    const results = [];
    $('div.g').slice(0, 3).each((i, elem) => {
      const title = $(elem).find('h3').text();
      const snippet = $(elem).find('.VwiC3b').text();
      const link = $(elem).find('a').attr('href');
      
      if (title && snippet && link && link.includes('suffolk.edu/law')) {
        results.push({ title, snippet, link });
      }
    });
    
    if (results.length === 0) {
      return null;
    }
    
    // Format results for Claude
    const searchContext = results.map((r, i) => 
      `[Result ${i+1}]\nTitle: ${r.title}\nSnippet: ${r.snippet}\nURL: ${r.link}\n---`
    ).join('\n\n');
    
    console.log(`✅ Found ${results.length} web results`);
    
    // Ask Claude to synthesize the web results
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
    
    const aiResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      temperature: 0.2,
      messages: [{
        role: 'user',
        content: `Based on these search results from Suffolk Law's website:

${searchContext}

Question: ${question}

Provide a brief, helpful answer based on these search results. Include relevant URLs. If the results don't clearly answer the question, say so.`
      }]
    });
    
    return aiResponse.content[0].text;
    
  } catch (err) {
    console.error('Search error:', err.message);
    return null;
  }
}
// Admin endpoint to populate database
app.get('/admin/populate-db', async (req, res) => {
  try {
    const policies = [
      {
        external_id: 'absence-short-term',
        title: 'Short-Term Absences (1-2 Days)',
        category: 'attendance',
        content: 'For absences of one or two days due to illness, family issues, or short-term conflicts, email your professors directly. The Dean of Students Office does not need to be contacted for these short absences. As a professional courtesy, always notify your professors of absences.',
        summary: 'Email professors for 1-2 day absences',
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
        content: 'If you are ill or have a significant personal emergency causing a conflict with an exam, contact the Dean of Students Office by emailing lawdeanofstudents@suffolk.edu or calling 617-573-8157. Because of exam anonymity, you MUST NOT alert your professor(s).',
        summary: 'Contact Dean of Students for exam emergencies',
        source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules',
        source_name: 'Exam Policy'
      },
        {
  external_id: 'library-study-rooms',
  title: 'Law Library Study Rooms',
  category: 'library',
  content: 'The Suffolk Law Library offers study rooms available for reservation. Rooms can be booked online through the library website or reservation system. Study rooms are available on a first-come, first-served basis. Group study rooms accommodate 4-8 people. For assistance, contact the library at 617-573-8595.',
  summary: 'Book study rooms online through library website',
  source_url: 'https://www.suffolk.edu/law/faculty-research/about-the-library/library-study-rooms',
  source_name: 'Library Study Rooms'
},
      {
        external_id: 'academic-accommodations',
        title: 'Academic Accommodations',
        category: 'student-services',
        content: 'Students with disabilities who require accommodations should contact Disability Services. Accommodations must be arranged in advance. Contact lawdeanofstudents@suffolk.edu for information about the accommodation process.',
        summary: 'Contact Disability Services for accommodations',
        source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules',
        source_name: 'Student Services'
      },
      {
        external_id: 'attendance-tracking',
        title: 'Attendance Tracking',
        category: 'attendance',
        content: 'Students should scan the QR code in each classroom for attendance. If unable to scan but present, communicate via the follow-up email. Physical presence is required - remote work does not count toward attendance.',
        summary: 'Scan QR code for attendance tracking',
        source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations',
        source_name: 'Attendance Policy'
      }
    ];

    let added = 0;
    for (const p of policies) {
      await pool.query(`
        INSERT INTO policies (external_id, title, category, content, summary, source_url, source_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (external_id) DO UPDATE SET
          content = EXCLUDED.content,
          last_updated = CURRENT_TIMESTAMP
      `, [p.external_id, p.title, p.category, p.content, p.summary, p.source_url, p.source_name]);
      added++;
    }

    const result = await pool.query('SELECT COUNT(*) FROM policies');
    
    res.json({
      success: true,
      message: `Added ${added} policies`,
      total: result.rows[0].count
    });
  } catch (err) {
    console.error('Error populating database:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
// Admin endpoint to populate with ALL policies
app.get('/admin/full-populate', async (req, res) => {
  try {
    console.log('📚 Populating database with comprehensive policy data...');
    
    const allPolicies = [
  {
    external_id: 'absence-short-term',
    title: 'Short-Term Absences (1-2 Days)',
    category: 'attendance',
    content: 'For absences of one or two days due to illness, family issues, or short-term conflicts, email your professors directly. The Dean of Students Office does not need to be contacted for these short absences and will not "excuse" them. The Attendance Policy provides an Applicable Absence Limitation to cover these situations. As a professional courtesy, always notify your professors of absences.',
    summary: 'Email professors for 1-2 day absences; Dean of Students not needed',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations#rule2B',
    source_name: 'Attendance Policy - Rule 2B'
  },
  {
    external_id: 'absence-extended',
    title: 'Extended Absences (3+ Days)',
    category: 'attendance',
    content: 'If you will be absent for more than three consecutive days or will exceed the Applicable Absence Limitation for any class, you must contact the Dean of Students Office at lawdeanofstudents@suffolk.edu or 617-573-8157.',
    summary: 'Contact Dean of Students for absences over 3 days',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations#rule2B',
    source_name: 'Attendance Policy - Rule 2B'
  },
  {
    external_id: 'excused-absences',
    title: 'Excused Absences',
    category: 'attendance',
    content: 'Routine absences cannot be excused. An absence may only be "excused" in rare circumstances when a student has a serious situation causing them to exceed the Applicable Absence Limitation. There are significant restrictions on excused absences, and exceeding the Applicable Absence Limitation will likely result in exclusion from affected classes.',
    summary: 'Excused absences only for rare serious situations',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations#rule2B',
    source_name: 'Attendance Policy - Rule 2B'
  },
  {
    external_id: 'class-recording',
    title: 'Recording Classes During Absences',
    category: 'attendance',
    content: 'The Dean of Students Office recommends obtaining notes from colleagues and connecting with professors rather than recording lectures. However, if you wish to record a class during an absence, you must obtain permission from each professor beforehand - it is at their discretion.',
    summary: 'Must get professor permission to record classes',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/recording-classes-policy',
    source_name: 'Recording Classes Policy'
  },
  {
    external_id: 'absence-limitation-exceeded',
    title: 'Exceeding Applicable Absence Limitation',
    category: 'attendance',
    content: 'Unless you have a rare situation allowing limited excused absences beyond the Applicable Absence Limitation, exceeding the limit can result in exclusion from the class. Exclusion means you will either be allowed to withdraw or you will be assigned an F in the course.',
    summary: 'Exceeding absence limit can result in exclusion or F grade',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations#rule2B',
    source_name: 'Attendance Policy - Rule 2B'
  },
  {
    external_id: 'attendance-tracking',
    title: 'How Attendance is Tracked',
    category: 'attendance',
    content: 'All students should scan the QR code located in each classroom. If you cannot scan the code but are present, communicate that in the follow-up email sent the next day. Physical presence is what matters for attendance.',
    summary: 'Scan QR code in classroom; physical presence required',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations#rule2B',
    source_name: 'Attendance Policy - Rule 2B'
  },
  {
    external_id: 'tardiness-early-departure',
    title: 'Tardiness and Early Departures',
    category: 'attendance',
    content: 'Occasional tardiness or early departure due to unavoidable situations is understood. However, repeated tardiness or early departures may subject a student to exclusion from the class.',
    summary: 'Repeated tardiness can lead to class exclusion',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations#rule2B',
    source_name: 'Attendance Policy - Rule 2B'
  },
  {
    external_id: 'intersession-attendance',
    title: 'Intersession and Intensive Course Attendance',
    category: 'attendance',
    content: 'Because intersession and intensive courses have a limited number of class meetings, there is no Applicable Absence Limitation for these courses. Students are expected to attend all class meetings.',
    summary: 'No absence allowance for intersession courses',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations#rule2B',
    source_name: 'Attendance Policy - Rule 2B'
  },
  {
    external_id: 'exam-emergency',
    title: 'Emergency During Exam Period',
    category: 'exams',
    content: 'If you are ill or have a significant personal emergency causing a conflict with an exam, contact the Dean of Students Office by emailing lawdeanofstudents@suffolk.edu or calling 617-573-8157. Because of exam anonymity, you MUST NOT alert your professor(s).',
    summary: 'Contact Dean of Students for exam emergencies',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/exam-postponement-and-rescheduling-requests-policy',
    source_name: 'Exam Postponement Policy'
  },
  {
    external_id: 'exam-regulations',
    title: 'Exam Regulations Policy',
    category: 'exams',
    content: 'All students must follow exam regulations including anonymous grading, time limits, and honor code requirements. Exams must be taken during scheduled times unless a postponement has been approved. Students must use ExamSoft for electronic exams.',
    summary: 'Follow all exam regulations and honor code',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/exam-regulations-policy',
    source_name: 'Exam Regulations Policy'
  },
  {
    external_id: 'exam-postponement',
    title: 'Exam Postponement and Rescheduling',
    category: 'exams',
    content: 'Exam postponements are only granted for serious illness, family emergency, or other extraordinary circumstances. Contact the Dean of Students Office immediately. Do not contact your professor due to exam anonymity.',
    summary: 'Contact Dean of Students for exam postponement',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/exam-postponement-and-rescheduling-requests-policy',
    source_name: 'Exam Postponement Policy'
  },
  {
    external_id: 'academic-accommodations',
    title: 'Academic Accommodations',
    category: 'student-services',
    content: 'Students with disabilities who require accommodations should contact Disability Services as early as possible. Accommodations must be arranged in advance and cannot be applied retroactively. Contact lawdeanofstudents@suffolk.edu for information.',
    summary: 'Contact Disability Services early for accommodations',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/academic-accommodations',
    source_name: 'Academic Accommodations Policy'
  },
  {
    external_id: 'leave-of-absence-voluntary',
    title: 'Voluntary Leave of Absence',
    category: 'student-services',
    content: 'Students may request a voluntary leave of absence for medical, personal, or other reasons. Contact the Dean of Students Office to discuss the process. Leaves typically last one or two semesters.',
    summary: 'Request voluntary leave through Dean of Students',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/leaves-of-absence-voluntary',
    source_name: 'Voluntary Leave Policy'
  },
  {
    external_id: 'exam-accommodations',
    title: 'Accommodations for Exams',
    category: 'exams',
    content: 'Students approved for exam accommodations through Disability Services should confirm their accommodations each semester. Accommodations may include extended time, separate room, or other modifications. Contact the Dean of Students Office at least two weeks before exams.',
    summary: 'Confirm exam accommodations each semester',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/accommodations-for-exams-policy',
    source_name: 'Exam Accommodations Policy'
  },
  {
    external_id: 'library-study-rooms',
    title: 'Law Library Study Rooms',
    category: 'library',
    content: 'The Suffolk Law Library offers study rooms available for reservation. Rooms can be booked online through the library website or reservation system. Study rooms are available on a first-come, first-served basis. Group study rooms accommodate 4-8 people. For assistance, contact the library at 617-573-8595.',
    summary: 'Book study rooms online through library website',
    source_url: 'https://www.suffolk.edu/law/faculty-research/about-the-library',
    source_name: 'Law Library Services'
  },
  {
    external_id: 'library-hours',
    title: 'Law Library Hours and Services',
    category: 'library',
    content: 'The Law Library is open extended hours during the academic year, with reduced hours during breaks. Services include research assistance, computer labs, printing, scanning, and access to legal databases. Check the library website for current hours.',
    summary: 'Extended hours with research assistance',
    source_url: 'https://www.suffolk.edu/law/faculty-research/about-the-library',
    source_name: 'Law Library Services'
  },
  {
    external_id: 'academic-rules',
    title: 'Academic Rules and Regulations',
    category: 'academic',
    content: 'Suffolk Law School has comprehensive academic rules covering attendance, grading, academic standing, course registration, add/drop deadlines, and graduation requirements. All students are responsible for knowing and following these rules.',
    summary: 'Comprehensive rules for all academic matters',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations',
    source_name: 'Academic Rules & Regulations'
  },
  {
    external_id: 'course-registration',
    title: 'Course Registration',
    category: 'registration',
    content: 'Course registration occurs each semester according to the academic calendar. Students register online through the student portal. Registration priority is based on class year. Students should meet with their faculty advisor before registration.',
    summary: 'Register online each semester; consult advisor',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/academic-resources/course-registration',
    source_name: 'Course Registration Information'
  },
  {
    external_id: 'dean-of-students',
    title: 'Dean of Students Office',
    category: 'student-services',
    content: 'The Dean of Students Office provides support for academic, personal, and professional concerns. Contact the office for attendance issues, exam conflicts, leaves of absence, accommodations, and other student matters. Email lawdeanofstudents@suffolk.edu or call 617-573-8157.',
    summary: 'Central resource for student support',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life',
    source_name: 'Dean of Students Office'
  },
  {
    external_id: 'academic-services',
    title: 'Office of Academic Services',
    category: 'student-services',
    content: 'Academic Services provides support for academic success including tutoring, writing assistance, study strategies, and bar preparation. Contact AcadServLaw@suffolk.edu for appointments and information.',
    summary: 'Tutoring and academic support services',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/academic-resources',
    source_name: 'Academic Services Office'
  }
];

    let added = 0;
    let updated = 0;
    
    for (const p of allPolicies) {
      const result = await pool.query(`
        INSERT INTO policies (external_id, title, category, content, summary, source_url, source_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (external_id) DO UPDATE SET
  content = EXCLUDED.content,
  summary = EXCLUDED.summary,
  source_url = EXCLUDED.source_url,
  source_name = EXCLUDED.source_name,
  last_updated = CURRENT_TIMESTAMP
        RETURNING (xmax = 0) AS inserted
      `, [p.external_id, p.title, p.category, p.content, p.summary, p.source_url, p.source_name]);
      
      if (result.rows[0].inserted) {
        added++;
      } else {
        updated++;
      }
    }

    const count = await pool.query('SELECT COUNT(*) FROM policies');
    
    console.log(`✅ Added ${added} new, updated ${updated} existing policies`);
    
    res.json({
      success: true,
      added: added,
      updated: updated,
      total: parseInt(count.rows[0].count)
    });
  } catch (err) {
    console.error('❌ Error populating database:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
// ... your other endpoints like /admin/full-populate ...

// ADD THE NEW CODE HERE ⬇️⬇️⬇️

// Admin endpoint to FORCE update all URLs (deletes and recreates)
app.get('/admin/force-refresh-all', async (req, res) => {
  try {
    console.log('🔄 Force refreshing all policies...');
    
    await pool.query('DELETE FROM policies');
    
    const policies = [
      ['absence-short-term', 'Short-Term Absences (1-2 Days)', 'attendance', 'For absences of one or two days due to illness, family issues, or short-term conflicts, email your professors directly. The Dean of Students Office does not need to be contacted for these short absences.', 'Email professors for 1-2 day absences', 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations#rule2B', 'Attendance Policy'],
      ['absence-extended', 'Extended Absences (3+ Days)', 'attendance', 'If you will be absent for more than three consecutive days, contact the Dean of Students Office at lawdeanofstudents@suffolk.edu or 617-573-8157.', 'Contact Dean of Students for 3+ days', 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations#rule2B', 'Attendance Policy'],
      ['exam-emergency', 'Emergency During Exam Period', 'exams', 'If you are ill or have an emergency during exams, contact the Dean of Students Office by emailing lawdeanofstudents@suffolk.edu. Do NOT contact your professor due to exam anonymity.', 'Contact Dean of Students for exam emergencies', 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/exam-postponement-and-rescheduling-requests-policy', 'Exam Postponement'],
      ['library-study-rooms', 'Law Library Study Rooms', 'library', 'The Suffolk Law Library offers study rooms available for reservation. Rooms can be booked online through the library website. Group study rooms accommodate 4-8 people. For assistance, contact the library at 617-573-8595.', 'Book study rooms online', 'https://www.suffolk.edu/law/faculty-research/about-the-library/library-study-rooms', 'Library Study Rooms'],
      ['academic-accommodations', 'Academic Accommodations', 'student-services', 'Students with disabilities who require accommodations should contact Disability Services early. Accommodations must be arranged in advance. Contact lawdeanofstudents@suffolk.edu for information.', 'Contact Disability Services for accommodations', 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/academic-accommodations', 'Academic Accommodations'],
      ['attendance-tracking', 'Attendance Tracking', 'attendance', 'Students should scan the QR code in each classroom for attendance. If unable to scan but present, communicate via follow-up email. Physical presence is required.', 'Scan QR code for attendance', 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations#rule2B', 'Attendance Policy'],
      ['exam-regulations', 'Exam Regulations', 'exams', 'All students must follow exam regulations including anonymous grading, time limits, and honor code. Exams must be taken during scheduled times unless postponement is approved.', 'Follow exam regulations and honor code', 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/exam-regulations-policy', 'Exam Regulations'],
      ['dean-of-students', 'Dean of Students Office', 'student-services', 'The Dean of Students Office provides support for academic, personal, and professional concerns. Contact for attendance issues, exam conflicts, leaves of absence. Email lawdeanofstudents@suffolk.edu or call 617-573-8157.', 'Central resource for student support', 'https://www.suffolk.edu/law/academics-clinics/student-life', 'Dean of Students']
    ];

    for (const p of policies) {
      await pool.query(`
        INSERT INTO policies (external_id, title, category, content, summary, source_url, source_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, p);
    }

    const result = await pool.query('SELECT COUNT(*) FROM policies');
    
    res.json({
      success: true,
      message: 'Policies recreated with correct URLs',
      total: parseInt(result.rows[0].count)
    });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
// END NEW CODE ⬆️⬆️⬆️

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = parseInt(process.env.PORT || '3001', 10);

// INITIALIZE DATABASE THEN START SERVER
initializeDatabase()
  .then(() => {
    console.log('='.repeat(60));
    console.log('🚀 STARTING SERVER...');
    console.log('='.repeat(60));
    console.log('Environment:', process.env.NODE_ENV || 'development');
    console.log('Port:', PORT);
    console.log('='.repeat(60));

    app.listen(PORT, '0.0.0.0', () => {
      console.log('\n✅ ✅ ✅ SERVER STARTED SUCCESSFULLY! ✅ ✅ ✅\n');
      console.log('='.repeat(60));
      console.log('✅ Suffolk Law AI Q&A Server Running!');
      console.log('='.repeat(60));
      console.log(`🌐 Server: http://0.0.0.0:${PORT}`);
      console.log(`💾 Database: PostgreSQL with auto-init`);
      console.log('✉️  Academic: AcadServLaw@suffolk.edu');
      console.log('✉️  Dean: LawDeanofStudents@suffolk.edu');
      console.log('🚨 Emergency: 617-573-8111');
      console.log('='.repeat(60));
      console.log('\n✅ Ready to accept connections!\n');
    });
  })
  .catch((err) => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database pool...');
  await pool.end();
  process.exit(0);
});