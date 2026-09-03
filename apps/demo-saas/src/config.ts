export interface LeakConfig {
  emailToAnalytics: boolean;
  phoneToAnalytics: boolean;
  emailInUrl: boolean;
  emailInLocalStorage: boolean;
  emailInConsole: boolean;
  passwordToAnalytics: boolean;
  hashedEmailToAnalytics: boolean;
  httpExternal: boolean;
  responseEmailToAnalytics: boolean;
}

const enabled = (value: string | undefined): boolean =>
  value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";

export const readLeakConfig = (environment: NodeJS.ProcessEnv = process.env): LeakConfig => ({
  emailToAnalytics: enabled(environment.DEMO_LEAK_EMAIL_TO_ANALYTICS),
  phoneToAnalytics: enabled(environment.DEMO_LEAK_PHONE_TO_ANALYTICS),
  emailInUrl: enabled(environment.DEMO_LEAK_EMAIL_IN_URL),
  emailInLocalStorage: enabled(environment.DEMO_LEAK_EMAIL_LOCALSTORAGE),
  emailInConsole: enabled(environment.DEMO_LEAK_EMAIL_CONSOLE),
  passwordToAnalytics: enabled(environment.DEMO_LEAK_PASSWORD_EXTERNAL),
  hashedEmailToAnalytics: enabled(environment.DEMO_LEAK_HASHED_EMAIL_EXTERNAL),
  httpExternal: enabled(environment.DEMO_LEAK_HTTP_EXTERNAL),
  responseEmailToAnalytics: enabled(environment.DEMO_LEAK_RESPONSE_EMAIL_EXTERNAL),
});
