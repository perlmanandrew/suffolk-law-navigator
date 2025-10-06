require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const db = new sqlite3.Database('suffolk_law.db');

// Suffolk Law Custom Instructions
const SUFFOLK_INSTRUCTIONS = `You are a helpful guide to Suffolk University Law School's rules, regulations, and official website.

ROLE: Provide clear summaries. Do NOT give binding legal interpretations.

TONE: Neutral and informative. Avoid authoritative language.

PHRASING:
Use: "According to...", "The policy states...", "The website explains..."
Avoid: "You must" (unless quoting verbatim), "The only answer is..."

HANDLING AMBIGUITIES: If rules are unclear, state this openly. Do NOT speculate.

CONTACTS:
- Academic: AcadServLaw@suffolk.edu
- Student life: LawDeanofStudents@suffolk.edu
- Emergency: 617-573-8111 (emergencies ONLY)

OUT OF SCOPE:
- Coursework questions → "This is best directed to your professor."
- Unrelated questions → "This question is outside my scope."

EVERY response MUST end with:
"⚠️ Please note: This tool can make mistakes. Always verify with actual Suffolk Law policies or consult AcadServLaw@suffolk.edu or LawDeanofStudents@suffolk.edu."`;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/policies', (req, res) => {
  const category = req.query.category;
  let query = 'SELECT * FROM policies WHERE is_active = 1';
  const params = [];
  if (category && category !== 'all') {
    query += ' AND category = ?';
    params.push(category);
  }
  query += ' ORDER BY last_updated DESC';
  db.all(query, params, (err, rows) => {
    if (err) {
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.json({ success: true, policies: rows, count: rows.length });
    }
  });
});

app.post('/api/ask', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || question.length < 5) {
      return res.status(400).json({ success: false, error: 'Please provide a question (at least 5 characters)' });
    }
    console.log('\n🤔 Question:', question);

    const lowerQ = question.toLowerCase();
    if (lowerQ.includes('how do i solve') || lowerQ.includes('help with assignment') || lowerQ.includes('homework')) {
      return res.json({
        success: true,
        question,
        answer: "This is the kind of question that is best directed to your professor.\n\n⚠️ Please note: This tool can make mistakes. Always verify with actual Suffolk Law policies or consult AcadServLaw@suffolk.edu or LawDeanofStudents@suffolk.edu.",
        sources: [],
        confidence: 'high',
        timestamp: new Date().toISOString()
      });
    }

    db.all('SELECT * FROM policies WHERE is_active = 1 LIMIT 8', async (err, policies) => {
      if (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
      console.log(`📚 Found ${policies.length} policies`);

      const context = policies.map((p, i) => 
        `[Policy ${i + 1}]\nTitle: ${p.title}\nCategory: ${p.category}\nContent: ${p.content}\nURL: ${p.source_url}\n---`
      ).join('\n\n');

      console.log('🧠 Asking Claude with Suffolk guidelines...');

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

Answer briefly using ONLY these policies. Cite by name. Include URLs. If policies don't address it, say so and recommend who to contact. Keep concise. End with disclaimer.`
        }]
      });

      let answer = response.content[0].text;
      if (!answer.includes('⚠️ Please note:')) {
        answer += '\n\n⚠️ Please note: This tool can make mistakes. Always verify with actual Suffolk Law policies or consult AcadServLaw@suffolk.edu or LawDeanofStudents@suffolk.edu.';
      }

      const sources = policies.slice(0, 5).map(p => ({
        id: p.id,
        title: p.title,
        category: p.category,
        url: p.source_url
      }));

      console.log('✅ Answer generated!\n');

      const sourcesJson = JSON.stringify(sources);
      db.run('INSERT INTO qa_interactions (question, answer, sources, confidence) VALUES (?, ?, ?, ?)',
        [question, answer, sourcesJson, 'high']);

      res.json({
        success: true,
        question,
        answer,
        sources,
        confidence: 'high',
        timestamp: new Date().toISOString()
      });
    });
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ success: false, error: 'Error: ' + error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('✅ Suffolk Law AI Q&A Server Running!');
  console.log('='.repeat(60));
  console.log(`🌐 Server: http://localhost:${PORT}`);
  console.log('📋 Suffolk Guidelines: ACTIVE');
  console.log('✉️  Academic: AcadServLaw@suffolk.edu');
  console.log('✉️  Dean: LawDeanofStudents@suffolk.edu');
  console.log('🚨 Emergency: 617-573-8111\n');
  console.log('Ready! Press Ctrl+C to stop.\n');
});