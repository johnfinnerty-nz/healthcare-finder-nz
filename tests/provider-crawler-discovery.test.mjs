import assert from "node:assert/strict";
import test from "node:test";
import { crawlProviderSite, extractPageLinks } from "../tools/lib/provider-site-crawler.mjs";
import { fetchPublicSource } from "../tools/lib/source-fetcher.mjs";

const origin = "https://provider.invalid";

async function crawl(html, options = {}) {
  const calls = [];
  const result = await crawlProviderSite({
    seedUrls: [origin + "/"],
    maxPages: 30,
    rateLimitMs: 0,
    ...options,
    fetchSource: async (url) => {
      calls.push(url);
      const text = url.endsWith("/robots.txt") ? "User-agent: *\nAllow: /"
        : url.endsWith("/sitemap.xml") ? options.sitemap || "<urlset></urlset>"
          : url === origin + "/" ? html : "<h1>Provider information</h1>";
      return { url, finalUrl: url, ok: true, status: 200, text, ...options.response };
    }
  });
  return { result, calls };
}

test("link nofollow handles token lists, case, attribute order and unquoted values", () => {
  assert.deepEqual(extractPageLinks(`
    <a href="/contact" rel="external">Contact</a>
    <a href='/fees' REL='external NoFoLlOw sponsored'>Fees</a>
    <a rel=nofollow href=/services>Services</a>
    <a href="/team" rel="no&#102;ollow">Team</a>
    <a data-href="/diagnostics" href="/about?one=1&amp;two=2">About</a>
    <a href="/contact">Duplicate</a>
  `, origin), [origin + "/contact", origin + "/about?one=1&two=2"]);
});

test("hidden links and hidden ancestors cannot contribute crawl targets", () => {
  assert.deepEqual(extractPageLinks(`
    <a href="/fees" hidden>Fees</a>
    <a style="DISPLAY: none !important" href="/team">Team</a>
    <section hidden="until-found"><div><a href="/services">Services</a></div></section>
    <div style="color:red; visibility: hidden;"><a href="/about">About</a></div>
    <div aria-hidden="TRUE"><a href="/locations">Locations</a></div>
    <div inert><a href="/appointments">Appointments</a></div>
    <template><a href="/patients">Patients</a></template>
    <noscript><a href="/referrals">Referrals</a></noscript>
    <!-- <a href="/contact/comment">Comment</a> -->
    <script>const example = '<a href="/contact/script">Script</a>';</script>
    <style>/* <a href="/contact/style">Style</a> */</style>
    <textarea><a href="/contact/textarea">Textarea</a></textarea>
    <div data-hidden="true"><a title="2 > 1" href="/contact">Contact</a></div>
  `, origin), [origin + "/contact"]);
});

test("page robots nofollow applies to every link regardless of tag order", () => {
  for (const meta of [
    '<meta name="robots" content="index, nofollow">',
    "<META CONTENT=none NAME=ROBOTS>",
    '<meta name="CareFinderAotearoaProviderValidator" content="nofollow">'
  ]) {
    assert.deepEqual(extractPageLinks(`<a href="/contact">Contact</a>${meta}`, origin), []);
  }
  assert.deepEqual(extractPageLinks('<meta name="otherbot" content="nofollow"><meta name="robots" content="noindex, follow"><a href="/contact">Contact</a>', origin), [origin + "/contact"]);
});

test("HTTP robots nofollow honours generic and matching agent directives", async () => {
  for (const xRobotsTag of ["nofollow", "none", "index, nofollow", "CareFinderAotearoaProviderValidator: noindex, nofollow"]) {
    const { calls } = await crawl('<a href="/contact">Contact</a>', { response: { xRobotsTag } });
    assert(!calls.includes(origin + "/contact"), xRobotsTag);
  }
  assert.deepEqual(extractPageLinks('<a href="/contact">Contact</a>', origin, { xRobotsTag: "otherbot: noindex, nofollow" }), [origin + "/contact"]);
});

