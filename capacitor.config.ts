import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.bilifocus.desktop',
  appName: 'Bili Focus',
  webDir: 'dist',
  server: { androidScheme: 'https', hostname: 'localhost' },
  android: { allowMixedContent: false },
};

export default config;
