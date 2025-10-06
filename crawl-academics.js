require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('suffolk_law.db');
const BASE_URL = 'https://www.suffolk.edu';
const START_URL = 'https://www.suffolk.edu/law/academics-clinics';
const visitedUrls = new Set();
const urlsToVisit = [];

function cleanText(text) {
  return text.replace(/\s+/g, ' ').replace(/\t/g, '').trim();
}

function generateSummary(content, maxLength = 200) {
  const cleaned = content.trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength - 3) + '...';
}

function isRelevantUrl(url) {
  // Only crawl academics-clinics pages
  return url.includes('/law/academics-clinics') && 
         !url.includes('#') && 
         !url.includes('.pdf') && 
         !url.includes('.jpg') && 
         !url.includes('.png') &&
         !url.includes('mailto:');
}

async function extractLinks(url) {
  try {
    const response = await axios.get(url, {
      headers: {'User-Agent': 'Mozilla/5.0'},
      timeout: 30000
    });
    
    const $ = cheerio.load(response.data);
    const links = new Set();
    
    $('a').each((i, elem) => {
      let href = $(elem).attr('href');
      if (!href) return;
      
      // Convert relative URLs to absolute
      if (href.startsWith('/')) {
        href = BASE_URL + href;
      }
      
      if (isRelevantUrl(href)) {
        links.add(href);
      }
    });
    
    return Array.from(links);
  } catch (error) {
    console.log(`   ❌ Error getting links: ${error.message}`);
    return [];
  }
}

async function scrapePage(url) {
  // Extract title from URL
  const urlParts = url.split('/');
  const slug = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2];
  const title = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  console.log(`📥 ${title}`);
  console.log(`   ${url}`);
  
  try {
    const response = await axios.get(url, {
      headers: {'User-Agent': 'Mozilla/5.0'},
      timeout: 30000
    });
    
    const $ = cheerio.load(response.data);
    
    // Remove non-content elements
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
    
    // Fallback: get all paragraphs
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
      console.log(`   ⚠️  Insufficient content (${content.length} chars)`);
      return null;
    }
    
    console.log(`   ✅ ${content.length} characters\n`);
    
    // Determine category from URL
    let category = 'academic';
    if (url.includes('student-life')) category = 'student-services';
    else if (url.includes('course')) category = 'curriculum';
    else if (url.includes('clinic')) category = 'clinics';
    
    return {
      external_id: 'crawl-' + url.split('/').slice(-2).join('-').substring(0, 80),
      title: title,
      category: category,
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

async function crawl() {
  console.log('🚀 Suffolk Law Academics & Clinics Crawler');
  console.log('='.repeat(70));
  console.log(`Starting at: ${START_URL}\n`);
  
  const startTime = Date.now();
  let savedCount = 0;
  const maxPages = 200; // Limit to first 50 pages
  
  // Start with the base URL
  urlsToVisit.push(START_URL);
  
  while (urlsToVisit.length > 0 && visitedUrls.size < maxPages) {
    const currentUrl = urlsToVisit.shift();
    
    // Skip if already visited
    if (visitedUrls.has(currentUrl)) continue;
    visitedUrls.add(currentUrl);
    
    console.log(`\n[${visitedUrls.size}/${maxPages}] Crawling...`);
    
    // Scrape the current page
    const policy = await scrapePage(currentUrl);
    if (policy) {
      const saved = await savePolicy(policy);
      if (saved) savedCount++;
    }
    
    // Get links from this page (only for first 10 pages to find structure)
    if (visitedUrls.size <= 10) {
      const links = await extractLinks(currentUrl);
      for (const link of links) {
        if (!visitedUrls.has(link) && !urlsToVisit.includes(link)) {
          urlsToVisit.push(link);
        }
      }
    }
    
    // Be respectful - wait between requests
    await new Promise(r => setTimeout(r, 2000));
  }
  
  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  console.log('\n' + '='.repeat(70));
  console.log(`✨ Crawl Complete!`);
  console.log(`   Pages visited: ${visitedUrls.size}`);
  console.log(`   Policies saved: ${savedCount}`);
  console.log(`   Duration: ${duration} minutes`);
  console.log('='.repeat(70));
  
  db.get('SELECT COUNT(*) as count FROM policies', (err, row) => {
    console.log(`\n📊 Total policies in database: ${row.count}\n`);
    db.close();
  });
}

crawl();