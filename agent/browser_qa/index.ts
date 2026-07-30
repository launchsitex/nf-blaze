/**
 * Browser QA sub-agent entry — Playwright checks after a successful build.
 */
export { shouldRunBrowserQa } from './threshold'
export { buildScreenMap } from './screen_map'
export {
  runBrowserQaSubagent,
  formatSummaryForMain,
  type BrowserQaEvent,
  type BrowserQaResult
} from './subagent'
