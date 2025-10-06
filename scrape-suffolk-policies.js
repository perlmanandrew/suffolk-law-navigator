require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('suffolk_law.db');

const SUFFOLK_URLS = [
  {
    url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations',
    category: 'academic',
    name: 'Academic Rules & Regulations'
  },
  {
    url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures',
    category: 'student-services',
    name: 'Student Policies & Procedures'
  },
  {
    url: 'https://www.suffolk.edu/law/academics-clinics/academic-resources/course-registration',
    category: 'registration',
    name: 'Course Registration'
  }
];

function cleanText(text) {
  return text.replace(/\s+/g, ' ').replace(/\n+/g, '\n').trim();
}

function generateSummary(content, maxLength = 200) {
  const cleaned = content.trim();
  if (cleaned.length <= maxLength) return cleaned;
  const truncated = cleaned.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf('.');
  if (lastPeriod > maxLength * 0.7) {
    return truncated.substring(0, lastPeriod + 1);
  }
  return truncated.substring(0, maxLength - 3) + '...';
}

async function scrapePage(urlObj) {
  console.log(`\n📥 Scraping: ${urlObj.name}`);
  console.log(`   URL: ${urlObj.url}`);

  try {
    const response = await axios.get(urlObj.url, {
      headers: {'User-Agent': 'Suffolk Law Student App'},
      timeout: 30000
    });

    const $ = cheerio.load(response.data);
    const policies = [];
    const mainContent = $('main, .main-content, article, .content').first();
    
    if (mainContent.length === 0) {
      console.log('   ⚠️  No main content found');
      return policies;
    }

    mainContent.find('h2, h3').each((i, elem) => {
      const $header = $(elem);
      const title = cleanText($header.text());
      
      if (!title || title.length < 5) return;

      let content = '';
      let $next = $header.next();
      
      while ($next.length && !$next.is('h2, h3')) {
        if ($next.is('p, ul, ol, div')) {
          const text = cleanText($next.text());
          if (text) content += text + '\n\n';
        }
        $next = $next.next();
      }

      content = content.trim();

      if (content.length > 100) {
        policies.push({
          external_id: `${urlObj.category}-${i}-v2`,
          title: title,
          category: urlObj.category,
          content: content,
          summary: generateSummary(content),
          source_url: urlObj.url,
          source_name: urlObj.name
        });
      }
    });

    console.log(`   ✅ Found ${policies.length} policy sections`);
    return policies;

  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return [];
  }
}

async function savePolicies(policies) {
  return new Promise((resolve) => {
    let saved = 0;
    const stmt = db.prepare(`
      INSERT INTO policies (external_id, title, category, content, summary, source_url, source_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(external_id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        last_updated = CURRENT_TIMESTAMP
    `);

    policies.forEach((policy, index) => {
      stmt.run(
        policy.external_id, policy.title, policy.category, 
        policy.content, policy.summary, policy.source_url, policy.source_name,
        (err) => {
          if (!err) saved++;
          if (index === policies.length - 1) {
            stmt.finalize(() => resolve({ saved }));
          }
        }
      );
    });
  });
}

async function scrapeAll() {
  console.log('🚀 Suffolk Law Policy Scraper');
  console.log('='.repeat(60));
  const startTime = Date.now();
  let allPolicies = [];

  for (const urlObj of SUFFOLK_URLS) {
    const policies = await scrapePage(urlObj);
    allPolicies = allPolicies.concat(policies);
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`📊 Total extracted: ${allPolicies.length}`);
  
  if (allPolicies.length > 0) {
    console.log('💾 Saving to database...');
    const result = await savePolicies(allPolicies);
    console.log(`✅ Saved ${result.saved} policies`);
  }

  db.get('SELECT COUNT(*) as count FROM policies', (err, row) => {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✨ Complete in ${duration}s`);
    console.log(`📊 Total in database: ${row.count}`);
    db.close();
  });
}

scrapeAll();