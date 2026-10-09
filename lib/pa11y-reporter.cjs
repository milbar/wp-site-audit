// pa11y-ci jelentés-készítő: az oldalak címét gyűjti, hogy a bot-védelmi köztes oldalakat fel lehessen ismerni
// (azokon a pa11y természetesen nem talál hibát, ami hamis „hibátlan” eredményt adna).
module.exports = () => ({
  beforeAll() {}, begin() {}, error() {}, afterAll() {},
  results(r) { (globalThis.__pa11yTitles ||= new Map()).set(r.pageUrl, r.documentTitle || ''); },
});