test("fetcher carries the HTTP robots header into the crawl result", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<h1>Provider information</h1>", { headers: { "x-robots-tag": "nofollow", "content-type": "text/html" } });
  try {
    const result = await fetchPublicSource(origin, { resolveDns: false });
    assert.equal(result.ok, true);
    assert.equal(result.xRobotsTag, "nofollow");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the reported hidden nofollow trap is never requested, even with a relevant path", async () => {
  const { calls } = await crawl(`
    <a href="/contact">Contact</a>
    <a href="/system-diagnostics-netservice" rel="nofollow" hidden>Diagnostics</a>
    <a href="/services/hidden-link" hidden>Hidden</a>
    <a href="/fees/nofollow-link" rel="nofollow">Nofollow</a>
  `);
  assert(calls.includes(origin + "/contact"));
  assert(!calls.includes(origin + "/system-diagnostics-netservice"));
  assert(!calls.includes(origin + "/services/hidden-link"));
  assert(!calls.includes(origin + "/fees/nofollow-link"));
});

test("page robots meta stops link discovery in the crawler", async () => {
  const { calls } = await crawl('<meta name="robots" content="nofollow"><a href="/contact">Contact</a>');
  assert(!calls.includes(origin + "/contact"));
});

test("rendering cannot remove the original page nofollow directive", async () => {
  for (const directive of [
    { html: '<meta name="robots" content="nofollow">', xRobotsTag: "" },
    { html: "", xRobotsTag: "nofollow" }
  ]) {
    let renders = 0;
    const { calls } = await crawl(directive.html + '<div id="root"></div><script src="app.js"></script>', {
      response: { xRobotsTag: directive.xRobotsTag },
      renderPage: async (url) => {
        renders += 1;
        return { ok: true, text: '<a href="/contact">Contact</a>', xRobotsTag: "" };
      }
    });
    assert.equal(renders, 1);
    assert(!calls.includes(origin + "/contact"));
  }
});

test("304 revalidation retains cached HTTP nofollow when the server omits it", async () => {
  const calls = [];
  const result = await crawlProviderSite({
    seedUrls: [origin + "/"], rateLimitMs: 0,
    cache: { [origin + "/"]: { text: '<a href="/contact">Contact</a>', xRobotsTag: "nofollow" } },
    fetchSource: async (url) => {
      calls.push(url);
      return url === origin + "/" ? { url, ok: true, status: 304, notModified: true, text: "", xRobotsTag: "" }
        : { url, ok: true, status: 200, text: "" };
    }
  });
  assert(!calls.includes(origin + "/contact"));
  assert.equal(result.pages[0].xRobotsTag, "nofollow");
});

test("discovered URLs must be useful provider pages, including sitemap entries", async () => {
  const allowed = ["/about-2", "/our-services", "/fees", "/funding", "/enrolments", "/clinicians", "/contact"];
  const excluded = ["/system-diagnostics-netservice", "/unknown", "/staff-portal", "/patients/sign-in", "/contact/log-in", "/contact/debug", "/services/honeypot", "/services.json", "/team.xml", "/?page_id=123", "/?next=contact", "/%73ystem/contact", "/patient_information.pdf"];
  const urls = [...allowed, ...excluded];
  const { calls } = await crawl(urls.map((url) => `<a href="${url}">Link</a>`).join(""), {
    sitemap: `<urlset>${urls.map((url) => `<url><loc>${origin}${url}</loc></url>`).join("")}</urlset>`
  });
  for (const url of allowed) assert(calls.includes(origin + url), url);
  for (const url of excluded) assert(!calls.includes(origin + url), url);
});

test("explicit provider seed URLs can use opaque slugs but not administrative paths", async () => {
  const { calls } = await crawl("", { seedUrls: [origin + "/alex-smith", origin + "/staff-portal"] });
  assert(calls.includes(origin + "/alex-smith"));
  assert(!calls.includes(origin + "/staff-portal"));
});

test("robots.txt disallow continues to override a relevant link", async () => {
  const calls = [];
  const result = await crawlProviderSite({
    seedUrls: [origin + "/"], rateLimitMs: 0,
    fetchSource: async (url) => {
      calls.push(url);
      return { url, finalUrl: url, ok: true, status: 200, text: url.endsWith("robots.txt") ? "User-agent: *\nDisallow: /contact" : '<a href="/contact">Contact</a>' };
    }
  });
  assert(!calls.includes(origin + "/contact"));
  assert(result.skipped.some((entry) => entry.reason === "robots-disallowed"));
});
