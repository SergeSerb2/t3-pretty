import { registerRootComponent } from "expo";
import "react-native-gesture-handler";
import { LogBox } from "react-native";
import { featureFlags } from "react-native-screens";

import App from "./src/App";

// Required for react-native-screens' iOS FormSheet sizing fix when a nested
// native stack is rendered inside a non-fitToContents formSheet. The
// experiment bag is optional across screens versions — a missing field here
// must not abort JS before React mounts.
if (featureFlags.experiment) {
  featureFlags.experiment.synchronousScreenUpdatesEnabled = true;
}

if (process.env.EXPO_PUBLIC_SHOWCASE === "1") {
  LogBox.ignoreAllLogs();
}

registerRootComponent(App);
