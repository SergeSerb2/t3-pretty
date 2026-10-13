import { unified } from "unified";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { markdownWithHtml } from "./markdownDocument";

afterEach(() => vi.restoreAllMocks());

it("does not add an HTML preprocessing parse for a large fenced image-metadata source", () => {
  const processor = Object.getPrototypeOf(unified()) as ReturnType<typeof unified>;
  const parser = vi.spyOn(processor, "parse");
  const body = "```tsx\n" + 'const component = <Widget label="example" />;\n'.repeat(2500);
  for (let update = 0; update < 20; update++)
    expect(markdownWithHtml(body + update)).toBe(body + update);
  expect(parser).not.toHaveBeenCalled();
});

it.each([
  { name: "backtick fence", body: '```tsx\n<img src="literal.png">\n```\n', parse: false },
  {
    name: "tilde fence with a longer closing",
    body: '~~~tsx\n<img src="literal.png">\n~~~~\n',
    parse: false,
  },
  {
    name: "multiline CRLF code",
    body: 'Before\r\n\r\n```tsx\r\n<img\r\n src="literal.png">\r\n```\r\n',
    parse: false,
  },
  { name: "incomplete streaming fence", body: '```tsx\n<img src="literal.png">\n', parse: false },
  {
    name: "shorter closing stays in code",
    body: '````tsx\n<img src="literal.png">\n```\n<img src="still-code.png">\n',
    parse: false,
  },
  {
    name: "mismatched closing stays in code",
    body: '```tsx\n<img src="literal.png">\n~~~\n<img src="still-code.png">\n',
    parse: false,
  },
  {
    name: "HTML-like code fence info",
    body: "```tsx <Widget>\nconst value = 1;\n```\n",
    parse: false,
  },
  {
    name: "HTML after a longer closing",
    body: '```tsx\n<img src="literal.png">\n````\n\n<img src="outside.png">\n',
    parse: true,
    converted: "outside.png",
  },
  {
    name: "three-space closing exposes HTML",
    body: '```tsx\n<img src="literal.png">\n   ```\n\n<img src="outside.png">\n',
    parse: true,
    converted: "outside.png",
  },
  {
    name: "indented opening fence",
    body: '  ```tsx\n  <img src="literal.png">\n  ```\n',
    parse: true,
  },
  { name: "blockquote fence", body: '> ```tsx\n> <img src="literal.png">\n> ```\n', parse: true },
  {
    name: "list nested fence",
    body: '- Example\n\n  ```tsx\n  <img src="literal.png">\n  ```\n',
    parse: true,
  },
  {
    name: "reference destination resembles a fence",
    body: '[ref]:\n```tsx\n\n<img src="outside.png">\n',
    parse: true,
  },
  {
    name: "reference title contains a fence line",
    body: '[ref]: /foo "title\n```tsx\nend"\n\n<img src="outside.png">\n',
    parse: true,
  },
  {
    name: "invalid backtick info",
    body: '```tsx `bad`\n<img src="outside.png">\n',
    parse: true,
    converted: "outside.png",
  },
  { name: "inline code", body: 'Use `<img src="literal.png">` here.\n', parse: true },
  {
    name: "reference before real HTML",
    body: '[ref]: /foo\n\n```tsx\n<img src="literal.png">\n```\n\n<img src="outside.png">\n',
    parse: true,
    converted: "outside.png",
  },
  {
    name: "multiline real HTML",
    body: '```tsx\nconst value = 1;\n```\n\n<img\n src="outside.png">\n',
    parse: true,
    converted: "outside.png",
  },
  {
    name: "control prefix before a fence",
    body: '\u0000```tsx\n<img src="outside.png">\n',
    parse: true,
    converted: "outside.png",
  },
])(
  "preserves native Markdown output and parser fallback for $name",
  ({ body, parse, converted }) => {
    const processor = Object.getPrototypeOf(unified()) as ReturnType<typeof unified>;
    const astParser = vi.spyOn(processor, "parse");
    const convertedMarkdown = markdownWithHtml(body + "update 0");
    if (parse) expect(astParser).toHaveBeenCalledTimes(1);
    else expect(astParser.mock.calls.length).toBe(0);
    if (converted) {
      expect(convertedMarkdown).toContain(`![](<${converted}>)`);
      expect(convertedMarkdown).not.toContain(`<img src="${converted}">`);
    } else expect(convertedMarkdown).toBe(body + "update 0");
  },
);

it("falls back for BOM/control normalization before deciding whether HTML is inside a fence", () => {
  const processor = Object.getPrototypeOf(unified()) as ReturnType<typeof unified>;
  const astParser = vi.spyOn(processor, "parse");
  const body = "\ufeff```\n~~~~\n[ref]:\n```tsx\n```\n> prose\n</details>\n```\r";
  const convertedMarkdown = markdownWithHtml(body + "update 0");
  expect(astParser).toHaveBeenCalledTimes(1);
  expect(convertedMarkdown).not.toContain("</details>");
});
