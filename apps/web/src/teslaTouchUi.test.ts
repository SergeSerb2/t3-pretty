import { describe, expect, it } from "vite-plus/test";

import {
  applyTeslaTouchDocumentState,
  extractSearchParams,
  isTeslaCarBrowserUserAgent,
  parseTeslaTouchQueryParam,
  readTeslaTouchSearchFromWindow,
  resolveTeslaTouchUi,
  TESLA_TOUCH_QUERY_PARAM,
} from "./teslaTouchUi";

const DESKTOP_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const TESLA_2026 =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.207 Safari/537.36 Tesla/2026.20.6.1 TESLA_AUTO_1960400_2025_TESLA_MODELY";

const TESLA_FIRMWARE =
  "Mozilla/5.0 (X11; GNU/Linux) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/75.0.3770.100 Chrome/75.0.3770.100 Safari/537.36 Tesla/2019.40.50.7-ad132c7b057e";

const TESLA_QT =
  "Mozilla/5.0 (X11; Linux) AppleWebKit/534.34 (KHTML, like Gecko) QtCarBrowser Safari/534.34";

const TESLA_AUTO_ONLY =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.207 Safari/537.36 TESLA_AUTO_0_2025_TESLA_MODELS";

describe("isTeslaCarBrowserUserAgent", () => {
  it("recognizes current Tesla Chromium firmware tokens", () => {
    expect(isTeslaCarBrowserUserAgent(TESLA_2026)).toBe(true);
    expect(isTeslaCarBrowserUserAgent(TESLA_FIRMWARE)).toBe(true);
  });

  it("recognizes QtCarBrowser and TESLA_AUTO_ tokens", () => {
    expect(isTeslaCarBrowserUserAgent(TESLA_QT)).toBe(true);
    expect(isTeslaCarBrowserUserAgent(TESLA_AUTO_ONLY)).toBe(true);
  });

  it("does not treat a desktop browser or a bare Tesla word as a car", () => {
    expect(isTeslaCarBrowserUserAgent(DESKTOP_CHROME)).toBe(false);
    expect(isTeslaCarBrowserUserAgent("")).toBe(false);
    expect(isTeslaCarBrowserUserAgent("Mozilla/5.0 Tesla Motors documentation")).toBe(false);
  });
});

describe("extractSearchParams", () => {
  it("reads query strings from router hrefs and hash-history URLs", () => {
    expect(extractSearchParams(`/${TESLA_TOUCH_QUERY_PARAM}=1`)).toBe("");
    expect(extractSearchParams(`/chat?${TESLA_TOUCH_QUERY_PARAM}=1`)).toBe(
      `${TESLA_TOUCH_QUERY_PARAM}=1`,
    );
    expect(extractSearchParams(`#/chat?${TESLA_TOUCH_QUERY_PARAM}=0#panel`)).toBe(
      `${TESLA_TOUCH_QUERY_PARAM}=0`,
    );
    expect(extractSearchParams(`${TESLA_TOUCH_QUERY_PARAM}=true`)).toBe(
      `${TESLA_TOUCH_QUERY_PARAM}=true`,
    );
    expect(extractSearchParams("/chat")).toBe("");
    expect(extractSearchParams("#/chat")).toBe("");
  });
});

describe("readTeslaTouchSearchFromWindow", () => {
  it("prefers location.search and falls back to a hash query", () => {
    expect(
      readTeslaTouchSearchFromWindow({ search: `?${TESLA_TOUCH_QUERY_PARAM}=1`, hash: "" }),
    ).toBe(`${TESLA_TOUCH_QUERY_PARAM}=1`);
    expect(
      readTeslaTouchSearchFromWindow({
        search: "",
        hash: `#/chat?${TESLA_TOUCH_QUERY_PARAM}=0`,
      }),
    ).toBe(`${TESLA_TOUCH_QUERY_PARAM}=0`);
    expect(readTeslaTouchSearchFromWindow(undefined)).toBe("");
  });
});

describe("parseTeslaTouchQueryParam", () => {
  it(`reads ${TESLA_TOUCH_QUERY_PARAM} from a search string`, () => {
    expect(parseTeslaTouchQueryParam(`?${TESLA_TOUCH_QUERY_PARAM}=1`)).toBe(true);
    expect(parseTeslaTouchQueryParam(`${TESLA_TOUCH_QUERY_PARAM}=true`)).toBe(true);
    expect(parseTeslaTouchQueryParam(`?foo=1&${TESLA_TOUCH_QUERY_PARAM}=on`)).toBe(true);
    expect(parseTeslaTouchQueryParam(`/chat?${TESLA_TOUCH_QUERY_PARAM}=1`)).toBe(true);
    expect(parseTeslaTouchQueryParam(`#/chat?${TESLA_TOUCH_QUERY_PARAM}=0`)).toBe(false);
    expect(parseTeslaTouchQueryParam(`?${TESLA_TOUCH_QUERY_PARAM}=0`)).toBe(false);
    expect(parseTeslaTouchQueryParam(`?${TESLA_TOUCH_QUERY_PARAM}=off`)).toBe(false);
    expect(parseTeslaTouchQueryParam("?other=1")).toBeNull();
    expect(parseTeslaTouchQueryParam(`?${TESLA_TOUCH_QUERY_PARAM}=maybe`)).toBeNull();
  });
});

describe("resolveTeslaTouchUi", () => {
  it("lets the query param win over Auto and a Tesla UA", () => {
    expect(
      resolveTeslaTouchUi({
        preference: "auto",
        search: "?tesla-touch=0",
        userAgent: TESLA_2026,
      }),
    ).toBe(false);
    expect(
      resolveTeslaTouchUi({
        preference: "off",
        search: "?tesla-touch=1",
        userAgent: DESKTOP_CHROME,
      }),
    ).toBe(true);
  });

  it("honors On and Off when the URL does not force a value", () => {
    expect(
      resolveTeslaTouchUi({
        preference: "on",
        search: "",
        userAgent: DESKTOP_CHROME,
      }),
    ).toBe(true);
    expect(
      resolveTeslaTouchUi({
        preference: "off",
        search: "",
        userAgent: TESLA_2026,
      }),
    ).toBe(false);
  });

  it("detects Tesla automatically when preference is Auto", () => {
    expect(
      resolveTeslaTouchUi({
        preference: "auto",
        search: "",
        userAgent: TESLA_2026,
      }),
    ).toBe(true);
    expect(
      resolveTeslaTouchUi({
        preference: "auto",
        search: "",
        userAgent: DESKTOP_CHROME,
      }),
    ).toBe(false);
  });
});

describe("applyTeslaTouchDocumentState", () => {
  it("stamps and clears the root data attribute", () => {
    const root = { dataset: {} as DOMStringMap } as HTMLElement;
    applyTeslaTouchDocumentState(true, root);
    expect(root.dataset.teslaTouch).toBe("true");
    applyTeslaTouchDocumentState(false, root);
    expect(root.dataset.teslaTouch).toBeUndefined();
  });
});
