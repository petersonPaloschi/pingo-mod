import type { SystemOneRequest, SystemOneResult } from "../types.ts";
import { text, type Locale } from "../../i18n.ts";
import { provider, type ProviderId } from "./providers.ts";
import { headersFor, normalize, paidModelHint, printable, redact, type Transport } from "./client.ts";
import { jevSent, reportJevEvent, type JevEvent } from "./events.ts";

export async function validateKey(
  id: ProviderId,
  apiKey: string,
  transport: Transport,
  model: string = provider(id).model,
  locale?: Locale,
  report: (event: JevEvent) => unknown = () => undefined,
): Promise<{ ok: true; ms: number } | { ok: false; refused: boolean; message: string }> {
  const info = provider(id);
  const startedAt = Date.now();
  // A setup check is a Jev call too: reported as observeAskJev reports the others.
  const call = `setup-${startedAt}`;
  const request = {
    model,
    state: text("provider.setupState", locale),
    questions: { ok: { type: "noul", instructions: text("provider.setupQuestion", locale) } },
  } as unknown as SystemOneRequest;
  const failed = async (message: string, refused = false) => {
    await reportJevEvent(report, { phase: "fail", call, at: Date.now(), error: message });
    return { ok: false as const, refused, message };
  };
  await reportJevEvent(report, { phase: "start", call, at: startedAt, sent: jevSent(request) });
  try {
    const reply = await transport.within(15_000, transport.post(info.url, headersFor(apiKey), JSON.stringify(request)));
    if (reply.ok) {
      let result: SystemOneResult = { answers: {}, usage: {} };
      try {
        result = normalize(JSON.parse(reply.text), locale);
      } catch {}
      await reportJevEvent(report, { phase: "end", call, at: Date.now(), result });
      return { ok: true, ms: Date.now() - startedAt };
    }
    const refused = reply.status === 401 || reply.status === 403;
    const paidHint = paidModelHint(id, model, reply.status, locale, true);
    return failed(
      text("provider.requestError", locale, {
        status: reply.status,
        provider: info.label,
        hint: paidHint,
        message: printable(redact(reply.text, apiKey).slice(0, 160)),
      }),
      refused,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failed(text("provider.networkError", locale, { message: redact(message, apiKey) }));
  }
}
