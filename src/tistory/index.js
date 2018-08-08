/**
 * Simple Tistory crawler, provides Promise API.
 * @module tistore/tistory
 */

import assert from "assert";
import request from "request";
import throat from "throat";
import {CHROME_UA} from "../util";

// NOTE(Kagami): Tistory actually has JSON API (see
// <http://www.tistory.com/guide/api/index>), but it requires
// authorization and it would be too risky to hardcode some predefined
// one. Also invite is required to register at Tistory.

export default {
  _BLOG_RE: /^(https?:\/\/[^/]+)/,
  _ENTRY_RE: /^https?:\/\/[^/]+\/(\d+([?#]|$)|entry\/)/,
  _LINK_RE: /https?:\/\/t\d+\.daumcdn\.net\/cfile\/tistory\/\w+/g,
  _getLastEntryNum(url, data) {
    let re = /<a\s+href="\/(\d+)"[\s>]/ig;
    let nums = [];
    let match;
    while ((match = re.exec(data)) != null) {
      nums.push(+match[1]);
    }
    assert.notEqual(nums.length, 0, "Failed to get number of entries");
    const last = Math.max(...nums);
    assert(last > 0, "Failed to get number of entries");
    return last;
  },
  _getLinks(data) {
    // Don't mind returning duplicates since they will be filtered out
    // by `tistore/index.fileSet`.
    return (data.match(this._LINK_RE) || []).map(link => link + "?original");
  },
  _fetch(url) {
    return new Promise((resolve, reject) => {
      // Encode non-ASCII path because request doesn't accept them.
      url = new URL(url).href;
      const opts = {url, headers: {"User-Agent": CHROME_UA}};
      request.get(opts, (err, res, body) => {
        if (err) {
          reject(err);
        } else if (res.statusCode >= 400) {
          reject(new Error(`Got ${res.statusCode} code`));
        } else {
          resolve(body);
        }
      });
    });
  },
  prepareURL(url) {
    // Forgive user some mistakes but in code we need proper URLs.
    url = url.trim();
    if (!url.startsWith("http:") && !url.startsWith("https:")) {
      url = "http://" + url;
    }
    return url;
  },
  isBlog(url) {
    url = this.prepareURL(url);
    return this._BLOG_RE.test(url);
  },
  isEntry(url) {
    url = this.prepareURL(url);
    return this._ENTRY_RE.test(url);
  },
  crawlBlog(url, opts) {
    url = this.prepareURL(url);
    url = this._BLOG_RE.exec(url)[1];  // Get bare URL
    return this._fetch(url)
      .then(this._getLastEntryNum.bind(this, url))
      .then(last => {
        let currentEntry = 0;
        function sendUpdate(links) {
          links = links || [];
          opts.onUpdate({links, currentEntry, totalEntries: last});
        }

        sendUpdate();
        const eurls = Array(last).fill().map((_, i) => `${url}/${i + 1}`);
        return Promise.all(eurls.map(throat(opts.threads, eurl => {
          return this.crawlEntry(eurl).then(links => {
            currentEntry++;
            sendUpdate(links);
          }, () => {
            currentEntry++;
            sendUpdate();
          });
        })))
          // Links are passed via live updates; this just makes interface
          // similar to crawlEntry.
          .then(() => []);
      });
  },
  crawlEntry(url) {
    url = this.prepareURL(url);
    return this._fetch(url).then(this._getLinks.bind(this));
  },
};
