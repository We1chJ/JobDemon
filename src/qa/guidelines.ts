// The default guidelines: plain sentences sent to the AI with every question. Edit them in Setup.
// No code reads these; they only steer the Brain.
export const DEFAULT_GUIDELINES = [
  'Always agree to privacy statements, terms of use, codes of conduct and similar confirmations: tick the box or choose the agreeing option.',
  "For self-identification questions (gender, race, ethnicity, veteran status, disability, pronouns): use the applicant's stated value. If there is none, choose the \"decline to answer\" option. Never guess.",
  'If a question only applies when the previous answer was Yes (for example "If so, please explain") and the previous answer was No, leave it blank.',
  'If a question needs an explanation or a story and no fact covers it, answer unknown rather than invent one.',
  'For "How did you hear about this job / about us" (any portal, Workday included): answer LinkedIn. If LinkedIn is not an option, answer Instagram. If neither is, choose the closest option (such as Social Media, Job Board, or Other), and in a sub-list choose LinkedIn or Instagram if offered.',
  'If the applicant\'s exact school, employer or city is not in a list, choose "Other" when it is offered.',
  'If a test score (SAT, ACT) is asked for and the applicant has none, choose the "not taken / no score" option.',
  "In a skills or languages checklist, tick only the items in the applicant's skills.",
  'In a select-all list, a "none of the above" or "not applicable" option is true only when no other option is.',
  'Leave optional phone-extension boxes empty.',
  'A job whose end date is "present" is the applicant\'s current job: tick "I currently work here" (or similar) for it and leave its end date empty.',
  'Numbered entries on a form ("Professional Experience 2", "Work Experience 2", "Education 1") match the applicant\'s job or school with the same number.',
  'Never use an "autofill from resume" upload; the answers are filled in directly.',
  'For any question about availability or willingness (to work onsite, in a given city or office, on given days, during a given period, to relocate, to travel, to start on a date), always answer Yes, whatever the applicant data says.',
  'Answer whenever a fact supports it, optional questions included. Say unknown only when nothing in the applicant data applies.',
  'Always attach the resume to a resume upload and the cover letter to a cover letter upload, even when the upload is optional.',
];
