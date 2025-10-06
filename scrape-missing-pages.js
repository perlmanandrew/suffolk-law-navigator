require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('suffolk_law.db');

function cleanText(text) {
  return text.replace(/\s+/g, ' ').replace(/\t/g, '').trim();
}

function generateSummary(content, maxLength = 200) {
  const cleaned = content.trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength - 3) + '...';
}

async function scrapePage(url, title, category) {
  console.log(`📥 ${title}`);
  
  try {
    const response = await axios.get(url, {
      headers: {'User-Agent': 'Mozilla/5.0'},
      timeout: 30000
    });
    
    const $ = cheerio.load(response.data);
    $('script, style, nav, footer, header, .nav, .menu').remove();
    
    let content = '';
    const selectors = ['.content', '.main-content', 'main', 'article', '.page-content', '#content'];
    
    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        const text = cleanText(element.text());
        if (text.length > 100) {
          content = text;
          break;
        }
      }
    }
    
    if (!content || content.length < 100) {
      $('body').find('p').each((i, elem) => {
        const text = cleanText($(elem).text());
        if (text.length > 30) {
          content += text + '\n\n';
        }
      });
    }
    
    content = content.trim();
    
    if (content.length < 100) {
      console.log(`   ⚠️  Only ${content.length} characters`);
      return null;
    }
    
    console.log(`   ✅ ${content.length} characters`);
    
    return {
      external_id: 'page-' + title.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 50),
      title: title,
      category: category,
      content: content.substring(0, 10000),
      summary: generateSummary(content),
      source_url: url,
      source_name: title
    };
    
  } catch (error) {
    console.log(`   ❌ ${error.message}`);
    return null;
  }
}

const PAGES = [
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations', 'Academic Rules & Regulations', 'academic'],
  ['https://www.suffolk.edu/law/academics-clinics/academic-resources/law-course-offerings', 'Law Course Offerings', 'curriculum'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/research-assistant-and-teaching-assistant-programs', 'Research & Teaching Assistant Programs', 'student-programs']
];

async function scrapeAll() {
  console.log('🚀 Scraping Missing Pages\n');
  const allPolicies = [];
  
  for (const [url, title, category] of PAGES) {
    const policy = await scrapePage(url, title, category);
    if (policy) allPolicies.push(policy);
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log(`\n📊 Scraped ${allPolicies.length} pages`);
  
  if (allPolicies.length > 0) {
    console.log('💾 Saving...');
    const stmt = db.prepare(`
      INSERT INTO policies (external_id, title, category, content, summary, source_url, source_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(external_id) DO UPDATE SET content = excluded.content, last_updated = CURRENT_TIMESTAMP
    `);
    
    for (const p of allPolicies) {
      stmt.run(p.external_id, p.title, p.category, p.content, p.summary, p.source_url, p.source_name);
    }
    stmt.finalize();
    console.log(`✅ Saved ${allPolicies.length}\n`);
  }
  
  db.get('SELECT COUNT(*) as count FROM policies', (err, row) => {
    console.log(`📊 Total in database: ${row.count}`);
    db.close();
  });
}

scrapeAll();