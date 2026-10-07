// @deepseek-ai/dsh-poetry — Host half (web-profile surface plugin).
// Pure UI plugin with no host-side behavior: the empty apply exists so the
// plugin appears in the host cordis.yml / Loader. The browser half ships via
// exports["./client"] and is discovered through package.json's dsh.client
// declaration. All data comes from the public online API at poetry.palemoky.com,
// called directly from the browser, so nothing lives here.
function apply() {}
export { apply };
