require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('suffolk_law.db');
const BASE_URL = 'https://www.suffolk.edu';

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

async function getIndexPage() {
  console.log('📋 Getting policy list...\n');
  const response = await axios.get(
    'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures',
    { headers: {'User-Agent': 'Suffolk Law Student App'}, timeout: 30000 }
  );
  
  const $ = cheerio.load(response.data);
  const links = [];
  
  $('a').each((i, elem) => {
    const href = $(elem).attr('href');
    const text = cleanText($(elem).text());
    
    if (href && href.includes('/student-policies-procedures/') && text && text.length > 5) {
      const fullUrl = href.startsWith('http') ? href : BASE_URL + href;
      links.push({ url: fullUrl, title: text });
    }
  });
  
  console.log(`✅ Found ${links.length} policy links\n`);
  return links;
}

async function scrapePolicyPage(link) {
  console.log(`📥 ${link.title}`);
  
  try {
    const response = await axios.get(link.url, {
      headers: {'User-Agent': 'Suffolk Law Student App'},
      timeout: 30000
    });
    
    const $ = cheerio.load(response.data);
    let content = '';
    
    // Try different content selectors
    const mainContent = $('main, .main-content, article, .content, .policy-content').first();
    
    if (mainContent.length > 0) {
      // Get all paragraph and list content
      mainContent.find('p, li').each((i, elem) => {
        const text = cleanText($(elem).text());
        if (text && text.length > 20) {
          content += text + '\n\n';
        }
      });
    }
    
    content = content.trim();
    
    if (content.length < 50) {
      console.log(`   ⚠️  Insufficient content`);
      return null;
    }
    
    console.log(`   ✅ ${content.length} characters`);
    
    return {
      external_id: 'policy-' + link.title.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      title: link.title,
      category: 'student-services',
      content: content.substring(0, 8000), // Limit to 8000 chars
      summary: generateSummary(content),
      source_url: link.url,
      source_name: link.title
    };
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    return null;
  }
}

async function savePolicies(policies) {
  return new Promise((resolve) => {
    let saved = 0;
    const stmt = db.prepare(`
      INSERT INTO policies (external_id, title, category, content, summary, source_url, source_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(external_id) DO UPDATE SET
        content = excluded.content,
        summary = excluded.summary,
        last_updated = CURRENT_TIMESTAMP
    `);

    policies.forEach((policy, index) => {
      if (policy) {
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
      } else if (index === policies.length - 1) {
        stmt.finalize(() => resolve({ saved }));
      }
    });
  });
}

async function scrapeAll() {
  console.log('🚀 Suffolk Law Student Policies Scraper');
  console.log('='.repeat(60) + '\n');
  const startTime = Date.now();
  
  try {
    const policyLinks = await getIndexPage();
    const allPolicies = [];
    
    // Scrape each policy (limit to first 20 for testing)
    const linksToScrape = policyLinks.slice(0, 20);
    console.log(`📥 Scraping ${linksToScrape.length} policies...\n`);
    
    for (const link of linksToScrape) {
      const policy = await scrapePolicyPage(link);
      if (policy) allPolicies.push(policy);
      await new Promise(r => setTimeout(r, 1500)); // 1.5 sec delay
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`📊 Successfully scraped: ${allPolicies.length}`);
    console.log('='.repeat(60) + '\n');
    
    if (allPolicies.length > 0) {
      console.log('💾 Saving to database...');
      const result = await savePolicies(allPolicies);
      console.log(`✅ Saved ${result.saved} policies\n`);
    }
    
    db.get('SELECT COUNT(*) as count FROM policies', (err, row) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log('='.repeat(60));
      console.log(`✨ Complete in ${duration}s`);
      console.log(`📊 Total in database: ${row.count}`);
      console.log('='.repeat(60));
      db.close();
    });
    
  } catch (error) {
    console.error('Fatal error:', error);
    db.close();
  }
}

scrapeAll();