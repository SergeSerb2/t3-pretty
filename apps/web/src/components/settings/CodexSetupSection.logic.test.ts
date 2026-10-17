import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { providerAuthReturnUrl } from "@t3tools/shared/providerAuthReturnUrl";
import { expect, it } from "vite-plus/test";
import { codexSetupReturnUrl } from "./CodexSetupSection.logic";

const environmentId = EnvironmentId.make("remote-machine");
const instanceId = ProviderInstanceId.make("work");

it.each(["t3code", "t3code-dev"])(
  "keeps %s provider setup targets through the desktop hash router",
  (scheme) => {
    const welcome = codexSetupReturnUrl(`${scheme}://app/#/welcome`, environmentId, instanceId);
    expect(providerAuthReturnUrl(welcome.toString())).toBe(
      `${scheme}://app/welcome#agents:remote-machine`,
    );
    const settings = codexSetupReturnUrl(
      `${scheme}://app/#/settings/providers?environmentId=remote-machine`,
      environmentId,
      instanceId,
    );
    expect(providerAuthReturnUrl(settings.toString())).toBe(
      `${scheme}://app/settings/providers?environmentId=remote-machine&instanceId=work`,
    );
  },
);

it("keeps the hosted web route and rejects arbitrary return origins", () => {
  const welcome = codexSetupReturnUrl("https://app.t3.codes/welcome", environmentId, instanceId);
  expect(providerAuthReturnUrl(welcome.toString())).toBe(
    "https://app.t3.codes/welcome#agents:remote-machine",
  );
  const unsafe = codexSetupReturnUrl("https://attacker.example/welcome", environmentId, instanceId);
  expect(providerAuthReturnUrl(unsafe.toString())).toBeUndefined();
});
