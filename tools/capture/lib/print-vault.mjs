// Print the resolved vault path, for the shell entry points.
import { resolveVault } from "./vault.mjs";

process.stdout.write(resolveVault());
