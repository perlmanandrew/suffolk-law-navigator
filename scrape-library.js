require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('suffolk_law.db');
const BASE_URL = 'https://www.suffolk.edu';

function cleanText(text) {
  return text.replace(/\s+/g, ' ').replace(/\t/g, '').trim();
}

function generateSummary(content, maxLength = 200) {
  const cleaned = content.trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength - 3) + '...';
}

async function scrapePage(url, title) {
  console.log(`📥 ${title}`);
  console.log(`   ${url}`);
  
  try {
    const response = await axios.get(url, {
      headers: {'User-Agent': 'Mozilla/5.0'},
      timeout: 30000
    });
    
    const $ = cheerio.load(response.data);
    $('script, style, nav, footer, header, .nav, .menu, .breadcrumb').remove();
    
    let content = '';
    const selectors = ['main', 'article', '.content', '.main-content', '.page-content', '#content'];
    
    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        const text = cleanText(element.text());
        if (text.length > 200) {
          content = text;
          break;
        }
      }
    }
    
    if (!content || content.length < 200) {
      content = '';
      $('body p').each((i, elem) => {
        const text = cleanText($(elem).text());
        if (text.length > 30) {
          content += text + ' ';
        }
      });
    }
    
    content = content.trim();
    
    if (content.length < 200) {
      console.log(`   ⚠️  Only ${content.length} characters\n`);
      return null;
    }
    
    console.log(`   ✅ ${content.length} characters\n`);
    
    return {
      external_id: 'library-' + url.split('/').slice(-2).join('-').substring(0, 80),
      title: title,
      category: 'library',
      content: content.substring(0, 12000),
      summary: generateSummary(content),
      source_url: url,
      source_name: title
    };
    
  } catch (error) {
    console.log(`   ❌ ${error.message}\n`);
    return null;
  }
}

async function getLibraryLinks(mainUrl) {
  try {
    console.log('🔍 Finding library pages...\n');
    const response = await axios.get(mainUrl, {
      headers: {'User-Agent': 'Mozilla/5.0'},
      timeout: 30000
    });
    
    const $ = cheerio.load(response.data);
    const links = [];
    
    $('a').each((i, elem) => {
      let href = $(elem).attr('href');
      const text = cleanText($(elem).text());
      
      if (!href) return;
      
      if (href.startsWith('/')) {
        href = BASE_URL + href;
      }
      
      if (href.includes('/law/faculty-research/') && 
          !href.includes('#') && 
          !href.includes('.pdf') &&
          text.length > 3) {
        links.push({ url: href, title: text });
      }
    });
    
    // Remove duplicates
    const uniqueLinks = [];
    const seen = new Set();
    for (const link of links) {
      if (!seen.has(link.url)) {
        seen.add(link.url);
        uniqueLinks.push(link);
      }
    }
    
    console.log(`✅ Found ${uniqueLinks.length} library-related pages\n`);
    return uniqueLinks;
    
  } catch (error) {
    console.log(`❌ Error finding links: ${error.message}`);
    return [];
  }
}

async function savePolicy(policy) {
  return new Promise((resolve) => {
    const stmt = db.prepare(`
      INSERT INTO policies (external_id, title, category, content, summary, source_url, source_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(external_id) DO UPDATE SET 
        content = excluded.content, 
        last_updated = CURRENT_TIMESTAMP
    `);
    
    stmt.run(
      policy.external_id, policy.title, policy.category,
      policy.content, policy.summary, policy.source_url, policy.source_name,
      (err) => {
        stmt.finalize();
        resolve(!err);
      }
    );
  });
}

async function scrapeLibrary() {
  console.log('🚀 Suffolk Law Library Scraper');
  console.log('='.repeat(70) + '\n');
  
  const startTime = Date.now();
  const mainUrl = 'https://www.suffolk.edu/law/faculty-research/about-the-library';
  
  // First scrape the main page
  const mainPage = await scrapePage(mainUrl, 'About the Law Library');
  let savedCount = 0;
  
  if (mainPage) {
    const saved = await savePolicy(mainPage);
    if (saved) savedCount++;
  }
  
  await new Promise(r => setTimeout(r, 2000));
  
  // Get and scrape related library pages
  const links = await getLibraryLinks(mainUrl);
  
  for (const link of links.slice(0, 20)) { // Limit to 20 library pages
    const policy = await scrapePage(link.url, link.title);
    if (policy) {
      const saved = await savePolicy(policy);
      if (saved) savedCount++;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  
  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  console.log('='.repeat(70));
  console.log(`✨ Library scrape complete!`);
  console.log(`   Policies saved: ${savedCount}`);
  console.log(`   Duration: ${duration} minutes`);
  console.log('='.repeat(70));
  
  db.get('SELECT COUNT(*) as count FROM policies', (err, row) => {
    console.log(`\n📊 Total policies in database: ${row.count}\n`);
    db.close();
  });
}

scrapeLibrary();