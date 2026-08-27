// Dynamic Expo config: allowlist the Base44 preview origin so the Expo dev
// server's CORS middleware accepts requests from the preview iframe.
// (app.config.js augments app.json; Expo passes the static config in as `config`.)
const suffix = process.env.BASE44_PUBLIC_HOST_SUFFIX;
const origin = suffix ? `https://3000-${suffix}` : undefined;

export default ({ config }) => ({
  ...config,
  expo: {
    ...config.expo,
    extra: {
      ...(config.expo && config.expo.extra),
      router: {
        ...((config.expo && config.expo.extra && config.expo.extra.router) || {}),
        origin,
      },
    },
  },
});
