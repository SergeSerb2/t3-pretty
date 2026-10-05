import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command } from "effect/unstable/cli";

import * as ServerConfig from "../config.ts";
import { journalFileName } from "../observability/AgentMonitoring.ts";
import * as AgentMonitoringJournal from "../observability/AgentMonitoringJournal.ts";
import { resolveBaseDir } from "../os-jank.ts";
import { baseDirFlag } from "./config.ts";

const encodeReport = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }));

export const agentMonitoringCommand = Command.make("agent-monitoring", {
  baseDir: baseDirFlag,
}).pipe(
  Command.withDescription("Read the local agent monitoring summary and pending delivery count."),
  Command.withHandler(
    Effect.fn("cli.agent-monitoring")(function* (flags) {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const envHome = yield* Config.String("T3CODE_HOME").pipe(Config.option);
      const baseDir = yield* resolveBaseDir(
        Option.getOrUndefined(Option.orElse(flags.baseDir, () => envHome)),
      );
      const paths = yield* ServerConfig.deriveServerPaths(baseDir, undefined);
      const filename = path.join(paths.logsDir, journalFileName);
      if (!(yield* fs.exists(filename))) {
        yield* Console.log(
          "No agent monitoring journal found. Enable this host's saved Agent monitoring setting first (Settings > Diagnostics, or the host's Connections settings on mobile).",
        );
        return;
      }
      const report = yield* Effect.scoped(
        Effect.flatMap(AgentMonitoringJournal.AgentMonitoringJournal, (journal) => journal.report),
      ).pipe(Effect.provide(AgentMonitoringJournal.layerAt(filename, { readonly: true })));
      yield* Console.log(yield* encodeReport(report));
    }),
  ),
);
