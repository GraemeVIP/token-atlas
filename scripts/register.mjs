/**
 * Lets the CLI scripts import the app's modules unchanged.
 *
 * The app is bundled by Turbopack, which resolves extensionless relative
 * imports ("./agg"). Node does not, so a value import between lib files fails
 * under `node --experimental-strip-types`. Rather than uglify the source with
 * .ts extensions for the sake of a script, resolve them here.
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      try {
        const candidate = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) {
          return next(`${specifier}.ts`, context);
        }
      } catch {
        /* fall through to default resolution */
      }
    }
    return next(specifier, context);
  },
});
