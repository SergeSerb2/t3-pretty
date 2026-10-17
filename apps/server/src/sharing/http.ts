import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import * as HttpMiddleware from "effect/http/HttpMiddleware";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as ThreadSharing from "./ThreadSharing.ts";

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );

const headers = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow, noarchive",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const sharing = yield* ThreadSharing.ThreadSharing;
    return HttpRouter.add(
      "GET",
      "/share/:key/:token",
      Effect.gen(function* () {
        const { key = "", token = "" } = yield* HttpRouter.params;
        const share = yield* sharing.readPublic(key, token);
        if (share === null)
          return HttpServerResponse.text("This shared conversation is unavailable.", {
            status: 404,
            headers,
          });
        return HttpServerResponse.text(
          `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${escapeHtml(share.title)} · T3 Pretty</title>
<style>
:root{font-family:system-ui,sans-serif;color:#20252b;background:#f7f8fa;color-scheme:light dark}
*{box-sizing:border-box}body{margin:0}main{max-width:850px;margin:auto;padding:56px 24px 80px}
header{border-bottom:1px solid #ccd2db;padding-bottom:28px;margin-bottom:36px}h1{font-size:30px;line-height:1.25;letter-spacing:-.025em;margin:12px 0 16px}
.brand{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#586574}header p,footer{font-size:13px;color:#586574;line-height:1.6}
article{margin:0 0 28px;padding:24px;border-radius:16px;background:#fff;border:1px solid #e1e5eb}article[data-role=user]{background:#edf1f7}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 14px;color:#586574}.message{white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;line-height:1.75}
footer{border-top:1px solid #ccd2db;padding-top:20px}@media(prefers-color-scheme:dark){:root{color:#e8ebef;background:#101318}header,footer{border-color:#313944}article{background:#191e26;border-color:#313944}article[data-role=user]{background:#202936}.brand,h2,header p,footer{color:#aab5c3}}
@media(max-width:600px){main{padding:28px 16px 48px}h1{font-size:24px}article{padding:18px}}
</style></head><body><main><header><span class="brand">T3 Pretty · Shared conversation</span>
<h1>${escapeHtml(share.title)}</h1><p>Read-only snapshot · Shared ${escapeHtml(share.publishedAt.slice(0, 10))}<br>Later messages appear only when the owner updates this snapshot.</p></header>
${share.messages.map((message) => `<article data-role="${message.role}"><h2>${message.role === "user" ? "User" : "Assistant"}</h2><div class="message">${escapeHtml(message.text)}</div></article>`).join("")}
<footer>Shared by the thread owner. This page does not grant access to their environment or files.</footer>
</main></body></html>`,
          { headers, contentType: "text/html; charset=utf-8" },
        );
      }).pipe(
        HttpMiddleware.withLoggerDisabled,
        Effect.catchTags({
          ThreadShareError: () =>
            Effect.succeed(
              HttpServerResponse.text("Shared conversation temporarily unavailable.", {
                status: 503,
                headers,
              }),
            ),
        }),
      ),
    );
  }),
);
