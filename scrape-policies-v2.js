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

async function scrapePage(url, title) {
  console.log(`📥 ${title}`);
  
  try {
    const response = await axios.get(url, {
      headers: {'User-Agent': 'Mozilla/5.0'},
      timeout: 30000
    });
    
    const $ = cheerio.load(response.data);
    let content = '';
    
    // Remove scripts, styles, nav, footer
    $('script, style, nav, footer, header, .nav, .menu').remove();
    
    // Try multiple content extraction methods
    const selectors = [
      '.content',
      '.main-content', 
      'main',
      'article',
      '.policy-content',
      '#content',
      '.page-content'
    ];
    
    let foundContent = false;
    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        const text = cleanText(element.text());
        if (text.length > 100) {
          content = text;
          foundContent = true;
          break;
        }
      }
    }
    
    // If still no content, try body
    if (!foundContent) {
      $('body').find('p').each((i, elem) => {
        const text = cleanText($(elem).text());
        if (text.length > 30) {
          content += text + '\n\n';
        }
      });
    }
    
    content = content.trim();
    
    if (content.length < 100) {
      console.log(`   ⚠️  Only found ${content.length} characters`);
      return null;
    }
    
    console.log(`   ✅ ${content.length} characters extracted`);
    
    return {
      external_id: 'policy-v2-' + title.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 50),
      title: title,
      category: 'student-services',
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

async function savePolicies(policies) {
  let saved = 0;
  const stmt = db.prepare(`
    INSERT INTO policies (external_id, title, category, content, summary, source_url, source_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(external_id) DO UPDATE SET
      content = excluded.content,
      last_updated = CURRENT_TIMESTAMP
  `);

  for (const policy of policies) {
    if (policy) {
      await new Promise((resolve) => {
        stmt.run(
          policy.external_id, policy.title, policy.category,
          policy.content, policy.summary, policy.source_url, policy.source_name,
          (err) => {
            if (!err) saved++;
            resolve();
          }
        );
      });
    }
  }
  
  stmt.finalize();
  return { saved };
}

const POLICIES_TO_SCRAPE = [
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/exam-regulations-policy', 'Exam Regulations Policy'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/exam-postponement-and-rescheduling-requests-policy', 'Exam Postponement Policy'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/academic-accommodations', 'Academic Accommodations'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/leaves-of-absence-voluntary', 'Voluntary Leave of Absence'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/recording-classes-policy', 'Recording Classes Policy'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/accommodations-for-exams-policy', 'Accommodations for Exams'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/exam-interruption-policy', 'Exam Interruption Policy'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/examsoft-missing-text-policy', 'ExamSoft Missing Text Policy'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/requesting-exam-accommodations-policy', 'Requesting Exam Accommodations'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/class-make-up-policy', 'Class Make-up Policy'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/cancellation-and-delay-policy', 'Cancellation and Delay Policy'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/disciplinary-procedure-policy', 'Disciplinary Procedure'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/leaves-of-absence-involuntary', 'Involuntary Leave of Absence'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/satisfactory-academic-progress-policy', 'Satisfactory Academic Progress'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/visiting-out-study-abroad-policy', 'Visiting Out/Study Abroad'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/military-service-policy', 'Military Service Policy'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/withdrawal-due-to-failure-to-file-previous-educational-transcripts', 'Withdrawal for Missing Transcripts'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/family-rights-and-privacy-act-policy', 'FERPA Policy'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/computer-use-policy', 'Computer Use Policy'],
  ['https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/student-policies-procedures/electronic-mail-policy', 'Electronic Mail Policy']
];

async function scrapeAll() {
  console.log('🚀 Suffolk Law Policies Scraper v2\n');
  const startTime = Date.now();
  const allPolicies = [];
  
  for (const [url, title] of POLICIES_TO_SCRAPE) {
    const policy = await scrapePage(url, title);
    if (policy) allPolicies.push(policy);
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log(`\n📊 Scraped ${allPolicies.length} policies`);
  
  if (allPolicies.length > 0) {
    console.log('💾 Saving...');
    const result = await savePolicies(allPolicies);
    console.log(`✅ Saved ${result.saved}\n`);
  }
  
  db.get('SELECT COUNT(*) as count FROM policies', (err, row) => {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✨ Complete in ${duration}s`);
    console.log(`📊 Total in database: ${row.count}`);
    db.close();
  });
}

scrapeAll();