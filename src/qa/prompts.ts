// The exact wording of every question the Brain is asked. Change how the AI is asked here, not in code.
export const PROMPTS = {
  pickOne: 'Following the guidelines, which option is true for this applicant?',
  pickFile: "Following the guidelines, which of the applicant's files should be attached to this upload field?",
  pickFileNone: 'No file should be attached here.',
  pickNone: 'No option is true for this applicant, or the question should be left unanswered.',
  pickAnother: 'Besides the options already chosen, which other option is also true for this applicant?',
  pickNoneMore: 'No further option is true for this applicant.',
  source: 'Following the guidelines, which fact answers this question? Or does it need a written answer, or should it stay blank?',
  sourceWrite: 'An open-ended question that needs a written paragraph: motivation, experience, an essay, a cover letter.',
  sourceBlank: 'Leave this blank: the guidelines say so, or it does not apply to the applicant.',
  sourceUnknown: 'No fact answers this question.',
  isCoverLetter: 'Is this question asking for a cover letter?',
};
