# Bili Focus 0.4.1 — Android sign-in CAPTCHA

Fixes an authentication policy defect consistent with the Android 14 report that entering a phone number and requesting an SMS code shows no CAPTCHA:

- Permit GeeTest's documented primary/fallback CAPTCHA endpoints as HTTPS subresources, not top-level pages.
- Enable CAPTCHA cookie state only in the isolated temporary authentication WebView.
- Add loading progress, Reload sign-in, clearer SMS instructions and visible sanitized network/TLS/CAPTCHA load errors.
- Preserve TLS validation, Safe Browsing, official-only top-level navigation, native session validation, encrypted storage, and QR sign-in.

External-browser authorization was evaluated but is not falsely advertised as connecting the app: browser cookies are not readable by Bili Focus. A complete external-browser authorization path needs provider-supported registered callbacks and compatible permissions.

Android version code 5 / version name 0.4.1. Uses the existing debug signing certificate, so install over 0.4.0 without uninstalling to retain app data. Real SMS delivery and CAPTCHA completion require user testing on Android 14; no phone number/account or device is accessed by the build tests.

Verification: production web build and Android APK build succeed; 452 app tests and 53 Android JVM tests pass, including the new CAPTCHA-domain/security boundary cases. Android instrumentation compiles only and was not run. APK signing matches the existing development certificate and packaged web assets match the production build.

Primary references: [GeeTest's documented domain requirements](https://docs.geetest.com/gt4/bypass) (domain compatibility only; no verification bypass is implemented) and [Chromium's Custom Tabs security boundaries](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/security/custom-tabs-faq.md).
