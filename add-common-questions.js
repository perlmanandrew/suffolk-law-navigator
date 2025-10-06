require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('suffolk_law.db');

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
    external_id: 'excused-absences',
    title: 'Excused Absences',
    category: 'attendance',
    content: 'Routine absences cannot be excused. An absence may only be "excused" in rare circumstances when a student has a serious situation causing them to exceed the Applicable Absence Limitation. There are significant restrictions on excused absences, and exceeding the Applicable Absence Limitation will likely result in exclusion from affected classes. The Applicable Absence Limitation may only be used for short-term illness, family issues, bereavement, or unavoidable conflicts - not for non-emergency situations.',
    summary: 'Excused absences only for rare serious situations exceeding absence limits',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations#rule2B',
    source_name: 'Attendance Policy'
  },
  {
    external_id: 'class-recording',
    title: 'Recording Classes During Absences',
    category: 'attendance',
    content: 'The Dean of Students Office recommends obtaining notes from colleagues and connecting with professors rather than recording lectures. However, if you wish to record a class during an absence, you must obtain permission from each professor beforehand - it is at their discretion. The Dean of Students Office cannot arrange recordings for you.',
    summary: 'Must get professor permission to record classes; not arranged by Dean office',
    source_url: 'http://www.suffolk.edu/law/student-life/19216.php#recordingClasses',
    source_name: 'Recording Policy'
  },
  {
    external_id: 'absence-limitation-exceeded',
    title: 'Exceeding Applicable Absence Limitation',
    category: 'attendance',
    content: 'Unless you have a rare situation allowing limited excused absences beyond the Applicable Absence Limitation, exceeding the limit can result in exclusion from the class. Exclusion means you will either be allowed to withdraw (if you have an extraordinary circumstance like medical issue, work commitment, or family issue) or you will be assigned an F in the course.',
    summary: 'Exceeding absence limit can result in exclusion or F grade',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations#rule2B',
    source_name: 'Attendance Policy'
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
    external_id: 'tardiness-early-departure',
    title: 'Tardiness and Early Departures',
    category: 'attendance',
    content: 'Occasional tardiness or early departure due to unavoidable situations is understood. However, repeated tardiness or early departures may subject a student to exclusion from the class.',
    summary: 'Repeated tardiness or early departures can lead to class exclusion',
    source_url: 'https://www.suffolk.edu/law/academics-clinics/student-life/policies-rules/academic-rules-regulations#rule2B',
    source_name: 'Attendance Policy'
  },
  {
    external_id: 'intersession-attendance',
    title: 'Intersession and Intensive Course Attendance',
    category: 'attendance',
    content: 'Because intersession and intensive courses have a limited number of class meetings, there is no Applicable Absence Limitation for these courses. Students are expected to attend all class meetings of intersession and intensive courses.',
    summary: 'No absence allowance for intersession courses; must attend all meetings',
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
  }
];

console.log('📝 Adding Common Questions to Database...\n');

const stmt = db.prepare(`
  INSERT INTO policies (external_id, title, category, content, summary, source_url, source_name)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(external_id) DO UPDATE SET
    title = excluded.title,
    content = excluded.content,
    summary = excluded.summary,
    last_updated = CURRENT_TIMESTAMP
`);

let added = 0;
commonQuestions.forEach((q, index) => {
  stmt.run(
    q.external_id, q.title, q.category, q.content, q.summary, q.source_url, q.source_name,
    (err) => {
      if (err) {
        console.error('Error:', err);
      } else {
        added++;
        console.log(`✅ Added: ${q.title}`);
      }
      
      if (index === commonQuestions.length - 1) {
        stmt.finalize();
        db.get('SELECT COUNT(*) as count FROM policies', (err, row) => {
          console.log(`\n✨ Added ${added} common questions`);
          console.log(`📊 Total policies in database: ${row.count}`);
          db.close();
        });
      }
    }
  );
});