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

pool.on('connect', () => {
  console.log('✅ PostgreSQL connected');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL error:', err);
});

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

    const result = await pool.query(
      'SELECT * FROM policies WHERE is_active = true ORDER BY last_updated DESC LIMIT 15'
    );
    
    const policies = result.rows;
    
    if (!policies || policies.length === 0) {
      return res.json({
        success: true,
        question,
        answer: "I currently don't have any policies loaded in my database. Please contact AcadServLaw@suffolk.edu or LawDeanofStudents@suffolk.edu for assistance.\n\n⚠️ Please note: This tool can make mistakes. Always verify with actual Suffolk Law policies.",
        sources: [],
        confidence: 'low',
        timestamp: new Date().toISOString()
      });
    }
    
    console.log(`📚 Found ${policies.length} policies`);

    const context = policies.map((p, i) => 
      `[Policy ${i+1}]\nTitle: ${p.title}\nContent: ${p.content.substring(0, 1000)}\nURL: ${p.source_url}\n---`
    ).join('\n\n');

    console.log('🧠 Asking Claude...');

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

Answer briefly using ONLY these policies. Cite by name. Include URLs as clickable links. If unclear, say so and recommend contacts. Keep concise. End with disclaimer.`
      }]
    });

    let answer = response.content[0].text;
    
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

    res.json({
      success: true,
      question,
      answer,
      sources,
      confidence: 'high',
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

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = parseInt(process.env.PORT || '3001', 10);

console.log('='.repeat(60));
console.log('🚀 STARTING SERVER...');
console.log('='.repeat(60));
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('Port:', PORT);
console.log('Database:', process.env.DATABASE_URL ? 'PostgreSQL (configured)' : 'Not configured');
console.log('='.repeat(60));

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n✅ ✅ ✅ SERVER STARTED SUCCESSFULLY! ✅ ✅ ✅\n');
  console.log('='.repeat(60));
  console.log('✅ Suffolk Law AI Q&A Server Running!');
  console.log('='.repeat(60));
  console.log(`🌐 Server: http://0.0.0.0:${PORT}`);
  console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`💾 Database: PostgreSQL`);
  console.log('📋 Suffolk Guidelines: ACTIVE ✅');
  console.log('✉️  Academic: AcadServLaw@suffolk.edu');
  console.log('✉️  Dean: LawDeanofStudents@suffolk.edu');
  console.log('🚨 Emergency: 617-573-8111');
  console.log('='.repeat(60));
  console.log('\n✅ Listening on 0.0.0.0:' + PORT);
  console.log('✅ Ready to accept connections!\n');
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database pool...');
  await pool.end();
  process.exit(0);
});