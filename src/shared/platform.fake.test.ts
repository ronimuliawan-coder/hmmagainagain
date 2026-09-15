// Conformance tests for the in-memory fake platform (browser dev adapter).

import { runConformance } from "./platform.conformance";
import { buildFakeFixture } from "./platform-fake";

const { platform, fixture } = buildFakeFixture();
runConformance(() => platform, fixture);
