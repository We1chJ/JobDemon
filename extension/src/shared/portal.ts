// The job portal a page belongs to, by its address.
const KNOWN: [RegExp, string][] = [[/myworkday(jobs|site)?\.com$/, 'Workday'], [/greenhouse\.io$/, 'Greenhouse'], [/lever\.co$/, 'Lever'], [/ashbyhq\.com$/, 'Ashby'],
  [/smartrecruiters\.com$/, 'SmartRecruiters'], [/icims\.com$/, 'iCIMS'], [/jobvite\.com$/, 'Jobvite'], [/workable\.com$/, 'Workable'], [/bamboohr\.com$/, 'BambooHR'], [/gem\.com$/, 'Gem'],
  [/successfactors\.(com|eu)$/, 'SuccessFactors']];
export const portalName = (host: string) => KNOWN.find(([re]) => re.test(host))?.[1] ?? '';
