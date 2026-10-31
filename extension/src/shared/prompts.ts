// The exact wording of every question the Brain is asked. Change how the AI is asked here, not in code.
export const PROMPTS = {
  pickOne: 'Which option is true for this applicant, or is the one the guidelines say to choose? Never guess a fact about the applicant.',
  pickFile: "Following the guidelines, which of the applicant's files should be attached to this upload field?",
  pickFileNone: 'No file should be attached here.',
  pickNone: 'None of the options should be selected: none fits the applicant, or the guidelines say to leave it unanswered.',
  pickAnother: 'Besides the options already chosen, which other option is also true for this applicant, or is one the guidelines say to choose?',
  pickNoneMore: 'No further option should be selected.',
  source: 'Following the guidelines, which fact answers this question? Or does it need a written answer, or should it stay blank?',
  sourceWrite: 'An open-ended question that needs a written paragraph: motivation, experience, an essay, a cover letter.',
  sourceBlank: 'Leave this blank: the guidelines say so, or it does not apply to the applicant.',
  sourceUnknown: 'No fact answers this question.',
  isCoverLetter: 'Is this question asking for a cover letter?',
};
